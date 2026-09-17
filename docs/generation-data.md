# 生成パイプラインのデータ形式

この文書はAGENTS.mdと、利用者が追加した外部攻撃定義・構成と条件の分離・3状態評価の要件を実装に対応付けたものです。
Phase 2のBackend部品は、対象を割り当てた攻撃候補の成立条件を検証します。
後続の事件・真相・証拠・ゲーム生成と独立Verificationは、それぞれの後続Phaseで処理します。

## ファイルと境界

| データ | スキーマ | 内容 |
| --- | --- | --- |
| 攻撃ごとのJSON | `schemas/attack-definition.schema.json` | 外部Attack Definition |
| `network.json` | `schemas/network.schema.json` | ノード、サービス、構成上の接続、信頼境界、明示到達性 |
| `scenario-context.json` | `schemas/scenario-context.schema.json` | 脆弱性、初期権限、利用者操作、ログ設定、認証条件、その他条件 |
| Backend内部の候補 | `schemas/candidate.schema.json` | 選択した攻撃IDと、各定義の変数への対象ID割当て |

全データの `schemaVersion` は `"1.0"` です。未知の版・フィールド・条件構造は拒否します。
スキーマはJSON Schema形式です。同梱の検証器は同梱スキーマで使用するキーワードだけを実装し、未対応キーワードを黙認しません。
外部依存ライブラリ、任意コード実行、外部URL取得は使用しません。

これらのデータと検証結果はAuthor APIだけが制作工程で扱います。Player API・Player画面には接続しません。
Ground Truthは引き続きBackendとAuthor制作セッションだけで保持し、Player側へ公開しません。

## XSSプロトタイプ入力と実行境界

通常Author UIは`reflected_xss`だけを選択済みとして扱い、`network-a`～`network-d`とDifficulty 1～3を受け取ります。`server/xss-networks.js`は、表示用のsubnet・node・IP・log source定義と、既存`network.schema.json`／`scenario-context.schema.json`へ渡す技術入力を分離して保持します。表示用IP等を既存Network Contractへ未知fieldとして混入させません。

Scenario GeneratorへのAuthor handoffは次をまとめて表示します。

- `attackType: reflected_xss`
- `selectedNetworkId`
- `selectedNetworkDefinition`
- `difficulty`
- `technicalConstraints`
- 既存Schema準拠の`scenarioGenerationInput`

Scenario Import PackageとIndependent Verificationの既存Contract、再生成、`VERIFIED` gateは変更しません。XSSゲーム化は`VERIFIED`後だけ実行できます。

XSS Prototype runtimeは従来の単一`RETRIAL_COURT`契約を変更せず、別のScene Stateとして`INTRO`、`INITIAL_COURT`、`INVESTIGATION`、`COURT_EVIDENCE_ROUND`、`ACQUITTED`を持ちます。Difficulty値とEvidence Chain長は必ず一致させます。各Roundは固定Networkに存在するnodeとlog sourceを参照します。

Synthetic Logとgrep風4択は文字列データです。選択結果は事前構築した内部classificationと照合するだけで、shell、grep、filesystem、SSH、HTTP、実端末、実ブラウザ履歴を呼び出しません。Player projectionからclassification、正解Evidence列、Verification結果、Ground Truthを除外します。XSS payload風文字列は`textContent`で表示し、HTMLとして解釈しません。

Visual Assetは`public/assets/`の独自SVGで、背景、人物のrole/expression、Network図、異議演出をAsset ID経由で参照します。Game Logicにファイルpathを埋め込まず、`public/visual-assets.js`が将来のPNG／WebP差し替え境界です。

## network.json

- `nodes`：`id`、`type`、`roles`、`os`、`trustZone`。
- `services`：`id`、所属ノードの`nodeId`、`type`、`platform`。
- `trustZones`：`id`、`label`。
- `connections`：ノード間の有向接続 `from` → `to`。双方向なら両方向を明示します。
- `reachability`：始点ノード `from` から対象サービス `toService` への実効到達性 `value`。

構成上の経路だけでは、通信が許可されていると推定しません。
reachabilityの欠落・nullはUNKNOWN、falseは到達不可、trueは到達可能という明示入力です。
trueには構成上の接続経路も必要です。同一ノード内は長さ0の経路として扱いますが、到達許可の明示は必要です。
ネットワークの物理的な循環自体は不正ではありません。探索は訪問済みノードを管理して終了します。
ACLの優先順位・ルーティング・プロトコルやポートの規則を自動計算する機能は含みません。
異なる到達制御を持つサービスは別IDとして表現する必要があります。

OS・サービス種別・実行基盤・ノード種別のnullは不明です。値は定義内の条件と完全一致で照合し、OS名から能力を推測しません。
ノード・サービス・contextのエンティティIDは、全体で一意にします。

## scenario-context.json

`entities`には、ノードやサービス以外の対象を`id`と`type`で明示します。
その他の必須配列は次の6分類です。情報がなければ空配列として表現できますが、空配列は条件成立を意味しません。

- `vulnerabilities`
- `attackerInitialPrivileges`
- `requiredUserActions`
- `loggingConfiguration`
- `authenticationConditions`
- `otherConditions`

各条件は同じ構造です。

```json
{
  "predicate": "condition_name",
  "args": ["target-id"],
  "value": true
}
```

`predicate`はカタログで定義する条件名、`args`は対象IDの順序付き配列です。
分類・条件名・対象ID群がすべて一致する場合だけ同じ条件として扱います。
同じキーの重複は、値が同じでも入力エラーです。対象IDの参照切れも拒否します。
`true` / `false` は明示された値、`null`とレコード欠落は不明です。
フィールド自体の欠落はスキーマエラーとして処理を停止し、UNKNOWNを返します。

## Attack Definition

要求された13項目に加え、`schemaVersion`、`description`、`bindings`を持ちます。

- `id`、`label`、`category`：識別子・表示名・分類。攻撃IDの列挙はアプリケーションコードに持ちません。
- `bindings`：定義内の変数名と種類（`node` / `service` / `entity`）。
- `targetTypes`：変数`binding`と許容する種類`values`。
- `requiredRoles`：node変数`binding`と必須roleの`values`。省略または空配列はrole制約なしです。
- `platforms`：ノードOSまたはサービス実行基盤の許容値。
- `requiredServices`：サービス変数`binding`、所属ノード変数`node`、種類の許容値`values`。
- `prerequisites`、`requiredPrivileges`：構造化された条件の配列。配列内の条件はすべて必要です。
- `requiredReachability`：始点ノード変数`from`、対象サービス変数`toService`、説明。
- `effects`：成立した攻撃が生む、構造化された状態変化。
- `observableArtifacts`：痕跡候補のID・説明と、観測に必要な`conditions`。
- `relatedAttackPatterns`：参照用文字列。依存辺の根拠には使用しません。
- `references`：資料ID・タイトル・HTTPS URL・その資料が裏付ける範囲`supports`。

条件と効果は以下の形式です。説明文は実行も解釈もせず、照合に使いません。

```json
{
  "source": "otherConditions",
  "predicate": "condition_name",
  "args": ["$target"],
  "value": true,
  "description": "この対象について確認すべき条件の説明"
}
```

`$target`はbindingsで宣言した変数です。対象を実際のIDへ置換してから照合します。
自由文から条件を補完する処理はありません。
未対応の演算子や未宣言変数は拒否します。v1の条件演算は真偽値の完全一致と全条件のANDです。
OR、数量比較、継続時間、権限階層など新しい意味を持つ演算は、未対応のまま受理しません。

`requiredRoles.values`は現バージョンではALL条件です。対象ノードの`roles`が全値を含む場合だけ一致します。
OR条件は未対応です。role制約はAttack Definitionだけから取得し、binding名や攻撃IDから推測しません。

効果を書き込める分類は `attackerInitialPrivileges`、`authenticationConditions`、`otherConditions` です。
初期入力をコピーした探索中の状態だけを更新します。falseからtrueなど、定義された変化も扱います。
ネットワーク構成、脆弱性、利用者の行動条件、ログ設定を攻撃効果として書き換える定義はv1では拒否します。
そのような手法を将来追加する場合は、明示的な設計拡張が必要です。

新しい攻撃や条件名は、この演算範囲で表現できればJSON追加だけで対応できます。
ただし、データを読めることは技術的正確性の保証ではありません。定義の条件・効果・資料の適切さは独立検証が必要です。

## 3状態と攻撃間の接続

| 評価 | 意味 |
| --- | --- |
| `SATISFIED` | 明示入力または成立済みの前段効果により条件を満たす |
| `UNSATISFIED` | 明示値が要求と異なり、その時点では成立しない |
| `UNKNOWN` | 条件値が欠落・nullで、成立を判断できない |

1攻撃のAND条件は、不成立があればUNSATISFIED、そうでなく不明があればUNKNOWNです。
UNSATISFIEDでも、前段効果で状態が変わった後には改めて評価します。
選択した1～3種類すべてについて、同じ対象割当ての最大6通りの順序を検証します。
途中で条件未達になった順序はそこで停止し、後段効果を適用しません。

