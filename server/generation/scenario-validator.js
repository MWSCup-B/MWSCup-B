import { validateCatalog } from './catalog.js';
import { validateAttackGraphResult } from './attack-graph.js';
import { fail, validateDocument, ValidationError } from './schema.js';
import { incidentProfile } from './incident-design.js';

class ScenarioContractError extends ValidationError {
  constructor(code, field, message, suggestion, relatedIds = []) {
    super(code, field, message);
    Object.assign(this, { suggestion, relatedIds });
  }
}

function stop(code, field, message, suggestion, relatedIds = []) {
  throw new ScenarioContractError(code, field, message, suggestion, relatedIds);
}

function ensureUnique(items, key, field) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) stop('DUPLICATE_ID', field, '同じ識別子または参照が重複しています。',
      '重複を取り除き、各識別子と参照を一意にしてください。', [String(value)]);
    seen.add(value);
  }
}

function ensureGraphRef(actual, expected, field) {
  if (actual.inputDigest !== expected.inputDigest || actual.graphId !== expected.graphId) {
    stop('GRAPH_REFERENCE_MISMATCH', field,
    'Scenario Contract内で異なるAttack Graphが参照されています。',
    'すべての成果物を同じinputDigestとgraphIdへ揃えてください。',
    [actual?.graphId, expected.graphId].filter(Boolean));
  }
}

function ensureScenarioId(actual, expected, field) {
  if (actual !== expected) stop('SCENARIO_ID_MISMATCH', field,
    '成果物のscenarioIdがScenario Draftと一致しません。',
    '同じScenarioに属する成果物だけを組み合わせてください。', [actual, expected]);
}

