import { validateCandidateBuilderResult } from './candidate-builder.js';
import { validateAttackGraphResult } from './attack-graph.js';
import { validateScenarioImportResult } from './scenario-interface.js';
import { validateScenarioVerificationResult } from './scenario-verifier.js';
import { digest, validateEvidenceImportResult } from './evidence-validator.js';
import { validateGameCaseResult } from './game-case-validator.js';
import { validateGameMakeResult } from './game-make.js';
import { validateGameEvaluationResult } from './game-evaluator.js';
import { validateEnvironment } from './evaluator.js';
import { ValidationError, fail, validateDocument } from './schema.js';

export const WORKFLOW_GATES = Object.freeze(['INPUT_VALIDATION', 'CANDIDATE_BUILDER',
  'ATTACK_GRAPH', 'SCENARIO_IMPORT', 'VERIFICATION', 'EVIDENCE_IMPORT',
  'GAME_CASE_CONVERSION', 'GAME_PROGRESSION', 'GAME_MAKE', 'EVALUATION']);

const EXPECTED_STATUS = Object.freeze({ INPUT_VALIDATION: 'VALID', CANDIDATE_BUILDER: 'CREATED',
  ATTACK_GRAPH: 'CREATED', SCENARIO_IMPORT: 'VALID', VERIFICATION: 'VERIFIED',
  EVIDENCE_IMPORT: 'VALID', GAME_CASE_CONVERSION: 'READY', GAME_PROGRESSION: 'READY',
  GAME_MAKE: 'BUILT', EVALUATION: 'ACCEPTED' });

const WAIT_FOR_GATE = Object.freeze({ SCENARIO_IMPORT: 'WAITING_EXTERNAL_SCENARIO',
  VERIFICATION: 'WAITING_EXTERNAL_REVIEW', EVIDENCE_IMPORT: 'WAITING_EXTERNAL_EVIDENCE' });

function issue(code, gate, reason, correctionHint, sourceRefs = []) {
  return { code, gate, reason, correctionHint,
    sourceRefs: sourceRefs.length ? sourceRefs : [`gate:${gate.toLowerCase()}`] };
}

function stateAfter(completed) {
  if (completed.includes('EVALUATION')) return 'ACCEPTED';
  if (completed.includes('GAME_MAKE')) return 'BUILT';
  if (completed.includes('EVIDENCE_IMPORT')) return 'EVIDENCE_READY';
  if (completed.includes('VERIFICATION')) return 'VERIFIED';
  return 'DRAFT';
}

function nextGate(completed) {
  return WORKFLOW_GATES[completed.length] ?? 'COMPLETE';
}

export function createOrchestrator({ inputFingerprint, courtAttemptLimit }) {
  if (!/^[a-f0-9]{64}$/.test(inputFingerprint ?? '')) fail('INVALID_INPUT_FINGERPRINT',
    'orchestrator.inputFingerprint', '入力fingerprintはSHA-256形式で指定してください。');
  if (!Number.isSafeInteger(courtAttemptLimit) || courtAttemptLimit < 1) {
    fail('INVALID_COURT_ATTEMPT_LIMIT', 'orchestrator.courtAttemptLimit',
      'court attempt上限はGame Progression Planの1以上の整数を指定してください。');
  }
  const workflowId = `workflow_${digest({ inputFingerprint }).slice(0, 20)}`;
  return validateOrchestratorResult({ schemaVersion: '1.0', workflowId, inputFingerprint,
    chainFingerprint: inputFingerprint, currentState: 'DRAFT',
    currentGate: 'INPUT_VALIDATION', waitingFor: null, completedGates: [], blockedGate: null,
    artifactRefs: {}, fingerprints: { input: inputFingerprint },
    retryCounters: { scenarioRevision: 0, scenarioRevisionLimit: 3,
      courtAttempts: 0, courtAttemptLimit }, issues: [] });
}

