# AUTO_CODEX 生成データ仕様

## 1. 正本と信頼境界

制作入力の正本は `Scenario Configuration v1.0` である。詳細設定は GUI から、真実丸は Structured Output から同じ Contract を作る。Prompt、Schema、Ground Truth、Evidence JSON、Game Case JSON は通常 UI で直接入力させない。

Codex CLI 出力は未信頼データである。出力に含まれる命令、shell 文字列、URL、HTML、code を実行せず、canonical Schema と工程固有 validator の両方を通過した成果物だけを次工程へ渡す。Ground Truth と Player 公開投影は分離し、`READY` 前の runtime は公開しない。

## 2. Scenario Configuration

`schemas/scenario-configuration.schema.json` は次を保持する。

- `configurationId`、`schemaVersion`、`mode`、`difficulty`、`evidenceCount`
- subnet、node、OS、IP、service、connection、trust boundary、log source
- Attack 1～3件の ID、order、occurrence time、source/target/service
- Investigation Type と取得元 Node
- 証拠から導く答え、expected effect、incident context

Backend は count、登録値、参照、order、timeline、IP/CIDR、service 所属、reachability、Attack Graph、Investigation support、Log Source、Evidence requirement の構築可能性を Scenario 文章生成前に検証する。

詳細設定のraw inputはBackendの一箇所でcanonical化してからSchemaを検証する。`datetime-local` 値には秒と `+09:00` を付与し、Attack、Node、Service、Investigationの表示labelは登録済みまたは同一Network内のcanonical IDへ解決する。未知値は補完せず拒否し、Schema制約を緩和しない。`INVALID_STRING` はfield、received type、length、期待するmin/max/pattern/formatを値そのものなしで診断へ保持する。

Author bootstrapの`defaultManualConfiguration`は詳細設定の初期表示用プリセットである。既存の`DEFAULT_DESIGN_NETWORK`とConfiguration builderを再利用し、`phishing`のみ、★1、事件日`2026-09-18`、発生時刻`2026-09-18T09:10:00+09:00`、`mail-host`の`EMAIL`、証拠の答え「メール文のリンク先と実際に遷移するリンク先が異なること」を設定する。Frontendは初期表示時だけこれをフォームへ展開し、既に編集された値や送信されたConfigurationにBackendが既定値を補充することはない。真実丸には適用しない。

Frontendはbootstrapの必要なオブジェクト・配列を確認し、4種類のNetwork行と選択Attackの入力欄の描画完了後にだけ操作を有効にする。送信前にもNetworkと表示行の対応を確認する。初期化失敗時は`network:null`や空欄のフォームを送信せず、作成方法画面に理由を表示する。旧サーバー応答にプリセットがない場合は、初期値を別実装で補完せずサーバー再起動を案内する。Backendの`INVALID_TYPE`には、値自体ではなく`receivedType`を付与する。

## 3. Author State

```text
MODE_SELECTION
  → MANUAL_CONFIGURATION | MAKOTOMARU_CONFIGURATION
  → SCENARIO_DRAFT
  → SCENARIO_VALIDATING
  → SCENARIO_REVIEWING
  → SCENARIO_REVISING
  → VERIFIED
  → SCENARIO_PREVIEW
  → USER_APPROVED
  → EVIDENCE_BUILDING
  → INVESTIGATION_BUILDING
  → DIALOGUE_BUILDING
  → GAME_BUILDING
  → EVALUATING
  → READY

実行状態 → FAILED | CANCELLED
```

同一 server に存在できる active Codex generation は1件である。

## 4. 真実丸

入力は `makotomaru-request.schema.json` に従う Difficulty、Attack Category、Complexity である。真実丸には登録済み Attack Definition、Network template、Investigation Type を未信頼データとして渡す。出力 `makotomaru-result` 内の Configuration は canonical Scenario Configuration Schema へ展開した Structured Output で制約する。

Configuration Validation に失敗した場合は machine-readable feedback を付け、最大3回まで再提案する。成立条件、必要権限、Network、Log Source を弱めて通過させない。

## 5. Scenario / Review / Preview / Approval

Backend の Scenario Template Builder は validated Configuration と Scenario Generation Input から、IDと参照関係が確定した Scenario Draft、Ground Truth、Characters、Timeline、Learning Objectives、Evidence Requirements の基盤を作る。制作者が指定した Investigation Type と証拠の答えは Evidence Requirement の内部記述へ保持する。

