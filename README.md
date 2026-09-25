# Security Incident Investigation Game

2026-09-25：新規生成ゲームは、全資料から選んで段階的に調査し、資料と反対主張を選んで法廷へ進みます。クリア状況・解説の保存、ペンギン人物、画面内スクロールにも対応しました。[仕様と適用範囲](docs/material-investigation-2026-09-25.md)。

調査の宿題は参考情報として扱います。指定された攻撃・構成で取得できる資料から、成立するシナリオと最小限の調査手順を作成します。宿題の操作回数、URL不一致、通常ログの件数は生成の必須条件にしません。技術的成立性、資料の出所、正確な引用、解答可能性の検証は維持します。

2026-09-24：制作画面の外観はmainを維持し、入力・生成フローはkawata-workの攻撃連鎖＋舞台選択を採用しました。[変更記録](docs/creation-flow-2026-09-24.md)。

## 1. システム概要

セキュリティインシデントの技術調査を題材にした、ローカル Web 学習ゲームと制作システムです。制作ユーザは事件条件を設定し、システムが技術的に検証可能な Scenario、Evidence、Investigation、裁判進行へ変換します。Player は攻撃実行を疑われた被告人の弁護側として合成ログ、端末情報、通信記録、メール、証言などを調査し、法廷で主張と技術証拠の矛盾を示します。

参考作品の名称、キャラクター、台詞、画像、音楽、UI は複製せず、リポジトリ内の独自素材と固定 Template を使用します。

## 2. 基本コンセプト

ゲーム生成は、最初に事件の Ground Truth と攻撃経路を確定し、その後に Evidence Chain、Investigation Path、Court Contradiction、Judgment を構築します。人物のアカウント、端末、IP アドレスが記録に現れることだけを根拠に、実際の操作者を断定しません。

Player は次の順で無罪を論証します。

```text
Ground Truth（非公開）
  → Evidence Chain
  → Investigation Path
  → Court Contradiction
  → deterministic Judgment
```

ゲーム開始後に LLM が正誤判定することはありません。正しい statement と取得済み Evidence の対応、retry、round 進行、最終判定は Backend が決定論的に処理します。

## 3. Scenario 作成方式

タイトルの「Game Start!」→「ゲーム作成 / 裁判」→ゲーム作成を選んだ場合は「攻撃と舞台」の順に進みます。タイトル・モード選択・保存一覧・設定・終了メニューの見た目はmainを維持します。

入力は次の2項目だけです。

- **攻撃手法（1～3件）**：1件目を選ぶと、その攻撃の結果から続く候補だけが2件目に表示されます。3件目も、選択済みの連鎖と直前の攻撃から成立する候補だけを選べます。「追加しない」で1件・2件でも作成できます。前段を変えた場合は後段を解除します。
- **舞台**：企業、行政機関、学校、大学、病院から選びます。

「Scenario案を作成」→技術検証・独立Review→Scenario Previewで内容を確認→「このScenarioでゲームを作成」→生成・評価・自動保存、の順に進みます。Network・難易度・日時・調査方法はkawata-workの登録済み自動構成を使い、画面での入力は求めません。構成図はPreviewで確認できます。条件の修正に戻っても攻撃と舞台の選択は保持します。

通常画面はkawata-workの8選択肢・検証済みの最大3件の連鎖を使います。手動構成用の16攻撃・1～6件のAPIと真実丸APIは互換用として残し、通常画面からは呼び出しません。

裁判入口は保存したゲームの一覧を表示します。ゲームを選ぶと事件ファイルからプレイでき、一覧で削除できます。保存がない場合はゲーム作成へ案内します。

画面全体はビューポート内に収めます。狭い画面では項目を縦に配置し、収まらない内容は画面内でスクロールできます。古いサーバー応答などで攻撃の連鎖データが不足した場合は、エラーを表示して生成を止めます。

## 4. 真実丸とは（互換API）

真実丸は初心者向けの AI Scenario Configuration Assistant です。完成した事件物語やゲーム全体を自由生成するエージェントではありません。

