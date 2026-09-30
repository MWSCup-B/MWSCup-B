import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAttackGraphs } from '../server/generation/attack-graph.js';
import { loadCatalog, sources } from '../server/generation/catalog.js';
import {
  SCENARIO_PROMPT_TEMPLATE,
  buildScenarioGenerationInputs,
  importScenarioPackage,
  validateScenarioFeedback,
  validateScenarioGenerationInput,
  validateScenarioImportResult,
} from '../server/generation/scenario-interface.js';

const definitions = await loadCatalog();
const [network, context, candidate] = await Promise.all(['network', 'scenario-context', 'candidate'].map(async name =>
  JSON.parse(await readFile(new URL(`./fixtures/attack-catalog/${name}.json`, import.meta.url), 'utf8'))));

function sourceInput() {
  return { definitions: structuredClone(definitions), network: structuredClone(network),
    context: structuredClone(context), candidate: structuredClone(candidate) };
}

function generationInputs(input = sourceInput()) {
  return buildScenarioGenerationInputs({ ...input, attackGraphResult: buildAttackGraphs(input) });
}

function scenarioPackage(input, suffix = 'fixture') {
  const graph = input.technicalInput.attackGraph;
  const scenarioId = `scenario_external_${suffix}`;
  const ref = { ...input.attackGraphRef };
  const technicalFacts = [
    ...graph.nodes.map(node => ({ factId: `fact_${node.nodeId}`, sourceType: 'ATTACK_NODE',
      attackNodeId: node.nodeId, sourceId: node.nodeId })),
    ...graph.edges.map(edge => ({ factId: `fact_${edge.edgeId}`, sourceType: 'ATTACK_EDGE',
      attackNodeId: null, sourceId: edge.edgeId })),
  ];
  const predecessors = new Map(graph.nodes.map(node => [node.nodeId, new Set()]));
  for (const relation of [...graph.edges.map(edge => ({ before: edge.from, after: edge.to })),
    ...graph.executionConstraints]) predecessors.get(relation.after).add(relation.before);
  const ranks = new Map();
  const rank = nodeId => {
    if (!ranks.has(nodeId)) ranks.set(nodeId, predecessors.get(nodeId).size
      ? Math.max(...[...predecessors.get(nodeId)].map(previous => rank(previous) + 1)) : 0);
    return ranks.get(nodeId);
  };
  const events = graph.nodes.map(node => ({
    eventId: `event_${node.nodeId}`, order: rank(node.nodeId), attackNodeId: node.nodeId,
    dependsOn: [...predecessors.get(node.nodeId)].map(id => `event_${id}`).sort(),
  }));
  const characters = {
    schemaVersion: '1.0', characterSetId: `characters_${suffix}`, scenarioId, attackGraphRef: ref,
    characters: [{ characterId: `character_${suffix}`, displayName: '調査対象者',
      provenance: 'AI_GENERATED_SYNTHETIC', roles: ['defendant'], bindingRefs: [] }],
  };
  const groundTruth = {
    schemaVersion: '1.0', groundTruthId: `ground_truth_${suffix}`, scenarioId, attackGraphRef: ref,
    technicalFacts, characterFactRefs: [{ characterId: `character_${suffix}`, role: 'defendant' }],
  };
  const timeline = {
    schemaVersion: '1.0', timelineId: `timeline_${suffix}`, scenarioId, attackGraphRef: ref,
    events, narrativeTimestamps: [],
  };
  const learningObjectives = {
    schemaVersion: '1.0', learningObjectiveSetId: `objectives_${suffix}`, scenarioId,
    attackGraphRef: ref, objectives: [],
  };
  const evidenceRequirements = {
    schemaVersion: '1.0', evidenceRequirementSetId: `requirements_${suffix}`, scenarioId,
    attackGraphRef: ref, requirements: [],
  };
  return {
    schemaVersion: '1.0',
    generationInputRef: { generationInputId: input.generationInputId,
      inputDigest: ref.inputDigest, graphId: ref.graphId },
    scenarioDraft: {
      schemaVersion: '1.0', scenarioId, state: 'DRAFT', attackGraphRef: ref,
      groundTruthId: groundTruth.groundTruthId, characterSetId: characters.characterSetId,
      timelineId: timeline.timelineId, learningObjectiveSetId: learningObjectives.learningObjectiveSetId,
      evidenceRequirementSetId: evidenceRequirements.evidenceRequirementSetId,
    },
    groundTruth, characters, timeline, learningObjectives, evidenceRequirements,
  };
}