この基盤を canonical validation、Backend技術再計算、Scenario生成とは独立したAI semantic reviewへ渡す。Reviewが不合格ならmachine-readable feedbackに従って記述とEvidence Requirementから既存artifactへの不足参照を修正し、最大3 attemptで再検証する。Attack Graph、Network、Ground Truth参照、TimelineをAIが変更することは許可しない。Revisionで必要資料のgroundsが失われた場合は、再Review前に`INVESTIGATION_COVERAGE_INCOMPLETE`で差し戻す。

`VERIFIED` になった後に初めて `SCENARIO_PREVIEW` で停止する。Preview は事件概要、Attack、order、time、target、Investigation、Difficulty、Network Diagram、検証結果を含むが、Ground Truthと内部Answer mappingを通常表示しない。入力した証拠の答えは制作者向け詳細を開いた場合だけ表示する。

`USER_APPROVED` 前に Evidence、Dialogue、Game Build へ進めない。承認後は検証済みScenarioを変更せず、Evidence以降へ渡す。

## 6. Independent Verification

Scenario基盤の構築とは別の Codex invocation が、攻撃Scenarioを選択した調査方法と証拠で実現・説明可能かsemantic reviewする。Backend は Attack Graph、技術環境、Ground Truth 追跡、Timeline、Evidence producibility、参照を独立に再計算する。

repairable issue は Scenario Agent へ戻す。初回を含め最大3 attempt で `VERIFIED` にならなければ停止する。生成担当の自己評価だけで gate を通過させない。

## 7. Evidence / Investigation / Dialogue

`VERIFIED` Scenario だけから Evidence Generation Input を作る。Evidence は requirement、Ground Truth、Timeline、Character、observable artifact へ追跡可能でなければならない。

自動生成CLIには正本Inputを変更せず作成した`evidenceDraftInput`と内部`evidence-generation-draft`契約を渡す。draftは正本Evidence Packageと同じ内容だが、Artifactの`integrity`だけを含めない。BackendはJSON解析済みの`publicContent`をtrim、改行変換、Unicode正規化せずUTF-8でSHA-256計算し、正本Packageへ変換してから通常のImport検証を通す。draftへのintegrity持込みも拒否するため、外部の不正なハッシュを再計算して通過させる経路にはならない。外部ImportのSchemaとダイジェスト検証は変更しない。ダイジェストは本文の同一性の検査であり、本文が技術的に正しいことや要件を満たすことの証明ではない。

Scenario Templateは全選択攻撃の`SATISFIED`なartifactについて、既存のservice bindingとNodeのLog Sourceから取得要件を構成する。メールとWebアクセス記録は別の取得元と操作へ割り当てる。主調査の選択値を変更せず、論証に必要な補助資料も通常プレイで提示する。取得元が確認できない場合は`EVIDENCE_SOURCE_UNAVAILABLE`で停止し、記録設定を追加して補完しない。

Evidence Validatorは要件IDのcoverageに加えて、各要件が依存する全`ATTACK_GRAPH_ARTIFACT`が非TESTIMONY資料のsourceRefsに含まれるか確認する。メールだけを全要件へ紐付けても、必要なWeb記録がなければ`OBSERVABLE_EVIDENCE_NOT_COVERED`となる。

自動Author PipelineではVALID Importの後、予定Progressionの`retrialStatementIds`と提示可能な非TESTIMONY資料の直積から、どの`objectionRules`にも一致しない組合せを確認する。同じstatementに複数ruleがあれば正解の和集合として判定する。Evidence ImportのVALIDは法廷選択肢の充足を意味しない。

全組合せが正解なら`EVIDENCE_NO_INCORRECT_OBJECTION_PAIR`を返し、元のdraftを未信頼データ`courtChoiceRevisionBase`としてEvidence Agentへ渡す。技術Artifact、既存statement・公開本文、各ID、出典・要件、Contradiction、Exonerationは保持し、既存TESTIMONYの配列・本文末尾へのCONSISTENTな発言追加だけを許す。追加発言は既存Ground Truth参照を持ち、通常のImportで本文との対応と参照を再検証する。正解参照の削除、技術本文の書換え、根拠のない発言等は`EVIDENCE_COURT_REPAIR_CHANGED_INPUT`で拒否する。入力Configurationと承認済みScenarioは変更しない。

