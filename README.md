# セキュリティインシデント調査ゲーム

セキュリティインシデントを題材に、技術証拠を調査し、被告人への主張の矛盾を法廷で指摘するローカル Web ゲームです。

通常の制作画面は `AUTO_CODEX` 専用です。利用者は次の3項目だけを選択し、ゲーム生成を開始します。

- 攻撃手法: 反射型 XSS（固定）
- ネットワーク: Network A～D
- 難易度: ★1～3

Prompt、Schema、内部 JSON、Ground Truth は通常画面から入力しません。Scenario、Evidence、ゲーム進行は、Codex CLIによる構造化生成とBackendの決定論的検証を組み合わせて構築します。

## 動作要件と起動

- Node.js 22以上
- Codex CLI
- Codex CLIでChatGPTアカウントへログイン済みであること

```sh
cd /home/shu/MWSCup
codex login status
npm start
```

起動後、`http://localhost:3000` を開きます。通常起動では `AUTHOR` modeとなり、`127.0.0.1:3000` だけで待ち受けます。

アプリケーションはCodex CLIが保持している認証をそのまま利用します。アプリケーション自身はログイン、ログアウト、アカウント切替、credential変更を行いません。また、email、password、access token、refresh token、credential file、account IDを読み取り、保存、表示しません。

## システム全体像

システムは、ブラウザUI、HTTP/API、生成オーケストレーション、Codex境界、決定論的検証、ゲーム実行環境に分かれています。

```text
Author Browser
  │  Attack / Network / Difficulty
  ▼
HTTP Server / Author API
  ▼
AutoGenerationManager
  ├─ deterministic input preparation
  ├─ Scenario Codex invocation
  ├─ canonical validation
  ├─ independent Review Codex invocation
  ├─ Evidence Codex invocation
  ├─ deterministic game conversion
  └─ independent evaluation
  ▼
READY runtime + unguessable playId
  ▼
Player Browser / Player API
```

CodexはScenario、Independent Review、Evidenceを生成します。攻撃成立性、参照整合性、Ground Truth追跡、Evidence由来、ゲーム遷移、情報漏えいの合否はBackendが決定します。生成担当の自己評価だけで次工程へ進むことはありません。

### 論理エージェントと実装上の対応

| 論理エージェント | 主な役割 | 実装上の担当 |
| --- | --- | --- |
| Orchestrator | 入力検証、状態遷移、再試行、成果物統合 | `server/auto-generation-service.js`、`server/generation/orchestrator.js` |
| Scenario Agent | Ground Truth、攻撃経路、時系列、人物、学習目標、必要証拠の生成 | `prompts/scenario-generation-v1.md`、`server/generation/scenario-interface.js` |
| Verification Agent | Scenarioの独立レビューと決定論的再検証 | `prompts/scenario-verification-v1.md`、`server/generation/scenario-verifier.js` |
| Evidence Agent | 検証済みScenarioからEvidence、Contradiction、Exonerationを生成 | `prompts/evidence-generation-v1.md`、`server/generation/evidence-interface.js` |
| Game Make Agent | 検証済み成果物をゲーム形式へ変換 | `server/generation/game-case-converter.js`、`server/generation/game-make.js` |
| Evaluation Agent | 正常経路、失敗経路、解答可能性、漏えいを評価 | `server/generation/game-evaluator.js`、`server/xss-prototype.js` |

これらは常駐する別サービスではなく、工程ごとに責務を分離した論理コンポーネントです。Scenario、Review、EvidenceのCodex呼び出しは、それぞれ独立した `codex exec --ephemeral` processとして実行されます。

## 自動生成パイプライン

```text
Attack + Network + Difficulty
  → Codex availability/auth check
  → Candidate / Attack Graph構築
  → Scenario Generation
  → Scenario Schema / Reference / Technical Validation
  → Independent Verification
  → Automatic Revision（最大3 attempt）
  → Evidence Generation / Validation
  → Investigation / Dialogue構築
  → Game Case変換
  → Game Build
  → Evaluation
  → READY
```

### 1. 入力準備

