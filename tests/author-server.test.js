import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server/server.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { createDefaultConfiguration } from '../server/generation/scenario-configuration.js';

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

async function waitFor(status, token, states) {
  for (let index = 0; index < 100; index += 1) {
    const result = await status(token);
    if (states.includes(result.data.author.currentState)) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('generation did not finish');
}

test('Author初期値のフィッシングを編集なしで提出でき、Evidence前にPreviewで停止する', async t => {
  const tools = await setup(t);
  const started = await tools.post('/api/author/start', {});
  const configuration = started.data.bootstrap.defaultManualConfiguration;
  assert.equal(started.data.author.currentState, 'MODE_SELECTION');
  assert.equal(tools.runner.calls.length, 0);
  assert.deepEqual(configuration.attacks.map(item => item.attackId), ['phishing']);
  assert.equal(configuration.attacks[0].evidenceAnswer,
    'メール文のリンク先と実際に遷移するリンク先が異なること');
  const submitted = await tools.post('/api/author/manual', { configuration }, started.data.token);
  assert.equal(submitted.response.status, 200);
  const result = await waitFor(tools.status, started.data.token, ['SCENARIO_PREVIEW', 'FAILED']);
  assert.equal(result.data.author.currentState, 'SCENARIO_PREVIEW');
  assert.equal(result.data.author.scenarioPreview.difficulty, 1);
  assert.deepEqual(result.data.author.scenarioPreview.network, configuration.network);
  assert.equal(tools.runner.evidenceCalls, 0);
});

test('MANUAL E2E: PreviewとUser Approvalを経てGAME READYになる', async t => {
  const tools = await setup(t, new MockCodexRunner({ reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'] }));
  const started = await tools.post('/api/author/start', {}); const token = started.data.token;
  assert.deepEqual(started.data.bootstrap.modes.map(item => item.id), ['MANUAL', 'MAKOTOMARU']);
  const configuration = createDefaultConfiguration({ mode: 'MANUAL', difficulty: 2,
    attackIds: ['phishing', 'reflected_xss'] });
  let result = await tools.post('/api/author/manual', { configuration }, token);
  assert.equal(result.response.status, 200);
  result = await waitFor(tools.status, token, ['SCENARIO_PREVIEW', 'FAILED']);
  assert.equal(result.data.author.currentState, 'SCENARIO_PREVIEW');
  assert.equal(tools.runner.reviewCalls, 2); assert.equal(tools.runner.evidenceCalls, 0);
  assert.equal(result.data.author.scenarioPreview.verification.status, 'VERIFIED');
  await tools.post('/api/author/approve', {}, token);
  result = await waitFor(tools.status, token, ['SCENARIO_PREVIEW', 'READY', 'FAILED']);
  assert.equal(result.data.author.currentState, 'READY');
  assert.match(result.data.author.playUrl, /^\/\?game=[a-f0-9]{48}$/);
  assert.equal(tools.runner.scenarioCalls, 1); assert.equal(tools.runner.reviewCalls, 2);

  const playId = new URL(`http://localhost${result.data.author.playUrl}`).searchParams.get('game');
  result = await tools.post('/api/start', { playId }); const playerToken = result.data.token;
  assert.equal(result.data.game.currentState, 'TITLE');
  assert.doesNotMatch(JSON.stringify(result.data.game),
    /groundTruth|verificationResult|correctEvidenceIds|classification|sourceEvidenceSetId|JSON Schema|Prompt/);

  const play = async body => {
    const actionResult = await tools.post('/api/action', body, playerToken);
    assert.equal(actionResult.response.status, 200, `${body.action}: ${JSON.stringify(actionResult.data)}`);
    return actionResult.data.game;
  };
  await play({ action: 'begin' }); let game = await play({ action: 'continue' });
  // 公開された取得元と操作だけで補助資料も取得できることを確認する。
  for (let pass = 0; pass < 10; pass += 1) {
    const before = game.collectedEvidence.length;
    for (const target of game.investigationTargets) for (const action of target.availableActions) {
      game = await play({ action: 'investigate', targetId: target.targetId,
        investigationActionId: action.actionId });
      for (const item of game.discoveredEvidence.filter(item => item.discoveryState === 'DISCOVERED')) {
        game = await play({ action: 'collect', evidenceId: item.evidenceId });
      }
    }
    if (game.collectedEvidence.length === before) break;
  }
  for (const type of ['EMAIL', 'WEB_ACCESS_LOG', 'TESTIMONY']) {
    assert.ok(game.collectedEvidence.some(item => item.type === type), type);
  }
  for (const statementId of ['statement_issue_1', 'statement_issue_2', 'statement_seen_operation']) {
    await play({ action: 'retrial' });
    game = await play({ action: 'objection', statementId,
      evidenceId: 'evidence_technical_a' });
  }
  assert.equal(game.currentState, 'ACQUITTED');
});

test('旧Import APIと承認を迂回するgenerate APIは公開しない', async t => {
  const tools = await setup(t); const started = await tools.post('/api/author/start', {});
  for (const path of ['/api/author/prepare-scenario', '/api/author/import-scenario',
    '/api/author/import-review', '/api/author/prepare-evidence',
    '/api/author/import-evidence', '/api/author/preview-progression', '/api/author/build',
    '/api/author/generate']) {
    const result = await tools.post(path, {}, started.data.token);
    assert.equal(result.response.status, 404, path);
  }
});

test('Codex unavailableを簡潔に表示しcredential fieldを返さない', async t => {
  const tools = await setup(t, new MockCodexRunner({ unavailable: true }));
  const started = await tools.post('/api/author/start', {});
  await tools.post('/api/author/manual', { configuration: createDefaultConfiguration() }, started.data.token);
  const result = await waitFor(tools.status, started.data.token, ['FAILED']);
  assert.equal(result.data.author.currentState, 'FAILED');
  assert.match(result.data.author.failure.message, /ログイン/);
  assert.doesNotMatch(JSON.stringify(result.data),
    /"(?:password|accessToken|refreshToken|credential|accountName|userId)"/i);
});

test('真実丸開始直後もMODE_SELECTIONへ戻らず処理中stateを公開する', async t => {
  const tools = await setup(t, new MockCodexRunner({ waitForCancel: true }));
  const started = await tools.post('/api/author/start', {});
  let result = await tools.post('/api/author/makotomaru', { request: {
    schemaVersion: '1.0', difficulty: 1, attackCategory: 'ANY', complexity: 'STANDARD',
  } }, started.data.token);
  assert.equal(result.response.status, 200);
  assert.notEqual(result.data.author.currentState, 'MODE_SELECTION');
  assert.ok(['CHECKING_CODEX', 'MAKOTOMARU_CONFIGURATION'].includes(
    result.data.author.currentState));
  assert.equal(result.data.author.canCancel, true);
  result = await tools.post('/api/author/cancel', {}, started.data.token);
  assert.equal(result.response.status, 200);
  result = await waitFor(tools.status, started.data.token, ['CANCELLED']);
  assert.equal(result.data.author.currentState, 'CANCELLED');
});

test('同一Server generation lockとcancel APIを強制する', async t => {
  const tools = await setup(t, new MockCodexRunner({ waitForCancel: true }));
  const first = await tools.post('/api/author/start', {});
  const second = await tools.post('/api/author/start', {});
  await tools.post('/api/author/manual', { configuration: createDefaultConfiguration() }, first.data.token);
  let result = await tools.post('/api/author/manual',
    { configuration: createDefaultConfiguration({ difficulty: 2 }) }, second.data.token);
  assert.equal(result.response.status, 409); assert.equal(result.data.error.code, 'GENERATION_LOCKED');
  result = await tools.post('/api/author/cancel', {}, first.data.token);
  assert.equal(result.response.status, 200);
  result = await waitFor(tools.status, first.data.token, ['CANCELLED']);
  assert.equal(result.data.author.currentState, 'CANCELLED');
  assert.equal(result.data.author.playUrl, null);
});

test('Author APIは未知field・過大JSON・prototype pollution keyを拒否する', async t => {
  const tools = await setup(t); const started = await tools.post('/api/author/start', {});
  let result = await tools.post('/api/author/manual', {
    configuration: createDefaultConfiguration(), prompt: 'untrusted' }, started.data.token);
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
