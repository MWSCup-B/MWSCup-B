import { readFile } from 'node:fs/promises';
import { loadCatalog } from './generation/catalog.js';
import { buildCandidates } from './generation/candidate-builder.js';
import { buildAttackGraphs } from './generation/attack-graph.js';
import { buildScenarioGenerationInputs, importScenarioPackage,
  SCENARIO_PROMPT_TEMPLATE } from './generation/scenario-interface.js';
import { buildScenarioVerificationInput, SCENARIO_VERIFICATION_PROMPT,
  verifyScenario } from './generation/scenario-verifier.js';
import { buildEvidenceGenerationInput, EVIDENCE_PROMPT_TEMPLATE,
  importEvidencePackage } from './generation/evidence-interface.js';
import { buildGameCaseConversionInput, buildGameProgressionPlan,
  convertGameCase } from './generation/game-case-converter.js';
import { buildGeneratedGame } from './generation/game-make.js';
import { buildGameEvaluationInput, evaluateGame } from './generation/game-evaluator.js';
import { advanceWorkflow, createOrchestrator, WORKFLOW_GATES }
  from './generation/orchestrator.js';
import { digest } from './generation/evidence-validator.js';
import { DEFAULT_INVESTIGATION_ACTIONS } from './generation/investigation-validator.js';
import { ValidationError } from './generation/schema.js';
import { publicXssNetworks, xssTechnicalSelection } from './xss-networks.js';
import { buildXssPrototype, evaluateXssPrototype } from './xss-prototype.js';

const [catalog, exampleNetwork, exampleContext] = await Promise.all([
  loadCatalog(),
  readFile(new URL('../data/examples/network.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../data/examples/scenario-context.json', import.meta.url), 'utf8').then(JSON.parse),
]);

const planFields = ['schemaVersion', 'scenarioId', 'evidenceSetId', 'attackGraphRef',
  'initialCourtEvidenceIds', 'initialCourtStatementIds', 'investigationEvidenceIds',
  'investigationActions', 'investigationTargets', 'evidenceDiscoveryRules',
  'initialAvailableTargetIds',
  'retrialStatementIds', 'returnToCourtCondition', 'objectionRules', 'retryPolicy',
  'publicMessages'];

function normalizedIssue(value, fallback = 'AUTHOR_OPERATION_FAILED') {
  return { code: value.code ?? fallback, field: value.field ?? 'author',
    reason: value.reason ?? value.message ?? '制作処理に失敗しました。',
    correctionHint: value.correctionHint ?? value.suggestion
      ?? '入力と表示された参照IDを確認して再実行してください。' };
}

function clearAfter(session, stage) {
  const order = ['PREPARED', 'SCENARIO_IMPORTED', 'VERIFIED', 'EVIDENCE_PREPARED',
    'EVIDENCE_IMPORTED', 'BUILT'];
  if (order.indexOf(stage) <= order.indexOf('PREPARED')) Object.assign(session, {
    selectedOption: null, scenarioPackage: null, scenarioImportResult: null,
    verificationInput: null, verificationResult: null, evidenceGenerationInput: null,
    evidencePackage: null, evidenceImportResult: null,
  });
  if (order.indexOf(stage) <= order.indexOf('SCENARIO_IMPORTED')) Object.assign(session, {
    verificationResult: null, evidenceGenerationInput: null, evidencePackage: null,
    evidenceImportResult: null,
  });
  if (order.indexOf(stage) <= order.indexOf('VERIFIED')) Object.assign(session, {
    evidenceGenerationInput: null, evidencePackage: null, evidenceImportResult: null,
  });
  if (order.indexOf(stage) <= order.indexOf('EVIDENCE_IMPORTED')) Object.assign(session, {
    progressionPlan: null, gameCaseResult: null, gameMakeResult: null,
    evaluationResult: null, prototypeEvaluation: null, runtime: null, workflow: null, playId: null,
  });
}

