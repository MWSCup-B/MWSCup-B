# インシデントクラフト

セキュリティインシデントの調査を題材にした、ローカルで動くゲーム制作・プレイ用Webアプリです。制作側が攻撃と舞台を選び、ゲーム内の弁護士は事件資料を調べて検察側の主張を検討します。登場人物、ログなどの事件資料は教材用の架空データです。資料に現れたアカウントや端末を、実際の操作者と同一視しません。

## ゲームの流れ

`/author`のタイトル画面で「ゲーム生成」を押し、攻撃を発生順に1～3種類、舞台を1つ選びます。通常画面には8種類の攻撃と5種類の舞台があり、攻撃のつながりが成立する順だけを選択できます。現在登録されている選択順は単体8、2攻撃6、3攻撃3の計17通りです。ネットワーク、端末、サービス、取得可能な資料は登録済みの技術モデルから構成します。従来の完全な設定を送るMANUALと真実丸のAPIも互換用として残っています。

```text
攻撃・舞台を選択
  → 技術条件を検証して事件案を構築
  → 別のCodex呼び出しとBackendで事件案を検証
  → 制作側が事件案を確認して承認
  → 証拠・4択・調査順・法廷進行を生成して検証
  → ゲーム完成後、事件ファイルからプレイ開始
```

生成中は工程に沿った推定進捗と、同梱した実際のインシデント紹介を表示します。紹介記事はゲームの入力には使いません。事件案が技術的に成立しない場合、または必要な検証を通らない場合は完成品として公開しません。

プレイヤーは事件報告書で「何が起きたか」「被告人が疑われた経緯」、最初の資料と証言を読みます。以後、調査対象ごとに取得済みの証拠を読み、4択から資料に合う解釈を選び、法廷で根拠の証拠を提出します。正しい組合せで争点を解決すると次の資料へ進み、最後に判決と事件の経緯・原因を読みます。判定は生成時に確定した規則に従ってサーバーが行います。

攻撃の仕組みと必要な用語は、**各4択の問題文**に含める設計です。問題文にはその時点で取得済みの原文の具体的な値を使い、最初は現在の記録、次は取得済み資料との比較を問います。解決後の解説で比較結果と記録から分からないことを示します。助手の立ち絵は調査画面に表示しますが、問題前の用語説明や読み方の案内は表示しません。問題の資料参照・値・進行条件は検査しますが、自然言語の教育的な分かりやすさまで機械的に保証するものではありません。

## システムの構成

アプリはNode.jsの単一プロセスで動きます。ブラウザは制作・プレイ画面を表示し、HTTPサーバーがセッション、生成工程、公開データ、判定を管理します。Codex CLIは事件案の独立レビュー、必要な修正、証拠と設問の生成に使います。Backendの検証器がスキーマ、技術条件、出典、取得順、正解への到達可能性を確認します。ゲームの正解とGround Truthはプレイヤー向けデータから分離します。

```text
public/author.html・author.js ─┐
                              ├→ server/server.js → server/auto-generation-service.js
public/index.html・app.js ─────┘                         │
                                     ┌───────────────────┼─────────────────────┐
                                     │                   │                     │
                              server/codex/      server/generation/      server/generated-game.js
                              Codex CLI呼出し      構築・検証・変換          プレイ状態・判定
```

主要なファイルの担当は次のとおりです。

| ファイル・ディレクトリ | 担当 |
| --- | --- |
| `server/server.js` | HTTP、制作・プレイAPI、セッション、静的ファイル配信 |
| `server/auto-generation-service.js` | 生成工程の状態遷移、承認、差し戻し、成果物の統合 |
| `server/generation/scenario-selection.js`、`scenario-configuration.js` | 攻撃・舞台の選択から設定を作り、技術条件を検査 |
| `server/generation/scenario-template.js`、`scenario-stage-plan.js` | 事件案の基盤と、資料取得順に対応する争点を作成 |
| `server/generation/scenario-verifier.js`、`scenario-revision.js` | 事件案の独立検証結果と限定的な修正を処理 |
| `server/generation/attack-learning.js`、`investigation-lessons.js` | 攻撃ごとの比較課題と、設問を書くための用語・背景を用意 |
| `server/generation/evidence-interface.js`、`evidence-validator.js` | 証拠の受け渡し、出典と要件の整合性を検査 |
| `server/generation/court-questions.js`、`learning-observations.js` | 4択と公開原文の対応、観測値、資料間の対応を検査 |
| `server/generation/investigation-registry.js`、`sequential-investigation.js` | 調査対象・取得順と、各段階で解けるかを検査 |
| `server/generation/dialogue-template.js`、`incident-report.js`、`incident-conclusion.js` | 会話、事件報告書、判決の文章を構成 |
| `server/generation/game-case-validator.js`、`game-evaluator.js` | 内部・公開ゲームの整合性とプレイ経路を評価 |
| `server/generated-game.js` | プレイヤーの進行、証拠提出、判定 |
| `server/codex/`、`prompts/` | Codex CLIの実行境界、出力形式、各生成工程の指示 |
| `public/author.html`、`public/author.js`、`public/author.css` | 制作画面と進捗表示 |
| `public/index.html`、`public/app.js`、`public/generated-view.js`、`public/generated-game.css` | ゲーム画面と表示用のページ切替 |
| `data/attacks/`、`schemas/` | 攻撃の成立条件・観測定義、各工程のJSON Schema |
| `public/assets/`、`image/` | ゲームで配信する素材、元の参照画像 |
| `scripts/`、`tests/` | Codex接続確認・生成確認用スクリプト、各層のテスト |

攻撃別に何を資料から比較するかは[攻撃学習の設計](docs/attack-learning.md)、生成の失敗条件と確認用スクリプトは[攻撃別の生成確認](docs/generation-readiness.md)に記載しています。

## 起動と確認

Node.js 22以上が必要です。実AIでゲームを生成するときは、使用する環境のCodex CLIにログインしておきます。リポジトリにnpm依存パッケージはありません。

```sh
npm start
```

`http://localhost:3000`を開くと制作画面へ移動します。サーバーは`127.0.0.1:3000`で待ち受けます。通常のテストと、登録済み攻撃の模擬生成・実AI生成を確認するコマンドは次のとおりです。`--real`は実際のCodex CLIを呼び、利用枠を消費します。

```sh
npm test
node scripts/verify-attack-generation.js --output /tmp/mwscup-mock-report.json
node scripts/verify-attack-generation.js --real --attacks clickfix --output /tmp/mwscup-clickfix-report.json
```

このスクリプトはテスト用の制作セッションで事件案を承認し、生成後のゲームを判決まで操作します。レポートの`passed`は生成完了と無罪判決への到達、`complete`は対象全件の処理完了を表します。実AIの文章生成は試行ごとに変わるため、選択可能な攻撃すべての成功を保証するものではありません。

## 現在の制約

- SQLインジェクションでは、Web入力とDBで実行したSQLの構造を比較するための記録範囲・対応情報・取得条件が技術入力に不足しています。独立検証で止まる場合があり、入力にないログや対応関係は補いません。
- 生成物とセッションはメモリ上に保持され、サーバー再起動で失われます。同一サーバーで同時に実行できるCodex生成は1件です。
- 通常画面の選択順以外の任意の攻撃・ネットワーク構成を自動生成できるわけではありません。資料の由来や成立条件が確認できない場合は生成を停止します。
- 自動検証は参照、構造、プレイ経路、公開情報の範囲を確認します。設問の自然さや教材としての理解しやすさは利用者による確認が必要です。
