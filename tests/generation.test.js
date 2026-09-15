import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateCandidate, compareCondition } from '../server/generation/evaluator.js';
import { loadCatalog, sources, validateCatalog } from '../server/generation/catalog.js';
import { validateDocument } from '../server/generation/schema.js';

// 抽象条件のテスト専用定義。実際の攻撃や教材として登録しない。
function condition(predicate, value = true, source = 'otherConditions') {
  return { source, predicate, args: ['$target'], value, description: `${predicate}の条件確認` };
}
function definition(id, input, output) {
  return {
    schemaVersion: '1.0', id, label: id, category: 'test', description: '検証器の合成fixture',
    bindings: [{ id: 'target', kind: 'node' }], targetTypes: [], platforms: [], requiredServices: [],
    prerequisites: [condition(input)], requiredPrivileges: [], requiredReachability: [],
    effects: [condition(output)], observableArtifacts: [], relatedAttackPatterns: [],
    references: [{ id: 'test', title: '合成fixture', url: 'https://example.invalid/test', supports: 'テスト用。技術的根拠ではない。' }],
  };
}
function fixture(definitions = [definition('alpha', 'ready', 'done')]) {
  return {
    definitions,
    network: {
      schemaVersion: '1.0', nodes: [
        { id: 'host', type: 'endpoint', roles: ['user'], os: 'linux', trustZone: 'internal' },
        { id: 'other', type: 'server', roles: [], os: null, trustZone: 'internal' },
      ],
      services: [{ id: 'web', nodeId: 'other', type: 'web', platform: 'web' }],
      connections: [{ from: 'host', to: 'other' }], trustZones: [{ id: 'internal', label: '合成テスト境界' }],
      reachability: [],
    },
    context: { schemaVersion: '1.0', entities: [], ...Object.fromEntries(sources.map(s => [s, []])),
      otherConditions: [{ predicate: 'ready', args: ['host'], value: true }] },
    candidate: { schemaVersion: '1.0', selectedAttackIds: definitions.map(x => x.id),
      assignments: definitions.map(x => ({ attackId: x.id, bindings: [{ name: 'target', entityId: 'host' }] })) },
  };
}

test('条件は欠落・nullをUNKNOWNとし、明示値だけで真偽判定する', () => {
  assert.equal(compareCondition(undefined, true), 'UNKNOWN');
  assert.equal(compareCondition(null, false), 'UNKNOWN');
  assert.equal(compareCondition(false, false), 'SATISFIED');
  assert.equal(compareCondition(false, true), 'UNSATISFIED');
  const input = fixture();
  assert.equal(evaluateCandidate(input).state, 'SATISFIED');
  input.context.otherConditions = [];
  assert.equal(evaluateCandidate(input).state, 'UNKNOWN');
  input.context.otherConditions = [{ predicate: 'ready', args: ['host'], value: false }];
  const result = evaluateCandidate(input);
  assert.equal(result.state, 'UNSATISFIED');
  assert.equal(result.blocked, true);
  assert.ok(result.issues.every(x => x.code && x.field && x.reason && x.suggestion));
});

test('前段効果が後段の同じ対象の前提を満たす場合だけ因果辺を作る', () => {
  const input = fixture([definition('beta', 'middle', 'done'), definition('alpha', 'ready', 'middle')]);
  const original = structuredClone(input);
  const result = evaluateCandidate(input);
  assert.equal(result.state, 'SATISFIED');
  assert.deepEqual(result.plans[0].order, ['alpha', 'beta']);
  assert.equal(result.plans[0].structure, 'LINEAR');
  assert.deepEqual(result.plans[0].edges.map(x => [x.from, x.to, x.kind]), [['alpha', 'beta', 'ENABLES']]);
  assert.deepEqual(input, original);
  input.candidate.assignments[0].bindings[0].entityId = 'other';
  assert.equal(evaluateCandidate(input).state, 'UNKNOWN');
});

test('分岐・並列・合流を区別し、選択順や関連名だけで一本道にしない', () => {
  const branch = fixture([definition('alpha', 'ready', 'shared'), definition('beta', 'shared', 'b'), definition('gamma', 'shared', 'c')]);
  assert.ok(evaluateCandidate(branch).plans.every(x => x.structure === 'BRANCHING'));
  const parallel = fixture([definition('alpha', 'ready', 'a'), definition('beta', 'ready', 'b'), definition('gamma', 'ready', 'c')]);
  parallel.definitions[0].relatedAttackPatterns = ['beta', 'gamma'];
  const result = evaluateCandidate(parallel);
  assert.equal(result.plans.length, 6);
  assert.ok(result.plans.every(x => x.structure === 'PARALLEL' && x.edges.length === 0));
  const joinInput = fixture([definition('alpha', 'ready', 'a'), definition('beta', 'ready', 'b'), definition('gamma', 'a', 'c')]);
  joinInput.definitions[2].prerequisites.push(condition('b'));
  assert.ok(evaluateCandidate(joinInput).plans.every(x => x.structure === 'JOIN'));
});

