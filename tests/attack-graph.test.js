import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCatalog, sources } from '../server/generation/catalog.js';
import { buildAttackGraphs, validateAttackGraph, validateAttackGraphResult } from '../server/generation/attack-graph.js';

const initialDefinitions = await loadCatalog();
const initialFiles = await Promise.all(['network', 'scenario-context', 'candidate'].map(async name =>
  JSON.parse(await readFile(new URL(`./fixtures/attack-catalog/${name}.json`, import.meta.url), 'utf8'))));

function initialInput(ids = ['sql_injection', 'reflected_xss', 'phishing']) {
  const [network, context, candidate] = structuredClone(initialFiles);
  candidate.selectedAttackIds = ids;
  candidate.assignments = candidate.assignments.filter(item => ids.includes(item.attackId));
  return { definitions: structuredClone(initialDefinitions), network, context, candidate };
}

function condition(predicate, value = true) {
  return { source: 'otherConditions', predicate, args: ['$target'], value, description: `${predicate}の合成条件` };
}

function definition(id, prerequisites, effects) {
  return {
    schemaVersion: '1.0', id, label: id, description: 'Attack Graphテスト用の合成定義', category: 'test',
    bindings: [{ id: 'target', kind: 'node' }], targetTypes: [], platforms: [], requiredServices: [],
    prerequisites: prerequisites.map(item => condition(...[item].flat())), requiredPrivileges: [],
    requiredReachability: [], effects: effects.map(item => condition(...[item].flat())),
    observableArtifacts: [], relatedAttackPatterns: [],
    references: [{ id: 'synthetic_reference', title: '合成テスト資料',
      url: 'https://example.invalid/attack-graph-test', supports: '実在攻撃の根拠ではない。' }],
  };
}

function syntheticInput(definitions, facts = [{ predicate: 'ready', args: ['host'], value: true }]) {
  return {
    definitions,
    network: {
      schemaVersion: '1.0',
      nodes: [{ id: 'host', type: 'endpoint', roles: ['test'], os: 'linux', trustZone: 'test' }],
      services: [], trustZones: [{ id: 'test', label: '合成テスト境界' }],
      connections: [], reachability: [],
    },
    context: {
      schemaVersion: '1.0', entities: [], ...Object.fromEntries(sources.map(source => [source, []])),
      otherConditions: facts,
    },
    candidate: {
      schemaVersion: '1.0', selectedAttackIds: definitions.map(item => item.id),
      assignments: definitions.map(item => ({ attackId: item.id,
        bindings: [{ name: 'target', entityId: 'host' }] })),
    },
  };
}

test('初期3種類から根拠付きMIXED graphを構築し、SQL injectionを無理に接続しない', () => {
  const input = initialInput();
  const before = structuredClone(input);
  const result = buildAttackGraphs(input);
  assert.equal(result.status, 'CREATED');
  assert.equal(result.evaluationState, 'SATISFIED');
  assert.equal(result.graphs.length, 1);
  assert.deepEqual(result.issues, []);
  const graph = result.graphs[0];
  assert.equal(graph.structure, 'MIXED');
  assert.deepEqual(graph.rootNodeIds, ['attack_phishing', 'attack_sql_injection']);
  assert.deepEqual(graph.leafNodeIds, ['attack_reflected_xss', 'attack_sql_injection']);
  assert.deepEqual(graph.components, [
    { componentId: 'component_1', structure: 'LINEAR', nodeIds: ['attack_phishing', 'attack_reflected_xss'] },
    { componentId: 'component_2', structure: 'SINGLE', nodeIds: ['attack_sql_injection'] },
  ]);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual([graph.edges[0].from, graph.edges[0].to], ['attack_phishing', 'attack_reflected_xss']);
  assert.deepEqual(graph.edges[0].matchedFact, {
    source: 'otherConditions', predicate: 'browser_request_issued',
    args: ['user-a', 'browser-service', 'web-service', 'link-request'], value: true,
  });
  assert.equal(graph.edges[0].grounds.matchType, 'EXACT_FACT_AND_VALUE');
  assert.equal(graph.sourcePlanOrders.length, 3);
  assert.ok(graph.nodes.every(node => node.state === 'SATISFIED'
    && node.evaluations.every(evaluation => evaluation.state === 'SATISFIED' && evaluation.sourceRef)
    && node.referenceIds.length));
  assert.deepEqual(input, before);
});