function artifactStatus(gate, artifact) {
  if (gate === 'INPUT_VALIDATION') {
    validateDocument('orchestrator-input-validation-result', artifact);
    validateDocument('candidate-selection', artifact.selection);
    validateEnvironment(artifact.network, artifact.scenarioContext, artifact.attackDefinitions);
    const selected = artifact.selection.selectedAttackIds;
    if (new Set(selected).size !== selected.length) fail('DUPLICATE_ATTACK_SELECTION',
      'orchestrator-input.selection.selectedAttackIds', '選択攻撃IDを重複させることはできません。');
    const registered = new Set(artifact.attackDefinitions.map(item => item.id));
    if (selected.some(id => !registered.has(id))) fail('UNREGISTERED_ATTACK',
      'orchestrator-input.selection.selectedAttackIds', '未登録の攻撃が選択されています。');
    const expected = digest({ selection: artifact.selection, network: artifact.network,
      scenarioContext: artifact.scenarioContext, attackDefinitions: artifact.attackDefinitions });
    if (artifact.inputFingerprint !== expected) fail('INPUT_FINGERPRINT_MISMATCH',
      'orchestrator-input.inputFingerprint', '入力内容とfingerprintが一致しません。');
    return artifact.status;
  }
  if (gate === 'CANDIDATE_BUILDER') validateCandidateBuilderResult(artifact);
  else if (gate === 'ATTACK_GRAPH') validateAttackGraphResult(artifact);
  else if (gate === 'SCENARIO_IMPORT') validateScenarioImportResult(artifact);
  else if (gate === 'VERIFICATION') validateScenarioVerificationResult(artifact);
  else if (gate === 'EVIDENCE_IMPORT') validateEvidenceImportResult(artifact);
  else if (gate === 'GAME_CASE_CONVERSION' || gate === 'GAME_PROGRESSION') validateGameCaseResult(artifact);
  else if (gate === 'GAME_MAKE') validateGameMakeResult(artifact);
  else if (gate === 'EVALUATION') validateGameEvaluationResult(artifact);
  return artifact.status;
}

function artifactRef(gate, artifact) {
  const refs = {
    INPUT_VALIDATION: artifact.inputId ?? 'validated-input',
    CANDIDATE_BUILDER: artifact.inputDigest,
    ATTACK_GRAPH: artifact.inputDigest,
    SCENARIO_IMPORT: artifact.scenarioId,
    VERIFICATION: artifact.verificationId,
    EVIDENCE_IMPORT: artifact.evidenceSet?.evidenceSetId,
    GAME_CASE_CONVERSION: artifact.gameCase?.gameCaseId,
    GAME_PROGRESSION: artifact.gameCase?.gameCaseId,
    GAME_MAKE: artifact.buildId,
    EVALUATION: artifact.evaluationId,
  };
  return refs[gate] ?? null;
}

function normalizedIssues(gate, artifact, fallbackCode) {
  const values = artifact?.issues ?? artifact?.errors ?? [];
  if (!values.length) return [issue(fallbackCode, gate,
    `${gate}が期待状態${EXPECTED_STATUS[gate]}に到達しませんでした。`,
    '当該ゲートのmachine-readable feedbackに従って上流成果物を修正してください。')];
  return values.slice(0, 128).map(value => issue(value.code ?? fallbackCode, gate,
    value.reason ?? value.message ?? `${gate}が失敗しました。`,
    value.correctionHint ?? value.suggestion ?? '当該ゲートの入力を修正してください。',
    value.sourceRefs ?? [value.field ?? `gate:${gate.toLowerCase()}`]));
}

function blockWorkflow(workflow, gate, values) {
  const next = structuredClone(workflow);
  next.currentState = 'BLOCKED'; next.currentGate = gate; next.blockedGate = gate;
  next.waitingFor = null; next.issues = values;
  return validateOrchestratorResult(next);
}