export function createAuthorSession() {
  return { stage: 'INPUT', workflowState: 'DRAFT', waitingFor: null, issues: [],
    revisionAttemptsUsed: 0, selectedAttacks: [], network: null, scenarioContext: null,
    inputValidationArtifact: null, candidateResult: null, scenarioOptions: [],
    selectedOption: null, scenarioPackage: null, scenarioImportResult: null,
    verificationInput: null, verificationResult: null, evidenceGenerationInput: null,
    evidencePackage: null, evidenceImportResult: null, progressionPlan: null,
    gameCaseResult: null, gameMakeResult: null, evaluationResult: null,
    prototypeSelection: null, prototypeEvaluation: null,
    workflow: null, runtime: null, playId: null };
}

export function authorBootstrap() {
  return { attacks: catalog.map(item => ({ id: item.id, label: item.label,
    category: item.category, description: item.description })),
  prototype: { attack: { id: 'reflected_xss', label: 'Cross-Site Scripting (XSS)' },
    networks: publicXssNetworks(), difficulties: [
      { difficulty: 1, label: '★1', requiredEvidenceCount: 1 },
      { difficulty: 2, label: '★2', requiredEvidenceCount: 2 },
      { difficulty: 3, label: '★3', requiredEvidenceCount: 3 },
    ] },
  examples: { network: structuredClone(exampleNetwork),
    scenarioContext: structuredClone(exampleContext) } };
}

function planReferences(session) {
  const set = session.evidenceImportResult?.evidenceSet;
  if (!set) return null;
  const generationInput = session.selectedOption?.generationInput;
  const graph = generationInput?.technicalInput.attackGraph;
  const network = generationInput?.technicalInput.network;
  const characterNames = new Map((session.scenarioPackage?.characters.characters ?? [])
    .map(item => [item.characterId, item.displayName]));
  return {
    investigationActions: structuredClone(DEFAULT_INVESTIGATION_ACTIONS),
    completedActionIdFormat: 'completed_<targetId>__<actionId>',
    investigationSourceNodes: [
      ...(network?.nodes ?? []).map(item => ({ sourceType: 'NETWORK_NODE',
        sourceId: item.id, details: { type: item.type, roles: item.roles, os: item.os } })),
      ...(network?.services ?? []).map(item => ({ sourceType: 'NETWORK_SERVICE',
        sourceId: item.id, details: { nodeId: item.nodeId, type: item.type, platform: item.platform } })),
      ...(graph?.nodes ?? []).map(item => ({ sourceType: 'ATTACK_GRAPH_NODE',
        sourceId: item.nodeId, details: { attackDefinitionId: item.attackDefinitionId } })),
      ...(graph?.nodes ?? []).flatMap(node => node.artifactEvaluations.map(item => ({
        sourceType: 'ATTACK_GRAPH_ARTIFACT', sourceId: item.artifactId,
        details: { attackNodeId: node.nodeId, state: item.state } }))),
      ...(session.scenarioPackage?.timeline.events ?? []).map(item => ({ sourceType: 'TIMELINE_EVENT',
        sourceId: item.eventId, details: { attackNodeId: item.attackNodeId } })),
      ...set.evidenceArtifacts.map(item => ({ sourceType: 'EVIDENCE_ARTIFACT',
        sourceId: item.evidenceId, details: { type: item.type, title: item.title } })),
    ],
    evidence: set.evidenceArtifacts.map(item => ({ evidenceId: item.evidenceId,
      type: item.type, title: item.title, visibility: item.visibility,
      purpose: [...item.purpose], publicContent: structuredClone(item.publicContent) })),
    testimonies: set.evidenceArtifacts.filter(item => item.type === 'TESTIMONY').map(item => ({
      testimonyEvidenceId: item.evidenceId,
      witnessCharacterId: item.testimony.witnessCharacterId,
      witnessDisplayName: characterNames.get(item.testimony.witnessCharacterId)
        ?? item.testimony.witnessCharacterId,
      statementIds: item.testimony.statements.map(statement => statement.statementId) })),
    statements: set.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')
      .flatMap(item => item.testimony.statements.map(statement => ({
        testimonyEvidenceId: item.evidenceId, statementId: statement.statementId,
        witnessCharacterId: item.testimony.witnessCharacterId,
        speakerDisplayName: characterNames.get(item.testimony.witnessCharacterId)
          ?? item.testimony.witnessCharacterId,
        spokenContent: statement.spokenContent }))),
    contradictions: structuredClone(set.contradictions),
    exonerations: structuredClone(set.exonerations),
  };
}

