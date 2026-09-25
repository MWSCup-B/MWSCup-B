import test from 'node:test';
import { procedureMethods } from '../server/generation/investigation-procedures.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server/server.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { createDefaultConfiguration } from '../server/generation/scenario-configuration.js';
import { correctCourtChoiceId } from '../server/generation/court-questions.js';

async function setup(t, runner = new MockCodexRunner()) {
  const savedGamesDirectory = await mkdtemp(join(tmpdir(), 'incident-craft-games-'));
  const server = createAppServer({ mode: 'AUTHOR', codexRunner: runner, savedGamesDirectory });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(savedGamesDirectory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, runner, savedGamesDirectory, post: async (path, body, token) => {
    const response = await fetch(base + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body) });
    return { response, data: await response.json() };
  }, status: async token => {
    const response = await fetch(base + '/api/author/status', {
      headers: { Authorization: `Bearer ${token}` } });
    return { response, data: await response.json() };
  }, games: async token => {
    const response = await fetch(base + '/api/author/games', {
      headers: { Authorization: `Bearer ${token}` } });
    return { response, data: await response.json() };
  }, deleteGame: async (token, gameId) => {
    const response = await fetch(`${base}/api/author/games/${gameId}`, { method: 'DELETE',
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

test('攻撃・舞台の新APIは追加攻撃を自動設定し、承認後にゲームを生成する', async t => {
  const tools = await setup(t); const started = await tools.post('/api/author/start', {});
  assert.equal(started.data.bootstrap.attackChoices.length, 8);
  assert.equal(started.data.bootstrap.settings.length, 5);
  assert.ok(started.data.bootstrap.attackSelectionPaths.some(path => path.join('>') === 'clickfix>ransomware'));
  const request = { schemaVersion: '1.0', attackIds: ['clickfix', 'ransomware'], settingId: 'school' };
  let result = await tools.post('/api/author/selection', { request }, started.data.token);
  assert.equal(result.response.status, 200);
  result = await waitFor(tools.status, started.data.token, ['SCENARIO_PREVIEW', 'FAILED']);
  assert.equal(result.data.author.currentState, 'SCENARIO_PREVIEW', JSON.stringify(result.data));
  assert.deepEqual(result.data.author.selection.request, request);
  assert.deepEqual(result.data.author.scenarioPreview.attacks.map(item => item.attackId), request.attackIds);
  assert.match(result.data.author.scenarioPreview.incidentSummary, /青葉学園/);
  // 2026-09-24: 攻撃・舞台の経路はkawata-work同様、基盤を直接独立Reviewへ渡す。
  assert.equal(tools.runner.scenarioCalls, 0);
  assert.equal(tools.runner.reviewCalls, 1);
  assert.equal(tools.runner.evidenceCalls, 0);
  await tools.post('/api/author/approve', {}, started.data.token);
  result = await waitFor(tools.status, started.data.token, ['READY', 'FAILED']);
  assert.equal(result.data.author.currentState, 'READY', JSON.stringify(result.data));
// 2026-09-24 修正前: 統合前の契約。
//   assert.match(result.data.author.playUrl, /^\/\?game=[a-f0-9]{48}$/);
// 2026-09-24 修正後: main制作画面・初回設計とkawata-workのゲーム生成を統合。
  assert.match(result.data.author.playUrl, /^\/\?saved=saved_[a-f0-9]{32}$/);
  assert.equal(result.data.author.saved, true);
});

test('新APIでもAuthor認証・閉じた入力・最大3種類を強制する', async t => {
  const tools = await setup(t); const started = await tools.post('/api/author/start', {});
  const valid = { schemaVersion: '1.0', attackIds: ['ransomware'], settingId: 'company' };
  const denied = await tools.post('/api/author/selection', { request: valid });
  assert.equal(denied.response.status, 401);
  for (const request of [
    { ...valid, attackIds: ['phishing', 'clickfix', 'ransomware', 'sql_injection'] },
    { ...valid, attackIds: ['ransomware', 'ransomware'] }, { ...valid, attackIds: [] },
    { ...valid, attackIds: ['unknown'] }, { ...valid, settingId: 'unknown' }, { ...valid, network: {} },
  ]) {
    const response = await tools.post('/api/author/selection', { request }, started.data.token);
    assert.equal(response.response.status, 400);
    assert.ok(response.data.error.code);
  }
  assert.equal(tools.runner.calls.length, 0);
});

test('順序を偽造したAPI要求はAI起動前に拒否し、検証済みプレビューを壊さない', async t => {
  const tools = await setup(t); const started = await tools.post('/api/author/start', {});
  const token = started.data.token;
  await tools.post('/api/author/selection', { request: {
    schemaVersion: '1.0', attackIds: ['phishing', 'clickfix', 'ransomware'], settingId: 'company',
  } }, token);
  const before = (await waitFor(tools.status, token, ['SCENARIO_PREVIEW', 'FAILED'])).data.author;
  assert.equal(before.currentState, 'SCENARIO_PREVIEW');
  const callCount = tools.runner.calls.length;
  for (const [attackIds, code] of [
    [['sql_injection', 'ransomware'], 'INVALID_ATTACK_COMBINATION'],
    [['ransomware', 'clickfix'], 'ATTACK_DEPENDENCY_ORDER_MISMATCH'],
    [['phishing', 'stored_xss', 'clickfix'], 'INVALID_ATTACK_SEQUENCE'],
  ]) {
    const result = await tools.post('/api/author/selection', { request: {
      schemaVersion: '1.0', attackIds, settingId: 'company',
    } }, token);
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, code);
    assert.match(result.data.error.field, /request\.attackIds/);
    assert.equal(tools.runner.calls.length, callCount);
    assert.deepEqual((await tools.status(token)).data.author, before);
  }
});

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
  const runner = new MockCodexRunner({ reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'] });
  const runJson = runner.runJson.bind(runner); let questions, plans;
  runner.runJson = async args => {
    const draft = await runJson(args);
    if (args.phase === 'GENERATING_EVIDENCE') { questions = structuredClone(draft.courtQuestions); plans = structuredClone(draft.materialInvestigations); }
    return draft;
  };
  const tools = await setup(t, runner);
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
  assert.equal(result.data.author.saved, true);
  assert.match(result.data.author.playUrl, /^\/\?saved=saved_[a-f0-9]{32}$/);
// 2026-09-20 修正前: 初回Scenario設計を含む呼出回数・失敗工程を検証する
//   assert.equal(tools.runner.scenarioCalls, 1); assert.equal(tools.runner.reviewCalls, 2);
// 2026-09-20 修正後: 初回Scenario設計を含む呼出回数・失敗工程を検証する
  assert.equal(tools.runner.scenarioCalls, 2); assert.equal(tools.runner.reviewCalls, 2);

  const saved = await tools.games(token);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.games.length, 1);
  assert.match(saved.data.games[0].gameId, /^saved_[a-f0-9]{32}$/);
  assert.equal(new URL(`http://localhost${result.data.author.playUrl}`).searchParams.get('saved'),
    saved.data.games[0].gameId);
  assert.equal(saved.data.games[0].difficulty, 2);
  assert.deepEqual(saved.data.games[0].attacks, ['フィッシング', '反射型XSS']);
  assert.equal((await readdir(tools.savedGamesDirectory)).filter(name => name.endsWith('.json')).length, 1);
  assert.equal((await fetch(`${tools.base}/data/saved-games/${saved.data.games[0].gameId}.json`)).status, 404);
  assert.equal((await tools.games()).response.status, 401);

  result = await tools.post('/api/start', { gameId: saved.data.games[0].gameId });
  const playerToken = result.data.token;
  assert.equal(result.data.game.currentState, 'TITLE');
  assert.doesNotMatch(JSON.stringify(result.data.game),
    /groundTruth|verificationResult|correctEvidenceIds|classification|sourceEvidenceSetId|JSON Schema|Prompt|correctOptionIndex|supportingQuotes/);

  const play = async body => {
    const actionResult = await tools.post('/api/action', body, playerToken);
    assert.equal(actionResult.response.status, 200, `${body.action}: ${JSON.stringify(actionResult.data)}`);
    return actionResult.data.game;
  };
  await play({ action: 'begin' }); let game = await play({ action: 'continue' });
  assert.equal(game.collectedEvidence.length, 0);
  for (const plan of plans) for (const [index, step] of plan.steps.entries()) game = await play({ action: 'inspect-material', materialId: plan.evidenceId,
    methodId: procedureMethods(plan, index).find(item => item.index === step.correctOptionIndex).methodId });
  const collectedTypes = new Set();
  const rounds = game.totalRounds;
  for (let round = 1; round <= rounds; round += 1) {
    assert.ok(game.investigationTargets.length > 1);
    for (const item of game.collectedEvidence) collectedTypes.add(item.type);
    assert.ok(game.currentEvidenceIds.every(id => game.collectedEvidence.some(item => item.evidenceId === id)));
    const material = game.workbench.materials.find(item => game.currentEvidenceIds.includes(item.materialId));
    const statementId = material.question.statementId;
    assert.equal(material.question.choices.length, 4);
    const question = questions.find(item => item.statementId === statementId);
    const interpretationChoiceId = correctCourtChoiceId(question);
    game = await play({ action: 'retrial', evidenceId: material.materialId, interpretationChoiceId });
    assert.equal(game.pendingInterpretation.statementId, statementId);
    assert.ok(game.testimonies.length);
    game = await play({ action: 'objection', statementId,
      evidenceId: material.materialId, interpretationChoiceId });
  }
  for (const type of ['EMAIL', 'WEB_ACCESS_LOG']) assert.ok(collectedTypes.has(type), type);
  assert.equal(game.currentState, 'ACQUITTED');
  assert.ok(game.caseStudy.materials.length > 0);
  assert.equal((await tools.games(token)).data.games[0].cleared, true);

  const menu = await tools.post('/api/author/menu', {}, token);
  assert.equal(menu.response.status, 200);
  assert.equal(menu.data.author.currentState, 'MODE_SELECTION');
  assert.equal((await tools.games(token)).data.games.length, 1);

  const removed = await tools.deleteGame(token, saved.data.games[0].gameId);
  assert.equal(removed.response.status, 200);
  assert.equal((await tools.games(token)).data.games.length, 0);
  const missing = await tools.post('/api/start', { gameId: saved.data.games[0].gameId });
  assert.equal(missing.response.status, 404);
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

test('ゲーム終了APIは認証と保存選択を確認して今回のServerを停止する', async () => {
  const savedGamesDirectory = await mkdtemp(join(tmpdir(), 'incident-craft-shutdown-'));
  const server = createAppServer({ mode: 'AUTHOR', codexRunner: new MockCodexRunner(),
    savedGamesDirectory });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (path, body, token) => fetch(base + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body) });
    const started = await (await post('/api/author/start', {})).json();
    assert.equal((await post('/api/author/shutdown', { saveData: true })).status, 401);
    assert.equal((await post('/api/author/shutdown', { saveData: 'yes' }, started.token)).status, 400);
    const closed = once(server, 'close');
    const response = await post('/api/author/shutdown', { saveData: false }, started.token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { shuttingDown: true, saveData: false, savedGameCount: 0 });
    await closed;
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(savedGamesDirectory, { recursive: true, force: true });
  }
});
