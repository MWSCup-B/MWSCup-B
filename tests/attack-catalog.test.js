import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCatalog } from '../server/generation/catalog.js';
import { evaluateCandidate } from '../server/generation/evaluator.js';

const definitions = await loadCatalog();
const files = await Promise.all(['network', 'scenario-context', 'candidate'].map(async name =>
  JSON.parse(await readFile(new URL(`./fixtures/attack-catalog/${name}.json`, import.meta.url), 'utf8'))));

function input(ids = ['sql_injection', 'reflected_xss', 'phishing']) {
  const [network, context, candidate] = structuredClone(files);
  candidate.selectedAttackIds = ids;
  candidate.assignments = candidate.assignments.filter(x => ids.includes(x.attackId));
  return { definitions: structuredClone(definitions), network, context, candidate };
}

function standalone(id) {
  const value = input([id]);
  if (id === 'reflected_xss') value.context.otherConditions.push({
    predicate: 'browser_request_issued',
    args: ['user-a', 'browser-service', 'web-service', 'link-request'], value: true,
  });
  return value;
}

test('承認された3種類を外部JSONから読込み、指定の効果だけを持つ', () => {
  assert.deepEqual(definitions.map(x => x.id).sort(), ['phishing', 'reflected_xss', 'sql_injection']);
  const expected = new Map([
    ['phishing', 'browser_request_issued'],
    ['reflected_xss', 'script_executed_in_origin'],
    ['sql_injection', 'sql_query_structure_modified'],
  ]);
  for (const definition of definitions) {
    assert.equal(definition.schemaVersion, '1.0');
    assert.equal(definition.effects.length, 1);
    assert.equal(definition.effects[0].predicate, expected.get(definition.id));
    assert.equal(definition.effects[0].source, 'otherConditions');
    assert.ok(definition.references.every(x => x.supports && x.url.startsWith('https://')));
    assert.ok(definition.observableArtifacts.every(x => x.conditions.length > 0));
  }
});

test('明示した合成入力で各攻撃が単独成立し、全入力を変更しない', () => {
  for (const id of ['phishing', 'reflected_xss', 'sql_injection']) {
    const value = standalone(id);
    const before = structuredClone(value);
    const result = evaluateCandidate(value);
    assert.equal(result.state, 'SATISFIED', JSON.stringify(result.issues));
    assert.equal(result.plans[0].structure, 'SINGLE');
    assert.ok(result.plans[0].reports[0].artifacts.every(x => x.state === 'SATISFIED'));
    assert.deepEqual(value, before);
  }
});

test('3種類を選んでもXSSからSQLへ接続せず、選択順によらず全種類を含める', () => {
  const result = evaluateCandidate(input());
  assert.equal(result.state, 'SATISFIED');
  assert.equal(result.plans.length, 3);
  for (const plan of result.plans) {
    assert.deepEqual([...plan.order].sort(), ['phishing', 'reflected_xss', 'sql_injection']);
    assert.equal(plan.structure, 'MIXED');
    assert.deepEqual(plan.edges.map(x => [x.from, x.to, x.kind]), [['phishing', 'reflected_xss', 'ENABLES']]);
  }
});

test('同じ対象リクエストへのphishing効果だけがXSSの前提を補う', () => {
  const value = input(['reflected_xss', 'phishing']);
  assert.equal(evaluateCandidate(value).plans[0].structure, 'LINEAR');
  const xssOnly = input(['reflected_xss']);
  const blocked = evaluateCandidate(xssOnly);
  assert.equal(blocked.state, 'UNKNOWN');
  assert.ok(blocked.issues.some(x => x.field === 'otherConditions.browser_request_issued'));
  // 異なるリクエストのアクセスを、当該リクエストの実行条件に流用しない。
  xssOnly.context.otherConditions.push({ predicate: 'browser_request_issued',
    args: ['user-a', 'browser-service', 'web-service', 'sql-request'], value: true });
  assert.equal(evaluateCandidate(xssOnly).state, 'UNKNOWN');
});