真実丸は登録済み Attack Definition、Network Contract、Investigation Registry、Scenario Configuration Schema の範囲で、Attack 数と順序、時刻、Node、Service、Network、Investigation Type、初期疑惑理由、証拠から導く答えを検討します。出力は Backend で毎回決定論的に検証され、不成立なら machine-readable feedback を付けて最大3回まで再提案します。ユーザへ JSON 修正を要求しません。

Revision 回数には上限があるため、検証失敗を無限に再試行しません。Author Pipelineでは初回を含む最大3 attemptで `MAX_REVISION_EXCEEDED` として停止し、部分的なゲームを成功扱いにしません。

## 5. Scenario Configuration

正本は `schemas/scenario-configuration.schema.json` の versioned contract です。主要フィールドは次のとおりです。

```text
schemaVersion
configurationId
mode: MANUAL | MAKOTOMARU
difficulty: 1 | 2 | 3
evidenceCount: 1 | 2 | 3
network
  ├─ subnets[]
  ├─ nodes[]
  ├─ services[]
  └─ connections[]
attacks[] (1..6; 通常UIの自動構成は1..3)
  ├─ attackId / order / occurrenceTime
  ├─ sourceNodeId / targetNodeId / targetServiceId
  ├─ investigationTypes[] / investigationSourceNodeId
  ├─ evidenceAnswer
  └─ expectedEffect / notes
incidentContext
```

Backend は Attack count、ID と参照、連続 order、時系列、事件日、Node/Service 所属、IP/CIDR、trust boundary、connection、reachability、Attack combination、Investigation support、Log Source、Difficulty と Evidence 数、Scenario Generation Input の構築可能性を検査します。

詳細設定の入力は Backend の単一境界で正規化してから同Schemaを検証します。`datetime-local` の `YYYY-MM-DDTHH:mm` は秒と `+09:00` を持つ date-time にし、Attack、Node、Service、Investigation の表示ラベルは、同じ入力内または登録済み定義で一意に対応する canonical ID へ変換します。変換後も未知IDや不正な日時は拒否し、Validatorの `minLength`、`maxLength`、`pattern`、`format`、`enum` は緩和しません。

## 6. 全体 Architecture

```text
┌──────────────── Author Browser ────────────────┐
│ Mode → GUI Configuration → verified Preview → Approval │
└──────────────────────┬─────────────────────────┘
                       │ Author API
                       ▼
┌──────────────── HTTP Backend ──────────────────┐
│ session / state / validation / public boundary │
└──────────┬───────────────────────┬──────────────┘
           │                       │
           ▼                       ▼
┌── Codex execution ──┐   ┌── Deterministic code ─────────┐
│ Makotomaru          │   │ Schema / reference validation │
│ Scenario revision   │   │ Scenario template / Attack Graph │
│ Verification review│   │ gates / conversion / judgment │
│ Evidence Agent      │   │ runtime / evaluation          │
└──────────┬──────────┘   └──────────────┬───────────────┘
           └──────────────┬──────────────┘
                          ▼
              Internal + Public Game Case
                          │ playId
                          ▼
                    Player Browser
```

`AUTO_CODEX` は Codex CLI の起動、Structured Output、timeout、cancel、診断の redaction を担う実行基盤です。真実丸、Scenario Agent、Verification Agent の責務とは分離されています。

## 7. Scenario Creation Workflow

```text
MANUAL GUI ───────┐
                  ├→ canonical Scenario Configuration
MAKOTOMARU ───────┘       │
                           ├→ deterministic Configuration Validation
                           ├→ deterministic Scenario基盤
                           ├→ Scenario canonical validation
                           ├→ Independent AI Review + Backend Verification
                           ├→ 不合格なら限定Revision（最大3 attempt）
                           ├→ VERIFIED Scenario Preview
                           └→ USER_APPROVED
```

Scenario Preview には事件概要、Attack、順序、発生時刻、Target、Investigation Method、Difficulty、Network Diagram、事前検証済みであることを表示します。Ground Truth、正解 Evidence、最終 Answer は通常 Preview に含めず、制作者が明示的に開く詳細欄だけに入力した証拠の答えを表示します。ユーザが `OK` に相当する「このScenarioでゲームを作成」を押すまで Evidence、Dialogue、Game Build へ進みません。

