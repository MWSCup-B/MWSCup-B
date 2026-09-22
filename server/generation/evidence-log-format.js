import { fail } from './schema.js';

export const LOG_TYPES = Object.freeze(['WEB_ACCESS_LOG', 'AUTHENTICATION_LOG', 'APPLICATION_LOG',
  'DATABASE_LOG', 'NETWORK_LOG']);

// The configured services do not specify vendor/version/native logging format.
// Automatic generation therefore uses product-neutral JSON Lines, with fields
// appropriate to the *observed artifact*. This checks syntax, not factual support.
export function validateGeneratedLogFormats(artifacts) {
  artifacts.forEach((artifact, index) => {
    if (!LOG_TYPES.includes(artifact.type)) return;
    const field = `evidenceArtifacts[${index}].publicContent`;
    const reject = () => fail('EVIDENCE_LOG_FORMAT_INVALID', field,
      'ログは1行1件のJSONオブジェクト（JSON Lines）にしてください。見出し・教材注記・解説・空行を本文に入れず、取得条件にある観測項目だけを残してください。引用も完成した原文と一致させてください。');
    const lines = artifact.publicContent.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop(); // A final newline is a record terminator.
    if (!lines.length) reject();
    const validObject = value => value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length > 0;
    const validFields = value => {
      if (Array.isArray(value)) return value.every(validFields);
      if (value && typeof value === 'object') return Object.entries(value).every(([key, child]) =>
        /^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(key)
        && !/^(?:explanation|comment|note|description|interpretation|verdict|answer)$/i.test(key)
        && validFields(child));
      return true;
    };
    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { reject(); }
      if (!validObject(record) || !validFields(record)) reject();
    }
  });
}
