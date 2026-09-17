import { createHash } from 'node:crypto';
import { validateDocument, ValidationError, fail } from './schema.js';
import { sources, validateCatalog, unique } from './catalog.js';

export const SATISFIED = 'SATISFIED';
export const UNSATISFIED = 'UNSATISFIED';
export const UNKNOWN = 'UNKNOWN';
const keyOf = (source, predicate, args) => JSON.stringify([source, predicate, args]);
const aggregate = states => states.includes(UNSATISFIED) ? UNSATISFIED
  : states.includes(UNKNOWN) ? UNKNOWN : SATISFIED;

export function compareCondition(actual, expected) {
  return actual === undefined || actual === null ? UNKNOWN : actual === expected ? SATISFIED : UNSATISFIED;
}

function checkEnvironmentReferences(network, context, definitions) {
  const entities = new Map();
  for (const [kind, items] of [['node', network.nodes], ['service', network.services], ['entity', context.entities]]) {
    for (const item of items) {
      if (entities.has(item.id)) fail('DUPLICATE_ID', `${kind}.id`, 'ノード・サービス・エンティティのIDは全体で一意にしてください。');
      entities.set(item.id, { ...item, kind });
    }
  }
  unique(network.trustZones, x => x.id, 'network.trustZones');
  const zones = new Set(network.trustZones.map(x => x.id));
  const requireEntity = (id, kind, field) => {
    if (!entities.has(id) || (kind && entities.get(id).kind !== kind)) fail('BROKEN_REFERENCE', field, '参照先が存在しないか種類が一致しません。');
  };
  for (const node of network.nodes) {
    if (!zones.has(node.trustZone)) fail('BROKEN_REFERENCE', 'network.nodes.trustZone', '信頼境界の参照先がありません。');
    unique(node.roles, x => x, 'network.nodes.roles');
  }
  for (const service of network.services) requireEntity(service.nodeId, 'node', 'network.services.nodeId');
  unique(network.connections, x => JSON.stringify([x.from, x.to]), 'network.connections');
  for (const connection of network.connections) {
    requireEntity(connection.from, 'node', 'network.connections.from');
    requireEntity(connection.to, 'node', 'network.connections.to');
  }
  unique(network.reachability, x => JSON.stringify([x.from, x.toService]), 'network.reachability');
  for (const reach of network.reachability) {
    requireEntity(reach.from, 'node', 'network.reachability.from');
    requireEntity(reach.toService, 'service', 'network.reachability.toService');
    if (reach.value === true) {
      const destination = entities.get(reach.toService).nodeId;
      const visited = new Set([reach.from]);
      const queue = [reach.from];
      for (let i = 0; i < queue.length; i++) {
        for (const edge of network.connections.filter(x => x.from === queue[i])) {
          if (!visited.has(edge.to)) { visited.add(edge.to); queue.push(edge.to); }
        }
      }
      if (!visited.has(destination)) fail('CONTRADICTORY_REACHABILITY', 'network.reachability', '到達許可に対応する構成上の接続経路がありません。');
    }
  }
  for (const source of sources) {
    unique(context[source], x => keyOf(source, x.predicate, x.args), `scenario-context.${source}`);
    for (const fact of context[source]) for (const arg of fact.args) requireEntity(arg, null, `scenario-context.${source}.args`);
  }
  return { entities, catalog: new Map(definitions.map(x => [x.id, x])) };
}

export function validateEnvironment(network, context, definitions) {
  validateDocument('network', network);
  validateDocument('scenario-context', context);
  validateCatalog(definitions);
  return checkEnvironmentReferences(network, context, definitions);
}

