import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { GameAudio, audioSettings } from '../public/game-audio.js';
import { AUDIO_CATALOG, sceneForGame } from '../public/audio-catalog.js';
import { importAudio } from '../scripts/import-game-audio.mjs';
import { createAppServer } from '../server/server.js';

function audioHarness() {
  let time = 1000, created = 0;
  const sources = [], storage = new Map();
  const parameter = () => ({ value: 1, setTargetAtTime(value) { this.value = value; },
    setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, cancelScheduledValues() {} });
  const context = { currentTime: 0, state: 'suspended', destination: {},
    async resume() { this.state = 'running'; }, async suspend() { this.state = 'suspended'; },
    createGain: () => ({ gain: parameter(), connect() {}, disconnect() {} }),
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() { this.started = true; },
        stop(at) { this.stoppedAt = at ?? 0; } };
      sources.push(source); return source;
    } };
  const audio = new GameAudio({ contextFactory: () => { created++; return context; }, now: () => time,
    storage: () => ({ getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }) });
  audio.manifest = async () => Object.fromEntries(Object.keys(AUDIO_CATALOG).map(id => [id, {}]));
  audio.buffer = async id => ({ id });
  return { audio, sources, context, storage, created: () => created, tick: () => { time += 100; } };
}

test('scene routing uses only public game states', () => {
  for (const [state, expected] of Object.entries({ TITLE: 'title', INITIAL_COURT: 'court',
    INVESTIGATION: 'investigation', RETRIAL_COURT: 'court', GUILTY_RETRY: 'investigation',
    ACQUITTED: 'explanation', BLOCKED: 'silent' })) assert.equal(sceneForGame({ currentState: state }), expected);
  assert.equal(sceneForGame({ phase: 'detective' }), 'investigation');
  assert.equal(sceneForGame({ currentScene: 'COURT_EVIDENCE_ROUND' }), 'court');
});

test('stored settings reject malformed values and tolerate denied storage', () => {
  assert.deepEqual(audioSettings({ muted: 'true', bgm: NaN, effects: -3 }), { muted: false, bgm: 0.35, effects: 0 });
  assert.equal(audioSettings({ bgm: 4 }).bgm, 1);
  const audio = new GameAudio({ storage: () => { throw Error('denied'); } });
  assert.doesNotThrow(() => audio.setSettings({ muted: true }));
  assert.equal(audio.settings.muted, true);
});

test('no context before interaction; loops persist on redraw and crossfade on scene changes', async () => {
  const { audio, sources, created } = audioHarness();
  audio.forGame({ currentState: 'INVESTIGATION' });
  assert.equal(created(), 0);
  await audio.unlock(); assert.equal(sources.length, 1); assert.equal(sources[0].loop, true);
  audio.forGame({ currentState: 'INVESTIGATION' }); await audio.sync();
  assert.equal(sources.length, 1);
  audio.setScene('court'); await audio.sync();
  assert.equal(sources.length, 2); assert.equal(sources[0].stoppedAt, 0.95);
  assert.equal(audio.active.id, 'crisis');
  audio.setScene('silent'); await audio.sync(); assert.equal(audio.active, null);
});

test('uninstalled OpenTracks tracks fall back to supplied PeriTune tracks', async () => {
  const { audio, sources } = audioHarness();
  audio.manifest = async () => ({ 'secret-corridor': {}, 'ticking-labyrinth': {} });
  await audio.unlock(); assert.equal(audio.active.id, 'secret-corridor');
  audio.setScene('generation'); await audio.sync();
  assert.equal(sources.length, 1); assert.equal(audio.active.gain.gain.value, 0.38);
  audio.setScene('court'); await audio.sync(); assert.equal(audio.active.id, 'ticking-labyrinth');
});

test('late downloads cannot restore music from an earlier scene', async () => {
  const { audio } = audioHarness(); await audio.unlock();
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  audio.buffer = id => id === 'crisis' ? old : Promise.resolve({ id });
  audio.setScene('court'); const pending = audio.sync();
  audio.setScene('explanation'); await audio.sync();
  resolveOld({ id: 'crisis' }); await pending;
  assert.equal(audio.active.id, 'truth');
});