function planTemplate(session) {
  const set = session.evidenceImportResult?.evidenceSet;
  if (!set) return null;
  return { schemaVersion: '1.0', scenarioId: set.scenarioId,
    evidenceSetId: set.evidenceSetId, attackGraphRef: structuredClone(set.attackGraphRef),
    initialCourtEvidenceIds: [], initialCourtStatementIds: [],
    investigationEvidenceIds: [], retrialStatementIds: [],
    investigationActions: structuredClone(DEFAULT_INVESTIGATION_ACTIONS),
    investigationTargets: [], evidenceDiscoveryRules: [], initialAvailableTargetIds: [],
    returnToCourtCondition: null, objectionRules: [],
    retryPolicy: { maxCourtAttempts: null, onFailure: 'RETURN_TO_INVESTIGATION',
      onLimitReached: 'BLOCKED' },
    publicMessages: { initialRuling: '', acquittalRuling: '',
      acquittalExplanation: '', failureFeedback: '' } };
}

export function authorView(session) {
  return { stage: session.stage, currentState: session.workflow?.currentState
      ?? session.workflowState, waitingFor: session.workflow?.waitingFor ?? session.waitingFor,
    issues: structuredClone(session.issues), selectedAttacks: [...session.selectedAttacks],
    scenarioOptions: session.scenarioOptions.map(item => ({ optionId: item.optionId,
      generationInputId: item.generationInput.generationInputId,
      graphId: item.generationInput.attackGraphRef.graphId,
      candidateIndex: item.candidateIndex, generationInput: structuredClone(item.generationInput) })),
    scenarioPrompt: session.scenarioOptions.length ? SCENARIO_PROMPT_TEMPLATE : null,
    scenarioImportResult: structuredClone(session.scenarioImportResult),
    verificationPrompt: session.verificationInput ? SCENARIO_VERIFICATION_PROMPT : null,
    verificationInput: structuredClone(session.verificationInput),
    verificationResult: structuredClone(session.verificationResult),
    evidencePrompt: session.evidenceGenerationInput ? EVIDENCE_PROMPT_TEMPLATE : null,
    evidenceGenerationInput: structuredClone(session.evidenceGenerationInput),
    evidenceImportResult: structuredClone(session.evidenceImportResult),
    prototypeSelection: session.prototypeSelection ? {
      schemaVersion: '1.0', attackType: session.prototypeSelection.attackType,
      selectedNetworkId: session.prototypeSelection.selectedNetworkId,
      difficulty: session.prototypeSelection.difficulty,
      requiredEvidenceCount: session.prototypeSelection.requiredEvidenceCount,
    } : null,
    prototypeGenerationBrief: session.prototypeSelection && session.scenarioOptions.length ? {
      attackType: session.prototypeSelection.attackType,
      selectedNetworkId: session.prototypeSelection.selectedNetworkId,
      selectedNetworkDefinition: structuredClone(session.prototypeSelection.selectedNetworkDefinition),
      difficulty: session.prototypeSelection.difficulty,
      technicalConstraints: structuredClone(session.prototypeSelection.technicalConstraints),
      scenarioGenerationInput: structuredClone(session.scenarioOptions[0].generationInput),
    } : null,
    prototypeEvaluation: structuredClone(session.prototypeEvaluation),
    progressionPlanTemplate: planTemplate(session), progressionReferences: planReferences(session),
    progressionPlan: structuredClone(session.progressionPlan),
    gameCaseStatus: session.gameCaseResult?.status ?? null,
    gameMakeStatus: session.gameMakeResult?.status ?? null,
    evaluationResult: structuredClone(session.evaluationResult),
    orchestrator: structuredClone(session.workflow),
    playUrl: session.playId ? `/?game=${session.playId}` : null };
}

