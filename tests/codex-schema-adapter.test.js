import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptCodexOutputSchema, assertCodexOutputSchema }
  from '../server/codex/codex-schema-adapter.js';
import { AUTO_CODEX_OUTPUT_SCHEMAS }
  from '../server/codex/auto-output-schemas.js';

function root(propertySchema) {
  return { type: 'object', properties: { value: propertySchema },
    required: ['value'], additionalProperties: false };
}

test('const string without typeからstringを推定する', () => {
  assert.deepEqual(adaptCodexOutputSchema(root({ const: '1.0' })).properties.value,
    { const: '1.0', type: 'string' });
});

test('const number without typeからnumberを推定する', () => {
  assert.deepEqual(adaptCodexOutputSchema(root({ const: 1 })).properties.value,
    { const: 1, type: 'number' });
});

test('nested object内のconstを再帰的に変換する', () => {
  const schema = root({ type: 'object', properties: { version: { const: '1.0' } },
    required: ['version'], additionalProperties: false });
  assert.equal(adaptCodexOutputSchema(schema).properties.value.properties.version.type, 'string');
});

test('array items内のconstを再帰的に変換する', () => {
  const schema = root({ type: 'array', items: { const: true } });
  assert.equal(adaptCodexOutputSchema(schema).properties.value.items.type, 'boolean');
});

test('$defs内のconstと$refを変換・保持する', () => {
  const schema = { ...root({ $ref: '#/$defs/version' }),
    $defs: { version: { const: '1.0' } } };
  const output = adaptCodexOutputSchema(schema);
  assert.equal(output.$defs.version.type, 'string');
  assert.equal(output.properties.value.$ref, '#/$defs/version');
});

test('既にtypeがあるconstを変更しすぎない', () => {
  const property = { type: 'string', const: '1.0', description: 'version' };
  assert.deepEqual(adaptCodexOutputSchema(root(property)).properties.value, property);
});

test('canonical schema object自体をmutationしない', () => {
  const schema = root({ const: '1.0' }); const before = structuredClone(schema);
  adaptCodexOutputSchema(schema); assert.deepEqual(schema, before);
  assert.equal(schema.properties.value.type, undefined);
});

for (const [key, expectedName] of [
  ['scenario', 'scenario-import-package'],
  ['review', 'scenario-verification-review'],
  ['evidence', 'evidence-import-package'],
]) {
  test(`${expectedName}のCLI専用Schemaを全体変換できる`, () => {
    const source = AUTO_CODEX_OUTPUT_SCHEMAS[key];
    const output = adaptCodexOutputSchema(source.canonicalSchema, { schemaName: source.name });
    assert.equal(output.type, 'object');
    assert.equal(output.properties.schemaVersion.type, 'string');
    assert.equal(assertCodexOutputSchema(output, { schemaName: source.name }), true);
  });
}

test('nullableはnullを含むtype unionのまま保持する', () => {
  const output = adaptCodexOutputSchema(root({ type: ['string', 'null'] }));
  assert.deepEqual(output.properties.value.type, ['string', 'null']);
  assert.deepEqual(adaptCodexOutputSchema(root({ const: null })).properties.value,
    { const: null, type: 'null' });
});

test('oneOfはCodex subsetのanyOfに変換し、allOfはpreflightで拒否する', () => {
  const output = adaptCodexOutputSchema(root({ oneOf: [{ type: 'string' }, { type: 'null' }] }));
  assert.equal(output.properties.value.oneOf, undefined);
  assert.equal(output.properties.value.anyOf.length, 2);
  assert.throws(() => adaptCodexOutputSchema(root({ allOf: [{ type: 'string' }] })),
    error => error.code === 'CODEX_OUTPUT_SCHEMA_INVALID');
});
