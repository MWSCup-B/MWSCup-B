import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AutoGenerationManager, autoAuthorBootstrap, autoAuthorView,
  buildMakotomaruOutputSchema, classifyBlocked, createAutoAuthorSession }
  from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { CodexOutputSchemaError } from '../server/codex/codex-errors.js';
import { CodexError, CodexTimeoutError } from '../server/codex/codex-errors.js';

async function generated(options = {}, selection = { networkId: 'network-c', difficulty: 3 },
  maxAttempts = 3) {
  const runner = new MockCodexRunner(options);
  const manager = new AutoGenerationManager({ jsonRunner: runner, maxAttempts });
  const session = createAutoAuthorSession(); manager.start(session, selection);
  await manager.waitForIdle(); return { runner, manager, session, view: autoAuthorView(session) };
}

test('Scenario Builder bootstrapは2 Mode・実装済みAttack・Difficulty 1-3を公開する', () => {
  const value = autoAuthorBootstrap();
  assert.deepEqual(value.modes.map(item => item.id), ['MANUAL', 'MAKOTOMARU']);
  assert.deepEqual(value.attacks.map(item => item.id).sort(),
    ['clickfix', 'credential_phishing', 'password_spray', 'phishing', 'ransomware',
      'reflected_xss', 'sql_injection', 'stored_xss', 'unauthorized_login', 'unrestricted_file_upload']);
  assert.deepEqual(value.manualAttackChoices.map(item => item.id), ['phishing', 'stored_xss', 'unauthorized_login']);
  assert.equal(value.manualAttackPresets.length, 7);
  assert.deepEqual(value.difficulties.map(item => item.difficulty), [1, 2, 3]);
  assert.ok(value.defaultNetwork.nodes.length > 0);
});

