import { createGeneratedGame, actGenerated, generatedPlayerView }
  from '../generated-game.js';
import { buildGeneratedGame, UI_API_CONTRACT, validateGameMakeResult }
  from './game-make.js';
import { findIncorrectObjectionPair, validateGameCaseResult } from './game-case-validator.js';
import { digest, sameValues, validateEvidenceSet } from './evidence-validator.js';
import { validateScenarioVerificationResult } from './scenario-verifier.js';
import { ValidationError, fail, validateDocument } from './schema.js';
import { correctCourtChoiceId, publicCourtQuestion } from './court-questions.js';
import { isSequential, isOpenMaterials, stageEvidenceIds } from './sequential-investigation.js';

const CATEGORIES = ['UPSTREAM_INTEGRITY', 'NORMAL_PLAYTHROUGH', 'RETRY_PLAYTHROUGH',
  'LIMIT_PLAYTHROUGH', 'INVESTIGATION_REACHABILITY', 'INVESTIGATION_DISCLOSURE',
  'SOLVABILITY', 'BRUTE_FORCE_RESISTANCE',
  'INFORMATION_DISCLOSURE', 'USABILITY'];

const LIMITATION = '構造と再現可能な操作経路を決定論的に評価する。教材説明の教育的品質や文章の意味的十分性は、人間または独立した外部レビューで別途確認する必要がある。';

function evaluationInputCore(input) {
  return { gameMakeResult: input.gameMakeResult, gameCaseResult: input.gameCaseResult,
    internalGameCase: input.internalGameCase, publicGameCase: input.publicGameCase,
    gameProgression: input.gameProgression, evidenceSet: input.evidenceSet,
    verificationResult: input.verificationResult, scenarioPackage: input.scenarioPackage,
    uiApiContract: input.uiApiContract, buildFingerprint: input.buildFingerprint };
}

export function buildGameEvaluationInput({ gameMakeResult, gameCaseResult, evidenceSet,
  verificationResult, scenarioPackage }) {
  const core = structuredClone({ gameMakeResult, gameCaseResult,
    internalGameCase: gameCaseResult?.gameCase, publicGameCase: gameCaseResult?.publicGameCase,
    gameProgression: gameCaseResult?.gameCase?.progression, evidenceSet, verificationResult,
    scenarioPackage, uiApiContract: UI_API_CONTRACT,
    buildFingerprint: gameMakeResult?.buildFingerprint });
  const inputFingerprint = digest(core);
  const input = { schemaVersion: '1.0',
    evaluationInputId: `evaluation_input_${inputFingerprint.slice(0, 20)}`,
    inputFingerprint, ...core };
  validateGameEvaluationInput(input);
  return input;
}

