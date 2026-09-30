# 全16攻撃の技術証拠監査

## 結論

登録済みの全16攻撃について、事件Narrativeが要求する全ての `requiredArtifactIds` が通常の調査段階に割り当てられていることを確認した。プレイヤー向けの取得経路に `CASE_FACT`、`IDENTITY_PROOF`、`caseSupport`、第三者の直接観察を記した調査報告は含まれない。

無罪論証は「第三者が実行したことの証明」ではない。技術資料が攻撃の処理経路・対象・結果を示しても、アカウント名、IPアドレス、端末情報だけでは実際の操作者を特定できない。検察側が主張する被告人による準備・作成・直接操作が立証されず、第三者による操作、認証情報の悪用、誘導又は自動処理の可能性を排除できない場合に、合理的な疑いが残ると結論付ける。

## Git履歴の確認

- `3f2d782`（2026-09-22）: 主要攻撃と証拠生成経路を追加。
- `de24b72`（2026-09-24）: 攻撃種別とネットワーク構成を拡張。
- `31c887f`（2026-09-25）: 探索・証拠取得手順を追加。
- `209ffb5`（2026-09-27）: SQL Injectionの学習内容を拡張。
- `0246e02`（2026-09-28）: XSSと事件Narrativeを拡張。
- `ca41845`（2026-09-30）: Ransomwareの必要証拠を拡張。
- `fb821ed`（2026-09-30）: 全16攻撃の事件Narrativeと相関要件を拡張。
- `30b5653`（2026-10-01）: 全16攻撃へ人物帰属用の観察設定を追加した一方、実行経路ではその報告を禁止する変更も含み、Narrativeの要求と取得可能な証拠が矛盾した。

今回の修正では、`30b5653`で追加された人物帰属用の観察設定と未使用の報告生成コードを撤去し、技術資料だけで評価できる合理的疑いへ論証要件を統一した。

## 攻撃別の必要資料

| 攻撃 | 通常調査で取得する必須資料 | 段階数 |
| --- | --- | ---: |
| ClickFix | `clickfix_page_record`, `process_execution_record` | 2 |
| Credential Phishing | `email_record`, `web_access_record`, `credential_submission_record` | 2 |
| Password Spray | `spray_authentication_record`, `authentication_policy_record` | 2 |
| Path Traversal | `traversal_access_record`, `traversal_read_record` | 1 |
| Phishing | `email_record`, `web_access_record` | 2 |
| Protected File Collection | `collection_read_record`, `collection_output_record` | 2 |
| Ransomware | `file_operation_record`, `process_execution_record`, `damaged_file_record`, `original_file_record`, `ransom_note_record` | 2 |
| Reflected XSS | `web_access_record`, `browser_execution_record` | 2 |
| Setuid Misconfiguration | `setuid_metadata_record`, `setuid_execution_record` | 2 |
| SQL Injection | `web_access_record`, `database_statement_record`, `application_response_record` | 2 |
| Stored XSS | `stored_content_record`, `web_access_record`, `browser_execution_record`, `announcement_audit_record`, `browser_request_initiator_record` | 2 |
| Sudo Misconfiguration | `sudo_policy_record`, `sudo_execution_record` | 2 |
| Unauthorized Login | `authentication_record`, `application_session_record` | 2 |
| Unrestricted File Upload | `upload_receipt_record`, `uploaded_file_record` | 2 |
| Valid Account SSH | `ssh_authentication_record`, `ssh_session_record` | 2 |
| Windows Service Permissions | `service_acl_record`, `service_execution_record` | 2 |

## 自動検証条件

各攻撃を単独選択した構成について、次を回帰テストで確認する。

1. 攻撃の前提条件と結果が成立する。
2. `requiredArtifactIds` の全件が観測可能である。
3. 必須資料の全件に通常調査の取得経路がある。
4. 各取得経路が現在又は過去の段階で取得可能で、未来の段階を前提にしない。
5. Scenario、Evidence、Game Caseのプレイヤー向け契約に人物帰属用の内部資料がない。
6. 法廷の結論が第三者実行の断定ではなく、被告人の直接操作説が立証されず他の可能性を排除できないという合理的疑いになっている。
7. 必要資料が欠ける場合は、架空の報告や相関値で補わず生成を停止又は差し戻す。
