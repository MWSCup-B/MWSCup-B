import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCatalog } from '../server/generation/catalog.js';
import { buildAttackGraphs } from '../server/generation/attack-graph.js';
import { validateScenarioContract,
  validateScenarioValidationResult } from '../server/generation/scenario-validator.js';

const definitions = await loadCatalog();
const [network, context, candidate] = await Promise.all(['network', 'scenario-context', 'candidate'].map(async name =>
  JSON.parse(await readFile(new URL(`./fixtures/attack-catalog/${name}.json`, import.meta.url), 'utf8'))));

function graphResult() {
  return buildAttackGraphs({ definitions: structuredClone(definitions), network: structuredClone(network),
    context: structuredClone(context), candidate: structuredClone(candidate) });
}

function contract(result = graphResult()) {
  const graph = result.graphs[0];
  const scenarioId = 'scenario_contract_fixture';
  const attackGraphRef = { inputDigest: result.inputDigest, graphId: graph.graphId };
  const characters = {
    schemaVersion: '1.0', characterSetId: 'characters_fixture', scenarioId,
    attackGraphRef: { ...attackGraphRef },
    characters: [
      { characterId: 'character_defendant', displayName: '合成被告人', provenance: 'USER_PROVIDED',
        roles: ['defendant'], bindingRefs: [] },
      { characterId: 'character_attacker', displayName: '合成攻撃者', provenance: 'AI_GENERATED_SYNTHETIC',
        roles: ['attacker'], bindingRefs: [
          { attackNodeId: 'attack_phishing', bindingName: 'attacker', entityId: 'actor-a' },
        ] },
      { characterId: 'character_victim', displayName: '合成被害者', provenance: 'AI_GENERATED_SYNTHETIC',
        roles: ['victim'], bindingRefs: [
          { attackNodeId: 'attack_phishing', bindingName: 'victim', entityId: 'user-a' },
        ] },
      { characterId: 'character_witness', displayName: '合成証言者', provenance: 'AI_GENERATED_SYNTHETIC',
        roles: ['witness'], bindingRefs: [] },
      { characterId: 'character_administrator', displayName: '合成管理者', provenance: 'AI_GENERATED_SYNTHETIC',
        roles: ['administrator'], bindingRefs: [] },
    ],
  };
  const technicalFacts = [
    ...graph.nodes.map(node => ({ factId: `fact_${node.nodeId}`, sourceType: 'ATTACK_NODE',
      attackNodeId: node.nodeId, sourceId: node.nodeId })),
    ...graph.edges.map(edge => ({ factId: `fact_${edge.edgeId}`, sourceType: 'ATTACK_EDGE',
      attackNodeId: null, sourceId: edge.edgeId })),
  ];
  const groundTruth = {
    schemaVersion: '1.0', groundTruthId: 'ground_truth_fixture', scenarioId,
    attackGraphRef: { ...attackGraphRef }, technicalFacts,
    characterFactRefs: characters.characters.map(item => ({ characterId: item.characterId, role: item.roles[0] })),
  };
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
  const timeline = {
    schemaVersion: '1.0', timelineId: 'timeline_fixture', scenarioId,
    attackGraphRef: { ...attackGraphRef }, events,
    narrativeTimestamps: [{ eventId: events[0].eventId, displayTimestamp: '教材時刻・午前' }],
  };
  const learningObjectives = {
    schemaVersion: '1.0', learningObjectiveSetId: 'objectives_fixture', scenarioId,
    attackGraphRef: { ...attackGraphRef },
    objectives: [
      { objectiveId: 'objective_user', description: '利用者が指定した合成学習目標', origin: 'USER_PROVIDED',
        selectedAttackIds: [], attackNodeIds: [], definitionReferenceRefs: [] },
      { objectiveId: 'objective_derived', description: '技術入力から導出される合成学習目標',
        origin: 'DERIVED_FROM_TECHNICAL_INPUT', selectedAttackIds: ['phishing'],
        attackNodeIds: ['attack_phishing'],
        definitionReferenceRefs: [{ attackDefinitionId: 'phishing', referenceId: 'mitre_phishing_link' }] },
    ],
  };
  const artifactNode = graph.nodes.find(node => node.artifactEvaluations.some(item => item.state === 'SATISFIED'));
  const artifact = artifactNode.artifactEvaluations.find(item => item.state === 'SATISFIED');
  const evidenceRequirements = {
    schemaVersion: '1.0', evidenceRequirementSetId: 'requirements_fixture', scenarioId,
    attackGraphRef: { ...attackGraphRef },
    requirements: [
      { requirementId: 'requirement_attack', purpose: 'ATTACK_TRACE', description: '技術痕跡の合成要件',
        grounds: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT', sourceId: artifact.artifactId,
          attackNodeId: artifactNode.nodeId }], learningObjectiveIds: ['objective_derived'] },
      { requirementId: 'requirement_timeline', purpose: 'TIMELINE_PROOF', description: '時系列の合成要件',
        grounds: [{ sourceType: 'TIMELINE_EVENT', sourceId: events[0].eventId, attackNodeId: null }],
        learningObjectiveIds: [] },
      { requirementId: 'requirement_contradiction', purpose: 'CONTRADICTION_PROOF', description: '矛盾確認の合成要件',
        grounds: [{ sourceType: 'GROUND_TRUTH_FACT', sourceId: technicalFacts[0].factId, attackNodeId: null }],
        learningObjectiveIds: [] },
      { requirementId: 'requirement_exoneration', purpose: 'EXONERATION_PROOF', description: '無罪論証の合成要件',
        grounds: [{ sourceType: 'GROUND_TRUTH_FACT', sourceId: technicalFacts[0].factId, attackNodeId: null }],
        learningObjectiveIds: ['objective_user'] },
    ],
  };
  const scenarioDraft = {
    schemaVersion: '1.0', scenarioId, state: 'DRAFT', attackGraphRef: { ...attackGraphRef },
    groundTruthId: groundTruth.groundTruthId, characterSetId: characters.characterSetId,
    timelineId: timeline.timelineId, learningObjectiveSetId: learningObjectives.learningObjectiveSetId,
    evidenceRequirementSetId: evidenceRequirements.evidenceRequirementSetId,
  };
  return { attackGraphResult: result, definitions: structuredClone(definitions), scenarioDraft,
    groundTruth, characters, timeline, learningObjectives, evidenceRequirements };
}

