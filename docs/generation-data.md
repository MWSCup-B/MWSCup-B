# AUTO_CODEX 生成データ仕様

## 1. 正本と信頼境界

通常UIの入力は `scenario-selection` v1.0の攻撃1～3種類と舞台だけ。Backendが登録済みモデルから `Scenario Configuration v1.0` を自動作成し、以降の工程の正本とする。旧manual・真実丸APIも同じContractへ収束する。Prompt、Schema、Ground Truth、Evidence JSON、Game Case JSON、Network詳細は通常UIで直接入力させない。

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

通常UIはbootstrapの`attackChoices`（8種類）、`attackSelectionPaths`（技術検証済みの順序付きID配列）、`settings`（5舞台）、`selectionDefaults`、`maxSelectedAttacks: 3`を使用する。`createSelectionConfiguration`が自動設定の唯一の実装であり、FrontendにNetwork・成立条件の別実装を持たない。attackIdsの選択順を発生順として保持し、隣接する各攻撃に直接のENABLES関係があることを送信時にも再計算する。既定日時、難易度、技術範囲、追加資料の取得元は[攻撃・舞台の自動設定仕様](attack-selection.md)に定義する。

旧`defaultManualConfiguration`と`manualAttackChoices`・`manualAttackPresets`の全7通りは互換用に維持するが通常画面には表示しない。新入口の`auto.selection`は`inputMode: ATTACK_SETTING`と元の`request`を保存し、内部Configurationのmodeは互換のMANUALを使用する。攻撃・舞台の変更は新しいConfigurationを作る明示操作であり、送信済みの完全なConfigurationを補完・上書きしない。生成・プレビュー承認・キャンセルの工程ゲートは維持する。

フィッシングと不正ログインを併用する場合の実Attack IDは`credential_phishing`である。これはメール内リンク誘導に、偽フォームへの入力・送信・受信という条件を追加した独立の登録済み限定定義で、元の`phishing`の効果を変更しない。取得する資格情報の秘密値は一切生成しない。3種類の場合の因果順序は`credential_phishing → unauthorized_login → stored_xss`。フィッシング＋Stored XSSだけなら`phishing → stored_xss`、不正ログイン＋Stored XSSなら`unauthorized_login → stored_xss`とする。

新しいartifactと取得経路:

| Artifact | 取得service binding / Log Source | Evidence type |
| --- | --- | --- |
| credential_submission_record | web（偽フォーム） / APPLICATION_LOG | APPLICATION_LOG |
| authentication_record | auth / AUTH_LOG | AUTHENTICATION_LOG |
| application_session_record | web（正規ポータル） / APPLICATION_LOG | APPLICATION_LOG |
| stored_content_record | web（保存投稿） / APPLICATION_LOG | APPLICATION_LOG |
| browser_execution_record | browser / DEVICE | DEVICE_INFORMATION |

各攻撃の同名artifactは`attackNodeId + sourceId`で区別する。すべての選択攻撃の観測資料を要件・通常プレイの取得経路へ渡し、メールのみへの縮小を許さない。保存型XSSの発生日時は閲覧時の実行を表し、保存はその前に完了している条件とする。不正ログインの有効資格情報・パスワードのみの認証・投稿権限は教材の明示条件であり、MFA突破や管理者権限を含めない。Networkの参照・到達性・取得元とAttack Orderは通常Validatorで再検証する。

