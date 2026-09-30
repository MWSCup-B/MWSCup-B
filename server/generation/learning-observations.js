import { fail } from './schema.js';
import { phishingMailLinks } from './phishing-evidence.js';

// Minimum observable fields from data/attacks/*.json, not vendor log assumptions.
// Aliases permit existing product-neutral names; values are never filled here.
export const LEARNING_OBSERVATION_FIELDS = Object.freeze({
  file_operation_record: ['timestamp', 'device_id', 'user_ref', 'process_ref', 'pid', 'executable', 'operation', 'path'].map(key => [key]),
  damaged_file_record: ['snapshot', 'timestamp', 'device_id', 'file_ref', 'original_path', 'path', 'detected_format', 'sha256', 'header_hex', 'readable', 'process_ref'].map(key => [key]),
  original_file_record: ['snapshot', 'timestamp', 'device_id', 'file_ref', 'original_path', 'path', 'detected_format', 'sha256', 'header_hex', 'readable'].map(key => [key]),
  ransom_note_record: ['timestamp', 'device_id', 'path', 'process_ref', 'body'].map(key => [key]),
  announcement_audit_record: [['timestamp', 'time'], ['request_id'], ['session_id'], ['post_id'], ['result']],
  browser_request_initiator_record: [['timestamp', 'time'], ['request_id'], ['view_request_id'], ['execution_id'], ['source_post_id'], ['initiator_type'], ['source_location']],
  application_response_record: [['timestamp', 'time'], ['request_id'], ['query_id'], ['record_refs', 'result_digest'], ['status']],
  // 2026-09-24: mainの取得定義を、kawata-workの観測資料検証にも登録する。
  ssh_authentication_record: [['timestamp', 'time'], ['connection_ref'], ['account', 'user'], ['source_ip', 'source'], ['result', 'status']],
  ssh_session_record: [['timestamp', 'time'], ['connection_ref'], ['session_ref', 'session_id'], ['user', 'account'], ['shell_result', 'result']],
  traversal_access_record: [['timestamp', 'time'], ['request_id'], ['request_target', 'path']],
  traversal_read_record: [['timestamp', 'time'], ['request_id'], ['path', 'file'], ['read_result', 'result'], ['response_result']],
  sudo_policy_record: [['user', 'account'], ['allowed_command', 'command'], ['run_as']],
  sudo_execution_record: [['process_ref', 'process_id'], ['parent_ref', 'parent_id'], ['command', 'executable'], ['effective_uid', 'euid']],
  setuid_metadata_record: [['timestamp', 'time'], ['path', 'file'], ['owner'], ['setuid']],
  setuid_execution_record: [['process_ref', 'process_id'], ['parent_ref', 'parent_id'], ['path', 'file', 'executable'], ['effective_uid', 'euid']],
  service_acl_record: [['path', 'image_path'], ['service_account'], ['acl']],
  service_execution_record: [['timestamp', 'time'], ['path', 'image_path'], ['file_change'], ['restart_result'], ['effective_identity']],
  collection_read_record: [['process_ref', 'process_id'], ['path', 'file'], ['read_result', 'result']],
  collection_output_record: [['path', 'file'], ['source_path'], ['process_ref', 'process_id']],
  web_access_record: [['timestamp', 'time'], ['request_target', 'target', 'url', 'path']],
  database_statement_record: [['statement', 'sql', 'query']],
  stored_content_record: [['post_id', 'content_id'], ['stored_content', 'source_excerpt', 'content']],
  browser_execution_record: [['timestamp', 'time'], ['request_id'], ['request_target', 'target', 'url', 'post_id'], ['execution_result', 'execution_event', 'result']],
  credential_submission_record: [['request_id'], ['destination', 'target'], ['source_page', 'request_target'], ['timestamp', 'time'], ['correlation_id', 'correlation_ref'], ['result', 'status']],
  authentication_record: [['auth_event_ref'], ['account', 'username', 'user'], ['timestamp', 'time'], ['source_ip', 'source'], ['result', 'status']],
  application_session_record: [['timestamp', 'time'], ['auth_event_ref'], ['account', 'username', 'user'], ['session_accepted', 'session_result'], ['permission', 'permissions']],
  clickfix_page_record: [['request_id', 'request_ref'], ['response_time', 'timestamp'], ['body', '案内本文'], ['instruction_ref']],
  process_execution_record: [['timestamp', 'time'], ['device_id', 'device', 'host'], ['process_ref', 'process_id'],
    ['parent_ref', 'parent_id'], ['user_ref', 'user', 'account'], ['start_result', 'result']],
  spray_authentication_record: [['timestamp', 'time'], ['account', 'username'], ['source_ip', 'source'], ['result', 'status'], ['attempt_id', 'attempt_ref']],
  authentication_policy_record: [['authentication', 'authentication_method'], ['scope', '対象範囲'],
    ['lockout_condition', 'lockout'], ['rate_limit_condition', 'rate_limit'], ['applied_at', 'timestamp', '設定適用時刻']],
  file_encryption_record: [['timestamp', 'time'], ['path', 'target_path'], ['hash_before', 'before_hash'], ['hash_after', 'after_hash'],
    ['encryption_check', 'encryption_result'], ['process_ref', 'process_id', 'correlation_id'], ['ransom_note', '要求文']],
  upload_receipt_record: [['timestamp', 'time'], ['request_ref', 'request_id'], ['filename', 'declared_filename'],
    ['source_ref', 'source'], ['declared_type', 'content_type'], ['storage_ref', 'storage_id'], ['result', 'status']],
  uploaded_file_record: [['storage_ref', 'storage_id'], ['stored_at', 'timestamp'], ['hash', 'sha256'],
    ['detected_type', 'detected_format'], ['content_check', 'allowed'], ['executable_storage', 'storage_executable']],
});

