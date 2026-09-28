import { fail } from './schema.js';
import { INCIDENT_DESIGN, INCIDENT_PROFILES } from './incident-design.js';

// The opening is an allegation, never the private attack chain.
const INCIDENTS = Object.freeze({
  sql_injection: 'Webサービスへの要求に関連して、意図しない条件のデータベース処理が実行される事案が発生しました。',
  stored_xss: 'Webサイトの閲覧に関連して、利用者のブラウザで意図しない処理が動く事案が発生しました。',
  reflected_xss: 'Webサイトの閲覧に関連して、利用者のブラウザで意図しない処理が動く事案が発生しました。',
  phishing: '不審な案内メールによって、利用者が外部のページへ誘導される事案が発生しました。',
  credential_phishing: '不審な案内を経由し、認証に使う情報が外部へ送信される事案が発生しました。',
  unauthorized_login: 'サービスのアカウントが無断で利用される事案が発生しました。',
  password_spray: '複数のアカウントに不審な認証試行が行われ、その一部が受け入れられる事案が発生しました。',
  clickfix: '利用者の端末で不審な処理が起動する事案が発生しました。',
  ransomware: '端末内のファイルが使用できなくなり、金銭を要求する文面が残される事案が発生しました。',
  unrestricted_file_upload: 'サービスで許可されていない内容のファイルが保存される事案が発生しました。',
});
export function buildIncidentOverview(configuration) {
  const context = configuration.incidentContext;
  const events = [...new Set(configuration.attacks.map(attack =>
    (configuration.incidentDesign === INCIDENT_DESIGN && INCIDENT_PROFILES[attack.attackId]?.impact)
      || INCIDENTS[attack.attackId]).filter(Boolean))];
  return `${context.incidentDate}、${context.organizationName}の${context.victimSystem}で、セキュリティ上の事件が発生しました。`
    + events.join('');
}

// The report describes the procedural allegation, not raw log values or a new
// account/person mapping. Detailed testimony remains in its separately labelled UI.
const submittedMaterials = Object.freeze({
  EMAIL: '事件に関係する案内メールが保存され、調査資料として提出されています',
  WEB_ACCESS_LOG: '対象システムへの要求を記録したアクセス資料が提出されています',
  AUTHENTICATION_LOG: 'サービスへの認証試行を記録した監査資料が提出されています',
  APPLICATION_LOG: 'アプリケーションで扱われた処理を調べるため、監査資料が提出されています',
  DATABASE_LOG: 'データベースで扱われたSQLを調べるため、監査資料が提出されています',
  DEVICE_INFORMATION: '端末上の処理を調べるため、取得された計測資料が提出されています',
  FILE_METADATA: '保存ファイルの状態を調べるため、検査資料が提出されています',
  DOCUMENT: '事件に関係する文面・設定を確認するため、保存資料が提出されています',
  NETWORK_LOG: '通信の状況を調べるため、取得された通信資料が提出されています',
});

export function buildProsecutionOpening(openingEvidence, openingStatements = [], configuration = null) {
  const item = openingEvidence[0];
  if (!item || item.type === 'TESTIMONY') fail('INCIDENT_REPORT_EVIDENCE_REQUIRED',
    'initialCourtEvidenceIds', '疑いの根拠として、冒頭で提示できる技術資料が必要です。');
  const hasTestimony = openingStatements.some(statement => statement.spokenContent);
  const descriptions = [...new Set(openingEvidence.filter(item => item.type !== 'TESTIMONY')
    .map(item => submittedMaterials[item.type] ?? '事件の調査資料が提出されています'))];
  const allegation = configuration?.incidentContext?.initialSuspicionReason;
  return (allegation ? `検察側の嫌疑：${allegation}\n\n` :
    '検察側は、提出資料に記録された操作を被告人によるものとし、事件への関与を主張する。\n\n')
    + `提出資料：${descriptions.join('。')}。`
    + (hasTestimony ? '\n\n根拠となる供述は、関係者の供述欄に記載する。' : '');
}