定義の一次資料は[OWASPのStored XSSの説明](https://community.owasp.org/attacks/xss/)、[MITRE ATT&CK Valid Accounts](https://attack.mitre.org/techniques/T1078/)、[Web Portal Capture](https://attack.mitre.org/techniques/T1056/003/)を参照する。これらは技術モデルの根拠であり、教材の個別記録や人物の操作を証明する資料ではない。

Frontendは選択肢・舞台・既定選択・最大件数・選択列の前段の存在を検査してから操作を有効化する。1件目は全8種類、2件目は1件目から、3件目は選択済みの順序で2件目から直接つながる候補だけを表示する。前段変更時には後段を解除し、1件・2件で止める操作も認める。候補なしの場合はその旨を表示し、4件目は設けない。Backendでも型・件数・重複・未知値・余分なフィールド・直接の因果順序を検証する。初期化失敗時は送信せず画面上部でサーバー再起動を案内する。送信中と処理中は重複開始・入力変更を禁止し、戻る操作では入力を保持する。APIのエラーも画面上部へ表示する。

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

自動生成では、既存のEvidence Requirement v1に省略可能な`investigationStage`（旧入力では省略/null）を追加し、調査先ごとに`requirement_stage_N`を一つ作る。`order`、`targetId`、`sourceNodeId`、発言者・対象人物、`claim`、`questionFocus`、`expectedInference`、`limitedRefutation`を持ち、同要件の`grounds`がその段階の必要資料である。現在の取得元の資料を最低一つ含み、残りも現在までに取得可能でなければならない。順序・取得元・人物・段階数・前方依存は`INVESTIGATION_STAGE_PLAN_INVALID`で拒否する。意味上の到達可能性は独立Reviewが引き続き検証する。Evidence生成後にも各反駁の根拠が段階別資料を満たすかを確認し、不足は`INVESTIGATION_STAGE_EVIDENCE_MISSING`とする。全調査後の作者の目標は全体要件に保持し、観測資料ごとの要件へは重複転記しない。

攻撃別の比較設計は[攻撃学習の設計](attack-learning.md)に従う。同じ攻撃の取得済み資料を段階別groundsへ保持し、複数観測源の比較を単一資料へ置き換えない。Evidence生成では観測欄・定義済みの相関値・問題と解説の具体性も確認する。不足値の自動補完、攻撃や結果の追加はしない。これらの検査は既存の修正回数・独立Review・最終Evaluationを変更しない。

自動Revisionの内部出力は`scenario-revision` v1.0（`schemaVersion`、`requirementUpdates`）。既存requirementIdに対するdescription、grounds、stageTextだけを変更でき、nullは変更なし。新規/重複ID、未定義フィールド、取得元・順序・人物IDの変更を受け付けない。入力は`SCENARIO_REQUIREMENT_REVISION_V1`で、元入力の検証後に外部生成用Schema、未選択Attack Definition、重複Networkを除いた投影と既存Scenario・作者意図・取得経路を渡す。Ground TruthやTimelineをAIに再出力させない。差分適用後は元の正本でcanonical validationと独立Reviewを再実行する。形式エラーの再修正にも元のレビュー指摘を保持する。外部Scenario Import Packageの全文取込契約は変更しない。

`VERIFIED` になった後に初めて `SCENARIO_PREVIEW` で停止する。Preview は事件概要、Attack、order、time、target、Investigation、Difficulty、Network Diagram、検証結果を含むが、Ground Truthと内部Answer mappingを通常表示しない。入力した証拠の答えは制作者向け詳細を開いた場合だけ表示する。

`USER_APPROVED` 前に Evidence、Dialogue、Game Build へ進めない。承認後は検証済みScenarioを変更せず、Evidence以降へ渡す。

## 6. Independent Verification

Scenario基盤の構築とは別の Codex invocation が、攻撃Scenarioを選択した調査方法と証拠で実現・説明可能かsemantic reviewする。Backend は Attack Graph、技術環境、Ground Truth 追跡、Timeline、Evidence producibility、参照を独立に再計算する。

repairable issue は Scenario Agent へ戻す。初回を含め最大3 attempt で `VERIFIED` にならなければ停止する。生成担当の自己評価だけで gate を通過させない。

## 7. Evidence / Investigation / Dialogue

`VERIFIED` Scenario だけから Evidence Generation Input を作る。Evidence は requirement、Ground Truth、Timeline、Character、observable artifact へ追跡可能でなければならない。

自動生成CLIには正本Inputを変更せず作成した`evidenceDraftInput`と内部`evidence-generation-draft`契約を渡す。draftのEvidence部分は正本Evidence Packageと同じ内容だが、Artifactの`integrity`を含めない。別途、進行用の`courtQuestions`を調査対象ごとに1問必須とする（契約上1～128問、実際の件数は検証済み取得元から確定）。Backendは質問を分離し、JSON解析済みの`publicContent`をtrim、改行変換、Unicode正規化せずUTF-8でSHA-256計算し、正本Packageへ変換してから通常のImport検証を通す。draftへのintegrity持込みも拒否するため、外部の不正なハッシュを再計算して通過させる経路にはならない。外部ImportのSchemaとダイジェスト検証は変更せず、`courtQuestions`も持ち込まない。ダイジェストは本文の同一性の検査であり、本文が技術的に正しいことや要件を満たすことの証明ではない。

各質問は`court-question` v1.0の閉じた契約（schemaVersion、statementId、prompt、choices、correctOptionIndex、supportingQuotes、explanation）を通す。choicesは重複しない文字列4件、正解位置は0～3、引用は既存Contradictionの各conflictingEvidenceIdsに属する非TESTIMONY資料のpublicContentに実在する文字列とする。全反駁対象statementへ1問ずつ対応し、問題・選択肢・解説の内部ID漏えいも検査する。不足時は`EVIDENCE_COURT_QUESTIONS_REQUIRED`等で同じ最大2回のEvidence修正へ戻し、旧形式へのフォールバックは行わない。既存の引用は根拠を追跡するためのもので、文章の意味や選択肢の唯一性まで自動的に証明するものではない。教材の意味・自然さは別途内容確認が必要である。

CLI入力の`contextFormat: DEDUPLICATED_VERIFIED_INPUT_V1`は、検証済みEvidence Agent Inputから重複コピーだけを除去した内部投影を表す。`evidenceAgentInput`にはschemaVersion、evidenceAgentInputId、元のinputFingerprint、scenarioVerificationInput全文、verificationResult全文を保持する。Scenario/Ground Truth/Timeline/Characters/Learning Objectives/Evidence Requirementsは`scenarioVerificationInput.scenarioPackage`、Attack Graph/Network/Context/Candidate/Attack Definitionsは`scenarioVerificationInput.generationInput.technicalInput`、Handoffは`verificationResult.evidenceAgentHandoff`を参照する。referenceMaterialsも保持する。投影前に正本の重複項目の一致とfingerprintを検証し、出力のImport時は元の正本で検証する。投影を外部用Evidence Agent Inputとして扱ったり、fingerprintを投影から再計算したりしない。

Scenario Templateは全選択攻撃の`SATISFIED`なartifactについて、既存のservice bindingとNodeのLog Sourceから取得要件を構成する。メールとWebアクセス記録は別の取得元と操作へ割り当てる。主調査の選択値を変更せず、論証に必要な補助資料も通常プレイで提示する。取得元が確認できない場合は`EVIDENCE_SOURCE_UNAVAILABLE`で停止し、記録設定を追加して補完しない。

Evidence Validatorは要件IDのcoverageに加えて、各要件が依存する全`ATTACK_GRAPH_ARTIFACT`が非TESTIMONY資料のsourceRefsに含まれるか確認する。メールだけを全要件へ紐付けても、必要なWeb記録がなければ`OBSERVABLE_EVIDENCE_NOT_COVERED`となる。

Contradictionの`groundTruthRefs`は非空で、`testimonyEvidenceId`内の`statementRef`で解決したstatementの`groundTruthRefs`に包含されなければならない。全件一致ではなく包含の検査であり、両側の各参照が検証済み`technicalFacts[].factId`として存在することも別に検査する。複数攻撃のfactをまとめてContradictionへ追加しても、対象statementがそのfactを評価していなければ`CONTRADICTION_GROUND_MISMATCH`になる。

このコードは明示的に`REPAIRABLE_BLOCKED`へ分類する。任意の`*_MISMATCH`を一括で修正可能とはしない。不一致だけでImportがINVALIDになった場合、同じ最大2回のEvidenceループ内で、`evidenceGroundRevision` v1.0（draft、mismatches）を次のCLI呼出しの未信頼データへ渡す。mismatchesはContradiction ID、TESTIMONY ID、statement ID、両側のgroundTruthRefs、statementにない参照を持つ。初回の正常入力にはこの追加データを含めず、Ground Truth・Scenario・Networkの正本も変更しない。

修正版で変更できるのは指摘されたContradictionとstatementのgroundTruthRefsだけとする。本文、spokenContent、技術評価、出典、要件、各ID、競合資料、reason、Exoneration、4択、別statementの変更は`EVIDENCE_GROUND_REPAIR_CHANGED_INPUT`で拒否する。許可欄を除いたコピーの比較で保存を確認し、実際の参照配列はBackendで上書きしない。その後、通常のSchema・Import・4択検証・Build・Evaluationをすべて通す。参照の共通部分への切詰めや和集合による自動補完、3回目の追加実行は行わない。修正用の参照一覧やdraftはPlayer API・通常ログ・Developer Detailへ公開しない。

自動Author PipelineではVALID Importの後、予定Progressionの`retrialStatementIds`と提示可能な非TESTIMONY資料の直積から、どの`objectionRules`にも一致しない組合せを確認する。同じstatementに複数ruleがあれば正解の和集合として判定する。Evidence ImportのVALIDは法廷選択肢の充足を意味しない。

全組合せが正解なら`EVIDENCE_NO_INCORRECT_OBJECTION_PAIR`を返し、元のdraftを未信頼データ`courtChoiceRevisionBase`としてEvidence Agentへ渡す。技術Artifact、既存statement・公開本文、各ID、出典・要件、Contradiction、Exoneration、courtQuestionsは保持し、既存TESTIMONYの配列・本文末尾へのCONSISTENTな発言追加だけを許す。追加発言は既存Ground Truth参照を持ち、通常のImportで本文との対応と参照を再検証する。正解参照の削除、技術本文の書換え、根拠のない発言等は`EVIDENCE_COURT_REPAIR_CHANGED_INPUT`で拒否する。入力Configurationと承認済みScenarioは変更しない。

Evidence生成は限定修正も含めて最大2回であり、別の無制限ループを追加しない。進捗とGENERATING_EVIDENCEの最終エラーにはEvidence自身の実行回数を記録し、Scenarioの試行番号を流用しない。Schema・Import・法廷選択肢の全条件を満たした回のProgressionだけを後続へ渡す。直前のImportがVALIDでも、選択肢不足や次回の非JSON出力を成功として扱わない。

`difficulty`、`evidenceCount`は調査チェーンの基準であり、取得資料総数の上限ではない。新しい自動生成の法廷は調査対象ごとに1回行う。既存取得元NodeとTarget Typeが同じ資料を一つの対象にまとめる。証言は報告書・問題・法廷に表示し、技術資料の調査先には数えない。`narrativeTimestamps`は架空の表示設定であり、観測時刻の裏付けとして使用しない。人物は証言の発言者と対象として対応付け、端末の操作者や積極的な非関与を資料なしに設定しない。

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

新しいPlanは`investigationMode: SEQUENTIAL_TARGETS`、`courtIssueMode: DISTINCT_CLAIMS`を持ち、`courtRoundCount`を調査対象数と一致させる。反駁対象statementの配列順で内部`courtIssues`を作り、同順序の`investigationTargetId`、statementIds、judgmentRuleIds、requiredEvidenceIds、questionを対応付ける。CLIへ生成前に渡す`investigationStages`に取得元・方法・既存groundを明示する。現在と過去の資料だけで解けること、現在の対象の根拠を使うこと、将来の対象を前提とする取得条件がないことを検証する。不成立なら`SEQUENTIAL_INVESTIGATION_UNSOLVABLE`で既存の最大2回のEvidence差し戻しへ進み、未解決なら生成を止める。公開sessionへ正解ルール・必要資料ID・正解位置・引用対応は返さない。

公開質問はstatementId、prompt、choices（choiceId、text）だけである。choiceIdはstatementId・prompt・選択肢本文のSHA-256から作り、公開順はID順とする。正解位置やモデルの出力順はID・並び順へ使わない。解説は争点解決後のresult.publicExplanationにだけ公開する。問題・解説も内部ID漏えい検査に含める。旧Planで質問を省略した場合は従来の判定とfingerprintを維持するが、新しい自動Author生成での省略は許さない。

`INITIAL_COURT`は1ページの事件報告書として表示する。Configurationと検証済みAttack GraphのENABLESに基づく攻撃の連鎖を説明するincidentOverview、冒頭資料の種類と観測範囲に基づき、原文や個別の記録値を引用せず疑いの理由を一般化するprosecutionOpening、initialCourtEvidenceIdsの原文、証言、調査開始の案内を同時に載せ、ページ送りはしない。冒頭資料は最初の対象で再確認できるものに限る。新たな観測事実・人物対応・証拠は補完しない。旧データはsynopsis等を利用できる。

新形式では対象を1件だけ公開し、他の対象へのAPI操作も拒否する。INVESTIGATIONへ入る操作時、Backendは現在の対象の既存Discovery Ruleと前提条件を使い、全資料を自動取得・登録する。上限付きで既存調査操作を適用し、取得できなければSTAGE_EVIDENCE_UNAVAILABLEで停止してsessionを変更しない。参照GETは進行を変更しない。公開currentEvidenceIdsは今回取得済みの全資料を指し、正解の支持資料とは関係なく過去の資料と表示を分けるために使う。対象・方法の選択や登録操作はUIに置かず、証拠一覧から選んだ取得済みの1件と、その下の証言・4択を一つのパネルに表示する。閲覧選択はFrontend内だけで保持し、推理・正解・取得状態を変更しない。次の調査段階では今回の資料を初期表示する。推理の選択を保存して帰廷する。必要資料はContradictionの競合資料、最終争点ではExonerationの支持資料から導き、提示時にも取得を検査する。正解時だけ次の対象を開き、選択と直前の調査結果をリセットする。誤答は同じ対象の`INVESTIGATION`へ直接戻り、取得済み資料と解決済み対象を保持する。上限は各対象3回。`investigation`で任意に戻って推理を選び直しても回数は消費しない。新しい対象の自動解禁をDiscovery Resultへ公開しない。

sessionの`dialogue`は公開済みの証言・取得元名・選択済み推理・成功後の説明から作る。`dialogue-template.js`の短い固定台詞と組み合わせ、話者・本文・事実区分を付ける。内部Dialogue Planの非公開slotをそのまま公開しない。脚本は`docs/game-script.md`に記載する。旧Planの調査・帰廷・GUILTY_RETRY経由の遷移は記録済みの方式を維持する。

Evaluation は Evidence/Investigation 到達性、未発見 Evidence の取得拒否、各争点の誤提示（4択方式では誤解釈と正しい証拠）、試行上限、異なる回答による全争点解決、解決済み回答の再利用拒否、`ACQUITTED`、情報漏えいを実行確認する。旧Planのモード未指定と旧Game Caseの`courtIssues`なしは既存の判定・fingerprint投影を維持する。新しい争点を未検証の旧成果物へ補完しない。

誤答組合せの探索はEvidence後の事前検査とEvaluationで共通である。最終Evaluationも誤答なしのGameを拒否し、`RETRY_PLAYTHROUGH_FAILED`、`LIMIT_PLAYTHROUGH_FAILED`、`INSUFFICIENT_BRUTE_FORCE_RESISTANCE`の理由に全組合せ正解を明示する。誤答が存在する場合は、従来どおり実runtimeでretry遷移・試行回数・上限終了を検査する。検査をskip/PASSへ置き換えず、通常の自動Progressionの上限3回も変更しない。

自動Progressionの調査先名は、確認済みNetworkの取得元ラベル、または文書用の固定名と連番を用いる。調査先は発見前に公開されるため、未発見Artifactの`title`や`publicContent`から作らない。内部の`sourceNodeRef`とDiscovery Ruleは維持し、資料を削除せず、発見後に元のタイトル・本文を公開する。未発見資料の取得拒否と情報漏えい検査は維持する。

メール取得は既存の`MAILBOX`対象と`action_check_email`を使用し、取得元Nodeは変更しない。Player向けActionにはREADY / WAITING / COMPLETEを付け、未発見資料と完了操作の前提条件からBackendが算出する。待機理由は公開してよい調査先・操作の案内に留め、内部prerequisitesや未発見の資料名を返さない。モードのない旧形式だけが画面で対象・方法と登録操作を選ぶ。SEQUENTIAL_TARGETSでは同じ取得処理をBackendが適用する。前提を満たす完了操作もREADYとするため、操作依存の旧経路も維持できる。

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

既定timeoutは通常生成180,000ms、`GENERATING_EVIDENCE`と`REVISING_SCENARIO`は600,000ms。`CODEX_GENERATION_TIMEOUT_MS`を明示すれば全生成工程へ適用し、`CODEX_EVIDENCE_TIMEOUT_MS`または`CODEX_SCENARIO_REVISION_TIMEOUT_MS`を明示すれば該当工程だけを上書きする（1,000～2,147,483,647の整数。不正値は未設定扱い）。呼出し単位の`timeoutMs`指定はこれらより優先する。version/login確認は各10,000ms。stderrの進捗やstdoutの無出力で上限を延長せず、上限到達時にSIGTERM、必要なら1秒後にSIGKILLを送る。タイムアウト時は内容修正retryへ流さず失敗し、partial JSONをImportしない。`CODEX_TIMEOUT`に`execution_timeout`分類と数値のtimeoutMs/elapsedMs/promptBytes/stdoutBytes/stderrBytes、exitCode、terminationSignalを付け、Developer Detailと工程ログへ渡す。Promptやstderr本文は含めない。

## 10. Author API

- `POST /api/author/start`
- `POST /api/author/selection` — 通常UI。`{request: {schemaVersion: "1.0", attackIds: [...], settingId: "company"}}`
- `POST /api/author/select-mode`
- `POST /api/author/manual`
- `POST /api/author/makotomaru`
- `POST /api/author/approve`
- `POST /api/author/reject`
- `POST /api/author/regenerate`
- `POST /api/author/cancel`
- `GET /api/author/status`

Player API は `POST /api/start` と `POST /api/action` である。Author token、Player token、playId を分離する。

新形式の`retrial`入力は`action`、`interpretationChoiceId`。対象の資料が未登録なら`COURT_RETURN_CONDITION_NOT_MET`、選択省略・未知ID・別問題のIDなら`INTERPRETATION_CHOICE_REQUIRED`で拒否する。保存した選択だけを`pendingInterpretation`として法廷へ返し、`objection`は`statementId`、`evidenceId`とサーバー保存済み選択を判定に使う。選択を再送する場合は保存値との一致が必要で、異なる値は`INTERPRETATION_CHANGED_IN_COURT`で拒否する。誤った推理や証拠の有効な提示は1回を消費する。選択時には採点・解説を公開しない。旧4択形式は従来どおり`objection`で解釈を選び、質問なし形式はstatementIdとevidenceIdを使う。

## 11. Phishingの証拠設計例

以下は教材用の合成例であり、失敗したセッションの実ログを復元したものではない。実際のPackageには対象Scenarioの検証済み参照とfingerprintが必要であり、この例だけでVERIFIEDとはしない。

| 資料 | 既存の根拠 | 取得経路 | 確認できる範囲 |
| --- | --- | --- | --- |
| 保存メール | `email_record` | Mail serviceのNode → メール確認 | 表示URL、HTMLソースのhref、本文・ヘッダー。保存されているだけではクリックを証明しない |
| Webアクセス記録 | `web_access_record` | Web serviceのNode → 監査ログ確認 | 対象リクエストと記録時刻。操作人物・意図・クリック原因は確定しない |
| 架空の調査担当者の供述 | 既存witness / defendant | 提示された供述資料 → ファイル調査 | 発言した内容。技術的事実とは別に評価する |

「メール文のリンク先と実際に遷移するリンク先が異なること」を調べるためのメール資料例。本文のHTMLは実行せず、ソースを文字列として提示する:

```text
From: notice@example.invalid
Subject: ポータルからのお知らせ
Content-Type: text/html; charset=UTF-8

次の案内を確認してください。
<a href="https://portal.example.invalid/notice?ref=training-01">https://portal.example.invalid/help</a>
```

自動Evidence生成のWEB_ACCESS_LOG、AUTHENTICATION_LOG、APPLICATION_LOG、DATABASE_LOG、NETWORK_LOGはJSON Lines（1行1件のJSONオブジェクト）を使う。種別と取得条件に応じた観測項目だけを選び、ログ本文に見出し・教材注記・解説用フィールドを入れない。取得条件にない時刻・IP・HTTP結果・PID・製品固有Event ID等は足さない。製品未指定のため、実在製品の既定ログとは称さない。

EVIDENCE_LOG_FORMAT_INVALIDは既存の最大2回の生成内で差し戻し、未解消なら停止する。この検査は構文と解説用フィールドの検査であり、技術的意味の証明ではない。従来の出典・coverage・引用・前提条件の検証も必要である。後処理で本文を改変して違反を隠さない。外部Importと旧資料は原形式を保持する。設計は[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)の、記録元ごとに観測範囲を区別し必要なイベント属性を記録する考え方を参照する。JSON Linesは本教材の出力仕様であり、実在製品の設定を確認したという意味ではない。

Web記録の例:

```text
{"timestamp":"2026-09-18T09:10:00+09:00","request_target":"/notice?ref=training-01"}
```

この例の時刻は教材用合成値であり、実測値ではない。合成資料の表示はログ本文ではなくUIの資料枠が担う。この例では表示文字列の`/help`とhrefの`/notice?ref=training-01`が異なり、Web記録は後者を対象にしている。同一の検証済みWeb対象に対応する教材用URLとして扱い、新しいホストや到達性を追加しない。302応答やLocationヘッダーは作らず、HTTPリダイレクトが起きたとも断定しない。メールと記録の対象が一致しても、そのメールからのクリックや操作者の特定までは証明しない。

反駁対象の架空の供述は「メールの誘導先とWebアクセスの対象が一致するので、この二つの記録だけで被告人が自分の意思でリクエストを送ったと特定できる」とする。主張の対象は被告人だが、被告人と利用端末・アカウントの対応を新たな技術factにしない。

学習者は両資料の対象と利用可能な時刻を比較し、記録されたリクエストと、操作者・意図の特定が異なることを確認する。メールの配送・クリック時刻が未記録なら、その前後関係は未確認とする。到達する結論は「この資料だけでは当該人物・意図を特定する主張を支持できない」であり、「被告人は操作しなかった」「別の人物が実行した」という未提示の事実を結論にしない。

Package化する際は、メールとWeb資料の`sourceRefs`に各Requirementの既存artifact groundをコピーし、対応する全`requirementIds`とpurposeを割り当てる。架空の供述はTESTIMONYのstatementとして分離し、Contradictionはそのstatement・競合する技術資料・既存Ground Truthを参照する。Exonerationは既存被告人、両技術資料、Ground Truthへ追跡可能にする。失敗通知1件でこれらを代用しない。実際のセッションに対応する参照がない状態で、この例をそのままインポートできるPackageとはしない。
