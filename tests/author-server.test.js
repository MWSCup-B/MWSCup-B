import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server/server.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

async function setup(t, runner = new MockCodexRunner()) {
  const server = createAppServer({ mode: 'AUTHOR', codexRunner: runner });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, runner, post: async (path, body, token) => {
    const response = await fetch(base + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body) });
    return { response, data: await response.json() };
  }, status: async token => {
    const response = await fetch(base + '/api/author/status', {
      headers: { Authorization: `Bearer ${token}` } });
    return { response, data: await response.json() };
  } };
}

async function waitTerminal(status, token) {
  for (let index = 0; index < 100; index += 1) {
    const result = await status(token);
    if (['READY', 'FAILED', 'CANCELLED'].includes(result.data.author.currentState)) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('generation did not finish');
}

test('AUTO E2E: XSS + Network C + ★3 → revision → ACCEPTED → GAME READY', async t => {
  const tools = await setup(t, new MockCodexRunner({ reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'] }));
  const started = await tools.post('/api/author/start', {}); const token = started.data.token;
  assert.deepEqual(Object.keys(started.data.bootstrap).sort(), ['attack', 'difficulties', 'networks']);
  let result = await tools.post('/api/author/generate',
    { networkId: 'network-c', difficulty: 3 }, token);
  assert.equal(result.response.status, 200);
  result = await waitTerminal(tools.status, token);
  assert.equal(result.data.author.currentState, 'READY');
  assert.match(result.data.author.playUrl, /^\/\?game=[a-f0-9]{48}$/);
  assert.equal(tools.runner.scenarioCalls, 2); assert.equal(tools.runner.reviewCalls, 2);

  const playId = new URL(`http://localhost${result.data.author.playUrl}`).searchParams.get('game');
  result = await tools.post('/api/start', { playId }); const playerToken = result.data.token;
  const actions = [{ action: 'begin' }, ...Array.from({ length: 4 }, () => ({ action: 'next-dialogue' }))];
  for (let round = 1; round <= 3; round += 1) actions.push(
    { action: 'investigate', choiceId: `choice_${round}_encoded` }, { action: 'court' },
    { action: 'present-evidence', evidenceId: `xss_evidence_${round}` },
    { action: round === 3 ? 'finish' : 'next-round' });
  const views = [result.data.game];
  for (const action of actions) {
    result = await tools.post('/api/action', action, playerToken);
    assert.equal(result.response.status, 200, JSON.stringify(result.data)); views.push(result.data.game);
  }
  assert.equal(result.data.game.currentScene, 'ACQUITTED');
  assert.doesNotMatch(JSON.stringify(views),
    /groundTruth|verificationResult|correctEvidenceIds|classification|sourceEvidenceSetId|JSON Schema|Prompt/);
});

test('旧MANUAL APIは公開せずAUTO generate/cancel/statusだけを扱う', async t => {
  const tools = await setup(t); const started = await tools.post('/api/author/start', {});
  for (const path of ['/api/author/prepare-scenario', '/api/author/import-scenario',
    '/api/author/import-review', '/api/author/prepare-evidence',
    '/api/author/import-evidence', '/api/author/preview-progression', '/api/author/build']) {
    const result = await tools.post(path, {}, started.data.token);
    assert.equal(result.response.status, 404, path);
  }
});

test('Codex unavailableを簡潔に表示しcredential fieldを返さない', async t => {
  const tools = await setup(t, new MockCodexRunner({ unavailable: true }));
  const started = await tools.post('/api/author/start', {});
  await tools.post('/api/author/generate', { networkId: 'network-a', difficulty: 1 }, started.data.token);
  const result = await waitTerminal(tools.status, started.data.token);
  assert.equal(result.data.author.currentState, 'FAILED');
  assert.match(result.data.author.failure.message, /ログイン/);
  assert.doesNotMatch(JSON.stringify(result.data), /email|password|access.?token|refresh.?token|credential/i);
});

test('同一Server generation lockとcancel APIを強制する', async t => {
  const tools = await setup(t, new MockCodexRunner({ waitForCancel: true }));
  const first = await tools.post('/api/author/start', {});
  const second = await tools.post('/api/author/start', {});
  await tools.post('/api/author/generate', { networkId: 'network-a', difficulty: 1 }, first.data.token);
  let result = await tools.post('/api/author/generate',
    { networkId: 'network-b', difficulty: 2 }, second.data.token);
  assert.equal(result.response.status, 409); assert.equal(result.data.error.code, 'GENERATION_LOCKED');
  result = await tools.post('/api/author/cancel', {}, first.data.token);
  assert.equal(result.response.status, 200);
  result = await waitTerminal(tools.status, first.data.token);
  assert.equal(result.data.author.currentState, 'CANCELLED');
  assert.equal(result.data.author.playUrl, null);
});

test('Author APIは未知field・過大JSON・prototype pollution keyを拒否する', async t => {
  const tools = await setup(t); const started = await tools.post('/api/author/start', {});
  let result = await tools.post('/api/author/generate', {
    networkId: 'network-a', difficulty: 1, prompt: 'untrusted' }, started.data.token);
  assert.equal(result.response.status, 400);
  let response = await fetch(tools.base + '/api/author/start', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }) });
  assert.equal(response.status, 413);
  response = await fetch(tools.base + '/api/author/start', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"constructor":{"prototype":{"polluted":true}}}' });
  assert.equal(response.status, 400); assert.equal({}.polluted, undefined);
});
