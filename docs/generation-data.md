# Phase 2：生成前検証のデータ形式

この文書はAGENTS.mdと、利用者が追加した外部攻撃定義・構成と条件の分離・3状態評価の要件を実装に対応付けたものです。
今回のBackend部品は、対象を割り当てた攻撃候補の成立条件を検証します。
事件・真相・証拠・ゲームの生成や、独立したVerificationゲートの合格判定は行いません。

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

これらのデータと検証結果はBackend内部用であり、Phase 1の公開API・画面には接続しません。
Ground Truthは引き続きBackendのみで保持します。

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

これは将来のScenario工程が提案する対象割当ての検証用データです。
ユーザーの生成画面に対象割当て入力を追加する仕様ではありません。
対象の自動探索と、一つの事件として意味のある関係を構築する処理は未実装です。
複数攻撃が同じネットワークで成立しても、それだけで一つの事件シナリオが完成したとは判断しません。

結果は`schemaVersion`、`state`、`blocked`、`scope`、`plans`、`attempts`、`issues`を持ちます。
入力不正または全選択攻撃を成立させられない場合、`blocked: true`と対象フィールド・理由・修正候補を返します。
Orchestratorの工程状態は変更しません。将来のOrchestratorがこの結果を受けてBLOCKED等への遷移を管理します。

正常な構造の入力には、入力と定義全体のSHA-256識別値`inputDigest`を付けます。
これはJSONシリアライズ結果の識別値であり、オブジェクトのキー順でも変わり得ます。
検証結果は毎回再計算し、古い結果をキャッシュしません。
下流工程の無効化・再実行は、今後のOrchestrator実装時に組み込む必要があります。

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