export function validateGameEvaluationInput(input) {
  validateDocument('game-evaluation-input', input);
  validateGameMakeResult(input.gameMakeResult);
  validateGameCaseResult(input.gameCaseResult);
  validateEvidenceSet(input.evidenceSet);
  validateScenarioVerificationResult(input.verificationResult);
  validateDocument('scenario-import-package', input.scenarioPackage);
  if (input.gameMakeResult.status !== 'BUILT' || !input.gameMakeResult.built
    || input.gameMakeResult.evaluationHandoff?.state !== 'BUILT'
    || !input.gameMakeResult.evaluationHandoff?.eligibleForEvaluation) {
    fail('GAME_NOT_BUILT', 'game-evaluation-input.gameMakeResult.status',
      'BUILTかつEvaluation対象のGame Make Resultが必要です。');
  }
  if (input.gameCaseResult.status !== 'READY' || !input.gameCaseResult.ready) {
    fail('GAME_CASE_NOT_READY', 'game-evaluation-input.gameCaseResult.status',
      'READYなGame Case Resultが必要です。');
  }
  if (!sameValues(input.internalGameCase, input.gameCaseResult.gameCase)
    || !sameValues(input.publicGameCase, input.gameCaseResult.publicGameCase)
    || !sameValues(input.gameProgression, input.internalGameCase.progression)) {
    fail('EVALUATION_ARTIFACT_MISMATCH', 'game-evaluation-input',
      '評価対象がREADY Game Caseの正本と一致しません。');
  }
  const rebuilt = buildGeneratedGame(input.gameCaseResult);
  if (rebuilt.gameMakeResult.status !== 'BUILT'
    || !sameValues(rebuilt.gameMakeResult, input.gameMakeResult)
    || input.buildFingerprint !== rebuilt.gameMakeResult.buildFingerprint
    || !sameValues(input.uiApiContract, UI_API_CONTRACT)) {
    fail('BUILD_FINGERPRINT_MISMATCH', 'game-evaluation-input.buildFingerprint',
      'Game Make成果物、UI/API契約、build fingerprintが一致しません。');
  }
  const draft = input.scenarioPackage.scenarioDraft;
  if (input.verificationResult.status !== 'VERIFIED' || input.verificationResult.issues.length
    || input.evidenceSet.scenarioId !== draft.scenarioId
    || input.internalGameCase.scenarioId !== draft.scenarioId
    || input.evidenceSet.verificationId !== input.verificationResult.verificationId
    || input.internalGameCase.verificationId !== input.verificationResult.verificationId
    || !sameValues(input.evidenceSet.attackGraphRef, draft.attackGraphRef)
    || !sameValues(input.internalGameCase.attackGraphRef, draft.attackGraphRef)) {
    fail('UPSTREAM_ARTIFACT_MISMATCH', 'game-evaluation-input',
      'Scenario、Verification、Evidence、Game Caseの参照が一致しません。');
  }
  const expected = digest(evaluationInputCore(input));
  if (input.inputFingerprint !== expected
    || input.evaluationInputId !== `evaluation_input_${expected.slice(0, 20)}`) {
    fail('EVALUATION_INPUT_FINGERPRINT_MISMATCH',
      'game-evaluation-input.inputFingerprint', 'Evaluation Inputの内容、ID、fingerprintが一致しません。');
  }
  return input;
}

function issue(code, category, target, reason, correctionHint, sourceRefs) {
  return { code, category, target, reason, correctionHint, sourceRefs };
}

function allStatements(publicCase) {
  return publicCase.progression.retrialCourt.testimonies
    .flatMap(testimony => testimony.statements.map(statement => statement.statementId));
}

function correctPair(gameCase, round = 1) {
  const issue = gameCase.progression.courtIssues?.[round - 1];
  const rule = gameCase.judgment.judgmentRules.find(item => !issue || issue.judgmentRuleIds.includes(item.ruleId));
  const evidenceId = isOpenMaterials(gameCase) ? rule?.acceptedEvidenceIds.find(id =>
    gameCase.detective.evidenceDiscoveryRules.some(item => item.evidenceId === id && item.targetId === issue.investigationTargetId)) : rule?.acceptedEvidenceIds[0];
  return rule && { statementId: rule.targetStatementId, evidenceId,
    ...(issue?.question ? { interpretationChoiceId: correctCourtChoiceId(issue.question) } : {}) };
}

function wrongPair(gameCase, publicCase, round = 1) {
  const issue = gameCase.progression.courtIssues?.[round - 1];
  if (issue?.question) return { ...correctPair(gameCase, round),
    interpretationChoiceId: publicCourtQuestion(issue.question).choices
      .find(choice => choice.choiceId !== correctCourtChoiceId(issue.question)).choiceId };
  return findIncorrectObjectionPair({ statementIds: issue?.statementIds ?? allStatements(publicCase),
    presentableEvidenceIds: publicCase.progression.retrialCourt.presentableEvidenceIds,
    objectionRules: gameCase.judgment.judgmentRules.filter(item => !issue || issue.judgmentRuleIds.includes(item.ruleId)) });
}

