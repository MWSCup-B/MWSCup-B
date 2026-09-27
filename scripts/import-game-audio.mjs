// Import an already downloaded, licensed audio file. This script never downloads audio.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUDIO_CATALOG } from '../public/audio-catalog.js';

export async function importAudio(id, input, output = new URL('../public/assets/audio/', import.meta.url)) {
  if (!Object.hasOwn(AUDIO_CATALOG, id)) throw new Error('Unknown track ID');
  const info = await stat(input);
  if (!info.isFile() || info.size < 128 || info.size > 40 * 1024 * 1024) throw new Error('Audio must be 128 bytes–40 MiB');
  const bytes = await readFile(input);
  const header = bytes.subarray(0, 12).toString('ascii');
  if (!(header.startsWith('OggS') || header.startsWith('ID3') ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ||
    (header.startsWith('RIFF') && header.endsWith('WAVE')))) throw new Error('Expected MP3, OGG or WAV audio');
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const packed = Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  await mkdir(output, { recursive: true });
  const manifestUrl = new URL('manifest.json', output);
  let manifest = { version: 1, tracks: {} };
  try { manifest = JSON.parse(await readFile(manifestUrl, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // This is packaging for in-game use, not DRM or a secret key.
  const hash = value => createHash('sha256').update(value).digest('hex');
  manifest.tracks[id] = { ...AUDIO_CATALOG[id], file: `${id}.bin`, key: key.toString('base64'),
    sourceSha256: hash(bytes), packedSha256: hash(packed), bytes: packed.length };
  await writeFile(new URL(`${id}.bin`, output), packed);
  await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
  return manifest.tracks[id];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [id, file] = process.argv.slice(2);
  if (!id || !file) {
    console.error('Usage: node scripts/import-game-audio.mjs <track-id> <downloaded-audio-file>');
    process.exitCode = 1;
  } else {
    await importAudio(id, file);
    console.log(`Imported ${id}. Restart the server and reload the page.`);
  }
}
