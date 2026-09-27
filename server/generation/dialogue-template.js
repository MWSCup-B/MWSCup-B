import { requestedCourtIssueCount } from './court-issues.js';

export const COURT_DIALOGUE_TEMPLATE = Object.freeze([
  'INTRO', 'INITIAL_COURT', 'INVESTIGATION', 'COURT_EVIDENCE_ROUND', 'ACQUITTED',
]);

export const COURT_SPEAKERS = Object.freeze(['JUDGE', 'PROSECUTOR', 'DEFENSE']);

const fixedLines = Object.freeze({
  judgeOpen: 'では、記録を確かめましょう。何が起きたのか、一つずつ。',
  prosecutorEvidence: 'こちらの証拠をご覧ください。',
  defenseOpen: '記録はある。けれど、そこから何が言える？ 一つずつ確かめよう。',
  objection: 'この記録から、確かめていただきたい点があります。',
  acquitted: '合理的な疑いが残るため、被告人を無罪とします。',
});

// LLMへ自由会話を作らせず、検証済み成果物から固定slotだけを割り当てる。
export function assignDialogueTemplate({ configuration, scenarioPackage, evidenceSet, generationInput }) {
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
    technicalCounterArgument: evidenceSet.exonerations[0]?.reason
      ?? '利用記録だけでは実際の操作者を断定できません。',
  };
  const fixedDialogue = [
    { scene: 'INTRO', speaker: 'JUDGE', line: fixedLines.judgeOpen },
    { scene: 'INITIAL_COURT', speaker: 'PROSECUTOR', line: fixedLines.prosecutorEvidence },
    { scene: 'INVESTIGATION', speaker: 'DEFENSE', line: fixedLines.defenseOpen },
    { scene: 'COURT_EVIDENCE_ROUND', speaker: 'DEFENSE', line: fixedLines.objection },
    { scene: 'ACQUITTED', speaker: 'JUDGE', line: fixedLines.acquitted },
  ];
  return { schemaVersion: '1.0', templateSections: [...COURT_DIALOGUE_TEMPLATE], slots,
    speakers: [...COURT_SPEAKERS], fixedLines: structuredClone(fixedLines), fixedDialogue,
    rounds: Array.from({ length: requestedCourtIssueCount(configuration, generationInput) },
      (_, index) => ({ round: index + 1, evidenceTitle: slots.defenseEvidence[index]
        ?? slots.defenseEvidence.at(-1) ?? '技術記録', objection: fixedLines.objection })) };
}

// Only public, already earned information enters a scene. No private slot is serialized.
export function generatedSceneDialogue(game) {
  const line = (speaker, role, text, badge = '会話') => ({ speaker, role, text, badge });
  const defense = (text, badge = 'あなたの視点') => line('弁護士（あなた）', 'defense', text, badge);
  if (game.currentState === 'INVESTIGATION') {
    const opening = game.result?.outcome === 'FAILURE'
      ? [line('検察官', 'prosecutor', game.result.publicFeedback, '提示の結果'),
        defense('結論を急いだ。記録のどこまでが根拠になるのか、もう一度見よう。')]
      : game.result?.outcome === 'SUCCESS'
        ? [line('検察官', 'prosecutor', 'その点は認めます。ですが、次の記録も説明できますか。'),
          defense('一つ、主張の穴が見えた。次の記録も確かめよう。')]
        : [defense(fixedLines.defenseOpen)];
    if (game.investigationMode === 'OPEN_MATERIALS') return opening;
    const target = game.investigationTargets[0];
    return [...opening, defense(
      `次は「${target.displayName}」の資料を確認する。`, '調査開始')];
  }
  if (game.currentState === 'RETRIAL_COURT' && game.pendingInterpretation) {
    const claim = game.testimonies.flatMap(item => item.statements.map(statement => ({ ...statement,
      speaker: item.speaker?.displayName ?? '証言者' })))
      .find(item => item.statementId === game.pendingInterpretation.statementId);
    return [line('検察官', 'prosecutor', '調査は終わりましたか。こちらの主張を確認しましょう。'),
      line('検察官', 'prosecutor', `${claim?.speaker ?? '証言者'}は、こう述べています。\n「${claim?.spokenContent ?? '記録をご確認ください。'}」`, '証言の引用 · 発言者の主張'),
      defense(game.pendingInterpretation.text, 'あなたの推理 · まだ確認前'),
      line('検察官', 'prosecutor', '推理だけでは足りません。裏付ける証拠を示してください。'),
      defense(fixedLines.objection, '根拠となる証拠を提示しよう')];
  }
  if (game.currentState === 'ACQUITTED') return [
    ...(game.result?.publicExplanation ? [defense(game.result.publicExplanation, '証拠から確認できたこと')] : []),
    line('検察官', 'prosecutor', '……この記録だけでは、被告人が操作したとは言い切れません。有罪の主張は維持できません。無罪との判断を受け入れます。'),
    defense('記録が示すことを、最後まで確かめた。あとは、判決を待とう。')];
  return [];
}
