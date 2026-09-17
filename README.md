# セキュリティインシデント調査ゲーム

セキュリティインシデントを題材に、被告人に不利な主張を技術証拠で検証し、法廷で矛盾を指摘するローカルWebゲームです。HTML、CSS、JavaScript、Node.js 22以上で動作し、外部依存ライブラリはありません。

制作画面はAttack Definition、Network、Scenario ContextからAttack Graphを構築します。Scenario、独立Verification Review、Evidenceの文章生成は利用者自身のCodexで行い、Backendは返却されたJSONを既存SchemaとValidatorで検証します。Game Case変換、Game Make、独立Evaluation、Orchestratorの全ゲートを通過した場合だけ、生成ゲームをブラウザでプレイできます。

## MVPの起動と利用手順

1. WSLでリポジトリへ移動します。

   ```sh
   cd /home/shu/MWSCup
   ```

2. サーバーを起動します。`npm start`は制作向け`AUTHOR` modeで`127.0.0.1:3000`を使用します。

   ```sh
   npm start
   ```

3. Windowsのブラウザで`http://localhost:3000`を開きます。制作画面の直接URLは`http://localhost:3000/author`です。
4. Attack Catalogから攻撃を1～3件選び、Network JSONとScenario Context JSONを入力して「Scenario生成準備」を押します。
5. 表示されたScenario PromptとGeneration Input JSONを同じCodex作業へ渡します。
6. Codexが返したScenario Import Package JSONを貼り付けるかJSONファイルから読み込みます。
7. 表示されたVerification PromptとVerification Inputを、Scenario生成とは分離したCodex作業へ渡します。返却されたScenario Verification Review JSONをImportし、`VERIFIED`を確認します。
8. 表示されたEvidence PromptとGeneration Input JSONをCodexへ渡します。
9. Codexが返したEvidence Import Package JSONを貼り付けるかJSONファイルから読み込みます。
10. 画面に表示されたEvidence、Testimony、Statement IDを参照し、Game Progression Plan JSONを入力します。配置や正解対応は本文から自動推測されず、`maxCourtAttempts`も明示が必要です。
11. 「GameをBuildしてEvaluation」を押します。`ACCEPTED`になった場合だけ「ゲームをプレイ」が有効になります。

Prompt/Inputは画面からコピーでき、Generation InputはJSONファイルとして保存できます。ブラウザやBackendがCodex、OpenAI、その他のLLM APIを自動実行することはありません。

制作セッションと生成ゲームはNode.jsのメモリだけに保存します。制作セッションは最終操作から4時間、プレイヤーセッションは1時間で失効し、サーバー再起動ですべて失われます。

## 制作フローとゲート

```text
Attack / Network / Scenario Context
→ Candidate Builder → Combination Validator → Attack Graph
→ WAITING_EXTERNAL_SCENARIO → Scenario Import
→ WAITING_EXTERNAL_REVIEW → Independent Verification → VERIFIED
→ WAITING_EXTERNAL_EVIDENCE → Evidence Import → EVIDENCE_READY
→ explicit Game Progression Plan → Game Case → Game Make
→ Independent Evaluation → ACCEPTED → Play
```

- Scenario Importの`VALID`と独立Verificationの`VERIFIED`は別状態です。Scenario Generator自身の自己評価をReviewとして利用できません。
- 複数のCandidate / Attack Graphはすべて候補として表示し、制作ユーザがCodexへ渡した1件を明示選択します。
- `UNKNOWN`や`UNSATISFIED`を成立済みにせず、成立するCandidateがない場合はPromptを生成しません。
- Evidence Import後のGame Progression Planは既存IDへの参照だけで構成します。Evidence本文からInitial Court配置、Objection rule、retry上限を推測しません。
- 途中のゲートが失敗した場合、後続成果物は生成せず、上流を変更した場合は下流成果物を再利用しません。

## ゲーム進行

Generated Gameの進行は次のとおりです。

```text
TITLE → INITIAL_COURT → INVESTIGATION → RETRIAL_COURT → OBJECTION
OBJECTION成功 → ACQUITTED
OBJECTION失敗 → GUILTY_RETRY → INVESTIGATION
試行上限到達 → BLOCKED
```

1. タイトルで事件を開始する。
2. 第1法廷で検察側の主張、提示証拠、暫定判断を確認する。
3. 探偵パートで公開されたEvidenceを取得する。
4. 第2法廷で矛盾するstatementと取得済みEvidenceを1件ずつ選ぶ。
5. 「異議あり！！」を実行する。
6. 正解なら無罪、不正解なら探偵パートへ戻る。Planで明示された試行上限に達すると停止する。