function validateGroundTruth(groundTruth, graph, characters, definitions) {
  ensureUnique(groundTruth.technicalFacts, item => item.factId, 'ground-truth.technicalFacts.factId');
  ensureUnique(groundTruth.technicalFacts,
    item => JSON.stringify([item.sourceType, item.attackNodeId, item.sourceId]),
    'ground-truth.technicalFacts');
  const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
  const edges = new Map(graph.edges.map(edge => [edge.edgeId, edge]));
  for (const fact of groundTruth.technicalFacts) {
    if (fact.sourceType === 'ATTACK_EDGE') {
      if (fact.attackNodeId !== null || !edges.has(fact.sourceId)) stop('UNGROUNDED_GROUND_TRUTH',
        `ground-truth.technicalFacts.${fact.factId}`, 'Attack Graph edgeへ追跡できないtechnical factです。',
        '同じAttack Graphに存在するedgeIdを指定し、attackNodeIdはnullにしてください。', [fact.sourceId]);
      continue;
    }
    const node = nodes.get(fact.attackNodeId);
    if (!node) stop('CROSS_GRAPH_REFERENCE', `ground-truth.technicalFacts.${fact.factId}.attackNodeId`,
      'technical factのAttack nodeが参照中のgraphに存在しません。',
      '別graphのnodeを混在させず、参照中のgraph内のnodeIdを指定してください。', [fact.attackNodeId]);
    if (fact.sourceType === 'ATTACK_NODE' && fact.sourceId !== node.nodeId) {
      stop('UNGROUNDED_GROUND_TRUTH', `ground-truth.technicalFacts.${fact.factId}.sourceId`,
        'Attack node factのsourceIdがattackNodeIdと一致しません。',
        '同じnodeIdをsourceIdとattackNodeIdに指定してください。', [fact.sourceId, node.nodeId]);
    }
    if (fact.sourceType === 'NODE_EVALUATION'
      && !node.evaluations.some(item => item.evaluationId === fact.sourceId)) {
      stop('UNGROUNDED_GROUND_TRUTH', `ground-truth.technicalFacts.${fact.factId}.sourceId`,
        'node evaluationへ追跡できないtechnical factです。',
        '指定Attack nodeに存在するevaluationIdを使用してください。', [fact.sourceId]);
    }
    if (fact.sourceType === 'NODE_EFFECT' && !node.effects.some(item => item.effectId === fact.sourceId)) {
      stop('UNGROUNDED_GROUND_TRUTH', `ground-truth.technicalFacts.${fact.factId}.sourceId`,
        'node effectへ追跡できないtechnical factです。',
        '指定Attack nodeに存在するeffectIdを使用してください。', [fact.sourceId]);
    }
  }
  const nodeFacts = new Set(groundTruth.technicalFacts.filter(item => item.sourceType === 'ATTACK_NODE')
    .map(item => item.sourceId));
  const edgeFacts = new Set(groundTruth.technicalFacts.filter(item => item.sourceType === 'ATTACK_EDGE')
    .map(item => item.sourceId));
  if (graph.nodes.some(node => !nodeFacts.has(node.nodeId)) || nodeFacts.size !== graph.nodes.length
    || graph.edges.some(edge => !edgeFacts.has(edge.edgeId)) || edgeFacts.size !== graph.edges.length) {
    stop('UNGROUNDED_GROUND_TRUTH', 'ground-truth.technicalFacts',
      'Attack Graphの全nodeと全edgeをGround Truthから追跡できません。',
      '各Attack nodeと各因果edgeを1件ずつtechnical factとして参照してください。');
  }
  const characterMap = new Map(characters.characters.map(character => [character.characterId, character]));
  const caseFacts = groundTruth.caseFacts ?? [];
  ensureUnique([...groundTruth.technicalFacts, ...caseFacts], item => item.factId,
    'ground-truth.caseFacts.factId');
  for (const fact of caseFacts) {
    const field = `ground-truth.caseFacts.${fact.factId}`;
    const node = nodes.get(fact.attackNodeId);
    if (!node || node.state !== 'SATISFIED') stop('CASE_FACT_UNGROUNDED', `${field}.attackNodeId`,
      '事件内の観察対象が成立済みのAttack nodeを参照していません。',
      '同じGraphの成立済みnodeへ対応付け、技術条件の代用にしないでください。', [fact.attackNodeId]);
    const people = [fact.witnessCharacterId, fact.subjectCharacterId, fact.excludedCharacterId];
    if (new Set(people).size !== people.length
      || !characterMap.get(fact.witnessCharacterId)?.roles.includes('witness')
      || !characterMap.get(fact.subjectCharacterId)?.roles.includes('attacker')
      || !characterMap.get(fact.excludedCharacterId)?.roles.includes('defendant')) {
      stop('CASE_FACT_CHARACTER_MISMATCH', field,
        '直接観察者・観察対象・被告人の人物参照または役割が一致しません。',
        '証言者、攻撃者、被告人を異なる実在のCharacterへ対応付けてください。', people);
    }
    ensureUnique(fact.relatedArtifactIds, id => id, `${field}.relatedArtifactIds`);
    for (const artifactId of fact.relatedArtifactIds) {
      const artifact = node.artifactEvaluations.find(item => item.artifactId === artifactId);
      if (!artifact || artifact.state !== 'SATISFIED'
        || artifact.evaluations.some(item => item.state !== 'SATISFIED')) stop('CASE_FACT_ARTIFACT_UNAVAILABLE',
        `${field}.relatedArtifactIds`, '事件内の観察と照合する技術資料が取得可能ではありません。',
        '同じAttack nodeにあり、観測条件が成立した資料だけを参照してください。', [artifactId]);
    }
  }
  ensureUnique(groundTruth.characterFactRefs, item => JSON.stringify([item.characterId, item.role]),
    'ground-truth.characterFactRefs');
  for (const ref of groundTruth.characterFactRefs) {
    const character = characterMap.get(ref.characterId);
    if (!character || !character.roles.includes(ref.role)) stop('BROKEN_REFERENCE',
      'ground-truth.characterFactRefs', 'Characterまたはそのroleへの参照が不正です。',
      'Character Setに明示されたcharacterIdとroleを指定してください。', [ref.characterId, ref.role]);
  }
  for (const narrative of groundTruth.incidentNarratives ?? []) {
    const node = nodes.get(narrative.attackNodeId), profile = incidentProfile(definitions, node?.attackDefinitionId);
    const effect = node?.effects.find(item => item.effectId === narrative.impactEffectId);
    if (!profile || effect?.predicate !== profile.impactEffectPredicate || node.state !== 'SATISFIED'
      || narrative.attackerCharacterId === narrative.defendantCharacterId
      || !characterMap.get(narrative.attackerCharacterId)?.roles.includes('attacker')
      || !characterMap.get(narrative.defendantCharacterId)?.roles.includes('defendant')
      || narrative.attackerAction !== profile.attackerAction
      || narrative.impact !== profile.impact || narrative.allegation !== profile.allegation
      || narrative.prosecutionKnowledge !== profile.prosecutionKnowledge
      || narrative.causalRefutation !== profile.causalRefutation
      || narrative.verdictBasis !== profile.verdictBasis
      || profile.requiredArtifactIds.length !== narrative.requiredArtifactIds.length
      || profile.requiredArtifactIds.some(id => !narrative.requiredArtifactIds.includes(id)
        || !node.artifactEvaluations.some(item => item.artifactId === id && item.state === 'SATISFIED'))) {
      stop('INCIDENT_NARRATIVE_UNGROUNDED', 'ground-truth.incidentNarratives',
        '事件の被害・人物・必要資料が検証対象の攻撃と一致しません。',
        '成立した被害effect、別の攻撃主体、取得可能な資料を同一Graphへ対応付けてください。');
    }
  }
}