export function prepareXssScenario(session, { networkId, difficulty }) {
  const selection = xssTechnicalSelection(networkId, difficulty);
  if (!selection) return failed(session, { code: 'INVALID_XSS_SELECTION',
    field: 'networkId,difficulty', reason: 'Network A～Dと難易度★1～3を選択してください。',
    correctionHint: '表示されたNetwork CardとDifficultyだけを使用してください。' });
  const view = prepareScenario(session, { selectedAttackIds: ['reflected_xss'],
    network: selection.network, scenarioContext: selection.scenarioContext });
  if (session.scenarioOptions.length) session.prototypeSelection = selection;
  return session.scenarioOptions.length ? authorView(session) : view;
}

function failed(session, error, state = 'NEEDS_REVISION') {
  session.workflowState = state; session.waitingFor = null;
  session.issues = [normalizedIssue(error)];
  return authorView(session);
}

export function prepareScenario(session, { selectedAttackIds, network, scenarioContext }) {
  try {
    clearAfter(session, 'PREPARED');
    const selection = { schemaVersion: '1.0', selectedAttackIds: structuredClone(selectedAttackIds) };
    const inputFingerprint = digest({ selection, network, scenarioContext,
      attackDefinitions: catalog });
    const inputValidationArtifact = { schemaVersion: '1.0', status: 'VALID',
      inputId: `author_input_${inputFingerprint.slice(0, 20)}`, inputFingerprint,
      selection, network: structuredClone(network), scenarioContext: structuredClone(scenarioContext),
      attackDefinitions: structuredClone(catalog) };
    const candidateResult = buildCandidates({ definitions: catalog, network, context: scenarioContext,
      selection });
    session.selectedAttacks = [...selectedAttackIds]; session.network = structuredClone(network);
    session.scenarioContext = structuredClone(scenarioContext);
    session.inputValidationArtifact = inputValidationArtifact;
    session.candidateResult = candidateResult;
    if (candidateResult.status !== 'CREATED') {
      session.stage = 'INPUT'; session.workflowState = 'BLOCKED';
      session.issues = candidateResult.issues.map(normalizedIssue);
      return authorView(session);
    }
    const options = [];
    candidateResult.candidates.forEach((candidate, candidateIndex) => {
      const graphResult = buildAttackGraphs({ definitions: catalog, network,
        context: scenarioContext, candidate });
      if (graphResult.status !== 'CREATED') return;
      const inputs = buildScenarioGenerationInputs({ attackGraphResult: graphResult,
        definitions: catalog, network, context: scenarioContext, candidate });
      inputs.forEach((generationInput, graphIndex) => options.push({
        optionId: `scenario_option_${candidateIndex + 1}_${graphIndex + 1}`,
        candidateIndex, candidate: structuredClone(candidate), graphResult,
        generationInput }));
    });
    if (!options.length) return failed(session, { code: 'NO_SATISFIED_ATTACK_GRAPH',
      field: 'attackGraph', reason: 'SATISFIEDなAttack Graph候補がありません。',
      correctionHint: 'Network、Scenario Context、選択攻撃の成立条件を確認してください。' }, 'BLOCKED');
    session.scenarioOptions = options; session.stage = 'SCENARIO_GENERATION';
    session.workflowState = 'DRAFT'; session.waitingFor = 'WAITING_EXTERNAL_SCENARIO';
    session.issues = [];
    return authorView(session);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    session.stage = 'INPUT';
    return failed(session, { code: error.code, field: error.field, reason: error.message,
      correctionHint: 'Network、Scenario Context、攻撃選択をSchemaに合わせて修正してください。' });
  }
}

