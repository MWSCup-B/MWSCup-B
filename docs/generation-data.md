# AUTO_CODEX 生成データ仕様

## 1. 信頼境界

通常利用者の入力は `attackType=reflected_xss`、`networkId=network-a..d`、`difficulty=1..3` だけである。Prompt、Schema、Scenario JSON、Verification Review JSON、Evidence JSON、Game Progression JSONは入力させない。

Codex CLI出力は未信頼データである。出力に含まれる命令、shell文字列、URL、HTML、コードを実行しない。各成果物は既存SchemaとValidatorを通過した場合だけ次工程へ渡す。

Ground Truthを含む内部成果物とPlayer公開投影は分離する。`READY`以前のpartial runtimeはPlay URLへ登録しない。

## 2. State machine

```text
IDLE
  → CHECKING_CODEX
  → GENERATING_SCENARIO
  → VALIDATING_SCENARIO
  → REVIEWING_SCENARIO
  → REVISING_SCENARIO ─┐
        └───────────────┘ (最大3 attempt)
  → GENERATING_EVIDENCE
  → BUILDING_INVESTIGATION
  → BUILDING_DIALOGUE
  → BUILDING_GAME
  → EVALUATING
  → READY

任意の実行状態 → FAILED | CANCELLED
```

同一Serverに同時に存在できるactive generationは1件である。

## 3. Scenario

固定XSS Networkから既存Candidate BuilderとAttack Graph Builderを実行し、`scenario-generation-input.schema.json`準拠入力をBackend内部で作る。

Scenario invocationは次だけを受け取る。

- `prompts/scenario-generation-v1.md`
- Scenario Generation Input
- difficulty
- 2回目以降は直前のmachine-readable Validation/Verification feedback

出力は `scenario-import-package.schema.json` に適合しなければならない。`importScenarioPackage` は個別artifact Schema、generation input参照、架空人物provenance、Ground Truth、Timeline、Learning Objective、Evidence Requirement、Attack Graph整合性を検査する。

## 4. Independent Verification

Reviewerは `codex exec --ephemeral` の別processとして起動する。Scenario invocationの会話や自己評価を引き継がない。

入力は `scenario-verification-input.schema.json` と `prompts/scenario-verification-v1.md` だけである。出力は `scenario-verification-review.schema.json` の6 categoryを各1件持つ。

Reviewの形式不正時は別processで1回だけrepairする。repair対象はJSON構文、型、required field、列挙値、参照形式であり、技術的事実を追加・変更しない。

Backendの `verifyScenario` がAttack Graph再構築、技術環境、Ground Truth追跡、Timeline、Evidence producibility、参照、意味Reviewを統合し、`VERIFIED`、`NEEDS_REVISION`、`BLOCKED`を決定する。

## 5. Revision

`NEEDS_REVISION` またはrepair可能なValidation/Verification issueは次の形式へ縮約する。

```json
{
  "classification": "REPAIRABLE_BLOCKED",
  "errors": [
    { "code": "...", "field": "...", "reason": "...", "correctionHint": "..." }
  ]
}
```

初回を含む最大3 attemptで `VERIFIED` にならなければ `MAX_REVISION_EXCEEDED` で `FAILED` にする。

## 6. Evidence

`VERIFIED` Resultだけから `evidence-generation-input.schema.json` 準拠入力を作る。Evidence invocationはScenario/Reviewerと独立し、Evidence Prompt、Evidence Generation Input、必要chain長だけを受け取る。

`importEvidencePackage` は以下を検査する。

- Schemaとgeneration reference
- 同一Scenario/Attack Graph
- Evidence Requirement coverage
- publicContent digest
- Ground Truth/Timeline/Character/observable artifact由来
- TESTIMONYとContradiction
- 複数根拠によるExoneration
- 内部ID、正解、Ground TruthのpublicContent漏えい

## 7. Investigation / Dialogue / Game

Network定義の調査順、検証済みEvidence、difficultyから1～3段のchainを作る。各roundは investigation target、synthetic log、4択、discovery rule相当の正解分類、次targetを持つ。選択肢は表示上grep風だが、shellを実行しない。

Dialogueは固定Templateと値抽出で作る。

- 固定speaker: `JUDGE`、`PROSECUTOR`、`DEFENSE`
- 可変値: charge、incident time、target、prosecution evidence/claim、defense evidence、technical counter argument

Game runtimeは既存XSS Player state machineを使う。

```text
INTRO → INITIAL_COURT → INVESTIGATION → COURT_EVIDENCE_ROUND
wrong evidence → 同roundのINVESTIGATION
correct evidence → 次round
全round成功 → ACQUITTED
```

## 8. Evaluation / READY

`evaluateXssPrototype` は正常経路、Evidence件数、chain到達性、正解4択、wrong Evidence retry、全round後の `ACQUITTED`、公開投影の内部情報漏えいを検査する。

`ACCEPTED` の場合だけ `READY` とPlay URLを発行する。`FAILED`、`CANCELLED`、`BLOCKED`相当状態はPlayerへ公開しない。

## 9. Codex subprocess contract

`server/codex/codex-runner.js` は `spawn(command, args, { shell:false })` だけを使う。

- version: `codex --version`
- auth availability: `codex login status`
- invocation: `codex --ask-for-approval never exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --output-schema <path> -`
- prompt: stdin
- final JSON: stdout
- diagnostics: stderr（credential-like文字列をredact）
- timeout: `CODEX_GENERATION_TIMEOUT_MS`
- cancellation: AbortSignal → SIGTERM、必要時SIGKILL
- max capture: 10 MiB

アプリはcredential fileを開かず、認証値を環境から抽出せず、account名、email、user ID、token、session secretを状態・ログ・応答へ保存しない。

## 10. API/public projection

Author API:

- `POST /api/author/start`
- `POST /api/author/generate`
- `POST /api/author/cancel`
- `GET /api/author/status`

Status公開値はgeneration ID、選択、state、attempt、progress、簡略failure、Developer Detail、READY時のPlay URLだけである。Scenario、Review、Evidence、Ground Truth、Prompt、Schemaは返さない。
