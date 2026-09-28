import { fail } from './schema.js';

// Minimum observable fields from data/attacks/*.json, not vendor log assumptions.
// Aliases permit existing product-neutral names; values are never filled here.
export const LEARNING_OBSERVATION_FIELDS = Object.freeze({
  announcement_audit_record: [['timestamp', 'time'], ['request_id'], ['session_id'], ['post_id'], ['result']],
  browser_request_initiator_record: [['timestamp', 'time'], ['request_id'], ['view_request_id'], ['execution_id'], ['source_post_id'], ['initiator_type'], ['source_location']],
  application_response_record: [['timestamp', 'time'], ['request_id'], ['query_id'], ['record_refs', 'result_digest'], ['status']],
  // 2026-09-24: mainの取得定義を、kawata-workの観測資料検証にも登録する。
  ssh_authentication_record: [['timestamp', 'time'], ['account', 'user'], ['source_ip', 'source']],
  ssh_session_record: [['timestamp', 'time'], ['session_ref', 'session_id'], ['user', 'account'], ['shell_result', 'result']],
  traversal_access_record: [['timestamp', 'time'], ['request_target', 'path']],
  traversal_read_record: [['timestamp', 'time'], ['path', 'file'], ['read_result', 'result'], ['response_result']],
  sudo_policy_record: [['user', 'account'], ['allowed_command', 'command'], ['run_as']],
  sudo_execution_record: [['process_ref', 'process_id'], ['parent_ref', 'parent_id'], ['effective_uid', 'euid']],
  setuid_metadata_record: [['timestamp', 'time'], ['path', 'file'], ['owner'], ['setuid']],
  setuid_execution_record: [['process_ref', 'process_id'], ['parent_ref', 'parent_id'], ['effective_uid', 'euid']],
  service_acl_record: [['path', 'image_path'], ['service_account'], ['acl']],
  service_execution_record: [['timestamp', 'time'], ['path', 'image_path'], ['file_change'], ['restart_result'], ['effective_identity']],
  collection_read_record: [['process_ref', 'process_id'], ['path', 'file'], ['read_result', 'result']],
  collection_output_record: [['path', 'file'], ['source_path'], ['process_ref', 'process_id']],
  web_access_record: [['timestamp', 'time'], ['request_target', 'target', 'url', 'path']],
  database_statement_record: [['statement', 'sql', 'query']],
  stored_content_record: [['post_id', 'content_id'], ['stored_content', 'source_excerpt', 'content']],
  browser_execution_record: [['request_target', 'target', 'url', 'post_id'], ['execution_result', 'execution_event', 'result']],
  credential_submission_record: [['destination', 'target'], ['timestamp', 'time'], ['correlation_id', 'correlation_ref']],
  authentication_record: [['account', 'username', 'user'], ['timestamp', 'time'], ['source_ip', 'source'], ['result', 'status']],
  application_session_record: [['account', 'username', 'user'], ['session_accepted', 'session_result'], ['permission', 'permissions']],
  clickfix_page_record: [['request_id', 'request_ref'], ['response_time', 'timestamp'], ['body', '案内本文']],
  process_execution_record: [['timestamp', 'time'], ['device_id', 'device', 'host'], ['process_ref', 'process_id'],
    ['parent_ref', 'parent_id'], ['user_ref', 'user', 'account'], ['start_result', 'result']],
  spray_authentication_record: [['timestamp', 'time'], ['account', 'username'], ['source_ip', 'source'], ['result', 'status'], ['attempt_id', 'attempt_ref']],
  authentication_policy_record: [['authentication', 'authentication_method'], ['scope', '対象範囲'],
    ['lockout_condition', 'lockout'], ['rate_limit_condition', 'rate_limit'], ['applied_at', 'timestamp', '設定適用時刻']],
  file_encryption_record: [['timestamp', 'time'], ['path', 'target_path'], ['hash_before', 'before_hash'], ['hash_after', 'after_hash'],
    ['encryption_check', 'encryption_result'], ['process_ref', 'process_id', 'correlation_id'], ['ransom_note', '要求文']],
  upload_receipt_record: [['timestamp', 'time'], ['request_ref', 'request_id'], ['filename', 'declared_filename'],
    ['declared_type', 'content_type'], ['storage_ref', 'storage_id'], ['result', 'status']],
  uploaded_file_record: [['storage_ref', 'storage_id'], ['stored_at', 'timestamp'], ['hash', 'sha256'],
    ['detected_type', 'detected_format'], ['content_check', 'allowed'], ['executable_storage', 'storage_executable']],
});

function records(artifact) {
  return artifact.publicContent.split(/\r?\n/).flatMap(line => {
    try { const row = JSON.parse(line); return row && typeof row === 'object' && !Array.isArray(row) ? [row] : []; }
    catch {
      const match = line.match(/^([\w.-]+)\s*[:=]\s*(.+)$/);
      return match ? [{ [match[1]]: match[2] }] : [];
    }
  });
}