function validateCharacters(characters, graph) {
  ensureUnique(characters.characters, item => item.characterId, 'character.characters.characterId');
  const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
  for (const character of characters.characters) {
    ensureUnique(character.roles, role => role, `character.characters.${character.characterId}.roles`);
    ensureUnique(character.bindingRefs,
      ref => JSON.stringify([ref.attackNodeId, ref.bindingName, ref.entityId]),
      `character.characters.${character.characterId}.bindingRefs`);
    for (const ref of character.bindingRefs) {
      const node = nodes.get(ref.attackNodeId);
      const binding = node?.bindings.find(item => item.name === ref.bindingName);
      if (!node || !binding || binding.entityId !== ref.entityId) stop('CROSS_GRAPH_REFERENCE',
        `character.characters.${character.characterId}.bindingRefs`,
        'Characterのbinding参照が選択Attack Graphの実在割当てと一致しません。',
        '同じgraph nodeに存在するbindingNameとentityIdの組を指定してください。',
        [ref.attackNodeId, ref.bindingName, ref.entityId]);
    }
  }
}

function validateTimeline(timeline, graph) {
  ensureUnique(timeline.events, item => item.eventId, 'timeline.events.eventId');
  ensureUnique(timeline.events, item => item.attackNodeId, 'timeline.events.attackNodeId');
  ensureUnique(timeline.narrativeTimestamps, item => item.eventId, 'timeline.narrativeTimestamps.eventId');
  const graphNodeIds = new Set(graph.nodes.map(node => node.nodeId));
  const eventsById = new Map(timeline.events.map(event => [event.eventId, event]));
  const eventsByNode = new Map(timeline.events.map(event => [event.attackNodeId, event]));
  if (timeline.events.length !== graph.nodes.length
    || timeline.events.some(event => !graphNodeIds.has(event.attackNodeId))) {
    stop('TIMELINE_NODE_MISMATCH', 'timeline.events',
      'TimelineはAttack Graphの各nodeをちょうど1件ずつ含む必要があります。',
      '選択graphのnodeごとに1件のeventを定義し、別graphのnodeを除外してください。');
  }
  for (const event of timeline.events) {
    if (!Number.isSafeInteger(event.order) || event.order < 0) stop('INVALID_TIMELINE_ORDER',
      `timeline.events.${event.eventId}.order`, 'orderは0以上の安全な整数で指定してください。',
      '技術的な依存順序を表す整数へ修正してください。', [event.eventId]);
    ensureUnique(event.dependsOn, id => id, `timeline.events.${event.eventId}.dependsOn`);
    for (const dependency of event.dependsOn) {
      const previous = eventsById.get(dependency);
      if (!previous || dependency === event.eventId) stop('BROKEN_REFERENCE',
        `timeline.events.${event.eventId}.dependsOn`, 'Timelineの依存event参照が不正です。',
        '同じTimeline内の別eventIdを指定してください。', [event.eventId, dependency]);
      if (previous.order >= event.order) stop('INVALID_TIMELINE_ORDER',
        `timeline.events.${event.eventId}.order`, '依存先eventより後のorderになっていません。',
        'dependsOnの全eventより大きいorderを指定してください。', [previous.eventId, event.eventId]);
    }
  }
  const expected = new Set([
    ...graph.edges.map(edge => JSON.stringify([edge.from, edge.to])),
    ...graph.executionConstraints.map(item => JSON.stringify([item.before, item.after])),
  ]);
  const actual = new Set(timeline.events.flatMap(event => event.dependsOn.map(dependency =>
    JSON.stringify([eventsById.get(dependency).attackNodeId, event.attackNodeId]))));
  if (expected.size !== actual.size || [...expected].some(pair => !actual.has(pair))) {
    stop('TIMELINE_DEPENDENCY_MISMATCH', 'timeline.events.dependsOn',
      'Timeline依存関係がAttack Graphの因果edgeと実行制約に一致しません。',
      '因果edgeとexecution constraintだけをdependsOnへ反映してください。');
  }
  for (const timestamp of timeline.narrativeTimestamps) {
    if (!eventsById.has(timestamp.eventId)) stop('BROKEN_REFERENCE', 'timeline.narrativeTimestamps.eventId',
      'Narrative timestampのevent参照が存在しません。',
      '同じTimeline内のeventIdを指定してください。', [timestamp.eventId]);
  }
  return eventsByNode;
}