test('単一Attack Graphを参照するScenario Contract全体をVALIDにする', () => {
  const input = contract();
  const before = structuredClone(input);
  const result = validateScenarioContract(input);
  assert.equal(result.status, 'VALID');
  assert.equal(result.blocked, false);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(input, before);
  assert.deepEqual(new Set(input.characters.characters.flatMap(item => item.roles)),
    new Set(['defendant', 'attacker', 'victim', 'witness', 'administrator']));
  const artifactCount = input.attackGraphResult.graphs[0].nodes
    .flatMap(node => node.artifactEvaluations).length;
  assert.ok(input.evidenceRequirements.requirements
    .filter(item => item.grounds.some(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT')).length
    < artifactCount);
});

function caseFactContract() {
  const input = contract();
  const ground = input.evidenceRequirements.requirements[0].grounds[0];
  const fact = { schemaVersion: '1.0', factId: 'case_fact_observation', attackNodeId: ground.attackNodeId,
    witnessCharacterId: 'character_witness', subjectCharacterId: 'character_attacker',
    excludedCharacterId: 'character_defendant', observation: '同席者は、その人物が保全対象のメールを作成する場面を見た。',
    relatedArtifactIds: [ground.sourceId] };
  input.groundTruth.caseFacts = [fact];
  return input;
}

test('case observations stay internal and separate from technical facts', () => {
  const input = caseFactContract();
  const before = structuredClone(input);
  const result = validateScenarioContract(input);
  assert.equal(result.status, 'VALID', JSON.stringify(result.issues));
  assert.deepEqual(input, before);
  assert.ok(!input.groundTruth.technicalFacts.some(item => item.factId === input.groundTruth.caseFacts[0].factId));
});

test('case observations reject missing people, shared identities, unavailable sources and cross-node references', () => {
  for (const [label, mutate, code] of [
    ['duplicate technical ID', input => { input.groundTruth.caseFacts[0].factId = input.groundTruth.technicalFacts[0].factId; }, 'DUPLICATE_ID'],
    ['missing node', input => { input.groundTruth.caseFacts[0].attackNodeId = 'attack_missing'; }, 'CASE_FACT_UNGROUNDED'],
    ['missing witness', input => { input.groundTruth.caseFacts[0].witnessCharacterId = 'character_missing'; }, 'CASE_FACT_CHARACTER_MISMATCH'],
    ['same attacker and defendant', input => { input.groundTruth.caseFacts[0].excludedCharacterId = 'character_attacker'; }, 'CASE_FACT_CHARACTER_MISMATCH'],
    ['witness is subject', input => { input.groundTruth.caseFacts[0].witnessCharacterId = 'character_attacker'; }, 'CASE_FACT_CHARACTER_MISMATCH'],
    ['missing observable', input => { input.groundTruth.caseFacts[0].relatedArtifactIds = ['unknown_record']; }, 'CASE_FACT_ARTIFACT_UNAVAILABLE'],
  ]) {
    const input = caseFactContract(); mutate(input);
    const result = validateScenarioContract(input);
    assert.equal(result.status, 'BLOCKED', label);
    assert.equal(result.issues[0].code, code, `${label}: ${JSON.stringify(result.issues)}`);
  }
  const exposed = caseFactContract();
  const fact = exposed.groundTruth.caseFacts[0];
  exposed.evidenceRequirements.requirements.find(item => item.requirementId === 'requirement_exoneration')
    .grounds.push({ sourceType: 'CASE_FACT', sourceId: fact.factId, attackNodeId: fact.attackNodeId });
  assert.equal(validateScenarioContract(exposed).issues[0].code, 'UNSUPPORTED_VALUE');
});

test('成果物間のgraphIdまたはinputDigest不一致を拒否する', () => {
  for (const mutate of [
    input => { input.groundTruth.attackGraphRef.graphId = 'graph_other'; },
    input => { input.timeline.attackGraphRef.inputDigest = '0'.repeat(64); },
  ]) {
    const input = contract(); mutate(input);
    const result = validateScenarioContract(input);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.issues[0].code, 'GRAPH_REFERENCE_MISMATCH');
  }
});

test('Ground Truthをgraphのnode・edge・evaluation・effectへだけ追跡可能にする', () => {
  const valid = contract();
  const graphNode = valid.attackGraphResult.graphs[0].nodes[0];
  valid.groundTruth.technicalFacts.push(
    { factId: 'fact_evaluation', sourceType: 'NODE_EVALUATION', attackNodeId: graphNode.nodeId,
      sourceId: graphNode.evaluations[0].evaluationId },
    { factId: 'fact_effect', sourceType: 'NODE_EFFECT', attackNodeId: graphNode.nodeId,
      sourceId: graphNode.effects[0].effectId },
  );
  assert.equal(validateScenarioContract(valid).status, 'VALID');

  const missing = contract();
  missing.groundTruth.technicalFacts.pop();
  assert.equal(validateScenarioContract(missing).issues[0].code, 'UNGROUNDED_GROUND_TRUTH');
  const invented = contract();
  invented.groundTruth.technicalFacts.push({ factId: 'fact_invented', sourceType: 'NODE_EFFECT',
    attackNodeId: invented.attackGraphResult.graphs[0].nodes[0].nodeId, sourceId: 'effect_missing' });
  assert.equal(validateScenarioContract(invented).issues[0].code, 'UNGROUNDED_GROUND_TRUTH');
});

test('Character provenanceを区別し、binding名やroleから対象を推測しない', () => {
  const noCharacters = contract();
  noCharacters.characters.characters = [];
  noCharacters.groundTruth.characterFactRefs = [];
  noCharacters.evidenceRequirements.requirements = noCharacters.evidenceRequirements.requirements
    .filter(item => !item.grounds.some(ground => ground.sourceType === 'CHARACTER'));
  assert.equal(validateScenarioContract(noCharacters).status, 'VALID');

  const input = contract();
  assert.deepEqual(new Set(input.characters.characters.map(item => item.provenance)),
    new Set(['USER_PROVIDED', 'AI_GENERATED_SYNTHETIC']));
  input.characters.characters.find(item => item.characterId === 'character_attacker')
    .bindingRefs[0].entityId = 'user-a';
  const result = validateScenarioContract(input);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.issues[0].code, 'CROSS_GRAPH_REFERENCE');
});

