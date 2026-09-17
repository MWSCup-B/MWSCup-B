import { createHash } from 'node:crypto';
import { unique } from './catalog.js';
import { evaluateCandidate, SATISFIED, validateEnvironment } from './evaluator.js';
import { fail, validateDocument, ValidationError } from './schema.js';

export const CANDIDATE_SEARCH_LIMIT = 100_000;
const EFFECT_KEY = effect => JSON.stringify([
  effect.source, effect.predicate, effect.value, effect.args.length,
]);

class SearchLimitExceeded extends Error {}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestInput(input) {
  return createHash('sha256').update(canonicalize(input)).digest('hex');
}

function variableKey(attackId, binding) {
  return `${attackId}\u0000${binding}`;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateCandidateBuilderResult(result) {
  validateDocument('candidate-builder-result', result);
  if (!isNonNegativeInteger(result.diagnostics.exploredStates)
    || result.diagnostics.exploredStates > CANDIDATE_SEARCH_LIMIT
    || result.diagnostics.searchLimit !== CANDIDATE_SEARCH_LIMIT
    || !isNonNegativeInteger(result.diagnostics.bindingCount)
    || result.diagnostics.candidateDomainSizes.length !== result.diagnostics.bindingCount
    || result.diagnostics.candidateDomainSizes.some(item => !isNonNegativeInteger(item.size))) {
    fail('INVALID_DIAGNOSTICS', 'candidate-builder-result.diagnostics', '探索診断値が不正です。');
  }
  result.candidates.forEach(candidate => validateDocument('candidate', candidate));
  const created = result.status === 'CREATED';
  if (created === result.blocked
    || (created && (!result.complete || !result.candidates.length || result.issues.length))) {
    fail('INVALID_RESULT_STATE', 'candidate-builder-result.status', '生成状態とcandidateまたはissueが矛盾しています。');
  }
  if (result.blocked && (result.candidates.length || !result.issues.length)) {
    fail('INVALID_RESULT_STATE', 'candidate-builder-result.candidates', '停止結果はcandidateを含めず、理由を含めてください。');
  }
  if (!result.complete && result.issues.every(issue => issue.code === 'NO_TARGET_ASSIGNMENT')) {
    fail('INVALID_RESULT_STATE', 'candidate-builder-result.complete', '不完全な探索には停止理由が必要です。');
  }
  return result;
}

function makeResult({ inputDigest, status, complete, candidates = [], diagnostics, issues = [] }) {
  return validateCandidateBuilderResult({
    schemaVersion: '1.0', status, blocked: status === 'BLOCKED', complete,
    scope: 'TARGET_ASSIGNMENT_ONLY', inputDigest, candidates, diagnostics, issues,
  });
}

function relationSupports(relation, assignment, domains) {
  return relation.tuples.some(tuple => {
    const values = new Map();
    for (let i = 0; i < relation.keys.length; i++) {
      const key = relation.keys[i];
      const value = tuple[i];
      if (values.has(key) && values.get(key) !== value) return false;
      values.set(key, value);
      if (assignment.has(key) && assignment.get(key) !== value) return false;
      if (!domains.get(key).includes(value)) return false;
    }
    return true;
  });
}

function propagateDomains(domains, relations) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of relations) {
      for (const key of new Set(relation.keys)) {
        const filtered = domains.get(key).filter(value => relationSupports(relation, new Map([[key, value]]), domains));
        if (filtered.length !== domains.get(key).length) {
          domains.set(key, filtered);
          changed = true;
        }
      }
    }
  }
}

function makeCandidate(selectedAttackIds, selectedDefinitions, assignment) {
  return {
    schemaVersion: '1.0',
    selectedAttackIds: [...selectedAttackIds],
    assignments: selectedDefinitions.map(definition => ({
      attackId: definition.id,
      bindings: definition.bindings.map(binding => ({
        name: binding.id,
        entityId: assignment.get(variableKey(definition.id, binding.id)),
      })),
    })),
  };
}

function buildSearchModel(network, context, selectedDefinitions, entities) {
  const variables = [];
  const domains = new Map();
  for (const definition of selectedDefinitions) {
    for (const binding of definition.bindings) {
      const key = variableKey(definition.id, binding.id);
      const constraints = {
        targetTypes: definition.targetTypes.filter(item => item.binding === binding.id),
        platforms: definition.platforms.filter(item => item.binding === binding.id),
        requiredRoles: (definition.requiredRoles ?? []).filter(item => item.binding === binding.id),
        requiredServices: definition.requiredServices.filter(item => item.binding === binding.id),
      };
      const domain = [...entities.values()].filter(entity => {
        if (entity.kind !== binding.kind) return false;
        if (!constraints.targetTypes.every(item => entity.type !== null && item.values.includes(entity.type))) return false;
        if (!constraints.platforms.every(item => {
          const actual = entity.kind === 'node' ? entity.os : entity.platform;
          return actual !== null && item.values.includes(actual);
        })) return false;
        if (!constraints.requiredRoles.every(item => item.values.every(role => entity.roles.includes(role)))) return false;
        return constraints.requiredServices.every(item => entity.type !== null && item.values.includes(entity.type));
      }).map(entity => entity.id);
      variables.push({ key, attackId: definition.id, binding: binding.id, order: variables.length });
      domains.set(key, domain);
    }
  }

  const relations = [];
  const producedConditions = new Set(selectedDefinitions.flatMap(definition => definition.effects.map(EFFECT_KEY)));
  for (const definition of selectedDefinitions) {
    for (const constraint of definition.requiredServices) {
      const serviceKey = variableKey(definition.id, constraint.binding);
      const nodeKey = variableKey(definition.id, constraint.node);
      relations.push({
        keys: [serviceKey, nodeKey],
        tuples: network.services.filter(service => constraint.values.includes(service.type))
          .map(service => [service.id, service.nodeId]),
      });
    }
    for (const constraint of definition.requiredReachability) {
      relations.push({
        keys: [variableKey(definition.id, constraint.from), variableKey(definition.id, constraint.toService)],
        tuples: network.reachability.filter(item => item.value === true)
          .map(item => [item.from, item.toService]),
      });
    }
    for (const condition of [...definition.prerequisites, ...definition.requiredPrivileges]) {
      if (producedConditions.has(EFFECT_KEY(condition))) continue;
      relations.push({
        keys: condition.args.map(arg => variableKey(definition.id, arg.slice(1))),
        tuples: context[condition.source]
          .filter(fact => fact.predicate === condition.predicate && fact.value === condition.value
            && fact.args.length === condition.args.length)
          .map(fact => fact.args),
      });
    }
  }
  propagateDomains(domains, relations);
  return { variables, domains, relations };
}

