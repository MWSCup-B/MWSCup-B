import { fail } from './schema.js';

// Opt-in automatic authoring defaults. Legacy configurations retain their original
// attack scope. Preconditions are evaluated in the same graph as every other fact.
export const INCIDENT_DESIGN = 'ATTACK_CAUSED_HARM_V1';
const technicalCausalRefutation = '選択された攻撃について取得可能と定義された技術資料を段階ごとに照合する。各資料が記録する対象・内容・処理結果を原文の識別値で対応付け、資料にない因果関係を時刻の近さだけで補わない。アカウント名・IPアドレス・端末情報だけから人物や意図を特定せず、確認された攻撃経路が被告人による攻撃処理の作成・直接操作という検察側の主張と両立するかを論じる。必要な技術資料や対応関係が不足する場合は、その不足を明示して差し戻す。';
const technicalVerdictBasis = '取得可能な技術資料は、事件で生じた処理経路・対象・結果を示す一方、アカウント名・IPアドレス・端末情報を実際の操作者本人の署名として扱うことはできない。検察側が主張する被告人による攻撃処理の準備・作成・直接操作が資料から確認できず、第三者による操作、認証情報の悪用、誘導または自動処理の可能性を排除できない場合、その合理的な疑いを無罪判決の根拠とする。第三者が実行したと断定したり、その実名を技術資料だけから特定したりしない。';
const condition = (source, predicate, args, description) => ({ source, predicate, args, value: true, description });
const artifact = (id, binding, logSource, type, predicate, args, description) => ({ id, description,
  acquisition: { binding, logSource, type, targetType: logSource === 'DEVICE' ? 'ENDPOINT' : 'LOG_SOURCE' },
  conditions: [condition('loggingConfiguration', predicate, args,
    '事件前から対象操作の記録が有効で、相関識別子と記録内容が保全され、調査で取得できる。標準ログに存在しない項目を後から補わない。')] });

export function incidentDefinitions(catalog, configuration) {
  if (configuration.incidentDesign !== INCIDENT_DESIGN) return catalog;
  return catalog.map(original => {
    const definition = structuredClone(original);
    if (definition.incidentNarrative) {
      definition.incidentNarrative.causalRefutation = technicalCausalRefutation;
      definition.incidentNarrative.verdictBasis = technicalVerdictBasis;
    }
    if (definition.id === 'stored_xss') {
      definition.prerequisites.find(item => item.predicate === 'user_uses_browser').description =
        '閲覧者がこのブラウザを利用する教材条件。被告人と閲覧者の対応は事件の教材内設定で先に定義し、IPやアカウントから推定した事実としては扱わない。';
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
          '告知投稿APIの監査記録。timestamp、要求ID(request_id)、セッション識別子(session_id)、告知ID(post_id)、処理結果(result)を記録し、閲覧要求と投稿要求は別IDで保持する。'),
        artifact('browser_request_initiator_record', 'browser', 'DEVICE', 'DEVICE_INFORMATION',
          'browser_request_initiator_record_available', ['$browser', '$web', '$request'],
          'ブラウザで事前に収集した通信の開始元記録。timestamp、閲覧要求ID(view_request_id)、実行ID(execution_id)、スクリプトの出典となる保存投稿ID(source_post_id)、ソース位置(source_location)、発行した投稿要求ID(request_id)、開始元の種類(initiator_type)を記録する。対応する実行記録にもtimestamp、閲覧要求ID(request_id)、実行ID、投稿IDを保持する。アクセス履歴やCSP違反ログによる代用は不可。'));
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
        'アプリの応答監査。timestamp、HTTP要求ID(request_id)とDBクエリID(query_id)の対応、返却レコードの合成識別子(record_refs)またはダイジェスト(result_digest)、応答状態(status)を保全する。秘密値や実在情報は記録しない。通常のWebアクセスログとは別の取得資料。'));
    }
    return definition;
  });
}

export function incidentProfile(definitions, attackId) {
  return definitions.find(item => item.id === attackId)?.incidentNarrative ?? null;
}

export function buildIncidentNarratives(configuration, graph, definitions) {
  if (configuration.incidentDesign !== INCIDENT_DESIGN) return [];
  return graph.nodes.flatMap(node => {
    const profile = incidentProfile(definitions, node.attackDefinitionId);
    if (!profile) fail('INCIDENT_NARRATIVE_MISSING', 'incidentDesign',
      `攻撃${node.attackDefinitionId}について、事件の成立経路・検察側の誤認・因果反証・無罪理由が定義されていません。`);
    const effect = node.effects.find(item => item.predicate === profile.impactEffectPredicate);
    if (!effect || node.state !== 'SATISFIED') fail('INCIDENT_IMPACT_UNVERIFIED', 'incidentDesign', '被害の成立条件が確認できません。');
    const available = node.artifactEvaluations.filter(item => item.state === 'SATISFIED').map(item => item.artifactId);
    if (profile.requiredArtifactIds.some(id => !available.includes(id))) fail('INCIDENT_EVIDENCE_UNAVAILABLE', 'incidentDesign', '被害と発生原因を論証する取得資料が不足しています。');
    return [{ schemaVersion: '1.0', attackNodeId: node.nodeId, impactEffectId: effect.effectId,
      attackerCharacterId: 'character_attacker', defendantCharacterId: 'character_defendant',
      attackerAction: profile.attackerAction, impact: profile.impact, allegation: profile.allegation,
      prosecutionKnowledge: profile.prosecutionKnowledge, causalRefutation: technicalCausalRefutation,
      verdictBasis: profile.verdictBasis, requiredArtifactIds: [...profile.requiredArtifactIds] }];
  });
}

// Keep the explanation that passed evidence review. Private incident settings
// must never replace a reviewed inference or become newly asserted evidence.
// Retain the arguments for callers of the existing interface.
export function groundIncidentQuestionExplanations(questions, incidentNarratives = [], finalStatementId = null) {
  return structuredClone(questions);
}