## 8. Game Generation Workflow

`USER_APPROVED` かつ `VERIFIED` の Scenario だけが次へ進みます。

```text
VERIFIED Scenario
  → Evidence generation / provenance validation
  → Investigation Target + Action + synthetic Evidence + Discovery Rule
  → fixed Dialogue Template + verified slots
  → Internal / Public Game Case conversion
  → Game runtime build
  → independent Evaluation
  → READY + unguessable playId
```

調査データは合成データです。表示上の調査操作から実 shell、実 filesystem、実 network を実行しません。

調査開始時に表示するのは取得元と調査操作です。証言などの文書を調べる対象には、未発見のEvidenceタイトルを転用せず、固定の調査先名を使います。資料のタイトルと本文は調査で発見後に表示し、未発見資料の取得は拒否します（初回法廷で明示的に提示する資料は別です）。

最終Evaluationが不合格の場合、ゲームは公開せず停止します。Developer Detailには総括の`EVALUATION_REJECTED`に加えて、個別の評価エラーコード、対象field、理由、修正指針を表示します。例えば`INVESTIGATION_DISCLOSURE_FAILED`は調査前の資料公開または取得制御の問題であり、入力を変えずに再生成するだけでは直らない場合があります。Ground Truthや正解対応表など、評価対象の内部成果物全体は表示しません。

自動Evidence生成では、AIは本文・出典・要件・証言と論証をdraftとして出力し、Backendが本文のUTF-8からSHA-256を計算します。その後、通常のEvidence Importで根拠の追跡、要件coverage、Contradiction、複数資料を使うExonerationを検証します。外部から取り込む完成済みEvidence JSONには引き続き正しいintegrityが必須であり、不正ハッシュや取込後の本文改変を自動修復しません。失敗通知を証拠の代用品にはしません。

Evidence Import後には、法廷で選べる証言と技術証拠に、成立する異議と成立しない異議の両方があるか確認します。全組合せが正解の場合は`EVIDENCE_NO_INCORRECT_OBJECTION_PAIR`として、既存資料に裏付けられる観測内容の発言と、反駁対象の主張を分ける限定修正をEvidence Agentへ依頼します。既存の技術証拠・論証・証言は維持し、既存TESTIMONYへ裏付けのある発言を追記するだけです。修正を含むEvidence生成は最大2回で、不足が残る場合は公開せず停止します。正解の証拠を削って誤答扱いにしたり、無関係な資料を追加したりしません。

