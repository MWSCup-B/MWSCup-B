# セキュリティインシデント調査ゲーム

セキュリティインシデントを題材に、被告人に不利な主張を技術証拠で検証し、法廷で矛盾を指摘するローカルWebゲームです。探偵パートでは調査対象と調査方法を選び、合成データ上の調査結果からEvidenceを発見・取得します。HTML、CSS、JavaScript、Node.js 22以上で動作し、外部依存ライブラリはありません。

現在の通常制作フローはXSSプロトタイプです。攻撃は`reflected_xss`に固定し、4種類の固定Networkと難易度★1～3だけをGUIで選択します。Network JSON、Scenario Context JSON、Game Progression JSONは通常画面では入力しません。Scenarioと独立Verification Reviewは利用者自身のCodexで生成し、Backendは既存SchemaとValidatorで検証します。従来のPhase 1～12制作パイプラインはDeveloper Modeとして維持しています。

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
4. 固定AttackのXSSを確認し、Network A～DとDifficulty ★1～3を選んで「Scenario生成準備」を押します。
5. 表示されたScenario PromptとGeneration Inputを同じCodex作業へ渡します。入力には`attackType`、`selectedNetworkId`、固定Network定義、`difficulty`、技術制約、既存Schema準拠のScenario Generation Inputが含まれます。
6. Codexが返したScenario Import Package JSONを貼り付けるか、JSON内容を保持する`.json`／`.txt`ファイルから読み込みます。
7. 表示されたVerification PromptとVerification Inputを、Scenario生成とは分離したCodex作業へ渡します。返却されたScenario Verification Review JSONをImportし、`VERIFIED`を確認します。
8. `VERIFIED`後に「XSSゲームをBuildしてEvaluation」を押します。XSS Investigation Agentが固定NetworkとDifficultyから1～3段の合成Evidence Chainを構成します。
9. `ACCEPTED`になった場合だけ「ゲームをプレイ」が有効になります。

Prompt/Inputは画面からコピーでき、Generation InputはJSONファイルとして保存できます。ブラウザやBackendがCodex、OpenAI、その他のLLM APIを自動実行することはありません。

制作セッションと生成ゲームはNode.jsのメモリだけに保存します。制作セッションは最終操作から4時間、プレイヤーセッションは1時間で失効し、サーバー再起動ですべて失われます。

## 制作フローとゲート

```text
XSS + Fixed Network A-D + Difficulty 1-3
→ Candidate Builder → Combination Validator → Attack Graph
→ WAITING_EXTERNAL_SCENARIO → Scenario Import
→ WAITING_EXTERNAL_REVIEW → Independent Verification → VERIFIED
→ XSS Investigation Agent → Synthetic Evidence Chain
→ XSS Prototype Evaluation → ACCEPTED → Play
```

Developer Modeでは、従来のEvidence Import、Game Progression GUI Builder、Game Case、Game Make、Evaluation、Orchestratorの経路も引き続き利用できます。既存Contractと状態の意味は変更していません。

- Scenario Importの`VALID`と独立Verificationの`VERIFIED`は別状態です。Scenario Generator自身の自己評価をReviewとして利用できません。
- 複数のCandidate / Attack Graphはすべて候補として表示し、制作ユーザがCodexへ渡した1件を明示選択します。
- `UNKNOWN`や`UNSATISFIED`を成立済みにせず、成立するCandidateがない場合はPromptを生成しません。
- Evidence Import後のGame Progression PlanはGUIで選択した既存IDへの参照だけからFrontendが構成します。Evidence本文からInitial Court配置、Objection rule、Investigation Target／Action／Discovery Rule、retry上限を推測しません。生成JSONは閉じた「詳細設定：JSONを表示」で開発・研究用に確認できますが、直接編集しません。
- `PLAYER_OBTAINABLE`なInvestigation Evidenceには明示的なDiscovery Ruleが必要です。開始Targetから到達不能、prerequisite循環、存在しないNetwork／Scenario／Evidence参照がある場合はGame Case変換前に停止します。
- 途中のゲートが失敗した場合、後続成果物は生成せず、上流を変更した場合は下流成果物を再利用しません。

## XSSプロトタイプのゲーム進行

通常制作で生成されるXSSプロトタイプの進行は次のとおりです。

```text
INTRO → INITIAL_COURT → INVESTIGATION
      → Synthetic Log → grep風4択 → Evidence取得
      → COURT_EVIDENCE_ROUND
正解Evidence → OBJECTION → 次RoundまたはACQUITTED → GAME CLEAR
不正解Evidence → 同じRoundのINVESTIGATION
```

Difficulty ★1／★2／★3は、それぞれ必要EvidenceとCourt Roundが1／2／3件です。grep風の選択肢は表示文字列を使う内部Simulationであり、実際のgrep、shell、ファイル、OS、ネットワーク、ブラウザ履歴へアクセスしません。ログもすべて合成データです。

従来のGenerated Game進行はDeveloper Mode向けに維持しています。