export function advanceWorkflow(workflow, { gate, artifact, upstreamFingerprint }) {
  validateOrchestratorResult(workflow);
  if (workflow.currentState === 'BLOCKED' || workflow.currentState === 'ACCEPTED') {
    fail('WORKFLOW_TERMINAL', 'orchestrator.currentState', '終了済みWorkflowは進行できません。');
  }
  const expectedGate = nextGate(workflow.completedGates);
  if (gate !== expectedGate) return blockWorkflow(workflow, gate,
    [issue('GATE_ORDER_VIOLATION', gate, `${expectedGate}より先に${gate}を実行できません。`,
      '未完了のゲートを順序どおり実行してください。')]);
  if (upstreamFingerprint !== workflow.chainFingerprint) return blockWorkflow(workflow, gate,
    [issue('STALE_UPSTREAM_ARTIFACT', gate, '成果物生成時の上流fingerprintが最新状態と一致しません。',
      '最新の上流成果物から当該ゲート以降を再実行してください。')]);
  if (gate === 'INPUT_VALIDATION' && artifact?.inputFingerprint !== workflow.inputFingerprint) {
    return blockWorkflow(workflow, gate, [issue('INPUT_FINGERPRINT_MISMATCH', gate,
      '入力検証成果物がWorkflow開始時の入力fingerprintと一致しません。',
      '現在の入力を再検証するか、新しいWorkflowを開始してください。')]);
  }
  let status;
  try { status = artifactStatus(gate, artifact); }
  catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return blockWorkflow(workflow, gate, [issue(error.code, gate, error.message,
      'Schemaまたはゲート成果物を修正して再実行してください。', [error.field])]);
  }
  if (status !== EXPECTED_STATUS[gate]) {
    const next = structuredClone(workflow);
    next.currentGate = gate; next.waitingFor = null;
    next.issues = normalizedIssues(gate, artifact, `${gate}_FAILED`);
    const revision = ['INVALID', 'NEEDS_REVISION'].includes(status);
    next.currentState = revision ? 'NEEDS_REVISION' : 'BLOCKED';
    next.blockedGate = revision ? null : gate;
    return validateOrchestratorResult(next);
  }
  const next = structuredClone(workflow);
  const fingerprint = digest(artifact);
  const chainFingerprint = digest({ gate, upstreamFingerprint, artifactFingerprint: fingerprint });
  next.completedGates.push(gate);
  next.artifactRefs[gate] = artifactRef(gate, artifact) ?? `${gate.toLowerCase()}_artifact`;
  next.fingerprints[gate] = { artifactFingerprint: fingerprint,
    upstreamFingerprint, chainFingerprint };
  next.chainFingerprint = chainFingerprint;
  next.currentState = stateAfter(next.completedGates);
  next.currentGate = nextGate(next.completedGates);
  next.waitingFor = null; next.blockedGate = null; next.issues = [];
  return validateOrchestratorResult(next);
}

export function waitForExternal(workflow) {
  validateOrchestratorResult(workflow);
  const waitingFor = WAIT_FOR_GATE[nextGate(workflow.completedGates)];
  if (!waitingFor) fail('EXTERNAL_WAIT_NOT_APPLICABLE', 'orchestrator.currentGate',
    '現在のゲートは外部Codex成果物を待つ工程ではありません。');
  const next = structuredClone(workflow); next.waitingFor = waitingFor;
  return validateOrchestratorResult(next);
}

export function recordScenarioRevision(workflow) {
  validateOrchestratorResult(workflow);
  if (workflow.currentState !== 'NEEDS_REVISION'
    || !['SCENARIO_IMPORT', 'VERIFICATION'].includes(workflow.currentGate)) {
    fail('SCENARIO_REVISION_NOT_APPLICABLE', 'orchestrator.currentState',
      'Scenario revisionはScenario/VerificationのNEEDS_REVISION時だけ記録できます。');
  }
  const next = structuredClone(workflow);
  next.retryCounters.scenarioRevision += 1;
  if (next.retryCounters.scenarioRevision > next.retryCounters.scenarioRevisionLimit) {
    return blockWorkflow(next, next.currentGate, [issue('REVISION_LIMIT_EXCEEDED', next.currentGate,
      'Scenario Revisionが最大3回を超えました。',
      '入力条件または上流設計を見直して新しいWorkflowを開始してください。')]);
  }
  next.currentState = stateAfter(next.completedGates); next.issues = []; next.waitingFor = null;
  return validateOrchestratorResult(next);
}