function checkInput(network, context, candidate, definitions) {
  validateDocument('network', network);
  validateDocument('scenario-context', context);
  validateDocument('candidate', candidate);
  validateCatalog(definitions);
  const { entities, catalog } = checkEnvironmentReferences(network, context, definitions);
  const requireEntity = (id, kind, field) => {
    if (!entities.has(id) || (kind && entities.get(id).kind !== kind)) {
      fail('BROKEN_REFERENCE', field, '参照先が存在しないか種類が一致しません。');
    }
  };
  unique(candidate.selectedAttackIds, x => x, 'candidate.selectedAttackIds');
  unique(candidate.assignments, x => x.attackId, 'candidate.assignments');
  for (const id of candidate.selectedAttackIds) if (!catalog.has(id)) fail('UNREGISTERED_ATTACK', 'candidate.selectedAttackIds', '未登録の攻撃が含まれています。');
  if (candidate.assignments.length !== candidate.selectedAttackIds.length
    || candidate.assignments.some(x => !candidate.selectedAttackIds.includes(x.attackId))) {
    fail('SELECTION_MISMATCH', 'candidate.assignments', '選択した全攻撃に対応する割当てが必要です。');
  }
  const attacks = candidate.assignments.map(assignment => {
    const definition = catalog.get(assignment.attackId);
    unique(assignment.bindings, x => x.name, 'candidate.assignments.bindings');
    const bindings = new Map(assignment.bindings.map(x => [x.name, x.entityId]));
    if (bindings.size !== definition.bindings.length) fail('INVALID_BINDING', 'candidate.assignments.bindings', '定義と割当ての変数数が一致しません。');
    for (const binding of definition.bindings) {
      if (!bindings.has(binding.id)) fail('MISSING_BINDING', 'candidate.assignments.bindings', '対象の割当てが不足しています。');
      requireEntity(bindings.get(binding.id), binding.kind, 'candidate.assignments.bindings');
    }
    return { definition, bindings };
  });
  return { entities, attacks };
}

function evaluateFact(condition, bindings, facts) {
  const args = condition.args.map(arg => bindings.get(arg.slice(1)));
  const key = keyOf(condition.source, condition.predicate, args);
  const fact = facts.get(key);
  const state = compareCondition(fact?.value, condition.value);
  return { field: `${condition.source}.${condition.predicate}`, args, state,
    reason: condition.description,
    code: state === UNKNOWN ? 'MISSING_INFORMATION' : state === UNSATISFIED ? 'CONDITION_NOT_MET' : 'CONDITION_MET',
    key, producer: fact?.producer ?? null };
}

function evaluateAttack(attack, entities, network, facts) {
  const { definition, bindings } = attack;
  const checks = [];
  for (const group of ['targetTypes', 'platforms', 'requiredServices']) {
    for (const constraint of definition[group]) {
      const entity = entities.get(bindings.get(constraint.binding));
      const actual = group === 'platforms' ? (entity.kind === 'node' ? entity.os : entity.platform) : entity.type;
      const state = actual === null ? UNKNOWN : constraint.values.includes(actual) ? SATISFIED : UNSATISFIED;
      checks.push({ field: group, args: [entity.id], state, reason: '定義の対象種類・実行基盤・サービス条件との照合です。' });
      if (group === 'requiredServices') checks.push({ field: 'requiredServices.node', args: [entity.id],
        state: compareCondition(entity.nodeId, bindings.get(constraint.node)), reason: '対象ノード上のサービスか確認します。' });
    }
  }
  for (const condition of definition.requiredReachability) {
    const from = bindings.get(condition.from);
    const toService = bindings.get(condition.toService);
    const record = network.reachability.find(x => x.from === from && x.toService === toService);
    checks.push({ field: 'requiredReachability', args: [from, toService],
      state: compareCondition(record?.value, true), reason: condition.description });
  }
  for (const condition of [...definition.prerequisites, ...definition.requiredPrivileges]) {
    checks.push(evaluateFact(condition, bindings, facts));
  }
  // Attack Graph v1が追跡する既存評価の順序は維持し、追加の割当て制約は末尾で検証する。
  for (const constraint of definition.requiredRoles ?? []) {
    const entity = entities.get(bindings.get(constraint.binding));
    const state = constraint.values.every(role => entity.roles.includes(role)) ? SATISFIED : UNSATISFIED;
    checks.push({ field: 'requiredRoles', args: [entity.id], state,
      reason: 'Attack Definitionで宣言されたroleを対象ノードがすべて持つか確認します。' });
  }
  return { attackId: definition.id, state: aggregate(checks.map(x => x.state)), checks };
}

function permutations(items) {
  if (!items.length) return [[]];
  return items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest]));
}

function shape(ids, edges) {
  if (ids.length === 1) return 'SINGLE';
  if (!edges.length) return 'PARALLEL';
  const outgoing = id => edges.filter(x => x.from === id).length;
  const incoming = id => edges.filter(x => x.to === id).length;
  if (ids.some(id => outgoing(id) > 1)) return 'BRANCHING';
  if (ids.some(id => incoming(id) > 1)) return 'JOIN';
  if (edges.length === ids.length - 1) return 'LINEAR';
  return 'MIXED';
}

