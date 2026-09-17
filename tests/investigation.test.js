import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { actGenerated, createGeneratedGame, generatedPlayerView }
  from '../server/generated-game.js';
import { buildGameEvaluationInput, evaluateGame } from '../server/generation/game-evaluator.js';
import { buildGeneratedGame } from '../server/generation/game-make.js';
import { convertGameCase } from '../server/generation/game-case-converter.js';
import { conversionInputCore, gameCaseCore, progressionPlanCore, projectPublicGameCase }
  from '../server/generation/game-case-validator.js';
import { digest } from '../server/generation/evidence-validator.js';
import { investigationCompletionId, validateInvestigationDesign }
  from '../server/generation/investigation-validator.js';
import { validateDocument } from '../server/generation/schema.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';

function resealInput(input) {
  input.progressionPlan.fingerprint = digest(progressionPlanCore(input.progressionPlan));
  input.progressionPlan.planId = `progression_plan_${input.progressionPlan.fingerprint.slice(0, 20)}`;
  input.inputFingerprint = digest(conversionInputCore(input));
  input.conversionInputId = `game_case_input_${input.inputFingerprint.slice(0, 20)}`;
  return input;
}

function start(runtime) {
  const session = createGeneratedGame(runtime);
  actGenerated(session, runtime, { action: 'begin' });
  actGenerated(session, runtime, { action: 'continue' });
  return session;
}

function resealGameCaseResult(result) {
  const gameCase = result.gameCase;
  gameCase.fingerprint = digest(gameCaseCore(gameCase));
  gameCase.gameCaseId = `game_case_${gameCase.fingerprint.slice(0, 20)}`;
  result.publicGameCase = projectPublicGameCase(gameCase);
  const handoff = result.uiIntegrationHandoff;
  handoff.handoffId = `ui_handoff_${gameCase.fingerprint.slice(0, 20)}`;
  handoff.gameCaseId = gameCase.gameCaseId;
  handoff.gameCaseFingerprint = gameCase.fingerprint;
  handoff.publicGameCaseFingerprint = digest(result.publicGameCase);
  handoff.progressionFingerprint = digest(gameCase.progression);
  return result;
}

test('Phase 12のAction、Target、Discovery Rule、Resultはversioned Schemaに適合する', () => {
  const fixture = readyGameCaseFixture();
  fixture.progressionPlan.investigationActions.forEach(item =>
    assert.equal(validateDocument('investigation-action', item), item));
  fixture.progressionPlan.investigationTargets.forEach(item =>
    assert.equal(validateDocument('investigation-target', item), item));
  fixture.progressionPlan.evidenceDiscoveryRules.forEach(item =>
    assert.equal(validateDocument('evidence-discovery-rule', item), item));
  const result = { schemaVersion: '1.0', targetId: 'target_web_server',
    investigationActionId: 'action_audit_log', publicMessage: '合成ログを確認しました。',
    discovered: false, discoveredEvidenceIds: [], unlockedTargetIds: [], nextHints: [] };
  assert.equal(validateDocument('investigation-result', result), result);
});

