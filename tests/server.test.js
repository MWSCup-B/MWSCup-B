import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createAppServer } from '../server/server.js';
import { groundTruth } from '../server/dummy-case.js';

async function setup(t) {
  const server = createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    post: (path, body, token, headers = {}) => fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify(body),
    }),
  };
}

function noSecrets(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /groundTruth|correctEvidenceId|PRIVATE_SENTINEL/);
  assert.ok(!serialized.includes(groundTruth.fact));
}

test('HTTP経由で開始・取得・法廷・結果に到達し正解情報を返さない', async t => {
  const { post } = await setup(t);
  for (const [id, success] of [['document-a', true], ['document-b', false]]) {
    let response = await post('/api/start', {});
    assert.equal(response.status, 200);
    let data = await response.json();
    noSecrets(data);
    assert.equal(data.game.phase, 'detective');
    const token = data.token;
    for (const body of [{ action: 'collect', evidenceId: id }, { action: 'courtroom' }, { action: 'present', evidenceId: id }]) {
      response = await post('/api/action', body, token);
      assert.equal(response.status, 200);
      data = await response.json();
      noSecrets(data);
    }
    assert.equal(data.game.phase, 'result');
    assert.deepEqual(data.game.result, { success });
  }
});

test('静的配信を限定しバックエンド・テスト・設定を公開しない', async t => {
  const { base } = await setup(t);
  for (const path of ['/', '/app.js', '/style.css']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('content-security-policy').includes("default-src 'none'"));
    noSecrets(await response.text());
  }
  for (const path of ['/server/dummy-case.js', '/server/game.js', '/package.json', '/AGENTS.md', '/tests/server.test.js', '/%2e%2e%2fserver%2fdummy-case.js', '/.git/config', '/app.js.map',
    '/server/generation/evaluator.js', '/schemas/scenario-context.schema.json', '/data/attacks/phishing.json',
    '/data/attacks/reflected_xss.json', '/data/attacks/sql_injection.json',
    '/tests/fixtures/attack-catalog/scenario-context.json', '/scenario-context.json', '/network.json']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    noSecrets(await response.text());
  }
});

test('セッションを分離し、不正な入力・別オリジン・過大入力を拒否する', async t => {
  const { base, post } = await setup(t);
  const a = await (await post('/api/start', {})).json();
  const b = await (await post('/api/start', {})).json();
  await post('/api/action', { action: 'collect', evidenceId: 'document-a' }, a.token);
  assert.equal((await post('/api/action', { action: 'courtroom' }, b.token)).status, 400);
  assert.equal((await post('/api/action', { action: 'courtroom' })).status, 401);
  const invalid = await post('/api/action', { action: 'present', evidenceId: 'document-a' }, a.token);
  assert.equal(invalid.status, 409);
  assert.deepEqual(Object.keys((await invalid.json()).error).sort(), ['code', 'field', 'message']);
  assert.equal((await post('/api/start', {}, null, { Origin: 'https://example.invalid' })).status, 403);
  // fetchはHostを置き換える環境があるため、生のHTTPリクエストで検証する。
  const hostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(base + '/api/start', {
      method: 'POST', headers: { Host: 'example.invalid', 'Content-Type': 'application/json' },
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(hostStatus, 403);
  for (const body of [null, [], { groundTruth: 'injected' }]) {
    assert.equal((await post('/api/start', body)).status, 400);
  }
  assert.equal((await post('/api/start', {}, null, { 'Content-Type': 'text/plain' })).status, 415);
  const malformed = await fetch(base + '/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await post('/api/start', { padding: 'x'.repeat(5000) })).status, 413);
});