test('mute and volume persist, and hidden tabs suspend and drop effects', async () => {
  const { audio, context, sources, storage, tick } = audioHarness(); await audio.unlock();
  audio.setSettings({ muted: true, bgm: 0.2, effects: 0.15 });
  assert.equal(audio.musicGain.gain.value, 0); await audio.effect('success');
  assert.equal(sources.length, 1);
  assert.deepEqual(JSON.parse([...storage.values()][0]), { muted: true, bgm: 0.2, effects: 0.15 });
  audio.setSettings({ muted: false }); await audio.visibility(true);
  assert.equal(context.state, 'suspended'); tick(); await audio.effect('confirm'); assert.equal(sources.length, 1);
  await audio.visibility(false); assert.equal(context.state, 'running');
  assert.equal(sources.length, 1); tick(); await audio.effect('success'); assert.equal(sources.length, 2);
});

test('audio failure leaves a usable controller and retries on another interaction', async () => {
  const { audio } = audioHarness(); const original = audio.buffer;
  audio.buffer = async () => { throw Error('offline'); };
  await audio.unlock(); assert.equal(audio.active, null); assert.match(audio.status, /読み込めません/);
  audio.buffer = original; await audio.unlock(); assert.equal(audio.active.id, 'insight');
});

test('rapid effects are throttled and concurrent voices remain bounded', async () => {
  const { audio, sources, tick } = audioHarness(); await audio.unlock();
  await audio.effect('confirm'); await audio.effect('confirm');
  assert.equal(sources.length, 2);
  for (let index = 0; index < 5; index++) { tick(); await audio.effect('cursor'); }
  assert.equal(audio.effects.size, 3);
  await audio.visibility(true); assert.equal(audio.effects.size, 0);
});

test('importer validates audio and packages reversible authenticated data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mwscup-audio-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'test.ogg'), output = pathToFileURL(directory + '/output/');
  const bytes = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(128)]); await writeFile(input, bytes);
  await assert.rejects(importAudio('../escape', input, output), /Unknown/);
  const track = await importAudio('secret-corridor', input, output);
  const packed = await readFile(new URL(track.file, output));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(track.key, 'base64'), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(-16));
  assert.deepEqual(Buffer.concat([decipher.update(packed.subarray(12, -16)), decipher.final()]), bytes);
  await writeFile(input, Buffer.alloc(128));
  await assert.rejects(importAudio('secret-corridor', input, output), /Expected MP3/);
});

test('all shipped audio packages match recorded checksums and decrypt to audio', async () => {
  const directory = new URL('../public/assets/audio/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  const required = ['secret-corridor', 'ticking-labyrinth', 'confirm', 'save', 'start', 'cursor', 'message', 'success'];
  for (const id of required) {
    const track = manifest.tracks[id]; assert.ok(track, id);
    const packed = await readFile(new URL(track.file, directory));
    assert.equal(createHash('sha256').update(packed).digest('hex'), track.packedSha256);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(track.key, 'base64'), packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(-16));
    const decoded = Buffer.concat([decipher.update(packed.subarray(12, -16)), decipher.final()]);
    assert.equal(createHash('sha256').update(decoded).digest('hex'), track.sourceSha256);
  }
});

test('server serves local audio with original CSP and keeps raw sources private', async t => {
  const server = createAppServer({ mode: 'FIXTURE' }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/game-audio.js', '/audio-catalog.js', '/game-audio.css', '/audio-credits.html',
    '/assets/audio/manifest.json', '/assets/audio/secret-corridor.bin']) {
    const response = await fetch(base + path); assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    await response.arrayBuffer();
  }
  for (const path of ['/.tools/audio-source/secret-corridor.ogg', '/assets/audio/secret-corridor.mp3', '/assets/audio/unlisted.bin']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});
