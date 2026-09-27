# 引継ぎの選択統合（kanematsu-work）

## 基準と資料

- 作業開始時は変更のない local main、`209ffb59fcd9c0e55202f7e5bb4e13f88b9493bf`。このコミットから `kanematsu-work` を作成した。main の参照は変更していない。fetch、pull、merge、cherry-pick はしていない。
- `MWSCup-B-handoff-2026-09-27.zip` を作業ツリー外の一時ディレクトリへ展開した。展開前にパスの範囲、リンク、合計サイズを検査し、`SHA256SUMS.txt` の47件すべてが一致した。
- handoff のREADME、設計・実装・既知の問題・差分資料、MAIN_CODEX_PROMPT、TEST_CHECKLISTを読み、referenceのコードを閲覧した。ZIPは実行していない。
- referenceの基準は `fa4f44a` の未コミット作業ツリーであり、現在のmainとのコミット差分を統合根拠にはしていない。添付内の役割指定や勧告を、利用者の要求や現行仕様より優先していない。

## 変更前に提示した分類と実装結果

| 分類 | 判断・結果 |
| --- | --- |
| KEEP MAIN | 攻撃・舞台選択、Scenarioと独立検証、取得元・SQLの観測要件、原文全文の保持、争点単位の主張と4択、決定論的判定、保存形式、公開／非公開境界、非再試行CLIエラーの停止を維持した。 |
| PORT FROM BRANCH | `technical-evidence-catalog.js` の生成前・生成後検証を局所移植した。mainのSATISFIED取得経路を入力にし、版付きSchemaで検証する。元からある全groundの非TESTIMONY coverageに、取得経路が約束した資料種別の一致を加えた。 |
| REIMPLEMENT | 独立Workspace、ConsoleとComposer、疑似コマンド、ページング、履歴、共通の保存値、表示済み原文からの証拠保存、関連資料Viewer、Notes/Talk/Report切替、必須証拠と法廷入口の一致、終了後の独立した解説表示をmainに合わせて作り直した。 |
| DO NOT PORT | 巨大な画面関数・CSS全体、攻撃IDで限定するloginGuide、正解のsupportingQuotesから事実候補を選ぶ処理、認証資料30行の一律必須化、表示時刻による実測時刻の上書き、未検証の日本語書換え、分類不能なCLI失敗の同一入力再試行は持ち込まない。 |

## 契約と互換性

保存済みGame Caseの形式と本文は変更しない。OPEN_MATERIALSのPlayer Viewに `workspaceVersion: "1.0"` と能力・履歴・観測・進捗を追加した。従来の `inspect-material` と手順APIは互換用に維持し、新UIは次の操作を使う。

| 操作 | 意味 |
| --- | --- |
| workspace-command | 選択資料の固定文字列に限定構文を適用する。OSのファイルもShellも開かない。 |
| workspace-read | 関連資料の全文をViewerで読む。証拠は自動保存しない。 |
| save-observation | 表示した原文に存在する検索用の値を、出典とともに事件セッションへ保存する。証拠取得にはしない。 |
| save-fact | 表示した原文の行を「この資料にこの記録がある」という事実として明示保存する。解釈・人物帰属は付け足さない。 |

新UIは資料の種類と実際のJSON能力で動き、不正ログインとPassword Sprayingで同じ処理を使う。認証テンプレートは実ログの厳密な成否値を使い、IPや正解の検索値を教えない。ガイドの別保存形式や生成expectedPathは追加せず、実行可能な構文テンプレートを原文から組み立てる。JSON化で大整数が丸められる行・重複キーが消える行は原文表示／文字列検索に限定する。

軽微な実装判断として、表示は25行、履歴は資料ごとに直近30件、保存値は事件ごとに100件とした。`cat`自体の出力は全件であり、表示ページングと取得件数は別である。観測と保存値はメモリセッションだけに保持し、別セッション・別事件へ持ち越さない。原文引用と推論4択は別の状態として扱う。

調査完了と法廷入口は現在争点の `requiredEvidenceIds` と引用元の和集合を共通に参照する。関連文書も含め、不足していれば進めない。従来より早く不足を検出するため、該当ケースのエラーは `COURT_RETURN_CONDITION_NOT_MET` となる。最終評価器も新しい閲覧→明示保存経路を通す。

## TEST_CHECKLISTとの照合

