import { CodexOutputSchemaError } from './codex-errors.js';

const ANNOTATION_KEYWORDS = new Set([
  '$schema', '$id', '$comment', 'title', 'examples', 'default', 'deprecated',
  'readOnly', 'writeOnly',
]);

const ALLOWED_KEYWORDS = new Set([
  '$ref', '$defs', 'type', 'description', 'properties', 'required',
  'additionalProperties', 'items', 'enum', 'const', 'anyOf',
  'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems',
]);

const UNSUPPORTED_KEYWORDS = new Set([
  'allOf', 'not', 'dependentRequired', 'dependentSchemas', 'if', 'then', 'else',
  'patternProperties', 'unevaluatedProperties', 'propertyNames', 'contains',
  'minContains', 'maxContains', 'prefixItems', 'uniqueItems',
]);
const JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaError(message, { schemaName, schemaPath }) {
  return new CodexOutputSchemaError(message, {
    schemaName, schemaPath, details: `${schemaPath}: ${message}`,
  });
}

export function inferTypeFromConst(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('const must be a finite JSON number');
    return 'number';
  }
  if (['string', 'boolean'].includes(typeof value)) return typeof value;
  if (isPlainObject(value)) return 'object';
  throw new TypeError(`const has unsupported type: ${typeof value}`);
}

function inferEnumType(values, context) {
  if (!Array.isArray(values) || values.length === 0) {
    throw schemaError('enum must be a non-empty array', context);
  }
  const types = [...new Set(values.map(value => {
    try { return inferTypeFromConst(value); }
    catch { throw schemaError('enum contains a non-JSON value', context); }
  }))];
  if (types.some(type => type === 'array' || type === 'object')) {
    throw schemaError('enum with object or array values is not supported', context);
  }
  return types.length === 1 ? types[0] : types;
}

function adaptNode(input, context, { root = false } = {}) {
  if (!isPlainObject(input)) throw schemaError('schema node must be an object', context);
  const node = {};
  for (const [key, value] of Object.entries(input)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue;
    if (UNSUPPORTED_KEYWORDS.has(key)) {
      throw schemaError(`${key} is not supported by Codex Structured Outputs`, context);
    }
    if (!ALLOWED_KEYWORDS.has(key) && key !== 'oneOf') {
      throw schemaError(`${key} is not a supported schema keyword`, context);
    }
    node[key] = structuredClone(value);
  }

  if (node.oneOf !== undefined) {
    if (node.anyOf !== undefined) throw schemaError('oneOf and anyOf cannot be combined', context);
    node.anyOf = node.oneOf;
    delete node.oneOf;
  }
  if (node.const !== undefined && node.type === undefined) {
    try { node.type = inferTypeFromConst(node.const); }
    catch { throw schemaError('const requires an explicit JSON-compatible type', context); }
  }
  if (node.enum !== undefined && node.type === undefined) node.type = inferEnumType(node.enum, context);
  if (node.properties !== undefined && node.type === undefined) node.type = 'object';
  if (node.items !== undefined && node.type === undefined) node.type = 'array';

  if (node.type !== undefined) {
    const declared = Array.isArray(node.type) ? node.type : [node.type];
    if (!declared.length || declared.some(type => !JSON_TYPES.has(type))
      || new Set(declared).size !== declared.length) {
      throw schemaError('type must contain unique supported JSON types', context);
    }
    if (node.const !== undefined) {
      let constType;
      try { constType = inferTypeFromConst(node.const); }
      catch { throw schemaError('const requires a JSON-compatible value', context); }
      if (!declared.includes(constType) && !(constType === 'number' && declared.includes('integer')
        && Number.isInteger(node.const))) {
        throw schemaError('const value does not match its declared type', context);
      }
    }
  } else if (node.$ref === undefined && node.anyOf === undefined) {
    throw schemaError('schema node requires type, $ref, const, enum, or anyOf', context);
  }

  if (node.anyOf !== undefined) {
    if (!Array.isArray(node.anyOf) || node.anyOf.length === 0) {
      throw schemaError('anyOf must be a non-empty array', context);
    }
    node.anyOf = node.anyOf.map((value, index) => adaptNode(value, {
      ...context, schemaPath: `${context.schemaPath}.anyOf[${index}]`,
    }));
  }
  if (node.$defs !== undefined) {
    if (!isPlainObject(node.$defs)) throw schemaError('$defs must be an object', context);
    node.$defs = Object.fromEntries(Object.entries(node.$defs).map(([name, value]) => [name,
      adaptNode(value, { ...context, schemaPath: `${context.schemaPath}.$defs.${name}` })]));
  }

  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  if (types.includes('object')) {
    if (!isPlainObject(node.properties)) {
      throw schemaError('object schema requires properties', context);
    }
    node.properties = Object.fromEntries(Object.entries(node.properties).map(([name, value]) => [name,
      adaptNode(value, { ...context, schemaPath: `${context.schemaPath}.properties.${name}` })]));
    if (!Array.isArray(node.required)) throw schemaError('object schema requires required', context);
    const propertyNames = Object.keys(node.properties);
    const missing = propertyNames.filter(name => !node.required.includes(name));
    const unknown = node.required.filter(name => !Object.hasOwn(node.properties, name));
    if (missing.length || unknown.length) {
      throw schemaError(`required must contain every property exactly (${[...missing, ...unknown].join(', ')})`,
        context);
    }
    if (node.additionalProperties !== false) {
      throw schemaError('object schema requires additionalProperties: false', context);
    }
  }
  if (types.includes('array')) {
    if (!isPlainObject(node.items)) throw schemaError('array schema requires object items', context);
    node.items = adaptNode(node.items, { ...context, schemaPath: `${context.schemaPath}.items` });
  }
  if (root && (node.type !== 'object' || node.anyOf !== undefined)) {
    throw schemaError('root schema must be an object and cannot use top-level anyOf', context);
  }
  return node;
}

export function adaptCodexOutputSchema(canonicalSchema, {
  schemaName = 'unknown', phase = 'GENERATING_SCENARIO',
} = {}) {
  try {
    return adaptNode(canonicalSchema, { schemaName, schemaPath: '$', phase }, { root: true });
  } catch (error) {
    if (error instanceof CodexOutputSchemaError) {
      error.phase = phase;
      throw error;
    }
    throw new CodexOutputSchemaError('Codex出力Schemaの変換に失敗しました。', {
      phase, schemaName, details: 'Schema conversion failed.', cause: error,
    });
  }
}

export function assertCodexOutputSchema(schema, options = {}) {
  adaptCodexOutputSchema(schema, options);
  return true;
}