少なくとも1順序ですべて成立すれば候補全体はSATISFIEDです。
すべて失敗し、途中にUNKNOWNのため停止した順序があればUNKNOWN、なければUNSATISFIEDです。
前者は成立の保証ではなく、判断に必要な情報が足りないことを表します。

効果を実際に利用した条件には`ENABLES`辺を付けます。
読み書き・書込み同士の競合には`ORDERING`辺を付け、独立した並列処理と誤分類しません。
構造は`SINGLE`、`LINEAR`、`BRANCHING`、`PARALLEL`、`JOIN`、`MIXED`で表します。
分岐と並列は、すべての選択攻撃を含む依存グラフの構造を表します。ゲーム進行の分岐ではありません。
成立する順序が複数あれば候補を返し、1本へ恣意的に決定しません。
循環する前提を互いの未実行効果だけで成立済みにすることはありません。

ログ条件は攻撃成立とは別に、各痕跡の観測可能性として3状態で返します。
観測条件が不明・不成立の痕跡を、取得可能な証拠として生成してはいけません。

## Backendからの利用

```js
import { loadCatalog } from './server/generation/catalog.js';
import { evaluateCandidate } from './server/generation/evaluator.js';

const definitions = await loadCatalog();
const result = evaluateCandidate({ network, context, candidate, definitions });
```

`loadCatalog`の既定読込み先は`data/attacks/`です。
通常ファイルのJSONのみ読み、シンボリックリンクや不正なファイル名を拒否します。
参照URLは資料情報として保持するだけで、自動取得しません。

候補データの例（`attack-id`などは説明用の識別子であり、登録済み攻撃ではありません）：

```json
{
  "schemaVersion": "1.0",
  "selectedAttackIds": ["attack-id"],
  "assignments": [
    {
      "attackId": "attack-id",
      "bindings": [{ "name": "target", "entityId": "target-id" }]
    }
  ]
}
```

これはTarget Assignment工程が生成し、Combination Validatorが検証する対象割当てデータです。
ユーザーの生成画面に対象割当て入力を追加する仕様ではありません。
Candidate／Combination Validator自身は、一つの事件として意味のある関係を構築しません。
複数攻撃が同じネットワークで成立しても、それだけで一つの事件シナリオが完成したとは判断しません。

結果は`schemaVersion`、`state`、`blocked`、`scope`、`plans`、`attempts`、`issues`を持ちます。
入力不正または全選択攻撃を成立させられない場合、`blocked: true`と対象フィールド・理由・修正候補を返します。
このValidator自身はOrchestratorの工程状態を変更しません。Phase 11 Orchestratorが結果を受けて状態を遷移します。

正常な構造の入力には、入力と定義全体のSHA-256識別値`inputDigest`を付けます。
これはJSONシリアライズ結果の識別値であり、オブジェクトのキー順でも変わり得ます。
検証結果は毎回再計算し、古い結果をキャッシュしません。
Phase 11 Orchestratorは上流fingerprintの変更時に、影響するゲート以降の成果物を無効化して再実行を要求します。

## 上限と範囲

入力の既定値補完はしません。各スキーマに文字列長・配列長の上限を明記しています。
カタログは最大256定義、1ファイル128KiB、各候補は1～3種類を扱います。
これらは入力サイズと探索量を制限する実装上の上限です。

初期3定義の技術資料として、次の一次資料を確認しました。

