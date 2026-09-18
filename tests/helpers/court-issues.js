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
    const statement = { ...structuredClone(original), statementId, spokenContent: claims[i] };
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

export function currentCorrectPair(runtime, round = 1) {
  const issue = runtime.gameCase.progression.courtIssues?.[round - 1];
  const rule = runtime.gameCase.judgment.judgmentRules.find(item => !issue || issue.judgmentRuleIds.includes(item.ruleId));
  return { statementId: rule.targetStatementId, evidenceId: rule.acceptedEvidenceIds[0] };
}
