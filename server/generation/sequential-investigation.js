import { fail } from './schema.js';
import { investigationCompletionId } from './investigation-validator.js';

export function isSequential(gameCase) {
  return ['SEQUENTIAL_TARGETS', 'OPEN_MATERIALS'].includes(gameCase.progression.investigationMode);
}

export function isOpenMaterials(gameCase) {
  return gameCase.progression.investigationMode === 'OPEN_MATERIALS';
}

export function stageEvidenceIds(gameCase, round) {
  const targetId = gameCase.progression.courtIssues[round - 1].investigationTargetId;
  return [...new Set(gameCase.detective.evidenceDiscoveryRules
    .filter(rule => rule.targetId === targetId).map(rule => rule.evidenceId))];
}

function validateDesign(targets, rules, issues, initialTargets, openingEvidence, open = false) {
  const reject = reason => fail('SEQUENTIAL_INVESTIGATION_UNSOLVABLE',
    'game-progression-plan.investigationTargets', reason);
  if (issues.length !== targets.length || (open
    ? initialTargets.length !== targets.length || targets.some(target => !initialTargets.includes(target.targetId))
    : initialTargets.length !== 1 || initialTargets[0] !== targets[0].targetId)) {
    reject('調査方式に対応する初期資料一覧と、各対象の争点を対応付けてください。');
  }
  const evidenceStage = new Map();
  const actionStage = new Map();
  targets.forEach((target, index) => {
    if (issues[index]?.investigationTargetId !== target.targetId || !issues[index].question) {
      reject('調査対象の順序と4択問題の順序が一致していません。');
    }
    for (const action of target.availableActionIds) actionStage.set(investigationCompletionId(target.targetId, action), index);
    const discoveries = rules.filter(rule => rule.targetId === target.targetId);
    if (!discoveries.length) reject('資料を取得できない調査対象があります。');
    for (const rule of discoveries) {
      if (evidenceStage.has(rule.evidenceId) && evidenceStage.get(rule.evidenceId) !== index) {
        reject('同じ資料を複数の調査対象へ重複配置できません。');
      }
      evidenceStage.set(rule.evidenceId, index);
    }
  });
  if (openingEvidence.some(id => open ? !evidenceStage.has(id) : evidenceStage.get(id) !== 0))
    reject('冒頭の報告書には、調査可能な資料を使用してください。順次調査方式では最初の調査先の資料に限ります。');
  for (const [index, issue] of issues.entries()) {
    if (issue.requiredEvidenceIds.some(id => !evidenceStage.has(id) || evidenceStage.get(id) > index)) {
      reject(`調査${index + 1}の論証に、まだ開いていない調査先の資料が必要です。現在と過去の調査資料だけで解ける主張・根拠にしてください。`);
    }
    if (!issue.question.supportingQuotes.some(item => evidenceStage.get(item.evidenceId) === index)) {
      reject(`調査${index + 1}の4択に、この調査先で取得する資料の根拠がありません。`);
    }
  }
  for (const rule of rules) {
    const index = evidenceStage.get(rule.evidenceId);
    if (rule.prerequisites.requiredEvidenceIds.some(id => !evidenceStage.has(id) || evidenceStage.get(id) > index)
      || rule.prerequisites.requiredCompletedActionIds.some(id => !actionStage.has(id) || actionStage.get(id) > index)) {
      reject('資料の発見に、後の調査対象の資料や操作が必要になっています。');
    }
  }
}

export function validateSequentialPlan(plan, evidenceSet) {
  if (!plan.investigationMode) return;
  const claims = plan.retrialStatementIds.filter(id => plan.objectionRules.some(rule => rule.targetStatementId === id));
  const issues = claims.map((id, index) => ({ investigationTargetId: plan.investigationTargets[index]?.targetId,
    question: plan.courtQuestions.find(item => item.statementId === id),
    requiredEvidenceIds: [...new Set([
      ...plan.objectionRules.filter(rule => rule.targetStatementId === id).flatMap(rule => rule.acceptedEvidenceIds),
      ...(plan.courtQuestions.find(item => item.statementId === id)?.supportingQuotes.map(quote => quote.evidenceId) ?? []),
    ])] }));
  validateDesign(plan.investigationTargets, plan.evidenceDiscoveryRules, issues,
    plan.initialAvailableTargetIds, plan.initialCourtEvidenceIds, plan.investigationMode === 'OPEN_MATERIALS');
  // All issues must succeed in order. A completed attack's proof need not be
  // resubmitted at the final desk, but no exoneration support may be omitted.
  const covered = new Set(issues.flatMap(issue => issue.requiredEvidenceIds));
  const required = evidenceSet.exonerations.filter(item => plan.objectionRules
    .some(rule => rule.exonerationRef === item.exonerationId)).flatMap(item => item.supportingEvidenceIds);
  if (required.some(id => !covered.has(id))) fail('EXONERATION_STAGE_COVERAGE_MISSING',
    'game-progression-plan.courtQuestions',
    '無罪論証に必要な全資料を、順番に解く各争点の必須根拠へ割り当ててください。どの争点でも提示しない資料で無罪にできません。');
}

export function validateSequentialGame(gameCase) {
  if (!isSequential(gameCase)) return;
  validateDesign(gameCase.detective.investigationTargets, gameCase.detective.evidenceDiscoveryRules,
    gameCase.progression.courtIssues ?? [], gameCase.progression.investigation.initialAvailableTargetIds,
    gameCase.progression.initialCourt.presentedEvidenceIds, isOpenMaterials(gameCase));
}
