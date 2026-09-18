import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AutoGenerationManager, autoAuthorBootstrap, autoAuthorView,
  classifyBlocked, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { CodexOutputSchemaError } from '../server/codex/codex-errors.js';

async function generated(options = {}, selection = { networkId: 'network-c', difficulty: 3 },
  maxAttempts = 3) {
  const runner = new MockCodexRunner(options);
  const manager = new AutoGenerationManager({ jsonRunner: runner, maxAttempts });
  const session = createAutoAuthorSession(); manager.start(session, selection);
  await manager.waitForIdle(); return { runner, manager, session, view: autoAuthorView(session) };
}

test('AUTO bootstrapはXSS・Network A-D・Difficulty 1-3だけを公開する', () => {
  const value = autoAuthorBootstrap();
  assert.equal(value.attack.id, 'reflected_xss');
  assert.deepEqual(value.networks.map(item => item.networkId),
    ['network-a', 'network-b', 'network-c', 'network-d']);
  assert.deepEqual(value.difficulties.map(item => item.difficulty), [1, 2, 3]);
  assert.deepEqual(Object.keys(value).sort(), ['attack', 'difficulties', 'networks']);
});

test('XSS + Network C + ★3をReview修正後にGAME READYまで自動実行する', async () => {
  const { runner, session, view } = await generated({
    reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'] });
  assert.equal(view.currentState, 'READY'); assert.ok(session.runtime);
  assert.equal(session.runtime.evidenceChain.length, 3);
  assert.equal(session.prototypeEvaluation.status, 'ACCEPTED');
  assert.equal(session.gameCaseResult.status, 'READY');
  assert.equal(session.gameMakeResult.status, 'BUILT');
  assert.equal(session.evaluationResult.status, 'ACCEPTED');
  assert.equal(runner.scenarioCalls, 2); assert.equal(runner.reviewCalls, 2);
  assert.equal(runner.evidenceCalls, 1);
  assert.equal(session.scenarioImportResult.status, 'VALID');
  assert.equal(session.evidenceImportResult.status, 'VALID');
  assert.deepEqual([...new Set(runner.calls.filter(item => item.kind === 'invocation')
    .map(item => item.outputSchemaName))].sort(),
  ['evidence-import-package', 'scenario-import-package', 'scenario-verification-review']);
  assert.ok(runner.calls.filter(item => item.kind === 'invocation')
    .every(item => item.hasOutputSchema));
  assert.ok(view.progress.every(item => item.status === 'COMPLETE'
    || item.id === 'revision'));
  const reviews = runner.calls.filter(item => item.phase === 'REVIEWING_SCENARIO');
  assert.equal(reviews.length, 2);
  assert.notStrictEqual(reviews[0].data, reviews[1].data);
});

test('Scenario malformed/schema validation failureをfeedback付きで最大3回再生成する', async () => {
  const { runner, view } = await generated({ malformedScenario: true });
  assert.equal(view.currentState, 'FAILED');
  assert.equal(view.failure.code, 'MAX_REVISION_EXCEEDED');
  assert.equal(runner.scenarioCalls, 3);
  assert.ok(runner.calls.filter(item => item.phase === 'REVISING_SCENARIO')
    .every(item => item.feedback.classification === 'REPAIRABLE_BLOCKED'));
});

test('Scenarioの非JSON出力をREPAIRABLE_BLOCKEDとして次Invocationで修正する', async () => {
  const { runner, view } = await generated({ malformedScenarioOutput: 1 });
  assert.equal(view.currentState, 'READY'); assert.equal(runner.scenarioCalls, 2);
  const revision = runner.calls.find(item => item.phase === 'REVISING_SCENARIO');
  assert.equal(revision.feedback.classification, 'REPAIRABLE_BLOCKED');
  assert.equal(revision.feedback.errors[0].code, 'MALFORMED_CODEX_JSON');
});

test('Reviewer Schema違反は形式だけを別Invocationでrepairする', async () => {
  const { runner, view } = await generated({ reviewerSchemaFailure: true });
  assert.equal(view.currentState, 'READY'); assert.equal(runner.reviewCalls, 2);
  const repair = runner.calls.filter(item => item.phase === 'REVIEWING_SCENARIO')[1];
  assert.equal(repair.feedback.repairOnly, true);
  assert.match(repair.feedback.correctionHint, /技術的事実を追加しない/);
});

test('Reviewer category参照違反は正確な参照規則を渡して別Invocationでrepairする', async () => {
  const { runner, view } = await generated({ reviewerGroundFailure: true });
  assert.equal(view.currentState, 'READY'); assert.equal(runner.reviewCalls, 2);
  const repair = runner.calls.filter(item => item.phase === 'REVIEWING_SCENARIO')[1];
  assert.equal(repair.feedback.code, 'IRRELEVANT_REVIEW_GROUND');
  const identity = repair.feedback.referenceRules.IDENTITY_ATTRIBUTION;
  assert.ok(identity.subjectRefs.every(ref => ref.startsWith('character:')));
  assert.ok(identity.sourceRefs.every(ref => /^(groundTruth\.fact:|attackGraph\.node:|scenarioContext\.)/.test(ref)));
  const reference = repair.feedback.referenceRules.REFERENCE_CONTENT_ALIGNMENT;
  assert.ok(reference.subjectRefs.length > 0);
  assert.deepEqual(reference.subjectRefs, reference.sourceRefs);
  assert.ok(reference.subjectRefs.every(ref => ref.startsWith('referenceMaterial:')));
  assert.ok(view.developerDetails.some(item => item.errorCode === 'IRRELEVANT_REVIEW_GROUND'));
});

test('Codex unavailableはLLM InvocationなしでFAILEDにする', async () => {
  const { runner, view } = await generated({ unavailable: true });
  assert.equal(view.currentState, 'FAILED'); assert.equal(view.failure.code, 'CODEX_UNAVAILABLE');
  assert.equal(runner.calls.filter(item => item.kind === 'invocation').length, 0);
  assert.match(view.failure.message, /ログイン/);
});

test('output schemaエラーは専用分類と安全なDeveloper Detailを公開する', async () => {
  const jsonRunner = {
    checkAvailability: async () => ({ available: true, version: 'codex-cli test' }),
    runJson: async ({ phase }) => { throw new CodexOutputSchemaError(
      'Codexが生成用出力Schemaを受理しませんでした。', {
        phase, schemaName: 'scenario-import-package', cliErrorCode: 'invalid_json_schema',
        details: 'schemaVersion requires explicit type',
      }); },
  };
  const manager = new AutoGenerationManager({ jsonRunner });
  const session = createAutoAuthorSession();
  manager.start(session, { networkId: 'network-a', difficulty: 1 });
  await manager.waitForIdle();
  const view = autoAuthorView(session);
  assert.equal(view.currentState, 'FAILED');
  assert.equal(view.failure.code, 'CODEX_OUTPUT_SCHEMA_INVALID');
  assert.equal(view.failure.message, '生成用データ形式の内部エラーが発生しました。');
  assert.deepEqual(view.developerDetails[0], {
    phase: 'GENERATING_SCENARIO', attempt: 1,
    code: 'CODEX_OUTPUT_SCHEMA_INVALID', errorCode: 'CODEX_OUTPUT_SCHEMA_INVALID',
    field: 'generation', schemaName: 'scenario-import-package',
    cliErrorCode: 'invalid_json_schema', reason: 'schemaVersion requires explicit type',
    correctionHint: '入力条件を変えずに、もう一度生成してください。',
  });
});

test('Accountに依存する識別情報を状態へ保存・公開しない', async () => {
  const { view } = await generated();
  const keys = [];
  const visit = value => { if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      keys.push(key); visit(item);
    } };
  visit(view);
  for (const forbidden of ['email', 'accountName', 'userId', 'accessToken',
    'refreshToken', 'credential']) assert.ok(!keys.includes(forbidden));
});

test('Evidence生成失敗とEvaluation拒否はREADYにしない', async () => {
  const evidence = await generated({ evidenceInvalid: true });
  assert.equal(evidence.view.currentState, 'FAILED'); assert.equal(evidence.session.runtime, null);
  const runner = new MockCodexRunner();
  const manager = new AutoGenerationManager({ jsonRunner: runner,
    evaluator: () => ({ status: 'REJECTED' }) });
  const session = createAutoAuthorSession();
  manager.start(session, { networkId: 'network-a', difficulty: 1 });
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'FAILED'); assert.equal(session.auto.failure.code,
    'EVALUATION_REJECTED'); assert.equal(session.runtime, null);
});

