import { correctCourtChoiceId } from '../../server/generation/court-questions.js';
import { actGenerated } from '../../server/generated-game.js';

export function collectCurrentTarget(session, runtime) {
  const targetId = runtime.gameCase.progression.courtIssues[session.currentRound - 1].investigationTargetId;
  for (const rule of runtime.gameCase.detective.evidenceDiscoveryRules.filter(item => item.targetId === targetId)) {
    actGenerated(session, runtime, { action: 'investigate', targetId, investigationActionId: rule.actionId });
    actGenerated(session, runtime, { action: 'collect', evidenceId: rule.evidenceId });
  }
}

export function enterCurrentCourt(session, runtime, choiceId = currentCorrectPair(runtime, session.currentRound).interpretationChoiceId) {
  return actGenerated(session, runtime, { action: 'retrial', interpretationChoiceId: choiceId });
}

export function addDistinctClaims(draft, count) {
  const testimony = draft.evidenceArtifacts.find(item => item.type === 'TESTIMONY');
  const original = testimony.testimony.statements[0];
  const hasEmail = draft.evidenceArtifacts.some(item => item.type === 'EMAIL');
  const claims = [hasEmail ? '表示されたURLと、リンク要素が指定する対象は同じです。'
    : '要求の記録だけで、対象処理の完了まで確認できます。',
  '二つの記録の時刻だけで、一方が他方を引き起こしたと証明できます。',
  'これらの記録には、操作した人物の意図も記録されています。'];
  for (let i = 0; i < count - 1; i += 1) {
    const statementId = `statement_issue_${i + 1}`;
    const statement = { ...structuredClone(original), statementId,
      spokenContent: claims[i] ?? `資料${i + 1}に記録があるので、操作した人の意図まで読み取れます。` };
    testimony.testimony.statements.splice(i, 0, statement);
    testimony.publicContent += `\n架空の調査担当者の主張: 「${statement.spokenContent}」`;
    draft.contradictions.push({ ...structuredClone(draft.contradictions[0]),
      contradictionId: `contradiction_issue_${i + 1}`, statementRef: statementId,
      reason: 'この主張は資料の記録範囲を越えている。' });
  }
  const statement = { statementId: 'statement_record_exists', spokenContent: '調査で保存された記録を確認しました。',
    technicalAssessment: 'CONSISTENT', contradictionCandidate: false,
    groundTruthRefs: [...original.groundTruthRefs] };
  testimony.testimony.statements.push(statement);
  testimony.publicContent += `\n架空の調査担当者の発言: 「${statement.spokenContent}」`;
  return draft;
}

export function assignStageSupports(draft, stages, requirements = []) {
  const testimony = draft.evidenceArtifacts.filter(item => item.type === 'TESTIMONY');
  const claims = testimony.flatMap(item => item.testimony.statements)
    .filter(item => draft.contradictions.some(contradiction => contradiction.statementRef === item.statementId));
  stages.forEach((stage, index) => {
    const requirement = requirements.find(item => item.investigationStage.targetId === stage.targetId);
    const grounds = requirement?.grounds ?? stage.routes.map(route => route.ground);
    const ids = draft.evidenceArtifacts.filter(item => item.type !== 'TESTIMONY'
      && item.sourceRefs.some(ref => grounds.some(ground => ground.sourceType === ref.sourceType
        && ground.sourceId === ref.sourceId && ground.attackNodeId === ref.attackNodeId)))
      .map(item => item.evidenceId);
    if (requirement && claims[index]) {
      const previous = claims[index].spokenContent;
      claims[index].spokenContent = requirement.investigationStage.claim;
      for (const item of testimony) item.publicContent = item.publicContent.replace(previous, claims[index].spokenContent);
    }
    draft.contradictions.filter(item => item.statementRef === claims[index]?.statementId)
      .forEach(item => { item.conflictingEvidenceIds = ids; });
  });
  for (const item of draft.exonerations) item.supportingEvidenceIds = draft.evidenceArtifacts
    .filter(artifact => artifact.type !== 'TESTIMONY').map(artifact => artifact.evidenceId);
}

export function currentCorrectPair(runtime, round = 1) {
  const issue = runtime.gameCase.progression.courtIssues?.[round - 1];
  const rule = runtime.gameCase.judgment.judgmentRules.find(item => !issue || issue.judgmentRuleIds.includes(item.ruleId));
  return { statementId: rule.targetStatementId, evidenceId: rule.acceptedEvidenceIds[0],
    ...(issue?.question ? { interpretationChoiceId: correctCourtChoiceId(issue.question) } : {}) };
}

export function syncQuestionQuotes(draft) {
  for (const question of draft.courtQuestions ?? []) {
    const evidenceIds = [...new Set(draft.contradictions.filter(item => item.statementRef === question.statementId)
      .flatMap(item => item.conflictingEvidenceIds))];
    question.supportingQuotes = evidenceIds.map(evidenceId => ({ evidenceId,
      quote: draft.evidenceArtifacts.find(item => item.evidenceId === evidenceId).publicContent.slice(0, 1000) }));
  }
  return draft;
}

export function addCourtQuestions(draft) {
  const statements = draft.evidenceArtifacts.filter(item => item.type === 'TESTIMONY').flatMap(item => item.testimony.statements);
  draft.courtQuestions = [...new Set(draft.contradictions.map(item => item.statementRef))].map(statementId => {
    const claim = statements.find(item => item.statementId === statementId).spokenContent;
    const interpretation = claim.includes('表示されたURL') ? '保存メールでは、表示URLとリンク要素が指定する対象が異なる。'
      : claim.includes('時刻') ? '時刻の前後だけでは、二つの操作の因果関係までは証明できない。'
        : claim.includes('意図') ? 'これらの記録には、操作した人物の意図を記録した項目はない。'
          : '技術記録が示す利用状況だけでは、被告人が実際に操作したと断定できない。';
    return { schemaVersion: '1.0', statementId,
      prompt: '調査した資料の原文とこの主張を比べると、どこまで言えるでしょうか。',
      choices: [interpretation, claim, '提示された資料だけで、被告人が一切関与していないことが証明できる。',
        '記録が存在することだけで、被告人が意図的にすべての操作を行ったと証明できる。'],
      correctOptionIndex: 0, supportingQuotes: [], explanation: interpretation };
  });
  return syncQuestionQuotes(draft);
}