`xss-networks.js` がNetwork A～Dの技術入力を提供します。攻撃カタログ、ネットワーク、Scenario ContextからCandidateとAttack Graphを決定論的に構築し、成立するScenario Generation Inputだけを次工程へ渡します。

不足条件、必要権限、service所属、明示的な到達制御、ログ観測可能性は別々に評価します。技術的に成立しない組合せを物語上の都合で補完しません。

### 2. Scenario Generation

Scenario Agentは次を生成します。

- Scenario Draft
- Ground Truth
- Characters
- Timeline
- Learning Objectives
- Evidence Requirements

出力は `scenario-import-package` と各構成要素のcanonical Schemaで検証されます。その後、generation input、Attack Graph、参照ID、Ground Truth、Timeline間の整合性を検査します。

### 3. Independent Verification

Scenario生成とは別のCodex invocationで、6種類の意味レビューを実行します。

- Evidence Ground Alignment
- Learning Objective Alignment
- Fact / Narrative Separation
- Identity Attribution
- Investigation Coverage
- Reference Content Alignment

Review出力はBackendが再検証します。Reviewが参照できる値は `allowedReviewRefs` に限定され、categoryごとの `subjectRefs` と `sourceRefs` も検査されます。形式または参照規則に違反したReviewは、技術的事実を変更しないrepair invocationを1回だけ実行します。

BackendはさらにAttack Graph再構築、技術環境、Phase 5B結果、Ground Truth追跡、Timeline、Evidence producibilityを独立に再計算します。

### 4. Revision Loop

Schema、参照、Evidence coverageなど修正可能な問題は `REPAIRABLE_BLOCKED` としてmachine-readable feedbackへ変換し、Scenario Agentへ戻します。内部状態破損、技術契約不成立など継続不能な問題は `HARD_BLOCKED` として停止します。

初回生成を含めて最大3 attemptです。検証済みにならない場合は `MAX_REVISION_EXCEEDED` で終了します。

### 5. Evidence Generation

`VERIFIED` のScenarioだけからEvidence Generation Inputを作成します。Evidence AgentはEvidence Artifact、Contradiction、Exonerationを生成します。

Backendは次を検査します。

- generation input、Scenario、Attack Graphの参照一致
- Ground Truth、Timeline、Character、observable artifactへの由来
- Evidence Requirement coverage
- Testimonyと技術評価の整合
- ContradictionとExonerationの成立
- 複数根拠による人物断定の否定
- public contentへの内部ID、Ground Truth、正解の漏えい

### 6. Investigation、Dialogue、Game Build

難易度に応じて1～3段のEvidence Chainを構築します。調査画面のログとgrep風選択肢は合成データであり、shell、filesystem、外部ネットワークを実行しません。

Dialogueは検証済み成果物から値を抽出し、`JUDGE`、`PROSECUTOR`、`DEFENSE` の固定Templateへ適用します。

Game Case変換では内部Game CaseとPlayer向けPublic Game Caseを分け、進行規則、Evidence取得条件、法廷判定をBackend内部へ保持します。

### 7. Evaluationと公開

Evaluationは、正常経路だけでなく次も実プレイ相当の状態遷移で検証します。

- Evidence Chainの到達可能性
- 調査対象と4択の成立
- 未取得Evidenceの提示拒否
- 誤ったEvidenceから再調査へ戻る経路
- 正しいStatementとEvidenceの組合せ
- 最終 `ACQUITTED` への到達
- retry上限
- Player viewへの内部情報漏えい

Game Case EvaluationとXSS runtime Evaluationの両方が `ACCEPTED` の場合だけ `READY` となり、推測困難な `playId` を発行します。途中成果物はPlayerから参照できません。

## Structured Outputの設計

リポジトリ内のJSON Schemaは、保存・受渡し・canonical validationの正本です。Codex CLIへ渡すSchemaは、その正本から実行時に生成します。

```text
canonical JSON Schema
  → open placeholderを構成Schemaで展開
  → Codex Structured Outputs互換Schemaへ変換
  → permission 0600の一時ファイルへ出力
  → codex exec --output-schema
  → stdoutの単一JSON objectをparse
  → canonical Schema / consistency validatorで再検証
```

