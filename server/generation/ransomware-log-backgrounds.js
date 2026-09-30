import { createHash } from 'node:crypto';
import { fail } from './schema.js';
import { isRansomwareLog, MIN_LOG_RECORDS } from './evidence-log-format.js';

const reject = message => fail('EVIDENCE_LOG_BACKGROUND_INVALID', 'logBackgrounds', message);
const text = value => typeof value === 'string' && value.trim().length > 0;
const pid = value => Number.isSafeInteger(value) && value >= 0;
const parse = content => content.trim().split(/\r?\n/).map(line => {
  try { const row = JSON.parse(line); if (row && typeof row === 'object' && !Array.isArray(row)) return row; } catch {}
  reject('端末ログと通常例は1行1件のJSONオブジェクトにしてください。');
});

// One schedule and one process identity map for both endpoint logs. Independent
// field substitution would manufacture PID/ref mismatches and impossible parents.
export function ransomwareBackgrounds(artifacts, plans) {
  const logs = artifacts.filter(item => isRansomwareLog(item, artifacts));
  const selected = plans.filter(plan => logs.some(item => item.evidenceId === plan?.evidenceId));
  if (!selected.length) return null;
  const originalRows = artifacts.flatMap(item => {
    try { return parse(item.publicContent); } catch { return []; }
  });
  const originalRefs = new Set(originalRows.flatMap(row => [row.process_ref, row.parent_ref]).filter(text));
  const originalPids = new Set(originalRows.flatMap(row => [row.pid, row.parent_pid]).filter(pid));
  const paths = new Set(originalRows.flatMap(row => [row.path, row.new_path, row.original_path]).filter(text));
  const samplesById = new Map();
  const identities = new Map();
  const checkIdentity = (device, ref, number, row = {}) => {
    const key = JSON.stringify([device, ref]);
    const prior = identities.get(key);
    if (prior && (prior.pid !== number || (prior.executable && row.executable && prior.executable !== row.executable)
      || (prior.user_ref && row.user_ref && prior.user_ref !== row.user_ref))) reject('通常例の同じプロセス相関IDに異なるPID・実行ファイル・アカウントが割り当てられています。');
    identities.set(key, { ...prior, pid: number, ...row });
  };
  for (const plan of selected) {
    if (!Array.isArray(plan.samples) || plan.samples.length < 3 || plan.samples.length > 8
      || plan.samples.some(sample => typeof sample !== 'string' || sample.length > 2000 || /[\r\n]/.test(sample)))
      reject('端末ログの通常例は3～8件の1行JSONにしてください。');
    const item = logs.find(item => item.evidenceId === plan.evidenceId), originals = parse(item.publicContent);
    const fields = new Set(originals.flatMap(Object.keys));
    const devices = new Set(originals.map(row => row.device_id));
    const operations = item.sourceRefs.some(ref => ref.sourceId === 'file_operation_record');
    const samples = plan.samples.map(sample => parse(sample)[0]);
    for (const row of samples) {
      if (!['timestamp', 'device_id', 'process_ref', 'user_ref', 'executable'].every(key => text(row[key]))
        || !Number.isFinite(Date.parse(row.timestamp)) || !pid(row.pid) || row.pid === 0
        || !devices.has(row.device_id) || Object.keys(row).some(key => !fields.has(key)))
        reject('通常例は元の端末・取得項目と、有効な時刻・PID・相関ID・実行情報を使ってください。');
      if (originalRefs.has(row.process_ref) || originalPids.has(row.pid))
        reject('通常例に事件原文のプロセス相関ID・PIDを再利用しないでください。');
      checkIdentity(row.device_id, row.process_ref, row.pid, { executable: row.executable, user_ref: row.user_ref });
      if (operations) {
        if (!['read', 'write', 'create', 'rename', 'delete'].includes(row.operation) || !text(row.path)
          || paths.has(row.path) || (row.operation === 'rename' && (!text(row.new_path) || paths.has(row.new_path) || row.new_path === row.path)))
          reject('通常のファイル操作は事件の対象外のパスで表現し、被害・要求文の操作を複製しないでください。');
      } else {
        if (!pid(row.parent_pid) || !['parent_ref', 'command_line'].every(key => text(row[key])) || row.start_result !== 'started'
          || row.parent_ref === row.process_ref || row.parent_pid === row.pid
          || (row.parent_pid !== 0 && (originalRefs.has(row.parent_ref) || originalPids.has(row.parent_pid))))
          reject('通常の起動例には有効な親PID・親相関ID・コマンドライン・起動結果を示し、事件の実行経路へ接続しないでください。');
        checkIdentity(row.device_id, row.parent_ref, row.parent_pid);
      }
    }
    samplesById.set(plan.evidenceId, samples.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)));
  }
  const samples = [...samplesById.values()].flat();
  const starts = samples.filter(row => 'parent_pid' in row);
  if (new Set(starts.map(row => JSON.stringify([row.device_id, row.process_ref]))).size !== starts.length)
    reject('通常の起動例は、同じプロセス相関IDの起動を重複させないでください。');
  for (const row of samples) {
    const start = starts.find(other => other.device_id === row.device_id
      && other.process_ref === ('parent_ref' in row ? row.parent_ref : row.process_ref));
    if (start && Date.parse(start.timestamp) > Date.parse(row.timestamp)) reject('通常例の親の起動・ファイル操作の時系列が逆転しています。');
  }
  const eventTimes = logs.flatMap(item => parse(item.publicContent).map(row => Date.parse(row.timestamp)));
  if (eventTimes.some(time => !Number.isFinite(time))) reject('端末ログの時刻が不正です。');
  const sampleStart = Math.min(...samples.map(row => Date.parse(row.timestamp)));
  const sampleSpan = Math.max(...samples.map(row => Date.parse(row.timestamp))) - sampleStart;
  // Two-minute gaps keep ordinary copies out of the incident burst and the
  // adjacent baseline window. Keep offsets within a sample group intact.
  const interval = sampleSpan + 120_000;
  const minTime = Math.min(...eventTimes), maxTime = Math.max(...eventTimes);
  const usedRefs = new Set([...originalRefs, ...samples.flatMap(row => [row.process_ref, row.parent_ref]).filter(text)]);
  const usedPids = new Set([...originalPids, ...samples.flatMap(row => [row.pid, row.parent_pid]).filter(pid)]);
  const copies = new Map(); let nextPid = 10000;
  const identity = (device, ref, number, cycle) => {
    if (number === 0) return { ref, pid: 0 };
    const key = JSON.stringify([device, ref, number, cycle]);
    if (!copies.has(key)) {
      while (usedPids.has(nextPid)) nextPid++;
      let suffix = 0, copyRef;
      do {
        const serial = nextPid + suffix++;
        copyRef = /\d+$/.test(ref) ? ref.replace(/\d+$/, digits => String(serial).padStart(digits.length, '0'))
          : createHash('sha256').update(`${key}:${serial}`).digest('hex').slice(0, 20);
      } while (usedRefs.has(copyRef));
      usedRefs.add(copyRef); usedPids.add(nextPid);
      copies.set(key, { ref: copyRef, pid: nextPid++ });
    }
    return copies.get(key);
  };
  return (item, count, before, formatTime) => {
    const source = samplesById.get(item.evidenceId);
    if (!source) return null;
    return Array.from({ length: count }, (_, index) => {
      const position = index < before ? index : index - before;
      const row = structuredClone(source[position % source.length]);
      const cycle = index < before ? Math.floor(position / source.length) - Math.ceil(MIN_LOG_RECORDS / 3)
        : Math.floor(position / source.length) + 1;
      const offset = Date.parse(row.timestamp) - sampleStart;
      row.timestamp = formatTime(row.timestamp, (cycle < 0 ? minTime : maxTime) + cycle * interval + offset);
      const copy = identity(row.device_id, row.process_ref, row.pid, cycle);
      row.process_ref = copy.ref; row.pid = copy.pid;
      if ('parent_pid' in row) {
        const parent = identity(row.device_id, row.parent_ref, row.parent_pid, cycle);
        row.parent_ref = parent.ref; row.parent_pid = parent.pid;
      }
      return JSON.stringify(row);
    });
  };
}
