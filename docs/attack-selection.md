# 攻撃・舞台の自動設定 v1

## 入力と互換性

通常の制作入力は `scenario-selection.schema.json` の `schemaVersion: "1.0"`、`attackIds`（発生順・重複なし1～3件）、`settingId` のみ。POST `/api/author/selection` の本文は `{ "request": { ... } }`。舞台は `company / government / school / university / hospital`。未知値、内部限定型、4件以上、重複、Network・難易度などの追加フィールドを拒否する。Author tokenと既存の同一生成ロックが必要。attackIdsの順序は保持し、並べ替えて成立させる処理は行わない。

`createSelectionConfiguration` が架空の設定を生成し、既存のConfiguration Schema・到達性・攻撃条件を検証したうえで、隣り合う各攻撃の直接の因果関係も検査する。取得経路・独立Review等の後続ゲートは維持する。旧manual APIは入力を補完しない。通常UIに詳細入力画面はないが、旧MANUAL/MAKOTOMARU APIとそのbootstrapフィールドは互換用に維持する。新UIは `attackChoices / attackSelectionPaths / settings / selectionDefaults / maxSelectedAttacks` を使う。

自動既定値は事件日2026-09-18、順に09:10/09:18/09:26（+09:00）、難易度・evidenceCountは攻撃数。組織名、被告人の役割、被害システム、内部ネットワーク表示名は舞台から生成する。医療機関のモデルは事務用システムだけを対象とし、実患者情報や医療機器は含めない。ネットワークは合成のアドレス、資料は合成データを使い、実接続・実攻撃をしない。

## 登録モデル

| 選択肢 / ID | 限定した成立条件・結果 | 調査で区別すること |
| --- | --- | --- |
| フィッシング / phishing | 保存メールと明示したリンク操作。認証情報入力が必要な組合せだけcredential_phishing | 表示URL、href、実際の要求、送受信は別 |
| Stored XSS / stored_xss | 投稿権限、保存済み内容、後の閲覧、防御条件、ブラウザ実行計測 | 保存・閲覧要求と実行成功は別 |
| 不正ログイン / unauthorized_login | 有効な資格情報、パスワードのみの認証、限定された投稿権限 | アカウント、認証結果、投稿完了、人物は別 |
| ClickFix / clickfix | 偽修復・本人確認案内、利用者の端末操作、一般利用者権限で阻止されない実行 | 案内の表示だけでは端末実行を証明しない |
| SQLインジェクション / sql_injection | SQL構造へ影響する入力、到達性、DB主体の権限、DB監査 | 要求とSQL実行、DB権限とOS権限は別 |
| パスワードスプレー / password_spray | 多数アカウントに少数候補。一つで候補が一致し、対象試行が制限で遮断されない限定例 | 多数の失敗だけで同じ候補・成功・操作者を断定しない |
| ランサムウェア / ransomware | 端末の取得済み実行条件、書込み可能な教材ファイル、暗号化確認と合成要求文 | 起動・改名だけで暗号化完了とせず、影響範囲を広げない |
| 不正ファイルアップロード / unrestricted_file_upload | 機能利用権限、内容検証の不足、限定領域への書込み。非実行領域に保存 | 申告MIME・拡張子と実際の内容、保存と実行は別 |

ランサムウェア単独の実行環境は初期条件として明示する。選択されたClickFixがある場合はその実行効果へ追跡する。横展開、秘密情報取得、バックアップ破壊、MFA突破、Webシェル実行は無断で追加しない。

パスワードスプレーの通常の認証ログに、パスワード・候補ハッシュ・同一候補識別子を生成しない。ログから見える複数アカウントへの試行パターンと、非公開の技術条件を区別する。

## 追加資料の取得経路

| Artifact | service binding / Log Source | 既存の資料種別・操作 |
| --- | --- | --- |
| clickfix_page_record | web / WEB_LOG | DOCUMENT・監査確認 |
| process_execution_record | endpoint / DEVICE | DEVICE_INFORMATION・端末調査 |
| spray_authentication_record | auth / AUTH_LOG | AUTHENTICATION_LOG・認証ログ確認 |
| authentication_policy_record | auth / CONFIGURATION | DOCUMENT・設定確認 |
| file_encryption_record | files / FILE | FILE_METADATA・ファイル調査 |
| upload_receipt_record | web / APPLICATION_LOG | APPLICATION_LOG・監査確認 |
| uploaded_file_record | files / FILE | FILE_METADATA・ファイル調査 |

