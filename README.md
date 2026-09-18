# セキュリティインシデント調査ゲーム

セキュリティインシデントを題材に、技術証拠を調査し、被告人への主張の矛盾を法廷で示すローカル Web ゲームです。通常の制作画面は AUTO_CODEX 専用です。利用者は XSS、Network A～D、難易度★1～3を確認・選択し、「ゲームを生成」を1回押します。Prompt、Schema、JSON のコピーや Import はありません。

```text
Attack + Network + Difficulty
→ Codex CLI availability/auth check
→ Scenario Generation
→ Scenario Schema / Reference / Technical Validation
→ Independent Verification (separate invocation)
→ Automatic Revision (最大3回)
→ Evidence Generation / Validation
→ XSS Investigation
→ Deterministic Dialogue Conversion
→ Game Build
→ Evaluation
→ GAME READY
```

## 前提と起動

- Node.js 22以上
- Codex CLI
- 各利用者が自分のPC上の Codex CLI へ自分の ChatGPT アカウントでログイン済みであること

アプリは Codex CLI が現在使用している保存済み認証をそのまま利用します。ChatGPT のログイン画面は実装せず、email、password、access token、refresh token、credential file、account ID を読み取り・保存・表示しません。アカウントを切り替えた場合も、Codex CLI のログインが正常ならコード変更は不要です。

```sh
cd /home/shu/MWSCup
codex login status
npm start
```

ブラウザで `http://localhost:3000` を開きます。`npm start` は `AUTHOR` mode で `127.0.0.1:3000` を使用します。

Codex CLI が存在しない、または未ログインの場合は生成を開始せず、「Codex CLIでChatGPTアカウントへログインしてください」と表示します。アプリから `login`、`logout`、アカウント切替、credential 変更は行いません。

## AUTO_CODEX の状態

`IDLE`、`CHECKING_CODEX`、`GENERATING_SCENARIO`、`VALIDATING_SCENARIO`、`REVIEWING_SCENARIO`、`REVISING_SCENARIO`、`GENERATING_EVIDENCE`、`BUILDING_INVESTIGATION`、`BUILDING_DIALOGUE`、`BUILDING_GAME`、`EVALUATING`、`READY`、`FAILED`、`CANCELLED` を使用します。

通常画面は工程と進捗だけを表示します。「詳細」を開いた場合だけ `phase`、`attempt`、`errorCode`、`field`、`reason`、`correctionHint` を表示します。Ground Truth、Prompt、内部 JSON、正解 ID は表示しません。

同一ローカルサーバでは1生成だけを許可します。生成中の再実行は `GENERATION_LOCKED` で拒否します。「生成を中止」は実行中の Codex subprocess を停止し、途中成果物を Player へ公開しません。Codex timeout は `CODEX_GENERATION_TIMEOUT_MS`（既定180000ms）で変更できます。

## CodexRunner

Backend は `child_process.spawn` で次の公式 CLI interfaceだけを使用します。

```text
codex --version
codex login status
codex --ask-for-approval never exec --ephemeral --ignore-user-config --ignore-rules
           --sandbox read-only
           --output-schema <schema> --color never -
```

- `shell: false`。command と args を分離する。
- Prompt は stdin へ渡す。
- stdout の単一 JSON objectだけを採用する。
- stderr、exit code、timeout、AbortSignal、出力サイズを検査する。
- Scenario、Review、Evidence は会話を共有しない独立した `codex exec --ephemeral` invocationとする。
- LLM出力に `rm`、`curl`、`bash`、`node` 等が含まれても、データとして Validator へ渡すだけで実行しない。
- 入力中の HTML、URL、ログ、コード、説明は `<UNTRUSTED_INPUT_DATA>` 境界内の未信頼データとして渡す。

## Validation と Revision