// These joins are explicitly provided by the registered observation definitions.
// We check existing IDs only, without synthesizing a link or asserting causality.
function validateRecordedJoins(artifacts) {
  const nodeIds = new Set(artifacts.flatMap(item => (item.sourceRefs ?? [])
    .filter(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT').map(ref => ref.attackNodeId)));
  for (const nodeId of nodeIds) {
    const source = id => artifacts.filter(item => item.type !== 'TESTIMONY'
      && item.sourceRefs?.some(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT'
        && ref.attackNodeId === nodeId && ref.sourceId === id));
    const rows = id => source(id).flatMap(records);
    const same = (a, b) => a === b && ((typeof a === 'string' && a.trim() !== '') || Number.isSafeInteger(a));
    const reject = message => fail('EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING', 'evidenceArtifacts.publicContent', message);
    if (['stored_content_record', 'web_access_record', 'browser_execution_record',
      'browser_request_initiator_record', 'announcement_audit_record'].every(id => source(id).length)) {
      const linked = rows('browser_request_initiator_record').some(start => start.initiator_type === 'script'
        && typeof start.source_location === 'string' && start.source_location.trim()
        && rows('stored_content_record').some(post => same(post.post_id, start.source_post_id))
        && rows('web_access_record').some(view => same(view.request_id, start.view_request_id))
        && rows('browser_execution_record').some(run => same(run.execution_id, start.execution_id)
          && same(run.request_id, start.view_request_id) && same(run.post_id, start.source_post_id)
          && ['observed', 'executed', 'script_executed', 'success'].includes(run.execution_result))
        && rows('announcement_audit_record').some(post => same(post.request_id, start.request_id)
          && ['created', 'stored', 'accepted', 'success'].includes(post.result)));
      if (!linked) reject('保存投稿ID、閲覧要求ID、実行ID、スクリプト開始元、投稿要求ID、投稿成功の対応が不足しています。同じ処理の記録を照合可能にし、無関係な行や時刻だけで因果を結ばないでください。');
    }
    if (['web_access_record', 'database_statement_record', 'application_response_record'].every(id => source(id).length)) {
      const linked = rows('application_response_record').some(response => ((Number(response.status) >= 200
        && Number(response.status) < 300) || ['returned', 'returned_to_requester', 'success', 'ok'].includes(response.status))
        && ((Array.isArray(response.record_refs) && response.record_refs.some(ref => typeof ref === 'string' && ref.trim()))
          || (typeof response.result_digest === 'string' && response.result_digest.trim()))
        && rows('web_access_record').some(request => same(request.request_id, response.request_id))
        && rows('database_statement_record').some(query => same(query.request_id, response.request_id)
          && same(query.query_id, response.query_id) && typeof query.statement === 'string' && query.statement.trim()));
      if (!linked) reject('Web要求IDとDBクエリIDの同一の組を、要求・実行SQL・結果返却の資料で照合できません。成功応答には返却レコード参照またはダイジェストが必要です。SQL実行だけを漏えいの証明にしないでください。');
    }
    for (const [left, right, names] of [
      ['upload_receipt_record', 'uploaded_file_record', ['storage_ref', 'storage_id']],
      ['process_execution_record', 'file_encryption_record', ['process_ref', 'process_id', 'correlation_id']],
      ['authentication_record', 'application_session_record', ['account', 'username', 'user']],
    ]) {
      const values = id => source(id).flatMap(item => records(item).flatMap(row => names
        .filter(name => Object.hasOwn(row, name)).map(name => row[name])));
      if (!source(left).length || !source(right).length) continue; // Import checks coverage.
      const a = values(left), b = values(right);
      if (!a.some(value => b.includes(value))) fail('EVIDENCE_LEARNING_CORRELATION_MISMATCH', 'evidenceArtifacts.publicContent',
        `${left}と${right}の対応を示す記録値が一致しません。入力にある同一対象を示す値を資料間で一致させ、別の対象や処理を推測で結び付けないでください。`);
    }
  }
}

export function validateLearningObservations(artifacts) {
  for (const [index, artifact] of artifacts.entries()) {
    if (artifact.type === 'TESTIMONY') continue;
    const sources = [...new Set((artifact.sourceRefs ?? []).filter(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT')
      .map(ref => ref.sourceId))];
    const rows = records(artifact);
    const has = aliases => aliases.some(name => rows.some(row => Object.hasOwn(row, name)
      && row[name] !== null && row[name] !== '')
      || new RegExp(`(?:^|[\\n\\s])${name}\\s*[:=：]\\s*\\S`, 'm').test(artifact.publicContent));
    for (const source of sources) {
      const missing = (LEARNING_OBSERVATION_FIELDS[source] ?? []).filter(aliases => !has(aliases));
      if (missing.length) fail('EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE', `evidenceArtifacts[${index}].publicContent`,
        `${source}の取得定義にある比較用の記録が不足しています: ${missing.map(aliases => aliases.join('/')).join('、')}。入力で確認済みの対象・内容だけを記載し、未入力の値や結果を推測で埋めないでください。`);
      if (source === 'spray_authentication_record') {
        const accounts = new Set(rows.map(row => row.account ?? row.username).filter(Boolean));
        const results = rows.map(row => row.result ?? row.status);
        if (accounts.size < 2 || results.filter(value => ['failure', 'failed', '失敗'].includes(value)).length < 2
          || !results.some(value => ['success', 'succeeded', '成功'].includes(value))) fail(
          'EVIDENCE_LEARNING_DISTRIBUTION_MISSING', `evidenceArtifacts[${index}].publicContent`,
          'この観測定義には複数アカウントの失敗と一つの成功が含まれます。定義された試行分布を比較できる認証記録が必要です。秘密値や候補識別子は追加しないでください。');
      }
    }
  }
  validateRecordedJoins(artifacts);
}
