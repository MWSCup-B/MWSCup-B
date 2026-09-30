const SELF_DISCLOSING_SHORTCUT = /それだけで|だけで[、,]?[^。]{0,60}(?:証拠|断定|分か|判断|証明)/;
const AMBIGUOUS_RECORD_ATTRIBUTION = /(?:投稿|処理|操作|実行)が[^。]{0,30}(?:利用)?セッションに記録|被告人のセッションで実行|アプリケーション主体|成功試行|セッション受入れ|ユーザー識別子の下で/;

const PRESENTATION_TERMINOLOGY = Object.freeze([
  { pattern: /計測/,
    reason: '処理や動作の記録を「計測」と呼ぶ表示表現は使用しません。',
    correctionHint: '記録対象に応じて「プロセスの起動記録」「ブラウザの動作記録」「検査結果」などと具体的に書いてください。数値を測る場合も、何を測定した値なのかを明示し、技術的な意味を変えないでください。' },
  { pattern: /架空の/,
    reason: '登場人物・資料・事件の表示文に不要な「架空の」という修飾を付けないでください。',
    correctionHint: '人物には「検察側調査官」など立場が分かる名称を使ってください。合成データであることの明示が必要なら「教材用の」と記載し、実在しない連絡先や非実行の資料という条件は維持してください。' },
  { pattern: /ブラウザ(?:実行)?記録/,
    reason: '「ブラウザ実行記録」「ブラウザ記録」では何を記録した資料なのかが曖昧です。',
    correctionHint: '観測した内容に合わせて「ブラウザのスクリプト実行記録」または「ブラウザの動作記録」と記載してください。通信の記録だけを実行成功の記録に置き換えないでください。' },
  { pattern: /当該/,
    reason: '会話やプレイヤー向け説明に、報告書調の「当該」は使用しません。',
    correctionHint: '対象を具体的に書くか、直前の対象を指す場合は「その」に直してください。技術的な対象や範囲は変えないでください。' },
  { pattern: /(?:申し上げます|以上の理由から)/,
    reason: '定型的な演説表現ではなく、人物がその場で話している自然な台詞にしてください。',
    correctionHint: '「ここまでに分かったことを整理します」「この記録から分かるのは、ここまでです」など、内容を直接話す形にしてください。' },
  { pattern: /(?:することができます|ことが確認されました)/,
    reason: '回りくどい説明を、短く直接的な日本語にしてください。',
    correctionHint: '「できます」「確認できました」などへ簡潔に直し、主語と確認対象は残してください。' },
]);

// Generated editorial text only. Source records and exact quotations must stay
// intact; report wording to the author instead of replacing evidence after sealing.
export function presentationWordingProblems(value) {
  if (typeof value !== 'string') return [];
  const text = value.normalize('NFKC');
  return PRESENTATION_TERMINOLOGY.filter(rule => rule.pattern.test(text))
    .map(({ reason, correctionHint }) => ({ reason, correctionHint }));
}

// 誤った主張であっても、検察側が自分から推論の弱点を説明する台詞にはしない。
export function hasSelfDisclosingShortcut(value) {
  return typeof value === 'string' && SELF_DISCLOSING_SHORTCUT.test(value.normalize('NFKC'));
}

// 記録対象・記録項目・人物帰属を一文で混同する表現を公開証言へ出さない。
export function hasAmbiguousRecordAttribution(value) {
  return typeof value === 'string' && AMBIGUOUS_RECORD_ATTRIBUTION.test(value.normalize('NFKC'));
}