export function importAuthorScenario(session, { optionId, scenarioPackage }) {
  const option = session.scenarioOptions.find(item => item.optionId === optionId);
  if (!option) return failed(session, { code: 'SCENARIO_OPTION_REQUIRED', field: 'optionId',
    reason: '生成済みのScenario Generation Inputを選択してください。',
    correctionHint: '画面に表示されたGeneration Inputを選んでください。' });
  if (session.verificationResult?.status === 'NEEDS_REVISION') session.revisionAttemptsUsed += 1;
  clearAfter(session, 'SCENARIO_IMPORTED');
  session.selectedOption = option; session.scenarioPackage = structuredClone(scenarioPackage);
  const result = importScenarioPackage({ generationInput: option.generationInput, scenarioPackage });
  session.scenarioImportResult = result;
  if (result.status !== 'VALID') {
    session.stage = 'SCENARIO_GENERATION'; session.workflowState = 'NEEDS_REVISION';
    session.waitingFor = 'WAITING_EXTERNAL_SCENARIO';
    session.issues = result.errors.map(normalizedIssue);
    return authorView(session);
  }
  try {
    session.verificationInput = buildScenarioVerificationInput({
      generationInput: option.generationInput, importResult: result, scenarioPackage,
      revisionAttemptsUsed: session.revisionAttemptsUsed });
    session.stage = 'VERIFICATION_REVIEW'; session.workflowState = 'DRAFT';
    session.waitingFor = 'WAITING_EXTERNAL_REVIEW'; session.issues = [];
    return authorView(session);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return failed(session, error, 'BLOCKED');
  }
}

export function importAuthorReview(session, semanticReview) {
  if (!session.verificationInput) return failed(session, { code: 'VERIFICATION_INPUT_REQUIRED',
    field: 'verificationInput', reason: 'VALIDなScenario Importがありません。',
    correctionHint: '先にScenario JSONをImportしてください。' }, 'BLOCKED');
  const result = verifyScenario({ verificationInput: session.verificationInput, semanticReview });
  session.verificationResult = result; session.issues = result.issues.map(normalizedIssue);
  session.waitingFor = null;
  if (result.status === 'VERIFIED') {
    session.stage = 'VERIFIED'; session.workflowState = 'VERIFIED';
  } else if (result.status === 'NEEDS_REVISION') {
    session.stage = 'VERIFICATION_REVIEW'; session.workflowState = 'NEEDS_REVISION';
    session.waitingFor = 'WAITING_EXTERNAL_SCENARIO';
  } else { session.stage = 'VERIFICATION_REVIEW'; session.workflowState = 'BLOCKED'; }
  return authorView(session);
}

export function prepareEvidence(session) {
  if (session.verificationResult?.status !== 'VERIFIED') return failed(session, {
    code: 'SCENARIO_NOT_VERIFIED', field: 'verificationResult.status',
    reason: 'VERIFIEDなScenarioだけがEvidence生成へ進めます。',
    correctionHint: '独立Verification Reviewを通過させてください。' }, 'BLOCKED');
  const result = buildEvidenceGenerationInput({
    scenarioVerificationInput: session.verificationInput,
    verificationResult: session.verificationResult });
  session.evidenceGenerationInput = result; session.stage = 'EVIDENCE_GENERATION';
  session.workflowState = result.status === 'READY' ? 'VERIFIED' : 'BLOCKED';
  session.waitingFor = result.status === 'READY' ? 'WAITING_EXTERNAL_EVIDENCE' : null;
  session.issues = result.issues.map(normalizedIssue);
  return authorView(session);
}

export function importAuthorEvidence(session, evidencePackage) {
  if (!session.evidenceGenerationInput) return failed(session, {
    code: 'EVIDENCE_GENERATION_INPUT_REQUIRED', field: 'evidenceGenerationInput',
    reason: 'Evidence Generation Inputがありません。',
    correctionHint: 'VERIFIED後にEvidence生成準備を実行してください。' }, 'BLOCKED');
  clearAfter(session, 'EVIDENCE_IMPORTED');
  session.evidencePackage = structuredClone(evidencePackage);
  const result = importEvidencePackage({ generationInput: session.evidenceGenerationInput,
    evidencePackage });
  session.evidenceImportResult = result;
  session.issues = result.errors.map(normalizedIssue);
  session.waitingFor = result.status === 'INVALID' ? 'WAITING_EXTERNAL_EVIDENCE' : null;
  if (result.status === 'VALID') {
    session.stage = 'PROGRESSION_PLAN'; session.workflowState = 'EVIDENCE_READY';
  } else {
    session.stage = 'EVIDENCE_GENERATION';
    session.workflowState = result.status === 'INVALID' ? 'NEEDS_REVISION' : 'BLOCKED';
  }
  return authorView(session);
}

