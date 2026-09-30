# シナリオ審査の反駁範囲と差し戻し修正

## 原因

フィッシング→不正ログイン→Stored XSSでは、攻撃定義のIncident Narrativeが取得定義にないブラウザ識別子や認証IDの対応を要求し、認証・セッション記録から別の攻撃者の操作と本人ログインの排除まで結論づけていた。第2段階も、検察は送信を把握しているのに「送信資料がない」という異なる主張を反駁していた。

差し戻しSchemaと適用処理はEvidence Requirementしか変更できず、ImportもNarrativeの反駁文を攻撃定義と完全一致させていた。このため要件を直してもNarrativeの問題が残り、同じ審査指摘で最大試行回数へ達した。全攻撃で本人の直接操作の積極的排除を求める共通指示も、各資料の証明範囲を超えていた。

## 修正

- フィッシングの専用資料は送信先・時刻・非秘密の合成相関IDだけを使用する。メールの欺瞞的な案内・誘導先、Web要求先、偽フォームへの送受信を比較する。未保証のブラウザ識別子・共通ID・秘密値・入力者の同定を必要条件にしない。
- 不正ログインは認証結果・セッション確立・投稿権限を比較する。試行IDと認証連携IDの照合や、アカウント・時刻だけでの一意な対応を要求しない。別の攻撃者の無断利用は教材内の真相として維持し、公開資料による人物同定や本人ログインの排除と分ける。
- Stored XSSは保存→閲覧→実行→通信開始元→投稿受理の照合を維持し、自動投稿を具体的な原因として手動投稿説を反駁する。この反駁を前段のログイン操作者の排除へ読み替えない。
- 内部の`scenario-revision`へ任意の`incidentNarrativeUpdates`を追加する。既存Attack Node IDを対象に、`allegation`・`prosecutionKnowledge`・`causalRefutation`・`verdictBasis`だけ変更できる。真相の行為・被害・人物ID・effect・必要資料・技術参照は変更できない。従来の要件だけの差分も引き続き受理する。
- 修正はコピーへ適用し、不明・重複対象、許可外フィールド、資料coverageの欠落を拒否する。元の技術入力でImportと独立Reviewを再実行し、未解消ならEvidence以降へ進めない。試行上限は維持する。
- 判決解説にはカタログの古い文面ではなく、独立審査を通過したNarrativeを渡す。真相の行為は「教材内設定」と明示する。

ログの記録項目はサービスや取得設定に応じて異なり、一般的な資料の推奨項目をこの教材の取得保証へ追加しない。[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)。有効な資格情報の悪用という攻撃モデルも、アカウントの記録から実際の人物を同定する保証とは分ける。[MITRE ATT&CK Valid Accounts](https://attack.mitre.org/techniques/T1078/)。

## 検証

通常画面の全17選択経路について、模擬AIでScenario独立Review、Evidence検証、Evaluationを経てREADYに到達し、公開の資料取得・保存・各法廷を通じてACQUITTEDを確認した。通しプレイスクリプトも、各法廷へ提出する資料を段階ごとに保存する現行仕様へそろえた。

新規回帰テストはNarrativeと要件の同時修正、変更禁止項目の拒否、旧差分の互換性、独立Reviewの再実行、修正文の判決解説への引継ぎ、未解消時の生成停止を確認する。

全回帰テストは`node --test`で656件成功、失敗・スキップなし。`git diff --check`も成功した。初回の全体実行ではsandboxによるローカルHTTPサーバー起動拒否と未導入依存があり、既存lockfileで依存を導入し、必要な実行権限で再検証した。

実AIのフィッシング→不正ログイン→Stored XSS（企業）はシナリオ審査1回・証拠生成1回で`VERIFIED` / `VALID` / `ACCEPTED` / `READY`へ到達した。診断スクリプトの旧手順は全資料を最初に一度だけ提出していたため、後の法廷で資料不足になった。実AI出力を変更せず保存し、同じ制作設定IDと審査fingerprintを再現してImport・検証・構築を再実行したうえで、各法廷へ資料を保存する現行手順により11資料（報告書を含む）・5法廷から`ACQUITTED`を確認した。レビューや証拠本文の再生成、fingerprintの付け替えは行っていない。

別の選択であるパスワードスプレー→不正ログイン→Stored XSS（企業）も実AIで`VERIFIED` / `VALID` / `ACCEPTED` / `READY` / `ACQUITTED`を確認した。初回審査で`EVIDENCE_GROUND_ALIGNMENT_FAIL`・`FACT_NARRATIVE_SEPARATION_FAIL`・`IDENTITY_ATTRIBUTION_FAIL`・`INVESTIGATION_COVERAGE_FAIL`が発生し、パスワードスプレーのNarrativeの`causalRefutation`・`verdictBasis`と4要件を1回修正した。再審査に失敗項目はなく、証拠生成1回で通しプレイまで成功した。これにより、Narrativeを修正できず同じ指摘が残る問題の解消を実AIの差し戻し経路でも確認した。

全17経路の検証は模擬AIであり、実AIで確認した組合せは上記2件である。実ブラウザの目視検証は行っていない。

変更は新規生成へ適用する。既存の失敗セッションや保存済みゲームを自動書換えしない。
