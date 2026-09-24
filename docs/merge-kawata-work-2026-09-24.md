# main / kawata-work 統合記録

> この記録は最初の統合時点の方針です。その後の利用者指示により、制作画面の外観はmainのまま、入力・生成フローはkawata-workへ変更しました。現在の仕様は[制作フロー変更記録](creation-flow-2026-09-24.md)を参照してください。

日付：2026-09-24

対象：main `de24b72` と kawata-work `d820ab1` の進行中のマージ。開始時の競合は14ファイル・46ブロック。

## 採用方針

利用者の確認回答「制作画面はmain，作成したゲームのUIや画面に関する内容はkawata-workを採用したい」に従った。

- main：コード描画のタイトル、Game Start!、ゲーム作成／裁判、詳細設定／真実丸、詳細設定の8段階、攻撃の任意選択、Network編集、保存一覧・削除、設定・遊び方・終了、完成画面からモード選択への復帰。
- kawata-work：生成されたゲームの背景・立ち絵・配置、調査先ごとの資料閲覧と4択、法廷での証拠提示、段階別進行、事件報告と判決・結論、証拠・設問の検証、限定的な差し戻し修正。
- 両方：攻撃定義、技術検証、通常プレイからの正解到達、保存されたゲームの読込。検証ゲートを弱めず、入力された攻撃やNetworkを勝手に変更しない。

`public/author.html` と `public/author.js` はmainと同一。`public/generated-view.js`、`public/generated-game.css`、`public/visual-assets.js` はkawata-workと同一。

## 競合ファイルごとの解消

| ファイル | 解消内容 |
| --- | --- |
| README.md | mainの起動・制作・保存案内を基準に、統合後の進行と本記録へのリンクを追加 |
| public/app.js | mainの保存URLとkawata-workの直接開始・読込失敗時の再試行を統合 |
| public/author.html | mainを採用 |
| public/author.js | mainを採用 |
| server/auto-generation-service.js | mainの初回設計・任意選択・保存状態と、kawata-workの段階別設計・差分修正を統合 |
| server/codex/codex-runner.js | mainのWindows起動方法とkawata-workの工程別タイムアウトを統合 |
| server/generation/investigation-registry.js | mainの取得定義による割当てとkawata-workの調査先グループ・順序を統合 |
| server/generation/scenario-configuration.js | mainの一般的な技術条件解決・独立攻撃を維持し、追加攻撃と互換APIを接続 |
| server/generation/scenario-template.js | mainの技術構造保護・全攻撃の調査目的とkawata-workの段階別要件を統合 |
| server/generation/schema.js | 両方のスキーマを登録 |
| tests/attack-catalog.test.js | 両ブランチ合計16攻撃を検証 |
| tests/author-ui.test.js | mainの制作UIの検証を採用 |
| tests/auto-generation.test.js | 初回設計と差分修正、16攻撃、main制作UIに期待値を統合 |
| tests/helpers/author-dom.js | mainの制作UI用ヘルパーを採用 |

自動マージされたファイルも確認し、旧制作UIを前提とするテストと説明を更新した。kawata-workの `/api/author/selection` は互換用として残した。このAPIの1～3件・直列選択の制約は、mainの通常画面・manual APIには適用しない。通常の詳細設定は16攻撃から任意の1～6件を選択する。

## 接続時に判明した問題と修正

1. **追加攻撃の制作メタデータ不足**：kawata-workの7攻撃にはmainの画面が使う段階・入力先の定義がなかった。既存の成立条件に対応する制作メタデータを追加した。mainの9攻撃を残し、合計16攻撃を登録する。
2. **Networkと追加サービスの不一致**：認証・端末・ファイルの取得元が既存テンプレートにない場合があった。既存テンプレートを変更せず、明示的に選択できる `extended-incidents` を追加した。各テンプレートで必要な補助サービスまで解決できる攻撃だけを初期値として提示する。送信済みの手動構成へ設備を自動追加しない。
3. **ゲーム内容がmain側の6攻撃を知らない**：SSH、パストラバーサル、sudo、setuid、Windowsサービス権限、保護ファイル収集について、既存の攻撃定義に沿う学習説明・事件説明・資料の観測項目を登録した。Web攻撃用の説明を流用せず、権限や人物帰属・外部送信の証明限界を維持する。モック資料も実際に比較できる合成値へ更新した。
4. **初回生成とRevisionの契約の違い**：mainは初回に全文を生成し、kawata-workは検証後の修正を差分で返す。初回生成・初回の形式修正は全文契約、検証後の修正は差分契約として明示的に分けた。レビュー指摘を再試行でも保持し、全工程の上限と独立Reviewを維持する。
5. **先頭攻撃の調査目的が複数選択時に欠落**：全攻撃の目的を個別の内部要件へ保存する。資料の原文へ目標を転記せず、長い入力も要件の文字数上限内に保持する。
6. **保存URLが直接開始へ接続されていない**：`?saved=` と `?game=` の両方を事件ファイルの直接読込・同一ゲームの再試行へ接続した。保存・削除・サーバー再起動後の読込はmainの方式を維持する。

修正前のコードコメントは保持し、接続の修正箇所に日付・目的と旧コードのコメントを付けた。競合で採用しなかったブランチの全文は上記Gitコミットで追跡できる。JSONはコメントを許さないため、この記録と親コミットで修正前を追跡する。

## 検証

- `node --test --test-reporter=tap`：529件中528件成功。残る1件は `tests/generation.test.js` のシンボリックリンク作成がWindowsの権限不足で `EPERM` になる既存の環境依存テスト。検査を無効化・スキップする変更はしていない。
- 全16攻撃の単独生成、複数攻撃、6件選択、全Networkテンプレート、互換プリセットの対象テスト：41件成功。MockCodexRunnerで検証済みPreviewから承認・証拠生成・最終評価・READYまで確認。
- 保存URLの直接開始を追加修正した後、`game-entry-ui`、`author-server`、`generated-server`、`saved-game-store`：23件すべて成功。保存・一覧・プレイ・削除、開始失敗時の再試行を含む。
- 制作画面のDOMテストとプレイ画面の既存テストは成功。実ブラウザによる目視確認・実Codexによる生成は今回は未実施。模擬生成の合格は実AIの文章品質を保証するものではない。

## Gitへの登録状況

作業ファイルの競合マーカーは0件。`git add` は `.git/index.lock: Permission denied` で失敗し、権限付き再実行でも同じ結果だった。`.git`には書込み拒否のACLがあり、アクセス制御は変更していない。そのためGitのインデックス上は14ファイルがまだ未解消で、修正した追加ファイルも未ステージ部分がある。コミット・pushは未実行。

利用者のPowerShellで、リポジトリ内から次を実行すれば修正内容を登録できる。

```powershell
git add -u
git add -- data/networks/extended-incidents.json server/generation/extended-attack-learning.js docs/merge-kawata-work-2026-09-24.md
git diff --name-only --diff-filter=U
git diff --cached --check
```

最後の2コマンドが何も出力しなければ、未解消ファイルと差分の空白エラーはない。マージコミットは利用者の確認後に作成する。