test('Investigation simulationは実OS、実ファイル、外部通信、外部コマンドを実行しない', async () => {
  const source = await Promise.all([
    readFile(new URL('../server/generated-game.js', import.meta.url), 'utf8'),
    readFile(new URL('../server/generation/investigation-validator.js', import.meta.url), 'utf8'),
  ]).then(parts => parts.join('\n'));
  assert.doesNotMatch(source,
    /node:(?:child_process|fs|net|http|https)|\b(?:exec|execFile|spawn|fetch)\s*\(/);
});

test('UNKNOWN Evidenceを公開せず、TargetとAction実行後だけDISCOVEREDからCOLLECTEDへ進む', () => {
  const fixture = readyGameCaseFixture();
  const { runtime } = buildGeneratedGame(fixture.gameCaseResult);
  const session = start(runtime);
  let view = generatedPlayerView(session, runtime);
  assert.equal(view.discoveredEvidence.length, 0);
  assert.doesNotMatch(JSON.stringify(view), /アプリケーションログ|隔離環境の要求処理記録/);
  assert.throws(() => actGenerated(session, runtime,
    { action: 'collect', evidenceId: 'evidence_technical_a' }),
  { code: 'EVIDENCE_NOT_DISCOVERED' });
  view = actGenerated(session, runtime, { action: 'investigate', targetId: 'target_web_server',
    investigationActionId: 'action_audit_log' });
  assert.equal(view.discoveredEvidence[0].discoveryState, 'DISCOVERED');
  view = actGenerated(session, runtime, { action: 'collect', evidenceId: 'evidence_technical_a' });
  assert.equal(view.discoveredEvidence[0].discoveryState, 'COLLECTED');
});

test('不正Target、不正Action、別Game CaseのIDを拒否し、誤調査は正解を漏らさない', () => {
  const fixture = readyGameCaseFixture();
  const { runtime } = buildGeneratedGame(fixture.gameCaseResult);
  const session = start(runtime);
  assert.throws(() => actGenerated(session, runtime, { action: 'investigate',
    targetId: 'target_other_case', investigationActionId: 'action_audit_log' }),
  { code: 'UNKNOWN_INVESTIGATION_TARGET' });
  assert.throws(() => actGenerated(session, runtime, { action: 'investigate',
    targetId: 'target_web_server', investigationActionId: 'action_check_email' }),
  { code: 'INVESTIGATION_ACTION_NOT_AVAILABLE' });
  const view = actGenerated(session, runtime, { action: 'investigate',
    targetId: 'target_web_server', investigationActionId: 'action_check_configuration' });
  assert.equal(view.lastInvestigationResult.discovered, false);
  assert.deepEqual(view.lastInvestigationResult.discoveredEvidenceIds, []);
  assert.doesNotMatch(JSON.stringify(view.lastInvestigationResult),
    /evidence_technical_a|statement_seen_operation|正解/);
});

test('requiredEvidenceIdsとrequiredCompletedActionIdsを満たすDiscovery chainを実行できる', () => {
  const fixture = readyGameCaseFixture();
  const input = structuredClone(fixture.conversionInput);
  const plan = input.progressionPlan;
  const ruleA = plan.evidenceDiscoveryRules.find(item => item.evidenceId === 'evidence_technical_a');
  const ruleB = plan.evidenceDiscoveryRules.find(item => item.evidenceId === 'evidence_technical_b');
  plan.investigationTargets.push({ schemaVersion: '1.0', targetId: 'target_database_server',
    targetType: 'SERVER', displayName: 'DBサーバ', description: '合成DBサーバです。',
    sourceNodeRef: { sourceType: 'NETWORK_NODE', sourceId: 'db-host' },
    availableActionIds: ['action_audit_log'], initiallyAvailable: false });
  ruleA.discoveryResult.unlockedTargetIds = ['target_database_server'];
  ruleB.targetId = 'target_database_server'; ruleB.actionId = 'action_audit_log';
  ruleB.prerequisites.requiredCompletedActionIds = [
    investigationCompletionId('target_client_endpoint', 'action_inspect_device')];
  const result = convertGameCase(resealInput(input));
  assert.equal(result.status, 'READY');
  const { runtime } = buildGeneratedGame(result);
  const session = start(runtime);
  actGenerated(session, runtime, { action: 'investigate', targetId: 'target_client_endpoint',
    investigationActionId: 'action_inspect_device' });
  actGenerated(session, runtime, { action: 'investigate', targetId: 'target_web_server',
    investigationActionId: 'action_audit_log' });
  assert.ok(session.availableInvestigationTargets.includes('target_database_server'));
  const view = actGenerated(session, runtime, { action: 'investigate',
    targetId: 'target_database_server', investigationActionId: 'action_audit_log' });
  assert.ok(view.discoveredEvidence.some(item => item.evidenceId === 'evidence_technical_b'));
});

test('prerequisite未成立では発見せず、循環依存と到達不能Evidenceを変換前に拒否する', () => {
  const base = readyGameCaseFixture();
  const runtime = buildGeneratedGame(base.gameCaseResult).runtime;
  const session = start(runtime);
  let view = actGenerated(session, runtime, { action: 'investigate',
    targetId: 'target_web_server', investigationActionId: 'action_analyze_network_log' });
  assert.equal(view.lastInvestigationResult.discovered, false);

  const cyclic = structuredClone(base.conversionInput);
  const cyclicRules = cyclic.progressionPlan.evidenceDiscoveryRules;
  cyclicRules.find(item => item.evidenceId === 'evidence_technical_a')
    .prerequisites.requiredEvidenceIds = ['evidence_technical_b'];
  assert.equal(convertGameCase(resealInput(cyclic)).errors[0].code,
    'INVESTIGATION_PREREQUISITE_CYCLE');

  const unreachable = structuredClone(base.conversionInput);
  const web = unreachable.progressionPlan.investigationTargets
    .find(item => item.targetId === 'target_web_server');
  web.initiallyAvailable = false;
  unreachable.progressionPlan.initialAvailableTargetIds = ['target_client_endpoint'];
  assert.equal(convertGameCase(resealInput(unreachable)).errors[0].code,
    'UNREACHABLE_INVESTIGATION_EVIDENCE');
});

test('存在しないTarget sourceとPLAYER_OBTAINABLEでないEvidenceを拒否する', () => {
  const fixture = readyGameCaseFixture();
  const brokenSource = structuredClone(fixture.conversionInput);
  brokenSource.progressionPlan.investigationTargets[0].sourceNodeRef.sourceId = 'missing-node';
  assert.equal(convertGameCase(resealInput(brokenSource)).errors[0].code,
    'BROKEN_INVESTIGATION_SOURCE_REFERENCE');

  const unavailable = structuredClone(fixture.conversionInput);
  unavailable.evidenceSet.evidenceArtifacts[0].visibility = 'INTERNAL_ONLY';
  assert.throws(() => validateInvestigationDesign(unavailable),
    { code: 'UNOBTAINABLE_DISCOVERY_EVIDENCE' });
});

test('CourtroomではCOLLECTED Evidenceだけを提示でき、正常経路でACQUITTEDへ到達する', () => {
  const fixture = readyGameCaseFixture();
  const { runtime } = buildGeneratedGame(fixture.gameCaseResult);
  const session = start(runtime);
  actGenerated(session, runtime, { action: 'investigate', targetId: 'target_web_server',
    investigationActionId: 'action_audit_log' });
  assert.throws(() => actGenerated(session, runtime, { action: 'retrial' }),
    { code: 'COURT_RETURN_CONDITION_NOT_MET' });
  actGenerated(session, runtime, { action: 'collect', evidenceId: 'evidence_technical_a' });
  actGenerated(session, runtime, { action: 'retrial' });
  const result = actGenerated(session, runtime, { action: 'objection',
    statementId: 'statement_seen_operation', evidenceId: 'evidence_technical_a' });
  assert.equal(result.currentState, 'ACQUITTED');
});

test('Player responseにDiscovery内部条件を漏らさず、Evaluationが到達不能を拒否する', () => {
  const fixture = readyGameCaseFixture();
  const { runtime } = buildGeneratedGame(fixture.gameCaseResult);
  const session = start(runtime);
  const view = generatedPlayerView(session, runtime);
  assert.doesNotMatch(JSON.stringify(view),
    /evidenceDiscoveryRules|requiredEvidenceIds|requiredCompletedActionIds|sourceNodeRef|acceptedEvidenceIds/);

  const tampered = structuredClone(fixture.gameCaseResult);
  const rules = tampered.gameCase.detective.evidenceDiscoveryRules;
  rules.find(item => item.evidenceId === 'evidence_technical_a')
    .prerequisites.requiredEvidenceIds = ['evidence_technical_b'];
  const resealed = resealGameCaseResult(tampered);
  const built = buildGeneratedGame(resealed);
  assert.equal(built.gameMakeResult.status, 'BUILT');
  const input = buildGameEvaluationInput({ gameMakeResult: built.gameMakeResult,
    gameCaseResult: resealed, evidenceSet: fixture.evidenceSet,
    verificationResult: fixture.verificationResult, scenarioPackage: fixture.scenarioPackage });
  const evaluation = evaluateGame(input);
  assert.equal(evaluation.status, 'BLOCKED');
  assert.ok(evaluation.issues.some(item => item.code === 'INVESTIGATION_EVIDENCE_UNREACHABLE'));
});