記録の計測・保持・調査取得を技術入力で明示する。製品固有のイベントIDや既定の記録は仮定しない。条件・取得元がなくなった場合は停止し、後段で補完しない。各対象につき1争点、調査→4択→法廷の既存進行と、後続資料を要求しない検証を維持する。

## 複数攻撃

順序付きで重複のない1～3件（8＋56＋336＝400通り）を検査し、現在のモデルでは17通り（単独8、2件6、直列3件3）が事前チェックを通る。以前の「順不同の全92組合せ中18通り」とは集計条件が異なる。1件目から2件目と3件目へ別々に分岐するだけの組合せは、今回の「直前から続く」という指定を満たさないため通常UIでは候補にしない。実AI生成の完了数を表すものではない。

`buildAttackSelectionPaths` は、登録済み8種類から最大3件まで選択列を延ばし、実際の自動構成・Attack Graphで検証した順序だけを `attackSelectionPaths` としてbootstrapへ返す。公開するのはIDの配列だけで、技術グラフ・正解は含めない。選択列全体で各隣接ノードに `ENABLES` が必要。片方向の関係なので逆順や同じ組織・単なる時系列は許可しない。現状、舞台は表示名・組織・役割だけを変え、技術構成は変えないため同じ候補を使う。

画面は1件目の候補→2件目の候補→3件目の候補と順に表示し、完全な選択済み前段と一致する列だけで候補を絞る。2件目・3件目の「追加しない」で1件・2件にできる。後続候補のない欄は非表示にして、現在の件数で作成できる旨を表示する。前段を変えたら後段は解除し、同じ値の再選択では維持する。旧サーバーなどで選択順データがない場合は初期化を止め、全8種類を後段の候補に補完しない。

送信時は候補リストを信用するだけでなく、技術グラフを再計算する。非連結なら `INVALID_ATTACK_COMBINATION`、因果関係に逆行するなら `ATTACK_DEPENDENCY_ORDER_MISMATCH`、連結していても直前との直接の関係がないなら `INVALID_ATTACK_SEQUENCE` と対象フィールドを返す。無効な選択ではAIを起動せず、既存の制作セッションを上書きしない。旧manual/MAKOTOMARUの完全なConfiguration契約は変更しない。

追加した因果接続は `phishing → clickfix`（同じ要求への到達）、`clickfix → ransomware`（同じ端末の利用者権限での実行）、`password_spray → unauthorized_login`（同じ認証先・アカウントの資格情報）。既存の認証→投稿→Stored XSSの権限関係も維持する。

## 一次資料

技術モデルの根拠であり、架空の個別記録や被告人の行動を証明するものではない。

- [Microsoft: Think before you Click(Fix)](https://www.microsoft.com/en-us/security/blog/2025/08/21/think-before-you-clickfix-analyzing-the-clickfix-social-engineering-technique/)：利用者を端末操作へ誘導する仕組み。
- [MITRE ATT&CK: Password Spraying](https://attack.mitre.org/techniques/T1110/003/)：少数候補を多数アカウントへ試行する性質。
- [MITRE ATT&CK: Data Encrypted for Impact](https://attack.mitre.org/techniques/T1486/)：暗号化による可用性への影響と対象ファイルの権限。
- [OWASP: File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)：申告値・内容検査・保存先・実行条件の区別。
- [OWASP: SQL Injection](https://community.owasp.org/attacks/SQL_Injection)：SQL構造の変更とDB主体の権限による影響範囲。

テストは技術条件をnull/falseへ変えた拒否、記録欠落、入力境界、最大3件、舞台の反映、模擬AIによる全工程とプレイ経路、既存API互換を含む。模擬AIでの合格は実AIの文章品質・意味妥当性の保証ではなく、実生成でも独立Review・評価は省略しない。