// 対象だけを割り当てる。事件、時系列、Ground Truth、証拠は生成しない。
export function buildCandidates(input) {
  const inputDigest = digestInput(input);
  let exploredStates = 0;
  let bindingCount = 0;
  let candidateDomainSizes = [];
  const diagnostics = () => ({
    exploredStates, searchLimit: CANDIDATE_SEARCH_LIMIT, bindingCount, candidateDomainSizes,
  });
  try {
    const { network, context, selection, definitions } = input;
    validateDocument('candidate-selection', selection);
    unique(selection.selectedAttackIds, id => id, 'candidate-selection.selectedAttackIds');
    const { entities, catalog } = validateEnvironment(network, context, definitions);
    for (const id of selection.selectedAttackIds) {
      if (!catalog.has(id)) fail('UNREGISTERED_ATTACK', 'candidate-selection.selectedAttackIds', '未登録の攻撃が含まれています。');
    }
    const selectedDefinitions = selection.selectedAttackIds.map(id => catalog.get(id));
    const { variables, domains, relations } = buildSearchModel(network, context, selectedDefinitions, entities);
    bindingCount = variables.length;
    candidateDomainSizes = variables.map(variable => ({
      attackId: variable.attackId, binding: variable.binding, size: domains.get(variable.key).length,
    }));
    const empty = candidateDomainSizes.find(item => item.size === 0);
    if (empty) {
      return makeResult({ inputDigest, status: 'BLOCKED', complete: true, diagnostics: diagnostics(), issues: [{
        code: 'NO_TARGET_ASSIGNMENT', field: `${empty.attackId}.bindings.${empty.binding}`,
        reason: '種類、role、platform、service、明示到達性、または既存条件を満たす実在対象がありません。',
        suggestion: 'Network、Scenario Context、またはAttack Definitionの明示値を確認してください。入力は自動補完しません。',
      }] });
    }

    const searchOrder = [...variables].sort((a, b) => domains.get(a.key).length - domains.get(b.key).length
      || a.order - b.order);
    const assignment = new Map();
    const candidates = [];
    const visit = depth => {
      exploredStates += 1;
      if (exploredStates >= CANDIDATE_SEARCH_LIMIT) throw new SearchLimitExceeded();
      if (!relations.every(relation => relationSupports(relation, assignment, domains))) return;
      if (depth === searchOrder.length) {
        const candidate = makeCandidate(selection.selectedAttackIds, selectedDefinitions, assignment);
        const evaluation = evaluateCandidate({ network, context, candidate, definitions });
        if (evaluation.state === SATISFIED) candidates.push(candidate);
        return;
      }
      const variable = searchOrder[depth];
      for (const entityId of domains.get(variable.key)) {
        assignment.set(variable.key, entityId);
        visit(depth + 1);
        assignment.delete(variable.key);
      }
    };
    visit(0);
    if (!candidates.length) {
      return makeResult({ inputDigest, status: 'BLOCKED', complete: true, diagnostics: diagnostics(), issues: [{
        code: 'NO_TARGET_ASSIGNMENT', field: 'candidate.assignments',
        reason: '全探索が完了しましたが、Combination Validatorで全選択攻撃が成立する対象割当てはありません。',
        suggestion: 'Validatorの不足条件を満たすNetworkまたはScenario Contextの明示入力を検討してください。',
      }] });
    }
    return makeResult({ inputDigest, status: 'CREATED', complete: true, candidates,
      diagnostics: diagnostics() });
  } catch (error) {
    if (error instanceof SearchLimitExceeded) {
      return makeResult({ inputDigest, status: 'BLOCKED', complete: false, diagnostics: diagnostics(), issues: [{
        code: 'CANDIDATE_SEARCH_LIMIT_EXCEEDED', field: 'candidate.assignments',
        reason: '部分割当てを含む探索状態数が上限に到達したため、完全性を保証できません。',
        suggestion: '入力の対象数またはAttack Definitionの制約を見直し、候補domainを縮小してください。',
      }] });
    }
    if (!(error instanceof ValidationError)) throw error;
    return makeResult({ inputDigest, status: 'BLOCKED', complete: false, diagnostics: diagnostics(), issues: [{
      code: error.code, field: error.field, reason: error.message,
      suggestion: 'スキーマまたは参照関係を確認して入力を修正してください。',
    }] });
  }
}