test('Timelineをgraph nodeと根拠付き依存関係へ完全一致させる', () => {
  const missing = contract();
  const dependent = missing.timeline.events.find(event => event.dependsOn.length);
  dependent.dependsOn = [];
  assert.equal(validateScenarioContract(missing).issues[0].code, 'TIMELINE_DEPENDENCY_MISMATCH');

  const reversed = contract();
  const later = reversed.timeline.events.find(event => event.dependsOn.length);
  later.order = 0;
  assert.equal(validateScenarioContract(reversed).issues[0].code, 'INVALID_TIMELINE_ORDER');

  const self = contract();
  self.timeline.events[0].dependsOn = [self.timeline.events[0].eventId];
  assert.equal(validateScenarioContract(self).issues[0].code, 'BROKEN_REFERENCE');

  const narrative = contract();
  narrative.timeline.narrativeTimestamps[0].displayTimestamp = '順序判定に使用しない教材用表示';
  assert.equal(validateScenarioContract(narrative).status, 'VALID');
});

test('Learning Objectiveの任意入力と技術導出根拠を区別する', () => {
  const empty = contract();
  empty.learningObjectives.objectives = [];
  empty.evidenceRequirements.requirements.forEach(item => { item.learningObjectiveIds = []; });
  assert.equal(validateScenarioContract(empty).status, 'VALID');

  const missingGround = contract();
  missingGround.learningObjectives.objectives.find(item => item.origin === 'DERIVED_FROM_TECHNICAL_INPUT')
    .definitionReferenceRefs = [];
  assert.equal(validateScenarioContract(missingGround).issues[0].code, 'INVALID_DERIVATION_SOURCE');

  const brokenReference = contract();
  brokenReference.learningObjectives.objectives[1].definitionReferenceRefs[0].referenceId = 'missing';
  assert.equal(validateScenarioContract(brokenReference).issues[0].code, 'BROKEN_REFERENCE');
});