function condition(predicate) {
  return { source: 'otherConditions', predicate, args: ['$target'], value: true,
    description: `${predicate}の合成条件` };
}

function definition(id, prerequisites, effects) {
  return {
    schemaVersion: '1.0', id, label: id, description: '複数graphテスト用定義', category: 'test',
    bindings: [{ id: 'target', kind: 'node' }], targetTypes: [], platforms: [], requiredServices: [],
    prerequisites: prerequisites.map(condition), requiredPrivileges: [], requiredReachability: [],
    effects: effects.map(condition), observableArtifacts: [], relatedAttackPatterns: [],
    references: [{ id: 'synthetic_reference', title: '合成テスト資料',
      url: 'https://example.invalid/scenario-interface-test', supports: '実在攻撃の根拠ではない。' }],
  };
}

function multipleGraphInput() {
  const attackDefinitions = [definition('alpha', ['ready'], ['shared']),
    definition('beta', ['ready'], ['shared']), definition('gamma', ['shared'], ['done'])];
  return {
    definitions: attackDefinitions,
    network: {
      schemaVersion: '1.0', nodes: [{ id: 'host', type: 'endpoint', roles: ['test'], os: 'linux',
        trustZone: 'test' }], services: [], trustZones: [{ id: 'test', label: '合成境界' }],
      connections: [], reachability: [],
    },
    context: {
      schemaVersion: '1.0', entities: [], ...Object.fromEntries(sources.map(source => [source, []])),
      otherConditions: [{ predicate: 'ready', args: ['host'], value: true }],
    },
    candidate: {
      schemaVersion: '1.0', selectedAttackIds: attackDefinitions.map(item => item.id),
      assignments: attackDefinitions.map(item => ({ attackId: item.id,
        bindings: [{ name: 'target', entityId: 'host' }] })),
    },
  };
}

test('Prompt Templateが外部Codexへ技術境界と構造化JSON出力を指示する', () => {
  assert.match(SCENARIO_PROMPT_TEMPLATE, /Attack Graph/);
  assert.match(SCENARIO_PROMPT_TEMPLATE, /AI_GENERATED_SYNTHETIC/);
  assert.match(SCENARIO_PROMPT_TEMPLATE, /証拠本文は生成しない/);
  assert.match(SCENARIO_PROMPT_TEMPLATE, /JSONオブジェクトを1件だけ/);
  assert.doesNotMatch(SCENARIO_PROMPT_TEMPLATE, /APIキー|Model ID|Bearer/);
});

test('各Attack Graphから独立したprovider非依存Generation Inputを構築する', () => {
  const input = multipleGraphInput();
  const result = buildAttackGraphs(input);
  assert.equal(result.graphs.length, 2);
  const generated = buildScenarioGenerationInputs({ ...input, attackGraphResult: result });
  assert.equal(generated.length, 2);
  assert.equal(new Set(generated.map(item => item.attackGraphRef.graphId)).size, 2);
  generated.forEach((item, index) => {
    assert.equal(item.generatorMode, 'EXTERNAL_USER_CODEX');
    assert.deepEqual(item.technicalInput.attackGraph.selectedAttackIds, item.selectedAttackIds);
    assert.ok(!Object.hasOwn(item, 'provider') && !Object.hasOwn(item, 'modelId')
      && !Object.hasOwn(item, 'apiKey'));
    assert.equal(item.outputContract.artifactSchemas.length, 6);
    assert.equal(item.outputContract.packageSchema.title,
      'External Scenario Import Package v1 (Backend internal)');
    assert.equal(validateScenarioGenerationInput(item), item);
    assert.equal(importScenarioPackage({ generationInput: item,
      scenarioPackage: scenarioPackage(item, `multiple_${index}`) }).status, 'VALID');
  });
  const mixed = importScenarioPackage({ generationInput: generated[1],
    scenarioPackage: scenarioPackage(generated[0], 'cross_graph') });
  assert.equal(mixed.status, 'INVALID');
  assert.equal(mixed.errors[0].code, 'GENERATION_INPUT_REFERENCE_MISMATCH');
});

