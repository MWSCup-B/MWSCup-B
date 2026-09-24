// 2026-09-20 修正後: 利用者の選択を固定し、所属・全Role・Platform・到達性を同時に解く。
import { fail } from './schema.js';

export const AUTHORING_BINDING_SEARCH_LIMIT = 10000;
const entityIds = { actor: 'actor-a', user: 'user-a', database_principal: 'db-account' };

export function entityType(definition, name) {
  const requirements = definition.targetTypes.filter(item => item.binding === name);
  const types = requirements[0]?.values.filter(type => requirements.every(item => item.values.includes(type))) ?? [];
  if (types.length !== 1) fail('AMBIGUOUS_ENTITY_TYPE', `${definition.id}.bindings.${name}`,
    'Authorで利用するEntityには一意の型を指定してください。');
  return types[0];
}

export function resolveAuthoringBindings(network, attack, definition) {
  const field = `attacks.${attack.order}`;
  if (!definition.authoring) fail('AUTHORING_DEFINITION_REQUIRED', `${field}.attackId`,
    'この攻撃にはAuthorの割当て定義（authoring）がありません。');
  const hint = definition.authoring;
  const target = definition.requiredServices.find(item => item.binding === hint.targetServiceBinding);
  if (!target) fail('MISSING_BINDING', `${field}.targetServiceId`, '対象Serviceの所属条件が不足しています。');
  const fixed = new Map();
  const fix = (name, id) => {
    if (fixed.has(name) && fixed.get(name) !== id) fail('CONFLICTING_BINDING', `${field}.${name}`,
      '指定したSource、Target、調査取得元の割当てが矛盾しています。');
    fixed.set(name, id);
  };
  fix(hint.sourceNodeBinding, attack.sourceNodeId);
  fix(hint.targetServiceBinding, attack.targetServiceId);
  fix(target.node, attack.targetNodeId);
  // 既定資料を選択しているときだけ取得元を割当ての追加制約にする。
  if (attack.investigationTypes.includes(hint.preferredInvestigationType)) {
    const investigation = definition.requiredServices.find(item => item.binding === hint.investigationServiceBinding);
    if (investigation) fix(investigation.node, attack.investigationSourceNodeId);
  }
  const entities = [
    ...network.nodes.map(n => ({ ...n, kind: 'node', platform: n.os })),
    ...network.services.map(s => ({ ...s, kind: 'service', roles: [] })),
    ...definition.bindings.filter(b => b.kind === 'entity').map(b => {
      const type = entityType(definition, b.id);
      const id = type === 'web_request' ? `request-${attack.order}`
        : Object.hasOwn(entityIds, type) ? entityIds[type] : `entity-${attack.order}-${b.id.slice(0, 60)}`;
      fix(b.id, id);
      return { id, kind: 'entity', type, roles: [], platform: null };
    }),
  ];
  const domains = new Map(definition.bindings.map(binding => [binding.id,
    [...new Set(entities.filter(entity => entity.kind === binding.kind
      && (!fixed.has(binding.id) || entity.id === fixed.get(binding.id))
      && definition.targetTypes.filter(c => c.binding === binding.id).every(c => c.values.includes(entity.type))
      && definition.platforms.filter(c => c.binding === binding.id).every(c => c.values.includes(entity.platform))
      && (definition.requiredRoles ?? []).filter(c => c.binding === binding.id).every(c => c.values.every(role => entity.roles.includes(role)))
      && definition.requiredServices.filter(c => c.binding === binding.id).every(c => c.values.includes(entity.type)))
      .map(entity => entity.id))] ]));
  const relations = [
    ...definition.requiredServices.map(c => ({ left: c.binding, right: c.node,
      pairs: network.services.filter(s => c.values.includes(s.type)).map(s => [s.id, s.nodeId]) })),
    ...definition.requiredReachability.map(c => ({ left: c.from, right: c.toService,
      pairs: network.reachability.filter(r => r.value === true).map(r => [r.from, r.toService]) })),
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of relations) {
      const pairs = relation.pairs.filter(([a, b]) => domains.get(relation.left).includes(a)
        && domains.get(relation.right).includes(b));
      for (const [name, column] of [[relation.left, 0], [relation.right, 1]]) {
        const values = domains.get(name).filter(id => pairs.some(pair => pair[column] === id));
        if (values.length !== domains.get(name).length) { domains.set(name, values); changed = true; }
      }
    }
  }
  for (const [name, values] of domains) if (!values.length) fail('MISSING_BINDING', `${field}.${name}`,
    '指定対象のRole、Platform、Service所属、到達性を同時に満たす割当てがありません。');
  const order = [...domains.keys()].sort((a, b) => domains.get(a).length - domains.get(b).length);
  const current = Object.create(null); const solutions = []; let visited = 0;
  const search = depth => {
    if (++visited > AUTHORING_BINDING_SEARCH_LIMIT) fail('BINDING_SEARCH_LIMIT', field,
      '対象割当ての探索上限に達しました。構成を絞ってください。');
    if (!relations.every(r => r.pairs.some(([a, b]) => (!current[r.left] || current[r.left] === a)
      && (!current[r.right] || current[r.right] === b)))) return;
    if (depth === order.length) { solutions.push({ ...current }); return; }
    const name = order[depth];
    for (const value of domains.get(name)) {
      current[name] = value; search(depth + 1); delete current[name];
      if (solutions.length > 1) return;
    }
  };
  search(0);
  if (solutions.length !== 1) fail(solutions.length ? 'AMBIGUOUS_BINDING' : 'MISSING_BINDING', field,
    solutions.length ? '全条件を満たす割当てが複数あります。対象と調査取得元を絞ってください。'
      : '全条件を満たす割当てがありません。');
  return solutions[0];
}