「メール文のリンク先と実際に遷移するリンク先が異なること」を扱う場合は、保存メールの表示URLとHTMLソースの`href`、別途取得したWebアクセス記録の対象を比較する証拠を設計します。HTMLは文字列表示のみで実行しません。表示URLとhrefの相違をHTTPリダイレクトや操作者の特定とは扱いません。[合成証拠の例](docs/generation-data.md#11-phishingの証拠設計例)を参照してください。

## 9. 裁判ゲームの進行

自動生成したゲームは、オリジナルの「記録審理室」画面でプレイします。法廷は人物の立ち絵と証言の会話パネル、調査は青緑の調査デスクと資料ビューアーへ切り替わります。証言は一つずつ送り、指摘対象の発言と証拠を選んで「この証拠で主張を検証」を実行します。登場人物、現在の争点、解決状況、残り提示回数を表示します。既存作品の画面や素材を複製せず、リポジトリ内のオリジナルSVGとCSSを使います。

調査では「調査先を選ぶ → 調査方法を実行 → 発見資料の原文を確認 → 証拠として登録」の順に操作します。メール本文・HTMLソース・ログは文字列として表示し、URLを開いたりHTMLを実行したりしません。未発見資料の内容や内部判定は公開しません。

共通 Dialogue Template は次の Scene を持ちます。

```text
INTRO
  → INITIAL_COURT
  → INVESTIGATION
  → COURT_EVIDENCE_ROUND
       ├─ 誤った提示・裏付け不足 → retry / INVESTIGATION
       ├─ 提示せず追加調査 → INVESTIGATION
       └─ 争点を解決 → 次の異なる争点 / 全争点解決でACQUITTED
  → ACQUITTED
```

汎用 Generated Game runtime の内部 state 名は `TITLE`、`INITIAL_COURT`、`INVESTIGATION`、`RETRIAL_COURT`、`OBJECTION`、`GUILTY_RETRY`、`ACQUITTED`、`BLOCKED` です。Dialogue Scene と runtime state を分けることで、固定演出と決定論的判定を混同しません。

自動生成の法廷試行上限は各ラウンド3回です。不成立の異議は`GUILTY_RETRY`を経て調査へ戻れますが、3回続けると`BLOCKED`になります。最終Evaluationは実際の選択肢でこの経路を確認します。全組合せが正解で誤答操作自体がない場合も不合格とし、単なるretry設定不足とは区別した理由を表示します。

新しい自動生成ゲームは、技術証拠を1件登録すると法廷へ戻れますが、帰廷できることと論証が成立することは別です。正しい資料を選んでも、その争点の照合に必要な資料が未登録なら不成立になります。最終争点では、検証済みExonerationの支持資料もすべて取得していることを要求します。失敗理由は正解を漏らさない共通文で表示します。提示前の追加調査では回数を消費せず、失敗後も取得済み資料・解決済み争点を保持します。解決後の争点へ同じ回答を再送しても進行しません。

法廷と調査の移動、争点解決時に場面転換を表示します。小さい画面では縦配置になり、OSの「視差効果を減らす」設定では移動アニメーションを省略します。操作はボタンとキーボードで行えます。

## 10. Difficulty

| Difficulty | 調査チェーンの基準 | 異なる争点の数 |
| --- | --- | --- |
| ★1 | 1 | 2 |
| ★★ | 2 | 3 |
| ★★★ | 3 | 4 |

新しい自動生成では `courtRoundCount = difficulty + 1` とし、内部 `courtIssues` に争点ごとの証言・判定ルール・必要資料を記録します。単一の主張の繰り返しではなく、Requirementに沿った異なる反駁対象を要求します。争点不足や重複はEvidence生成の最大2回の範囲で差し戻し、未解決なら生成を停止します。Evaluation は各争点に対応する別の回答と再調査経路を実行確認します。`evidenceCount` は調査チェーンの基準で、補助資料を含む取得総数の上限ではありません。★1でもメール・Webアクセス記録・証言など論証に必要な資料は通常プレイで取得・閲覧できます。

旧Game Case（`courtIssues`なし）は記録済みのラウンド数・判定で読み込み可能です。新しい複数争点を遊ぶにはサーバーを再起動し、Scenarioからゲームを再生成してください。過去の生成物に未検証の証言や根拠を後付けする移行は行いません。再起動ではメモリ上の生成物・セッションが失われるため、必要な内容を控えてから実施してください。

Scenario基盤は、取得可能と確認された各artifactをEvidence Requirementの`grounds`へ関連付け、既存NodeとLog Sourceに基づく取得要件を作ります。メールはメールサーバー、Webアクセス記録はWebサーバーから取得し、必要な取得元がなければ生成を停止します。証言者とその主張の対象である被告人を明示しますが、人物と端末操作者の同一性や非関与は補完しません。時系列では架空の表示時刻と資料内の時刻を区別し、結論は資料で裏付けられる範囲に限定します。

## 11. Agent / Component

| Agent / Component | 責務 |
| --- | --- |
| Orchestrator | 入力検証、state、gate、retry、成果物統合 |
| Makotomaru | canonical Scenario Configuration の提案 |
| Scenario Builder / Agent | Backendの定型基盤でScenario、Ground Truth、Timeline、必要Evidenceを構築し、Review不合格時は記述と既存artifactへの不足参照を修正 |
| Verification Agent | 別 Codex invocation と Backend 再計算による独立検証 |
| Evidence Agent | VERIFIED Scenario に追跡可能な Evidence、Contradiction、Exoneration の生成 |
| Investigation Builder | Target、Action、Discovery chain の構築 |
| Dialogue Builder | 固定 Scene / speaker / line と Scenario slot の割当て |
| Game Make | Internal/Public Game Case と runtime の構築 |
| Evaluation | 正常、誤答、retry、round、到達性、漏えいの評価 |

これらは常駐する別サービスではなく、責務と工程 gate を分離した論理コンポーネントです。

## 12. AI と決定論的処理の境界

AI を使用する処理:

- 真実丸による Configuration 提案
<!-- 2026-09-20 修正前: 初回設計の実行と技術境界の記載を更新する。
- Review不合格時の Scenario 記述と既存artifactへの不足参照の修正
-->
<!-- 2026-09-20 修正後: 初回設計の実行と技術境界の記載を更新する。 -->
- 初回の Scenario 設計と、Review不合格時の記述修正（人物名、学習目標・証拠要件のdescription）。ID、Ground Truth、Timeline、全参照と取得要件の件数はBackendの基盤を保持する。
- Scenario の独立 semantic review
- Evidence artifact と必要な文章 slot

Backend code が決定する処理:

- Attack count、登録 ID、order、timeline
- Node、Service、Log Source、reachability、Attack Graph
- ScenarioのID、Ground Truth参照、Timeline、Evidence Requirement基盤
- Schema、参照、fingerprint、工程 gate
- Difficulty と Evidence/Round 数
- Evidence discovery、取得条件、正誤判定、retry、最終 state
- Public projection と Ground Truth / Answer leak 検査

LLM の自己評価だけで `VERIFIED`、`READY`、`ACCEPTED` にはなりません。

2026-09-20: 真実丸は `data/networks/` の社内標準・DMZ・支店Proxy構成と攻撃の割当て例を受け取り、その範囲で提案します。詳細設定は引き続き独自構成を入力できます。対象割当てはSource・Target・調査取得元を固定し、Role・Platform・Service所属・到達性を同時に評価します。調査・修正・検証結果は [シナリオ柔軟性の修正記録](docs/scenario-flexibility-2026-09-20.md) を参照してください。

## 13. Scenario / Evidence / Game Contract

- Scenario Configuration: `schemas/scenario-configuration.schema.json`
- Makotomaru request/result: `schemas/makotomaru-request.schema.json`、`schemas/makotomaru-result.schema.json`
- Scenario: `scenario-generation-input`、`scenario-import-package` と構成 artifact Schema
- Verification: `scenario-verification-input`、`scenario-verification-review`、`scenario-verification-result`
- Evidence: `evidence-generation-input`、`evidence-import-package`、`evidence-set`
- Investigation: `investigation-action`、`investigation-target`、`evidence-discovery-rule`、`investigation-result`
- Game: `game-progression-plan`、`game-case`、`public-game-case`、`game-case-result`
- Evaluation: `game-evaluation-input`、`game-evaluation-result`

Codex CLI 用 Structured Output Schema は canonical Schema から構成します。Codex の Schema 制約を通過しても信頼済みとは扱わず、canonical validator と工程固有 validator を再実行します。

## 14. State Machine

Author state:

```text
MODE_SELECTION
  → MANUAL_CONFIGURATION | MAKOTOMARU_CONFIGURATION
  → CHECKING_CODEX
  → SCENARIO_DRAFT
  → SCENARIO_VALIDATING
  → SCENARIO_REVIEWING
  → SCENARIO_REVISING (必要時)
  → VERIFIED
  → SCENARIO_PREVIEW
  → USER_APPROVED
  → EVIDENCE_BUILDING
  → INVESTIGATION_BUILDING
  → DIALOGUE_BUILDING
  → GAME_BUILDING
  → EVALUATING
  → READY

任意の実行状態 → FAILED | CANCELLED
```

`CHECKING_CODEX` は、開始直後にUIが選択画面へ戻らないことを保証する実行中状態です。`canCancel` が有効な間は生成中画面を表示し、ユーザ操作でキャンセルできます。キャンセルや失敗の後に、処理済みの部分成果物を `READY` として公開することはありません。

Player state は前節の Generated Game runtime state を使用します。Author session、Player session、`playId` は分離され、`READY` 前の runtime は公開されません。

## 15. Directory Structure

```text
.
├── data/                 Attack Definition と合成技術入力例
├── docs/                 生成データと工程の補足仕様
├── prompts/              固定 Codex prompt
├── public/               Author UI、Player UI、独自 SVG asset
├── schemas/              versioned JSON Schema
├── scripts/              実 Codex smoke test
├── server/
│   ├── codex/            Codex CLI execution boundary
│   └── generation/       validator、builder、converter、evaluator
└── tests/                unit、integration、HTTP、E2E
```

## 16. Important Files

| File | 責務 |
| --- | --- |
| `server/server.js` | HTTP、Author/Player API、session、公開境界、静的配信 |
| `server/auto-generation-service.js` | 共通 Scenario/Game Pipeline と Author state |
| `server/generation/scenario-configuration.js` | Configuration bootstrap、正規化、決定論的 validation、Preview |
| `server/generation/scenario-template.js` | validated ConfigurationからSchema適合Scenario基盤を決定論的に構築 |
| `server/generation/catalog.js` | `data/attacks/` の読込みと検証 |
| `server/generation/attack-graph.js` | 因果関係を持つ Attack Graph の構築 |
| `server/generation/scenario-validator.js` | Scenario artifact の canonical validation |
| `server/generation/scenario-verifier.js` | Independent Verification と revision feedback |
| `server/generation/evidence-validator.js` | Evidence provenance、Contradiction、Exoneration、漏えい検査 |
| `server/generation/investigation-registry.js` | Attack 別 Investigation assignment |
| `server/generation/dialogue-template.js` | 固定 Scene / speaker / line と slot assignment |
| `server/generation/game-case-converter.js` | Internal/Public Game Case 変換 |
| `server/generation/game-evaluator.js` | 正常・retry・round・到達性・漏えい評価 |
| `server/codex/codex-runner.js` | safe spawn、timeout、cancel、出力制限 |
| `public/author.html`, `public/author.js` | Wizard、Network Builder、SVG Diagram、Preview/Approval |
| `public/index.html`, `public/app.js` | Player UI |

## 17. Security

- Codex 出力、外部ログ、Web、メール、文書、URL、コードは未信頼データです。
- Prompt のデータは `<UNTRUSTED_INPUT_DATA>` 境界へ JSON として渡します。
- Codex は `shell:false`、read-only sandbox、approval 無効、ephemeral process で起動します。
- stdout は単一 JSON object のみ受理し、出力サイズを制限します。
- Evidence 内の command、URL、code は実行しません。
- Author/Player の描画は `textContent` と SVG DOM API を使い、生成 HTML を解釈しません。
- Ground Truth、Judgment、正解 mapping、provenance、fingerprint、Verification Result は Player view へ含めません。
- Host、Origin、Content-Type、body size、未知 field、prototype pollution key、配信 path を検査します。
- credential、token、account ID、email、password は生成物、状態、ログへ保存しません。

## 18. Codex CLI

アプリは現在 Codex CLI でログイン済みの ChatGPT account をそのまま使用し、特定 account に固定依存しません。アプリ自身は logout、login、account switching、credential file の読取りや変更を行いません。Windows では npm の `codex.ps1` / `codex.cmd` を子プロセスとして直接起動せず、インストール済み `@openai/codex` の JS entry point を Node.js から実行します。

主な実行境界は次のとおりです。

```text
codex --version
codex login status
codex ... exec --ephemeral --sandbox read-only --output-schema <temporary-schema> -
```

真実丸、Scenario Review/Revision、Evidence はすべて、canonical Schemaを共通adapterでCodex Structured Outputs互換Schemaへ変換してから実行します。真実丸へ渡すAttack Definitionは、成立条件、必要権限、required service、node role、reachability、supported Investigation Type、observable artifactを保持しつつ、参照URLなどConfiguration選択に不要なfieldを除いた入力です。

アプリケーションコードはCodex CLI呼出し時に `--model` を指定していません。実際に使用されるモデルは、現在ログインしているCodex CLIの設定・利用枠に従う既定モデルであり、アプリ内で特定モデルへ固定されているわけではありません。

Codex CLIの非0終了は、usage/rate limit、HTTP、model、input size、output schema、timeout、その他CLI errorへ分類します。usageまたはrate limitは `CODEX_USAGE_LIMIT_REACHED` として停止し、通常UIには「Codexの利用上限に達しています。利用枠の回復後にもう一度実行してください。」と表示します。Developer Detailにはこの場合、safe error code、phase、HTTP status、retryableだけを表示し、credentialやtoken、account情報、stderr本文は表示しません。

## 19. 起動方法

必要環境は Node.js 22 以上と、ログイン済み Codex CLI です。初回はリポジトリのディレクトリで `npm install` を実行してください。

Linux / macOS:

```sh
cd /path/to/MWSCup-B
npm install
npx codex login
npx codex login status
npm start
```

Windows PowerShell:

```powershell
cd C:\path\to\MWSCup-B
npm.cmd install
npx.cmd codex login
npx.cmd codex login status
npm.cmd start
```

PowerShell で `codex` が `codex.ps1` として解決され、実行ポリシーで拒否される場合も、上記の `npx.cmd codex ...` を使用できます。PowerShell の実行ポリシーを変更する必要はありません。Node.js のバージョンは `node --version` で確認してください。

`http://localhost:3000` を開くと Author UI へ移動します。既定は `AUTHOR` mode、listen address は `127.0.0.1:3000` です。

最終評価を通過したゲームは、生成処理の最後に `data/saved-games/` へJSONとして自動保存されます。ファイル保存に成功した後で画面が `READY`（「ゲームが完成しました」）へ進みます。完了画面では保存完了を表示し、「ゲームをプレイする」と「モード選択へ戻る」を選択できます。タイトル画面で「Game Start!」→「裁判」と進むと保存済みゲームの一覧が表示され、ゲームの開始と削除ができます。保存ファイルは静的配信の対象外であり、サーバーを再起動しても一覧に残ります。プレイ中の進行状況はゲームごとのメモリ内セッションで、再読み込み時は最初から開始します。

「ゲーム作成 / 裁判」のモード選択画面右上にはシステムメニューがあります。「遊び方」「設定」「タイトルへ戻る」「ゲーム終了」を選択できます。設定は文字サイズと画面演出をブラウザごとに保存します。「ゲーム終了」は確認後に現在のローカルサーバーを停止します。「保存せず終了」を選んでも、すでに自動保存された完成ゲームは削除せず、現在の未完了な制作状態だけを破棄します。

ポート3000が既存プロセスで使用中の場合は新しいサーバーを起動できません。既存の開発サーバーを利用するか、不要なプロセスを停止してから再実行してください。

補助 mode:

- `GAME_MODE=GENERATED GAME_CASE_PATH=private/game-case-result.json npm start`
- `GAME_MODE=FIXTURE npm start`

PowerShell では環境変数を先に設定します。例: `$env:GAME_MODE='FIXTURE'; npm.cmd start`。

## 20. Test

通常の test は実 Codex CLI を呼ばず、Codex execution boundary を mock します。

```sh
npm test
git diff --check
```

現在のログイン account を変更せずに実 Codex を1回確認する任意 smoke test:

```sh
npm run smoke:codex
```

## 21. Current Limitations

- Attack catalog は現在 `phishing`、`reflected_xss`、`sql_injection` の3定義です。
<!-- 2026-09-20 修正前: 今回の対応範囲へ更新
- Contract は Attack 1～3件を受け付けますが、現カタログで成立確認済みの複合 chain は `phishing → reflected_xss` です。3定義の単純並置は連結 Attack Graph にならないため拒否します。
-->
<!-- 2026-09-20 修正後: 今回の対応範囲へ更新 -->
- 2026-09-20更新：攻撃9種類・任意の1～6件と独立成分を含むGraphに対応。原因・変更点・検証は [攻撃選択の拡張記録](docs/attack-selection-2026-09-20.md) を参照。
- 真実丸の Authentication category に直接対応する Attack Definition はまだありません。該当定義がない category は、登録済み定義からの安全な提案に限定されます。
- プレイ中の進行状況と制作途中のsessionはメモリ上だけに保持され、server再起動で失われます。完成したゲームは`data/saved-games/`に保持されます。
- 同一 server で同時に実行できる Codex generation は1件です。
- localhost 向け単一 process 構成です。
- 自動 Evaluation は構造、技術参照、操作経路、漏えいを検査しますが、人間による教材品質レビューを代替しません。