function records(artifact) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  try {
    const value = JSON.parse(artifact.publicContent);
    return object(value) ? [value] : Array.isArray(value) ? value.filter(object) : [];
  } catch { /* JSON Lines or a preserved key/value record. */ }
  const result = []; let block = {};
  const flush = () => { if (Object.keys(block).length) result.push(block); block = {}; };
  for (const line of artifact.publicContent.split(/\r?\n/)) {
    try {
      const row = JSON.parse(line);
      flush();
      if (object(row)) result.push(row);
      continue;
    } catch { /* A key/value block is one record, not one record per field. */ }
    const match = line.match(/^([^\s:=：]+)\s*[:=：]\s*(.+)$/);
    if (!match) { flush(); continue; }
    // Repeated keys begin another record; never combine distinct event tuples.
    if (Object.hasOwn(block, match[1])) flush();
    block[match[1]] = match[2];
  }
  flush(); return result;
}

const present = value => value !== undefined && value !== null && value !== '';
function value(row, names) {
  // Prefer the contract's canonical name. Alternate names are fallbacks, not a
  // bag of values from which a convenient matching identifier may be selected.
  return names.filter(name => Object.hasOwn(row, name)).map(name => row[name]).find(present);
}
const same = (a, b) => a === b && ((typeof a === 'string' && a.trim() !== '') || Number.isSafeInteger(a));
const account = row => value(row, ['account', 'username', 'user']);
const time = row => value(row, ['timestamp', 'time', 'response_time', 'stored_at']);
function ordered(left, right, required = false) {
  const a = time(left), b = time(right);
  if (!present(a) || !present(b)) return !required;
  const dated = stamp => typeof stamp === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(stamp);
  if (!dated(a) || !dated(b)) return false;
  const first = Date.parse(a), second = Date.parse(b);
  return Number.isFinite(first) && Number.isFinite(second) && first <= second;
}
const success = (entry, names, allowed = ['success', 'succeeded', 'ok']) => {
  const result = value(entry, names);
  return typeof result === 'string' && allowed.includes(result.toLowerCase());
};
const started = row => success(row, ['start_result', 'result'], ['started', 'success', 'succeeded', 'running']);
const optionalSuccess = (row, names, allowed) => !names.some(name => Object.hasOwn(row, name)) || success(row, names, allowed);
const successfulResponse = status => (typeof status === 'number' || /^\d{3}$/.test(status))
  ? Number(status) >= 200 && Number(status) < 300
  : ['returned', 'returned_to_requester', 'success', 'ok'].includes(status);