export function recordCourtAttempt(workflow) {
  validateOrchestratorResult(workflow);
  const next = structuredClone(workflow); next.retryCounters.courtAttempts += 1;
  if (next.retryCounters.courtAttempts >= next.retryCounters.courtAttemptLimit
    && next.currentState !== 'ACCEPTED') {
    return blockWorkflow(next, next.currentGate, [issue('COURT_ATTEMPT_LIMIT_REACHED',
      next.currentGate, 'Court retryがGame Progression Planの上限に達しました。',
      '現在のゲームセッションをBLOCKEDとして終了してください。')]);
  }
  return validateOrchestratorResult(next);
}

export function invalidateWorkflowFrom(workflow, gate, newInputFingerprint = null) {
  validateOrchestratorResult(workflow);
  const index = WORKFLOW_GATES.indexOf(gate);
  if (index < 0) fail('UNKNOWN_GATE', 'orchestrator.gate', '無効化対象gateが未登録です。');
  const next = structuredClone(workflow);
  const removed = WORKFLOW_GATES.slice(index);
  next.completedGates = next.completedGates.filter(item => !removed.includes(item));
  for (const item of removed) { delete next.artifactRefs[item]; delete next.fingerprints[item]; }
  if (gate === 'INPUT_VALIDATION') {
    if (!/^[a-f0-9]{64}$/.test(newInputFingerprint ?? '')) fail('INVALID_INPUT_FINGERPRINT',
      'orchestrator.newInputFingerprint', '上流入力変更時は新しいSHA-256 fingerprintが必要です。');
    next.inputFingerprint = newInputFingerprint; next.fingerprints.input = newInputFingerprint;
    next.chainFingerprint = newInputFingerprint;
  } else {
    const previous = next.completedGates.at(-1);
    next.chainFingerprint = previous
      ? next.fingerprints[previous].chainFingerprint : next.inputFingerprint;
  }
  next.currentState = stateAfter(next.completedGates); next.currentGate = nextGate(next.completedGates);
  next.waitingFor = null; next.blockedGate = null; next.issues = [];
  next.retryCounters.courtAttempts = 0;
  if (index <= WORKFLOW_GATES.indexOf('SCENARIO_IMPORT')) next.retryCounters.scenarioRevision = 0;
  return validateOrchestratorResult(next);
}

export function validateOrchestratorResult(result) {
  validateDocument('orchestrator-result', result);
  const expectedPrefix = WORKFLOW_GATES.slice(0, result.completedGates.length);
  if (new Set(result.completedGates).size !== result.completedGates.length
    || result.completedGates.some((gate, index) => gate !== expectedPrefix[index])) {
    fail('INVALID_COMPLETED_GATES', 'orchestrator-result.completedGates',
      '完了gateは重複なしの標準Workflow prefixでなければなりません。');
  }
  for (const field of ['scenarioRevision', 'scenarioRevisionLimit', 'courtAttempts', 'courtAttemptLimit']) {
    if (!Number.isSafeInteger(result.retryCounters[field]) || result.retryCounters[field] < 0) {
      fail('INVALID_RETRY_COUNTER', `orchestrator-result.retryCounters.${field}`,
        'retry counterは0以上の安全な整数でなければなりません。');
    }
  }
  if (result.retryCounters.scenarioRevisionLimit !== 3
    || result.retryCounters.courtAttemptLimit < 1) fail('INVALID_RETRY_LIMIT',
    'orchestrator-result.retryCounters', 'Scenario revision上限は3、court上限は1以上でなければなりません。');
  const terminalAccepted = result.currentState === 'ACCEPTED';
  if (terminalAccepted !== (result.completedGates.length === WORKFLOW_GATES.length)
    || (terminalAccepted && result.currentGate !== 'COMPLETE')) fail('INVALID_ORCHESTRATOR_STATE',
    'orchestrator-result.currentState', 'ACCEPTEDは全gate完了時だけ許可されます。');
  if ((result.currentState === 'BLOCKED') !== Boolean(result.blockedGate)
    || (result.currentState === 'BLOCKED' && !result.issues.length)) fail('INVALID_BLOCKED_STATE',
    'orchestrator-result.blockedGate', 'BLOCKEDは停止gateとissueを必要とします。');
  if (result.waitingFor && result.currentState === 'BLOCKED') fail('INVALID_WAIT_STATE',
    'orchestrator-result.waitingFor', 'BLOCKEDと外部待機を同時に設定できません。');
  return result;
}