`codex-schema-adapter.js` は、`const` と `enum` の明示的な型補完、入れ子、配列、`$defs` の再帰変換、`oneOf` から `anyOf` への変換を行います。open objectや非対応keywordはCodexを起動する前に拒否します。

対象となるCodex出力は次の3種類です。

- Scenario Import Package
- Scenario Verification Review
- Evidence Import Package

Codex用Schemaは生成制約であり、最終的な信頼判定ではありません。生成JSONは必ずcanonical validatorと工程固有validatorを通過する必要があります。

## 状態管理

### AUTO_CODEX状態

| 状態 | 意味 |
| --- | --- |
| `IDLE` | 未開始 |
| `CHECKING_CODEX` | CLI存在・ログイン状態の確認 |
| `GENERATING_SCENARIO` | 初回Scenario生成 |
| `VALIDATING_SCENARIO` | ScenarioのSchema・参照・技術検証 |
| `REVIEWING_SCENARIO` | 独立意味レビュー |
| `REVISING_SCENARIO` | feedbackに基づくScenario再生成 |
| `GENERATING_EVIDENCE` | Evidence生成と検証 |
| `BUILDING_INVESTIGATION` | 調査対象とEvidence Chainの構築 |
| `BUILDING_DIALOGUE` | 固定TemplateによるDialogue構築 |
| `BUILDING_GAME` | Game Caseとruntimeの構築 |
| `EVALUATING` | 正常・失敗経路と漏えいの評価 |
| `READY` | Play URL発行可能 |
| `FAILED` | 理由付き失敗 |
| `CANCELLED` | 利用者による中止 |

同一サーバーでは同時に1生成だけを許可します。生成中の再実行は `GENERATION_LOCKED` で拒否します。Cancellationは実行中のCodex subprocessへ `SIGTERM` を送り、必要な場合は `SIGKILL` へ移行します。途中成果物とPlay URLは公開しません。

### XSSゲーム状態

```text
INTRO
  → INITIAL_COURT
  → INVESTIGATION
  → COURT_EVIDENCE_ROUND
      ├─ wrong evidence → 同じroundのINVESTIGATION
      └─ correct evidence → 次roundまたはACQUITTED
```

汎用Generated Game Caseでは `TITLE → INITIAL_COURT → INVESTIGATION → RETRIAL_COURT` を基本とし、正しい異議で `ACQUITTED`、誤りで `GUILTY_RETRY` を経由します。

## 信頼境界とセキュリティ

- Codex出力、外部文書、ログ、URL、HTML、コードは未信頼データとして扱います。
- Promptへ渡す入力は `<UNTRUSTED_INPUT_DATA>` 境界内でJSON化します。
- Codex出力内のコマンドやURLは実行しません。
- `child_process.spawn` は `shell: false` でcommandとargsを分離します。
- Codexには `--sandbox read-only` と `--ask-for-approval never` を指定します。
- stdoutの単一JSON object以外を拒否し、stdout/stderrは10 MiBで制限します。
- stderrのcredentialらしい文字列はredactします。
- Ground Truth、Judgment、正解対応、provenance、内部fingerprintをPlayer viewへ含めません。
- Browser描画は `textContent` を使い、EvidenceをHTMLやscriptとして解釈しません。
- Host、same-origin、Content-Type、request size、未知field、prototype pollution keyを検査します。
- 静的配信は明示された `public/` assetだけに限定します。
- 制作ログは `generationId`、`phase`、`attempt`、`duration`、`result`だけを記録します。

## 実行モード

| mode | 用途 | 起動方法 |
| --- | --- | --- |
| `AUTHOR` | AUTO_CODEX制作画面と生成済みゲームのプレイ | `npm start` |
| `GENERATED` | 保存済みGame Case ResultのPlayer確認 | `GAME_MODE=GENERATED GAME_CASE_PATH=private/game-case-result.json npm start` |
| `FIXTURE` | 固定fixtureによる回帰確認 | `GAME_MODE=FIXTURE npm start` |

`GENERATED` modeのファイルはworkspace内のJSONに限定され、`public/` 配下やworkspace外のパスは拒否されます。各modeは明示的に分離され、Generated Gameの不成立時にFixtureへ暗黙フォールバックしません。