// 2026-09-20: 同じ効果と前提が同じ対象に対応するときだけ前段のRequestを共有する。
export function linkRequestBindings(sorted, definitions, bindings) {
  for (let index = 1; index < sorted.length; index++) {
    const later = definitions.get(sorted[index].attackId); const laterMap = bindings.get(later.id);
    const requestNames = new Set(later.bindings.filter(b => b.kind === 'entity'
      && entityType(later, b.id) === 'web_request').map(b => b.id));
    const proposals = new Map();
    for (const earlierAttack of sorted.slice(0, index)) {
      const earlier = definitions.get(earlierAttack.attackId); const earlierMap = bindings.get(earlier.id);
      for (const condition of [...later.prerequisites, ...later.requiredPrivileges]) {
        for (const effect of earlier.effects) {
          if (effect.source !== condition.source || effect.predicate !== condition.predicate
            || effect.value !== condition.value || effect.args.length !== condition.args.length) continue;
          const proposed = new Map(); let matches = true;
          condition.args.forEach((arg, offset) => {
            const name = arg.slice(1); const previous = effect.args[offset].slice(1);
            if (requestNames.has(name)) {
              const binding = earlier.bindings.find(b => b.id === previous);
              if (binding?.kind !== 'entity' || entityType(earlier, previous) !== 'web_request'
                || (proposed.has(name) && proposed.get(name) !== earlierMap[previous])) matches = false;
              proposed.set(name, earlierMap[previous]);
            } else if (laterMap[name] !== earlierMap[previous]) matches = false;
          });
          if (matches) for (const [name, id] of proposed) {
            if (!proposals.has(name)) proposals.set(name, new Set());
            proposals.get(name).add(id);
          }
        }
      }
    }
    for (const [name, ids] of proposals) {
      if (ids.size !== 1) fail('AMBIGUOUS_REQUEST_CHAIN', `attacks.${sorted[index].order}.${name}`,
        '同じ前提を満たすRequestが複数あります。攻撃の対象を絞ってください。');
      laterMap[name] = [...ids][0];
    }
  }
}