// 検証するのは対象割当てが明示された候補。選択IDだけから対象や条件を創作しない。
// 全順序を評価しても、因果辺がなければ並列。単なる実行順を依存辺にはしない。
export function evaluateCandidate({ network, context, candidate, definitions }) {
  try {
    const { entities, attacks } = checkInput(network, context, candidate, definitions);
    const initialFacts = new Map(sources.flatMap(source => context[source].map(fact =>
      [keyOf(source, fact.predicate, fact.args), { value: fact.value, producer: null }])));
    const attempts = [];
    for (const order of permutations(attacks)) {
      const facts = new Map(initialFacts);
      const edges = [];
      const reports = [];
      const reads = new Map();
      const addEdge = (from, to, kind, field, key) => {
        if (from && from !== to && !edges.some(x => x.from === from && x.to === to
          && x.kind === kind && x.field === field && x.key === key)) {
          edges.push({ from, to, kind, field, key });
        }
      };
      for (const attack of order) {
        const { definition, bindings } = attack;
        const report = evaluateAttack(attack, entities, network, facts);
        reports.push(report);
        if (report.state !== SATISFIED) break;
        for (const check of report.checks.filter(x => x.key)) {
          addEdge(check.producer, definition.id, 'ENABLES', check.field, check.key);
          const consumers = reads.get(check.key) ?? [];
          consumers.push({ id: definition.id, value: facts.get(check.key)?.value });
          reads.set(check.key, consumers);
        }
        for (const effect of definition.effects) {
          const key = keyOf(effect.source, effect.predicate, effect.args.map(arg => bindings.get(arg.slice(1))));
          const previous = facts.get(key);
          if (previous?.value !== effect.value) {
            addEdge(previous?.producer, definition.id, 'ORDERING', `${effect.source}.${effect.predicate}`, key);
            for (const consumer of reads.get(key) ?? []) {
              if (consumer.value !== effect.value) {
                addEdge(consumer.id, definition.id, 'ORDERING', `${effect.source}.${effect.predicate}`, key);
              }
            }
            facts.set(key, { value: effect.value, producer: definition.id });
          }
        }
        // 痕跡の取得条件は攻撃成立条件とは別に返す。ログ無効でも攻撃自体は成立し得る。
        report.artifacts = definition.observableArtifacts.map(artifact => {
          const checks = artifact.conditions.map(c => evaluateFact(c, bindings, facts));
          return { id: artifact.id, description: artifact.description, state: aggregate(checks.map(x => x.state)), checks };
        });
      }
      const complete = reports.length === attacks.length && reports.every(x => x.state === SATISFIED);
      const pairs = [...new Map(edges.map(x => [JSON.stringify([x.from, x.to]), x])).values()];
      attempts.push({ state: complete ? SATISFIED : reports.at(-1).state,
        order: order.map(x => x.definition.id), reports, edges,
        structure: complete ? shape(order.map(x => x.definition.id), pairs) : null });
    }
    const valid = attempts.filter(x => x.state === SATISFIED);
    const state = valid.length ? SATISFIED : attempts.some(x => x.state === UNKNOWN) ? UNKNOWN : UNSATISFIED;
    return {
      schemaVersion: '1.0', state, blocked: state !== SATISFIED,
      scope: 'CANDIDATE_FEASIBILITY_ONLY',
      inputDigest: createHash('sha256').update(JSON.stringify({ network, context, candidate, definitions })).digest('hex'),
      plans: valid, attempts: valid.length ? [] : attempts,
      issues: valid.length ? [] : attempts.flatMap(attempt => attempt.reports.flatMap(report => report.checks
        .filter(check => check.state !== SATISFIED).map(check => ({
          code: check.state === UNKNOWN ? 'MISSING_INFORMATION' : 'CONDITION_NOT_MET',
          field: check.field, attackId: report.attackId, args: check.args, state: check.state,
          reason: check.reason, suggestion: check.state === UNKNOWN
            ? 'この対象の条件を確認し、scenario-contextまたはnetworkに明示してください。'
            : '条件を満たす対象・構成への修正を検討してください。入力は自動変更しません。',
        })))),
    };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { schemaVersion: '1.0', state: UNKNOWN, blocked: true, scope: 'CANDIDATE_FEASIBILITY_ONLY',
      plans: [], attempts: [], issues: [{ code: error.code, field: error.field, reason: error.message,
        suggestion: 'スキーマまたは参照関係を確認して入力を修正してください。' }] };
  }
}