## API

### Author API

`AUTHOR` modeだけで利用できます。

| Method | Path | 役割 |
| --- | --- | --- |
| `POST` | `/api/author/start` | Author sessionを開始し、選択肢とtokenを返す |
| `POST` | `/api/author/generate` | `networkId` と `difficulty` で自動生成を開始する |
| `POST` | `/api/author/cancel` | 実行中の生成を中止する |
| `GET` | `/api/author/status` | progress、簡略failure、Developer Detail、Play URLを返す |

Author statusはScenario、Review、Evidence、Prompt、Schema、Ground Truthを返しません。

### Player API

| Method | Path | 役割 |
| --- | --- | --- |
| `POST` | `/api/start` | Player sessionを開始する。AUTHOR modeでは `playId` が必要 |
| `POST` | `/api/action` | 現在のゲーム状態で許可されたactionを実行する |

Author tokenとPlayer tokenは分離されています。セッション、生成成果物、runtimeはメモリ上だけに保持し、サーバー再起動時に失われます。

## ディレクトリ構成

```text
.
├── data/                 攻撃定義と技術入力例
├── docs/                 生成データ仕様
├── prompts/              Codexへ渡す固定Prompt
├── public/               Browser UIと静的asset
├── schemas/              version付きJSON Schema
├── scripts/              手動smoke test
├── server/               HTTP、生成、検証、ゲームruntime
│   ├── codex/            Codex CLI境界
│   └── generation/       決定論的生成・検証工程
└── tests/                Unit、integration、HTTP E2E
```

## ファイル概要

### ルート

| ファイル | 概要 |
| --- | --- |
| `AGENTS.md` | 本リポジトリで守る技術正確性、工程ゲート、セキュリティ境界 |
| `README.md` | システム設計、起動、構成、運用方法 |
| `package.json` | Node.js要件と `start`、`test`、`smoke:codex` script |
| `docs/generation-data.md` | AUTO_CODEXの成果物、状態、信頼境界を定義する詳細仕様 |

### `server/`

| ファイル | 概要 |
| --- | --- |
| `server/server.js` | HTTP server、静的配信、Author/Player API、session分離、入力制限 |
| `server/auto-generation-service.js` | AUTO_CODEX全工程、状態遷移、revision、cancel、progress、公開view |
| `server/xss-networks.js` | Network A～Dの技術構成と公開用ネットワーク情報 |
| `server/xss-prototype.js` | XSS専用runtime、調査、法廷、公開projection、runtime評価 |
| `server/generated-game.js` | 汎用Generated Game CaseのPlayer state machine |
| `server/game.js` | 最小Fixture game、共通 `GameError`、公開view |
| `server/dummy-case.js` | Fixture modeで使用する固定ケース |

### `server/codex/`

| ファイル | 概要 |
| --- | --- |
| `codex-runner.js` | Codex CLIのsafe spawn、availability、timeout、cancel、出力上限、Schema一時化 |
| `codex-json-runner.js` | Prompt、未信頼JSONデータ、validation feedbackを組み立てる薄いwrapper |
| `codex-output-parser.js` | stdoutの単一JSON object検査とdiagnostic redaction |
| `codex-errors.js` | unavailable、timeout、cancel、output、output-schema等のエラー分類 |
| `codex-schema-adapter.js` | canonical SchemaをCodex Structured Outputs subsetへ変換・事前検査 |
| `auto-output-schemas.js` | Scenario、Review、EvidenceのCodex用Schemaをcanonical Schemaから構成 |

### `server/generation/`