test('Evidenceの非JSON出力はfeedback付き別Invocationで1回修正する', async () => {
  const { runner, view } = await generated({ malformedEvidenceOutput: 1 });
  assert.equal(view.currentState, 'READY'); assert.equal(runner.evidenceCalls, 2);
  const repair = runner.calls.filter(item => item.phase === 'GENERATING_EVIDENCE')[1];
  assert.equal(repair.feedback.classification, 'REPAIRABLE_BLOCKED');
  assert.equal(repair.feedback.errors[0].code, 'MALFORMED_CODEX_JSON');
});

test('REPAIRABLE_BLOCKEDとHARD_BLOCKEDを機械可読codeで分類する', () => {
  assert.equal(classifyBlocked([{ code: 'MISSING_FIELD' },
    { code: 'BROKEN_REFERENCE' }]), 'REPAIRABLE_BLOCKED');
  assert.equal(classifyBlocked([{ code: 'INTERNAL_STATE_CORRUPTION' }]), 'HARD_BLOCKED');
});

test('generation lockは同一Server相当Managerで並行生成を拒否する', async () => {
  const runner = new MockCodexRunner({ waitForCancel: true });
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const first = createAutoAuthorSession(); const second = createAutoAuthorSession();
  manager.start(first, { networkId: 'network-a', difficulty: 1 });
  assert.throws(() => manager.start(second, { networkId: 'network-b', difficulty: 2 }),
    error => error.code === 'GENERATION_LOCKED');
  manager.cancel(first); await manager.waitForIdle();
});

