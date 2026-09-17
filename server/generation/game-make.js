import { digest } from './evidence-validator.js';
import { validateGameCaseResult, validateUiIntegrationHandoff }
  from './game-case-validator.js';
import { ValidationError, fail, validateDocument } from './schema.js';

export const UI_API_CONTRACT = Object.freeze({ schemaVersion: '1.0',
  states: ['TITLE', 'INITIAL_COURT', 'INVESTIGATION', 'RETRIAL_COURT',
    'OBJECTION', 'ACQUITTED', 'GUILTY_RETRY', 'BLOCKED'],
  actions: {
    TITLE: ['begin'], INITIAL_COURT: ['continue'], INVESTIGATION: ['collect', 'retrial'],
    RETRIAL_COURT: ['objection'], GUILTY_RETRY: ['retry'],
    OBJECTION: [], ACQUITTED: [], BLOCKED: [],
  },
  objectionInputs: ['statementId', 'evidenceId'], rendering: 'TEXT_CONTENT_ONLY' });

function validateGameMakeResult(result) {
  validateDocument('game-make-result', result);
  if ((result.status === 'BUILT') !== result.built) fail('INVALID_GAME_MAKE_RESULT',
    'game-make-result.status', 'statusとbuiltが一致しません。');
  if (result.status === 'BUILT') {
    if (!result.buildId || !result.buildFingerprint || !result.gameCaseId
      || result.errors.length || !result.evaluationHandoff) fail('INVALID_GAME_MAKE_RESULT',
      'game-make-result', 'BUILTに必要な成果物がありません。');
    validateDocument('evaluation-handoff', result.evaluationHandoff);
  } else if (result.buildId || result.buildFingerprint || result.gameCaseId
    || !result.errors.length || result.evaluationHandoff) fail('INVALID_GAME_MAKE_RESULT',
    'game-make-result', 'BLOCKEDが部分成果物を保持しています。');
  return result;
}

function blocked(error) {
  return validateGameMakeResult({ schemaVersion: '1.0', status: 'BLOCKED', built: false,
    buildId: null, buildFingerprint: null, gameCaseId: null,
    errors: [{ code: error.code ?? 'GAME_MAKE_BLOCKED', field: error.field ?? 'game-make',
      reason: error.message }], evaluationHandoff: null });
}

export function buildGeneratedGame(gameCaseResult) {
  try {
    validateGameCaseResult(gameCaseResult);
    if (gameCaseResult.status !== 'READY' || !gameCaseResult.ready) {
      fail('GAME_CASE_NOT_READY', 'game-case-result.status',
        'READYなGame CaseだけをUIへ統合できます。');
    }
    const { gameCase, publicGameCase, uiIntegrationHandoff } = gameCaseResult;
    validateUiIntegrationHandoff(uiIntegrationHandoff, gameCase, publicGameCase);
    const buildCore = { gameCaseId: gameCase.gameCaseId,
      gameCaseFingerprint: gameCase.fingerprint,
      publicGameCaseFingerprint: digest(publicGameCase),
      progressionFingerprint: digest(gameCase.progression), uiApiContract: UI_API_CONTRACT };
    const buildFingerprint = digest(buildCore);
    const buildId = `build_${buildFingerprint.slice(0, 20)}`;
    const evaluationHandoff = { schemaVersion: '1.0', buildId, buildFingerprint,
      gameCaseId: gameCase.gameCaseId, gameCaseFingerprint: gameCase.fingerprint,
      progressionFingerprint: digest(gameCase.progression), state: 'BUILT',
      eligibleForEvaluation: true };
    const gameMakeResult = validateGameMakeResult({ schemaVersion: '1.0', status: 'BUILT',
      built: true, buildId, buildFingerprint, gameCaseId: gameCase.gameCaseId,
      errors: [], evaluationHandoff });
    return { gameMakeResult, runtime: Object.freeze({ mode: 'GENERATED',
      gameCase, publicGameCase, uiIntegrationHandoff, uiApiContract: UI_API_CONTRACT,
      buildFingerprint }) };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { gameMakeResult: blocked(error), runtime: null };
  }
}

export { validateGameMakeResult };