| ファイル | 概要 |
| --- | --- |
| `schema.js` | リポジトリ内Schemaの読込みと共通ValidationError |
| `catalog.js` | `data/attacks/` の攻撃定義を読み込み検証する |
| `evaluator.js` | 条件、権限、service、reachability、ログ観測可能性を評価する |
| `candidate-builder.js` | 選択攻撃をNetwork上の実在対象へ割り当てCandidateを作る |
| `attack-graph.js` | Candidateから因果関係を持つAttack Graphを構築・再検証する |
| `scenario-interface.js` | Scenario Generation Input、Prompt、Import Packageの入出力境界 |
| `scenario-validator.js` | Ground Truth、Timeline、Characters、Objectives、Requirementsの整合検証 |
| `scenario-verifier.js` | Independent Review、Attack Graph再構築、revision判定、Evidence handoff |
| `evidence-interface.js` | Evidence Generation Input、Prompt、Import Packageの入出力境界 |
| `evidence-validator.js` | Evidence由来、Contradiction、Exoneration、public contentを検証 |
| `investigation-validator.js` | Investigation Action、Target、Discovery Rule、Resultを検証 |
| `game-case-converter.js` | 検証済み上流成果物をGame Case Conversion Inputへ統合・変換 |
| `game-case-validator.js` | Game Case、Public Game Case、Progression、法廷判定を検証 |
| `game-make.js` | READY Game CaseからruntimeとEvaluation handoffを構築 |
| `game-evaluator.js` | 正常・再試行・上限経路、上流fingerprint、公開境界を最終評価 |
| `orchestrator.js` | 汎用工程ゲート、下流無効化、revision/retry上限を管理 |

### `public/`

| ファイル | 概要 |
| --- | --- |
| `author.html` | XSS、Network、Difficultyを選ぶ制作画面 |
| `author.js` | Author API、progress、failure、Developer Detail、Play URLの描画 |
| `index.html` | Player画面のHTML shell |
| `app.js` | Player API操作とScene/State別UI描画 |
| `style.css` | Author/Player共通style |
| `visual-assets.js` | asset IDと表示用パスの対応 |
| `assets/backgrounds/*.svg` | Intro、Investigation、Courtroom背景 |
| `assets/characters/*.svg` | Defense、Prosecutor、Judgeの表情asset |
| `assets/effects/objection.svg` | 法廷演出asset |
| `assets/networks/*.svg` | Network A～Dの構成図 |

### `data/` と `prompts/`

| ファイル | 概要 |
| --- | --- |
| `data/attacks/reflected_xss.json` | 反射型XSSの前提、権限、効果、痕跡、参照 |
| `data/attacks/phishing.json` | Phishing攻撃定義。汎用攻撃グラフ回帰テストでも使用 |
| `data/attacks/sql_injection.json` | SQL Injection攻撃定義。複合候補・独立node検証でも使用 |
| `data/examples/network.json` | 汎用Network Schemaの入力例 |
| `data/examples/scenario-context.json` | 汎用Scenario Contextの入力例 |
| `prompts/scenario-generation-v1.md` | Scenario Agentの固定指示と出力制約 |
| `prompts/scenario-verification-v1.md` | Independent Reviewerの6 categoryと参照制約 |
| `prompts/evidence-generation-v1.md` | Evidence Agentの由来、公開境界、出力制約 |

### `schemas/`

Schemaはすべてversion付きのBackend internal contractです。主な分類は次のとおりです。

| 分類 | Schema |
| --- | --- |
| 技術入力 | `attack-definition`、`network`、`scenario-context`、`candidate-selection`、`candidate` |
| Candidate / Graph | `candidate-builder-result`、`attack-graph`、`attack-graph-result` |
| Scenario | `scenario-generation-input`、`scenario-import-package`、`scenario-import-result`、`scenario-draft`、`ground-truth`、`character`、`timeline`、`learning-objective`、`evidence-requirement` |
| Scenario Validation | `scenario-validation-result`、`scenario-validation-feedback`、`scenario-revision-feedback` |
| Independent Verification | `scenario-verification-input`、`scenario-verification-review`、`scenario-verification-result`、`evidence-agent-handoff` |
| Evidence | `evidence-agent-input`、`evidence-generation-input`、`evidence-import-package`、`evidence-import-result`、`evidence-artifact`、`evidence-set`、`contradiction`、`exoneration`、`evidence-validation-feedback` |
| Investigation | `investigation-action`、`investigation-target`、`evidence-discovery-rule`、`investigation-result` |
| Game Case | `game-case-handoff`、`game-case-conversion-input`、`game-case`、`public-game-case`、`game-case-result` |
| Progression | `game-progression-plan`、`game-progression`、`public-game-progression` |
| Build / Evaluation | `ui-integration-handoff`、`game-make-result`、`evaluation-handoff`、`game-evaluation-input`、`game-evaluation-result` |
| Orchestration | `orchestrator-input-validation-result`、`orchestrator-result` |
| XSS runtime | `xss-prototype-selection`、`xss-prototype-evaluation` |

