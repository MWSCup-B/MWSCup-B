import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { authorBootstrap, buildAuthorGame, createAuthorSession, importAuthorEvidence,
  importAuthorReview, importAuthorScenario, prepareEvidence, prepareScenario }
  from '../server/author-service.js';
import { verifiedScenarioFixture, semanticReview } from './helpers/verified-scenario.js';
import { phase7Fixture } from './helpers/phase7-evidence.js';

function prepared() {
  const fixture = verifiedScenarioFixture();
  const technical = fixture.generationInput.technicalInput;
  const session = createAuthorSession();
  const view = prepareScenario(session, { selectedAttackIds: fixture.generationInput.selectedAttackIds,
    network: technical.network, scenarioContext: technical.scenarioContext });
  const option = view.scenarioOptions.find(item =>
    item.generationInputId === fixture.generationInput.generationInputId);
  assert.ok(option);
  return { session, fixture: verifiedScenarioFixture(option.generationInput), option };
}

function verified() {
  const value = prepared();
  importAuthorScenario(value.session, { optionId: value.option.optionId,
    scenarioPackage: value.fixture.scenarioPackage });
  const review = semanticReview(value.session.verificationInput);
  const view = importAuthorReview(value.session, review);
  assert.equal(view.verificationResult.status, 'VERIFIED');
  return value;
}

function evidenceReady() {
  const value = verified();
  prepareEvidence(value.session);
  const evidence = phase7Fixture(value.fixture);
  const view = importAuthorEvidence(value.session, evidence.evidencePackage);
  assert.equal(view.evidenceImportResult.status, 'VALID');
  return { ...value, evidence };
}