function buildPlan(session, draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)
    || Object.keys(draft).some(key => !planFields.includes(key))
    || planFields.some(key => !Object.hasOwn(draft, key))) {
    throw new ValidationError('INVALID_PROGRESSION_PLAN_INPUT', 'progressionPlan',
      'Game Progression Plan入力の必須fieldまたは未知fieldを確認してください。');
  }
  const set = session.evidenceImportResult.evidenceSet;
  if (draft.schemaVersion !== '1.0' || draft.scenarioId !== set.scenarioId
    || draft.evidenceSetId !== set.evidenceSetId
    || JSON.stringify(draft.attackGraphRef) !== JSON.stringify(set.attackGraphRef)) {
    throw new ValidationError('PROGRESSION_PLAN_SOURCE_MISMATCH', 'progressionPlan',
      'Planが現在のScenario、Evidence Set、Attack Graphを参照していません。');
  }
  return buildGameProgressionPlan(draft);
}

function conversionInput(session, progressionPlan) {
  const set = session.evidenceImportResult.evidenceSet;
  return buildGameCaseConversionInput({
    evidenceImportResult: session.evidenceImportResult,
    gameCaseHandoff: session.evidenceImportResult.gameCaseHandoff,
    evidenceSet: set, scenarioPackage: session.scenarioPackage,
    characters: session.scenarioPackage.characters, timeline: session.scenarioPackage.timeline,
    verificationResult: session.verificationResult, progressionPlan,
    scenarioGenerationInput: session.selectedOption.generationInput,
    contradictions: set.contradictions, exonerations: set.exonerations });
}

export function previewAuthorProgression(session, progressionPlanDraft) {
  if (session.evidenceImportResult?.status !== 'VALID') return {
    status: 'INVALID', progressionPlan: null, issues: [normalizedIssue({
      code: 'EVIDENCE_NOT_VALID', field: 'evidenceImportResult.status',
      reason: 'VALIDなEvidence Import Resultが必要です。',
      correctionHint: 'Evidence JSONを修正し、再Importしてください。' })],
  };
  try {
    const progressionPlan = buildPlan(session, progressionPlanDraft);
    const result = convertGameCase(conversionInput(session, progressionPlan));
    if (result.status !== 'READY') return { status: 'INVALID', progressionPlan,
      issues: result.errors.map(normalizedIssue) };
    return { status: 'VALID', progressionPlan, issues: [] };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { status: 'INVALID', progressionPlan: null,
      issues: [normalizedIssue({ code: error.code, field: error.field, reason: error.message,
        correctionHint: 'Builderの該当入力と表示された参照候補を確認してください。' })] };
  }
}

function replayWorkflow(session, courtAttemptLimit) {
  const values = {
    INPUT_VALIDATION: session.inputValidationArtifact,
    CANDIDATE_BUILDER: session.candidateResult,
    ATTACK_GRAPH: session.selectedOption.graphResult,
    SCENARIO_IMPORT: session.scenarioImportResult,
    VERIFICATION: session.verificationResult,
    EVIDENCE_IMPORT: session.evidenceImportResult,
    GAME_CASE_CONVERSION: session.gameCaseResult,
    GAME_PROGRESSION: session.gameCaseResult,
    GAME_MAKE: session.gameMakeResult,
    EVALUATION: session.evaluationResult,
  };
  let workflow = createOrchestrator({
    inputFingerprint: session.inputValidationArtifact.inputFingerprint, courtAttemptLimit });
  for (const gate of WORKFLOW_GATES) workflow = advanceWorkflow(workflow,
    { gate, artifact: values[gate], upstreamFingerprint: workflow.chainFingerprint });
  return workflow;
}

