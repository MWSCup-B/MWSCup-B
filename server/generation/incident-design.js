import { fail } from './schema.js';

// Opt-in automatic authoring defaults. Legacy configurations retain their original
// attack scope. Preconditions are evaluated in the same graph as every other fact.
export const INCIDENT_DESIGN = 'ATTACK_CAUSED_HARM_V1';
const condition = (source, predicate, args, description) => ({ source, predicate, args, value: true, description });
const artifact = (id, binding, logSource, type, predicate, args, description) => ({ id, description,
  acquisition: { binding, logSource, type, targetType: logSource === 'DEVICE' ? 'ENDPOINT' : 'LOG_SOURCE' },
  conditions: [condition('loggingConfiguration', predicate, args,
    '事件前から対象操作の記録が有効で、相関識別子と記録内容が保全され、調査で取得できる。標準ログに存在しない項目を後から補わない。')] });

export function incidentDefinitions(catalog, configuration) {
  if (configuration.incidentDesign !== INCIDENT_DESIGN) return catalog;
  return catalog.map(original => {
    const definition = structuredClone(original);
    if (definition.id === 'stored_xss') {
      definition.prerequisites.find(item => item.predicate === 'user_uses_browser').description =
        '閲覧者がこのブラウザを利用する教材条件。被告人と閲覧者の対応は事件の架空設定で先に定義し、IPやアカウントから推定した事実としては扱わない。';
      definition.description += ' この教材では、保存スクリプトが閲覧者のセッションで同一オリジンの掲示板へ虚偽の告知を投稿する被害を扱う。';
      definition.prerequisites.push(
        condition('authenticationConditions', 'viewer_can_post_announcement', ['$victim', '$web'],
          '閲覧者のセッションには同一Webサービスの掲示板投稿権限がある。OS権限や管理者権限は不要。'),
        condition('otherConditions', 'stored_script_submits_false_announcement', ['$request', '$browser', '$web'],
          '保存されたスクリプトの内容は同一オリジンへの告知投稿を行い、投稿処理が受理される。Cookie値を盗まず、閲覧者の認証済みセッションによる要求として扱われる。'));
      definition.effects.push(condition('otherConditions', 'false_announcement_posted_by_script',
        ['$attacker', '$victim', '$browser', '$web', '$request'],
        '別の攻撃主体が保存したスクリプトにより、閲覧者のセッションで虚偽の告知が掲載される。閲覧者の手動投稿とは異なる。'));
      definition.observableArtifacts.push(
        artifact('announcement_audit_record', 'web', 'APPLICATION_LOG', 'APPLICATION_LOG',
          'announcement_audit_available', ['$web', '$request'],
          '告知投稿APIの監査記録。要求ID、セッション識別子、告知ID、処理結果を記録し、閲覧要求と投稿要求は別IDで保持する。'),
        artifact('browser_request_initiator_record', 'browser', 'DEVICE', 'DEVICE_INFORMATION',
          'browser_request_initiator_record_available', ['$browser', '$web', '$request'],
          'ブラウザで事前に収集した通信の開始元記録。閲覧要求ID(view_request_id)、実行ID(execution_id)、スクリプトの出典となる保存投稿ID(source_post_id)、ソース位置、発行した投稿要求ID(request_id)、開始元の種類を記録する。対応する実行記録にも閲覧要求ID(request_id)、実行ID、投稿IDを保持する。アクセス履歴やCSP違反ログによる代用は不可。'));
    } else if (definition.id === 'sql_injection') {
      definition.observableArtifacts.find(item => item.id === 'database_statement_record').description +=
        ' request_idとquery_idを保持し、statement欄の実行SQLから条件式・演算子・引用符の範囲を読み、値の範囲だけでなく構造の改変を確認できる。';
      definition.description += ' この教材では、アプリが参照できる非公開レコードの取得と要求元への返却を被害として扱う。';
      definition.prerequisites.push(
        condition('otherConditions', 'restricted_rows_readable_by_application', ['$database', '$db_principal', '$request'],
          'アプリのDB接続主体には対象の非公開レコードを読む権限があり、改変されたSQLはそのレコードを取得する。管理者権限・OS実行は付与しない。'),
        condition('otherConditions', 'query_result_returned_to_requester', ['$web', '$database', '$request'],
          '対象のDB結果が当該HTTP要求への応答に含まれ、要求元へ返却される。取得だけから外部流出を推定するモデルではない。'));
      definition.effects.push(condition('otherConditions', 'restricted_rows_disclosed',
        ['$attacker', '$web', '$database', '$db_principal', '$request'],
        '外部から投入されたSQL改変入力により、非公開レコードがWeb応答を通じて要求元へ返却される。'));
      definition.observableArtifacts.push(artifact('application_response_record', 'web', 'APPLICATION_LOG', 'APPLICATION_LOG',
        'query_response_audit_available', ['$web', '$database', '$request'],
        'アプリの応答監査。HTTP要求IDとDBクエリIDの対応、返却レコードの合成識別子またはダイジェスト、応答状態を保全する。秘密値や実在情報は記録しない。通常のWebアクセスログとは別の取得資料。'));
    }
    return definition;
  });
}

