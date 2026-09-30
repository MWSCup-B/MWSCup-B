import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLearningObservations } from '../server/generation/learning-observations.js';

const before = '2026-09-18T09:10:00+09:00';
const after = '2026-09-18T09:10:01+09:00';
const earlier = '2026-09-18T09:09:59+09:00';
const artifact = (sourceId, rows, attackNodeId = 'attack') => ({ type: 'APPLICATION_LOG',
  sourceRefs: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT', sourceId, attackNodeId }],
  publicContent: typeof rows === 'string' ? rows : (Array.isArray(rows) ? rows : [rows]).map(JSON.stringify).join('\n') });
const assertRejected = (artifacts, code = 'EVIDENCE_LEARNING_CORRELATION_MISMATCH') =>
  assert.throws(() => validateLearningObservations(artifacts), { code });

const cases = [
  { name: '認証成功とセッション受入れ', left: 'authentication_record', right: 'application_session_record',
    a: { timestamp: before, auth_event_ref: 'auth-1', account: 'user-a', source_ip: '203.0.113.10', result: 'success' },
    b: { timestamp: after, auth_event_ref: 'auth-1', account: 'user-a', session_accepted: true, permission: 'read' },
    changes: [b => { b.auth_event_ref = 'auth-other'; }, b => { b.account = 'user-other'; }, b => { b.session_accepted = false; }],
    failed: a => { a.result = 'failure'; } },
  { name: 'SSH認証成功とシェル起動', left: 'ssh_authentication_record', right: 'ssh_session_record',
    a: { timestamp: before, connection_ref: 'connection-1', account: 'user-a', source_ip: '203.0.113.10', result: 'success' },
    b: { timestamp: after, connection_ref: 'connection-1', session_ref: 'session-1', user: 'user-a', shell_result: 'started' },
    changes: [b => { b.connection_ref = 'connection-other'; }, b => { b.user = 'user-other'; }, b => { b.shell_result = 'denied'; }],
    failed: a => { a.result = 'failure'; } },
  { name: '閲覧要求とブラウザ実行', left: 'web_access_record', right: 'browser_execution_record',
    a: { timestamp: before, request_id: 'request-1', request_target: '/view', origin: 'https://portal.example.invalid' },
    b: { timestamp: after, request_id: 'request-1', request_target: '/view', origin: 'https://portal.example.invalid', execution_result: 'observed' },
    changes: [b => { b.request_id = 'request-other'; }, b => { b.origin = 'https://other.example.invalid'; },
      b => { b.execution_result = 'blocked'; }] },
  { name: '偽フォーム閲覧要求と送信受信', left: 'web_access_record', right: 'credential_submission_record',
    a: { timestamp: before, request_id: 'request-1', request_target: '/form', origin: 'https://lure.example.invalid' },
    b: { timestamp: after, request_id: 'request-1', source_page: '/form', origin: 'https://lure.example.invalid',
      destination: 'https://lure.example.invalid/submit', correlation_id: 'form-1', result: 'received' },
    changes: [b => { b.request_id = 'request-other'; }, b => { b.origin = 'https://other.example.invalid'; },
      b => { b.result = 'failure'; }] },
  { name: '受付成功と保存ファイル', left: 'upload_receipt_record', right: 'uploaded_file_record',
    a: { timestamp: before, request_ref: 'upload-1', source_ref: 'sender-1', filename: 'image.png', declared_type: 'image/png',
      storage_ref: 'file-1', result: 'stored' },
    b: { stored_at: after, storage_ref: 'file-1', hash: 'synthetic-file-hash', detected_type: 'text/plain',
      content_check: 'disallowed', executable_storage: false },
    changes: [b => { b.storage_ref = 'file-other'; }, b => { b.content_check = 'allowed'; }],
    failed: a => { a.result = 'rejected'; } },
  { name: 'プロセス起動とファイル変更', left: 'process_execution_record', right: 'file_encryption_record',
    a: { timestamp: before, device_id: 'device-1', process_ref: 'process-1', parent_ref: 'parent-1', user_ref: 'user-a', start_result: 'started' },
    b: { timestamp: after, process_ref: 'process-1', path: '/reports/file.txt', hash_before: 'before-hash', hash_after: 'after-hash',
      encryption_check: 'confirmed', ransom_note: 'Request for payment.' },
    changes: [b => { b.process_ref = 'process-other'; }, b => { b.encryption_check = 'not_confirmed'; }],
    failed: a => { a.start_result = 'failed'; } },
  { name: 'sudo許可と実効権限', left: 'sudo_policy_record', right: 'sudo_execution_record',
    a: { timestamp: before, user: 'user-a', allowed_command: '/tools/maintenance', run_as: 'root' },
    b: { timestamp: after, process_ref: 'process-1', parent_ref: 'parent-1', command: '/tools/maintenance', effective_uid: 0 },
    changes: [b => { b.command = '/tools/other'; }, b => { b.effective_uid = 1000; }],
    failed: a => { a.run_as = 'user-other'; } },
  { name: 'setuid設定と実効権限', left: 'setuid_metadata_record', right: 'setuid_execution_record',
    a: { timestamp: before, path: '/tools/maintenance', owner: 'root', setuid: true },
    b: { timestamp: after, process_ref: 'process-1', parent_ref: 'parent-1', path: '/tools/maintenance', effective_uid: 0 },
    changes: [b => { b.path = '/tools/other'; }, b => { b.effective_uid = 1000; }],
    failed: a => { a.setuid = false; } },
  { name: 'サービス対象と再起動後の実行主体', left: 'service_acl_record', right: 'service_execution_record',
    a: { timestamp: before, path: 'C:/service/app.exe', service_account: 'LocalSystem', acl: 'user-a:write' },
    b: { timestamp: after, path: 'C:/service/app.exe', file_change: 'observed', restart_result: 'started', effective_identity: 'LocalSystem' },
    changes: [b => { b.path = 'C:/service/other.exe'; }, b => { b.effective_identity = 'user-a'; },
      b => { b.restart_result = 'failed'; }, b => { b.file_change = 'none'; }] },
  { name: 'ファイル読取と同じプロセスによる複写先', left: 'collection_read_record', right: 'collection_output_record',
    a: { timestamp: before, process_ref: 'process-1', path: '/reports/report.txt', read_result: 'success' },
    b: { timestamp: after, process_ref: 'process-1', source_path: '/reports/report.txt', path: '/collection/report.txt' },
    changes: [b => { b.process_ref = 'process-other'; }, b => { b.source_path = '/reports/other.txt'; }],
    failed: a => { a.read_result = 'denied'; } },
];