function validateObjectives(learningObjectives, graph, definitions) {
  ensureUnique(learningObjectives.objectives, item => item.objectiveId,
    'learning-objective.objectives.objectiveId');
  const attackIds = new Set(graph.selectedAttackIds);
  const nodeIds = new Set(graph.nodes.map(node => node.nodeId));
  const catalog = new Map(definitions.map(definition => [definition.id, definition]));
  for (const objective of learningObjectives.objectives) {
    ensureUnique(objective.selectedAttackIds, id => id,
      `learning-objective.objectives.${objective.objectiveId}.selectedAttackIds`);
    ensureUnique(objective.attackNodeIds, id => id,
      `learning-objective.objectives.${objective.objectiveId}.attackNodeIds`);
    ensureUnique(objective.definitionReferenceRefs,
      ref => JSON.stringify([ref.attackDefinitionId, ref.referenceId]),
      `learning-objective.objectives.${objective.objectiveId}.definitionReferenceRefs`);
    if (objective.selectedAttackIds.some(id => !attackIds.has(id))
      || objective.attackNodeIds.some(id => !nodeIds.has(id))) {
      stop('CROSS_GRAPH_REFERENCE', `learning-objective.objectives.${objective.objectiveId}`,
        'Learning Objectiveが選択Attack Graph外の攻撃またはnodeを参照しています。',
        '同じAttack GraphのselectedAttackIdsとnodeIdsだけを使用してください。', [objective.objectiveId]);
    }
    for (const ref of objective.definitionReferenceRefs) {
      const definition = catalog.get(ref.attackDefinitionId);
      if (!attackIds.has(ref.attackDefinitionId)
        || !definition?.references.some(reference => reference.id === ref.referenceId)) {
        stop('BROKEN_REFERENCE', `learning-objective.objectives.${objective.objectiveId}.definitionReferenceRefs`,
          'Attack Definitionのreference参照が不正です。',
          '選択攻撃のAttack Definitionに存在するreference IDを指定してください。',
          [ref.attackDefinitionId, ref.referenceId]);
      }
    }
    if (objective.origin === 'DERIVED_FROM_TECHNICAL_INPUT'
      && (!objective.selectedAttackIds.length || !objective.attackNodeIds.length
        || !objective.definitionReferenceRefs.length)) {
      stop('INVALID_DERIVATION_SOURCE', `learning-objective.objectives.${objective.objectiveId}`,
        '自動導出扱いのLearning Objectiveに必要な3種類の技術根拠がありません。',
        'selected attack、Attack Graph node、Attack Definition referenceをすべて明示してください。',
        [objective.objectiveId]);
    }
  }
}

