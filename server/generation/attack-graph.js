import { createHash } from 'node:crypto';
import { evaluateCandidate, SATISFIED, UNKNOWN } from './evaluator.js';
import { fail, validateDocument } from './schema.js';

const nodeId = attackId => `attack_${attackId}`;
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const factKey = fact => JSON.stringify([fact.source, fact.predicate, fact.args]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameValues(left, right) {
  return canonical(left) === canonical(right);
}

function locateEntity(input, id) {
  for (const [items, prefix, origin] of [
    [input.network.nodes, 'network.nodes', 'NETWORK'],
    [input.network.services, 'network.services', 'NETWORK'],
    [input.context.entities, 'scenario-context.entities', 'SCENARIO_CONTEXT'],
  ]) {
    const index = items.findIndex(item => item.id === id);
    if (index >= 0) return { entity: items[index], prefix: `${prefix}[${index}]`, origin };
  }
  return null;
}

function resolvedFact(condition, bindings) {
  return {
    source: condition.source,
    predicate: condition.predicate,
    args: condition.args.map(arg => bindings.get(arg.slice(1))),
    value: condition.value,
  };
}

function buildEffects(definition, bindings, attackNodeId) {
  return definition.effects.map((effect, index) => ({
    effectId: `effect_${attackNodeId}_${index}`,
    ...resolvedFact(effect, bindings),
    description: effect.description,
    definitionRef: `attackDefinitions.${definition.id}.effects[${index}]`,
  }));
}

function conditionEvaluation({ condition, check, bindings, kind, definitionRef,
  evaluationId, input, effectsByAttack }) {
  const fact = resolvedFact(condition, bindings);
  const contextIndex = input.context[fact.source].findIndex(item => item.predicate === fact.predicate
    && sameValues(item.args, fact.args));
  const producer = check.producer ?? null;
  const producerEffect = producer
    ? effectsByAttack.get(producer)?.find(effect => factKey(effect) === factKey(fact) && effect.value === fact.value)
    : null;
  const contextFact = contextIndex >= 0 ? input.context[fact.source][contextIndex] : null;
  return {
    evaluationId,
    kind,
    field: `${fact.source}.${fact.predicate}`,
    predicate: fact.predicate,
    args: fact.args,
    expectedValues: [fact.value],
    actualValue: producerEffect ? producerEffect.value : contextFact?.value ?? null,
    state: check.state,
    origin: producerEffect ? 'ATTACK_EFFECT' : 'SCENARIO_CONTEXT',
    sourceRef: producerEffect?.effectId ?? (contextFact ? `scenario-context.${fact.source}[${contextIndex}]` : null),
    producerNodeId: producer ? nodeId(producer) : null,
    definitionRef,
    reason: check.reason,
  };
}

function buildEvaluations(definition, bindings, report, input, effectsByAttack, attackNodeId) {
  const evaluations = [];
  let cursor = 0;
  const addNetwork = ({ kind, field, args, expectedValues, actualValue, sourceRef, definitionRef, origin = 'NETWORK' }) => {
    const check = report.checks[cursor];
    evaluations.push({
      evaluationId: `evaluation_${attackNodeId}_${cursor}`,
      kind, field, predicate: null, args, expectedValues, actualValue: actualValue ?? null,
      state: check.state, origin, sourceRef, producerNodeId: null, definitionRef, reason: check.reason,
    });
    cursor += 1;
  };

  for (const group of ['targetTypes', 'platforms', 'requiredServices']) {
    definition[group].forEach((constraint, index) => {
      const target = locateEntity(input, bindings.get(constraint.binding));
      const actual = group === 'platforms'
        ? (target.entity.nodeId === undefined ? target.entity.os : target.entity.platform)
        : target.entity.type;
      addNetwork({
        kind: group === 'targetTypes' ? 'TARGET_TYPE' : group === 'platforms' ? 'PLATFORM' : 'REQUIRED_SERVICE',
        field: group, args: [target.entity.id], expectedValues: constraint.values,
        actualValue: actual, sourceRef: `${target.prefix}.${group === 'platforms'
          ? (target.entity.nodeId === undefined ? 'os' : 'platform') : 'type'}`,
        definitionRef: `attackDefinitions.${definition.id}.${group}[${index}]`, origin: target.origin,
      });
      if (group === 'requiredServices') {
        addNetwork({
          kind: 'REQUIRED_SERVICE', field: 'requiredServices.node', args: [target.entity.id],
          expectedValues: [bindings.get(constraint.node)], actualValue: target.entity.nodeId,
          sourceRef: `${target.prefix}.nodeId`,
          definitionRef: `attackDefinitions.${definition.id}.${group}[${index}].node`,
        });
      }
    });
  }

  definition.requiredReachability.forEach((requirement, index) => {
    const from = bindings.get(requirement.from);
    const toService = bindings.get(requirement.toService);
    const reachabilityIndex = input.network.reachability.findIndex(item => item.from === from
      && item.toService === toService);
    addNetwork({
      kind: 'REACHABILITY', field: 'requiredReachability', args: [from, toService],
      expectedValues: [true],
      actualValue: reachabilityIndex >= 0 ? input.network.reachability[reachabilityIndex].value : null,
      sourceRef: reachabilityIndex >= 0 ? `network.reachability[${reachabilityIndex}].value` : null,
      definitionRef: `attackDefinitions.${definition.id}.requiredReachability[${index}]`,
    });
  });

  for (const [group, kind] of [['prerequisites', 'PREREQUISITE'], ['requiredPrivileges', 'REQUIRED_PRIVILEGE']]) {
    definition[group].forEach((condition, index) => {
      const check = report.checks[cursor];
      evaluations.push(conditionEvaluation({
        condition, check, bindings, kind,
        definitionRef: `attackDefinitions.${definition.id}.${group}[${index}]`,
        evaluationId: `evaluation_${attackNodeId}_${cursor}`,
        input, effectsByAttack,
      }));
      cursor += 1;
    });
  }
  return evaluations;
}

function buildArtifactEvaluations(definition, bindings, report, input, effectsByAttack, attackNodeId) {
  return definition.observableArtifacts.map((artifact, artifactIndex) => ({
    artifactId: artifact.id,
    description: artifact.description,
    state: report.artifacts[artifactIndex].state,
    evaluations: artifact.conditions.map((condition, conditionIndex) => conditionEvaluation({
      condition,
      check: report.artifacts[artifactIndex].checks[conditionIndex],
      bindings,
      kind: 'ARTIFACT_CONDITION',
      definitionRef: `attackDefinitions.${definition.id}.observableArtifacts[${artifactIndex}].conditions[${conditionIndex}]`,
      evaluationId: `artifact_evaluation_${attackNodeId}_${artifactIndex}_${conditionIndex}`,
      input,
      effectsByAttack,
    })),
  }));
}

function componentStructure(ids, edges) {
  if (ids.length === 1) return 'SINGLE';
  const outgoing = id => edges.filter(edge => edge.from === id).length;
  const incoming = id => edges.filter(edge => edge.to === id).length;
  const branches = ids.some(id => outgoing(id) > 1);
  const joins = ids.some(id => incoming(id) > 1);
  if (branches && joins) return 'MIXED';
  if (branches) return 'BRANCHING';
  if (joins) return 'JOIN';
  if (edges.length === ids.length - 1) return 'LINEAR';
  return 'MIXED';
}

function graphParts(nodeIds, edges) {
  const adjacency = new Map(nodeIds.map(id => [id, new Set()]));
  for (const edge of edges) {
    adjacency.get(edge.from).add(edge.to);
    adjacency.get(edge.to).add(edge.from);
  }
  const components = [];
  const visited = new Set();
  for (const start of [...nodeIds].sort()) {
    if (visited.has(start)) continue;
    const ids = [];
    const queue = [start];
    visited.add(start);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      ids.push(current);
      for (const next of adjacency.get(current)) {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    ids.sort();
    const localEdges = edges.filter(edge => ids.includes(edge.from) && ids.includes(edge.to));
    components.push({
      componentId: `component_${components.length + 1}`,
      structure: componentStructure(ids, localEdges),
      nodeIds: ids,
    });
  }
  const roots = nodeIds.filter(id => !edges.some(edge => edge.to === id)).sort();
  const leaves = nodeIds.filter(id => !edges.some(edge => edge.from === id)).sort();
  const structure = nodeIds.length === 1 ? 'SINGLE'
    : edges.length === 0 ? 'PARALLEL'
      : components.length > 1 ? 'MIXED' : components[0].structure;
  return { components, roots, leaves, structure };
}

function buildGraph(plan, input) {
  const definitions = new Map(input.definitions.map(definition => [definition.id, definition]));
  const assignments = new Map(input.candidate.assignments.map(assignment => [assignment.attackId, assignment]));
  const reports = new Map(plan.reports.map(report => [report.attackId, report]));
  const bindingsByAttack = new Map([...assignments].map(([attackId, assignment]) => [attackId,
    new Map(assignment.bindings.map(binding => [binding.name, binding.entityId]))]));
  const effectsByAttack = new Map([...definitions].filter(([id]) => assignments.has(id)).map(([attackId, definition]) => [
    attackId, buildEffects(definition, bindingsByAttack.get(attackId), nodeId(attackId)),
  ]));

  const nodes = [...assignments.keys()].sort().map(attackId => {
    const definition = definitions.get(attackId);
    const bindings = bindingsByAttack.get(attackId);
    const report = reports.get(attackId);
    return {
      nodeId: nodeId(attackId),
      attackDefinitionId: attackId,
      attackDefinitionSchemaVersion: definition.schemaVersion,
      state: SATISFIED,
      bindings: [...bindings].map(([name, entityId]) => ({ name, entityId })).sort((a, b) => a.name.localeCompare(b.name)),
      evaluations: buildEvaluations(definition, bindings, report, input, effectsByAttack, nodeId(attackId)),
      effects: effectsByAttack.get(attackId),
      artifactEvaluations: buildArtifactEvaluations(definition, bindings, report, input, effectsByAttack, nodeId(attackId)),
      referenceIds: definition.references.map(reference => reference.id),
    };
  });

  const enables = plan.edges.filter(edge => edge.kind === 'ENABLES').map(edge => {
    const [source, predicate, args] = JSON.parse(edge.key);
    const producerNode = nodes.find(node => node.attackDefinitionId === edge.from);
    const consumerNode = nodes.find(node => node.attackDefinitionId === edge.to);
    const producerEffect = producerNode.effects.find(effect => factKey(effect)
      === JSON.stringify([source, predicate, args]));
    const fact = { source, predicate, args, value: producerEffect?.value ?? true };
    const prerequisite = consumerNode.evaluations.find(evaluation => evaluation.producerNodeId === producerNode.nodeId
      && evaluation.field === `${source}.${predicate}` && sameValues(evaluation.args, args)
      && evaluation.expectedValues.includes(fact.value));
    if (!producerEffect || !prerequisite) {
      fail('BROKEN_GRAPH_GROUND', 'edges', '攻撃間依存のeffectまたはprerequisiteを追跡できません。');
    }
    const edgeId = `edge_${digest([edge.from, edge.to, fact]).slice(0, 16)}`;
    return {
      edgeId, type: 'ENABLES', from: producerNode.nodeId, to: consumerNode.nodeId,
      effectId: producerEffect.effectId, prerequisiteEvaluationId: prerequisite.evaluationId,
      matchedFact: fact,
      grounds: {
        matchType: 'EXACT_FACT_AND_VALUE', producerState: SATISFIED, consumerState: SATISFIED,
        reason: `${edge.from}のeffectが、同じ対象に対する${edge.to}の必須条件を成立させました。`,
      },
    };
  }).sort((a, b) => a.edgeId.localeCompare(b.edgeId));

  const executionConstraints = plan.edges.filter(edge => edge.kind === 'ORDERING').map(edge => {
    const [source, predicate, args] = JSON.parse(edge.key);
    const writer = definitions.get(edge.to).effects.find(effect => effect.source === source
      && effect.predicate === predicate
      && sameValues(effect.args.map(arg => bindingsByAttack.get(edge.to).get(arg.slice(1))), args));
    return {
      before: nodeId(edge.from), after: nodeId(edge.to), reasonCode: 'STATE_WRITE_CONFLICT',
      fact: { source, predicate, args, value: writer?.value ?? false },
    };
  }).sort((a, b) => canonical(a).localeCompare(canonical(b)));

  const ids = nodes.map(node => node.nodeId);
  const parts = graphParts(ids, enables);
  const signature = canonical({ nodes: ids, edges: enables.map(edge => ({ from: edge.from, to: edge.to,
    fact: edge.matchedFact })), executionConstraints });
  return {
    signature,
    graph: {
      schemaVersion: '1.0', graphId: `graph_${digest(signature).slice(0, 16)}`, state: SATISFIED,
      structure: parts.structure,
      selectedAttackIds: [...input.candidate.selectedAttackIds].sort(),
      rootNodeIds: parts.roots, leafNodeIds: parts.leaves,
      nodes, edges: enables, executionConstraints, components: parts.components,
      sourcePlanOrders: [[...plan.order]],
    },
  };
}

function hasCycle(graph) {
  const outgoing = new Map(graph.nodes.map(node => [node.nodeId, []]));
  const indegree = new Map(graph.nodes.map(node => [node.nodeId, 0]));
  for (const edge of graph.edges) {
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let count = 0;
  for (let i = 0; i < queue.length; i++) {
    count += 1;
    for (const next of outgoing.get(queue[i])) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return count !== graph.nodes.length;
}

export function validateAttackGraph(graph) {
  validateDocument('attack-graph', graph);
  const unique = (items, field) => {
    if (new Set(items).size !== items.length) fail('DUPLICATE_ID', field, 'Attack Graph内の識別子が重複しています。');
  };
  unique(graph.nodes.map(node => node.nodeId), 'attack-graph.nodes.nodeId');
  unique(graph.nodes.map(node => node.attackDefinitionId), 'attack-graph.nodes.attackDefinitionId');
  unique(graph.edges.map(edge => edge.edgeId), 'attack-graph.edges.edgeId');
  unique(graph.components.map(component => component.componentId), 'attack-graph.components.componentId');
  unique(graph.nodes.flatMap(node => node.effects.map(effect => effect.effectId)), 'attack-graph.nodes.effects.effectId');
  unique(graph.nodes.flatMap(node => [
    ...node.evaluations.map(evaluation => evaluation.evaluationId),
    ...node.artifactEvaluations.flatMap(artifact => artifact.evaluations.map(evaluation => evaluation.evaluationId)),
  ]), 'attack-graph.nodes.evaluations.evaluationId');
  for (const node of graph.nodes) {
    unique(node.bindings.map(binding => binding.name), 'attack-graph.nodes.bindings.name');
    unique(node.referenceIds, 'attack-graph.nodes.referenceIds');
    unique(node.artifactEvaluations.map(artifact => artifact.artifactId), 'attack-graph.nodes.artifactEvaluations.artifactId');
    if (node.evaluations.some(evaluation => evaluation.state !== SATISFIED)) {
      fail('INVALID_NODE_STATE', 'attack-graph.nodes.evaluations', '成立nodeに未充足の必須条件があります。');
    }
    for (const evaluation of [...node.evaluations,
      ...node.artifactEvaluations.flatMap(artifact => artifact.evaluations)]) {
      if ((evaluation.origin === 'ATTACK_EFFECT') !== Boolean(evaluation.producerNodeId)) {
        fail('BROKEN_GRAPH_GROUND', 'attack-graph.nodes.evaluations', '評価の由来とproducer参照が一致しません。');
      }
    }
  }
  if (!sameValues([...graph.selectedAttackIds].sort(), graph.nodes.map(node => node.attackDefinitionId).sort())) {
    fail('SELECTION_MISMATCH', 'attack-graph.nodes', '選択攻撃とAttack Graphのnodeが一致しません。');
  }
  const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to) || edge.from === edge.to) {
      fail('BROKEN_REFERENCE', 'attack-graph.edges', 'edgeのnode参照が不正です。');
    }
    const effect = nodes.get(edge.from).effects.find(item => item.effectId === edge.effectId);
    const evaluation = nodes.get(edge.to).evaluations.find(item => item.evaluationId === edge.prerequisiteEvaluationId);
    if (!effect || !evaluation || factKey(effect) !== factKey(edge.matchedFact)
      || effect.value !== edge.matchedFact.value || evaluation.field !== `${edge.matchedFact.source}.${edge.matchedFact.predicate}`
      || !sameValues(evaluation.args, edge.matchedFact.args)
      || !evaluation.expectedValues.includes(edge.matchedFact.value)
      || evaluation.producerNodeId !== edge.from) {
      fail('BROKEN_GRAPH_GROUND', 'attack-graph.edges', 'edgeの成立根拠をnodeへ追跡できません。');
    }
  }
  for (const constraint of graph.executionConstraints) {
    if (!nodes.has(constraint.before) || !nodes.has(constraint.after) || constraint.before === constraint.after) {
      fail('BROKEN_REFERENCE', 'attack-graph.executionConstraints', '実行制約のnode参照が不正です。');
    }
  }
  if (hasCycle(graph)) fail('CYCLIC_DEPENDENCY', 'attack-graph.edges', '因果依存に循環があります。');
  for (const order of graph.sourcePlanOrders) {
    if (!sameValues([...order].sort(), [...graph.selectedAttackIds].sort())) {
      fail('SELECTION_MISMATCH', 'attack-graph.sourcePlanOrders', '成立順序に選択攻撃の過不足があります。');
    }
  }
  const parts = graphParts([...nodes.keys()], graph.edges);
  if (graph.structure !== parts.structure || !sameValues(graph.rootNodeIds, parts.roots)
    || !sameValues(graph.leafNodeIds, parts.leaves) || !sameValues(graph.components, parts.components)) {
    fail('INVALID_GRAPH_SHAPE', 'attack-graph', 'Attack Graphの形状情報がedgeと一致しません。');
  }
  return graph;
}

function buildIssues(result) {
  const issues = result.issues.map(issue => {
    const isEvaluation = issue.code === 'MISSING_INFORMATION' || issue.code === 'CONDITION_NOT_MET';
    const reachability = issue.field === 'requiredReachability';
    const state = isEvaluation ? issue.state : null;
    return {
      code: !isEvaluation ? issue.code
        : reachability ? (state === UNKNOWN ? 'REACHABILITY_UNKNOWN' : 'REACHABILITY_DENIED')
          : state === UNKNOWN ? 'REQUIRED_CONDITION_UNKNOWN' : 'REQUIRED_CONDITION_UNSATISFIED',
      category: !isEvaluation ? 'INVALID_INPUT'
        : state === UNKNOWN ? 'MISSING_INFORMATION' : 'TECHNICAL_INFEASIBILITY',
      state,
      attackId: issue.attackId ?? null,
      field: issue.field,
      subjects: issue.args ?? [],
      reason: issue.reason,
      suggestion: issue.suggestion,
      sourceRefs: issue.attackId ? [`attackDefinitions.${issue.attackId}`] : [],
    };
  });
  if (!issues.length) issues.push({
    code: 'NO_VALID_PLAN', category: 'TECHNICAL_INFEASIBILITY', state: result.state,
    attackId: null, field: 'candidate', subjects: [],
    reason: '選択したすべての攻撃が成立する計画を構築できません。',
    suggestion: '各攻撃の成立条件、対象割当て、ネットワーク到達性を確認してください。', sourceRefs: [],
  });
  return [...new Map(issues.map(issue => [canonical(issue), issue])).values()];
}

export function validateAttackGraphResult(result) {
  validateDocument('attack-graph-result', result);
  result.graphs.forEach(validateAttackGraph);
  if (result.status === 'CREATED') {
    if (result.evaluationState !== SATISFIED || !result.graphs.length || result.issues.length) {
      fail('INVALID_GRAPH_RESULT', 'attack-graph-result', '生成成功結果の状態・graph・issuesが整合しません。');
    }
  } else if (result.graphs.length || !result.issues.length || result.evaluationState === SATISFIED) {
    fail('INVALID_GRAPH_RESULT', 'attack-graph-result', '生成停止結果の状態・graph・issuesが整合しません。');
  }
  return result;
}

// 対象割当ては既存candidateから受け取る。ここでは対象・条件・攻撃を追加または推測しない。
export function buildAttackGraphs(input) {
  let inputDigest;
  try { inputDigest = digest(input); }
  catch {
    inputDigest = digest('invalid-non-json-input');
    const result = {
      schemaVersion: '1.0', status: 'BLOCKED', evaluationState: null,
      scope: 'CANDIDATE_FEASIBILITY_ONLY', inputDigest, graphs: [], issues: [{
        code: 'INVALID_INPUT', category: 'INVALID_INPUT', state: null, attackId: null,
        field: 'input', subjects: [], reason: '入力をJSONデータとして処理できません。',
        suggestion: '循環参照を含まないJSONオブジェクトを指定してください。', sourceRefs: [],
      }],
    };
    return validateAttackGraphResult(result);
  }
  const evaluation = evaluateCandidate(input);
  if (evaluation.state !== SATISFIED || !evaluation.plans.length) {
    const validationFailure = evaluation.issues.some(issue => !['MISSING_INFORMATION', 'CONDITION_NOT_MET'].includes(issue.code));
    return validateAttackGraphResult({
      schemaVersion: '1.0', status: 'BLOCKED',
      evaluationState: validationFailure ? null : evaluation.state,
      scope: 'CANDIDATE_FEASIBILITY_ONLY', inputDigest, graphs: [], issues: buildIssues(evaluation),
    });
  }

  const grouped = new Map();
  for (const plan of evaluation.plans) {
    const { signature, graph } = buildGraph(plan, input);
    const existing = grouped.get(signature);
    if (existing) {
      if (!existing.sourcePlanOrders.some(order => sameValues(order, plan.order))) {
        existing.sourcePlanOrders.push([...plan.order]);
      }
    } else grouped.set(signature, graph);
  }
  const graphs = [...grouped.values()].map(graph => {
    graph.sourcePlanOrders.sort((a, b) => canonical(a).localeCompare(canonical(b)));
    return validateAttackGraph(graph);
  }).sort((a, b) => a.graphId.localeCompare(b.graphId));
  return validateAttackGraphResult({
    schemaVersion: '1.0', status: 'CREATED', evaluationState: SATISFIED,
    scope: 'CANDIDATE_FEASIBILITY_ONLY', inputDigest, graphs, issues: [],
  });
}