function requestTarget(input, row = {}) {
  if (typeof input !== 'string' || !input.trim()) return null;
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return { host: url.host, scheme: url.protocol, path: `${url.pathname}${url.search}` };
  } catch { /* A path alone must not silently acquire an invented origin. */ }
  if (!input.startsWith('/') || input.startsWith('//')) return null;
  if (typeof row.origin === 'string') {
    try {
      const origin = new URL(row.origin);
      if (!['http:', 'https:'].includes(origin.protocol)) return null;
      return requestTarget(new URL(input, origin).href);
    } catch { return null; }
  }
  const host = value(row, ['host', 'request_host']);
  if (host !== undefined && (typeof host !== 'string' || !/^[a-z\d.[\]:-]+$/i.test(host))) return null;
  const scheme = value(row, ['scheme', 'protocol']);
  if (scheme !== undefined && !['http', 'https', 'http:', 'https:'].includes(scheme)) return null;
  return { host: host?.toLowerCase() ?? null, scheme: scheme ? scheme.replace(/:$/, '') + ':' : null,
    path: input.split('#', 1)[0] };
}
function sameTarget(left, leftRow, right, rightRow) {
  const a = requestTarget(left, leftRow), b = requestTarget(right, rightRow);
  return !!a && !!b && a.path === b.path && a.host === b.host
    && (!a.scheme || !b.scheme || a.scheme === b.scheme);
}
const target = row => value(row, ['request_target', 'target', 'url', 'path']);
function mailTargets(artifact) {
  const links = phishingMailLinks(artifact.publicContent);
  if (links.length || /<a\b|\bhref\s*=/i.test(artifact.publicContent)) return links.map(link => link.href);
  const structured = records(artifact).flatMap(row => {
    for (const key of ['href', 'link_target', 'url']) if (Object.hasOwn(row, key)) return [row[key]];
    return [];
  });
  return structured.length ? structured : artifact.publicContent.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
}