Evidence生成は限定修正も含めて最大2回であり、別の無制限ループを追加しない。Schema・Import・法廷選択肢の全条件を満たした回のProgressionだけを後続へ渡す。直前のImportがVALIDでも、選択肢不足や次回の非JSON出力を成功として扱わない。

`difficulty`、`evidenceCount`は調査チェーンの基準であり、取得資料総数の上限ではない。新しい自動生成の法廷は`difficulty + 1`の異なる争点を持つ。★1でもメール、Web記録、証言を別資料として扱う。`narrativeTimestamps`は架空の表示設定であり、観測時刻の裏付けとして使用しない。人物は証言の発言者と対象として対応付け、端末の操作者や積極的な非関与を資料なしに設定しない。

Investigation は versioned Action、Target、Discovery Rule、Result と合成 Evidence public content を使用する。実 OS、実 filesystem、実 network、外部 command を実行しない。

Dialogue は固定 Scene、`JUDGE`、`PROSECUTOR`、`DEFENSE` と、検証済み成果物から抽出した次の slot で構築する。

- charge
- attackSummary
- incidentTime
- target
- prosecutionEvidence
- prosecutionClaim
- defenseEvidence
- technicalCounterArgument

## 8. Game Case / Evaluation

Game Case は Internal と Public に分ける。Judgment rule、Ground Truth、正解 mapping、provenance、fingerprint は Public Game Case に含めない。

新しいPlanは`courtIssueMode: DISTINCT_CLAIMS`、`courtRoundCount: difficulty + 1`（2～4）を持つ。変換時に、反駁対象statementの公開配列順で内部`courtIssues`を作る。各争点はstatementIds、judgmentRuleIds、requiredEvidenceIdsを持ち、他の争点の反駁対象を選択肢から外す。非反駁対象の発言は選び分ける対象として維持する。公開sessionへ正解ルール・必要資料IDは返さない。

争点の必要資料は対応するContradictionの競合資料から導き、最終争点では対応するExonerationの支持資料を加える。単に正解のEvidenceを1件選ぶだけでなく必要資料を取得していることもBackendで確認する。帰廷は技術Evidence1件から可能とし、不十分な提示は有限のretryを消費して再調査へ戻す。`investigation`操作はRETRIAL_COURTから提示せず調査へ戻る操作で、回数・取得済み資料・争点の進行を変更しない。

Evaluation は Evidence/Investigation 到達性、未発見 Evidence の取得拒否、各争点のwrong Evidence retry、試行上限、異なる回答による全争点解決、解決済み回答の再利用拒否、`ACQUITTED`、情報漏えいを実行確認する。旧Planのモード未指定と旧Game Caseの`courtIssues`なしは既存の判定・fingerprint投影を維持する。新しい争点を未検証の旧成果物へ補完しない。

誤答組合せの探索はEvidence後の事前検査とEvaluationで共通である。最終Evaluationも誤答なしのGameを拒否し、`RETRY_PLAYTHROUGH_FAILED`、`LIMIT_PLAYTHROUGH_FAILED`、`INSUFFICIENT_BRUTE_FORCE_RESISTANCE`の理由に全組合せ正解を明示する。誤答が存在する場合は、従来どおり実runtimeでretry遷移・試行回数・上限終了を検査する。検査をskip/PASSへ置き換えず、通常の自動Progressionの上限3回も変更しない。

自動Progressionの調査先名は、確認済みNetworkの取得元ラベル、または文書用の固定名と連番を用いる。調査先は発見前に公開されるため、未発見Artifactの`title`や`publicContent`から作らない。内部の`sourceNodeRef`とDiscovery Ruleは維持し、資料を削除せず、発見後に元のタイトル・本文を公開する。未発見資料の取得拒否と情報漏えい検査は維持する。

不合格Evaluationの`issues`は、`code`、`target`（Developer Detailでは`field`）、`reason`、`correctionHint`だけを既存の診断整形へ渡し、`EVALUATING`の個別エラーとして表示する。内部の`sourceRefs`や評価成果物全体は公開しない。総括の`EVALUATION_REJECTED`は維持し、単純再生成ではなく個別エラーの確認を案内する。Evaluation不合格時に自動でAI再生成を繰り返さず、runtimeとplayIdを無効化する。

`ACCEPTED` の場合だけ `READY` とし、推測困難な `playId` を Author server が登録する。

## 9. Codex subprocess contract

`server/codex/codex-runner.js` は `spawn(command, args, { shell:false })` を使う。