test('同じ因果構造を異なる成立順序から重複生成しない', () => {
  const first = buildAttackGraphs(initialInput());
  const reordered = initialInput(['phishing', 'sql_injection', 'reflected_xss']);
  reordered.candidate.assignments.reverse();
  const second = buildAttackGraphs(reordered);
  assert.equal(first.graphs.length, 1);
  assert.equal(second.graphs.length, 1);
  assert.equal(first.graphs[0].graphId, second.graphs[0].graphId);
  assert.deepEqual(first.graphs[0].edges, second.graphs[0].edges);
});

test('一本道・分岐・合流・独立nodeを因果edgeから分類する', () => {
  const cases = [
    {
      expected: 'LINEAR',
      definitions: [definition('alpha', ['ready'], ['middle']), definition('beta', ['middle'], ['done'])],
    },
    {
      expected: 'BRANCHING',
      definitions: [definition('alpha', ['ready'], ['shared']), definition('beta', ['shared'], ['b']),
        definition('gamma', ['shared'], ['c'])],
    },
    {
      expected: 'JOIN',
      definitions: [definition('alpha', ['ready'], ['a']), definition('beta', ['ready'], ['b']),
        definition('gamma', ['a', 'b'], ['c'])],
    },
    {
      expected: 'PARALLEL',
      definitions: [definition('alpha', ['ready'], ['a']), definition('beta', ['ready'], ['b']),
        definition('gamma', ['ready'], ['c'])],
    },
  ];
  for (const { expected, definitions } of cases) {
    definitions[0].relatedAttackPatterns = definitions.slice(1).map(item => item.id);
    const result = buildAttackGraphs(syntheticInput(definitions));
    assert.equal(result.status, 'CREATED', JSON.stringify(result.issues));
    assert.equal(result.graphs.length, 1);
    assert.equal(result.graphs[0].structure, expected);
  }
});

test('複数producerが同じ不足条件を満たせる場合は異なるgraph候補を保持する', () => {
  const definitions = [definition('alpha', ['ready'], ['shared']), definition('beta', ['ready'], ['shared']),
    definition('gamma', ['shared'], ['done'])];
  const result = buildAttackGraphs(syntheticInput(definitions));
  assert.equal(result.status, 'CREATED');
  assert.equal(result.graphs.length, 2);
  assert.deepEqual(result.graphs.map(graph => graph.edges.map(edge => [edge.from, edge.to])).sort(), [
    [['attack_alpha', 'attack_gamma']],
    [['attack_beta', 'attack_gamma']],
  ].sort());
});

test('状態競合の順序制約を因果edgeに昇格させない', () => {
  const definitions = [definition('alpha', ['ready'], ['shared']), definition('beta', ['ready'], [['ready', false]])];
  const result = buildAttackGraphs(syntheticInput(definitions));
  assert.equal(result.status, 'CREATED');
  assert.equal(result.graphs[0].structure, 'PARALLEL');
  assert.deepEqual(result.graphs[0].edges, []);
  assert.deepEqual(result.graphs[0].executionConstraints.map(item => [item.before, item.after]),
    [['attack_alpha', 'attack_beta']]);
});

test('falseのeffectとfalseのprerequisiteも値の完全一致でedgeにする', () => {
  const definitions = [definition('alpha', ['ready'], [['flag', false]]),
    definition('beta', [['flag', false]], ['done'])];
  const result = buildAttackGraphs(syntheticInput(definitions));
  assert.equal(result.status, 'CREATED');
  assert.equal(result.graphs[0].edges[0].matchedFact.value, false);
});

