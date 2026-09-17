import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server/server.js';
import { verifiedScenarioFixture, semanticReview } from './helpers/verified-scenario.js';
import { phase7Fixture } from './helpers/phase7-evidence.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';
import { investigationFixtureDesign } from './helpers/ready-game-case.js';

async function setup(t, mode = 'AUTHOR') {
  const server = createAppServer({ mode }); server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, post: async (path, body, token) => {
    const response = await fetch(base + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { response, data: await response.json() };
  } };
}

function noPlayerSecrets(value) {
  assert.doesNotMatch(JSON.stringify(value),
    /groundTruth|judgment|acceptedEvidenceIds|requiredForCourtIds|requiredEvidenceIds|requiredCompletedActionIds|evidenceDiscoveryRules|sourceNodeRef|contradictionRef|exonerationRef|attackGraphRef|verificationResult|sourceRefs|provenance|fingerprint|correctionHint/);
}

const discoverA = [
  { action: 'investigate', targetId: 'target_web_server',
    investigationActionId: 'action_audit_log' },
  { action: 'collect', evidenceId: 'evidence_technical_a' },
];
const discoverB = [
  { action: 'investigate', targetId: 'target_web_server',
    investigationActionId: 'action_analyze_network_log' },
  { action: 'collect', evidenceId: 'evidence_technical_b' },
];

async function acceptedAuthor(post) {
  const baseScenario = verifiedScenarioFixture();
  let result = await post('/api/author/start', {}); const token = result.data.token;
  const technical = baseScenario.generationInput.technicalInput;
  result = await post('/api/author/prepare-scenario', {
    selectedAttackIds: baseScenario.generationInput.selectedAttackIds,
    network: technical.network, scenarioContext: technical.scenarioContext }, token);
  const option = result.data.author.scenarioOptions.find(item =>
    item.generationInputId === baseScenario.generationInput.generationInputId);
  const scenario = verifiedScenarioFixture(option.generationInput);
  result = await post('/api/author/import-scenario', { optionId: option.optionId,
    scenarioPackage: scenario.scenarioPackage }, token);
  const review = semanticReview(result.data.author.verificationInput);
  result = await post('/api/author/import-review', { semanticReview: review }, token);
  assert.equal(result.data.author.verificationResult.status, 'VERIFIED');
  result = await post('/api/author/prepare-evidence', {}, token);
  const evidence = phase7Fixture(scenario);
  result = await post('/api/author/import-evidence', { evidencePackage: evidence.evidencePackage }, token);
  assert.equal(result.data.author.evidenceImportResult.status, 'VALID');
  const set = evidence.evidenceSet;
  const progressionPlan = { schemaVersion: '1.0', scenarioId: set.scenarioId,
    evidenceSetId: set.evidenceSetId, attackGraphRef: set.attackGraphRef,
    initialCourtEvidenceIds: ['evidence_technical_b'],
    initialCourtStatementIds: ['statement_seen_operation'],
    investigationEvidenceIds: ['evidence_technical_a', 'evidence_technical_b',
      'evidence_testimony'],
    ...investigationFixtureDesign(),
    retrialStatementIds: ['statement_seen_operation', 'statement_checked_time'],
    returnToCourtCondition: 'ALL_REQUIRED_EVIDENCE_COLLECTED',
    objectionRules: [{ objectionRuleId: 'objection_seen_operation',
      targetStatementId: 'statement_seen_operation',
      acceptedEvidenceIds: ['evidence_technical_a'],
      contradictionRef: 'contradiction_seen_operation',
      exonerationRef: 'exoneration_defendant' }],
    retryPolicy: { maxCourtAttempts: 3, onFailure: 'RETURN_TO_INVESTIGATION',
      onLimitReached: 'BLOCKED' },
    publicMessages: { initialRuling: '現在の証拠だけを見ると被告人への疑いが残ります。',
      acquittalRuling: '被告人を無罪とします。',
      acquittalExplanation: '取得した記録により、人物を断定する主張は維持できません。',
      failureFeedback: 'この証拠では、この主張を崩せません。' } };
  result = await post('/api/author/build', { progressionPlan }, token);
  return { token, author: result.data.author };
}