```text
TITLE → INITIAL_COURT → INVESTIGATION
      → Target → Action → Discovery → Collection
      → RETRIAL_COURT → OBJECTION
OBJECTION成功 → ACQUITTED
OBJECTION失敗 → GUILTY_RETRY → INVESTIGATION
試行上限到達 → BLOCKED
```

1. タイトルで事件を開始する。
2. 第1法廷で検察側の主張、提示証拠、暫定判断を確認する。
3. 探偵パートで現在利用可能なTargetを選ぶ。
4. Targetで利用可能なActionを実行し、公開調査結果を確認する。
5. Discovery Ruleの条件を満たして発見したEvidenceを証拠品として取得する。
6. 第2法廷で矛盾するstatementと取得済みEvidenceを1件ずつ選ぶ。
7. 「異議あり！！」を実行する。
8. 正解なら無罪、不正解なら探偵パートへ戻る。Planで明示された試行上限に達すると停止する。

Evidence状態は`UNKNOWN`、`DISCOVERED`、`COLLECTED`を分離します。`UNKNOWN`のタイトルと本文はPlayer応答へ出さず、未発見Evidence IDを直接`collect`しても取得できません。法廷で提示できるのは`COLLECTED`だけです。

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
- `POST /api/author/preview-progression`
- `POST /api/author/build`
- `POST /api/author/build-xss-prototype`
- `GET /api/author/status`

Player APIは既存の`POST /api/start`と`POST /api/action`を維持します。Author ModeのPlayer開始には、`ACCEPTED`後に発行された推測困難なPlay URLの`playId`が必要です。Author tokenとPlayer tokenは別セッションで、相互利用できません。

Investigation Actionは既存`POST /api/action`へ次の形で送ります。実OS、ファイル、ネットワーク、外部コマンドは操作せず、Internal Game CaseのDiscovery Ruleだけを評価します。

```json
{
  "action": "investigate",
  "targetId": "target_web_server",
  "investigationActionId": "action_audit_log"
}
```

Player応答と画面は許可済みの公開投影だけから構築します。Ground Truth、Internal Judgment、正解対応、Discovery Rule、prerequisite、正解Target／Action、`requiredForCourtIds`、Contradiction／Exoneration内部参照、Attack Graph、provenance、sourceRefs、fingerprint、Verification Result、Validation Feedbackを返しません。Target名、Action名、Result、Evidenceを含む文字列は`textContent`で描画し、HTML、script、URL、command、prompt風の文章を実行しません。

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
| 12 | Target + ActionによるEvidence Discovery、prerequisite／unlock、UNKNOWN／DISCOVERED／COLLECTED、到達可能性検査、Author／Player UI |
| XSS Prototype | XSS固定、Network A～D、Difficulty、独立Verification、Synthetic Log、4択調査、1～3 Evidence Chain、複数Court Round、SVG/CSS Scene UI |
| MVP | 通常5画面Wizard。Developer Modeには従来8画面WizardとGame Progression GUI Builderを維持 |

データ形式、状態、公開境界の詳細は[生成データ仕様](docs/generation-data.md)を参照してください。

## テスト

```sh
npm test
git diff --check
```

テストにはPhase 1からの回帰、全JSON Schema、正常・異常E2E、Author API、Generated HTTP playthrough、セッション分離、公開境界、AGENTS.md Complianceを含みます。実LLM APIや第三者システムへ通信しません。

## XSSプロトタイプのブラウザ確認

1. `npm start`を実行し、`http://localhost:3000/author`を開きます。
2. Network Card A～DとDifficulty ★1～3を選択し、Network JSONが通常表示されないことを確認します。
3. Scenario ImportとIndependent Verificationを行い、`VERIFIED`にします。差し戻し時はScenarioを再生成できます。
4. XSSゲームをBuildし、`ACCEPTED`後に「ゲームをプレイ」を開きます。
5. INTRO、INITIAL_COURT、INVESTIGATION、COURT_EVIDENCE_ROUNDのうち現在Sceneだけが表示されることを確認します。
6. Network図の強調対象、Synthetic Log、4択を確認します。正解調査でEvidenceが取得され、不正解調査では正解情報が表示されないことを確認します。
7. Courtで誤ったEvidenceを選ぶと「異議あり」が出ず同じRoundへ戻り、正しいEvidenceだけで異議演出が出ることを確認します。
8. 選択Difficultyと同数のRound後、`ACQUITTED`と`GAME CLEAR`を確認します。

Action実行はすべてゲーム内シミュレーションです。ブラウザやBackendがshell、実ファイル、SSH、HTTP、実ログ、パケット取得を実行することはありません。

## 現在残る未実装項目

- 制作セッション、生成成果物、ゲームセッションのDB永続保存
- ユーザ認証、アカウント、権限、プロジェクト共有、共同編集
- 外部Codexとの搬送やProvider API呼出しの自動化
- Network構成図用の視覚エディタ
- 決定論的検査では判定できない教材文章の最終的な人間レビュー
- 本番向けクラウド配布、秘密管理、監査ログ、運用監視
- Unity対応

Fixture Modeは回帰テスト専用です。Author／Generated Modeと暗黙に混在しません。
