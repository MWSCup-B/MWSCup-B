import { evaluateObjection } from './generation/game-case-validator.js';
import { investigationCompletionId, publicInvestigationTarget, validateInvestigationResult }
  from './generation/investigation-validator.js';
import { GameError } from './game.js';

export function createGeneratedGame(runtime) {
  if (!runtime || runtime.mode !== 'GENERATED') throw new GameError('GAME_BUILD_BLOCKED',
    'game', 'Generated Game Caseを開始できません。', 503);
  return { gameCaseId: runtime.gameCase.gameCaseId, currentState: 'TITLE',
    currentRound: 1,
    availableInvestigationTargets:
      [...runtime.gameCase.progression.investigation.initialAvailableTargetIds],
    completedInvestigationActions: [], discoveredEvidenceIds: [], collectedEvidenceIds: [],
    lastInvestigationResult: null, selectedStatementId: null, attemptCount: 0,
    previousAttempts: [], result: null };
}

function characterMap(publicCase) {
  return new Map(publicCase.characters.map(item => [item.characterId, item]));
}

function evidenceMap(internalCase) {
  return new Map(internalCase.detective.evidence.map(item => [item.evidenceId, item]));
}

function publicEvidence(item) {
  return { evidenceId: item.evidenceId, title: item.title, type: item.type,
    publicContent: item.publicContent };
}