test('npm start用AUTHOR modeで/authorへアクセスしCatalogを取得できる', async t => {
  const { base, post } = await setup(t);
  const root = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/author');
  for (const path of ['/author', '/author.js', '/style.css']) {
    const response = await fetch(base + path); assert.equal(response.status, 200);
  }
  const started = await post('/api/author/start', {});
  assert.equal(started.response.status, 200);
  assert.deepEqual(started.data.bootstrap.attacks.map(item => item.id).sort(),
    ['phishing', 'reflected_xss', 'sql_injection']);
});

test('Author APIの全工程からACCEPTED Play URLを生成する', async t => {
  const { post } = await setup(t);
  const result = await acceptedAuthor(post);
  assert.equal(result.author.currentState, 'ACCEPTED');
  assert.equal(result.author.evaluationResult.status, 'ACCEPTED');
  assert.match(result.author.playUrl, /^\/\?game=[a-f0-9]{48}$/);
});

test('Play URLでGenerated Gameを開始しInitial CourtからACQUITTEDまで進む', async t => {
  const { post } = await setup(t); const built = await acceptedAuthor(post);
  const playId = new URL(`http://localhost${built.author.playUrl}`).searchParams.get('game');
  let result = await post('/api/start', { playId }); const playerToken = result.data.token;
  noPlayerSecrets(result.data); assert.equal(result.data.game.currentState, 'TITLE');
  for (const body of [{ action: 'begin' }, { action: 'continue' }, ...discoverA, { action: 'retrial' },
    { action: 'objection', statementId: 'statement_seen_operation',
      evidenceId: 'evidence_technical_a' }]) {
    result = await post('/api/action', body, playerToken);
    assert.equal(result.response.status, 200); noPlayerSecrets(result.data);
  }
  assert.equal(result.data.game.currentState, 'ACQUITTED');
});

test('Objection失敗後にInvestigationへ戻れる', async t => {
  const { post } = await setup(t); const built = await acceptedAuthor(post);
  const playId = new URL(`http://localhost${built.author.playUrl}`).searchParams.get('game');
  let result = await post('/api/start', { playId }); const playerToken = result.data.token;
  for (const body of [{ action: 'begin' }, { action: 'continue' }, ...discoverA,
    ...discoverB, { action: 'retrial' },
    { action: 'objection', statementId: 'statement_checked_time',
      evidenceId: 'evidence_technical_b' }]) result = await post('/api/action', body, playerToken);
  assert.equal(result.data.game.currentState, 'GUILTY_RETRY'); noPlayerSecrets(result.data);
  result = await post('/api/action', { action: 'retry' }, playerToken);
  assert.equal(result.data.game.currentState, 'INVESTIGATION');
});

test('Author tokenとPlayer tokenを相互利用できない', async t => {
  const { base, post } = await setup(t); const built = await acceptedAuthor(post);
  const playId = new URL(`http://localhost${built.author.playUrl}`).searchParams.get('game');
  const player = await post('/api/start', { playId });
  assert.equal((await post('/api/action', { action: 'begin' }, built.token)).response.status, 401);
  const status = await fetch(base + '/api/author/status', {
    headers: { Authorization: `Bearer ${player.data.token}` } });
  assert.equal(status.status, 401);
});

test('未ACCEPTEDまたは未知playIdではPlayer Gameを開始しない', async t => {
  const { post } = await setup(t);
  assert.equal((await post('/api/start', { playId: '0'.repeat(48) })).response.status, 409);
  assert.equal((await post('/api/start', {})).response.status, 409);
});

test('Fixture/Generated modeではAuthor APIを公開しない', async t => {
  for (const mode of ['FIXTURE', 'GENERATED']) {
    const result = mode === 'GENERATED' ? readyGameCaseFixture().gameCaseResult : null;
    const server = createAppServer({ mode, gameCaseResult: result }); server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/api/author/start', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 404);
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});

test('Author APIは過大JSONとprototype pollution keyを拒否する', async t => {
  const { base } = await setup(t);
  let response = await fetch(base + '/api/author/start', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }) });
  assert.equal(response.status, 413);
  response = await fetch(base + '/api/author/start', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{"constructor":{"prototype":{"polluted":true}}}' });
  assert.equal(response.status, 400);
  assert.equal({}.polluted, undefined);
});
