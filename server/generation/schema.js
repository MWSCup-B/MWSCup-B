import { readFile } from 'node:fs/promises';

const names = ['attack-definition', 'network', 'scenario-context', 'candidate'];
const schemas = new Map(await Promise.all(names.map(async name => [name,
  JSON.parse(await readFile(new URL(`../../schemas/${name}.schema.json`, import.meta.url), 'utf8')),
])));

export class ValidationError extends Error {
  constructor(code, field, message) {
    super(message);
    Object.assign(this, { code, field });
  }
}

export function fail(code, field, message) {
  throw new ValidationError(code, field, message);
}

// 同梱スキーマが使用するキーワードだけを実装。外部スキーマやコードは実行しない。
const keywords = new Set(['$schema', 'title', 'type', 'const', 'enum', 'properties',
  'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern']);

function checkSchema(schema) {
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key)) fail('UNSUPPORTED_SCHEMA', key, '未対応のスキーマキーワードです。');
  }
  if (schema.properties) Object.values(schema.properties).forEach(checkSchema);
  if (schema.items) checkSchema(schema.items);
}
for (const schema of schemas.values()) checkSchema(schema);

function validate(value, schema, path) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && ![schema.type].flat().includes(type)) fail('INVALID_TYPE', path, '値の型が不正です。');
  if ('const' in schema && value !== schema.const) fail('UNSUPPORTED_VERSION', path, '未対応の値またはスキーマ版です。');
  if (schema.enum && !schema.enum.includes(value)) fail('UNSUPPORTED_VALUE', path, '未対応の値です。');
  if (type === 'string') {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)
      || (schema.pattern && !new RegExp(schema.pattern).test(value))) {
      fail('INVALID_STRING', path, '文字列の長さまたは形式が不正です。');
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
      if (!Object.hasOwn(schema.properties ?? {}, key)) fail('UNKNOWN_FIELD', `${path}.${key}`, '未定義のフィールドです。');
      validate(value[key], schema.properties[key], `${path}.${key}`);
    }
  }
}

export function validateDocument(name, value) {
  if (!schemas.has(name)) fail('UNKNOWN_SCHEMA', 'schema', '未登録のスキーマです。');
  validate(value, schemas.get(name), name);
  return value;
}