export function generatedPlayerView(session, runtime) {
  const publicCase = runtime.publicGameCase;
  const characters = characterMap(publicCase);
  const evidence = evidenceMap(runtime.gameCase);
  const evidenceItems = runtime.gameCase.detective.evidence;
  const base = { mode: 'GENERATED', gameCaseId: publicCase.gameCaseId,
    currentState: session.currentState, title: publicCase.title, synopsis: publicCase.synopsis,
    currentRound: session.currentRound, totalRounds: runtime.roundCount ?? 1,
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
    const availableTargets = new Set(session.availableInvestigationTargets);
    const completedActions = new Set(session.completedInvestigationActions);
    const discovered = new Set(session.discoveredEvidenceIds);
    const collected = new Set(session.collectedEvidenceIds);
    const actions = new Map(publicCase.detective.investigationActions
      .map(item => [item.actionId, item]));
    return { ...base,
      investigationTargets: runtime.gameCase.detective.investigationTargets
        .filter(item => availableTargets.has(item.targetId)).map(publicInvestigationTarget).map(item => ({
          targetId: item.targetId, targetType: item.targetType, displayName: item.displayName,
          description: item.description, availableActions: item.availableActionIds.map(actionId => ({
            ...actions.get(actionId), completed: completedActions.has(
              investigationCompletionId(item.targetId, actionId)),
          })),
        })),
      lastInvestigationResult: structuredClone(session.lastInvestigationResult),
      discoveredEvidence: evidenceItems.filter(item => discovered.has(item.evidenceId))
        .map(item => ({ ...publicEvidence(item),
          discoveryState: collected.has(item.evidenceId) ? 'COLLECTED' : 'DISCOVERED' })),
      collectedEvidence: evidenceItems.filter(item => collected.has(item.evidenceId))
        .map(publicEvidence) };
  }
  if (session.currentState === 'RETRIAL_COURT') {
    const collected = new Set(session.collectedEvidenceIds);
    return { ...base, testimonies: publicCase.progression.retrialCourt.testimonies.map(testimony => ({
      ...testimony, speaker: characters.get(testimony.speakerCharacterId) })),
    presentableEvidence: evidenceItems.filter(item => collected.has(item.evidenceId)
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

export function actGenerated(session, runtime, { action, evidenceId, statementId,
  targetId, investigationActionId }) {
  const publicCase = runtime.publicGameCase;
  const internal = runtime.gameCase;
  if (action === 'begin') {
    requireState(session, 'TITLE'); session.currentState = 'INITIAL_COURT';
  } else if (action === 'continue') {
    requireState(session, 'INITIAL_COURT'); session.currentState = 'INVESTIGATION';
  } else if (action === 'investigate') {
    requireState(session, 'INVESTIGATION');
    const target = internal.detective.investigationTargets.find(item => item.targetId === targetId);
    if (typeof targetId !== 'string' || !target
      || !session.availableInvestigationTargets.includes(targetId)) {
      throw new GameError('UNKNOWN_INVESTIGATION_TARGET', 'targetId',
        '現在調査可能な対象を選んでください。');
    }
    const investigationAction = internal.detective.investigationActions
      .find(item => item.actionId === investigationActionId);
    if (typeof investigationActionId !== 'string' || !investigationAction
      || !target.availableActionIds.includes(investigationActionId)
      || !investigationAction.allowedTargetTypes.includes(target.targetType)) {
      throw new GameError('INVESTIGATION_ACTION_NOT_AVAILABLE', 'investigationActionId',
        'この対象で利用可能な調査方法を選んでください。');
    }
    const discovered = new Set(session.discoveredEvidenceIds);
    const completed = new Set(session.completedInvestigationActions);
    const matching = internal.detective.evidenceDiscoveryRules.filter(rule =>
      rule.targetId === targetId && rule.actionId === investigationActionId
      && rule.prerequisites.requiredEvidenceIds.every(id => discovered.has(id))
      && rule.prerequisites.requiredCompletedActionIds.every(id => completed.has(id))
      && (rule.repeatable || !discovered.has(rule.evidenceId)));
    const completionId = investigationCompletionId(targetId, investigationActionId);
    if (!completed.has(completionId)) session.completedInvestigationActions.push(completionId);
    const newEvidenceIds = [];
    const unlockedTargetIds = [];
    const nextHints = [];
    for (const rule of matching) {
      if (!discovered.has(rule.evidenceId)) {
        discovered.add(rule.evidenceId); session.discoveredEvidenceIds.push(rule.evidenceId);
        newEvidenceIds.push(rule.evidenceId);
      }
      for (const id of rule.discoveryResult.unlockedTargetIds) {
        if (!session.availableInvestigationTargets.includes(id)) {
          session.availableInvestigationTargets.push(id); unlockedTargetIds.push(id);
        }
      }
      nextHints.push(...rule.discoveryResult.nextHints);
    }
    const messages = matching.map(rule => rule.discoveryResult.publicMessage);
    const result = validateInvestigationResult({ schemaVersion: '1.0', targetId,
      investigationActionId,
      publicMessage: messages.length ? messages.join('\n') : '新しいEvidenceは見つかりませんでした。',
      discovered: newEvidenceIds.length > 0, discoveredEvidenceIds: newEvidenceIds,
      unlockedTargetIds, nextHints: [...new Set(nextHints)] });
    session.lastInvestigationResult = result;
  } else if (action === 'collect') {
    requireState(session, 'INVESTIGATION');
    if (typeof evidenceId !== 'string' || !session.discoveredEvidenceIds.includes(evidenceId)) {
      throw new GameError('EVIDENCE_NOT_DISCOVERED', 'evidenceId',
        '調査で発見済みのEvidenceだけを証拠品として取得できます。');
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
    const hasNextRound = outcome.outcome === 'SUCCESS'
      && session.currentRound < (runtime.roundCount ?? 1);
    session.result = outcome.outcome === 'SUCCESS'
      ? { outcome: 'SUCCESS', objection: '異議あり！！', hasNextRound }
      : { outcome: 'FAILURE', publicFeedback: outcome.publicFailureFeedback };
    if (hasNextRound) { session.currentRound += 1; session.attemptCount = 0;
      session.currentState = 'INVESTIGATION';
      session.selectedStatementId = null; }
    else session.currentState = outcome.nextState === 'ACQUITTED' ? 'ACQUITTED'
      : outcome.nextState === 'BLOCKED' ? 'BLOCKED' : 'GUILTY_RETRY';
  } else if (action === 'retry') {
    requireState(session, 'GUILTY_RETRY'); session.currentState = 'INVESTIGATION';
    session.selectedStatementId = null;
  } else {
    throw new GameError('UNKNOWN_ACTION', 'action', '未登録の操作です。');
  }
  return generatedPlayerView(session, runtime);
}
