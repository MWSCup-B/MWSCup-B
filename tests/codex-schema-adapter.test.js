import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptCodexOutputSchema, assertCodexOutputSchema }
  from '../server/codex/codex-schema-adapter.js';
import { AUTO_CODEX_OUTPUT_SCHEMAS }
  from '../server/codex/auto-output-schemas.js';
import { normalizeAutoCodexOutput } from '../server/codex/auto-output-schemas.js';
import { readFile } from 'node:fs/promises';
import { CodexJsonRunner } from '../server/codex/codex-json-runner.js';

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
  ['scenarioRevision', 'scenario-revision'],
  ['review', 'scenario-verification-review'],
  ['evidence', 'evidence-import-package'],
  ['evidenceDraft', 'evidence-generation-draft'],
  ['evidenceReview', 'evidence-semantic-review'],
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

test('caseFactsは内部Scenario設定に限り、プレイヤー向けEvidence契約からcaseSupportを除く', async () => {
  const groundTruth = JSON.parse(await readFile(new URL('../schemas/ground-truth.schema.json', import.meta.url), 'utf8'));
  const artifact = JSON.parse(await readFile(new URL('../schemas/evidence-artifact.schema.json', import.meta.url), 'utf8'));
  assert.equal(groundTruth.required.includes('caseFacts'), false);
  assert.equal(groundTruth.properties.caseFacts.type, 'array');
  assert.equal(artifact.required.includes('caseSupport'), false);
  assert.equal(Object.hasOwn(artifact.properties, 'caseSupport'), false);
  const outputTruth = AUTO_CODEX_OUTPUT_SCHEMAS.scenario.canonicalSchema.properties.groundTruth;
  assert.ok(outputTruth.required.includes('caseFacts'));
  assert.deepEqual(outputTruth.properties.caseFacts.type, ['array', 'null']);
  for (const kind of ['evidence', 'evidenceDraft']) {
    const outputArtifact = AUTO_CODEX_OUTPUT_SCHEMAS[kind].canonicalSchema.properties.evidenceArtifacts.items;
    assert.ok(!outputArtifact.required.includes('caseSupport'));
    assert.equal(Object.hasOwn(outputArtifact.properties, 'caseSupport'), false);
  }
});

test('CLIは内部Scenarioの省略nullのみ除去し、プレイヤーEvidenceの未知caseSupportを黙って除去しない', async () => {
  const parse = async (data, outputSchemaName) => new CodexJsonRunner({ run: async () => JSON.stringify(data) })
    .runJson({ instruction: '', data: {}, outputSchemaName, phase: 'GENERATING_EVIDENCE' });
  const scenario = { groundTruth: { caseFacts: null, incidentNarratives: null, technicalFacts: [] } };
  assert.deepEqual(await parse(scenario, 'scenario-import-package'),
    { groundTruth: { incidentNarratives: null, technicalFacts: [] } });
  assert.equal(scenario.groundTruth.caseFacts, null);
  const evidence = { evidenceArtifacts: [{ caseSupport: null, publicContent: '{"caseSupport":null}', testimony: null }] };
  assert.deepEqual(normalizeAutoCodexOutput(evidence, 'evidence-generation-draft'), evidence);
  assert.deepEqual(await parse(evidence, 'unknown-contract'), evidence);
  assert.deepEqual(await parse({ groundTruth: { caseFacts: [] } }, 'scenario-import-package'), { groundTruth: { caseFacts: [] } });
  assert.equal(evidence.evidenceArtifacts[0].caseSupport, null);
});
