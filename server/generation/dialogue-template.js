export const COURT_DIALOGUE_TEMPLATE = Object.freeze([
  'INTRO', 'INITIAL_COURT', 'INVESTIGATION', 'COURT_ROUND_1',
  'COURT_ROUND_2', 'COURT_ROUND_3', 'ACQUITTED',
]);

const fixedLines = Object.freeze({
  judgeOpen: '提出された記録と証言を区別して審理します。',
  prosecutorEvidence: 'こちらの証拠をご覧ください。',
  defenseOpen: '技術記録が示す事実と、実際の操作者の同一性は分けて検討すべきです。',
  objection: '異議あり！！',
  acquitted: '合理的な疑いが残るため、被告人を無罪とします。',
});

// LLMへ自由会話を作らせず、検証済み成果物から固定slotだけを割り当てる。
export function assignDialogueTemplate({ configuration, scenarioPackage, evidenceSet }) {
  const firstAttack = [...configuration.attacks].sort((a, b) => a.order - b.order)[0];
  const technicalEvidence = evidenceSet.evidenceArtifacts.filter(item => item.type !== 'TESTIMONY');
  const slots = {
    charge: scenarioPackage.scenarioDraft.title,
    attackSummary: configuration.attacks.map(item => item.attackId).join(' → '),
    incidentTime: firstAttack.occurrenceTime,
    target: configuration.incidentContext.victimSystem,
    prosecutionEvidence: technicalEvidence[0]?.title ?? '技術記録',
    prosecutionClaim: configuration.incidentContext.initialSuspicionReason,
    defenseEvidence: technicalEvidence.map(item => item.title),
    technicalCounterArgument: evidenceSet.exonerations[0]?.explanation
      ?? '利用記録だけでは実際の操作者を断定できません。',
  };
  return { schemaVersion: '1.0', templateSections: [...COURT_DIALOGUE_TEMPLATE], slots,
    fixedLines: structuredClone(fixedLines), rounds: Array.from({ length: configuration.difficulty },
      (_, index) => ({ round: index + 1, evidenceTitle: slots.defenseEvidence[index]
        ?? slots.defenseEvidence.at(-1) ?? '技術記録', objection: fixedLines.objection })) };
}