function validateEvidence(evidenceRequirements, graph, groundTruth, characters, timeline, learningObjectives) {
  ensureUnique(evidenceRequirements.requirements, item => item.requirementId,
    'evidence-requirement.requirements.requirementId');
  const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
  const timelineIds = new Set(timeline.events.map(event => event.eventId));
  const factIds = new Set(groundTruth.technicalFacts.map(fact => fact.factId));
  const caseFacts = new Map((groundTruth.caseFacts ?? []).map(fact => [fact.factId, fact]));
  const characterIds = new Set(characters.characters.map(character => character.characterId));
  const objectiveIds = new Set(learningObjectives.objectives.map(objective => objective.objectiveId));
  for (const requirement of evidenceRequirements.requirements) {
    if (requirement.purpose === 'IDENTITY_PROOF'
      || requirement.grounds.some(ground => ground.sourceType === 'CASE_FACT')) stop(
      'PLAYER_CASE_REPORT_FORBIDDEN', `evidence-requirement.requirements.${requirement.requirementId}`,
      '内部用の直接観察記録・調査報告は、プレイヤー向け資料や必須証拠にできません。技術資料の取得要件を指定してください。');
    ensureUnique(requirement.grounds,
      ground => JSON.stringify([ground.sourceType, ground.attackNodeId, ground.sourceId]),
      `evidence-requirement.requirements.${requirement.requirementId}.grounds`);
    ensureUnique(requirement.learningObjectiveIds, id => id,
      `evidence-requirement.requirements.${requirement.requirementId}.learningObjectiveIds`);
    if (requirement.learningObjectiveIds.some(id => !objectiveIds.has(id))) stop('BROKEN_REFERENCE',
      `evidence-requirement.requirements.${requirement.requirementId}.learningObjectiveIds`,
      'Evidence RequirementのLearning Objective参照が存在しません。',
      '同じScenario内に存在するobjectiveIdを指定してください。', requirement.learningObjectiveIds);
    for (const ground of requirement.grounds) {
      if (ground.sourceType === 'ATTACK_GRAPH_ARTIFACT') {
        const artifact = nodes.get(ground.attackNodeId)?.artifactEvaluations
          .find(item => item.artifactId === ground.sourceId);
        if (!artifact) stop('CROSS_GRAPH_REFERENCE',
          `evidence-requirement.requirements.${requirement.requirementId}.grounds`,
          'Technical Evidence Requirementのartifactが選択graph nodeに存在しません。',
          '同じgraph nodeのobservable artifactを指定してください。', [ground.attackNodeId, ground.sourceId]);
        if (artifact.state !== 'SATISFIED') stop('ARTIFACT_NOT_OBSERVABLE',
          `evidence-requirement.requirements.${requirement.requirementId}.grounds`,
          'UNKNOWNまたはUNSATISFIEDのartifactは取得可能な証拠要件にできません。',
          '観測条件を明示的に満たすartifactを使用するか、入力を修正してください。',
          [ground.attackNodeId, ground.sourceId]);
      } else if (ground.sourceType === 'CASE_FACT') {
        const fact = caseFacts.get(ground.sourceId);
        if (!fact || ground.attackNodeId !== fact.attackNodeId) stop('BROKEN_REFERENCE',
          `evidence-requirement.requirements.${requirement.requirementId}.grounds`,
          '事件内観察の参照先またはAttack nodeが一致しません。',
          'caseFactsのfactIdと同じattackNodeIdを指定してください。', [ground.sourceId, ground.attackNodeId].filter(Boolean));
      } else {
        if (ground.attackNodeId !== null) stop('BROKEN_REFERENCE',
          `evidence-requirement.requirements.${requirement.requirementId}.grounds.attackNodeId`,
          'Attack Graph artifact以外のgroundではattackNodeIdを使用できません。',
          'attackNodeIdをnullにし、sourceIdで対象を参照してください。', [ground.sourceId]);
        const exists = ground.sourceType === 'TIMELINE_EVENT' ? timelineIds.has(ground.sourceId)
          : ground.sourceType === 'GROUND_TRUTH_FACT' ? factIds.has(ground.sourceId)
            : characterIds.has(ground.sourceId);
        if (!exists) stop('BROKEN_REFERENCE',
          `evidence-requirement.requirements.${requirement.requirementId}.grounds.sourceId`,
          'Evidence Requirementのground参照が存在しません。',
          '同じScenario内のTimeline、Ground Truth、またはCharacterのIDを指定してください。', [ground.sourceId]);
      }
    }
  }
}

export function validateScenarioValidationResult(result) {
  validateDocument('scenario-validation-result', result);
  const valid = result.status === 'VALID';
  if (valid === result.blocked || (valid && (!result.scenarioId || !result.attackGraphRef || result.issues.length))
    || (!valid && !result.issues.length)) {
    fail('INVALID_RESULT_STATE', 'scenario-validation-result.status', '検証状態とissueまたは参照が矛盾しています。');
  }
  return result;
}

