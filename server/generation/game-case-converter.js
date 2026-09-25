import { ValidationError } from './schema.js';
import { digest } from './evidence-validator.js';
import {
  GAME_CASE_SYNOPSIS,
  GAME_CASE_TITLE,
  conversionInputCore,
  deriveGameCaseParts,
  gameCaseCore,
  projectPublicGameCase,
  validateGameCaseBundle,
  validateGameCaseConversionInput,
  validateGameProgressionPlan,
  validateGameCaseResult,
  validateUiIntegrationHandoff,
} from './game-case-validator.js';

function inputRef(input) {
  if (!input?.conversionInputId || !input?.inputFingerprint) return null;
  return { conversionInputId: input.conversionInputId, inputFingerprint: input.inputFingerprint };
}

export function buildGameProgressionPlan({ scenarioId, evidenceSetId, attackGraphRef,
  initialCourtEvidenceIds, initialCourtStatementIds, investigationEvidenceIds,
  investigationActions, investigationTargets, evidenceDiscoveryRules, initialAvailableTargetIds,
  retrialStatementIds, returnToCourtCondition, courtRoundCount = 1, courtIssueMode,
  courtQuestions, materialInvestigations, investigationMode, objectionRules, retryPolicy, publicMessages }) {
  const core = structuredClone({ scenarioId, evidenceSetId, attackGraphRef,
    initialCourtEvidenceIds, initialCourtStatementIds, investigationEvidenceIds,
    investigationActions, investigationTargets, evidenceDiscoveryRules, initialAvailableTargetIds,
    retrialStatementIds, returnToCourtCondition, courtRoundCount,
    ...(courtIssueMode ? { courtIssueMode } : {}),
    ...(courtQuestions ? { courtQuestions } : {}),
    ...(materialInvestigations ? { materialInvestigations } : {}),
    ...(investigationMode ? { investigationMode } : {}),
    objectionRules, retryPolicy, publicMessages });
  const fingerprint = digest(core);
  return validateGameProgressionPlan({ schemaVersion: '1.0',
    planId: `progression_plan_${fingerprint.slice(0, 20)}`, ...core, fingerprint });
}

export function buildGameCaseConversionInput({ evidenceImportResult, gameCaseHandoff, evidenceSet,
  scenarioPackage, characters, timeline, verificationResult, progressionPlan,
  scenarioGenerationInput, contradictions, exonerations }) {
  const core = structuredClone({ evidenceImportResult, gameCaseHandoff, evidenceSet, scenarioPackage,
    characters, timeline, verificationResult, progressionPlan, scenarioGenerationInput,
    contradictions, exonerations });
  const inputFingerprint = digest(core);
  return validateGameCaseConversionInput({ schemaVersion: '1.0',
    conversionInputId: `game_case_input_${inputFingerprint.slice(0, 20)}`, inputFingerprint, ...core });
}

function makeGameCase(input) {
  const parts = deriveGameCaseParts(input);
  const base = {
    scenarioId: input.evidenceSet.scenarioId,
    verificationId: input.evidenceSet.verificationId,
    evidenceSetId: input.evidenceSet.evidenceSetId,
    attackGraphRef: structuredClone(input.evidenceSet.attackGraphRef),
    title: GAME_CASE_TITLE, synopsis: GAME_CASE_SYNOPSIS, ...parts,
    provenance: {
      conversionInputFingerprint: input.inputFingerprint,
      scenarioPackageFingerprint: input.verificationResult.evidenceAgentHandoff.scenarioPackageFingerprint,
      evidenceSetFingerprint: input.evidenceSet.fingerprint,
      progressionPlanFingerprint: input.progressionPlan.fingerprint,
      gameCaseHandoffId: input.gameCaseHandoff.handoffId,
      timelineId: input.timeline.timelineId,
      characterSetId: input.characters.characterSetId,
    },
  };
  const fingerprint = digest(base);
  return { schemaVersion: '1.0', gameCaseId: `game_case_${fingerprint.slice(0, 20)}`,
    ...base, fingerprint };
}

function makeUiIntegrationHandoff(gameCase, publicGameCase) {
  return validateUiIntegrationHandoff({ schemaVersion: '1.0',
    handoffId: `ui_handoff_${gameCase.fingerprint.slice(0, 20)}`,
    gameCaseId: gameCase.gameCaseId, gameCaseFingerprint: gameCase.fingerprint,
    publicGameCaseFingerprint: digest(publicGameCase), scenarioId: gameCase.scenarioId,
    progressionFingerprint: digest(gameCase.progression),
    evidenceSetId: gameCase.evidenceSetId, verificationId: gameCase.verificationId,
    state: 'GAME_CASE_READY', eligibleForUiIntegration: true,
  }, gameCase, publicGameCase);
}

function blocked(input, error) {
  return validateGameCaseResult({ schemaVersion: '1.0', status: 'BLOCKED', ready: false,
    scope: 'GAME_CASE_CONVERSION', conversionInputRef: inputRef(input),
    errors: [{ code: error.code ?? 'GAME_CASE_CONVERSION_BLOCKED',
      field: error.field ?? 'game-case-conversion-input', reason: error.message,
      sourceRefs: ['phase8:conversion-input'] }],
    gameCase: null, publicGameCase: null, uiIntegrationHandoff: null });
}

// 既存の検証済み成果物を投影するだけで、新しい事件・人物・証拠・技術事実は生成しない。
export function convertGameCase(conversionInput) {
  try {
    validateGameCaseConversionInput(conversionInput);
    const gameCase = makeGameCase(conversionInput);
    const publicGameCase = projectPublicGameCase(gameCase);
    validateGameCaseBundle({ input: conversionInput, gameCase, publicGameCase });
    const uiIntegrationHandoff = makeUiIntegrationHandoff(gameCase, publicGameCase);
    return validateGameCaseResult({ schemaVersion: '1.0', status: 'READY', ready: true,
      scope: 'GAME_CASE_CONVERSION', conversionInputRef: inputRef(conversionInput), errors: [],
      gameCase, publicGameCase, uiIntegrationHandoff });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return blocked(conversionInput, error);
  }
}

export { gameCaseCore };
