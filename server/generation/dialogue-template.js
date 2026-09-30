import { requestedCourtIssueCount } from './court-issues.js';

export const COURT_DIALOGUE_TEMPLATE = Object.freeze([
  'INTRO', 'INITIAL_COURT', 'INVESTIGATION', 'COURT_EVIDENCE_ROUND', 'ACQUITTED',
]);

export const COURT_SPEAKERS = Object.freeze(['JUDGE', 'PROSECUTOR', 'DEFENSE']);

const fixedLines = Object.freeze({
  judgeOpen: 'では、記録を一つずつ見ていきましょう。何が起きたのか、事実を確かめます。',
  prosecutorEvidence: 'まず、こちらの証拠をご覧ください。',
  defenseOpen: '記録があることと、検察側の主張が正しいことは別だ。まずは、中身を一つずつ確かめよう。',
  objection: '待ってください。この記録には、見過ごせない点があります。',
  acquitted: '技術資料を見ても、被告人が攻撃の準備や作成、直接の操作をしたとは認められません。第三者が操作した可能性も残っています。合理的な疑いがある以上、被告人は無罪です。',
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
  '技術資料で確認した処理': 'fact',
  '照合による反駁': 'causality',
  '判断の限界': 'limits',
});

function closingArgument(explanation) {
  // The explanation is an earned, verified document. Turn its presentation into
  // speech without dropping observations/limits or adding a private conclusion.
  let labelled = false;
  const lines = String(explanation ?? '').split(/\r?\n/).flatMap(source => {
    const text = source.trim().replace(/^#{1,6}\s+/, '').replace(/^(?:[-*・]|\d+[.)])\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1');
    const match = /^([^：:]+)[：:](.*)$/.exec(text);
    if (explanationLabels[match?.[1]]) {
      labelled = true;
      return match[2].trim() ? [match[2].trim()] : [];
    }
    if (explanationLabels[text]) { labelled = true; return []; }
    return text ? [text] : [];
  });
  const speech = lines.join('\n')
    .replace(/被告人を無罪と(?:する|します)/g, 'この点も、無罪を求める理由の一つです')
    .replace(/[^。\n]*弁護側が被告人に無罪判決を求める根拠となる。?/g,
      'この点を見過ごしたまま、有罪とは言えません。')
    .replace(/弁護側は(?:、)?被告人に無罪判決を求めます。?/g,
      'この点を見過ごしたまま、有罪とは言えません。')
    .replaceAll('攻撃者の実名までログから特定することは、この結論の要件ではない。', '');
  const opening = labelled
    ? 'ここまでに分かったことを、もう一度整理します。'
    : 'ここまで見てきた記録を、最後に振り返ります。';
  return `${opening}\n${speech}`;
}

// Only public, already earned information enters a scene. No private slot is serialized.
export function generatedSceneDialogue(game) {
  const line = (speaker, role, text, badge = '会話') => ({ speaker, role, text, badge });
  const defense = (text, badge = 'あなたの視点') => line('弁護士（あなた）', 'defense', text, badge);
  if (game.currentState === 'INVESTIGATION') {
    const opening = game.result?.outcome === 'FAILURE'
      ? [line('検察官', 'prosecutor', game.result.publicFeedback, '提示の結果'),
        defense('結論を急ぎすぎた。記録のどこまでが根拠になるのか、もう一度見よう。')]
      : game.result?.outcome === 'SUCCESS'
        ? [line('検察官', 'prosecutor', 'その点は認めます。では、次の主張を確認しましょう。'),
          ...(game.investigationClaim?.spokenContent
            ? [line(game.investigationClaim.speaker?.displayName ?? '検察官', 'prosecutor', game.investigationClaim.spokenContent, '検察側の主張')]
            : []),
          defense('次の争点へ進む前に、この主張を支える記録を確かめよう。')]
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
    return [line('検察官', 'prosecutor', '調査は終わりましたか。では、こちらの主張を確認します。'),
      line('検察官', 'prosecutor', `${claim?.speaker ?? '証言者'}は、こう話しています。\n「${claim?.spokenContent ?? '記録をご確認ください。'}」`, '証言の引用 · 発言者の主張'),
      defense(game.pendingInterpretation.text, 'あなたの推理 · まだ確認前'),
      line('検察官', 'prosecutor', 'その推理だけでは足りません。裏付ける証拠を示してください。'),
      defense(fixedLines.objection, '根拠となる証拠を提示しよう')];
  }
  if (game.currentState === 'ACQUITTED') return [
    ...(game.result?.publicExplanation ? [defense(closingArgument(game.result.publicExplanation), '弁護側の最終主張')] : []),
    line('検察官', 'prosecutor', '……弁護側が示した記録のつながりについて、検察側から追加の反論はありません。'),
    defense('記録が示しているのは、ここまでです。その先を推測で埋めて、被告人を有罪にすることはできません。弁護側は、被告人に無罪判決を求めます。')];
  return [];
}
