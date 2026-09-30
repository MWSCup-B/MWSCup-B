import { fail } from './schema.js';

export const LOG_TYPES = Object.freeze(['WEB_ACCESS_LOG', 'AUTHENTICATION_LOG', 'APPLICATION_LOG',
  'DATABASE_LOG', 'NETWORK_LOG']);

export const MIN_LOG_RECORDS = 100;
// DEVICE_INFORMATION also contains non-log material. Select only the two logs
// belonging to a node with the ransomware file-operation observation.
export function isRansomwareLog(artifact, artifacts = [artifact]) {
  if (artifact.type !== 'DEVICE_INFORMATION') return false;
  const nodes = new Set(artifacts.flatMap(item => item.type === 'DEVICE_INFORMATION'
    ? (item.sourceRefs ?? []).filter(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT'
      && ref.sourceId === 'file_operation_record').map(ref => ref.attackNodeId) : []));
  return (artifact.sourceRefs ?? []).some(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT'
    && nodes.has(ref.attackNodeId) && ['file_operation_record', 'process_execution_record'].includes(ref.sourceId));
}
export const isExplorableLog = (artifact, artifacts = [artifact]) => LOG_TYPES.includes(artifact.type)
  || isRansomwareLog(artifact, artifacts);
// Generation supplies the entire search space before hashing. Validation never
// pads sealed evidence or changes the positions of supporting quotes.
export function validateExplorableWebLogs(artifacts, context = artifacts) {
  artifacts.forEach((artifact, index) => {
    if (!isExplorableLog(artifact, context)) return;
    const lines = artifact.publicContent.trim().split(/\r?\n/);
    if (new Set(lines).size < MIN_LOG_RECORDS) fail('EVIDENCE_LOG_CONTEXT_REQUIRED', `evidenceArtifacts[${index}].publicContent`,
      'ログには対象行と同じ取得元・記録条件の通常記録を含め、100件以上の異なる記録を用意してください。背景記録を追加の攻撃や人物帰属の根拠にせず、引用と調査手順を原文に合わせてください。');
  });
}

// The configured services do not specify vendor/version/native logging format.
// Automatic generation therefore uses product-neutral JSON Lines, with fields
// appropriate to the *observed artifact*. This checks syntax, not factual support.
export function validateGeneratedLogFormats(artifacts, context = artifacts) {
  artifacts.forEach((artifact, index) => {
    if (!isExplorableLog(artifact, context)) return;
    const field = `evidenceArtifacts[${index}].publicContent`;
    const reject = () => fail('EVIDENCE_LOG_FORMAT_INVALID', field,
      'ログは英語の項目・値による1行1件のJSONオブジェクト（JSON Lines）にしてください。見出し・教材注記・解説・空行を本文に入れず、取得条件にある観測項目だけを残してください。引用も完成した原文と一致させてください。');
    const lines = artifact.publicContent.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop(); // A final newline is a record terminator.
    if (!lines.length) reject();
    const validObject = value => value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length > 0;
    const validFields = value => {
      if (Array.isArray(value)) return value.every(validFields);
      if (value && typeof value === 'object') return Object.entries(value).every(([key, child]) =>
        /^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(key)
        && !/^(?:explanation|comment|note|description|interpretation|verdict|answer|hint|conclusion)$/i.test(key)
        && validFields(child));
      return typeof value !== 'string' || !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);
    };
    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { reject(); }
      if (!validObject(record) || !validFields(record)) reject();
    }
  });
}