test('循環依存・選択の欠落・追加・重複・未登録・4種類以上を拒否する', () => {
  const cycle = fixture([definition('alpha', 'b', 'a'), definition('beta', 'a', 'b')]);
  assert.equal(evaluateCandidate(cycle).blocked, true);
  for (const mutate of [
    x => { x.candidate.assignments.pop(); },
    x => { x.candidate.selectedAttackIds.push('unregistered'); },
    x => { x.candidate.selectedAttackIds.push('alpha'); },
    x => { x.candidate.selectedAttackIds = ['alpha', 'beta', 'gamma', 'delta']; },
    x => { x.candidate.assignments[0].attackId = 'other'; },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(evaluateCandidate(input).blocked, true);
  }
});

test('種類・OS・サービス所属・明示到達制御を評価し接続だけで到達可能にしない', () => {
  const input = fixture();
  const d = input.definitions[0];
  d.bindings.push({ id: 'service', kind: 'service' }, { id: 'server', kind: 'node' });
  input.candidate.assignments[0].bindings.push({ name: 'service', entityId: 'web' }, { name: 'server', entityId: 'other' });
  d.targetTypes = [{ binding: 'target', values: ['endpoint'] }];
  d.platforms = [{ binding: 'target', values: ['linux'] }];
  d.requiredServices = [{ binding: 'service', node: 'server', values: ['web'] }];
  d.requiredReachability = [{ from: 'target', toService: 'service', description: '明示的な到達性' }];
  assert.equal(evaluateCandidate(input).state, 'UNKNOWN');
  input.network.reachability.push({ from: 'host', toService: 'web', value: false });
  assert.equal(evaluateCandidate(input).state, 'UNSATISFIED');
  input.network.reachability[0].value = true;
  assert.equal(evaluateCandidate(input).state, 'SATISFIED');
  input.network.nodes[0].os = null;
  assert.equal(evaluateCandidate(input).state, 'UNKNOWN');
  input.network.nodes[0].os = 'windows';
  assert.equal(evaluateCandidate(input).state, 'UNSATISFIED');
  input.network.nodes[0].os = 'linux';
  d.requiredServices[0].node = 'target';
  assert.equal(evaluateCandidate(input).state, 'UNSATISFIED');
});

test('ログ条件は痕跡の観測可能性として独立評価する', () => {
  const input = fixture();
  input.definitions[0].observableArtifacts = [{ id: 'event', description: '合成イベント', conditions: [condition('enabled', true, 'loggingConfiguration')] }];
  let result = evaluateCandidate(input);
  assert.equal(result.state, 'SATISFIED');
  assert.equal(result.plans[0].reports[0].artifacts[0].state, 'UNKNOWN');
  input.context.loggingConfiguration.push({ predicate: 'enabled', args: ['host'], value: false });
  result = evaluateCandidate(input);
  assert.equal(result.state, 'SATISFIED');
  assert.equal(result.plans[0].reports[0].artifacts[0].state, 'UNSATISFIED');
});

test('読み書きの競合を並列と誤分類しない', () => {
  const input = fixture([definition('alpha', 'ready', 'shared'), definition('beta', 'ready', 'done')]);
  input.definitions[1].effects = [condition('ready', false)];
  const result = evaluateCandidate(input);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].structure, 'LINEAR');
  assert.ok(result.plans[0].edges.some(x => x.kind === 'ORDERING'));
});

test('入力版・不正な参照・矛盾・未対応の条件形式を黙認しない', () => {
  for (const mutate of [
    x => { x.context.schemaVersion = '2.0'; },
    x => { x.context.otherConditions.push({ predicate: 'ready', args: ['host'], value: false }); },
    x => { x.context.otherConditions[0].args = ['missing']; },
    x => { x.network.nodes[0].trustZone = 'missing'; },
    x => { x.network.connections[0].to = 'missing'; },
    x => { x.network.connections = []; x.network.reachability = [{ from: 'host', toService: 'web', value: true }]; },
    x => { x.definitions[0].prerequisites[0].operator = 'eval'; },
    x => { x.definitions[0].effects[0].source = 'vulnerabilities'; },
    x => { x.definitions[0].effects[0].args = ['$undeclared']; },
    x => { x.network.nodes[0].id = 'web'; },
  ]) {
    const input = fixture(); mutate(input);
    const result = evaluateCandidate(input);
    assert.equal(result.blocked, true);
    assert.ok(result.issues.length);
  }
});

test('新しいIDと条件名のJSON追加だけでカタログ読込み・評価できる', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mws-catalog-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const d = definition('extension', 'new_precondition', 'new_effect');
  await writeFile(join(dir, 'extension.json'), JSON.stringify(d));
  const definitions = await loadCatalog(pathToFileURL(dir + '/'));
  const input = fixture(definitions);
  input.context.otherConditions[0].predicate = 'new_precondition';
  assert.equal(evaluateCandidate(input).state, 'SATISFIED');
  assert.throws(() => validateCatalog([d, d]), { code: 'DUPLICATE_ID' });
  await symlink(join(dir, 'extension.json'), join(dir, 'alias.json'));
  await assert.rejects(loadCatalog(pathToFileURL(dir + '/')), { code: 'INVALID_CATALOG_FILE' });
});

test('未知フィールド・過大入力を拒否し、入力変更で検証識別値が変わる', () => {
  const input = fixture();
  const digest = evaluateCandidate(input).inputDigest;
  input.definitions[0].description = '定義を修正';
  assert.notEqual(evaluateCandidate(input).inputDigest, digest);
  const bad = JSON.parse('{"schemaVersion":"1.0","__proto__":{"polluted":true}}');
  assert.throws(() => validateDocument('network', bad));
  assert.equal({}.polluted, undefined);
  input.definitions[0].description = 'x'.repeat(2001);
  assert.equal(evaluateCandidate(input).blocked, true);
});
