import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCandidates, CANDIDATE_SEARCH_LIMIT,
  validateCandidateBuilderResult } from '../server/generation/candidate-builder.js';
import { buildAttackGraphs } from '../server/generation/attack-graph.js';
import { loadCatalog, sources } from '../server/generation/catalog.js';
import { evaluateCandidate } from '../server/generation/evaluator.js';

const initialDefinitions = await loadCatalog();
const [initialNetwork, initialContext, expectedCandidate] = await Promise.all(
  ['network', 'scenario-context', 'candidate'].map(async name => JSON.parse(await readFile(
    new URL(`./fixtures/attack-catalog/${name}.json`, import.meta.url), 'utf8'))),
);

function condition(predicate, args, value = true) {
  return { source: 'otherConditions', predicate, args, value, description: `${predicate}の合成条件` };
}

function definition({ id = 'generic_attack', bindings, prerequisite, effect, ...constraints }) {
  return {
    schemaVersion: '1.0', id, label: id, category: 'test', description: 'Candidate Builderの合成fixture',
    bindings, targetTypes: [], platforms: [], requiredServices: [],
    prerequisites: [prerequisite], requiredPrivileges: [], requiredReachability: [],
    effects: [effect], observableArtifacts: [], relatedAttackPatterns: [],
    references: [{ id: 'test', title: '合成fixture', url: 'https://example.invalid/test',
      supports: 'テスト構造だけを説明し、技術的根拠には使用しない。' }],
    ...constraints,
  };
}

function context(entities, facts = []) {
  return {
    schemaVersion: '1.0', entities,
    ...Object.fromEntries(sources.map(source => [source, []])),
    otherConditions: facts,
  };
}

function network(nodes, services = [], reachability = [], connections = []) {
  return {
    schemaVersion: '1.0', nodes, services,
    trustZones: [{ id: 'zone', label: '合成fixture境界' }], connections, reachability,
  };
}

function node(id, roles = []) {
  return { id, type: 'host', roles, os: 'linux', trustZone: 'zone' };
}

function input(definitions, networkValue, contextValue, selectedAttackIds = definitions.map(item => item.id)) {
  return {
    definitions, network: networkValue, context: contextValue,
    selection: { schemaVersion: '1.0', selectedAttackIds },
  };
}

test('初期3種類の実在対象を割り当て、既存Validatorへ渡せる全candidateを返す', () => {
  const value = {
    definitions: structuredClone(initialDefinitions), network: structuredClone(initialNetwork),
    context: structuredClone(initialContext),
    selection: { schemaVersion: '1.0', selectedAttackIds: [...expectedCandidate.selectedAttackIds] },
  };
  const before = structuredClone(value);
  const result = buildCandidates(value);
  assert.equal(result.status, 'CREATED');
  assert.equal(result.complete, true);
  assert.deepEqual(result.candidates, [expectedCandidate]);
  assert.equal(result.diagnostics.bindingCount, 25);
  assert.ok(result.diagnostics.candidateDomainSizes.every(item => item.size === 1));
  assert.equal(evaluateCandidate({ ...value, candidate: result.candidates[0] }).state, 'SATISFIED');
  assert.equal(buildAttackGraphs({ ...value, candidate: result.candidates[0] }).status, 'CREATED');
  assert.deepEqual(value, before);
  assert.ok(!('groundTruth' in result));
});

test('複数の成立対象を恣意的に1件へ絞らず保持する', () => {
  const d = definition({
    bindings: [{ id: 'target', kind: 'node' }],
    prerequisite: condition('ready', ['$target']), effect: condition('done', ['$target']),
  });
  const n = network([node('host-a'), node('host-b')]);
  const c = context([], [
    { predicate: 'ready', args: ['host-a'], value: true },
    { predicate: 'ready', args: ['host-b'], value: true },
  ]);
  const result = buildCandidates(input([d], n, c));
  assert.equal(result.status, 'CREATED');
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map(candidate => candidate.assignments[0].bindings[0].entityId),
    ['host-a', 'host-b']);
});

test('requiredRolesをALLで照合し、binding名からroleを推測しない', () => {
  const base = definition({
    bindings: [{ id: 'client', kind: 'node' }],
    prerequisite: condition('ready', ['$client']), effect: condition('done', ['$client']),
    requiredRoles: [{ binding: 'client', values: ['workstation', 'managed'] }],
  });
  const n = network([node('both', ['workstation', 'managed']), node('partial', ['workstation'])]);
  const c = context([], [
    { predicate: 'ready', args: ['both'], value: true },
    { predicate: 'ready', args: ['partial'], value: true },
  ]);
  const result = buildCandidates(input([base], n, c));
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].assignments[0].bindings[0].entityId, 'both');

  const manual = structuredClone(result.candidates[0]);
  manual.assignments[0].bindings[0].entityId = 'partial';
  assert.equal(evaluateCandidate({ definitions: [base], network: n, context: c, candidate: manual }).state,
    'UNSATISFIED');

  const noRoleConstraint = structuredClone(base);
  delete noRoleConstraint.requiredRoles;
  assert.equal(buildCandidates(input([noRoleConstraint], n, c)).candidates.length, 2);
});