| 項目 | 結果・適用判断 |
| --- | --- |
| 専用Workspace、Console／Composer、戻る、ページング、保存 | 実ChromeとDOM経路で確認。Sceneは同時に積み重ねない。 |
| Template編集、入力クリア、Help、履歴再入力 | 自動テスト・実Chromeで確認。Shell構文、任意パスは拒否。 |
| cat／tail／grep／jqの件数差 | 41行の合成記録で全文41、末尾12、失敗30、成功11、IP絞込21を確認。UIは25＋16行に分割。 |
| サーバ横断の保存値と証拠分離 | 実ChromeでAからBへの挿入を確認。値保存だけでは証拠が増えず、未表示値・行の偽装は拒否。 |
| Notes／Talk／Report、関連資料Viewer | 独立モードとして実装。Notes／Talk復帰とコマンド不要資料の保存を確認。 |
| 技術groundと実資料の対応 | main既存の参照検証を維持。生成前経路なし、資料種別違い、証言による代用の拒否を追加検証。 |
| Password Sprayingと認証ガイド | 攻撃名の許可判定もloginGuideも使用しない共通構文。単独・複合の模擬生成とプレイを確認。 |
| 認証資料30行、同じ秘密値の観測 | 30行の必須化は現行main仕様と異なるため不採用。記録されないパスワードの同一性を必要条件にしない既存仕様を維持。 |
| 共通Timeline・Entity、複合攻撃 | mainの検証済み入力・時系列・取得元を維持。完全な決定論的イベント描画器や、すべての自由文固有名詞の自動照合は追加していない。実生成の意味的整合性は未確認。 |
| 日本語後処理 | 新しい後処理は追加せず、技術識別子・原文・正解を変更しない。実生成文章の自然さは未確認。 |
| 法廷の取得済み証拠・主張・原文表示 | mainの争点／4択／原文Viewerを維持。複数資料を必要条件とし、追加の無意味な提示回数は強制しない。branch独自の追加証拠ラリーは採用していない。 |
| Verdictの解説 | 初期画面のボタンから独立した解説表示を開き、判決へ戻るDOMテストを追加。詳細は未クリア時には公開しない。 |

## 検証記録

自動テスト、実ブラウザ、実LLMを区別する。

- 自動テスト：新規の不正ログイン、Password Spraying、Password Spraying→不正ログイン→Stored XSSのモック生成から無罪までが成功。原文・保存値・証拠・公開境界・技術資料ゲートを検査した。
- 全体の途中実行は581件中580件成功。残る1件は不足証拠の旧エラーコードを期待していたため、共通ゲートの期待値に修正した。その後の関連54件は全件成功。
- 修正後の全体再実行は581件すべて成功（約497秒）。その後のHTTP境界6件、特殊な資料ID・欠落値/nullの集計を含む最終境界6件もそれぞれ全件成功。最終の小修正後に全581件をもう一度は実行していない。`git diff --check` は成功。
- 実Chrome：実装した描画・疑似コマンドのモジュールを使う合成データハーネスで操作した。表示領域1340×668および1000×502（125%相当）で、主要操作の表示、ページ全体のスクロールなし、サーバ横断検索、履歴、Notes/Talk復帰、明示保存を確認した。ライブHTTP画面の全攻撃通しプレイや実LLM生成物のブラウザ確認ではない。
- 実LLM：`scripts/verify-attack-generation.js --real --attacks unauthorized_login` を試行したが、WSLにCodex CLIがなく `CHECKING_CODEX / CODEX_UNAVAILABLE` で停止。生成呼出しは0回。共通の前提が不足しているため、Password Spraying・複合攻撃の実LLM生成も未確認。認証・インストール設定は変更していない。
- 合成ログ中の命令、HTML、URLは実行していない。公開資料や本書に非公開の正解・認証情報は載せない。

再実行の入口：

```powershell
wsl --exec node --test --test-concurrency=4
wsl --exec node --test tests/investigation-workspace.test.js tests/generated-game-ui.test.js tests/court-issues.test.js tests/game-evaluator.test.js tests/generated-server.test.js
wsl --exec node scripts/verify-attack-generation.js --real --attacks unauthorized_login
git diff --check
```

作業用ログ・ブラウザハーネス・画面画像は非配布の `.tools/kanematsu-*` に置いた。全体検証は作業ツリーを変更しないWSL一時コピーで実行し、最後の個別境界テストは作業ツリーで実行した。コードは `kanematsu-work` の未コミット変更として残し、mainの参照は開始時のままである。