function requestedFile(row, path) {
  const decode = text => { try { return decodeURIComponent(text); } catch { return null; } };
  const explicit = value(row, ['resolved_path', 'file_path']);
  if (explicit !== undefined) return same(explicit, path);
  const request = value(row, ['request_target', 'path']);
  if (typeof request !== 'string' || typeof path !== 'string') return false;
  if (same(decode(request), path)) return true;
  try {
    const url = new URL(request, 'https://path-parser.invalid');
    return same(decode(url.pathname), path) || [...url.searchParams.values()].some(candidate => same(candidate, path));
  } catch { return false; }
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
    const rows = id => source(id).flatMap(records).filter(row =>
      (LEARNING_OBSERVATION_FIELDS[id] ?? []).every(names => present(value(row, names))));
    const reject = message => fail('EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING', 'evidenceArtifacts.publicContent', message);
    const pair = (left, right, matches) => {
      if (!source(left).length || !source(right).length) return;
      if (!rows(left).some(a => rows(right).some(b => matches(a, b))))
        fail('EVIDENCE_LEARNING_CORRELATION_MISMATCH', 'evidenceArtifacts.publicContent',
          `${left}と${right}について、同じ対象・処理を示す識別子、成功結果、記録された時刻の順序を同一の記録の組で照合できません。別々の行の値を組み合わせたり、未記録の対応を推測したりしないでください。`);
    };
    if (['stored_content_record', 'web_access_record', 'browser_execution_record',
      'browser_request_initiator_record', 'announcement_audit_record'].every(id => source(id).length)) {
      const linked = rows('browser_request_initiator_record').some(start => start.initiator_type === 'script'
        && typeof start.source_location === 'string' && start.source_location.trim()
        && rows('browser_execution_record').some(run => same(run.execution_id, start.execution_id)
          && same(run.request_id, start.view_request_id) && same(run.post_id, start.source_post_id) && ordered(run, start, true)
          && success(run, ['execution_result', 'execution_event', 'result'], ['observed', 'executed', 'script_executed', 'success'])
          && rows('web_access_record').some(view => same(view.request_id, run.request_id) && ordered(view, run, true)
            && sameTarget(target(view), view, target(run), run)
            && rows('stored_content_record').some(post => same(value(post, ['post_id', 'content_id']), start.source_post_id)
              && ordered(post, view))))
        && rows('announcement_audit_record').some(post => same(post.request_id, start.request_id)
          && ordered(start, post, true) && ['created', 'stored', 'accepted', 'success'].includes(post.result)));
      if (!linked) reject('保存投稿ID、閲覧要求ID、実行ID、スクリプト開始元、投稿要求ID、投稿成功の対応が不足しています。同じ処理の記録を照合可能にし、無関係な行や時刻だけで因果を結ばないでください。');
    }
    if (['web_access_record', 'database_statement_record', 'application_response_record'].every(id => source(id).length)) {
      const linked = rows('application_response_record').some(response => successfulResponse(response.status)
        && ((Array.isArray(response.record_refs) && response.record_refs.some(ref => typeof ref === 'string' && ref.trim()))
          || (typeof response.result_digest === 'string' && response.result_digest.trim()))
        && rows('database_statement_record').some(query => same(query.request_id, response.request_id)
          && same(query.query_id, response.query_id) && typeof value(query, ['statement', 'sql', 'query']) === 'string'
          && ordered(query, response) && optionalSuccess(query, ['execution_result'])
          && rows('web_access_record').some(request => same(request.request_id, query.request_id)
            && ordered(request, query) && ordered(request, response, true))));
      if (!linked) reject('Web要求IDとDBクエリIDの同一の組を、要求・実行SQL・結果返却の資料で照合できません。成功応答には返却レコード参照またはダイジェストが必要です。SQL実行だけを漏えいの証明にしないでください。');
    }
    if (['clickfix_page_record', 'process_execution_record'].every(id => source(id).length)) {
      const linked = rows('clickfix_page_record').some(page => typeof page.instruction_ref === 'string'
        && page.instruction_ref.trim() && rows('process_execution_record')
          .some(process => same(page.instruction_ref, process.instruction_ref) && started(process) && ordered(page, process, true)));
      if (!linked) reject('保存案内と端末記録にある非実行の操作識別子instruction_refが対応していません。Web要求IDとプロセス相関IDを結び付けず、両資料に実在する同じinstruction_refで案内内容と記録された処理内容を照合できるようにしてください。');
    }
    if (['email_record', 'web_access_record'].every(id => source(id).length)) {
      const emailTargets = source('email_record').flatMap(mailTargets);
      if (!emailTargets.some(link => rows('web_access_record').some(request => sameTarget(link, {}, target(request), request)))) {
        reject('保存メールのリンク先とWebアクセス記録の要求対象が一致していません。公開本文に実在する値で誘導先への要求を照合できるようにし、時刻の近さだけで因果を結ばないでください。');
      }
    }
    pair('upload_receipt_record', 'uploaded_file_record', (receipt, file) =>
      same(value(receipt, ['storage_ref', 'storage_id']), value(file, ['storage_ref', 'storage_id']))
      && success(receipt, ['result', 'status'], ['stored', 'accepted', 'success']) && ordered(receipt, file, true)
      && (['disallowed', 'rejected', 'not_allowed'].includes(file.content_check) || [false, 'false'].includes(file.allowed)));
    pair('process_execution_record', 'file_encryption_record', (process, file) =>
      same(value(process, ['process_ref', 'process_id']), value(file, ['process_ref', 'process_id', 'correlation_id']))
      && started(process) && ordered(process, file, true)
      && (!present(file.device_id) || same(value(process, ['device_id', 'device', 'host']), file.device_id))
      && success(file, ['encryption_check', 'encryption_result'], ['confirmed', 'success', 'encrypted']));
    pair('authentication_record', 'application_session_record', (auth, session) =>
      same(auth.auth_event_ref, session.auth_event_ref) && same(account(auth), account(session))
      && success(auth, ['result', 'status']) && ordered(auth, session, true)
      && [true, 'true', 'accepted', 'success'].includes(value(session, ['session_accepted', 'session_result'])));
    pair('ssh_authentication_record', 'ssh_session_record', (auth, session) =>
      same(auth.connection_ref, session.connection_ref) && same(account(auth), account(session))
      && success(auth, ['result', 'status']) && ordered(auth, session, true)
      && success(session, ['shell_result', 'result'], ['started', 'success', 'shell_started']));
    pair('web_access_record', 'browser_execution_record', (request, run) =>
      same(request.request_id, run.request_id) && sameTarget(target(request), request, target(run), run)
      && ordered(request, run, true)
      && success(run, ['execution_result', 'execution_event', 'result'], ['observed', 'executed', 'script_executed', 'success']));
    pair('web_access_record', 'credential_submission_record', (request, submission) =>
      same(request.request_id, submission.request_id)
      && sameTarget(target(request), request, value(submission, ['source_page', 'request_target']), submission)
      && ordered(request, submission, true) && success(submission, ['result', 'status'], ['received', 'accepted', 'submitted', 'success']));
    const identity = (name, uid) => same(name, uid) || (name === 'root' && [0, '0'].includes(uid));
    pair('sudo_policy_record', 'sudo_execution_record', (policy, execution) =>
      same(value(policy, ['allowed_command', 'command']), value(execution, ['command', 'executable']))
      && identity(policy.run_as, value(execution, ['effective_uid', 'euid']))
      && (!present(account(execution)) || same(account(policy), account(execution))) && ordered(policy, execution)
      && optionalSuccess(execution, ['execution_result'], ['started', 'success', 'executed']));
    pair('setuid_metadata_record', 'setuid_execution_record', (metadata, execution) =>
      same(value(metadata, ['path', 'file']), value(execution, ['path', 'file', 'executable']))
      && [true, 'true'].includes(metadata.setuid) && identity(metadata.owner, value(execution, ['effective_uid', 'euid']))
      && ordered(metadata, execution) && optionalSuccess(execution, ['execution_result'], ['started', 'success', 'executed']));
    pair('service_acl_record', 'service_execution_record', (acl, execution) =>
      same(value(acl, ['path', 'image_path']), value(execution, ['path', 'image_path']))
      && same(acl.service_account, execution.effective_identity) && ordered(acl, execution)
      && [true, 'true', 'observed', 'modified', 'changed', 'replaced'].includes(execution.file_change)
      && success(execution, ['restart_result'], ['started', 'restarted', 'success']));
    pair('collection_read_record', 'collection_output_record', (read, output) =>
      same(value(read, ['process_ref', 'process_id']), value(output, ['process_ref', 'process_id']))
      && same(value(read, ['path', 'file']), output.source_path) && success(read, ['read_result', 'result'], ['success', 'read', 'read_success'])
      && ordered(read, output) && optionalSuccess(output, ['result'], ['created', 'written', 'success']));
    if (['traversal_access_record', 'traversal_read_record'].every(id => source(id).length)) {
      if (!rows('traversal_access_record').some(request => rows('traversal_read_record').some(read =>
        same(request.request_id, read.request_id) && requestedFile(request, value(read, ['path', 'file']))
        && ordered(request, read, true) && success(read, ['read_result', 'result'], ['success', 'read', 'read_success'])
        && success(read, ['response_result'], ['returned', 'success', 'returned_to_requester'])))) reject(
        'ファイル参照要求の対象と、実際に読み取り・返却したファイルのパスを照合できません。要求時刻の近さだけで読み取り結果を結び付けないでください。');
    }
  }
}