test('必須条件のUNKNOWNとUNSATISFIEDをgraphなしのBLOCKEDとして返す', () => {
  for (const [facts, expectedState, expectedCode] of [
    [[], 'UNKNOWN', 'REQUIRED_CONDITION_UNKNOWN'],
    [[{ predicate: 'ready', args: ['host'], value: false }], 'UNSATISFIED', 'REQUIRED_CONDITION_UNSATISFIED'],
  ]) {
    const result = buildAttackGraphs(syntheticInput([definition('alpha', ['ready'], ['done'])], facts));
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.evaluationState, expectedState);
    assert.deepEqual(result.graphs, []);
    assert.ok(result.issues.some(issue => issue.code === expectedCode));
  }
});

test('到達性のUNKNOWNと拒否を区別してgraph生成を停止する', () => {
  for (const [mode, expectedState, expectedCode] of [
    ['missing', 'UNKNOWN', 'REACHABILITY_UNKNOWN'],
    ['false', 'UNSATISFIED', 'REACHABILITY_DENIED'],
  ]) {
    const input = initialInput(['sql_injection']);
    const index = input.network.reachability.findIndex(item => item.from === 'web-host' && item.toService === 'db-service');
    if (mode === 'missing') input.network.reachability.splice(index, 1);
    else input.network.reachability[index].value = false;
    const result = buildAttackGraphs(input);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.evaluationState, expectedState);
    assert.ok(result.issues.some(issue => issue.code === expectedCode));
  }
});

test('循環する未実行effectを相互補完せず、入力不正と条件不明を区別する', () => {
  const cycle = syntheticInput([definition('alpha', ['b'], ['a']), definition('beta', ['a'], ['b'])], []);
  const blocked = buildAttackGraphs(cycle);
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.evaluationState, 'UNKNOWN');
  const invalid = syntheticInput([definition('alpha', ['ready'], ['done'])]);
  invalid.candidate.selectedAttackIds.push('missing');
  const invalidResult = buildAttackGraphs(invalid);
  assert.equal(invalidResult.status, 'BLOCKED');
  assert.equal(invalidResult.evaluationState, null);
  assert.ok(invalidResult.issues.some(issue => issue.category === 'INVALID_INPUT'));
});

test('Attack Graphの参照切れ・形状改変・未知フィールドを拒否する', () => {
  const graph = buildAttackGraphs(initialInput()).graphs[0];
  const brokenEdge = structuredClone(graph);
  brokenEdge.edges[0].effectId = 'missing_effect';
  assert.throws(() => validateAttackGraph(brokenEdge), { code: 'BROKEN_GRAPH_GROUND' });
  const brokenShape = structuredClone(graph);
  brokenShape.structure = 'LINEAR';
  assert.throws(() => validateAttackGraph(brokenShape), { code: 'INVALID_GRAPH_SHAPE' });
  const unknown = structuredClone(graph);
  unknown.groundTruth = 'should-not-exist';
  assert.throws(() => validateAttackGraph(unknown), { code: 'UNKNOWN_FIELD' });
  const invalidNode = structuredClone(graph);
  invalidNode.nodes[0].evaluations[0].state = 'UNKNOWN';
  assert.throws(() => validateAttackGraph(invalidNode), { code: 'INVALID_NODE_STATE' });
});

test('結果エンベロープの成功・停止状態の矛盾を拒否する', () => {
  const result = buildAttackGraphs(initialInput());
  const inconsistent = structuredClone(result);
  inconsistent.status = 'BLOCKED';
  assert.throws(() => validateAttackGraphResult(inconsistent), { code: 'INVALID_GRAPH_RESULT' });
});

test('未登録の新しいAttack DefinitionもJSON構造だけでgraph化できる', () => {
  const input = syntheticInput([definition('extension_a', ['ready'], ['extension_fact']),
    definition('extension_b', ['extension_fact'], ['done'])]);
  const result = buildAttackGraphs(input);
  assert.equal(result.status, 'CREATED');
  assert.deepEqual(result.graphs[0].edges.map(edge => [edge.from, edge.to]),
    [['attack_extension_a', 'attack_extension_b']]);
});