export const INCIDENT_PROFILES = {
  stored_xss: {
    effect: 'false_announcement_posted_by_script',
    requiredArtifacts: ['stored_content_record', 'web_access_record', 'browser_execution_record', 'announcement_audit_record', 'browser_request_initiator_record'],
    impact: '掲示板に虚偽の告知が掲載され、業務連絡の内容が改ざんされた。',
    allegation: '虚偽の告知の投稿が被告人の利用セッションに記録されたことを根拠に、検察側は被告人が告知を作成して投稿したと主張している。',
    refutation: '保存投稿の作成、被告人による後の閲覧、当該スクリプトからの投稿要求、サーバーの受理を識別子と開始元情報でつなぐ。虚偽告知は別の攻撃者が先に保存したスクリプトによる自動投稿であり、被告人はその投稿を閲覧して巻き込まれた利用者である。',
  },
  sql_injection: {
    effect: 'restricted_rows_disclosed',
    requiredArtifacts: ['web_access_record', 'database_statement_record', 'application_response_record'],
    impact: 'Webサービスを通じ、非公開レコードが本来許可されていない要求元へ返却された。',
    allegation: '漏えい時のSQLが、被告人も利用していた検索サービスのDB接続用アカウントで実行されたことを根拠に、検察側は被告人がそのSQLを直接入力したと主張している。',
    refutation: 'HTTP要求とSQL実行、結果返却の識別子を照合し、DB監査のstatement欄の条件式・演算子・引用符からSQL構造の改変を読む。漏えいを起こしたのは別の攻撃主体の入力を命令へ組み込んだアプリの処理であり、共有DB接続主体の記録を被告人自身の直接SQL操作と取り違えている。被告人のサービス利用は架空の背景であり、被告人の通常検索との比較や人物同定を必須の推論にしない。投稿閲覧を発火条件にしない。',
  },
};

export function buildIncidentNarratives(configuration, graph) {
  if (configuration.incidentDesign !== INCIDENT_DESIGN) return [];
  return graph.nodes.flatMap(node => {
    const profile = INCIDENT_PROFILES[node.attackDefinitionId];
    if (!profile) return [];
    const effect = node.effects.find(item => item.predicate === profile.effect);
    if (!effect || node.state !== 'SATISFIED') fail('INCIDENT_IMPACT_UNVERIFIED', 'incidentDesign', '被害の成立条件が確認できません。');
    const available = node.artifactEvaluations.filter(item => item.state === 'SATISFIED').map(item => item.artifactId);
    if (profile.requiredArtifacts.some(id => !available.includes(id))) fail('INCIDENT_EVIDENCE_UNAVAILABLE', 'incidentDesign', '被害と発生原因を論証する取得資料が不足しています。');
    return [{ schemaVersion: '1.0', attackNodeId: node.nodeId, impactEffectId: effect.effectId,
      attackerCharacterId: 'character_attacker', defendantCharacterId: 'character_defendant',
      impact: profile.impact, allegation: profile.allegation, causalRefutation: profile.refutation,
      requiredArtifactIds: [...profile.requiredArtifacts] }];
  });
}
