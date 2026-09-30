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

export function incidentProfile(definitions, attackId) {
  return definitions.find(item => item.id === attackId)?.incidentNarrative ?? null;
}

export function buildIncidentNarratives(configuration, graph, definitions) {
  if (configuration.incidentDesign !== INCIDENT_DESIGN) return [];
  return graph.nodes.flatMap(node => {
    const profile = incidentProfile(definitions, node.attackDefinitionId);
    if (!profile) fail('INCIDENT_NARRATIVE_MISSING', 'incidentDesign',
      `攻撃${node.attackDefinitionId}について、真犯人の行為・検察側の誤認・因果反証・無罪理由が定義されていません。`);
    const effect = node.effects.find(item => item.predicate === profile.impactEffectPredicate);
    if (!effect || node.state !== 'SATISFIED') fail('INCIDENT_IMPACT_UNVERIFIED', 'incidentDesign', '被害の成立条件が確認できません。');
    const available = node.artifactEvaluations.filter(item => item.state === 'SATISFIED').map(item => item.artifactId);
    if (profile.requiredArtifactIds.some(id => !available.includes(id))) fail('INCIDENT_EVIDENCE_UNAVAILABLE', 'incidentDesign', '被害と発生原因を論証する取得資料が不足しています。');
    return [{ schemaVersion: '1.0', attackNodeId: node.nodeId, impactEffectId: effect.effectId,
      attackerCharacterId: 'character_attacker', defendantCharacterId: 'character_defendant',
      attackerAction: profile.attackerAction, impact: profile.impact, allegation: profile.allegation,
      prosecutionKnowledge: profile.prosecutionKnowledge, causalRefutation: profile.causalRefutation,
      verdictBasis: profile.verdictBasis, requiredArtifactIds: [...profile.requiredArtifactIds] }];
  });
}

// Court-question prose is model-authored, but an incident with a verified causal
// narrative must not regress to a mere "the operator is unknown" acquittal.
export function groundIncidentQuestionExplanations(questions, incidentNarratives = [], finalStatementId = null) {
  const result = structuredClone(questions);
  if (!incidentNarratives.length || !result.length) return result;
  const conclusion = incidentNarratives.map(item =>
    `事件で確認されたこと：${item.attackerAction}\n検察側の把握と主張：${item.prosecutionKnowledge}\n資料を照合して分かること：${item.causalRefutation}\n弁護側の結論：${item.verdictBasis}`).join('\n\n');
  const final = result.find(item => item.statementId === finalStatementId) ?? result.at(-1);
  // This is the post-clear explanation, so prefer the verified incident finding
  // over model prose that may fall back to a generic lack-of-attribution ending.
  final.explanation = conclusion;
  return result;
}
