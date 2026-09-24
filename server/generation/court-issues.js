import { buildInvestigationStages } from './investigation-registry.js';

// Automatic games have one dispute per source; existing saved contracts keep their count.
export function requestedCourtIssueCount(configuration, generationInput) {
  return generationInput ? buildInvestigationStages(configuration, generationInput).length
    : configuration.difficulty + 1;
}

export function courtIssueGenerationProblems(evidenceSet, count) {
  const statements = new Map(evidenceSet.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')
    .flatMap(item => item.testimony.statements).map(item => [item.statementId, item]));
  const targets = [...new Set(evidenceSet.contradictions.map(item => item.statementRef))];
  const claims = targets.map(id => statements.get(id)?.spokenContent.normalize('NFKC').replace(/\s/g, ''));
  if (targets.length === count && claims.every(Boolean) && new Set(claims).size === count) return [];
  return [{ code: 'DISTINCT_COURT_ISSUES_REQUIRED', field: 'evidenceArtifacts.testimony.statements',
    reason: `独立した${count}件の争点が必要ですが、異なる反駁対象は${targets.length}件です。同一発言の複製も争点数には数えません。`,
    correctionHint: '検証済みRequirementの主張を、資料の意味・時系列や因果・人物特定・意図のうち裏付けられる異なる論点へ分け、各statementに固有のContradictionを対応付けてください。資料・技術入力・人物対応は変更しません。成立しない争点を捏造しないでください。' }];
}