Scenario出力は既存 `scenario-import-package` Contractに対して JSON parse、Schema、参照、技術境界を検査します。Validation失敗と `NEEDS_REVISION` は machine-readable feedbackへ変換して Scenario Generatorへ戻します。

Independent ReviewerはScenario Generatorとは別の Codex invocationです。Reviewerには Scenario Verification Input と Reviewer Promptだけを渡します。Review Schema不正時は別 invocationでJSON形式・型・required fieldだけを1回 repairし、技術的事実は追加しません。

`MISSING`、`REFERENCE`、`SCHEMA`、`EVIDENCE_*` 等は `REPAIRABLE_BLOCKED`、CLI不能、内部状態破損、成立不能な技術契約、最大試行超過等は `HARD_BLOCKED` として扱います。Scenario試行回数は既定3回です。

`VERIFIED` 後だけ Evidence Generationへ進みます。Evidenceは既存 Evidence Validatorで由来、Ground Truth参照、Contradiction、Exoneration、公開境界を検査します。難易度1～3に対応して、関連する1～3段の Investigation/Evidence Chainを構成します。

Dialogueは固定の `JUDGE`、`PROSECUTOR`、`DEFENSE` Templateと、検証済みScenario・Evidenceから抽出した変数で決定論的に構築します。

Evaluationが `ACCEPTED` の場合だけ推測困難な Play URLを発行します。EvaluationはEvidence数、chain到達性、4択調査、wrong Evidence retry、正解Round進行、最終 `ACQUITTED`、内部情報漏えいを実プレイ相当の経路で確認します。

## API

Author APIは `AUTHOR` modeだけで公開します。

- `POST /api/author/start`
- `POST /api/author/generate`
- `POST /api/author/cancel`
- `GET /api/author/status`

旧 `prepare-scenario`、Scenario/Review/Evidence Import、Game Progression入力、MANUAL/AUTO切替 API は削除済みです。

Player APIは `POST /api/start` と `POST /api/action` です。Player開始には `READY` 後の `playId` が必要です。Author token と Player token は分離されています。

制作セッション、成果物、ゲームセッションはメモリ上だけに保持します。サーバー再起動で失われます。

## セキュリティ境界

- 実ネットワーク、実ログ、実ファイル、第三者システムへ攻撃・scan・HTTPアクセスを行わない。
- Investigationのgrep風4択は合成データ上の表示であり、コマンドを実行しない。
- Player投影へGround Truth、Judgment、Verification、正解対応、provenance、内部参照を含めない。
- 文字列は `textContent` で描画し、HTMLやscriptとして解釈しない。
- localhost Host、same-origin、request size、prototype pollution keyをBackendで検査する。
- 開発ログは `generationId`、`phase`、`attempt`、`duration`、`result`だけを記録し、credentialやアカウント情報を記録しない。

## テスト

Unit/E2Eでは実Codex CLIを呼ばず、`CodexRunner` をmockします。

```sh
npm test
git diff --check
```

テストはCodex availability、account非依存、safe spawn、malformed JSON、Scenario Validation、独立Review、Review repair、revision loop、Evidence、Investigation、Dialogue、Game Build、Evaluation、lock、cancel、timeout、情報漏えい、prompt injection境界を含みます。

実Codex smoke testは、unit test成功後かつ現在の `codex login status` が成功する場合だけ、XSS + Network A + ★1を1回実行します。ログイン、ログアウト、アカウント切替、credential変更は自動実行しません。

```sh
npm run smoke:codex
```

## その他の実行モード

既存 `Game Case Result` をPlayerで確認する場合だけ次を使用できます。

```sh
GAME_MODE=GENERATED GAME_CASE_PATH=private/game-case-result.json npm start
```

回帰fixtureは `GAME_MODE=FIXTURE npm start` です。これらはAUTO Author modeと混在しません。

既知の制限は、メモリ保存のみ、XSS固定、Network A～D固定、ローカル単一生成、最終的な人間レビューを代替しないことです。