test('service所属と明示的にtrueの到達性だけを静的候補に使用する', () => {
  const d = definition({
    bindings: [
      { id: 'source', kind: 'node' }, { id: 'host', kind: 'node' }, { id: 'service', kind: 'service' },
    ],
    prerequisite: condition('ready', ['$source']), effect: condition('done', ['$source']),
    requiredServices: [{ binding: 'service', node: 'host', values: ['web'] }],
    requiredReachability: [{ from: 'source', toService: 'service', description: '明示到達性' }],
  });
  const n = network([node('source-a'), node('source-b'), node('host')],
    [{ id: 'web', nodeId: 'host', type: 'web', platform: 'web' }],
    [{ from: 'source-a', toService: 'web', value: true },
      { from: 'source-b', toService: 'web', value: null }],
    [{ from: 'source-a', to: 'host' }]);
  const c = context([], [{ predicate: 'ready', args: ['source-a'], value: true }]);
  const created = buildCandidates(input([d], n, c));
  assert.equal(created.status, 'CREATED');
  assert.equal(created.candidates[0].assignments[0].bindings.find(item => item.name === 'source').entityId,
    'source-a');

  n.reachability[0].value = false;
  const blocked = buildCandidates(input([d], n, c));
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.issues[0].code, 'NO_TARGET_ASSIGNMENT');
  assert.equal(blocked.diagnostics.exploredStates, 0);
  assert.deepEqual(blocked.candidates, []);
});

test('候補数の少ないbindingを先に探索してもcandidate集合を変えない', () => {
  const d = definition({
    bindings: [{ id: 'broad', kind: 'node' }, { id: 'narrow', kind: 'entity' }],
    prerequisite: condition('ready', ['$narrow']), effect: condition('done', ['$broad']),
    targetTypes: [{ binding: 'narrow', values: ['user'] }],
  });
  const n = network(Array.from({ length: 5 }, (_, index) => node(`host-${index}`)));
  const c = context([{ id: 'user', type: 'user' }],
    [{ predicate: 'ready', args: ['user'], value: true }]);
  const result = buildCandidates(input([d], n, c));
  assert.equal(result.candidates.length, 5);
  assert.equal(result.diagnostics.exploredStates, 7);
  assert.ok(result.candidates.every(candidate => candidate.assignments[0].bindings[1].entityId === 'user'));
});

test('探索状態100000件で停止し、途中candidateをすべて破棄する', () => {
  const entities = Array.from({ length: 256 }, (_, index) => ({ id: `entity-${index}`, type: 'item' }));
  const facts = entities.map(entity => ({ predicate: 'paired', args: [entity.id, entity.id], value: true }));
  const d = definition({
    bindings: [
      { id: 'first', kind: 'entity' }, { id: 'second', kind: 'entity' }, { id: 'third', kind: 'entity' },
    ],
    prerequisite: condition('paired', ['$second', '$third']), effect: condition('done', ['$first']),
  });
  const result = buildCandidates(input([d], network([node('host')]), context(entities, facts)));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.complete, false);
  assert.equal(result.issues[0].code, 'CANDIDATE_SEARCH_LIMIT_EXCEEDED');
  assert.equal(result.diagnostics.exploredStates, CANDIDATE_SEARCH_LIMIT);
  assert.equal(result.diagnostics.searchLimit, 100_000);
  assert.equal(result.diagnostics.bindingCount, 3);
  assert.deepEqual(result.diagnostics.candidateDomainSizes.map(item => item.size), [256, 256, 256]);
  assert.deepEqual(result.candidates, []);
});

test('未登録攻撃と結果状態の矛盾を機械可読なエラーで拒否する', () => {
  const d = definition({
    bindings: [{ id: 'target', kind: 'node' }],
    prerequisite: condition('ready', ['$target']), effect: condition('done', ['$target']),
  });
  const result = buildCandidates(input([d], network([node('host')]), context([], []), ['missing']));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.complete, false);
  assert.equal(result.issues[0].code, 'UNREGISTERED_ATTACK');

  const invalid = structuredClone(result);
  invalid.status = 'CREATED';
  assert.throws(() => validateCandidateBuilderResult(invalid), { code: 'INVALID_RESULT_STATE' });
});