function planDraft(session) {
  const set = session.evidenceImportResult.evidenceSet;
  return { schemaVersion: '1.0', scenarioId: set.scenarioId,
    evidenceSetId: set.evidenceSetId, attackGraphRef: structuredClone(set.attackGraphRef),
    initialCourtEvidenceIds: ['evidence_technical_b'],
    initialCourtStatementIds: ['statement_seen_operation'],
    investigationEvidenceIds: ['evidence_technical_a', 'evidence_technical_b',
      'evidence_testimony'],
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
}

test('Author bootstrapはAttack Catalogと編集可能なNetwork/Context例を返す', () => {
  const value = authorBootstrap();
  assert.deepEqual(value.attacks.map(item => item.id).sort(),
    ['phishing', 'reflected_xss', 'sql_injection']);
  assert.equal(value.examples.network.schemaVersion, '1.0');
  assert.equal(value.examples.scenarioContext.schemaVersion, '1.0');
});

test('攻撃0件・4件・未登録IDをBackendで拒否する', () => {
  const base = verifiedScenarioFixture().generationInput.technicalInput;
  for (const selectedAttackIds of [[], ['phishing', 'reflected_xss', 'sql_injection', 'other'],
    ['missing_attack']]) {
    const session = createAuthorSession();
    const view = prepareScenario(session, { selectedAttackIds,
      network: base.network, scenarioContext: base.scenarioContext });
    assert.notEqual(view.stage, 'SCENARIO_GENERATION');
    assert.ok(view.issues.length);
  }
});

test('NetworkとScenario ContextのSchema違反を制作Validationへ返す', () => {
  const base = verifiedScenarioFixture().generationInput.technicalInput;
  for (const [network, scenarioContext] of [[{ schemaVersion: '1.0' }, base.scenarioContext],
    [base.network, { schemaVersion: '1.0' }]]) {
    const view = prepareScenario(createAuthorSession(), { selectedAttackIds: ['phishing'],
      network, scenarioContext });
    assert.equal(view.currentState, 'BLOCKED');
    assert.ok(view.issues[0].code);
    assert.ok(view.issues[0].field);
    assert.ok(view.issues[0].reason);
    assert.ok(view.issues[0].correctionHint);
  }
});

test('不成立攻撃組合せではScenario Prompt/Inputを生成しない', () => {
  const fixture = verifiedScenarioFixture();
  const technical = fixture.generationInput.technicalInput;
  const context = structuredClone(technical.scenarioContext);
  context.requiredUserActions = [];
  const view = prepareScenario(createAuthorSession(), {
    selectedAttackIds: ['phishing'], network: technical.network, scenarioContext: context });
  assert.equal(view.currentState, 'BLOCKED');
  assert.equal(view.scenarioPrompt, null);
  assert.deepEqual(view.scenarioOptions, []);
});

test('成立候補ごとにScenario Generation InputとPromptを生成する', () => {
  const { session } = prepared();
  const view = session.scenarioOptions;
  assert.ok(view.length >= 1);
  assert.ok(view.every(item => item.generationInput.generatorMode === 'EXTERNAL_USER_CODEX'));
  assert.match(authorBootstrap().attacks[0].id, /^[a-z]/);
});

test('Scenario JSONをImportし不正JSON構造をINVALIDにする', () => {
  const { session, fixture, option } = prepared();
  let view = importAuthorScenario(session, { optionId: option.optionId,
    scenarioPackage: fixture.scenarioPackage });
  assert.equal(view.scenarioImportResult.status, 'VALID');
  assert.ok(view.verificationInput);
  view = importAuthorScenario(session, { optionId: option.optionId,
    scenarioPackage: { schemaVersion: '1.0' } });
  assert.equal(view.scenarioImportResult.status, 'INVALID');
});

test('Independent Reviewなし・失敗ReviewではEvidence工程へ進めない', () => {
  const { session, fixture, option } = prepared();
  importAuthorScenario(session, { optionId: option.optionId,
    scenarioPackage: fixture.scenarioPackage });
  assert.equal(prepareEvidence(session).evidenceGenerationInput, null);
  const review = semanticReview(session.verificationInput);
  review.checks[0].outcome = 'FAIL'; review.checks[0].reason = '意味的不一致';
  review.checks[0].correctionHint = 'Scenarioを修正する。';
  const view = importAuthorReview(session, review);
  assert.equal(view.verificationResult.status, 'NEEDS_REVISION');
  assert.equal(view.evidenceGenerationInput, null);
});

test('VERIFIED時だけProvider非依存Evidence Inputを生成する', () => {
  const { session } = verified();
  const view = prepareEvidence(session);
  assert.equal(view.evidenceGenerationInput.status, 'READY');
  assert.equal(view.evidenceGenerationInput.generatorMode, 'EXTERNAL_USER_CODEX');
  assert.ok(view.evidencePrompt);
});

test('Evidence JSONの正常Importと不正Importを区別する', () => {
  const { session } = verified(); prepareEvidence(session);
  let view = importAuthorEvidence(session, { schemaVersion: '1.0' });
  assert.equal(view.evidenceImportResult.status, 'INVALID');
  const fixture = phase7Fixture(verifiedScenarioFixture(session.selectedOption.generationInput));
  view = importAuthorEvidence(session, fixture.evidencePackage);
  assert.equal(view.evidenceImportResult.status, 'VALID');
  assert.ok(view.progressionReferences.evidence.length);
  assert.ok(view.progressionReferences.statements.length);
});

test('VALID Evidenceと明示PlanからACCEPTEDまでBuildする', () => {
  const { session } = evidenceReady();
  const view = buildAuthorGame(session, planDraft(session));
  assert.equal(view.gameCaseStatus, 'READY');
  assert.equal(view.gameMakeStatus, 'BUILT');
  assert.equal(view.evaluationResult.status, 'ACCEPTED');
  assert.equal(view.orchestrator.currentState, 'ACCEPTED');
  assert.ok(session.runtime);
});

test('PlanのID不整合・maxCourtAttempts未指定とINVALID EvidenceからBuildできない', () => {
  const noEvidence = createAuthorSession();
  assert.equal(buildAuthorGame(noEvidence, {}).currentState, 'BLOCKED');
  const { session } = evidenceReady();
  const missingLimit = planDraft(session); missingLimit.retryPolicy.maxCourtAttempts = null;
  assert.equal(buildAuthorGame(session, missingLimit).currentState, 'BLOCKED');
  const { session: other } = evidenceReady();
  const missingId = planDraft(other); missingId.initialCourtEvidenceIds = ['missing_evidence'];
  const invalidReference = buildAuthorGame(other, missingId);
  assert.equal(invalidReference.currentState, 'BLOCKED');
  assert.ok(invalidReference.issues.length);
});

test('制作UIはCatalog動的描画・file読込・textContent安全描画を使用する', async () => {
  const [source, service] = await Promise.all([
    readFile(new URL('../public/author.js', import.meta.url), 'utf8'),
    readFile(new URL('../server/author-service.js', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /bootstrap\.attacks/);
  assert.match(source, /file\.text\(\)/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
  assert.doesNotMatch(source, /phishing|reflected_xss|sql_injection/);
  assert.doesNotMatch(service, /fetch\(|https\.request|api\.openai|OPENAI_API_KEY/);
});
