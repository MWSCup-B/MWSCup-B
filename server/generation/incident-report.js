import { fail } from './schema.js';

// 公開する被害の流れ。検証済みの因果だけを説明し、人物・内部ID・解答は載せない。
const incidentDescriptions = Object.freeze({
  phishing: '案内メールを使い、利用者を不審なWebページへ誘導する事案が発生しました。',
  credential_phishing: '偽の入力フォームへ誘導し、認証情報を取得するフィッシングが発生しました。',
  unauthorized_login: '取得済みの認証情報を悪用した不正ログインが発生しました。',
  stored_xss: '保存された投稿の閲覧時に、ブラウザで意図しないスクリプトが動く事案が発生しました。',
  reflected_xss: 'Webページの応答に含まれたスクリプトが、ブラウザで意図せず動く事案が発生しました。',
  sql_injection: 'Webへの入力がSQL処理に影響する、SQLインジェクションが発生しました。',
  clickfix: '修復や本人確認を装う案内により、利用者が端末上で不審な処理を実行してしまうClickFixが発生しました。',
  password_spray: '多数のアカウントに少数のパスワード候補を試す、パスワードスプレーが発生しました。',
  ransomware: 'ランサムウェアにより端末内のファイルが暗号化され、復元と引換えの金銭を求める文面が残されました。',
  unrestricted_file_upload: 'アップロード機能で、本来許可していない形式・内容のファイルが保存される事案が発生しました。',
});

const connections = Object.freeze({
  'phishing:clickfix': 'メールのリンク先では、修復や本人確認を装う案内が表示されました。その案内に従った端末操作により、不審な処理が実行されました（ClickFix）。',
  'clickfix:ransomware': 'この端末での実行を足がかりに、ランサムウェアが書き込み可能なファイルを暗号化し、復元と引換えの金銭を求める文面を残しました。',
  'credential_phishing:unauthorized_login': '偽フォームで取得された認証情報が正規サービスで悪用され、不正ログインにつながりました。',
  'password_spray:unauthorized_login': '試行によって有効と分かった認証情報が悪用され、対象アカウントへの不正ログインにつながりました。',
  'unauthorized_login:stored_xss': '不正ログインで得た投稿権限が悪用され、不正な内容が保存されました。保存された投稿の閲覧時に、ブラウザで意図しないスクリプトが動きました（Stored XSS）。',
  'phishing:stored_xss': 'メールのリンクが、あらかじめ不正な内容を保存されたページの閲覧へとつながりました。保存された投稿の閲覧時に、ブラウザで意図しないスクリプトが動きました（Stored XSS）。',
  'credential_phishing:stored_xss': 'メールから誘導されたページでは、保存された投稿の閲覧時に、ブラウザで意図しないスクリプトが動きました（Stored XSS）。',
  'phishing:reflected_xss': 'メールから誘導されたページの応答にスクリプトが入り込み、閲覧したブラウザで意図せず動きました。',
});

export function buildIncidentOverview(configuration, generationInput = null) {
  const context = configuration.incidentContext;
  const graph = generationInput?.technicalInput?.attackGraph;
  const attacks = [...configuration.attacks].sort((a, b) => a.order - b.order);
  const descriptions = attacks.map((attack, index) => {
    if (!incidentDescriptions[attack.attackId]) fail('UNREGISTERED_ATTACK', 'attacks.attackId',
      '事件概要を作成できない攻撃種別です。');
    const node = graph?.nodes.find(item => item.attackDefinitionId === attack.attackId);
    const predecessors = attacks.slice(0, index).filter(previous => graph?.edges.some(edge =>
      edge.type === 'ENABLES' && edge.to === node?.nodeId
      && edge.from === graph.nodes.find(item => item.attackDefinitionId === previous.attackId)?.nodeId));
    // Older authored graphs may branch. Do not turn display order into causality.
    if (attack.attackId === 'stored_xss' && predecessors.some(item => item.attackId === 'unauthorized_login')
      && predecessors.some(item => ['phishing', 'credential_phishing'].includes(item.attackId))) {
      return '不正ログインで得た投稿権限が悪用され、不正な内容が保存されました。メールからの誘導がそのページの閲覧につながり、保存された投稿の閲覧時にブラウザで意図しないスクリプトが動きました（Stored XSS）。';
    }
    const linked = predecessors.map(previous => connections[`${previous.attackId}:${attack.attackId}`]).find(Boolean);
    return linked ?? `${index ? '続いて、' : ''}${incidentDescriptions[attack.attackId]}`;
  });
  return `${context.incidentDate}、${context.organizationName}の${context.victimSystem}で事件が発生しました。`
    + descriptions.join('')
    + '\nどの記録が何を示すのか、そして被告人が関与したと言えるのか。これから資料を調べて確かめます。';
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

export function buildProsecutionOpening(openingEvidence, openingStatements = []) {
  const item = openingEvidence[0];
  if (!item || item.type === 'TESTIMONY') fail('INCIDENT_REPORT_EVIDENCE_REQUIRED',
    'initialCourtEvidenceIds', '疑いの根拠として、冒頭で提示できる技術資料が必要です。');
  const hasTestimony = openingStatements.some(statement => statement.spokenContent);
  return `【確認事項】${submittedMaterials[item.type] ?? '事件の調査資料が提出されています'}。\n\n`
    + (hasTestimony
      ? '【証言】調査担当者は、提出資料について自らの解釈を述べています。発言内容は下の供述欄に記載しています。\n\n'
      : '【証言】この段階で、報告書に対応する供述は提示されていません。\n\n')
    + '【検察側の主張と疑いの経緯】検察側は、資料に残る操作を事件の痕跡と捉え、'
    + (hasTestimony ? 'その読み取りに関する供述を踏まえて、' : '')
    + '被告人が関与したと主張しています。こうした記録の解釈が疑いの根拠ですが、記録上の操作と被告人本人を結ぶ具体的な裏付けは、提示資料からは確認できません。';
}
