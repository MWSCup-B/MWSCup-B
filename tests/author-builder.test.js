import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameProgressionPlan } from '../server/generation/game-case-converter.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';
import { WIZARD_STEPS, createProgressionBuilder, maxReachableStep, moveWizard,
  nextRuleId, nextTargetId, objectionCandidates, progressionDraft, removeRule,
  removeTarget, upsertRule, upsertTarget, validateProgressionBuilder,
  wizardCompletion } from '../public/author-builder.js';

function fixtureReferences(fixture) {
  const characters = new Map(fixture.scenarioPackage.characters.characters
    .map(item => [item.characterId, item.displayName]));
  return {
    evidence: fixture.evidenceSet.evidenceArtifacts.map(item => ({ evidenceId: item.evidenceId,
      type: item.type, title: item.title, visibility: item.visibility,
      purpose: item.purpose, publicContent: item.publicContent })),
    statements: fixture.evidenceSet.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')
      .flatMap(item => item.testimony.statements.map(statement => ({
        testimonyEvidenceId: item.evidenceId, statementId: statement.statementId,
        witnessCharacterId: item.testimony.witnessCharacterId,
        speakerDisplayName: characters.get(item.testimony.witnessCharacterId),
        spokenContent: statement.spokenContent }))),
    investigationSourceNodes: fixture.generationInput.technicalInput.network.nodes.map(item => ({
      sourceType: 'NETWORK_NODE', sourceId: item.id })),
    contradictions: fixture.contradictions,
    exonerations: fixture.exonerations,
  };
}

test('Wizardは完了工程だけ前進でき、後退と到達済み工程への移動ができる', () => {
  const author = { scenarioOptions: [{}], scenarioImportResult: { status: 'VALID' },
    verificationResult: { status: 'VERIFIED' }, evidenceGenerationInput: { status: 'READY' },
    evidenceImportResult: { status: 'VALID' }, currentState: 'EVIDENCE_READY' };
  const completion = wizardCompletion(author, { progressionValid: false });
  assert.equal(WIZARD_STEPS.length, 8);
  assert.equal(maxReachableStep(completion), 6);
  assert.equal(moveWizard(5, 'next', completion), 6);
  assert.equal(moveWizard(6, 'next', completion), 6);
  assert.equal(moveWizard(6, 'back', completion), 5);
  assert.equal(moveWizard(2, 7, completion), 2);
  assert.equal(wizardCompletion(author, { upstreamDirty: true })[0], false);
  assert.equal(wizardCompletion({ ...author, evidenceGenerationInput: null })[3], false);
});

test('既存PlanからBuilder状態を作りSchema準拠Planを自動生成する', () => {
  const fixture = readyGameCaseFixture();
  const builder = createProgressionBuilder(fixture.progressionPlan);
  const validation = validateProgressionBuilder(builder, fixtureReferences(fixture));
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const draft = progressionDraft(builder);
  assert.equal(Object.hasOwn(draft, 'planId'), false);
  const generated = buildGameProgressionPlan(draft);
  assert.match(generated.planId, /^progression_/);
  assert.match(generated.fingerprint, /^[a-f0-9]{64}$/);
});

test('Evidence・Statement・Target source・8 Actionの候補は既存成果物だけから得る', () => {
  const fixture = readyGameCaseFixture(); const refs = fixtureReferences(fixture);
  const builder = createProgressionBuilder(fixture.progressionPlan);
  assert.deepEqual(refs.evidence.map(item => item.evidenceId).sort(),
    fixture.evidenceSet.evidenceArtifacts.map(item => item.evidenceId).sort());
  assert.ok(refs.statements.every(item => item.testimonyEvidenceId && item.speakerDisplayName));
  assert.deepEqual(refs.investigationSourceNodes.map(item => item.sourceId).sort(),
    fixture.generationInput.technicalInput.network.nodes.map(item => item.id).sort());
  assert.equal(builder.investigationActions.length, 8);
  assert.deepEqual(new Set(builder.investigationActions.map(item => item.actionType)).size, 8);
});

test('Initial Court・Retrial Court・Retry PolicyのGUI状態を既存fieldへそのまま写す', () => {
  const fixture = readyGameCaseFixture(); const builder = createProgressionBuilder(fixture.progressionPlan);
  builder.initialCourtEvidenceIds = ['evidence_technical_a'];
  builder.initialCourtStatementIds = ['statement_checked_time'];
  builder.retrialStatementIds = ['statement_seen_operation'];
  builder.retryPolicy.maxCourtAttempts = 5;
  const draft = progressionDraft(builder);
  assert.deepEqual(draft.initialCourtEvidenceIds, ['evidence_technical_a']);
  assert.deepEqual(draft.initialCourtStatementIds, ['statement_checked_time']);
  assert.deepEqual(draft.retrialStatementIds, ['statement_seen_operation']);
  assert.deepEqual(draft.retryPolicy, { maxCourtAttempts: 5,
    onFailure: 'RETURN_TO_INVESTIGATION', onLimitReached: 'BLOCKED' });
});

test('maxCourtAttemptsは1以上の安全な整数だけをBuilderで受け付ける', () => {
  const fixture = readyGameCaseFixture(); const refs = fixtureReferences(fixture);
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const builder = createProgressionBuilder(fixture.progressionPlan);
    builder.retryPolicy.maxCourtAttempts = value;
    assert.ok(validateProgressionBuilder(builder, refs).errors
      .some(item => item.code === 'INVALID_RETRY_LIMIT'));
  }
});

