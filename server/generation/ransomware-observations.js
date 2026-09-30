import { fail } from './schema.js';

const sources = ['file_operation_record', 'process_execution_record', 'damaged_file_record', 'original_file_record', 'ransom_note_record'];
const text = value => typeof value === 'string' && value.trim().length > 0;
const timestamp = value => text(value) && Number.isFinite(Date.parse(value));
const pid = value => Number.isSafeInteger(value) && value >= 0;
const sameProcess = (a, b) => a.device_id === b.device_id && a.process_ref === b.process_ref;

// Validate authored observations before sealing. Never fill a missing event, join,
// parent process or backup from the answer, a nearby time, or a different attack.
export function validateRansomwareObservations(artifacts, graph) {
  for (const node of graph.nodes.filter(node => node.attackDefinitionId === 'ransomware'
    && node.artifactEvaluations.some(item => item.artifactId === 'file_operation_record'))) {
    const reject = reason => fail('EVIDENCE_RANSOMWARE_OBSERVATION_INVALID', 'evidenceArtifacts.publicContent', reason,
      { correctionHint: '同じattackNodeIdの検証済み取得定義に合わせ、5種類の資料・引用・手順を修正してください。端末・プロセス・ファイルの対応を推測で埋めず、前段の攻撃や実行経路を変更しません。' });
    const materials = Object.fromEntries(sources.map(sourceId => [sourceId, artifacts.filter(item => item.type !== 'TESTIMONY'
      && item.sourceRefs.some(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT'
        && ref.attackNodeId === node.nodeId && ref.sourceId === sourceId))]));
    if (sources.some(id => !materials[id].length)) { reject('ファイル操作・実行情報・被害ファイル・正常版・要求文の個別資料が不足しています。'); }
    if (new Set(Object.values(materials).flat().map(item => item.evidenceId)).size < sources.length)
      reject('5種類の調査対象は別々の資料にし、正常版の値を被害資料だけで先に開示しないでください。');
    const rows = sourceId => materials[sourceId].flatMap(item => item.publicContent.trim().split(/\r?\n/).map(line => {
      let row;
      try { row = JSON.parse(line); } catch { reject(`${sourceId}は各操作・検査を1行ずつJSON Linesで保存してください。`); }
      if (!row || typeof row !== 'object' || Array.isArray(row) || !timestamp(row.timestamp) || !text(row.device_id))
        reject(`${sourceId}の記録日時・端末が不正です。`);
      return row;
    }));
    const operations = rows('file_operation_record'), processes = rows('process_execution_record');
    const damaged = rows('damaged_file_record'), originals = rows('original_file_record'), notes = rows('ransom_note_record');
    for (const row of notes) if (!['path', 'process_ref', 'body'].every(key => text(row[key])))
      reject('要求文の対象パス・作成プロセス・保存本文が不足しています。');
    for (const row of operations) {
      if (!pid(row.pid) || !['user_ref', 'process_ref', 'executable', 'operation', 'path'].every(key => text(row[key]))
        || (row.operation === 'rename' && (!text(row.new_path) || row.path === row.new_path)))
        reject('ファイル操作のPID・実行情報・対象、または改名前後のパスが不足しています。');
    }
    for (const row of processes) {
      if (!pid(row.pid) || !pid(row.parent_pid) || !['process_ref', 'parent_ref', 'user_ref', 'executable', 'command_line', 'start_result'].every(key => text(row[key])))
        reject('プロセス実行ログにPID・親PID・実行ファイル・コマンドラインと相関IDを記録してください。');
    }
    for (const [rows, snapshot] of [[damaged, 'damaged'], [originals, 'backup']]) for (const row of rows) {
      if (!/^[a-f0-9]{64}$/i.test(row.sha256))
        reject(`${snapshot}のfile_ref=${row.file_ref}のsha256は64桁の16進数が必要です（現在${typeof row.sha256 === 'string' ? row.sha256.length : 0}桁）。この検査値と対応する引用を修正してください。`);
      if (row.snapshot !== snapshot || !['file_ref', 'original_path', 'path', 'detected_format'].every(key => text(row[key]))
        || !/^(?:[a-f0-9]{2}){4,64}$/i.test(row.header_hex)
        || row.readable !== (snapshot === 'backup')) reject('ファイル検査の識別子・形式・SHA-256・先頭バイト・読取り結果が不足または不正です。');
    }
    for (const damage of damaged) {
      const matching = originals.filter(row => row.device_id === damage.device_id && row.file_ref === damage.file_ref
        && row.original_path === damage.original_path);
      if (matching.length !== 1) reject('被害ファイルに対応する正常版をfile_ref・元端末・元パスで一意に照合できません。');
      const original = matching[0];
      if (original.sha256.toLowerCase() === damage.sha256.toLowerCase() || original.header_hex.toLowerCase() === damage.header_hex.toLowerCase()
        || original.detected_format === damage.detected_format || Date.parse(original.timestamp) >= Date.parse(damage.timestamp))
        reject('正常版と被害側の検査値・形式・日時が、変更前後の観測と矛盾しています。');
      const write = operations.find(row => sameProcess(row, damage) && row.operation === 'write' && row.path === damage.original_path);
      const rename = operations.find(row => sameProcess(row, damage) && row.operation === 'rename'
        && row.path === damage.original_path && row.new_path === damage.path);
      const process = processes.find(row => sameProcess(row, damage) && row.pid === write?.pid
        && row.executable === write.executable && row.user_ref === write.user_ref && row.start_result === 'started');
      if (!write || !rename || !process || rename.pid !== process.pid || rename.executable !== process.executable
        || rename.user_ref !== process.user_ref || Date.parse(process.timestamp) > Date.parse(write.timestamp)
        || Date.parse(write.timestamp) > Date.parse(rename.timestamp) || Date.parse(rename.timestamp) > Date.parse(damage.timestamp)
        || Date.parse(original.timestamp) >= Date.parse(write.timestamp))
        reject('同じ端末・処理による起動、書込み、改名、被害検査を記録の値と時系列で照合できません。');
      const parent = processes.find(row => row.device_id === process.device_id && row.process_ref === process.parent_ref
        && row.pid === process.parent_pid && row.process_ref !== process.process_ref
        && Date.parse(row.timestamp) <= Date.parse(process.timestamp));
      if (!parent) reject('対象プロセスの親を同じ端末の親PID・親相関IDで確認できません。SSHの親を推測で追加しないでください。');
      if (!notes.some(note => sameProcess(note, damage) && text(note.body) && operations.some(row => sameProcess(row, note)
        && row.pid === process.pid && row.executable === process.executable && row.user_ref === process.user_ref
        && row.operation === 'create' && row.path === note.path
        && Date.parse(process.timestamp) <= Date.parse(row.timestamp) && Date.parse(row.timestamp) <= Date.parse(note.timestamp))))
        reject('要求文の保存本文と、その文書を作成した対象プロセスの操作記録が対応していません。');
    }
  }
}