function makeResult(status, scenarioId, attackGraphRef, issues = []) {
  return validateScenarioValidationResult({
    schemaVersion: '1.0', status, blocked: status === 'BLOCKED', scope: 'SCENARIO_CONTRACT_ONLY',
    scenarioId, attackGraphRef, issues,
  });
}

// 構造・参照整合性だけを検証し、Scenarioや不足情報を生成・補完しない。
export function validateScenarioContract(input) {
  let scenarioId = null;
  let attackGraphRef = null;
  try {
    const { attackGraphResult, definitions, scenarioDraft, groundTruth, characters, timeline,
      learningObjectives, evidenceRequirements } = input;
    validateDocument('scenario-draft', scenarioDraft);
    scenarioId = scenarioDraft.scenarioId;
    attackGraphRef = { ...scenarioDraft.attackGraphRef };
    validateDocument('ground-truth', groundTruth);
    validateDocument('character', characters);
    validateDocument('timeline', timeline);
    validateDocument('learning-objective', learningObjectives);
    validateDocument('evidence-requirement', evidenceRequirements);
    validateCatalog(definitions);
    validateAttackGraphResult(attackGraphResult);

    if (attackGraphResult.inputDigest !== attackGraphRef.inputDigest) stop('GRAPH_REFERENCE_MISMATCH',
      'scenario-draft.attackGraphRef.inputDigest', 'Attack Graph ResultのinputDigestと参照が一致しません。',
      'Scenario Draftが生成元のAttack Graph Resultを参照するよう修正してください。',
      [attackGraphRef.inputDigest, attackGraphResult.inputDigest]);
    const graph = attackGraphResult.graphs.find(item => item.graphId === attackGraphRef.graphId);
    if (attackGraphResult.status !== 'CREATED' || !graph) stop('GRAPH_NOT_FOUND',
      'scenario-draft.attackGraphRef.graphId', '参照する成立済みAttack GraphがResult内にありません。',
      'CREATEDなAttack Graph Resultに含まれるgraphIdを指定してください。', [attackGraphRef.graphId]);

    for (const [name, document] of [['ground-truth', groundTruth], ['character', characters],
      ['timeline', timeline], ['learning-objective', learningObjectives],
      ['evidence-requirement', evidenceRequirements]]) {
      ensureScenarioId(document.scenarioId, scenarioId, `${name}.scenarioId`);
      ensureGraphRef(document.attackGraphRef, attackGraphRef, `${name}.attackGraphRef`);
    }
    for (const [actual, expected, field] of [
      [groundTruth.groundTruthId, scenarioDraft.groundTruthId, 'scenario-draft.groundTruthId'],
      [characters.characterSetId, scenarioDraft.characterSetId, 'scenario-draft.characterSetId'],
      [timeline.timelineId, scenarioDraft.timelineId, 'scenario-draft.timelineId'],
      [learningObjectives.learningObjectiveSetId, scenarioDraft.learningObjectiveSetId,
        'scenario-draft.learningObjectiveSetId'],
      [evidenceRequirements.evidenceRequirementSetId, scenarioDraft.evidenceRequirementSetId,
        'scenario-draft.evidenceRequirementSetId'],
    ]) {
      if (actual !== expected) stop('BROKEN_REFERENCE', field, 'Scenario Draftの成果物ID参照が一致しません。',
        '実際の成果物IDをScenario Draftに指定してください。', [actual, expected]);
    }

    validateCharacters(characters, graph);
    validateGroundTruth(groundTruth, graph, characters, definitions);
    validateTimeline(timeline, graph);
    validateObjectives(learningObjectives, graph, definitions);
    validateEvidence(evidenceRequirements, graph, groundTruth, characters, timeline, learningObjectives);
    return makeResult('VALID', scenarioId, attackGraphRef);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return makeResult('BLOCKED', scenarioId, attackGraphRef, [{
      code: error.code, field: error.field, reason: error.message,
      suggestion: error.suggestion ?? 'Schema、Attack Graph、または成果物間の参照を確認してください。',
      relatedIds: error.relatedIds ?? [],
    }]);
  }
}