test('XSS + Network C + ★3をReview修正後にGAME READYまで自動実行する', async () => {
  const { runner, session, view } = await generated({
    reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'] });
  assert.equal(view.currentState, 'READY'); assert.ok(session.runtime);
  assert.equal(session.runtime.mode, 'GENERATED');
  assert.equal(session.configuration.evidenceCount, 3);
  assert.equal(session.gameCaseResult.status, 'READY');
  assert.equal(session.gameMakeResult.status, 'BUILT');
  assert.equal(session.evaluationResult.status, 'ACCEPTED');
  assert.equal(runner.scenarioCalls, 1); assert.equal(runner.reviewCalls, 2);
  assert.equal(runner.evidenceCalls, 1);
  assert.equal(session.scenarioImportResult.status, 'VALID');
  assert.equal(session.evidenceImportResult.status, 'VALID');
  assert.deepEqual([...new Set(runner.calls.filter(item => item.kind === 'invocation')
    .map(item => item.outputSchemaName))].sort(),
  ['evidence-generation-draft', 'scenario-revision', 'scenario-verification-review']);
  assert.ok(runner.calls.filter(item => item.kind === 'invocation')
    .every(item => item.hasOutputSchema));
  assert.ok(view.progress.every(item => item.status === 'COMPLETE'
    || item.id === 'revision'));
  const reviews = runner.calls.filter(item => item.phase === 'REVIEWING_SCENARIO');
  assert.equal(reviews.length, 2);
  assert.notStrictEqual(reviews[0].data, reviews[1].data);
});

test('Review後のScenario修正版がSchema違反ならfeedback付きで上限まで再生成する', async () => {
  const { runner, view } = await generated({ malformedScenario: true,
    reviewOutcomes: ['NEEDS_REVISION'] });
  assert.equal(view.currentState, 'FAILED');
  assert.equal(view.failure.code, 'MAX_REVISION_EXCEEDED');
  assert.equal(runner.scenarioCalls, 2);
  assert.ok(runner.calls.filter(item => item.phase === 'REVISING_SCENARIO')
    .some(item => item.feedback.classification === 'REPAIRABLE_BLOCKED'));
});

test('Review後のScenario非JSON出力をREPAIRABLE_BLOCKEDとして次Invocationで修正する', async () => {
  const { runner, view } = await generated({ malformedScenarioOutput: 1,
    reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'] });
  assert.equal(view.currentState, 'READY'); assert.equal(runner.scenarioCalls, 2);
  const revision = runner.calls.filter(item => item.phase === 'REVISING_SCENARIO')
    .find(item => item.feedback.classification === 'REPAIRABLE_BLOCKED');
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
    phase: 'REVIEWING_SCENARIO', attempt: 1,
    code: 'CODEX_OUTPUT_SCHEMA_INVALID', errorCode: 'CODEX_OUTPUT_SCHEMA_INVALID',
    field: 'generation', schemaName: 'scenario-import-package',
    cliErrorCode: 'invalid_json_schema', cliErrorClass: 'output_schema',
    exitCode: null, httpStatus: null, retryable: false,
    receivedType: null, length: null, expectedMinLength: null,
    expectedMaxLength: null, expectedPattern: null, expectedFormat: null,
    reason: 'schemaVersion requires explicit type',
    correctionHint: '入力条件を変えずに、もう一度生成してください。',
  });
});

test('真実丸のusage limitは専用分類と最小Developer Detailで停止する', async () => {
  const jsonRunner = {
    checkAvailability: async () => ({ available: true, version: 'codex-cli test' }),
    runJson: async ({ phase }) => { throw new CodexError('CODEX_USAGE_LIMIT_REACHED',
      'Codexの利用上限に達しています。', { phase, retryable: true, exitCode: 1,
        httpStatus: 429, cliErrorClass: 'usage_limit' }); },
  };
  const manager = new AutoGenerationManager({ jsonRunner });
  const session = createAutoAuthorSession();
  manager.startMakotomaru(session, { schemaVersion: '1.0', difficulty: 1,
    attackCategory: 'ANY', complexity: 'STANDARD' });
  await manager.waitForIdle(); const view = autoAuthorView(session);
  assert.equal(view.currentState, 'FAILED');
  assert.equal(view.failure.code, 'CODEX_USAGE_LIMIT_REACHED');
  assert.match(view.failure.message, /利用上限/);
  assert.deepEqual(view.developerDetails[0], {
    phase: 'MAKOTOMARU_CONFIGURATION',
    code: 'CODEX_USAGE_LIMIT_REACHED', errorCode: 'CODEX_USAGE_LIMIT_REACHED',
    httpStatus: 429, retryable: true,
  });
});

test('真実丸入力は技術成立性を保持しreference等の不要fieldを除外する', async () => {
  const runner = new MockCodexRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.startMakotomaru(session, { schemaVersion: '1.0', difficulty: 1,
    attackCategory: 'ANY', complexity: 'STANDARD' });
  await manager.waitForIdle();
  const data = runner.calls.find(item => item.phase === 'MAKOTOMARU_CONFIGURATION').data;
  assert.ok(data.allowedAttacks.every(item => item.requiredServices.length
    && item.requiredReachability.length && item.observableArtifacts.length));
  assert.ok(data.allowedAttacks.every(item => !Object.hasOwn(item, 'references')
    && !Object.hasOwn(item, 'relatedAttackPatterns')));
  assert.ok(data.networkTemplate.nodes.every(item => Array.isArray(item.roles)
    && Array.isArray(item.logSources)));
});

test('真実丸Structured Output Schemaは要求値とcanonical ID/effectへ制約する', () => {
  const schema = buildMakotomaruOutputSchema({ difficulty: 1 });
  const configuration = schema.properties.configuration.properties;
  const attack = configuration.attacks.items.properties;
  assert.deepEqual(configuration.mode, { const: 'MAKOTOMARU' });
  assert.deepEqual(configuration.difficulty, { const: 1 });
  assert.deepEqual(configuration.evidenceCount, { const: 1 });
  assert.deepEqual([...attack.attackId.enum].sort(), ['phishing', 'reflected_xss', 'sql_injection'],
    '詳細設定専用の新しい設備を必要とする攻撃を真実丸の既定Networkへ混入させない');
  assert.ok(attack.sourceNodeId.enum.includes('client-host'));
  assert.ok(attack.targetServiceId.enum.includes('web-service'));
  assert.ok(attack.expectedEffect.enum.every(value => value.length > 20));
  assert.equal(attack.expectedEffect.enum.length, 3);
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

for (const status of ['BLOCKED', 'NEEDS_REVISION']) {
  test(`Evaluation ${status}は個別code・target・理由・修正案を公開し、READYにしない`, async () => {
    const issues = [{ code: 'INVESTIGATION_DISCLOSURE_FAILED', category: 'INVESTIGATION_DISCLOSURE',
      target: 'generated-game.investigation-view', reason: '未発見Evidenceが公開されています。',
      correctionHint: '調査先の公開表示から未発見資料のタイトルを除いてください。',
      sourceRefs: ['internal-ground-must-not-be-exposed'] },
    { code: 'NORMAL_PLAYTHROUGH_FAILED', category: 'NORMAL_PLAYTHROUGH',
      target: 'generated-game.normal-path', reason: '通常操作でACQUITTEDへ到達できません。',
      correctionHint: 'Game ProgressionとBackend actionの接続を修正してください。',
      sourceRefs: ['phase9:runtime'] }];
    const runner = new MockCodexRunner();
    let evaluationCalls = 0;
    const manager = new AutoGenerationManager({ jsonRunner: runner,
      evaluator: () => { evaluationCalls += 1; return { status, issues }; } });
    const session = createAutoAuthorSession();
    const configuration = autoAuthorBootstrap().defaultManualConfiguration;
    const originalConfiguration = structuredClone(configuration);
    manager.submitManual(session, configuration); await manager.waitForIdle();
    assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
    manager.approve(session); await manager.waitForIdle();
    const view = autoAuthorView(session);
    assert.equal(view.currentState, 'FAILED');
    assert.equal(view.failure.code, 'EVALUATION_REJECTED');
    assert.match(view.failure.message, /Developer Detail/);
    assert.equal(view.playUrl, null); assert.equal(session.runtime, null);
    assert.equal(evaluationCalls, 1); assert.equal(runner.evidenceCalls, 1);
    assert.deepEqual(session.configuration, originalConfiguration);
    for (const issue of issues) {
      const detail = view.developerDetails.find(item => item.code === issue.code);
      assert.ok(detail);
      assert.equal(detail.phase, 'EVALUATING'); assert.equal(detail.attempt, 1);
      assert.equal(detail.field, issue.target); assert.equal(detail.reason, issue.reason);
      assert.equal(detail.correctionHint, issue.correctionHint); assert.equal(detail.retryable, false);
      assert.equal(Object.hasOwn(detail, 'sourceRefs'), false);
    }
    const summary = view.developerDetails.find(item => item.code === 'EVALUATION_REJECTED');
    assert.match(summary.correctionHint, /個別の評価エラー/);
    assert.doesNotMatch(summary.correctionHint, /もう一度生成/);
    assert.ok(!JSON.stringify(view).includes('internal-ground-must-not-be-exposed'));
    assert.equal(view.progress.find(item => item.id === 'evaluation').status, 'FAILED');
  });
}

test('Evidenceの非JSON出力はfeedback付き別Invocationで1回修正する', async () => {
  const { runner, view } = await generated({ malformedEvidenceOutput: 1 });
  assert.equal(view.currentState, 'READY'); assert.equal(runner.evidenceCalls, 2);
  const repair = runner.calls.filter(item => item.phase === 'GENERATING_EVIDENCE')[1];
  assert.equal(repair.feedback.classification, 'REPAIRABLE_BLOCKED');
  assert.equal(repair.feedback.errors[0].code, 'MALFORMED_CODEX_JSON');
});

test('Evidence draftにAIがintegrityを付けた場合はfield付きで差し戻してから再生成する', async () => {
  const runner = new MockCodexRunner();
  const runJson = runner.runJson.bind(runner);
  runner.runJson = async args => {
    const draft = await runJson(args);
    if (args.phase === 'GENERATING_EVIDENCE' && runner.evidenceCalls === 1) {
      draft.evidenceArtifacts[0].integrity = { algorithm: 'SHA-256', publicContentDigest: '0'.repeat(64) };
    }
    return draft;
  };
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.start(session, { networkId: 'network-a', difficulty: 1 });
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY');
  assert.equal(runner.evidenceCalls, 2);
  const repair = runner.calls.filter(item => item.phase === 'GENERATING_EVIDENCE')[1];
  assert.equal(repair.feedback.errors[0].code, 'UNKNOWN_FIELD');
  assert.equal(repair.feedback.errors[0].field, 'evidence-generation-draft.evidenceArtifacts[0].integrity');
  assert.equal(session.evidenceImportResult.status, 'VALID');
});

test('REPAIRABLE_BLOCKEDとHARD_BLOCKEDを機械可読codeで分類する', () => {
  assert.equal(classifyBlocked([{ code: 'MISSING_FIELD' },
    { code: 'BROKEN_REFERENCE' }]), 'REPAIRABLE_BLOCKED');
  assert.equal(classifyBlocked([{ code: 'CONTRADICTION_GROUND_MISMATCH' }]), 'REPAIRABLE_BLOCKED');
  assert.equal(classifyBlocked([{ code: 'CONTRADICTION_GROUND_MISMATCH' },
    { code: 'EVIDENCE_GROUND_MISMATCH' }]), 'REPAIRABLE_BLOCKED');
  assert.equal(classifyBlocked([{ code: 'UNRECOGNIZED_GROUND_MISMATCH' }]), 'HARD_BLOCKED');
  assert.equal(classifyBlocked([{ code: 'CONTRADICTION_GROUND_MISMATCH' },
    { code: 'INTERNAL_STATE_CORRUPTION' }]), 'HARD_BLOCKED');
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

test('承認後のEvidence timeoutは安全な数値診断を表示し、入力を変えず再試行・Buildを停止する', async () => {
  const runner = new MockCodexRunner();
  const runJson = runner.runJson.bind(runner);
  let evidenceCalls = 0;
  runner.runJson = async args => {
    if (args.phase !== 'GENERATING_EVIDENCE') return runJson(args);
    evidenceCalls += 1;
    const error = new CodexTimeoutError(args.phase, { timeoutMs: 600000, elapsedMs: 600023,
      promptBytes: 150000, stdoutBytes: 0, stderrBytes: 400, exitCode: null, terminationSignal: 'SIGTERM' });
    error.stderr = 'private-cli-text'; error.prompt = 'private-input-text';
    throw error;
  };
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.submitManual(session, autoAuthorBootstrap().defaultManualConfiguration);
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  const configuration = structuredClone(session.configuration);
  const scenarioPackage = structuredClone(session.scenarioPackage);
  manager.approve(session); await manager.waitForIdle();
  const view = autoAuthorView(session);
  assert.equal(view.currentState, 'FAILED'); assert.equal(view.failure.code, 'CODEX_TIMEOUT');
  assert.equal(evidenceCalls, 1); assert.equal(view.canCancel, false);
  assert.equal(session.evidenceImportResult, null); assert.equal(session.runtime, null);
  assert.equal(session.evaluationResult, null); assert.equal(view.playUrl, null);
  assert.equal(session.verificationResult.status, 'VERIFIED');
  assert.deepEqual(session.configuration, configuration); assert.deepEqual(session.scenarioPackage, scenarioPackage);
  const detail = view.developerDetails.find(item => item.code === 'CODEX_TIMEOUT');
  assert.equal(detail.phase, 'GENERATING_EVIDENCE'); assert.equal(detail.cliErrorClass, 'execution_timeout');
  assert.equal(detail.retryable, false); assert.equal(detail.timeoutMs, 600000);
  assert.equal(detail.elapsedMs, 600023); assert.equal(detail.promptBytes, 150000);
  assert.equal(detail.stdoutBytes, 0); assert.equal(detail.stderrBytes, 400);
  assert.equal(detail.terminationSignal, 'SIGTERM'); assert.equal(detail.httpStatus, null);
  assert.match(detail.correctionHint, /CODEX_EVIDENCE_TIMEOUT_MS/);
  assert.match(detail.correctionHint, /自動再試行は行いません/);
  assert.doesNotMatch(JSON.stringify(view), /private-cli-text|private-input-text/);
});

test('Prompt Injection文字列はJSON data境界に留まり実行対象にならない', async () => {
  const { runner, view } = await generated(); assert.equal(view.currentState, 'READY');
  const calls = JSON.stringify(runner.calls);
  assert.doesNotMatch(calls, /shell:\s*true/);
  const source = await readFile(new URL('../server/codex/codex-json-runner.js', import.meta.url), 'utf8');
  assert.match(source, /UNTRUSTED_INPUT_DATA/); assert.match(source, /未信頼データ/);
  assert.doesNotMatch(source, /exec\(|eval\(|new Function/);
});

test('Author UIは攻撃・舞台の2項目とPreview承認を提供し、技術設定を手入力させない', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../public/author.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/author.js', import.meta.url), 'utf8')]);
  assert.match(html, /攻撃と舞台/); assert.match(html, /この事件でゲームを作成/);
  assert.match(html, /自動設定したネットワーク/); assert.match(html, /事件案を確認/);
  assert.doesNotMatch(html, /textarea|JSON Import|Prompt|Developer Mode/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
  assert.match(source, /author\.canCancel/);
  assert.match(source, /validateBootstrap\(value\.bootstrap\)/);
  assert.match(source, /bootstrap\.attackChoices/);
  assert.match(source, /\/api\/author\/selection/);
  assert.doesNotMatch(html, /id="(?:manual-difficulty|incident-date|add-node|choose-makotomaru)"/);
  assert.doesNotMatch(source, /\[value="reflected_xss"\].*checked = true/);
});