for (const entry of cases) test(`${entry.name}: 同一記録の対応・成功・時間順序を確認する`, () => {
  const good = [artifact(entry.left, entry.a), artifact(entry.right, entry.b)];
  const original = structuredClone(good);
  assert.doesNotThrow(() => validateLearningObservations(good));
  assert.deepEqual(good, original);
  for (const change of [...entry.changes,
    b => { if ('stored_at' in b) b.stored_at = earlier; else b.timestamp = earlier; },
    b => { if ('stored_at' in b) b.stored_at = '09:10'; else b.timestamp = '09:10'; }]) {
    const bad = structuredClone(entry.b); change(bad);
    assertRejected([good[0], artifact(entry.right, bad)]);
  }
  if (entry.failed) {
    const failed = structuredClone(entry.a); entry.failed(failed);
    assertRejected([artifact(entry.left, failed), good[1]]);
  }
  // Neither of two incomplete matches is the complete observed causal pair.
  if (entry.changes.length >= 2) {
    const crossed = [structuredClone(entry.b), structuredClone(entry.b)];
    entry.changes[0](crossed[0]); entry.changes[1](crossed[1]);
    assertRejected([good[0], artifact(entry.right, crossed)]);
  }
});

test('ClickFixは操作識別子が一致しても失敗した起動・案内より早い起動を認めない', () => {
  const page = artifact('clickfix_page_record', { request_id: 'web-1', response_time: before,
    instruction_ref: 'instruction-1', body: 'Run the supplied confirmation instruction.' });
  const process = { timestamp: after, device_id: 'device-1', process_ref: 'process-1', parent_ref: 'parent-1',
    user_ref: 'user-a', instruction_ref: 'instruction-1', start_result: 'started' };
  assert.doesNotThrow(() => validateLearningObservations([page, artifact('process_execution_record', process)]));
  for (const overrides of [{ timestamp: earlier }, { start_result: 'failed' }, { instruction_ref: 'other' }]) {
    assertRejected([page, artifact('process_execution_record', { ...process, ...overrides })], 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
  }
});

test('SQLは要求とクエリの組を保持し、失敗した実行や要求より前の返却を認めない', () => {
  const request = { timestamp: before, request_id: 'request-1', request_target: '/search' };
  const query = { timestamp: before, request_id: 'request-1', query_id: 'query-1',
    statement: 'SELECT title FROM reports', execution_result: 'success' };
  const response = { timestamp: after, request_id: 'request-1', query_id: 'query-1', record_refs: ['report-1'], status: 200 };
  const sample = (queries = query, result = response) => [artifact('web_access_record', request),
    artifact('database_statement_record', queries), artifact('application_response_record', result)];
  assert.doesNotThrow(() => validateLearningObservations(sample()));
  for (const overrides of [{ execution_result: 'failure' }, { timestamp: earlier }]) {
    assertRejected(sample({ ...query, ...overrides }), 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
  }
  assertRejected(sample(query, { ...response, timestamp: earlier }), 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
  assertRejected(sample([{ ...query, request_id: 'other' }, { ...query, query_id: 'other' }]), 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
});

test('保存投稿・閲覧・実行・投稿要求・投稿完了は同一経路で時系列も一致する', () => {
  const entries = [
    ['stored_content_record', { timestamp: earlier, post_id: 'post-1', stored_content: 'Inert stored script source.' }],
    ['web_access_record', { timestamp: before, request_id: 'view-1', request_target: '/post/1' }],
    ['browser_execution_record', { timestamp: after, request_id: 'view-1', request_target: '/post/1',
      post_id: 'post-1', execution_id: 'execution-1', execution_result: 'observed' }],
    ['browser_request_initiator_record', { timestamp: '2026-09-18T09:10:02+09:00', request_id: 'submit-1',
      view_request_id: 'view-1', execution_id: 'execution-1', source_post_id: 'post-1', initiator_type: 'script', source_location: '/post/1:1:1' }],
    ['announcement_audit_record', { timestamp: '2026-09-18T09:10:03+09:00', request_id: 'submit-1',
      session_id: 'session-1', post_id: 'notice-1', result: 'created' }],
  ];
  const build = entries => entries.map(([id, row]) => artifact(id, row));
  assert.doesNotThrow(() => validateLearningObservations(build(entries)));
  for (const index of [1, 2, 3, 4]) {
    const reversed = structuredClone(entries); reversed[index][1].timestamp = '2026-09-18T09:09:58+09:00';
    assertRejected(build(reversed), 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
  }
  const split = structuredClone(entries);
  split[2][1] = [{ ...entries[2][1], execution_id: 'other' }, { ...entries[2][1], post_id: 'other' }];
  assertRejected(build(split), 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
});

test('メールの表示URLをhrefと取り違えず、ホスト不一致やホスト未記録のpath-onlyを認めない', () => {
  const email = artifact('email_record', '<a href="https://lure.example.invalid/view?a=1&amp;b=2">https://portal.example.invalid/view?a=1&amp;b=2</a>');
  const request = { timestamp: after, request_target: '/view?a=1&b=2', origin: 'https://lure.example.invalid' };
  assert.doesNotThrow(() => validateLearningObservations([email, artifact('web_access_record', request)]));
  for (const bad of [
    { timestamp: after, request_target: 'https://portal.example.invalid/view?a=1&b=2' },
    { timestamp: after, request_target: '/view?a=1&b=2' },
    { ...request, origin: 'https://other.example.invalid' },
  ]) assertRejected([email, artifact('web_access_record', bad)], 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
  assert.doesNotThrow(() => validateLearningObservations([email, artifact('web_access_record',
    { timestamp: after, request_target: '/view?a=1&b=2', host: 'lure.example.invalid' })]));
  const structured = artifact('email_record', { href: 'https://lure.example.invalid/view', url: 'https://portal.example.invalid/view' });
  assertRejected([structured, artifact('web_access_record', { timestamp: after, request_target: 'https://portal.example.invalid/view' })],
    'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
});

test('パストラバーサルは要求ID・対象ファイル・読取成功・返却成功を同じ組で確認する', () => {
  const request = artifact('traversal_access_record', { timestamp: before, request_id: 'request-1', request_target: '/download?file=report.txt' });
  const read = { timestamp: after, request_id: 'request-1', path: 'report.txt', read_result: 'success', response_result: 'returned' };
  assert.doesNotThrow(() => validateLearningObservations([request, artifact('traversal_read_record', read)]));
  for (const overrides of [{ request_id: 'request-other' }, { path: 'report' }, { read_result: 'denied' },
    { response_result: 'failed' }, { timestamp: earlier }]) {
    assertRejected([request, artifact('traversal_read_record', { ...read, ...overrides })], 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
  }
  assertRejected([request, artifact('traversal_read_record', [
    { ...read, request_id: 'other' }, { ...read, path: 'other.txt' },
  ])], 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING');
});

test('JSONの別行から不足項目を合成せず、KVブロック・整形済みJSONの一件を保持する', () => {
  const entry = cases[0];
  const pretty = artifact(entry.left, JSON.stringify(entry.a, null, 2));
  const kv = artifact(entry.right, Object.entries(entry.b).map(([key, val]) => `${key}: ${val}`).join('\n'));
  assert.doesNotThrow(() => validateLearningObservations([pretty, kv]));
  const split = Object.entries(entry.b).map(([key, val]) => ({ [key]: val }));
  assertRejected([pretty, artifact(entry.right, split)], 'EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE');
  const separate = `timestamp: ${after}\nauth_event_ref: auth-1\naccount: other\nsession_accepted: true\npermission: read\n\n`
    + `timestamp: ${after}\nauth_event_ref: other\naccount: user-a\nsession_accepted: true\npermission: read`;
  assertRejected([pretty, artifact(entry.right, separate)]);
});

test('パスワードスプレーの成功は同一送信元の異なる試行として記録されている必要がある', () => {
  const attempts = ['failure', 'failure', 'success'].map((result, index) => ({ timestamp: before,
    source_ip: '203.0.113.10', account: `account-${index}`, attempt_id: `attempt-${index}`, result }));
  assert.doesNotThrow(() => validateLearningObservations([artifact('spray_authentication_record', attempts)]));
  const otherSource = structuredClone(attempts); otherSource[2].source_ip = '203.0.113.20';
  assertRejected([artifact('spray_authentication_record', otherSource)], 'EVIDENCE_LEARNING_DISTRIBUTION_MISSING');
  const duplicate = structuredClone(attempts); duplicate[1].attempt_id = duplicate[0].attempt_id;
  assertRejected([artifact('spray_authentication_record', duplicate)], 'EVIDENCE_LEARNING_DISTRIBUTION_MISSING');
});
