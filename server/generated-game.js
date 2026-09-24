import { evaluateObjection } from './generation/game-case-validator.js';
import { investigationCompletionId, publicInvestigationTarget, validateInvestigationResult }
  from './generation/investigation-validator.js';
import { GameError } from './game.js';
import { isSequential, stageEvidenceIds } from './generation/sequential-investigation.js';
import { publicCourtQuestion } from './generation/court-questions.js';
import { generatedSceneDialogue } from './generation/dialogue-template.js';

export function createGeneratedGame(runtime) {
  if (!runtime || runtime.mode !== 'GENERATED') throw new GameError('GAME_BUILD_BLOCKED',
    'game', 'Generated Game Caseを開始できません。', 503);
  return { gameCaseId: runtime.gameCase.gameCaseId, currentState: 'TITLE',
    currentRound: 1,
    availableInvestigationTargets:
      [...runtime.gameCase.progression.investigation.initialAvailableTargetIds],
    completedInvestigationActions: [], discoveredEvidenceIds: [], collectedEvidenceIds: [],
    lastInvestigationResult: null, selectedStatementId: null, selectedInterpretationChoiceId: null, attemptCount: 0,
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

function prerequisitesMet(rule, discovered, completed) {
  return rule.prerequisites.requiredEvidenceIds.every(id => discovered.has(id))
    && rule.prerequisites.requiredCompletedActionIds.every(id => completed.has(id));
}

function canReturnToCourt(session, internal) {
  if (isSequential(internal)) return stageEvidenceIds(internal, session.currentRound)
    .every(id => session.collectedEvidenceIds.includes(id));
  const investigation = internal.progression.investigation;
  return investigation.returnToCourtCondition === 'ALL_REQUIRED_EVIDENCE_COLLECTED'
    ? investigation.requiredForCourtIds.every(id => session.collectedEvidenceIds.includes(id))
    : internal.courtroom.presentableEvidenceIds.some(id => session.collectedEvidenceIds.includes(id));
}

// Sequential play opens the current desk's documents as one operation. Reuse
// the validated discovery routes; do not bypass prerequisites or open later desks.
function prepareStageEvidence(session, runtime) {
  const draft = structuredClone(session);
  const targetId = runtime.gameCase.progression.courtIssues[draft.currentRound - 1].investigationTargetId;
  const target = runtime.gameCase.detective.investigationTargets.find(item => item.targetId === targetId);
  const required = stageEvidenceIds(runtime.gameCase, draft.currentRound);
  const limit = required.length + target.availableActionIds.length + 1;
  for (let pass = 0; pass < limit; pass += 1) {
    if (required.every(id => draft.discoveredEvidenceIds.includes(id))) break;
    const before = draft.discoveredEvidenceIds.length + draft.completedInvestigationActions.length;
    for (const investigationActionId of target.availableActionIds) {
      actGenerated(draft, runtime, { action: 'investigate', targetId, investigationActionId });
    }
    if (before === draft.discoveredEvidenceIds.length + draft.completedInvestigationActions.length) break;
  }
  if (!required.every(id => draft.discoveredEvidenceIds.includes(id))) throw new GameError(
    'STAGE_EVIDENCE_UNAVAILABLE', 'investigation', '今回の調査資料を取得できません。資料の取得条件を確認してください。', 409);
  for (const evidenceId of required) actGenerated(draft, runtime, { action: 'collect', evidenceId });
  Object.assign(session, draft);
}

export function generatedPlayerView(session, runtime) {
  const view = playerView(session, runtime);
  if (isSequential(runtime.gameCase)) view.dialogue = generatedSceneDialogue(view);
  return view;
}

function playerView(session, runtime) {
  const publicCase = runtime.publicGameCase;
  const characters = characterMap(publicCase);
  const evidence = evidenceMap(runtime.gameCase);
  const evidenceItems = runtime.gameCase.detective.evidence;
  const totalRounds = runtime.gameCase.progression.courtRoundCount;
  const issue = runtime.gameCase.progression.courtIssues?.[session.currentRound - 1];
  const base = { mode: 'GENERATED', gameCaseId: publicCase.gameCaseId,
    ...(isSequential(runtime.gameCase) ? { investigationMode: 'SEQUENTIAL_TARGETS' } : {}),
    currentState: session.currentState, title: publicCase.title, synopsis: publicCase.synopsis,
    answerMode: publicCase.progression.courtQuestions ? 'INTERPRETATION_AND_EVIDENCE' : 'STATEMENT_AND_EVIDENCE',
    participants: publicCase.characters.filter(item => ['DEFENDANT', 'WITNESS'].includes(item.publicRole)),
    currentRound: session.currentRound, totalRounds,
    remainingAttempts: Math.max(0, runtime.gameCase.progression.retryPolicy.maxCourtAttempts - session.attemptCount),
    attemptCount: session.attemptCount, result: session.result };
  if (session.currentState === 'TITLE') return base;
  if (session.currentState === 'INITIAL_COURT') {
    const court = publicCase.progression.initialCourt;
    return { ...base, initialCourt: {
      prosecutionStatements: court.prosecutionStatements.map(item => ({ ...item,
        speaker: characters.get(item.speakerCharacterId) })),
      presentedEvidence: court.presentedEvidenceIds.map(id => publicEvidence(evidence.get(id))),
      ...(court.incidentOverview ? { incidentOverview: court.incidentOverview } : {}),
      ...(court.prosecutionOpening ? { prosecutionOpening: court.prosecutionOpening } : {}),
      publicRuling: court.publicRuling, attributionStatus: court.attributionStatus } };
  }
  if (session.currentState === 'INVESTIGATION') {
    const availableTargets = new Set(isSequential(runtime.gameCase)
      ? [issue.investigationTargetId] : session.availableInvestigationTargets);
    const completedActions = new Set(session.completedInvestigationActions);
    const discovered = new Set(session.discoveredEvidenceIds);
    const collected = new Set(session.collectedEvidenceIds);
    const actions = new Map(publicCase.detective.investigationActions
      .map(item => [item.actionId, item]));
    const testimony = isSequential(runtime.gameCase) ? publicCase.courtroom.testimonies
      .find(item => item.statements.some(statement => statement.statementId === issue.question.statementId)) : null;
    return { ...base,
      canReturnToCourt: canReturnToCourt(session, runtime.gameCase),
      ...(isSequential(runtime.gameCase) && canReturnToCourt(session, runtime.gameCase)
        ? { courtQuestion: publicCourtQuestion(issue.question), investigationClaim: {
          spokenContent: testimony.statements.find(item => item.statementId === issue.question.statementId).spokenContent,
          speaker: characters.get(testimony.speakerCharacterId),
        } } : {}),
      investigationTargets: runtime.gameCase.detective.investigationTargets
        .filter(item => availableTargets.has(item.targetId)).map(publicInvestigationTarget).map(item => ({
          targetId: item.targetId, targetType: item.targetType, displayName: item.displayName,
          description: item.description, availableActions: item.availableActionIds.map(actionId => {
            const rules = runtime.gameCase.detective.evidenceDiscoveryRules.filter(rule =>
              rule.targetId === item.targetId && rule.actionId === actionId);
            const remaining = rules.filter(rule => !discovered.has(rule.evidenceId));
            const completionId = investigationCompletionId(item.targetId, actionId);
            const preparesAnotherAction = !completedActions.has(completionId)
              && runtime.gameCase.detective.evidenceDiscoveryRules.some(rule =>
                rule.prerequisites.requiredCompletedActionIds.includes(completionId));
            const status = preparesAnotherAction || remaining.some(rule => prerequisitesMet(rule, discovered, completedActions))
              ? 'READY' : remaining.length ? 'WAITING' : 'COMPLETE';
            return { ...actions.get(actionId), status,
              completed: completedActions.has(investigationCompletionId(item.targetId, actionId)) };
          }),
        })),
      lastInvestigationResult: structuredClone(session.lastInvestigationResult),
      discoveredEvidence: evidenceItems.filter(item => discovered.has(item.evidenceId))
        .map(item => ({ ...publicEvidence(item),
          discoveryState: collected.has(item.evidenceId) ? 'COLLECTED' : 'DISCOVERED' })),
      collectedEvidence: evidenceItems.filter(item => collected.has(item.evidenceId))
        .map(publicEvidence),
      ...(isSequential(runtime.gameCase) ? { currentEvidenceIds: stageEvidenceIds(runtime.gameCase, session.currentRound)
        .filter(id => collected.has(id)) } : {}) };
  }
  if (session.currentState === 'RETRIAL_COURT') {
    const collected = new Set(session.collectedEvidenceIds);
    const courtQuestion = publicCase.progression.courtQuestions?.find(question =>
      question.statementId === issue?.question?.statementId);
    return { ...base, canInvestigate: Boolean(issue),
    ...(isSequential(runtime.gameCase) ? { pendingInterpretation: {
      statementId: courtQuestion.statementId,
      ...courtQuestion.choices.find(choice => choice.choiceId === session.selectedInterpretationChoiceId),
    } } : courtQuestion ? { courtQuestion: structuredClone(courtQuestion) } : {}),
    testimonies: publicCase.progression.retrialCourt.testimonies.map(testimony => ({
      ...testimony, statements: testimony.statements.filter(item => !issue || issue.statementIds.includes(item.statementId)),
      speaker: characters.get(testimony.speakerCharacterId) })).filter(item => item.statements.length),
    presentableEvidence: evidenceItems.filter(item => collected.has(item.evidenceId)
      && publicCase.progression.retrialCourt.presentableEvidenceIds.includes(item.evidenceId))
      .map(publicEvidence) };
  }
  if (session.currentState === 'GUILTY_RETRY') return { ...base,
    publicFailureFeedback: publicCase.progression.retry.publicFailureFeedback };
  if (session.currentState === 'ACQUITTED') return { ...base,
    acquittal: { ...publicCase.progression.outcomes.acquitted } };
  if (session.currentState === 'BLOCKED') return { ...base,
    blockedMessage: 'これ以上の提示はできません。今回の審理は、ここで終了です。' };
  throw new GameError('INVALID_STATE', 'state', '公開できないゲーム状態です。', 500);
}

function requireState(session, state) {
  if (session.currentState !== state) throw new GameError('INVALID_STATE', 'action',
    '現在の状態では実行できない操作です。', 409);
}

export function actGenerated(session, runtime, fields) {
  const draft = structuredClone(session);
  const view = applyGeneratedAction(draft, runtime, fields);
  Object.assign(session, draft);
  return view;
}

function applyGeneratedAction(session, runtime, { action, evidenceId, statementId, interpretationChoiceId,
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
      || !session.availableInvestigationTargets.includes(targetId)
      || (isSequential(internal) && targetId !== internal.progression.courtIssues[session.currentRound - 1].investigationTargetId)) {
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
      && prerequisitesMet(rule, discovered, completed)
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
        if (isSequential(internal)) continue; // Only a successful court presentation opens the next target.
        if (!session.availableInvestigationTargets.includes(id)) {
          session.availableInvestigationTargets.push(id); unlockedTargetIds.push(id);
        }
      }
      nextHints.push(...rule.discoveryResult.nextHints);
    }
    const messages = matching.map(rule => rule.discoveryResult.publicMessage);
    const result = validateInvestigationResult({ schemaVersion: '1.0', targetId,
      investigationActionId,
      publicMessage: messages.length ? [...new Set(messages)].join('\n') : '新しい手がかりはなかった。見つけた資料を読み直してみよう。',
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
    const allowed = canReturnToCourt(session, internal);
    if (!allowed) throw new GameError('COURT_RETURN_CONDITION_NOT_MET', 'evidence',
      '証拠の調査が不足しています。', 409);
    if (isSequential(internal)) {
      const question = internal.progression.courtIssues[session.currentRound - 1].question;
      if (!publicCourtQuestion(question).choices.some(choice => choice.choiceId === interpretationChoiceId)) {
        throw new GameError('INTERPRETATION_CHOICE_REQUIRED', 'interpretationChoiceId',
          '調べた資料から分かることを、4択から選んでください。');
      }
      session.selectedInterpretationChoiceId = interpretationChoiceId;
    }
    session.currentState = 'RETRIAL_COURT';
    session.result = null;
  } else if (action === 'investigation') {
    requireState(session, 'RETRIAL_COURT');
    if (!internal.progression.courtIssues) throw new GameError('UNKNOWN_ACTION', 'action',
      'この旧形式のゲームには追加調査操作がありません。');
    session.currentState = 'INVESTIGATION';
    session.result = null;
    session.selectedStatementId = null;
    session.selectedInterpretationChoiceId = null;
  } else if (action === 'objection') {
    requireState(session, 'RETRIAL_COURT');
    if (typeof statementId !== 'string') throw new GameError('STATEMENT_REQUIRED',
      'statementId', '指摘するstatementを選択してください。');
    if (typeof evidenceId !== 'string') throw new GameError('EVIDENCE_REQUIRED',
      'evidenceId', '提示するEvidenceを選択してください。');
    if (!session.collectedEvidenceIds.includes(evidenceId)) throw new GameError('EVIDENCE_NOT_OWNED',
      'evidenceId', '取得済みEvidenceだけを提示できます。');
    if (isSequential(internal)) {
      const issue = internal.progression.courtIssues[session.currentRound - 1];
      if (!issue.statementIds.includes(statementId)) throw new GameError('STATEMENT_NOT_IN_CURRENT_ISSUE',
        'statementId', '今の証言に対して証拠を提示してください。');
      if (interpretationChoiceId !== undefined && interpretationChoiceId !== session.selectedInterpretationChoiceId) {
        throw new GameError('INTERPRETATION_CHANGED_IN_COURT', 'interpretationChoiceId',
          '推理を変えるときは、調査へ戻って選び直してください。');
      }
      interpretationChoiceId = session.selectedInterpretationChoiceId;
    }
    session.selectedStatementId = statementId;
    session.currentState = 'OBJECTION';
    let outcome;
    try { outcome = evaluateObjection(internal, { statementId, evidenceId, interpretationChoiceId,
      attemptCount: session.attemptCount, currentRound: session.currentRound,
      collectedEvidenceIds: session.collectedEvidenceIds }); }
    catch (error) {
      session.currentState = 'RETRIAL_COURT';
      throw new GameError(error.code ?? 'INVALID_OBJECTION', error.field ?? 'objection',
        error.message, 400);
    }
    session.attemptCount = outcome.attemptCount;
    session.previousAttempts.push({ round: session.currentRound, statementId, evidenceId,
      ...(internal.progression.courtIssues?.[session.currentRound - 1]?.question ? { interpretationChoiceId } : {}),
      outcome: outcome.outcome });
    const hasNextRound = outcome.outcome === 'SUCCESS'
      && session.currentRound < internal.progression.courtRoundCount;
    session.result = outcome.outcome === 'SUCCESS'
      ? { outcome: 'SUCCESS', objection: '証言の食い違いを示した！', hasNextRound,
        ...(internal.progression.courtIssues?.[session.currentRound - 1]?.question ? {
          publicExplanation: internal.progression.courtIssues[session.currentRound - 1].question.explanation,
        } : {}) }
      : { outcome: 'FAILURE', publicFeedback: outcome.publicFailureFeedback };
    if (hasNextRound) { session.currentRound += 1; session.attemptCount = 0;
      session.currentState = 'INVESTIGATION';
      session.selectedStatementId = null;
      session.selectedInterpretationChoiceId = null;
      if (isSequential(internal)) {
        session.availableInvestigationTargets = [internal.progression.courtIssues[session.currentRound - 1].investigationTargetId];
        session.lastInvestigationResult = null;
      } }
    else session.currentState = outcome.nextState === 'ACQUITTED' ? 'ACQUITTED'
      : outcome.nextState === 'BLOCKED' ? 'BLOCKED' : isSequential(internal) ? 'INVESTIGATION' : 'GUILTY_RETRY';
    if (isSequential(internal) && session.currentState === 'INVESTIGATION') session.selectedInterpretationChoiceId = null;
  } else if (action === 'retry') {
    requireState(session, 'GUILTY_RETRY'); session.currentState = 'INVESTIGATION';
    session.selectedStatementId = null;
  } else {
    throw new GameError('UNKNOWN_ACTION', 'action', '未登録の操作です。');
  }
  if (isSequential(internal) && session.currentState === 'INVESTIGATION'
    && ['continue', 'objection', 'investigation', 'retry'].includes(action)) prepareStageEvidence(session, runtime);
  return generatedPlayerView(session, runtime);
}
