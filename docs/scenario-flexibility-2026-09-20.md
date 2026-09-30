# シナリオ柔軟性の調査・修正記録（2026-09-20）

## 要求と対象

「さまざまなシナリオを作れない原因を特定して修正する」という要求への対応。
調査開始時点にあった前回の未コミット変更（Network preset、日時入力修正等）を基準に調査した。
今回置換したJavaScriptとテストの旧コードは、その場所に行コメントで保存している。
プロンプトとREADMEの旧記述はHTMLコメントで保存した。修正前後には日付と目的を記載した。

## 確認した原因と修正

| 原因 | 修正前の挙動 | 修正後 |
| --- | --- | --- |
| 初回のScenario Agentが呼ばれていない | `#createScenarioTemplate`の固定文をそのままReviewへ渡し、AIによるScenario設計はReview不合格時だけ実行 | MANUAL・真実丸とも初回から`GENERATING_SCENARIO`を実行。全Configurationを渡して人物名と学習目標・証拠要件の説明を具体化 |
| 真実丸への入力と出力制約が標準構成だけ | 画面側に追加したDMZ・支店Proxy構成を真実丸が利用できない | 全Network presetと各構成の攻撃割当て例、Authoring定義、Entity型を入力へ追加。出力のID制約にも全登録構成を反映 |
| NodeのRoleだけで先に一意性を要求 | 到達できない無関係なDBを1台追加しただけでも`AMBIGUOUS_BINDING` | 選択済みSource・Target・主調査取得元を固定し、全Role・Platform・Service所属・到達性を同時に絞り込む。全制約を満たす候補が複数の場合だけ曖昧として停止 |
| 全攻撃でRequest IDを共有 | 独立した攻撃のリクエストまで同一のものとして扱う | 攻撃ごとにRequestを分離。前段の効果と後段の前提がsource・predicate・value・対象において一致するときだけ共有 |
| Graphの技術失敗を一律の組合せエラーへ変換 | 不足条件が分からず構成を修正しにくい | Graphの個別エラーを保持。利用者の攻撃順に一致する実行計画を確認 |
| 主調査の説明が先頭攻撃に偏っていた | 共通の調査要件は最初の攻撃だけを説明 | 全攻撃の調査目的を列挙。長い答えは既存の個別取得要件に全文を保持し、共通要件の文字数超過を防止 |

主要実装は`server/generation/authoring-bindings.js`、`scenario-configuration.js`、
`scenario-template.js`、`server/auto-generation-service.js`。

## 自由度を広げる範囲と検証

初回設計とRevisionでAIが変更できるのは、人物の`displayName`、学習目標の`description`、
証拠要件の`description`。構成、ID、Ground Truth、Timeline、人物の役割、証拠参照、
件数、取得要件の参照構造が変わった出力は`SCENARIO_DESIGN_BOUNDARY_CHANGED`で拒否する。
説明文の技術的妥当性は、従来の独立semantic reviewで確認する。

ScenarioのSchema検証、Evidence coverage、独立Review、Preview承認、Evidence検証、
最終Evaluationを維持した。Scenario設計と修正は初回を含め最大3回。
技術構造を書き換え続ける場合に、Review・Evidence生成へ進まず停止するテストを追加した。
初回のAI呼出しが1回増えるため、生成時間と利用量は増える。

## 再現と確認結果

修正前に`tests/scenario-flexibility.test.js`の最初の3つの再現ケースを実行し、以下を確認した。

1. 接続されていない2台目のDBを追加すると、成立するSQL injectionも拒否された。
2. 真実丸の入力に`networkPresets`がなかった。
3. 初回に`GENERATING_SCENARIO`が呼ばれなかった。

修正後は3件とも成功。さらに次を確認した。

- 社内標準・DMZ・支店Proxyの3構成 × 単独攻撃3種とフィッシング→XSS連鎖の計12パターンで、Scenario設計→独立Review→Preview承認→Evidence→READY→Evaluation ACCEPTED。
- 全制約を満たす複数候補は拒否。無関係な同RoleのNodeがあっても一意に解ける構成は受理。
- 到達不能、Platform不一致、必須Role不足、逆順の攻撃連鎖は拒否。
- Requestの分離と、根拠のある連鎖でのみ共有すること。
- 1000文字の調査目的を持つ複数攻撃でも、証拠要件の2000文字制約内に全文を保持。
- 技術構造の改変は拒否し、上限3回で停止すること。

全体実行: `node --test --test-reporter=tap` — **352件中350件成功、既存の2件失敗**。

- `tests/generation.test.js`: Windowsでシンボリックリンク作成が`EPERM`になる環境制約。
- `tests/scenario-creation-workflow.test.js`: coverageエラーの期待件数4と実際3の既存差異。

いずれも前回作業時から確認されている失敗。今回追加した20件のテストは成功。
AI応答は`MockCodexRunner`を使用しており、実Codexによる文章の品質や実生成の成功率はこの結果だけでは保証しない。

## 維持した制約・今回の範囲外

- 対応攻撃は登録済みのフィッシング・反射型XSS・SQLインジェクションの3種類。新しい攻撃自体は追加していない。
- 複数攻撃はREADMEの既存仕様どおり単一の因果関係を持つAttack Graphに限る。無関係な攻撃3種の並置は受理しない。
- 真実丸は登録Network presetを選択する。任意のNode IDを持つ独自構成は詳細設定から入力する。
- 調査Artifactの取得方式は既存のメール・Web記録・ブラウザのスクリプト実行記録・DB監査記録。未対応の攻撃をカタログへ追加するだけで、任意の証拠種別や取得方式まで自動対応するものではない。
- 端末・IP・アカウントだけで操作人物を断定せず、未設定のアリバイや真犯人を創作しない。
- Networkの到達性表現は既存方式を使用している。ポート別ACLなどの新しい入力契約は追加していない。