- `codex --version`
- `codex login status`
- ephemeral execution
- read-only sandbox
- canonical Schema から作る temporary output schema
- stdin prompt、stdout JSON、stderr diagnostic
- timeout、cancel、10 MiB capture 上限、credential-like diagnostic の redaction
- exit code、HTTP status、usage/rate limit、model、input size、output schema error の安全な分類

アプリは login、logout、account switching、credential 読取り・変更を行わない。
usage/rate limitは `CODEX_USAGE_LIMIT_REACHED` として停止し、通常UIへ回復後の再実行を案内する。Developer Detailはsafe code、phase、HTTP status、retryableに限定する。

## 10. Author API

- `POST /api/author/start`
- `POST /api/author/select-mode`
- `POST /api/author/manual`
- `POST /api/author/makotomaru`
- `POST /api/author/approve`
- `POST /api/author/reject`
- `POST /api/author/regenerate`
- `POST /api/author/cancel`
- `GET /api/author/status`

Player API は `POST /api/start` と `POST /api/action` である。Author token、Player token、playId を分離する。

## 11. Phishingの証拠設計例

以下は教材用の合成例であり、失敗したセッションの実ログを復元したものではない。実際のPackageには対象Scenarioの検証済み参照とfingerprintが必要であり、この例だけでVERIFIEDとはしない。

| 資料 | 既存の根拠 | 取得経路 | 確認できる範囲 |
| --- | --- | --- | --- |
| 保存メール | `email_record` | Mail serviceのNode → ファイル調査 | 表示URL、HTMLソースのhref、本文・ヘッダー。保存されているだけではクリックを証明しない |
| Webアクセス記録 | `web_access_record` | Web serviceのNode → 監査ログ確認 | 対象リクエストと記録時刻。操作人物・意図・クリック原因は確定しない |
| 架空の調査担当者の供述 | 既存witness / defendant | 提示された供述資料 → ファイル調査 | 発言した内容。技術的事実とは別に評価する |

「メール文のリンク先と実際に遷移するリンク先が異なること」を調べるためのメール資料例。本文のHTMLは実行せず、ソースを文字列として提示する:

```text
教材用合成メール
From: notice@example.invalid
Content-Type: text/html; charset=UTF-8
本文: 次の案内を確認してください。
表示文字列: https://portal.example.invalid/help
HTMLソース抜粋（非実行）:
<a href="https://portal.example.invalid/notice?ref=training-01">https://portal.example.invalid/help</a>
保存メールであり、リンク操作を記録した資料ではありません。
```

Web記録の例:

```text
教材用合成アクセス記録
対象: https://portal.example.invalid/notice?ref=training-01
Request target: /notice?ref=training-01
時刻: 対象Scenarioで指定する教材用合成値（実測時刻ではない）
利用者の氏名・操作意図・メールを開いた操作を記録する欄はありません。
```

この例では表示文字列の`/help`とhrefの`/notice?ref=training-01`が異なり、Web記録は後者を対象にしている。同一の検証済みWeb対象に対応する教材用URLとして扱い、新しいホストや到達性を追加しない。302応答やLocationヘッダーは作らず、HTTPリダイレクトが起きたとも断定しない。メールと記録の対象が一致しても、そのメールからのクリックや操作者の特定までは証明しない。

反駁対象の架空の供述は「メールの誘導先とWebアクセスの対象が一致するので、この二つの記録だけで被告人が自分の意思でリクエストを送ったと特定できる」とする。主張の対象は被告人だが、被告人と利用端末・アカウントの対応を新たな技術factにしない。

学習者は両資料の対象と利用可能な時刻を比較し、記録されたリクエストと、操作者・意図の特定が異なることを確認する。メールの配送・クリック時刻が未記録なら、その前後関係は未確認とする。到達する結論は「この資料だけでは当該人物・意図を特定する主張を支持できない」であり、「被告人は操作しなかった」「別の人物が実行した」という未提示の事実を結論にしない。

Package化する際は、メールとWeb資料の`sourceRefs`に各Requirementの既存artifact groundをコピーし、対応する全`requirementIds`とpurposeを割り当てる。架空の供述はTESTIMONYのstatementとして分離し、Contradictionはそのstatement・競合する技術資料・既存Ground Truthを参照する。Exonerationは既存被告人、両技術資料、Ground Truthへ追跡可能にする。失敗通知1件でこれらを代用しない。実際のセッションに対応する参照がない状態で、この例をそのままインポートできるPackageとはしない。