export function validateLearningObservations(artifacts) {
  for (const [index, artifact] of artifacts.entries()) {
    if (artifact.type === 'TESTIMONY') continue;
    const sources = [...new Set((artifact.sourceRefs ?? []).filter(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT')
      .map(ref => ref.sourceId))];
    const rows = records(artifact);
    for (const source of sources) {
      const fields = LEARNING_OBSERVATION_FIELDS[source] ?? [];
      const missing = fields.filter(names => !rows.some(row => present(value(row, names))));
      if (missing.length) fail('EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE', `evidenceArtifacts[${index}].publicContent`,
        `${source}の取得定義にある比較用の記録が不足しています: ${missing.map(aliases => aliases.join('/')).join('、')}。入力で確認済みの対象・内容だけを記載し、未入力の値や結果を推測で埋めないでください。`);
      if (fields.length && !rows.some(row => fields.every(names => present(value(row, names))))) fail(
        'EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE', `evidenceArtifacts[${index}].publicContent`,
        `${source}の比較用項目を一つの記録内で確認できません。別々の行・資料ブロックの項目を組み合わせて、存在しない処理の記録を作らないでください。`);
      if (source === 'spray_authentication_record') {
        const complete = rows.filter(row => fields.every(names => present(value(row, names))));
        const senders = [...new Set(complete.map(row => value(row, ['source_ip', 'source'])))];
        const distributed = senders.some(sender => {
          const attempts = complete.filter(row => same(value(row, ['source_ip', 'source']), sender));
          const ids = attempts.map(row => value(row, ['attempt_id', 'attempt_ref']));
          return new Set(ids).size === attempts.length && new Set(attempts.map(account)).size >= 2
            && attempts.filter(row => success(row, ['result', 'status'], ['failure', 'failed', '失敗'])).length >= 2
            && attempts.some(row => success(row, ['result', 'status'], ['success', 'succeeded', '成功']));
        });
        if (!distributed) fail(
          'EVIDENCE_LEARNING_DISTRIBUTION_MISSING', `evidenceArtifacts[${index}].publicContent`,
          'この観測定義には同じ送信元から複数アカウントへの異なる試行の失敗と一つの成功が含まれます。同じ試行の重複や別の送信元の成功を混ぜず、定義された分布を比較できる認証記録が必要です。');
      }
    }
  }
  validateRecordedJoins(artifacts);
}