test('全初期定義の各前提・権限は欠落/nullならUNKNOWN、反対値ならUNSATISFIED', () => {
  for (const id of ['phishing', 'reflected_xss', 'sql_injection']) {
    const base = standalone(id);
    const definition = base.definitions.find(x => x.id === id);
    const bindings = new Map(base.candidate.assignments[0].bindings.map(x => [x.name, x.entityId]));
    for (const condition of [...definition.prerequisites, ...definition.requiredPrivileges]) {
      const args = condition.args.map(x => bindings.get(x.slice(1)));
      const index = base.context[condition.source].findIndex(x => x.predicate === condition.predicate && JSON.stringify(x.args) === JSON.stringify(args));
      assert.ok(index >= 0, `${id}: ${condition.predicate}`);
      for (const mode of ['missing', 'null', 'opposite']) {
        const changed = structuredClone(base);
        if (mode === 'missing') changed.context[condition.source].splice(index, 1);
        else changed.context[condition.source][index].value = mode === 'null' ? null : !condition.value;
        const result = evaluateCandidate(changed);
        assert.equal(result.state, mode === 'opposite' ? 'UNSATISFIED' : 'UNKNOWN', `${id}: ${condition.predicate}: ${mode}`);
        assert.equal(result.blocked, true);
        assert.deepEqual(result.plans, []);
      }
    }
  }
});

test('クリック不明・実行防御・DB権限不足を不足条件の創作で回避しない', () => {
  const phishing = standalone('phishing');
  phishing.context.requiredUserActions = [];
  assert.equal(evaluateCandidate(phishing).state, 'UNKNOWN');
  const xss = standalone('reflected_xss');
  xss.context.otherConditions.find(x => x.predicate === 'script_execution_permitted').value = false;
  assert.equal(evaluateCandidate(xss).state, 'UNSATISFIED');
  const sql = standalone('sql_injection');
  sql.context.authenticationConditions.find(x => x.predicate === 'query_execution_permitted').value = false;
  assert.equal(evaluateCandidate(sql).state, 'UNSATISFIED');
});

test('到達性の欠落・拒否で停止し、攻撃者からDBへの直接接続を要求しない', () => {
  const sql = standalone('sql_injection');
  assert.ok(!sql.network.reachability.some(x => x.from === 'sender-host' && x.toService === 'db-service'));
  assert.equal(evaluateCandidate(sql).state, 'SATISFIED');
  const dbPath = sql.network.reachability.findIndex(x => x.from === 'web-host' && x.toService === 'db-service');
  sql.network.reachability[dbPath].value = false;
  assert.equal(evaluateCandidate(sql).state, 'UNSATISFIED');
  sql.network.reachability.splice(dbPath, 1);
  assert.equal(evaluateCandidate(sql).state, 'UNKNOWN');
});

test('未選択の攻撃を補ってSQLの不足条件を成立させない', () => {
  const value = input();
  value.context.otherConditions = value.context.otherConditions.filter(x => x.predicate !== 'attacker_request_submitted');
  const result = evaluateCandidate(value);
  assert.equal(result.blocked, true);
  assert.equal(result.state, 'UNKNOWN');
  assert.ok(result.issues.some(x => x.attackId === 'sql_injection' && x.field === 'otherConditions.attacker_request_submitted'));
  assert.equal(value.definitions.length, 3);
});

test('ログが未設定・無効でも攻撃成立と痕跡取得可能性を混同しない', () => {
  for (const id of ['phishing', 'reflected_xss', 'sql_injection']) {
    const value = standalone(id);
    value.context.loggingConfiguration = [];
    const result = evaluateCandidate(value);
    assert.equal(result.state, 'SATISFIED');
    assert.ok(result.plans[0].reports[0].artifacts.every(x => x.state === 'UNKNOWN'));
    const disabled = standalone(id);
    disabled.context.loggingConfiguration.forEach(x => { x.value = false; });
    const report = evaluateCandidate(disabled);
    assert.equal(report.state, 'SATISFIED');
    assert.ok(report.plans[0].reports[0].artifacts.every(x => x.state === 'UNSATISFIED'));
  }
});

test('アプリコードを変えず定義IDを変更しても同じ成立性を評価する', () => {
  const value = input();
  const ids = new Map([['phishing', 'catalog_entry_a'], ['reflected_xss', 'catalog_entry_b'], ['sql_injection', 'catalog_entry_c']]);
  value.definitions.forEach(x => { x.id = ids.get(x.id); });
  value.candidate.selectedAttackIds = value.candidate.selectedAttackIds.map(id => ids.get(id));
  value.candidate.assignments.forEach(x => { x.attackId = ids.get(x.attackId); });
  const result = evaluateCandidate(value);
  assert.equal(result.state, 'SATISFIED');
  assert.ok(result.plans.every(x => x.edges[0].from === 'catalog_entry_a' && x.edges[0].to === 'catalog_entry_b'));
});