function enterInvestigation(session, runtime) {
  actGenerated(session, runtime, { action: 'begin' });
  actGenerated(session, runtime, { action: 'continue' });
}

function discoverEvidence(session, runtime, evidenceIds) {
  if (isOpenMaterials(runtime.gameCase)) {
    for (const materialId of evidenceIds) {
      actGenerated(session, runtime, { action: 'inspect-material', materialId, methodId: 'read' });
    }
    return evidenceIds.every(id => session.discoveredEvidenceIds.includes(id));
  }
  const wanted = new Set(evidenceIds);
  const maximum = runtime.gameCase.detective.investigationTargets.length
    * runtime.gameCase.detective.investigationActions.length * 3;
  for (let pass = 0; pass < maximum; pass += 1) {
    if ([...wanted].every(id => session.discoveredEvidenceIds.includes(id))) return true;
    const before = JSON.stringify([session.availableInvestigationTargets,
      session.completedInvestigationActions, session.discoveredEvidenceIds]);
    for (const targetId of [...session.availableInvestigationTargets]) {
      const target = runtime.gameCase.detective.investigationTargets
        .find(item => item.targetId === targetId);
      for (const investigationActionId of target.availableActionIds) {
        actGenerated(session, runtime, { action: 'investigate', targetId, investigationActionId });
      }
    }
    const after = JSON.stringify([session.availableInvestigationTargets,
      session.completedInvestigationActions, session.discoveredEvidenceIds]);
    if (before === after) break;
  }
  return [...wanted].every(id => session.discoveredEvidenceIds.includes(id));
}

function returnToCourt(session, runtime, pair = correctPair(runtime.gameCase, session.currentRound)) {
  return actGenerated(session, runtime, { action: 'retrial',
    ...(isOpenMaterials(runtime.gameCase) ? { evidenceId: pair.evidenceId } : {}),
    ...(isSequential(runtime.gameCase) ? { interpretationChoiceId: pair.interpretationChoiceId } : {}) });
}

function collectForCourt(session, runtime, extraIds = [], pair) {
  const required = isSequential(runtime.gameCase) ? stageEvidenceIds(runtime.gameCase, session.currentRound)
    : runtime.gameCase.progression.investigation.requiredForCourtIds;
  const ids = [...new Set([...required, ...extraIds])];
  if (!discoverEvidence(session, runtime, ids)) throw new Error('Evidence discovery failed');
  for (const evidenceId of ids) {
    actGenerated(session, runtime, { action: 'collect', evidenceId });
  }
  returnToCourt(session, runtime, pair);
}

function disclosureFree(value) {
  const forbidden = /^(groundTruth|judgment|acceptedEvidenceIds|requiredForCourtIds|contradictionRef|exonerationRef|attackGraphRef|provenance|fingerprint|sourceRefs|requirementIds|correctOptionIndex|correctChoiceId|supportingQuotes)$/i;
  let safe = true;
  const walk = item => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (forbidden.test(key)) safe = false;
      walk(child);
    }
  };
  walk(value);
  return safe;
}

function makeResult(input, status, checks, issues) {
  const ref = input?.evaluationInputId && input?.inputFingerprint
    ? { evaluationInputId: input.evaluationInputId, inputFingerprint: input.inputFingerprint }
    : {};
  const seed = { ref, status, checks, issues };
  const result = { schemaVersion: '1.0',
    evaluationId: `evaluation_${digest(seed).slice(0, 20)}`, status,
    accepted: status === 'ACCEPTED', evaluationInputRef: ref,
    checks, issues, limitations: [LIMITATION] };
  return validateGameEvaluationResult(result);
}

function blocked(input, error) {
  return makeResult(input, 'BLOCKED', [{ category: 'UPSTREAM_INTEGRITY', status: 'FAIL',
    sourceRefs: ['phase10:evaluation-input'] }], [issue(error.code ?? 'EVALUATION_BLOCKED',
    'UPSTREAM_INTEGRITY', error.field ?? 'game-evaluation-input', error.message,
    '上流成果物を再生成し、最新fingerprintでEvaluation Inputを再構築してください。',
    ['phase10:evaluation-input'])]);
}