実ファイル名はすべて `schemas/<name>.schema.json` です。

### `scripts/`

| ファイル | 概要 |
| --- | --- |
| `scripts/real-codex-smoke.js` | ログイン済みCodex CLIでXSS + Network A + ★1を1回生成する手動smoke test |

### `tests/`

| ファイル | 主な検証対象 |
| --- | --- |
| `agents-compliance.test.js` | Ground Truth先行、責務分離、公開境界、工程ゲート |
| `attack-catalog.test.js` | 攻撃定義の読込みと技術成立性 |
| `candidate-builder.test.js` | Network上の対象割当てと探索上限 |
| `attack-graph.test.js` | 因果edge、分岐、合流、循環、不成立条件 |
| `generation.test.js` | 汎用条件評価と入力制約 |
| `scenario-interface.test.js` | Scenario入出力contractとImport結果 |
| `scenario-validator.test.js` | Scenario構成要素間のcanonical整合性 |
| `scenario-verifier.test.js` | Independent Verification、revision、reference review |
| `evidence-agent.test.js` | Evidence生成入力、由来、矛盾、無罪論証、漏えい |
| `investigation.test.js` | Investigation chain、取得条件、安全なsimulation |
| `game-case.test.js` | Game Case変換、Progression、法廷判定、public projection |
| `game-make.test.js` | build結果、runtime、Evaluation handoff |
| `game-evaluator.test.js` | 独立Evaluationと正常・失敗経路 |
| `orchestrator.test.js` | 工程順序、下流無効化、retry上限 |
| `xss-prototype.test.js` | XSS固定Network、Dialogue、調査、法廷、asset |
| `auto-generation.test.js` | AUTO_CODEX全工程、revision、repair、lock、cancel、timeout |
| `codex-runner.test.js` | safe spawn、availability、parser、timeout、cancel、redaction |
| `codex-schema-adapter.test.js` | 3出力SchemaのStructured Outputs変換 |
| `author-server.test.js` | Author APIからREADY、Play URL、Player完了までのHTTP E2E |
| `generated-server.test.js` | Generated modeのHTTP APIとsession分離 |
| `server.test.js` | Fixture API、静的配信制限、Host/Origin/入力防御 |
| `end-to-end.test.js` | 上流成果物からGame Case、UI buildまでの統合経路 |
| `game.test.js` | 最小Fixture gameの状態遷移 |
| `tests/helpers/*.js` | Mock Codexと検証済みScenario/Evidence/Game Case fixture |
| `tests/fixtures/attack-catalog/*.json` | 攻撃カタログ用の合成Network、Context、Candidate |

## Codex CLI境界

Backendは次のCLI interfaceだけを使用します。

```text
codex --version
codex login status
codex --ask-for-approval never exec --ephemeral --ignore-user-config --ignore-rules
      --sandbox read-only --output-schema <temporary-schema> --color never -
```

Promptはstdin、生成JSONはstdout、diagnosticはstderrとして扱います。既定timeoutは180000msで、必要な場合だけ次の環境変数で変更できます。

```sh
CODEX_GENERATION_TIMEOUT_MS=240000 npm start
```

## テスト

Unit、integration、HTTP E2Eでは実Codex CLIを呼ばず、Codex境界をmockします。

```sh
npm test
git diff --check
```

実Codex smoke testは、全テスト成功後かつ `codex login status` が成功する場合に限り実行します。XSS + Network A + ★1を1回生成し、ログイン状態やcredentialを変更しません。

```sh
npm run smoke:codex
```

## 現在の制約

- 通常制作画面の攻撃手法は反射型XSS固定です。
- NetworkはA～D、難易度は★1～3です。
- 生成成果物とsessionはメモリ保存で、永続化しません。
- 同一サーバーで同時に実行できる生成は1件です。
- localhost向けの単一process構成です。
- 自動評価は最終的な人間による教材レビューを代替しません。