- [MITRE ATT&CK: Spearphishing Link](https://attack.mitre.org/techniques/T1566/002/)：リンク型の誘導と利用者操作。
- [OWASP: Cross Site Scripting](https://community.owasp.org/attacks/xss/)：反射型の配送経路とブラウザでの実行。
- [OWASP: SQL Injection](https://community.owasp.org/attacks/SQL_Injection)：Webアプリ入力からSQL処理への影響。

初期3定義は利用者が承認した範囲で`data/attacks/`に登録しました。
テストにある抽象定義と`tests/fixtures/attack-catalog/`は合成fixtureであり、完成した事件や教材ではありません。
fixture内のOS・役割・脆弱性などはテスト専用の明示値であり、利用者入力の既定値として使用しません。

## 初期カタログの適用範囲

| ファイル | 成立時に生じる効果 | 自動で含めない被害・権限 |
| --- | --- | --- |
| `data/attacks/phishing.json` | 利用者のブラウザから特定のWebリクエストが送られる | 認証情報取得、端末侵害、マルウェア実行 |
| `data/attacks/reflected_xss.json` | 特定のブラウザ・Webオリジンでスクリプトが実行される | Cookie窃取、OS実行、DB権限 |
| `data/attacks/sql_injection.json` | 指定したDB主体の権限内でクエリが改変・実行される | 認証回避、具体的な漏えい・改変被害、DB管理者権限、OS実行 |

各定義の`description`と構造化条件の`description`に、条件名・対象引数の意味を記載しています。
初期定義の条件は、特定製品の挙動を診断する処理ではありません。
実環境に対してその値を設定する場合には、対象製品・設定・実行条件に対応する根拠の確認が必要です。

### 実行基盤と対象の対応

- `web_browser`（platform: `browser`）：利用者端末にあるブラウザ。サービスモデルにはローカル実行基盤も含め、ネットワーク待受けを意味しません。
- `email`：メールの配送・閲覧対象サービス。送信元→メール、利用者端末→メールの実効到達性をそれぞれ確認します。
- `web_application`（platform: `web`）：対象のWebアプリケーション。
- `sql_database`（platform: `sql`）：対象のSQLデータベース。
- `actor`、`user`、`database_principal`、`web_request`：contextに明示するエンティティ種別。

これらの値は初期定義のデータ内にあります。新しいサービス種別や実行基盤をコードの列挙値へ登録する必要はありません。
OSによる一律の制限は設けず、必要な実行基盤と具体的な条件を照合します。
`web_request`は攻撃対象の入力・経路を識別する合成IDです。URLや攻撃コードを実行する仕組みではありません。

### 接続と限界

phishingの`browser_request_issued`は、利用者・ブラウザ・Webサービス・リクエストの4対象で範囲を限定します。
reflected XSSが同じ4対象を前提として要求する場合のみ、その効果を使えます。
これとは別に、反射による実行可能性、入力制御、対象へのアクセス条件、実効的なスクリプト実行制御の確認が必要です。

SQL injectionには、対象入力の制御、送信、Webアプリ→DBへの到達性、DB接続主体、クエリ実行権限を別途要求します。
XSSの効果をこれらの条件の代わりには使いません。
合成fixtureで3種類を選択した場合は、phishing→reflected XSSと独立したSQL injectionを含む`MIXED`になります。
それだけでは一つの事件としての因果関係・人物・時系列の設計は完了していません。

### 痕跡と技術検証

メール、アクセス記録、ブラウザ計測記録、DB監査記録について、それぞれ対象を識別できる記録の取得・保持条件を必要とします。
これらは一般的な製品で常に記録されることを意味しません。特に、アクセスログだけでXSS実行成功を断定しません。
記録条件がUNKNOWNまたはUNSATISFIEDの場合、その痕跡を取得可能な証拠として扱えません。
記録だけで実際の操作者を断定する効果は定義していません。

一次資料への対応は各定義の`references[].supports`に記録しています。
ログについては[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)も参照しています。
単体・結合テストの成功は、独立したVerification Agentによる技術検証ゲートの合格ではありません。

## Phase 3：Attack Graph

`server/generation/attack-graph.js`は、対象割当て済みcandidateとCombination Validatorの成立計画から、
根拠付きAttack Graph候補を構築します。対象の自動割当て、条件の補完、攻撃の追加は行いません。

出力形式は次の2スキーマで検証します。

- `schemas/attack-graph.schema.json`：1つの成立したAttack Graph。
- `schemas/attack-graph-result.schema.json`：生成成功または理由付き停止を表す結果エンベロープ。

### nodeと成立根拠

各nodeは、1つのAttack Definitionとcandidateの対象割当てに対応します。
nodeには、bindings、全必須条件の評価、effects、痕跡の観測条件、Attack Definitionのreference IDを保持します。
評価ごとに、期待値・実値・3値状態・由来・入力または前段effectへの参照を記録します。

生成済みgraphに含まれるattack nodeはすべてSATISFIEDです。
ログ等の痕跡観測条件は`artifactEvaluations`として分離し、UNKNOWNまたはUNSATISFIEDも保持できます。
これは攻撃成立と、調査で痕跡を取得できることを混同しないためです。

### 因果edge

Attack Graphのedge種別は`ENABLES`です。次の4要素が対象IDを解決した後に完全一致し、
前段攻撃のeffectが実際に後段攻撃の必須条件を供給した場合だけ作成します。

- source
- predicate
- args（順序を含む）
- value

edgeにはproducerのeffect ID、consumerの評価ID、一致したfact、両nodeの成立状態を記録します。
選択順、ファイル順、category、`relatedAttackPatterns`、同じ対象の利用だけではedgeを作りません。
Scenario Contextだけですでに成立している条件にも不要なedgeを作りません。

Combination Validatorが状態の読み書き競合を安全に評価するために生成する`ORDERING`は、
因果edgeへ昇格させません。必要な順序だけを`executionConstraints`へ分離します。

### graphの形状

形状は因果edgeから計算します。

- `SINGLE`：nodeが1つ。
- `LINEAR`：1本の因果経路。
- `BRANCHING`：1つの前段から複数へ分岐。
- `JOIN`：複数の前段が1つの後段の異なる条件を供給。
- `PARALLEL`：複数node間に因果edgeがない。
- `MIXED`：連結した攻撃と独立nodeの併存、または分岐と合流の併存。

独立nodeは削除せず、singleton componentとして保持します。
初期3種類の合成fixtureでは、`phishing → reflected_xss`がLINEAR component、
`sql_injection`が独立したSINGLE componentとなり、graph全体はMIXEDです。

同じ因果構造を生む複数の成立順序は、1つのgraphの`sourcePlanOrders`へまとめます。
異なるproducerが同じ不足条件を成立させられるなど、因果構造自体が異なる場合は複数のgraph候補を返します。
選択基準がない状態で1つへ絞りません。

### 3値評価と停止結果

全選択攻撃を含むSATISFIEDな計画がある場合だけ、`status: CREATED`でgraphを返します。
必須条件または到達性がUNKNOWN / UNSATISFIEDの場合は`status: BLOCKED`、`graphs: []`とし、
機械可読なcode、対象field、対象ID、理由、修正候補を返します。
入力スキーマや参照が不正な場合、条件の3値評価とは区別して`evaluationState: null`とします。

主な停止codeは次のとおりです。

- `REQUIRED_CONDITION_UNKNOWN`
- `REQUIRED_CONDITION_UNSATISFIED`
- `REACHABILITY_UNKNOWN`
- `REACHABILITY_DENIED`
- 既存入力検証が返す`UNREGISTERED_ATTACK`、`MISSING_BINDING`等

不足条件や修正候補は自動適用しません。未実行のeffect同士で循環する条件も成立済みにはしません。

### Backendからの利用

```js
import { loadCatalog } from './server/generation/catalog.js';
import { buildAttackGraphs } from './server/generation/attack-graph.js';

const definitions = await loadCatalog();
const result = buildAttackGraphs({ network, context, candidate, definitions });
```

Attack Graphと生成結果はBackend内部の成果物です。Phase 1の通常API・画面・静的配布物には含めません。
Attack Definition、Network、Scenario Context、candidateのいずれかが変わった場合は再評価・再構築が必要です。
`inputDigest`はキー順を正規化した入力全体のSHA-256で、同じAttack Graph構造には安定した`graphId`を付けます。

Attack Graphは攻撃の技術的成立候補です。事件の人物・時系列・真相・学習目標・必要証拠を確定したGround Truthではなく、
独立したVerification Agentによる技術検証済み成果物でもありません。

## Phase 4：Target Assignment / Candidate Builder

`server/generation/candidate-builder.js`は、次のバージョン付き選択データをNetwork、Scenario Context、
Attack Definitionカタログとともに受け取ります。

```json
{
  "schemaVersion": "1.0",
  "selectedAttackIds": ["phishing", "reflected_xss"]
}
```

選択データは`schemas/candidate-selection.schema.json`、結果は
`schemas/candidate-builder-result.schema.json`で検証します。

### 静的domain縮約

各bindingは、まずkindに対応する実在対象だけをdomainに持ちます。その後、次の明示制約を適用します。

- `targetTypes`の許容値。
- nodeのOSまたはserviceのplatform。
- `requiredRoles.values`の全値。
- `requiredServices`のservice種別と所属node。
- `requiredReachability`に対応する、値が明示的に`true`の到達性レコード。
- 選択されたAttack Definitionのeffectでは生成できない、Scenario Contextの必須条件。

null、欠落、反対値を一致として扱いません。構成上の接続、binding名、攻撃ID、説明文から値を推測しません。
前段effectで成立し得る条件は静的条件として除外せず、完全割当て後にCombination Validatorが攻撃順序とともに評価します。

関係制約は、serviceと所属node、到達元とservice、条件引数の組を維持したままdomainを相互に縮約します。
いずれかのdomainが0件になった場合は探索を開始せず、`NO_TARGET_ASSIGNMENT`で停止します。

### 完全探索と上限

domain縮約後は、候補数が少ないbindingから割り当てます。同数の場合は選択と定義内の順序を使用します。
探索順は処理量を減らすためだけに使い、candidate内の攻撃とbindingは入力・定義順で出力します。

完全割当てごとに既存Combination Validatorを呼び、全選択攻撃が`SATISFIED`となるcandidateだけを保持します。
探索が完了した場合は、成立する全candidateを返します。複数件を任意に1件へ絞りません。

探索状態数は空割当てと、制約で棄却されるものを含む各部分割当てを数えます。上限は100,000です。
100,000件目に到達した時点で停止し、途中で得たcandidateをすべて破棄して
`CANDIDATE_SEARCH_LIMIT_EXCEEDED`を返します。この結果の`complete`は`false`です。

結果の`diagnostics`には次を常に含めます。

- `exploredStates`
- `searchLimit`
- `bindingCount`
- `candidateDomainSizes`（attack ID、binding、縮約後の件数）

### Backendからの利用

```js
import { loadCatalog } from './server/generation/catalog.js';
import { buildCandidates } from './server/generation/candidate-builder.js';

const definitions = await loadCatalog();
const result = buildCandidates({ network, context, selection, definitions });
```

`status: CREATED`は、上限以内で探索が完了し、返した全candidateがCombination Validatorで成立したことを表します。
入力不正、domain 0件、成立candidateなし、探索上限到達では`status: BLOCKED`かつ`candidates: []`です。

この工程は対象IDを変数へ割り当てるだけです。事件、人物、物語、攻撃時系列、証拠、証言、Ground Truth、正解を生成しません。
結果はAuthor制作工程だけで扱い、Player APIやPlayer画面には含めません。

## Phase 5A：Scenario Contract / Validation

Phase 5AはScenario Agentの生成処理ではなく、将来の生成結果が満たすBackend内部契約を定義します。
LLM、人物生成、物語生成、証拠本文生成は含みません。

### 成果物

| 成果物 | Schema | 役割 |
| --- | --- | --- |
| Scenario Draft | `scenario-draft.schema.json` | 1つのAttack Graphと各成果物IDを結ぶ |
| Ground Truth | `ground-truth.schema.json` | graph内の技術要素への追跡可能な参照を保持する |
| Character Set | `character.schema.json` | 架空人物の役割、由来、graph binding参照を保持する |
| Technical Timeline | `timeline.schema.json` | graph nodeと根拠付き順序関係を保持する |
| Learning Objective Set | `learning-objective.schema.json` | ユーザ指定または技術入力由来の学習目標を保持する |
| Evidence Requirement Set | `evidence-requirement.schema.json` | 証拠の目的と根拠を保持し、証拠本文は持たない |
| Validation Result | `scenario-validation-result.schema.json` | 契約整合性のVALID / BLOCKEDを返す |

すべての成果物は`schemaVersion: "1.0"`と同じ`scenarioId`を持ちます。
Attack Graphは`attackGraphResult.inputDigest`と`graphId`の組で識別します。
各成果物は同じ組を参照し、異なるcandidateまたはgraphの情報を混在させません。

Scenario Draftの`attackGraphRef`は単一オブジェクトです。複数graphを配列で参照する形式は受理しません。
複数のcandidate / Attack Graphは元の結果にすべて保持し、それぞれ独立したScenario Draft候補として扱います。
Phase 5AのValidatorは候補の選択、統合、削除を行いません。

### Ground Truth

Ground Truthの`technicalFacts`は次の既存要素だけを参照します。

- `ATTACK_NODE`
- `NODE_EVALUATION`
- `NODE_EFFECT`
- `ATTACK_EDGE`

factは技術値や説明を複製せず、`attackNodeId`と`sourceId`で参照します。
全Attack Graph nodeと全因果edgeがGround Truthから追跡できなければ`UNGROUNDED_GROUND_TRUTH`です。
Characterのrole参照は`characterFactRefs`へ分離し、技術factと架空人物設定を同一種類として扱いません。

### Character

Character Setの`characters`は空配列を許可するため、人物はユーザ必須入力ではありません。
人物を登録する場合、provenanceは`USER_PROVIDED`または`AI_GENERATED_SYNTHETIC`です。
roleは識別子として保持し、`defendant`、`attacker`、`victim`、`witness`、`administrator`等を表現できます。

`bindingRefs`を指定する場合、同じgraph nodeに実在するbinding名とentity IDへ完全一致させます。
role名からbindingを推測せず、端末・アカウント・IPアドレスの記録を人物特定へ変換しません。

### Timeline

Technical Timelineはgraph nodeごとにeventを1件持ちます。`order`は0以上の整数で、並列eventは同じ値を使用できます。
`dependsOn`はAttack Graphの因果edgeと`executionConstraints`の組に完全一致させます。
単なる成立順序や物語上の順番を技術依存へ追加しません。

表示用の時計時刻は`narrativeTimestamps`へ分離します。文字列内容を技術順序の計算・検証には使用しません。

### Learning Objective

Learning Objectiveは0件を許可します。originは次の2種類です。

- `USER_PROVIDED`：技術参照は任意。
- `DERIVED_FROM_TECHNICAL_INPUT`：selected attack、Attack Graph node、Attack Definition referenceをすべて要求。

Phase 5Aでは説明文を自動生成しません。指定された参照が同じAttack GraphとAttack Definitionに存在することだけを検証します。

### Evidence Requirement

Evidence Requirementは証拠本文ではなく、調査・論証で確認すべき要件です。purposeは次を扱います。

- `ATTACK_TRACE`
- `TIMELINE_PROOF`
- `IDENTITY_PROOF`
- `CONTRADICTION_PROOF`
- `EXONERATION_PROOF`

groundはAttack Graph artifact、Timeline event、Ground Truth fact、Characterを参照できます。
observable artifactを使用する場合は`attackNodeId + artifactId`で識別し、観測状態が`SATISFIED`の場合だけ受理します。
全observable artifactの採用は要求せず、artifactだけがゲームの全証拠要件であるとも扱いません。

### Consistency Validator

```js
import { validateScenarioContract } from './server/generation/scenario-validator.js';

const result = validateScenarioContract({
  attackGraphResult,
  definitions,
  scenarioDraft,
  groundTruth,
  characters,
  timeline,
  learningObjectives,
  evidenceRequirements,
});
```

`status: VALID`はSchema、ID、Attack Graph参照、技術fact、Timeline、学習根拠、証拠要件の整合性を示します。
独立した技術検証や教材としての解答可能性は評価しないため、Orchestratorの`VERIFIED`へは遷移しません。

失敗時は`status: BLOCKED`、機械可読なcode、対象field、人間向け理由、修正候補、関連IDを返します。
不足情報の生成、別graphからの補完、入力の変更は行いません。

Scenario ContractとGround TruthはAuthor制作セッションとBackend内部だけで扱い、Player API、Player画面、静的配信へ含めません。

## Phase 5B：External Scenario Generator Interface / Scenario Import & Validation

Phase 5BではScenario AgentをBackend内の特定LLMへ接続しません。ユーザ側Codexが外部Scenario Generatorとなり、
Backendは生成用データの受渡しと、返却JSONの検証だけを担当します。

### Scenario Generation Input

`buildScenarioGenerationInputs`は`CREATED`なAttack Graph Resultに含まれるgraphごとに、
`scenario-generation-input.schema.json`へ適合する独立した入力を1件作成します。

```js
import { buildScenarioGenerationInputs, SCENARIO_PROMPT_TEMPLATE }
  from './server/generation/scenario-interface.js';

const generationInputs = buildScenarioGenerationInputs({
  attackGraphResult,
  definitions,
  network,
  context,
  candidate,
});
```

各入力は次を保持します。

- `generationInputId`
- `generatorMode: EXTERNAL_USER_CODEX`
- `attackGraphRef`（`inputDigest + graphId`）
- `selectedAttackIds`
- `technicalInput.network`
- `technicalInput.scenarioContext`
- `technicalInput.candidate`
- `technicalInput.attackDefinitions`
- `technicalInput.attackGraph`
- `outputContract.packageSchema`
- `outputContract.artifactSchemas`

Network、Scenario Context、candidate、Attack DefinitionからAttack Graphを再構築し、元Resultの`inputDigest`と
graph本体に一致する場合だけGeneration Inputを作成します。異なる技術入力へのgraphの付け替えは
`GENERATION_SOURCE_MISMATCH`です。複数graphを統合、選別、削除しません。

`outputContract`には`Scenario Import Package` Schemaと、Scenario Draft、Ground Truth、Character、Timeline、
Learning Objective、Evidence RequirementのPhase 5A Schema正本を同梱します。外部CodexはPrompt Templateと
Generation Inputだけで要求されるJSON構造を確認できます。

### Prompt Template

`prompts/scenario-generation-v1.md`をGeneration Inputとともにユーザ側Codexへ渡します。Promptは次を要求します。

1. Attack Graphを技術的事実の境界とする。
2. Ground Truthをgraph内参照だけで先に確定する。
3. Timeline、完全な架空人物、Learning Objectives、Evidence Requirementsを順に作る。
4. 証拠本文を生成しない。
5. 単一graphを参照するImport Package JSONだけを返す。
6. Scenario Agent自身の出力を`VERIFIED`として扱わない。

技術入力内の説明文、URL、コード、命令文は未信頼データとして扱い、Promptの命令領域へ昇格させません。

### Scenario Import Package

外部Codexの出力は`scenario-import-package.schema.json`のトップレベルに次を含めます。

- `generationInputRef`
- `scenarioDraft`
- `groundTruth`
- `characters`
- `timeline`
- `learningObjectives`
- `evidenceRequirements`

正本の受け入れ処理はBackend内部の`importScenarioPackage`関数です。MVPのAuthor APIは未信頼JSONを受け取り、
この関数へ渡します。Player APIからは利用できません。

```js
import { importScenarioPackage } from './server/generation/scenario-interface.js';

const result = importScenarioPackage({
  generationInput,
  scenarioPackage: externalGeneratedJson,
});
```

外部Packageを変更・補完せず、次の順序で検証します。

1. Import Packageと各Phase 5A成果物のJSON Schema Validation
2. Generation Input参照と`AI_GENERATED_SYNTHETIC`人物の検証
3. Phase 5A Scenario Consistency Validation

Schema失敗時はConsistency Validationを実行しません。外部Scenario Generatorが出力した人物に
`USER_PROVIDED`が含まれる場合は`NON_SYNTHETIC_CHARACTER`です。表示名が実在人物かをBackendが推測する処理は行わず、
Promptとprovenance契約で完全な架空人物だけを要求します。

### Import ResultとValidation Feedback

結果は`scenario-import-result.schema.json`に適合し、statusは`VALID`または`INVALID`です。
`VALID`はSchemaとScenario Contractの整合性だけを示し、独立したVerification Agentの`VERIFIED`ではありません。

`INVALID`の場合、各errorは次を含みます。

- `code`：機械可読なエラーコード
- `field`：修正対象
- `reason`：不採用理由
- `correctionHint`：同じ技術入力の範囲で行う修正案

同じerrorsを含む`scenario-validation-feedback.schema.json`準拠の`feedback`を返します。
ユーザは同じPrompt Template、同じGeneration Input、FeedbackをCodexへ渡して再生成できます。
Backendは自動再生成せず、再生成回数も管理しません。

### Provider非依存性と公開境界

Generation InputとImport ResultにはLLM Provider、Model ID、API認証情報を持ちません。
Backendから外部LLMへの通信、APIキーの読込み、Provider SDKへの依存はありません。

Prompt、Generation Input、Import Package、Ground Truth、Validation FeedbackはAuthor制作工程用です。
Player API、Player向け静的ファイル、ゲーム画面には接続しません。

## Phase 6：Independent Scenario Verification

Phase 6はPhase 5Bの`VALID`と、Evidence Agentへ進める`VERIFIED`を分離する独立ゲートです。
Deterministic Verificationと独立意味的レビューを1つのPhaseで実行します。

`VERIFIED`は証拠生成前のScenarioがPhase 7へ進めることを表します。証拠本文を使った最終的な取得可能性、
解答可能性、ゲーム進行はこの状態だけでは保証しません。

### Verification Input

`buildScenarioVerificationInput`は次を`scenario-verification-input.schema.json`へまとめます。

- Phase 5B Scenario Generation Input
- Phase 5B Import Result
- Scenario Import Package
- 現在の`revisionAttemptsUsed`
- Attack Definitionの登録済みreference metadata
- 任意に提供されたreference本文
- 独立Reviewerが使用できる`allowedReviewRefs`

```js
import { buildScenarioVerificationInput, SCENARIO_VERIFICATION_PROMPT }
  from './server/generation/scenario-verifier.js';

const verificationInput = buildScenarioVerificationInput({
  generationInput,
  importResult,
  scenarioPackage,
  referenceContents: [
    { attackDefinitionId: 'phishing', referenceId: 'reference_id', content: '提供された資料本文' },
  ],
  revisionAttemptsUsed: 0,
});
```

reference本文を指定しない資料は`METADATA_ONLY`、本文を指定した資料は`CONTENT_AVAILABLE`です。
title、URL、referenceIdはAttack Definitionの登録内容からコピーし、外部入力による置換を許可しません。
資料本文は未信頼データとして扱い、命令として実行しません。

`inputFingerprint`はGeneration Input、Import Result、Scenario Package、資料、許可参照から計算します。
attemptはOrchestratorの進行状態なのでfingerprintには含めません。

### Deterministic Verification

次の7カテゴリをBackendで再計算します。

| category | 検証内容 |
| --- | --- |
| `PHASE_5B_GATE` | 同じ入力からPhase 5B `VALID`を再現できるか |
| `ATTACK_GRAPH_RECONSTRUCTION` | 技術入力から同一Attack Graphを再構築できるか |
| `ENVIRONMENT_ALIGNMENT` | 対象割当て、service所属、明示reachability、成立条件 |
| `GROUND_TRUTH_TRACEABILITY` | Ground Truthから全graph node・edgeへの追跡 |
| `TIMELINE_CONSISTENCY` | edge、execution constraint、orderとの一致 |
| `EVIDENCE_PRODUCIBILITY` | groundの存在、artifactの観測可能性、必要purposeの設計 |
| `REFERENCE_INTEGRITY` | 登録referenceIdと提供資料metadataの一致 |

Evidence Requirementには、Phase 6のゲーム設計ゲートとして最低限次のpurposeを要求します。

- `ATTACK_TRACE`
- `TIMELINE_PROOF`
- `CONTRADICTION_PROOF`
- `EXONERATION_PROOF`

不足は上流技術入力の失敗ではないため、`EVIDENCE_PURPOSE_COVERAGE_INCOMPLETE`による
`NEEDS_REVISION`として扱います。

### 独立意味的レビュー

外部の独立Reviewerへ`SCENARIO_VERIFICATION_PROMPT`とVerification Inputを渡し、
`scenario-verification-review.schema.json`準拠のJSONを受け取ります。ProviderやModelはBackendで固定しません。

必須categoryは次の6件です。

- `EVIDENCE_GROUND_ALIGNMENT`
- `LEARNING_OBJECTIVE_ALIGNMENT`
- `FACT_NARRATIVE_SEPARATION`
- `IDENTITY_ATTRIBUTION`
- `INVESTIGATION_COVERAGE`
- `REFERENCE_CONTENT_ALIGNMENT`

各categoryは1件だけ必要です。Reviewerの`subjectRefs`と`sourceRefs`は`allowedReviewRefs`に存在し、
categoryに対応する参照種別でなければなりません。Scenario Generatorの自己評価を使用したreview、
入力と異なるfingerprint、新しいnodeやfactへの参照は受理しません。

資料本文が1件もない場合、`REFERENCE_CONTENT_ALIGNMENT`は`NOT_APPLICABLE`です。
本文が提供された場合は、全`CONTENT_AVAILABLE`資料をsourceに含めて`PASS`、`FAIL`、`UNKNOWN`のいずれかを返します。
資料内容の`FAIL`または`UNKNOWN`は上流技術根拠を確認できないため`BLOCKED`です。

意味的レビューは判定材料であり、Reviewer自身は`VERIFIED`を決定しません。

### 判定

```js
import { verifyScenario } from './server/generation/scenario-verifier.js';

const result = verifyScenario({
  verificationInput,
  semanticReview: independentReviewJson,
});
```

| status | 条件 |
| --- | --- |
| `VERIFIED` | 全Deterministic checkがPASS、全意味checkがPASSまたは許可されたNOT_APPLICABLE、issueなし |
| `NEEDS_REVISION` | 技術境界は成立しているが、Scenario成果物だけで修正可能なissueがある |
| `BLOCKED` | Phase 5B不成立、技術入力不整合、独立レビュー不在・不正、資料内容不整合、再試行上限到達 |

`UNKNOWN`を`PASS`として扱いません。意味レビューの通常項目の`FAIL`または`UNKNOWN`は
Scenario Revision Feedbackへ変換します。技術入力側の不備はScenario修正では解消できないため`BLOCKED`です。

### Revision Feedbackと再検証

`NEEDS_REVISION`では`scenario-revision-feedback.schema.json`に次を記録します。

- 変更してはいけない`inputDigest + graphId`
- 現在と次のrevision attempt
- 修正対象artifact、field、ID
- machine-readable code
- reason、correctionHint、sourceRefs

初回の`revisionAttemptsUsed`は0です。修正版ごとにOrchestratorが1、2、3と更新します。
3回目の修正版にも修正issueが残る場合、それ以上の再生成を要求せず
`BLOCKED / REVISION_LIMIT_EXCEEDED`を返します。3回目で全checkが合格した場合は`VERIFIED`にできます。

修正版はPhase 5Bから再Importし、新しいVerification Inputと独立reviewで再検証します。
Verification Agentはattemptを保存・更新しません。

### Evidence Agent Handoff

`VERIFIED`の場合だけ`evidence-agent-handoff.schema.json`を生成します。Handoffには次を含めます。

- verification IDとVerification Input fingerprint
- Scenario Package fingerprint
- scenario IDとAttack Graph参照
- Ground Truth、Timeline、Learning Objective、Evidence RequirementのID
- `eligibleForEvidenceGeneration: true`

`NEEDS_REVISION`または`BLOCKED`ではHandoffはnullであり、Evidence Agentへ進めません。
HandoffとVerification Resultのverification ID、fingerprint、scenario ID、graph参照も相互検証します。

Phase 6は証拠本文を生成しません。Prompt、Input、Review、ResultはAuthor制作工程だけで扱い、
Player API、Player向け静的配信、ゲーム画面へ接続しません。

## Phase 7：Evidence Agent

Phase 7は、Phase 6の`VERIFIED` ResultとEvidence Agent Handoffを入力ゲートにし、証拠本文を外部Codexで生成して
Backend内で検証する。BackendはProvider、Model ID、API認証、自動LLM呼出しに依存しない。

### Evidence Agent Inputと上流改変検出

`buildEvidenceGenerationInput`は`scenario-verification-input`と`scenario-verification-result`から、
Verification Result、Handoff、Scenario Import Package、Ground Truth、Timeline、Characters、Learning Objectives、
Evidence Requirements、Attack Graph、Network、Scenario Context、Attack Definitionsをまとめる。

Phase 6 Resultを再検証し、`VERIFIED`、issueなし、Evidence生成可能、Handoff一致を要求する。
Verification Input fingerprint、Scenario Package fingerprint、Scenarioと各成果物ID、技術入力の複製を正本と照合する。
不一致の場合、外部生成を開始せず`BLOCKED`にする。

```js
import { EVIDENCE_PROMPT_TEMPLATE, buildEvidenceGenerationInput, importEvidencePackage }
  from './server/generation/evidence-interface.js';

const evidenceGenerationInput = buildEvidenceGenerationInput({
  scenarioVerificationInput,
  verificationResult,
});

// PromptとGeneration Inputをユーザ側Codexへ渡す。
const result = importEvidencePackage({
  generationInput: evidenceGenerationInput,
  evidencePackage: externalGeneratedJson,
});
```

`READY`なGeneration InputはEvidence Agent InputとEvidence Import Package、Evidence Artifact、
Contradiction、ExonerationのSchema正本を`outputContract`に含める。

### Evidence Artifactとmany-to-many対応

`evidence-artifact.schema.json`は次を分離して保持する。

| field | 用途 |
| --- | --- |
| `publicContent` | プレイヤーが取得する本文 |
| `sourceRefs` | Ground Truth、Timeline、Character、観測可能artifactへの内部参照 |
| `requirementIds` | 満たすEvidence Requirement。1件以上 |
| `purpose` | 参照Requirementに存在するpurposeだけ |
| `provenance` | verification、scenario、graphへの内部由来 |
| `integrity` | UTF-8 `publicContent`のSHA-256 |
| `testimony` | TESTIMONY専用の発言・技術評価 |

1 Requirementを複数Artifactで満たせ、1 Artifactも複数Requirementを満たせる。
Validatorは両方向の関係から`requirementCoverage`を構築し、全Requirementに1件以上のArtifactを要求する。
攻撃IDやEvidence typeごとの分岐は使用せず、Requirement、ground、observable artifactで検証する。

対応typeは`EMAIL`、`WEB_ACCESS_LOG`、`AUTHENTICATION_LOG`、`APPLICATION_LOG`、`DATABASE_LOG`、
`BROWSER_HISTORY`、`DEVICE_INFORMATION`、`NETWORK_LOG`、`FILE_METADATA`、`TESTIMONY`、`DOCUMENT`、`OTHER`である。

### TESTIMONY、Contradiction、Exoneration

TESTIMONYは実際の発言`spokenContent`、`technicalAssessment`、`groundTruthRefs`、
`contradictionCandidate`を保持する。技術Evidenceの`testimony`は必ず`null`である。
発言内容は`publicContent`から確認できる必要があり、発言した事実と真偽の評価を混同しない。

Contradictionは`testimonyEvidenceId`、`statementRef`、`conflictingEvidenceIds`、`groundTruthRefs`、
`reason`を保持する。`CONTRADICTED`のstatement、同一Package内の非TESTIMONY Evidence、
存在するGround Truth factへ追跡できなければならない。

Exonerationはdefendant役Character、2件以上の`supportingEvidenceIds`、1件以上の`groundTruthRefs`を要求する。
全supporting Evidenceは`EXONERATION_PROOF`要件へ関連付ける。人物同一性を推測せず、
単一のアカウント・端末・IP記録だけによる無罪断定を受理しない。

### Evidence Consistency Validation

外部Packageは次の順序で検証する。

1. 上流Verification、Handoff、fingerprintを再検証する。
2. Import Package、Artifact、Contradiction、ExonerationのJSON Schemaを検証する。
3. Generation Input、scenario、graph、provenance参照を照合する。
4. Requirement、Ground Truth、Timeline、Character、Attack Graph参照を照合する。
5. `ATTACK_GRAPH_ARTIFACT`が全評価を含め`SATISFIED`か確認する。
6. publicContentの内部Ground Truth IDと正解表現の直接露出を検出する。
7. TESTIMONY、Contradiction、Exonerationと全Requirement coverageを検証する。

| status | 条件 |
| --- | --- |
| `VALID` | SchemaとConsistencyを通過し、Evidence SetとGame Case Handoffを生成した |
| `INVALID` | 外部CodexがEvidence JSONだけを修正して解消できる不備がある |
| `BLOCKED` | Phase 6未合格、Handoff/fingerprint不一致、VERIFIED成果物改変など上流修正が必要 |

`INVALID` Feedbackの各errorは`code`、`field`、`evidenceId`、`requirementId`、`reason`、
`correctionHint`、`sourceRefs`を持つ。Backendは自動パッチや自動再生成を行わない。

### Evidence SetとPhase 8 Handoff

`VALID`成果物は`evidence-set.schema.json`へまとめる。Evidence Setは`evidenceSetId`、`scenarioId`、
`verificationId`、`attackGraphRef`、Artifact群、Requirement coverage、Contradiction/Exoneration本体と参照、
内容由来fingerprintを保持する。Contradiction/Exoneration本体もfingerprint対象なので、Phase 8で同じIDの内容差し替えを拒否できる。

Game Case HandoffはEvidence Set ID/fingerprint、scenario、verification、graphを保持し、
`state: EVIDENCE_READY`と`eligibleForGameCaseGeneration: true`を固定する。
`INVALID`または`BLOCKED`ではEvidence SetとGame Case Handoffを返さない。

Ground Truth、内部provenance、Verification Result、Requirementの内部根拠、Contradiction/Exonerationの
内部判定、Prompt、Generation Input、Validation FeedbackはBackend内部専用である。
Phase 1のHTTPルートは追加しておらず、静的配信対象は従来の3ファイルだけである。

## Phase 8：Game Case Contract / Converter

Phase 8は、Phase 7の`VALID` Evidence SetとGame Case Handoff、Phase 6の`VERIFIED` Scenario成果物を、
Game Case Contractへ変換する。Phase 8.1で正式な逆転型進行Contractを追加する。
新しいScenario、Character、Evidence、Ground Truth、Attack Graphは生成しない。

### Conversion Input Gate

`game-case-conversion-input.schema.json`は次を保持する。

- Evidence Import Result、Evidence Set、Game Case Handoff
- Scenario Package、Characters、Timeline、Verification Result
- Phase 7 Contradictions、Exonerations
- Phase 8.1 Game Progression Plan
- 内容由来の`inputFingerprint`

変換前に、Evidence Import Resultが`VALID`、Handoffが`EVIDENCE_READY`、Verification Resultが`VERIFIED`で
あることを再検証する。Evidence SetとHandoffはEvidence Import Result内の正本と完全一致する必要がある。
Scenario Package fingerprint、Evidence Set fingerprint、scenario ID、verification ID、Attack Graph参照が
一致しない場合は`BLOCKED`であり、部分的なGame Caseを返さない。

```js
import { buildGameCaseConversionInput, convertGameCase }
  from './server/generation/game-case-converter.js';

const input = buildGameCaseConversionInput({
  evidenceImportResult,
  gameCaseHandoff,
  evidenceSet,
  scenarioPackage,
  characters,
  timeline,
  verificationResult,
  progressionPlan,
  contradictions,
  exonerations,
});
const result = convertGameCase(input);
```

### Internal Game Case

`game-case.schema.json`はBackend内部で次を保持する。

- Scenario、Verification、Evidence Set、Attack Graphの参照
- 公開可能なCharacter投影
- Detective PartのEvidence一覧
- Courtroom PartのTESTIMONYと提示可能Evidence
- 非公開のJudgment rule
- 変換元fingerprintを含むprovenance
- Game Case fingerprint

Detective EvidenceはPhase 7 Artifactの`evidenceId`、`title`、`type`、`publicContent`を変更せず使用し、
`availability: AVAILABLE`と0始まりの`displayOrder`を付ける。

Courtroom testimonyはTESTIMONY Artifactからだけ作る。発言本文は`spokenContent`を変更せず使用し、
技術Evidenceを証言へ変換しない。提示可能EvidenceはPLAYER_OBTAINABLEな非TESTIMONY Artifactの全件である。

Judgment ruleはContradictionの対象statement・競合Evidenceと、そのEvidenceを支持するExonerationの組からだけ作る。
`matchMode: ANY_PRESENTED`は、`acceptedEvidenceIds`のいずれか1件を対象statementへ提示するとruleを満たすことを表す。
Ground Truth factはJudgment条件へ直接含めない。

### Public Game Case

`public-game-case.schema.json`には`gameCaseId`、中立title/synopsis、公開Character、Detective、Courtroomだけを含める。
次はSchemaと再帰的な漏えい検査の両方で除外する。

- Ground TruthとVerification Result
- `sourceRefs`、`requirementIds`、technical assessment
- provenanceとfingerprint
- Contradiction/Exonerationの内部参照
- judgmentと正解Evidence
- Attack Graph参照

Scenario Characterの内部IDは`case_character_NNN`へ置換し、technical bindingとprovenanceを除外する。
defendantと実際のtestimony speakerだけを必要な公開roleへ投影する。attacker roleは公開せず、表示名にもroleが
含まれない中立ラベルを使用する。

Scenario Contractに事件固有の公開title/synopsisがないため、Phase 8は技術事実や物語を補完せず、
固定の中立タイトルと操作説明を使用する。

### Validationと解答可能性

`game-case-validator.js`は入力ゲートに加え、Character、Evidence、TESTIMONY、statement、Contradiction、
Exoneration、Judgment ruleを相互照合する。Phase 7 publicContentの完全一致、表示順、Internal/Public投影も確認する。

少なくとも1つのJudgment ruleについて、対象statementがPublic Courtroomに存在し、accepted Evidenceが
明示Discovery Ruleから発見・取得可能かつCourtroomで提示可能で、`CONTRADICTION_PROOF`へ追跡できることを要求する。
人物同一性は推測せず、ExonerationはPhase 7で検証済みの異なる複数EvidenceとGround Truthへの追跡を維持する。
内容の構造的十分性と実プレイ相当の経路はPhase 10 Evaluation Agentでも再検証する。

### ResultとUI Integration Handoff

`game-case-result.schema.json`の状態は`READY`と`BLOCKED`である。`READY`だけがInternal Game Case、
Public Game Case、`ui-integration-handoff.schema.json`準拠Handoffを持つ。

UI Integration HandoffはGame CaseとPublic Game Caseのfingerprint、scenario、Evidence Set、Verificationを保持し、
`state: GAME_CASE_READY`と`eligibleForUiIntegration: true`を固定する。`BLOCKED`ではHandoffを生成しない。

Phase 8はPhase 1のHTTP API、`public/`、`dummy-case.js`を変更しない。Generated Game CaseのUI接続はPhase 9の範囲である。

## Phase 8.1：Game Progression Contract

Phase 8.1は、Evidence Setの本文を解釈して配置を推測せず、明示された既存IDから逆転型の進行を組み立てる。
Phase 1のHTTP、ゲームロジック、画面、CSSは変更しない。

### Game Progression Plan

`game-progression-plan.schema.json`はBackend内部のバージョン付き入力であり、次を保持する。

- Scenario、Evidence Set、Attack Graph参照と内容由来fingerprint
- `initialCourtEvidenceIds` / `initialCourtStatementIds`
- `investigationEvidenceIds` / `retrialStatementIds`
- `investigationActions` / `investigationTargets` / `initialAvailableTargetIds`
- Evidenceごとの明示的な`evidenceDiscoveryRules`
- `returnToCourtCondition`
- 既存ContradictionとExonerationへ追跡できる`objectionRules`
- 明示必須の`maxCourtAttempts`、`RETURN_TO_INVESTIGATION`、上限時`BLOCKED`
- Initial Ruling、無罪判決、公開説明、正解を明かさない失敗Feedback

Planは新しいEvidence、statement、Character、Ground Truth、Attack Graph、Judgment根拠を生成しない。
各Objection ruleのstatement、accepted Evidence、Contradiction、Exonerationが既存Phase 7成果物と一致し、
正解EvidenceがInvestigationへ明示配置されている場合だけConversion Inputを受理する。

### State Machine

`game-progression.schema.json`は次の状態と遷移を固定する。

```text
TITLE --START--> INITIAL_COURT --INITIAL_RULING--> INVESTIGATION
INVESTIGATION --RETURN_TO_COURT_CONDITION_MET--> RETRIAL_COURT
RETRIAL_COURT --SELECT_OBJECTION--> OBJECTION
OBJECTION --SUCCESS--> ACQUITTED
OBJECTION --FAILURE--> GUILTY_RETRY --RETURN_TO_INVESTIGATION--> INVESTIGATION
GUILTY_RETRY --LIMIT_REACHED--> BLOCKED
```

`ACQUITTED`だけが通常クリアである。`GUILTY_RETRY`は終了状態ではない。
`evaluateObjection`は暗黙のstatement選択を行わず、明示された`statementId + evidenceId`を
Internal Judgment ruleと照合する。失敗時は提示したID、attempt count、公開Feedbackをセッションで
管理できる結果を返し、設定された上限到達時だけ`BLOCKED`へ進める。

### Initial Court / Investigation / Retrial Court

Initial CourtはPlan指定の既存EvidenceとTESTIMONY statementだけを投影し、
`attributionStatus: ALLEGATION_ONLY`を固定する。これは被告人が技術的実行者であるというGround Truthではない。

Investigationは`PLAYER_OBTAINABLE`で明示Discovery Ruleを持つEvidenceだけを扱う。正解に必要な`requiredForCourtIds`はInternalに保持し、
Public Game Caseには公開しない。Retrial CourtはPlan指定の複数statementと、Investigationで発見・取得可能な
非TESTIMONY Evidenceを提示対象にする。

### Public境界と解答可能性

Public Game Caseへは公開Character、Investigation Actionの公開情報、statement本文、Initial Courtの公開判定、
Retry Feedback、無罪判決と公開説明だけを投影する。Evidence `publicContent`はGame Case JSONへ一括公開せず、
発見または取得後のsession viewへ必要な項目だけを動的投影する。次は公開しない。

- Judgmentとaccepted Evidenceの対応
- `requiredForCourtIds`とRetry Policy
- Contradiction / Exoneration内部参照
- Ground Truth、provenance、Attack Graph、fingerprint

ValidatorはPhase 7 `publicContent`の完全一致、全配置ID、TESTIMONY対応、上流fingerprint、
State Machineの全遷移、failure retryの戻り先を検証する。また、少なくとも1つのJudgment ruleについて、
対象statementがRetrial Courtにあり、accepted EvidenceがInvestigationで取得可能かつRetrial Courtで提示可能で、
通常プレイの経路から`ACQUITTED`へ到達できることを要求する。

### Phase 9 Handoff

`READY`の場合だけ、Game Case / Public Game Case / Progressionの各fingerprintを持つ
UI Integration Handoffを生成する。`BLOCKED`では部分成果物もHandoffも返さない。

Fixture ModeはPhase 1回帰用の旧進行を維持する。Generated ModeはPhase 9で正式Contractの
`タイトル → 第1法廷 → 探偵 → 第2法廷 → 異議あり → 無罪／再調査`へ接続済みである。

## Phase 9：Game Make Agent / UI Integration

`server/generation/game-make.js`は`READY` Game CaseとUI Integration Handoffを再検証し、
Game Case、Public Game Case、Progressionのfingerprintが一致する場合だけ`BUILT`を返す。
`server/generated-game.js`はInternal Game CaseをBackend判定専用に保持し、公開viewをPublic Game Caseと、
Discovery状態に応じて許可されたEvidence公開fieldから組み立てる。

Generated ModeのBackend sessionは`gameCaseId`、`currentState`、Target／Action／Discovery状態、`collectedEvidenceIds`、
`selectedStatementId`、`attemptCount`、`previousAttempts`、`result`をプレイヤーごとに保持する。
Objectionは明示された`statementId + evidenceId`をInternal Judgmentへ照合し、statementの暗黙選択を行わない。
不正解は公開Feedbackだけを返してInvestigationへ戻し、Planの`maxCourtAttempts`到達時は`BLOCKED`にする。

`createAppServer`を直接利用する場合は`AUTHOR`、`GENERATED`、`FIXTURE`を必須指定する。`npm start`はMVP制作向けの
`AUTHOR`を既定とする。GeneratedまたはAuthor成果物が不正な場合にdummy fixtureへフォールバックしない。
静的配信は承認済みPlayer画面とAuthor画面のHTML、JavaScript、CSSだけで、Game Case JSONや内部成果物は配信しない。

## Phase 10：Independent Evaluation Agent

`game-evaluation-input.schema.json`はGame Make Result、Internal／Public Game Case、Game Progression、
Evidence Set、Verification Result、Scenario、UI/API契約、build fingerprintを1つの評価対象として固定する。
`server/generation/game-evaluator.js`はGame Make Agentの申告だけを使用せず、buildを再構築して次を評価する。

- 正常経路で`TITLE`から`ACQUITTED`へ到達する。
- 誤った組合せで`GUILTY_RETRY → INVESTIGATION`へ戻る。
- 誤提示を上限まで繰り返すと`BLOCKED`になる。
- 正解statementが公開され、正解Evidenceが調査・取得・提示可能である。
- statementとEvidenceの両方を選び、失敗Feedbackが正解IDを漏らさない。
- Public Game Caseとsession responseに内部情報がない。
- 承認済み操作と`TEXT_CONTENT_ONLY`描画契約が揃う。

結果は`ACCEPTED`、`NEEDS_REVISION`、`BLOCKED`である。構造と操作経路は決定論的に評価するが、
文章の教育的品質に関する完全な意味評価は人間または独立外部レビューの範囲として制限に記録する。

## Phase 11：Orchestrator Integration

`orchestrator-result.schema.json`と`server/generation/orchestrator.js`は、次の標準gateを順序どおり管理する。

```text
INPUT_VALIDATION → CANDIDATE_BUILDER → ATTACK_GRAPH → SCENARIO_IMPORT
→ VERIFICATION → EVIDENCE_IMPORT → GAME_CASE_CONVERSION → GAME_PROGRESSION
→ GAME_MAKE → EVALUATION
```

主要状態は`DRAFT`、`NEEDS_REVISION`、`VERIFIED`、`EVIDENCE_READY`、`BUILT`、`ACCEPTED`、`BLOCKED`である。
外部Codex待機は`waitingFor`へ分離する。各gateはSchema検証済み成果物、期待status、直前chain fingerprintが
一致した場合だけ完了できる。gate失敗、順序違反、古いfingerprintは後続へ伝播せず停止する。

Scenario revisionは最大3回で、超過時は`REVISION_LIMIT_EXCEEDED`となる。Court attemptは
Game Progression Plan由来の上限を使用する。上流変更時は`invalidateWorkflowFrom`が対象gate以降の
artifact referenceとfingerprintを破棄し、旧成果物の再利用を拒否する。

## Phase 12：Investigation Action & Evidence Discovery

Phase 12はPhase 8.1のState Machineと`statementId + evidenceId` Judgmentを維持したまま、
`INVESTIGATION`内部を次のデータ駆動フローへ拡張する。

```text
INVESTIGATION
→ Target選択
→ Action選択
→ Discovery Rule評価
→ public Investigation Result
→ EvidenceをDISCOVEREDへ遷移
→ 明示的なCollection
→ EvidenceをCOLLECTEDへ遷移
```

shell、実ファイル、SSH、HTTP、実ログ、実端末、パケット取得、ブラウザ自動操作は実行しない。
ActionはInternal Game Case上の合成データを評価するだけである。

### Investigation Action

`investigation-action.schema.json`は次を必須とする。

- `actionId`
- `actionType`
- `displayName`
- `description`
- `allowedTargetTypes`

MVPのAction Typeは`AUDIT_LOG`、`INSPECT_DEVICE`、`CHECK_EMAIL`、
`CHECK_BROWSER_HISTORY`、`INSPECT_FILE`、`ANALYZE_NETWORK_LOG`、
`REVIEW_AUTH_LOG`、`CHECK_CONFIGURATION`である。BackendはAction Typeごとの処理分岐で
Evidenceを生成せず、TargetとActionに一致するDiscovery Ruleを共通ロジックで評価する。

### Investigation Target

`investigation-target.schema.json`は`targetId`、`targetType`、公開名と説明、
`sourceNodeRef`、`availableActionIds`、`initiallyAvailable`を持つ。
`sourceNodeRef`は次の検証済み正本だけを参照できる。

- Network node / service
- Attack Graph node / observable artifact
- Scenario Timeline event
- Evidence Artifact

Game Case Conversion InputにはVERIFIED Scenarioの生成元であるScenario Generation Inputを含め、
NetworkとAttack Graphを再検証する。存在しない対象、別ScenarioのTarget source、Target Typeで許可されない
Actionは`GAME_CASE_CONVERSION`より前に拒否する。

### Evidence Discovery Rule

`evidence-discovery-rule.schema.json`は次を明示する。

- `ruleId`
- `evidenceId`
- `targetId`
- `actionId`
- `prerequisites.requiredEvidenceIds`
- `prerequisites.requiredCompletedActionIds`
- `discoveryResult.publicMessage`
- `discoveryResult.unlockedTargetIds`
- `discoveryResult.nextHints`
- `repeatable`

完了Action IDは`completed_<targetId>__<actionId>`である。Evidence本文、型、sourceRefsからTargetやActionを
自動推測しない。`PLAYER_OBTAINABLE`かつ`investigationEvidenceIds`に明示配置されたEvidenceだけをRuleへ
接続でき、配置された全Evidenceに少なくとも1件のRuleを要求する。

### prerequisiteと到達可能性

Validatorは初期Target集合から、実行可能Action、完了Action、発見Evidence、解放Targetを固定点まで評価する。
次をGame Case変換前に拒否する。

- 存在しないEvidence、Target、Action、完了Action、unlock Target参照
- Targetで許可されないAction
- `PLAYER_OBTAINABLE`でないEvidence
- Discovery RuleがないInvestigation Evidence
- prerequisiteまたはTarget unlockの循環依存
- 初期状態から到達不能なEvidence
- Judgmentが要求する発見・収集不能Evidence

この検査は`Target → Action → Result → Evidence → Unlock`のInvestigation Graphに相当する。
OrchestratorのGate追加や順序変更は行わず、不正設計は`GAME_CASE_CONVERSION`で`BLOCKED`にする。

### Internal Game CaseとPlayer session

Internal Game Caseの`detective`はEvidence公開素材に加えてAction、Target、hidden Discovery Ruleを保持する。
初期Progressionは`initialAvailableTargetIds`を持ち、完了Action、発見Evidence、取得Evidenceは空である。

Generated Player sessionは次をプレイヤーごとに保持する。

- `availableInvestigationTargets`
- `completedInvestigationActions`
- `discoveredEvidenceIds`
- `collectedEvidenceIds`
- `lastInvestigationResult`

Evidence状態は次のとおりである。

| 状態 | Player表示 | Collection | Court提示 |
| --- | --- | --- | --- |
| `UNKNOWN` | ID、title、publicContentを表示しない | 不可 | 不可 |
| `DISCOVERED` | 公開Evidenceを表示 | 可 | 不可 |
| `COLLECTED` | 公開Evidenceを表示 | 済み | 可 |

`collect`は`discoveredEvidenceIds`に存在するIDだけを受理する。Courtroomは従来どおり
`collectedEvidenceIds`とpresentable Evidenceの積集合だけを表示し、Judgment自体は変更しない。

### Player APIと公開境界

既存`POST /api/action`に次を追加する。

```json
{
  "action": "investigate",
  "targetId": "target_web_server",
  "investigationActionId": "action_audit_log"
}
```

BackendはsessionのGame Case内でTarget、unlock状態、Action、Target Typeを検証し、prerequisiteを満たす
Ruleだけを評価する。別Game Case ID、不正Target、不正Action、未解放Targetを拒否する。
一致するRuleがない場合は正解を示さない一般的な結果を返す。

`investigation-result.schema.json`で公開するのはTarget／Action ID、`publicMessage`、今回発見したEvidence ID、
今回解放したTarget ID、公開hintだけである。Public Game CaseはActionの公開投影だけを保持する。
TargetはInternal定義から公開fieldだけを取り出し、現在解放済みのものだけをsession responseへ動的投影する。
Discovery Rule、sourceNodeRef、prerequisite、正解Target／Actionは含めず、DISCOVERED／COLLECTED Evidenceだけを返す。

Target名、Action名、Result、Evidence公開本文は未信頼文字列として`textContent`で描画する。

### Author UI

Evidence Import後のGame Progression Plan設定は、JSON textareaではなく既存Contractの入力支援層である
`Game Progression Plan Builder`で行う。Builderは次のAuthor専用参照を選択肢として表示する。

- 8種類のInvestigation Action ID
- Network node / service ID
- Attack Graph node / artifact ID
- Timeline event ID
- Evidence Artifact ID
- 完了Action ID形式

制作ユーザはInitial Court、Investigation Target、Targetで利用可能なAction、Discovery Rule、prerequisite、unlock、
Retrial Court、既存Judgment由来のObjection、Retry PolicyをGUIで明示選択する。Frontendはこの状態から
`game-progression-plan.schema.json`と同じ既存fieldを持つdraftを生成する。`POST /api/author/preview-progression`は
sessionを変更せず、既存`buildGameProgressionPlan`とGame Case Converterを用いてSchema、参照、到達可能性、Judgment整合性を
検証し、`planId`と`fingerprint`を含む完全なPlanを返す。JSONは既定で閉じた開発・研究用Previewにのみ表示し、通常は編集しない。

BuilderはDiscovery Rule未設定のInvestigation Evidence／法廷必須Evidenceと、初期Targetから到達不能なTarget／Evidenceを
入力欄の近くへ表示する。最終判定は既存Backend Validatorが行う。BackendとAuthor UIはEvidence本文からRule、Target、Action、
正解対応を生成または補完しない。

### Independent Evaluation

Phase 10は通常経路を次の順で実操作する。

```text
TITLE → INITIAL_COURT → INVESTIGATION
→ Target → Action → Discovery → Collection
→ RETRIAL_COURT → OBJECTION → ACQUITTED
```

`INVESTIGATION_REACHABILITY`は全Investigation EvidenceとCourt必須Evidenceの発見可能性を再実行で確認する。
`INVESTIGATION_DISCLOSURE`は初期Investigation viewでUNKNOWN Evidenceが非公開であることと、未発見IDの直接Collectionが
拒否されることを確認する。既存のretry、上限、solvability、情報漏えい、UI操作検査も維持する。

## End-to-End Validation

固定の合成成果物を使用し、実LLM APIを呼ばずにAttack SelectionからCandidate、Attack Graph、Scenario、
Verification、Evidence、Game Case、Progression、UI Build、Playthrough、Evaluation、`ACCEPTED`までを通す。
Scenario、Verification、Evidence、Game Case、UI Build、Evaluation、fingerprint、上流変更の各異常系では、
該当gateで後続処理が停止する。AGENTS.mdの自動確認可能なMUST要件は専用Compliance testで検証する。

## MVP Author Workflow

`/author`は既存15工程を次の8つのWizard sceneへまとめる。現在sceneだけを通常表示し、完了済み、現在、未到達を
進捗表示で区別する。未完了sceneは飛ばせず、「戻る」で到達済みの前工程へ移動できる。外部Codexは手動で使用し、
BackendはProvider、Model、API key、自動再生成を持たない。

1. Attack / Network / Scenario Context
2. Scenario Generation
3. Scenario Import
4. Independent Verification
5. Evidence Generation
6. Evidence Import
7. Game Progression Plan Builder
8. Game Case / Game Make / Independent Evaluation / Play

Step 7のBuilderはInitial Court、Investigation、Retrial Court、Objection、Retry Policyの5セクションを持つ。
SpeakerはTestimonyの既存`witnessCharacterId`に対応する表示名であり、技術Evidenceから新しいTestimonyへ変換しない。
Objection候補は既存Contradictionのstatement／conflicting Evidenceと、それを支持する既存Exonerationの組合せだけから導出する。
上流のAttack、Network、Contextを画面上で変更した時点でFrontendは既存PreviewとPlay導線を無効化し、再送信時には
Author Serviceの既存下流無効化処理がScenario以降の成果物を破棄する。

### Author Serviceと候補選択

`server/author-service.js`はAttack Catalogを動的に読み、1～3件の選択とNetwork / Scenario ContextをCandidate Builderへ
渡す。全SATISFIED candidateから構築されたAttack Graphを保持し、各graph用Scenario Generation Inputを表示する。
どのgraphをCodexへ渡したかは制作ユーザが`optionId`で明示し、Backendが恣意的に1件へ絞らない。

Scenario Importが`VALID`でもEvidence工程へは進めない。既存Phase 6 Prompt/Inputを別工程で表示し、
`scenario-verification-review.schema.json`準拠の独立ReviewをImportする。Reviewの
`scenarioGeneratorSelfAssessmentUsed`がtrue、review不在、fingerprint不一致、参照不正の場合は`VERIFIED`にしない。

Evidence Importが`VALID`になった後、利用可能なEvidence、Testimony、Statement、既存Contradiction／Exoneration、
Investigation source／ActionをBuilder候補として表示する。Game Progression Planの配置とObjection ruleは制作ユーザが
候補から明示選択する。Author Serviceは本文を意味解析せず、`maxCourtAttempts`も補完しない。Plan Schemaと既存Game Case Validatorが参照切れ、
別Scenario混入、取得不能・提示不能Evidence、不整合なstatement/evidence対応を拒否する。

### Orchestrator接続

Game Progression Planの`maxCourtAttempts`が入力されたBuild時にOrchestratorを作成し、それまでに検証済みの全成果物を
標準gate順で再投入する。これはCourt retry上限を暗黙補完せず、既存Orchestrator契約も変更しないためである。
最終Play URLはEvaluation gateまで通ってOrchestratorが`ACCEPTED`になった場合だけ発行する。

### Author / Player境界

Author APIは`/api/author/*`、Player APIは`/api/start`と`/api/action`に分離する。Author tokenはPlayer tokenとして、
Player tokenはAuthor tokenとして利用できない。Author ModeでPlayer Gameを開始するには、`ACCEPTED`成果物へ割り当てた
ランダムな`playId`が必要であり、未知IDや未完成制作セッションから開始できない。

Author側はGround Truth、Validation Feedback、Generation Input等を制作目的で扱う。Player側はPublic Game Caseの投影だけを
受け取り、Ground Truth、Judgment、accepted / required Evidence、内部参照、provenance、fingerprint、Verification Resultを
取得できない。Author JSON requestとブラウザfileは2 MiBに制限し、JSON以外、未知API field、prototype pollution keyを拒否する。
すべての外部文字列はデータとして保持し、`textContent`またはtextarea valueで表示する。

### 一時保存

Author sessionはNode.jsメモリに最大100件、最終操作から4時間保持する。Player sessionは最大1000件、最終操作から1時間保持する。
DB保存はなく、サーバー再起動時にScenario、Review、Evidence、Plan、Build、Play URLを含む全一時成果物が失われる。