export function evaluateGame(input) {
  try {
    validateGameEvaluationInput(input);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return blocked(input, error);
  }
  const { runtime } = buildGeneratedGame(input.gameCaseResult);
  const checks = [{ category: 'UPSTREAM_INTEGRITY', status: 'PASS',
    sourceRefs: ['phase9:game-make-result', 'phase8:game-case-result'] }];
  const issues = [];
  const addCheck = (category, passed, failure) => {
    checks.push({ category, status: passed ? 'PASS' : 'FAIL', sourceRefs: failure.sourceRefs });
    if (!passed) issues.push(failure);
  };
  const wrong = wrongPair(runtime.gameCase, runtime.publicGameCase);
  const noWrongReason = '公開された証言と提示可能な技術Evidenceの全組合せが正解で、誤答操作を実行できません。';
  const noWrongHint = '既存資料に裏付けられるCONSISTENTな証言を含め、反駁対象との違いを選べるようにしてください。正解Evidenceの削除や無関係な資料の追加は行わないでください。';

  let normalPassed = false;
  try {
    const session = createGeneratedGame(runtime);
    enterInvestigation(session, runtime);
    let view;
    for (let round = 1; round <= runtime.gameCase.progression.courtRoundCount; round += 1) {
      const activeCorrect = correctPair(runtime.gameCase, round);
      collectForCourt(session, runtime, [activeCorrect.evidenceId]);
      if (runtime.gameCase.progression.courtIssues && round > 1) {
        const prior = correctPair(runtime.gameCase, round - 1);
        let rejected = false;
        try { actGenerated(session, runtime, { action: 'objection', ...prior }); }
        catch (error) { rejected = error.code === 'STATEMENT_NOT_IN_CURRENT_ISSUE'; }
        if (!rejected || session.currentState !== 'RETRIAL_COURT') throw new Error('Solved issue reused');
      }
      view = actGenerated(session, runtime, { action: 'objection', ...activeCorrect });
      if (round < runtime.gameCase.progression.courtRoundCount
        && (view.currentState !== 'INVESTIGATION' || view.currentRound !== round + 1)) {
        throw new Error('Court round progression failed');
      }
    }
    normalPassed = view.currentState === 'ACQUITTED'
      && view.currentRound === runtime.gameCase.progression.courtRoundCount;
  } catch { normalPassed = false; }
  addCheck('NORMAL_PLAYTHROUGH', normalPassed, issue('NORMAL_PLAYTHROUGH_FAILED',
    'NORMAL_PLAYTHROUGH', 'generated-game.normal-path',
    '通常操作でACQUITTEDへ到達できません。',
    'Game ProgressionとBackend actionの接続を修正してください。', ['phase9:runtime']));

  let retryPassed = false;
  if (wrong && runtime.gameCase.progression.retryPolicy.maxCourtAttempts > 1) try {
    const session = createGeneratedGame(runtime); enterInvestigation(session, runtime);
    retryPassed = true;
    const rounds = runtime.gameCase.progression.courtIssues?.length ?? 1;
    for (let round = 1; round <= rounds; round += 1) {
      const activeWrong = wrongPair(runtime.gameCase, runtime.publicGameCase, round);
      collectForCourt(session, runtime, [activeWrong.evidenceId], activeWrong);
      const owned = [...session.collectedEvidenceIds];
      if (runtime.gameCase.progression.courtIssues) {
        actGenerated(session, runtime, { action: 'investigation' });
        returnToCourt(session, runtime, activeWrong);
        if (session.attemptCount !== 0) throw new Error('Voluntary investigation costs attempt');
      }
      const failed = actGenerated(session, runtime, { action: 'objection', ...activeWrong });
      const retried = isSequential(runtime.gameCase) ? failed : actGenerated(session, runtime, { action: 'retry' });
      retryPassed &&= failed.currentState === (isSequential(runtime.gameCase) ? 'INVESTIGATION' : 'GUILTY_RETRY') && retried.currentState === 'INVESTIGATION'
        && retried.currentRound === round && sameValues(owned, session.collectedEvidenceIds);
      returnToCourt(session, runtime);
      actGenerated(session, runtime, { action: 'objection', ...correctPair(runtime.gameCase, round) });
    }
  } catch { retryPassed = false; }
  addCheck('RETRY_PLAYTHROUGH', retryPassed, issue('RETRY_PLAYTHROUGH_FAILED',
    'RETRY_PLAYTHROUGH', 'generated-game.retry-path',
    wrong ? '不正解後にGUILTY_RETRYからINVESTIGATIONへ戻れません。' : noWrongReason,
    wrong ? '再試行可能なmaxCourtAttemptsと公開retry遷移を設定してください。' : noWrongHint,
    ['phase9:runtime']));

  let limitPassed = false;
  if (wrong) try {
    const session = createGeneratedGame(runtime); enterInvestigation(session, runtime);
    for (let attempt = 0; attempt < runtime.gameCase.progression.retryPolicy.maxCourtAttempts; attempt += 1) {
      collectForCourt(session, runtime, [wrong.evidenceId], wrong);
      actGenerated(session, runtime, { action: 'objection', ...wrong });
      if (session.currentState === 'GUILTY_RETRY') actGenerated(session, runtime, { action: 'retry' });
    }
    limitPassed = session.currentState === 'BLOCKED';
  } catch { limitPassed = false; }
  addCheck('LIMIT_PLAYTHROUGH', limitPassed, issue('LIMIT_PLAYTHROUGH_FAILED',
    'LIMIT_PLAYTHROUGH', 'generated-game.limit-path',
    wrong ? '誤提示を上限まで繰り返してもBLOCKEDになりません。' : noWrongReason,
    wrong ? 'Game ProgressionのretryPolicyをBackend sessionへ適用してください。' : noWrongHint,
    ['phase9:runtime']));

  let investigationReachable = false;
  try {
    const session = createGeneratedGame(runtime); enterInvestigation(session, runtime);
    const required = runtime.gameCase.progression.investigation.requiredForCourtIds;
    if (isSequential(runtime.gameCase)) {
      for (let round = 1; round <= runtime.gameCase.progression.courtRoundCount; round += 1) {
        const view = generatedPlayerView(session, runtime);
        if (view.investigationTargets.length !== (isOpenMaterials(runtime.gameCase)
          ? runtime.gameCase.detective.investigationTargets.length : 1)) throw new Error('Incorrect target list');
        const future = runtime.gameCase.detective.investigationTargets[round];
        if (future && !isOpenMaterials(runtime.gameCase)) {
          let rejected = false;
          try { actGenerated(session, runtime, { action: 'investigate', targetId: future.targetId,
            investigationActionId: future.availableActionIds[0] }); }
          catch (error) { rejected = error.code === 'UNKNOWN_INVESTIGATION_TARGET'; }
          if (!rejected) throw new Error('Future target opened early');
        }
        collectForCourt(session, runtime);
        actGenerated(session, runtime, { action: 'objection', ...correctPair(runtime.gameCase, round) });
      }
      investigationReachable = session.currentState === 'ACQUITTED'
        && runtime.gameCase.detective.evidence.every(item => session.collectedEvidenceIds.includes(item.evidenceId));
    } else investigationReachable = discoverEvidence(session, runtime,
      runtime.gameCase.progression.investigation.availableEvidenceIds)
      && required.every(id => session.discoveredEvidenceIds.includes(id));
  } catch { investigationReachable = false; }
  addCheck('INVESTIGATION_REACHABILITY', investigationReachable,
    issue('INVESTIGATION_EVIDENCE_UNREACHABLE', 'INVESTIGATION_REACHABILITY',
      'game-case.detective.evidenceDiscoveryRules',
      'Investigation開始状態から必須Evidenceを発見できません。',
      'Target、Action、prerequisite、unlockの循環と到達可能性を修正してください。',
      ['phase8:investigation-design', 'phase9:runtime']));

  let investigationDisclosureSafe = false;
  try {
    const session = createGeneratedGame(runtime); enterInvestigation(session, runtime);
    const initial = generatedPlayerView(session, runtime);
    const automatic = isSequential(runtime.gameCase) && !isOpenMaterials(runtime.gameCase);
    const opened = automatic ? stageEvidenceIds(runtime.gameCase, 1) : [];
    const hidden = runtime.gameCase.detective.evidence.filter(item => !opened.includes(item.evidenceId));
    const firstEvidence = hidden[0]?.evidenceId ?? 'unavailable_evidence';
    let rejected = false;
    try { actGenerated(session, runtime, { action: 'collect', evidenceId: firstEvidence }); }
    catch (error) { rejected = error.code === 'EVIDENCE_NOT_DISCOVERED'; }
    const hiddenValues = hidden.flatMap(item => isOpenMaterials(runtime.gameCase)
      ? [item.publicContent] : [item.evidenceId, item.title, item.publicContent]);
    const initialText = JSON.stringify(initial);
    investigationDisclosureSafe = rejected
      && sameValues(initial.discoveredEvidence.map(item => item.evidenceId), opened)
      && (!automatic || (sameValues(initial.collectedEvidence.map(item => item.evidenceId), opened)
        && initial.courtQuestion?.choices.length === 4))
      && hiddenValues.every(value => !initialText.includes(value));
  } catch { investigationDisclosureSafe = false; }
  addCheck('INVESTIGATION_DISCLOSURE', investigationDisclosureSafe,
    issue('INVESTIGATION_DISCLOSURE_FAILED', 'INVESTIGATION_DISCLOSURE',
      'generated-game.investigation-view',
      '現在の対象外の未取得資料が公開されたか、今回の資料を取得できません。',
      '全資料選択方式では一覧だけを公開し、未調査の本文・正解を公開しないでください。資料取得前のCollectionは拒否してください。',
      ['phase9:session-response']));

  const publicStatements = new Set(allStatements(runtime.publicGameCase));
  const available = new Set(runtime.gameCase.progression.investigation.availableEvidenceIds);
  const presentable = new Set(runtime.publicGameCase.progression.retrialCourt.presentableEvidenceIds);
  const evidencePublic = new Set(runtime.gameCase.detective.evidence.map(item => item.evidenceId));
  const solvable = runtime.gameCase.judgment.judgmentRules.some(rule =>
    publicStatements.has(rule.targetStatementId) && rule.acceptedEvidenceIds.some(id =>
      available.has(id) && presentable.has(id) && evidencePublic.has(id)));
  addCheck('SOLVABILITY', solvable, issue('GAME_NOT_SOLVABLE', 'SOLVABILITY',
    'game-case.judgment', '通常プレイで取得・表示・提示できる組合せから無罪へ到達できません。',
    'Game Progression Planまたは上流Evidenceを修正してGame Caseを再変換してください。',
    ['phase8:game-case', 'phase8:public-game-case']));

  const answerIds = runtime.gameCase.judgment.judgmentRules.flatMap(rule =>
    [rule.targetStatementId, ...rule.acceptedEvidenceIds]);
  const feedback = runtime.publicGameCase.progression.retry.publicFailureFeedback;
  const resistant = Boolean(wrong)
    && (runtime.gameCase.progression.courtIssues ?? []).every((_, i) => wrongPair(runtime.gameCase, runtime.publicGameCase, i + 1))
    && sameValues(UI_API_CONTRACT.objectionInputs,
    ['statementId', 'evidenceId']) && !answerIds.some(id => feedback.includes(id))
    && (!runtime.gameCase.progression.courtIssues?.some(item => item.question)
      || sameValues(UI_API_CONTRACT.interpretationInputs, ['statementId', 'evidenceId', 'interpretationChoiceId']))
    && runtime.gameCase.progression.retryPolicy.maxCourtAttempts > 0
    && runtime.gameCase.detective.investigationTargets.length > 0;
  addCheck('BRUTE_FORCE_RESISTANCE', resistant, issue('INSUFFICIENT_BRUTE_FORCE_RESISTANCE',
    'BRUTE_FORCE_RESISTANCE', 'game-progression',
    wrong ? 'statementとEvidenceの選択、非開示feedback、調査、有限retryのいずれかが不足しています。' : noWrongReason,
    wrong ? '正解を漏らさない誤組合せと調査・選択・上限をProgressionへ明示してください。' : noWrongHint,
    ['phase8:game-progression', 'phase9:ui-api-contract']));

  const sample = createGeneratedGame(runtime);
  const views = [generatedPlayerView(sample, runtime)];
  actGenerated(sample, runtime, { action: 'begin' }); views.push(generatedPlayerView(sample, runtime));
  actGenerated(sample, runtime, { action: 'continue' }); views.push(generatedPlayerView(sample, runtime));
  const noDisclosure = disclosureFree(runtime.publicGameCase) && views.every(disclosureFree);
  addCheck('INFORMATION_DISCLOSURE', noDisclosure, issue('PUBLIC_INFORMATION_LEAK',
    'INFORMATION_DISCLOSURE', 'public-game-output',
    '公開Game Caseまたはsession responseに内部情報が含まれます。',
    '許可済みPublic Game Caseの投影だけを公開してください。',
    ['phase8:public-game-case', 'phase9:session-response']));

  const actions = UI_API_CONTRACT.actions;
  const usable = ['begin', 'continue', 'investigate', 'collect', 'retrial', 'objection', 'retry']
    .every(action => Object.values(actions).flat().includes(action))
    && UI_API_CONTRACT.rendering === 'TEXT_CONTENT_ONLY';
  addCheck('USABILITY', usable, issue('UI_ACTION_MISSING', 'USABILITY', 'ui-api-contract',
    '承認済み画面遷移に必要な操作がUI/API契約にありません。',
    'TITLEからACQUITTEDとretryまでの承認済み操作を実装してください。', ['phase9:ui-api-contract']));

  const upstreamFailure = checks.some(check => check.status === 'FAIL'
    && ['NORMAL_PLAYTHROUGH', 'LIMIT_PLAYTHROUGH', 'INVESTIGATION_REACHABILITY',
      'INVESTIGATION_DISCLOSURE', 'SOLVABILITY'].includes(check.category));
  const status = issues.length === 0 ? 'ACCEPTED' : upstreamFailure ? 'BLOCKED' : 'NEEDS_REVISION';
  return makeResult(input, status, checks, issues);
}

export function validateGameEvaluationResult(result) {
  validateDocument('game-evaluation-result', result);
  const categories = result.checks.map(item => item.category);
  if (new Set(categories).size !== categories.length
    || categories.some(category => !CATEGORIES.includes(category))) {
    fail('INVALID_EVALUATION_CHECKS', 'game-evaluation-result.checks',
      'Evaluation checkのcategoryが重複または未登録です。');
  }
  const allPass = result.checks.length === CATEGORIES.length
    && CATEGORIES.every(category => result.checks.some(check => check.category === category
      && check.status === 'PASS'));
  if ((result.status === 'ACCEPTED') !== result.accepted
    || (result.status === 'ACCEPTED' && (!allPass || result.issues.length))
    || (result.status !== 'ACCEPTED' && !result.issues.length)) {
    fail('INVALID_EVALUATION_RESULT', 'game-evaluation-result.status',
      'Evaluation status、check、issueの関係が不正です。');
  }
  return result;
}