export function buildAuthorGame(session, progressionPlanDraft) {
  if (session.evidenceImportResult?.status !== 'VALID') return failed(session, {
    code: 'EVIDENCE_NOT_VALID', field: 'evidenceImportResult.status',
    reason: 'VALIDなEvidence Import Resultが必要です。',
    correctionHint: 'Evidence JSONを修正し、再Importしてください。' }, 'BLOCKED');
  try {
    clearAfter(session, 'EVIDENCE_IMPORTED');
    const progressionPlan = buildPlan(session, progressionPlanDraft);
    session.progressionPlan = progressionPlan;
    const set = session.evidenceImportResult.evidenceSet;
    session.gameCaseResult = convertGameCase(conversionInput(session, progressionPlan));
    const built = buildGeneratedGame(session.gameCaseResult);
    session.gameMakeResult = built.gameMakeResult; session.runtime = built.runtime;
    if (session.gameCaseResult.status !== 'READY' || session.gameMakeResult.status !== 'BUILT') {
      session.stage = 'PROGRESSION_PLAN'; session.workflowState = 'BLOCKED';
      session.issues = [...session.gameCaseResult.errors,
        ...session.gameMakeResult.errors].map(normalizedIssue);
      return authorView(session);
    }
    const evaluationInput = buildGameEvaluationInput({ gameMakeResult: session.gameMakeResult,
      gameCaseResult: session.gameCaseResult, evidenceSet: set,
      verificationResult: session.verificationResult, scenarioPackage: session.scenarioPackage });
    session.evaluationResult = evaluateGame(evaluationInput);
    session.workflow = replayWorkflow(session, progressionPlan.retryPolicy.maxCourtAttempts);
    session.workflowState = session.workflow.currentState;
    session.stage = session.workflow.currentState === 'ACCEPTED' ? 'ACCEPTED' : 'BUILD';
    session.issues = session.workflow.issues.map(normalizedIssue);
    if (session.workflow.currentState !== 'ACCEPTED') session.runtime = null;
    return authorView(session);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    session.stage = 'PROGRESSION_PLAN';
    return failed(session, { code: error.code, field: error.field, reason: error.message,
      correctionHint: '表示されたEvidence、Testimony、Statement IDだけを使い、必須値を明示してください。' },
    'BLOCKED');
  }
}

export function buildAuthorXssPrototype(session) {
  if (!session.prototypeSelection) return failed(session, { code: 'XSS_SELECTION_REQUIRED',
    field: 'prototypeSelection', reason: '固定NetworkとDifficultyが選択されていません。',
    correctionHint: '最初の画面からXSSプロトタイプ生成をやり直してください。' }, 'BLOCKED');
  if (session.verificationResult?.status !== 'VERIFIED') return failed(session, {
    code: 'SCENARIO_NOT_VERIFIED', field: 'verificationResult.status',
    reason: 'VERIFIEDなScenarioだけがXSSプロトタイプBuildへ進めます。',
    correctionHint: '独立Verification Reviewを通過させてください。' }, 'BLOCKED');
  try {
    session.runtime = buildXssPrototype({ selection: session.prototypeSelection,
      verificationResult: session.verificationResult });
    session.prototypeEvaluation = evaluateXssPrototype(session.runtime);
    session.evaluationResult = session.prototypeEvaluation;
    session.workflowState = session.prototypeEvaluation.status === 'ACCEPTED' ? 'ACCEPTED' : 'BLOCKED';
    session.stage = session.workflowState;
    session.issues = session.prototypeEvaluation.issues.map(code => normalizedIssue({ code,
      field: 'prototype', reason: 'XSSプロトタイプ評価に失敗しました。',
      correctionHint: '固定Networkと検証済みScenarioの整合性を確認してください。' }));
    if (session.workflowState !== 'ACCEPTED') session.runtime = null;
    return authorView(session);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return failed(session, error, 'BLOCKED');
  }
}
