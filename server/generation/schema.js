import { readFile } from 'node:fs/promises';

const names = ['attack-definition', 'network', 'scenario-context', 'candidate',
  'attack-graph', 'attack-graph-result', 'candidate-selection', 'candidate-builder-result',
  'scenario-draft', 'ground-truth', 'character', 'timeline', 'learning-objective',
  'evidence-requirement', 'scenario-validation-result', 'scenario-generation-input',
  'scenario-import-package', 'scenario-validation-feedback', 'scenario-import-result',
  'scenario-verification-input', 'scenario-verification-review', 'scenario-verification-result',
  'scenario-revision-feedback', 'evidence-agent-handoff', 'evidence-agent-input',
  'evidence-artifact', 'evidence-set', 'evidence-generation-input', 'evidence-import-package',
  'evidence-import-result', 'evidence-validation-feedback', 'contradiction', 'exoneration',
  'game-case-handoff', 'game-progression-plan', 'game-progression', 'public-game-progression',
  'game-case-conversion-input', 'game-case', 'public-game-case',
  'game-case-result', 'ui-integration-handoff', 'game-make-result', 'evaluation-handoff',
  'game-evaluation-input', 'game-evaluation-result', 'orchestrator-input-validation-result',
  'orchestrator-result', 'investigation-action', 'investigation-target',
  'evidence-discovery-rule', 'investigation-result', 'xss-prototype-selection',
  'xss-prototype-evaluation', 'scenario-configuration', 'network-preset', 'makotomaru-request',
  'makotomaru-result', 'court-question', 'scenario-revision', 'scenario-selection'];
const schemas = new Map(await Promise.all(names.map(async name => [name,
  JSON.parse(await readFile(new URL(`../../schemas/${name}.schema.json`, import.meta.url), 'utf8')),
])));

export class ValidationError extends Error {
  constructor(code, field, message, details = {}) {
    super(message);
    Object.assign(this, { code, field, ...details });
  }
}

export function fail(code, field, message, details = {}) {
  throw new ValidationError(code, field, message, details);
}

// 同梱スキーマが使用するキーワードだけを実装。外部スキーマやコードは実行しない。
const keywords = new Set(['$schema', 'title', 'type', 'const', 'enum', 'properties',
  'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength',
  'maxLength', 'pattern', 'format']);

function checkSchema(schema) {
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key)) fail('UNSUPPORTED_SCHEMA', key, '未対応のスキーマキーワードです。');
  }
  if (schema.properties) Object.values(schema.properties).forEach(checkSchema);
  if (schema.items) checkSchema(schema.items);
}
for (const schema of schemas.values()) checkSchema(schema);

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validFormat(value, format) {
  if (format === 'date') return validDate(value);
  if (format === 'date-time') return validDateTime(value);
  fail('UNSUPPORTED_SCHEMA', 'format', '未対応の文字列形式です。');
}

function validate(value, schema, path) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && ![schema.type].flat().includes(type)) fail('INVALID_TYPE', path, '値の型が不正です。',
    { receivedType: type });
  if ('const' in schema && value !== schema.const) fail('UNSUPPORTED_VERSION', path, '未対応の値またはスキーマ版です。');
  if (schema.enum && !schema.enum.includes(value)) fail('UNSUPPORTED_VALUE', path, '未対応の値です。');
  if (type === 'string') {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)
      || (schema.pattern && !new RegExp(schema.pattern).test(value))
      || (schema.format && !validFormat(value, schema.format))) {
      fail('INVALID_STRING', path, '文字列の長さまたは形式が不正です。', {
        receivedType: type, length: value.length,
        expectedMinLength: schema.minLength ?? null,
        expectedMaxLength: schema.maxLength ?? null,
        expectedPattern: schema.pattern ?? null,
        expectedFormat: schema.format ?? null,
      });
    }
  }
  if (type === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) {
      fail('INVALID_COUNT', path, '要素数が範囲外です。');
    }
    value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`));
  }
  if (type === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) fail('MISSING_FIELD', `${path}.${key}`, '必須フィールドがありません。');
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) {
        if (schema.additionalProperties === false) fail('UNKNOWN_FIELD', `${path}.${key}`, '未定義のフィールドです。');
        continue;
      }
      validate(value[key], schema.properties[key], `${path}.${key}`);
    }
  }
}

export function validateDocument(name, value) {
  if (!schemas.has(name)) fail('UNKNOWN_SCHEMA', 'schema', '未登録のスキーマです。');
  validate(value, schemas.get(name), name);
  return value;
}