test('Target Typeで許可されないActionと存在しない選択IDを拒否する', () => {
  const fixture = readyGameCaseFixture(); const refs = fixtureReferences(fixture);
  const builder = createProgressionBuilder(fixture.progressionPlan);
  builder.investigationTargets[0].availableActionIds = ['action_check_email'];
  builder.initialCourtEvidenceIds = ['missing_evidence'];
  const validation = validateProgressionBuilder(builder, refs);
  assert.ok(validation.errors.some(item => item.code === 'INVALID_TARGET_ACTION'));
  assert.ok(validation.errors.some(item => item.code === 'INVALID_EVIDENCE_ID'));
});

test('Retrial外StatementのObjectionと未発見の法廷必須Evidenceを事前警告する', () => {
  const fixture = readyGameCaseFixture(); const refs = fixtureReferences(fixture);
  const builder = createProgressionBuilder(fixture.progressionPlan);
  builder.retrialStatementIds = ['statement_checked_time'];
  builder.evidenceDiscoveryRules = builder.evidenceDiscoveryRules
    .filter(item => item.evidenceId !== 'evidence_technical_a');
  const validation = validateProgressionBuilder(builder, refs);
  assert.ok(validation.errors.some(item => item.code === 'OBJECTION_STATEMENT_NOT_RETRIAL'));
  assert.ok(validation.errors.some(item => item.code === 'REQUIRED_EVIDENCE_RULE_MISSING'));
});

test('Target作成・編集・削除と安全なID生成を純粋状態操作で行う', () => {
  const fixture = readyGameCaseFixture(); let builder = createProgressionBuilder(fixture.progressionPlan);
  const id = nextTargetId('MAILBOX', builder.investigationTargets.map(item => item.targetId));
  assert.equal(id, 'target_mailbox_001');
  builder = upsertTarget(builder, { schemaVersion: '1.0', targetId: id,
    targetType: 'MAILBOX', displayName: 'メールボックス', description: '合成メールです。',
    sourceNodeRef: { sourceType: 'NETWORK_NODE', sourceId: 'client-host' },
    availableActionIds: ['action_check_email'], initiallyAvailable: false });
  assert.ok(builder.investigationTargets.some(item => item.targetId === id));
  builder = upsertTarget(builder, { ...builder.investigationTargets.find(item => item.targetId === id),
    displayName: '社員メールボックス' }, id);
  assert.equal(builder.investigationTargets.find(item => item.targetId === id).displayName,
    '社員メールボックス');
  builder = removeTarget(builder, id);
  assert.ok(!builder.investigationTargets.some(item => item.targetId === id));
});

test('Discovery Ruleを追加・編集・削除しprerequisiteとUnlockを保持する', () => {
  const fixture = readyGameCaseFixture(); let builder = createProgressionBuilder(fixture.progressionPlan);
  const ruleId = nextRuleId(builder.evidenceDiscoveryRules.map(item => item.ruleId));
  const rule = { schemaVersion: '1.0', ruleId, evidenceId: 'evidence_technical_a',
    targetId: 'target_web_server', actionId: 'action_check_configuration',
    prerequisites: { requiredEvidenceIds: ['evidence_testimony'],
      requiredCompletedActionIds: ['completed_target_web_server__action_audit_log'] },
    discoveryResult: { publicMessage: '設定を確認しました。', discovered: true,
      unlockedTargetIds: ['target_client_endpoint'], nextHints: ['端末も確認できます。'] },
    repeatable: false };
  builder = upsertRule(builder, rule);
  assert.deepEqual(builder.evidenceDiscoveryRules.at(-1).prerequisites.requiredEvidenceIds,
    ['evidence_testimony']);
  builder = upsertRule(builder, { ...rule, repeatable: true }, ruleId);
  assert.equal(builder.evidenceDiscoveryRules.find(item => item.ruleId === ruleId).repeatable, true);
  builder = removeRule(builder, ruleId);
  assert.ok(!builder.evidenceDiscoveryRules.some(item => item.ruleId === ruleId));
});

test('Objection候補は既存Contradiction／Exonerationだけから導出する', () => {
  const fixture = readyGameCaseFixture(); const values = objectionCandidates(fixtureReferences(fixture));
  assert.ok(values.length > 0);
  assert.equal(values[0].targetStatementId, 'statement_seen_operation');
  assert.deepEqual(values[0].acceptedEvidenceIds, ['evidence_technical_a']);
  assert.equal(values[0].matchMode, 'ANY_PRESENTED');
});

test('未設定Discovery Rule、不正ID、到達不能TargetをBuilder上で警告する', () => {
  const fixture = readyGameCaseFixture(); const refs = fixtureReferences(fixture);
  let builder = createProgressionBuilder(fixture.progressionPlan);
  builder = removeRule(builder, 'discovery_technical_a');
  let validation = validateProgressionBuilder(builder, refs);
  assert.ok(validation.errors.some(item => item.code === 'MISSING_DISCOVERY_RULE'));
  builder = createProgressionBuilder(fixture.progressionPlan);
  builder.investigationTargets[0].sourceNodeRef.sourceId = 'missing_node';
  validation = validateProgressionBuilder(builder, refs);
  assert.ok(validation.errors.some(item => item.code === 'INVALID_TARGET_SOURCE'));
  builder = createProgressionBuilder(fixture.progressionPlan);
  builder = upsertTarget(builder, { schemaVersion: '1.0', targetId: 'target_locked_server',
    targetType: 'SERVER', displayName: '未解放Server', description: '到達不能です。',
    sourceNodeRef: { sourceType: 'NETWORK_NODE', sourceId: 'web-host' },
    availableActionIds: ['action_audit_log'], initiallyAvailable: false });
  validation = validateProgressionBuilder(builder, refs);
  assert.ok(validation.warnings.some(item => item.code === 'UNREACHABLE_TARGET'));
});