// The game projection has no private sourceRefs. Use only explicit public snapshot
// identities and actually viewed rows; ambiguous matches yield no comparison.
export function observedFileComparisons(materials, observedLines) {
  const rows = materials.filter(item => item.type === 'FILE_METADATA').flatMap(item => item.publicContent.split(/\r?\n/)
    .flatMap((line, index) => {
      if (!Object.hasOwn(observedLines ?? {}, item.evidenceId) || !observedLines[item.evidenceId].includes(index + 1)) return [];
      try { const row = JSON.parse(line);
        const compact = line.replace(/"(?:\\.|[^"\\])*"|\s+/g, token => token.startsWith('"') ? token : '');
        return row && JSON.stringify(row) === compact && ['damaged', 'backup'].includes(row.snapshot)
        && ['file_ref', 'device_id', 'original_path', 'detected_format', 'sha256', 'header_hex'].every(key => text(row[key]))
        ? [{ ...row, materialId: item.evidenceId, line: index + 1 }] : []; } catch { return []; }
    }));
  return rows.filter(row => row.snapshot === 'damaged').flatMap(damage => {
    const pair = rows.filter(row => row.device_id === damage.device_id && row.file_ref === damage.file_ref
      && row.original_path === damage.original_path);
    if (pair.length !== 2) return [];
    const original = pair.find(row => row.snapshot === 'backup' && row.materialId !== damage.materialId);
    if (!original) return [];
    const summary = row => ({ materialId: row.materialId, line: row.line, format: row.detected_format,
      sha256: row.sha256, headerHex: row.header_hex });
    return [{ fileRef: damage.file_ref, originalPath: damage.original_path, damaged: summary(damage), original: summary(original),
      hashChanged: damage.sha256.toLowerCase() !== original.sha256.toLowerCase(),
      headerChanged: damage.header_hex.toLowerCase() !== original.header_hex.toLowerCase() }];
  });
}
