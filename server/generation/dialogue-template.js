import { requestedCourtIssueCount } from './court-issues.js';

export const COURT_DIALOGUE_TEMPLATE = Object.freeze([
  'INTRO', 'INITIAL_COURT', 'INVESTIGATION', 'COURT_EVIDENCE_ROUND', 'ACQUITTED',
]);

export const COURT_SPEAKERS = Object.freeze(['JUDGE', 'PROSECUTOR', 'DEFENSE']);

const fixedLines = Object.freeze({
  judgeOpen: 'では、記録を確認し、何が起きたのかを一つずつ明らかにしましょう。',
  prosecutorEvidence: 'こちらの証拠をご覧ください。',
  defenseOpen: '記録はある。だが、そこから何が分かるのか。一つずつ確かめよう。',
  objection: 'この記録から、確かめていただきたい点があります。',
  acquitted: '被害は、被告人とは別の攻撃者による経路で発生しており、被告人が直接操作したという検察側の説明とは両立しません。よって、被告人を無罪とします。',
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

const explanationLabels = Object.freeze({
  '事件で確認されたこと': 'fact',
  '実際に起きたこと': 'fact',
  '検察側の把握と主張': 'prosecution',
  '検察側が把握していた範囲': 'prosecution',
  '資料を照合して分かること': 'causality',
  '資料から確認した因果関係': 'causality',
  '弁護側の結論': 'conclusion',
  '判決理由': 'conclusion',
});

function closingArgument(explanation) {
  const blocks = String(explanation ?? '').split(/\n{2,}/).map(block => {
    const values = {};
    for (const line of block.split('\n')) {
      const match = /^([^：]+)：(.*)$/s.exec(line.trim());
      const key = explanationLabels[match?.[1]];
      if (key) values[key] = match[2].trim();
    }
    return values;
  }).filter(values => values.fact || values.prosecution || values.causality || values.conclusion);
  if (!blocks.length) return String(explanation ?? '')
    .replaceAll('被告人を無罪とする', '弁護側は被告人に無罪判決を求めます')
    .replaceAll('攻撃者の実名までログから特定することは、この結論の要件ではない。', '');
  return blocks.map((values, index) => [
    index === 0 ? '調査で確認した事実を申し上げます。' : 'さらに、別の攻撃経路についても確認されています。',
    values.fact,
    values.prosecution ? `一方、${values.prosecution}` : '',
    values.causality ? `しかし、資料を照合すると、${values.causality}` : '',
    values.conclusion,
  ].filter(Boolean).join('')).join('\n\n');
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
        ? [line('検察官', 'prosecutor', 'その点は認めます。ですが、次の点について検察側はこう主張します。'),
          ...(game.investigationClaim?.spokenContent
            ? [line(game.investigationClaim.speaker?.displayName ?? '検察官', 'prosecutor', game.investigationClaim.spokenContent, '検察側の主張')]
            : []),
          defense('次の争点に移る前に、この主張を裏付ける記録を確かめよう。')]
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
    ...(game.result?.publicExplanation ? [defense(closingArgument(game.result.publicExplanation), '弁護側の最終主張')] : []),
    line('検察官', 'prosecutor', '……弁護側が示した記録のつながりについて、検察側から追加の反論はありません。'),
    defense('以上の理由から、弁護側は被告人に無罪判決を求めます。')];
  return [];
}