test('外部生成PackageをSchema Validation後にConsistency ValidationしてVALIDにする', () => {
  const input = generationInputs()[0];
  const external = scenarioPackage(input);
  const before = structuredClone(external);
  const result = importScenarioPackage({ generationInput: input, scenarioPackage: external });
  assert.equal(result.status, 'VALID');
  assert.equal(result.valid, true);
  assert.deepEqual(result.validationStages, { schema: 'PASSED', consistency: 'PASSED' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.feedback, null);
  assert.equal(validateScenarioImportResult(result), result);
  assert.deepEqual(external, before);
});

test('Schema違反をINVALIDとしConsistency Validationを実行しない', () => {
  const input = generationInputs()[0];
  const external = scenarioPackage(input);
  external.scenarioDraft.narrative = 'Schema外の自由文';
  const result = importScenarioPackage({ generationInput: input, scenarioPackage: external });
  assert.equal(result.status, 'INVALID');
  assert.deepEqual(result.validationStages, { schema: 'FAILED', consistency: 'NOT_RUN' });
  assert.equal(result.errors[0].code, 'UNKNOWN_FIELD');
  assert.ok(result.errors[0].field && result.errors[0].reason && result.errors[0].correctionHint);
  assert.equal(validateScenarioFeedback(result.feedback), result.feedback);
});

test('Schema適合後のGround Truth不足をConsistency INVALIDとしてFeedbackへ保持する', () => {
  const input = generationInputs()[0];
  const external = scenarioPackage(input);
  external.groundTruth.technicalFacts = external.groundTruth.technicalFacts
    .filter((item, index) => item.sourceType !== 'ATTACK_NODE' || index !== 0);
  const result = importScenarioPackage({ generationInput: input, scenarioPackage: external });
  assert.equal(result.status, 'INVALID');
  assert.deepEqual(result.validationStages, { schema: 'PASSED', consistency: 'FAILED' });
  assert.equal(result.errors[0].code, 'UNGROUNDED_GROUND_TRUTH');
  assert.deepEqual(result.feedback.errors, result.errors);
});

test('別graphの混入と非synthetic人物をINVALIDにする', () => {
  const input = generationInputs()[0];
  const mixed = scenarioPackage(input, 'mixed');
  mixed.scenarioDraft.attackGraphRef.graphId = 'graph_other';
  assert.equal(importScenarioPackage({ generationInput: input, scenarioPackage: mixed })
    .errors[0].code, 'GRAPH_NOT_FOUND');

  const real = scenarioPackage(input, 'real');
  real.characters.characters[0].provenance = 'USER_PROVIDED';
  const result = importScenarioPackage({ generationInput: input, scenarioPackage: real });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.errors[0].code, 'NON_SYNTHETIC_CHARACTER');
});

test('Generation InputのNetwork・Context・Graph差し替えを拒否する', () => {
  const changedNetwork = structuredClone(generationInputs()[0]);
  changedNetwork.technicalInput.network.nodes[0].roles.push('invented_role');
  assert.throws(() => validateScenarioGenerationInput(changedNetwork), { code: 'GENERATION_SOURCE_MISMATCH' });

  const changedGraph = structuredClone(generationInputs()[0]);
  changedGraph.technicalInput.attackGraph.nodes[0].evaluations[0].state = 'UNKNOWN';
  assert.throws(() => validateScenarioGenerationInput(changedGraph), { code: 'GENERATION_SOURCE_MISMATCH' });
});

test('Import ResultとFeedbackの参照・検証段階の矛盾を拒否する', () => {
  const input = generationInputs()[0];
  const external = scenarioPackage(input);
  external.scenarioDraft.narrative = 'Schema外の自由文';
  const result = importScenarioPackage({ generationInput: input, scenarioPackage: external });
  const wrongRef = structuredClone(result);
  wrongRef.feedback.generationInputRef.graphId = 'graph_other';
  assert.throws(() => validateScenarioImportResult(wrongRef), { code: 'INVALID_IMPORT_RESULT' });
  const wrongStage = structuredClone(result);
  wrongStage.validationStages.consistency = 'FAILED';
  assert.throws(() => validateScenarioImportResult(wrongStage), { code: 'INVALID_IMPORT_RESULT' });
});