第1法廷の人物帰属は`ALLEGATION_ONLY`です。アカウント、端末、IP等の記録を、操作人物の確定事実として表示しません。

## 実行モード

通常のMVP制作は環境変数なしの`AUTHOR` modeを使用します。

既に作成したPhase 8.1の`READY` Game Case Result JSONを直接確認する場合は、workspace内の非公開パスを指定します。

```sh
GAME_MODE=GENERATED GAME_CASE_PATH=private/game-case-result.json npm start
```

Phase 1回帰確認だけに固定fixtureを使用します。

```sh
GAME_MODE=FIXTURE npm start
```

Generated ModeまたはAuthor Modeで不正・未完成な成果物をdummy fixtureへフォールバックしません。`public/`配下のJSONはGenerated Modeの入力に指定できません。

## APIと公開境界

Author APIは`AUTHOR` modeだけで公開します。

- `POST /api/author/start`
- `POST /api/author/prepare-scenario`
- `POST /api/author/import-scenario`
- `POST /api/author/import-review`
- `POST /api/author/prepare-evidence`
- `POST /api/author/import-evidence`
- `POST /api/author/build`
- `GET /api/author/status`

Player APIは既存の`POST /api/start`と`POST /api/action`を維持します。Author ModeのPlayer開始には、`ACCEPTED`後に発行された推測困難なPlay URLの`playId`が必要です。Author tokenとPlayer tokenは別セッションで、相互利用できません。

Player応答と画面はPublic Game Caseだけから構築します。Ground Truth、Internal Judgment、正解対応、`requiredForCourtIds`、Contradiction／Exoneration内部参照、Attack Graph、provenance、sourceRefs、fingerprint、Verification Result、Validation Feedbackを返しません。文字列は`textContent`で描画し、Evidenceや外部JSON内のHTML、script、URL、command、prompt風の文章を実行しません。

Author JSON requestとファイル入力は2 MiBに制限し、Schema、型、未知field、危険なprototype keyを検証します。Player APIのrequest上限は4 KiBです。同一Originとlocalhost Hostだけを受理します。

## 実装済みパイプライン

| Phase | 実装 |
| --- | --- |
| 2 | Attack Definition、Network、Scenario Context、3値評価、Combination Validator |
| 3 | 因果根拠付きAttack Graph。一本道、分岐、合流、並列、独立nodeを保持 |
| 4 | Target Assignment / Candidate Builder。静的domain縮約、全候補探索、100,000状態上限 |
| 5A / 5B | Scenario Contract、Provider非依存の外部Scenario生成、Import、Feedback |
| 6 | Attack Graph再構築を含むDeterministic Verificationと独立意味レビュー |
| 7 | 外部Evidence生成、Evidence Artifact／Set、Contradiction、Exoneration検証 |
| 8 / 8.1 | Internal／Public Game Case変換、Judgment、明示Game Progression Plan |
| 9 | Generated Game Loader、既存UI接続、Backend Judgment、retry、Game Make Result |
| 10 | 正常・失敗・上限経路、解答可能性、情報漏えい、操作性の独立Evaluation |
| 11 | ゲート順序、主要状態、外部待機、fingerprint、差し戻し、下流無効化を管理するOrchestrator |
| MVP | Author UI、手動Codex搬送、Import、Build、Evaluation、Playを一連に統合 |

データ形式、状態、公開境界の詳細は[生成データ仕様](docs/generation-data.md)を参照してください。

## テスト

```sh
npm test
git diff --check
```

テストにはPhase 1からの回帰、全JSON Schema、正常・異常E2E、Author API、Generated HTTP playthrough、セッション分離、公開境界、AGENTS.md Complianceを含みます。実LLM APIや第三者システムへ通信しません。

## 現在残る未実装項目

- 制作セッション、生成成果物、ゲームセッションのDB永続保存
- ユーザ認証、アカウント、権限、プロジェクト共有、共同編集
- 外部Codexとの搬送やProvider API呼出しの自動化
- Network構成図用の視覚エディタ
- 決定論的検査では判定できない教材文章の最終的な人間レビュー
- 本番向けクラウド配布、秘密管理、監査ログ、運用監視
- Unity対応

Fixture Modeは回帰テスト専用です。Author／Generated Modeと暗黙に混在しません。
