import { createHash } from 'node:crypto';
import { isRansomwareLog } from '../../server/generation/evidence-log-format.js';

export function ransomwareLogSamples(artifacts) {
  return artifacts.filter(item => isRansomwareLog(item, artifacts)).map(item => {
    const row = JSON.parse(item.publicContent.split('\n')[0]);
    const files = item.sourceRefs.some(ref => ref.sourceId === 'file_operation_record');
    const samples = ['viewer', 'indexer', 'editor'].map((app, index) => JSON.stringify({
      timestamp: new Date(Date.UTC(2026, 8, 17, 22, 0, index * 2 + (files ? 1 : 0))).toISOString(),
      device_id: row.device_id, user_ref: row.user_ref, process_ref: `proc-${801 + index}`,
      pid: 80001 + index, executable: `C:/training/${app}.exe`,
      ...(files ? { operation: index === 2 ? 'write' : 'read', path: `C:/training/reference-${index}.txt` }
        : { parent_ref: 'proc-900', parent_pid: 90000, command_line: `training-${app}`, start_result: 'started' }),
    }));
    return { evidenceId: item.evidenceId, samples };
  });
}

export function ransomwareEvidence(timestamp = '2026-09-18T09:10:00+09:00') {
  const time = offset => new Date(Date.parse(timestamp) + offset * 1000).toISOString();
  const identity = { device_id: 'training-endpoint', user_ref: 'training-user', process_ref: 'training-writer', pid: 4242, executable: 'C:/training/sample.exe' };
  const ops = [], damaged = [], originals = [], notes = [];
  const hash = value => createHash('sha256').update(value).digest('hex');
  for (let i = 0; i < 6; i++) {
    const dir = i < 3 ? 'C:/training/sales' : 'C:/training/plans';
    const path = `${dir}/report-${i}.${i % 2 ? 'png' : 'pdf'}`;
    const file = { device_id: identity.device_id, file_ref: `saved-file-${i}`, original_path: path };
    ops.push({ timestamp: time(i * 2 + 1), ...identity, operation: 'write', path },
      { timestamp: time(i * 2 + 2), ...identity, operation: 'rename', path, new_path: `${path}.locked` });
    damaged.push({ snapshot: 'damaged', timestamp: time(30), ...file, path: `${path}.locked`,
      detected_format: 'application/octet-stream', sha256: hash(`damaged-${i}`), header_hex: '918af05218c8d799', readable: false, process_ref: identity.process_ref });
    originals.push({ snapshot: 'backup', timestamp: time(-3600), ...file, path: `backup/report-${i}`,
      detected_format: i % 2 ? 'image/png' : 'application/pdf', sha256: hash(`original-${i}`),
      header_hex: i % 2 ? '89504e470d0a1a0a' : '255044462d312e37', readable: true });
    if (i === 0 || i === 3) {
      const notePath = `${dir}/RESTORE.txt`;
      ops.push({ timestamp: time(14 + i), ...identity, operation: 'create', path: notePath });
      notes.push({ timestamp: time(25), device_id: identity.device_id, process_ref: identity.process_ref, path: notePath,
        body: 'ファイルを使用不能にした。復旧と引換えに金銭を要求する。連絡先はrestore@example.invalid（架空の教材）。' });
    }
  }
  ops.push({ timestamp: time(-120), ...identity, pid: 88, process_ref: 'routine-editor', executable: 'C:/training/editor.exe', operation: 'write', path: 'C:/training/routine.txt' });
  const processes = [{ timestamp: time(0), ...identity, parent_ref: 'training-launcher', parent_pid: 4000,
    start_result: 'started', command_line: 'training-sample' },
  { timestamp: time(-1), ...identity, process_ref: 'training-launcher', pid: 4000, executable: 'C:/training/launcher.exe',
    parent_ref: 'training-session', parent_pid: 3000, start_result: 'started', command_line: 'training-launcher' }];
  const material = (type, title, rows) => [type, title, rows.map(row => JSON.stringify(row)).join('\n')];
  return {
    file_operation_record: material('DEVICE_INFORMATION', 'ファイル操作ログ', ops),
    process_execution_record: material('DEVICE_INFORMATION', 'プロセス実行ログ', processes),
    damaged_file_record: material('FILE_METADATA', '被害ファイル', damaged),
    original_file_record: material('FILE_METADATA', 'バックアップから取得した元ファイル', originals),
    ransom_note_record: material('DOCUMENT', '身代金要求文', notes),
  };
}
