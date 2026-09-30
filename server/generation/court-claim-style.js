const SELF_DISCLOSING_SHORTCUT = /それだけで|だけで[、,]?[^。]{0,60}(?:証拠|断定|分か|判断|証明)/;
const AMBIGUOUS_RECORD_ATTRIBUTION = /(?:投稿|処理|操作|実行)が[^。]{0,30}(?:利用)?セッションに記録|被告人のセッションで実行|アプリケーション主体|成功試行|セッション受入れ|ユーザー識別子の下で/;

// 誤った主張であっても、検察側が自分から推論の弱点を説明する台詞にはしない。
export function hasSelfDisclosingShortcut(value) {
  return typeof value === 'string' && SELF_DISCLOSING_SHORTCUT.test(value.normalize('NFKC'));
}

// 記録対象・記録項目・人物帰属を一文で混同する表現を公開証言へ出さない。
export function hasAmbiguousRecordAttribution(value) {
  return typeof value === 'string' && AMBIGUOUS_RECORD_ATTRIBUTION.test(value.normalize('NFKC'));
}