test('artifact以外のEvidence Requirementを許可し、観測不能artifactは拒否する', () => {
  const valid = contract();
  assert.deepEqual(new Set(valid.evidenceRequirements.requirements.map(item => item.purpose)),
    new Set(['ATTACK_TRACE', 'TIMELINE_PROOF', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF']));
  assert.equal(validateScenarioContract(valid).status, 'VALID');

  const unknown = contract();
  const ground = unknown.evidenceRequirements.requirements[0].grounds[0];
  const artifact = unknown.attackGraphResult.graphs[0].nodes.find(node => node.nodeId === ground.attackNodeId)
    .artifactEvaluations.find(item => item.artifactId === ground.sourceId);
  artifact.state = 'UNKNOWN';
  const result = validateScenarioContract(unknown);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.issues[0].code, 'ARTIFACT_NOT_OBSERVABLE');
});

test('Scenario ID・成果物ID・Character role参照の不一致を拒否する', () => {
  for (const [mutate, code] of [
    [input => { input.characters.scenarioId = 'scenario_other'; }, 'SCENARIO_ID_MISMATCH'],
    [input => { input.scenarioDraft.timelineId = 'timeline_other'; }, 'BROKEN_REFERENCE'],
    [input => { input.groundTruth.characterFactRefs[0].role = 'attacker'; }, 'BROKEN_REFERENCE'],
  ]) {
    const input = contract(); mutate(input);
    assert.equal(validateScenarioContract(input).issues[0].code, code);
  }
});

test('未知フィールド・重複ID・結果状態の矛盾を拒否する', () => {
  const unknown = contract();
  unknown.scenarioDraft.narrative = '未承認フィールド';
  assert.equal(validateScenarioContract(unknown).issues[0].code, 'UNKNOWN_FIELD');
  const duplicate = contract();
  duplicate.characters.characters.push(structuredClone(duplicate.characters.characters[0]));
  assert.equal(validateScenarioContract(duplicate).issues[0].code, 'DUPLICATE_ID');
  const result = validateScenarioContract(contract());
  const inconsistent = structuredClone(result);
  inconsistent.status = 'BLOCKED';
  assert.throws(() => validateScenarioValidationResult(inconsistent), { code: 'INVALID_RESULT_STATE' });
});