test('cancellationは実行中Invocationを停止しpartial resultを公開しない', async () => {
  const runner = new MockCodexRunner({ waitForCancel: true });
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.start(session, { networkId: 'network-a', difficulty: 1 });
  await new Promise(resolve => setImmediate(resolve)); manager.cancel(session);
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'CANCELLED'); assert.equal(session.runtime, null);
  assert.equal(autoAuthorView(session).playUrl, null);
});

test('timeoutは無限retryせずFAILEDにする', async () => {
  const { runner, view } = await generated({ timeout: true });
  assert.equal(view.currentState, 'FAILED'); assert.equal(view.failure.code, 'CODEX_TIMEOUT');
  assert.equal(runner.calls.filter(item => item.kind === 'invocation').length, 1);
});

test('Prompt Injection文字列はJSON data境界に留まり実行対象にならない', async () => {
  const { runner, view } = await generated(); assert.equal(view.currentState, 'READY');
  const calls = JSON.stringify(runner.calls);
  assert.doesNotMatch(calls, /shell:\s*true/);
  const source = await readFile(new URL('../server/codex/codex-json-runner.js', import.meta.url), 'utf8');
  assert.match(source, /UNTRUSTED_INPUT_DATA/); assert.match(source, /未信頼データ/);
  assert.doesNotMatch(source, /exec\(|eval\(|new Function/);
});

test('Author UIはPrompt・JSON Import・MANUAL切替を持たない', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../public/author.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/author.js', import.meta.url), 'utf8')]);
  assert.match(html, /ゲームを生成/); assert.match(html, /network-list/);
  assert.match(html, /difficulty-list/); assert.match(html, /生成を中止/);
  assert.doesNotMatch(html, /textarea|Import|Prompt|MANUAL|Developer Mode|Game Progression/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
});
