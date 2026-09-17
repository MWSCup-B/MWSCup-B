import { evaluateObjection } from './generation/game-case-validator.js';
import { GameError } from './game.js';

export function createGeneratedGame(runtime) {
  if (!runtime || runtime.mode !== 'GENERATED') throw new GameError('GAME_BUILD_BLOCKED',
    'game', 'Generated Game Caseを開始できません。', 503);
  return { gameCaseId: runtime.gameCase.gameCaseId, currentState: 'TITLE',
    collectedEvidenceIds: [], selectedStatementId: null, attemptCount: 0,
    previousAttempts: [], result: null };
}

function characterMap(publicCase) {
  return new Map(publicCase.characters.map(item => [item.characterId, item]));
}

function evidenceMap(publicCase) {
  return new Map(publicCase.detective.evidence.map(item => [item.evidenceId, item]));
}

function publicEvidence(item) {
  return { evidenceId: item.evidenceId, title: item.title, type: item.type,
    publicContent: item.publicContent };
}

export function generatedPlayerView(session, runtime) {
  const publicCase = runtime.publicGameCase;
  const characters = characterMap(publicCase);
  const evidence = evidenceMap(publicCase);
  const base = { mode: 'GENERATED', gameCaseId: publicCase.gameCaseId,
    currentState: session.currentState, title: publicCase.title, synopsis: publicCase.synopsis,
    attemptCount: session.attemptCount, result: session.result };
  if (session.currentState === 'TITLE') return base;
  if (session.currentState === 'INITIAL_COURT') {
    const court = publicCase.progression.initialCourt;
    return { ...base, initialCourt: {
      prosecutionStatements: court.prosecutionStatements.map(item => ({ ...item,
        speaker: characters.get(item.speakerCharacterId) })),
      presentedEvidence: court.presentedEvidenceIds.map(id => publicEvidence(evidence.get(id))),
      publicRuling: court.publicRuling, attributionStatus: court.attributionStatus } };
  }
  if (session.currentState === 'INVESTIGATION') {
    const allowed = new Set(publicCase.progression.investigation.availableEvidenceIds);
    const collected = new Set(session.collectedEvidenceIds);
    return { ...base,
      evidenceCandidates: publicCase.detective.evidence.filter(item => allowed.has(item.evidenceId))
        .map(item => ({ evidenceId: item.evidenceId, title: item.title, type: item.type,
          collected: collected.has(item.evidenceId) })),
      collectedEvidence: publicCase.detective.evidence
        .filter(item => collected.has(item.evidenceId)).map(publicEvidence) };
  }
  if (session.currentState === 'RETRIAL_COURT') {
    const collected = new Set(session.collectedEvidenceIds);
    return { ...base, testimonies: publicCase.progression.retrialCourt.testimonies.map(testimony => ({
      ...testimony, speaker: characters.get(testimony.speakerCharacterId) })),
    presentableEvidence: publicCase.detective.evidence.filter(item => collected.has(item.evidenceId)
      && publicCase.progression.retrialCourt.presentableEvidenceIds.includes(item.evidenceId))
      .map(publicEvidence) };
  }
  if (session.currentState === 'GUILTY_RETRY') return { ...base,
    publicFailureFeedback: publicCase.progression.retry.publicFailureFeedback };
  if (session.currentState === 'ACQUITTED') return { ...base,
    acquittal: { ...publicCase.progression.outcomes.acquitted } };
  if (session.currentState === 'BLOCKED') return { ...base,
    blockedMessage: '法廷での試行回数が上限に達したため、このゲームを続行できません。' };
  throw new GameError('INVALID_STATE', 'state', '公開できないゲーム状態です。', 500);
}

function requireState(session, state) {
  if (session.currentState !== state) throw new GameError('INVALID_STATE', 'action',
    '現在の状態では実行できない操作です。', 409);
}

export function actGenerated(session, runtime, { action, evidenceId, statementId }) {
  const publicCase = runtime.publicGameCase;
  const internal = runtime.gameCase;
  if (action === 'begin') {
    requireState(session, 'TITLE'); session.currentState = 'INITIAL_COURT';
  } else if (action === 'continue') {
    requireState(session, 'INITIAL_COURT'); session.currentState = 'INVESTIGATION';
  } else if (action === 'collect') {
    requireState(session, 'INVESTIGATION');
    if (typeof evidenceId !== 'string'
      || !publicCase.progression.investigation.availableEvidenceIds.includes(evidenceId)) {
      throw new GameError('UNKNOWN_EVIDENCE', 'evidenceId', '調査可能な証拠を選んでください。');
    }
    if (!session.collectedEvidenceIds.includes(evidenceId)) session.collectedEvidenceIds.push(evidenceId);
  } else if (action === 'retrial') {
    requireState(session, 'INVESTIGATION');
    const investigation = internal.progression.investigation;
    const allowed = investigation.returnToCourtCondition === 'ALL_REQUIRED_EVIDENCE_COLLECTED'
      ? investigation.requiredForCourtIds.every(id => session.collectedEvidenceIds.includes(id))
      : session.collectedEvidenceIds.length > 0;
    if (!allowed) throw new GameError('COURT_RETURN_CONDITION_NOT_MET', 'evidence',
      '証拠の調査が不足しています。', 409);
    session.currentState = 'RETRIAL_COURT';
  } else if (action === 'objection') {
    requireState(session, 'RETRIAL_COURT');
    if (typeof statementId !== 'string') throw new GameError('STATEMENT_REQUIRED',
      'statementId', '指摘するstatementを選択してください。');
    if (typeof evidenceId !== 'string') throw new GameError('EVIDENCE_REQUIRED',
      'evidenceId', '提示するEvidenceを選択してください。');
    if (!session.collectedEvidenceIds.includes(evidenceId)) throw new GameError('EVIDENCE_NOT_OWNED',
      'evidenceId', '取得済みEvidenceだけを提示できます。');
    session.selectedStatementId = statementId;
    session.currentState = 'OBJECTION';
    let outcome;
    try { outcome = evaluateObjection(internal, { statementId, evidenceId,
      attemptCount: session.attemptCount }); }
    catch (error) {
      session.currentState = 'RETRIAL_COURT';
      throw new GameError(error.code ?? 'INVALID_OBJECTION', error.field ?? 'objection',
        error.message, 400);
    }
    session.attemptCount = outcome.attemptCount;
    session.previousAttempts.push({ statementId, evidenceId, outcome: outcome.outcome });
    session.result = outcome.outcome === 'SUCCESS'
      ? { outcome: 'SUCCESS' }
      : { outcome: 'FAILURE', publicFeedback: outcome.publicFailureFeedback };
    session.currentState = outcome.nextState === 'ACQUITTED' ? 'ACQUITTED'
      : outcome.nextState === 'BLOCKED' ? 'BLOCKED' : 'GUILTY_RETRY';
  } else if (action === 'retry') {
    requireState(session, 'GUILTY_RETRY'); session.currentState = 'INVESTIGATION';
    session.selectedStatementId = null;
  } else {
    throw new GameError('UNKNOWN_ACTION', 'action', '未登録の操作です。');
  }
  return generatedPlayerView(session, runtime);
}
