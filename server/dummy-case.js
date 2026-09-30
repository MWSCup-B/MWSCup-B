// 操作確認用。攻撃経路や実際の事件を表す教材ではない。
// このモジュールを静的配信・フロントエンドから参照しない。
export const dummyCase = {
  title: '証拠と証言の照合',
  notice: '操作確認用の固定ダミーデータです。事件の無罪判定や技術検証は行いません。',
  instruction: '証言の「資料が存在しない」という主張と、取得した資料の内容を照合してください。',
  testimony: {
    kind: '証言者の主張',
    text: '資料Aは存在しません。',
  },
  evidence: [
    { id: 'document-a', title: '資料A', kind: '教材用ダミー資料', text: 'これは資料Aです。資料の存在を確認できます。' },
    { id: 'document-b', title: '資料B', kind: '教材用ダミー資料', text: 'これは資料Bです。資料Aの有無についての記載はありません。' },
  ],
};

export const groundTruth = Object.freeze({
  fact: 'ダミー設定では資料Aが存在する。',
  correctEvidenceId: 'document-a',
});
