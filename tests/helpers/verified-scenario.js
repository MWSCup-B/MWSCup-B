import { readFile } from 'node:fs/promises';
import { buildAttackGraphs } from '../../server/generation/attack-graph.js';
import { loadCatalog } from '../../server/generation/catalog.js';
import { buildScenarioGenerationInputs, importScenarioPackage }
  from '../../server/generation/scenario-interface.js';
import { buildScenarioVerificationInput, verifyScenario }
  from '../../server/generation/scenario-verifier.js';

const definitions = await loadCatalog();
const [network, context, candidate] = await Promise.all(['network', 'scenario-context', 'candidate'].map(async name =>
  JSON.parse(await readFile(new URL(`../fixtures/attack-catalog/${name}.json`, import.meta.url), 'utf8'))));
const source = { definitions, network, context, candidate };
const graphResult = buildAttackGraphs(source);
const generationInput = buildScenarioGenerationInputs({ ...source, attackGraphResult: graphResult })[0];

export function makeScenarioPackage(input) {
  const graph = input.technicalInput.attackGraph;
  const scenarioId = 'scenario_evidence_fixture';
  const attackGraphRef = { ...input.attackGraphRef };
  const characters = {
    schemaVersion: '1.0', characterSetId: 'characters_evidence', scenarioId, attackGraphRef,
    characters: [
      { characterId: 'character_defendant', displayName: '架空の被告人',
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['defendant'], bindingRefs: [] },
      { characterId: 'character_attacker', displayName: '架空の攻撃者',
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['attacker'], bindingRefs: [] },
      { characterId: 'character_witness', displayName: '架空の証言者',
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['witness'], bindingRefs: [] },
    ],
  };
  const technicalFacts = [
    ...graph.nodes.map(node => ({ factId: `fact_${node.nodeId}`, sourceType: 'ATTACK_NODE',
      attackNodeId: node.nodeId, sourceId: node.nodeId })),
    ...graph.edges.map(edge => ({ factId: `fact_${edge.edgeId}`, sourceType: 'ATTACK_EDGE',
      attackNodeId: null, sourceId: edge.edgeId })),
  ];
  const groundTruth = {
    schemaVersion: '1.0', groundTruthId: 'ground_truth_evidence', scenarioId, attackGraphRef,
    technicalFacts, characterFactRefs: characters.characters.map(character => ({
      characterId: character.characterId, role: character.roles[0],
    })),
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
  const events = graph.nodes.map(node => ({ eventId: `event_${node.nodeId}`, order: rank(node.nodeId),
    attackNodeId: node.nodeId, dependsOn: [...predecessors.get(node.nodeId)]
      .map(id => `event_${id}`).sort() }));
  const timeline = { schemaVersion: '1.0', timelineId: 'timeline_evidence', scenarioId,
    attackGraphRef, events, narrativeTimestamps: [] };
  const firstNode = graph.nodes[0];
  const firstDefinition = input.technicalInput.attackDefinitions
    .find(item => item.id === firstNode.attackDefinitionId);
  const learningObjectives = {
    schemaVersion: '1.0', learningObjectiveSetId: 'objectives_evidence', scenarioId, attackGraphRef,
    objectives: [{ objectiveId: 'objective_trace', description: '技術痕跡を調査する。',
      origin: 'DERIVED_FROM_TECHNICAL_INPUT', selectedAttackIds: [firstNode.attackDefinitionId],
      attackNodeIds: [firstNode.nodeId], definitionReferenceRefs: [{
        attackDefinitionId: firstDefinition.id, referenceId: firstNode.referenceIds[0],
      }] }],
  };
  const artifactNode = graph.nodes.find(node => node.artifactEvaluations.some(item => item.state === 'SATISFIED'));
  const observable = artifactNode.artifactEvaluations.find(item => item.state === 'SATISFIED');
  const evidenceRequirements = {
    schemaVersion: '1.0', evidenceRequirementSetId: 'requirements_evidence', scenarioId, attackGraphRef,
    requirements: [
      { requirementId: 'requirement_attack', purpose: 'ATTACK_TRACE', description: '攻撃痕跡を確認する。',
        grounds: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT', sourceId: observable.artifactId,
          attackNodeId: artifactNode.nodeId }], learningObjectiveIds: ['objective_trace'] },
      { requirementId: 'requirement_timeline', purpose: 'TIMELINE_PROOF', description: '順序を確認する。',
        grounds: [{ sourceType: 'TIMELINE_EVENT', sourceId: events[0].eventId, attackNodeId: null }],
        learningObjectiveIds: [] },
      { requirementId: 'requirement_contradiction', purpose: 'CONTRADICTION_PROOF',
        description: '証言と技術痕跡の矛盾を確認する。', grounds: [{ sourceType: 'GROUND_TRUTH_FACT',
          sourceId: technicalFacts[0].factId, attackNodeId: null }], learningObjectiveIds: [] },
      { requirementId: 'requirement_exoneration', purpose: 'EXONERATION_PROOF',
        description: '複数根拠から人物断定の誤りを確認する。', grounds: [{ sourceType: 'CHARACTER',
          sourceId: 'character_defendant', attackNodeId: null }], learningObjectiveIds: [] },
    ],
  };
  const scenarioDraft = { schemaVersion: '1.0', scenarioId, state: 'DRAFT', attackGraphRef,
    groundTruthId: groundTruth.groundTruthId, characterSetId: characters.characterSetId,
    timelineId: timeline.timelineId, learningObjectiveSetId: learningObjectives.learningObjectiveSetId,
    evidenceRequirementSetId: evidenceRequirements.evidenceRequirementSetId };
  return { schemaVersion: '1.0', generationInputRef: {
    generationInputId: input.generationInputId, inputDigest: input.attackGraphRef.inputDigest,
    graphId: input.attackGraphRef.graphId }, scenarioDraft, groundTruth, characters, timeline,
  learningObjectives, evidenceRequirements };
}

function semanticReview(input) {
  const find = prefix => input.allowedReviewRefs.find(item => item.startsWith(prefix));
  const rows = [
    ['EVIDENCE_GROUND_ALIGNMENT', find('evidenceRequirement:'), find('attackGraph.artifact:'), 'evidenceRequirements.requirements'],
    ['LEARNING_OBJECTIVE_ALIGNMENT', find('learningObjective:'), find('attackGraph.node:'), 'learningObjectives.objectives'],
    ['FACT_NARRATIVE_SEPARATION', find('groundTruth.fact:'), find('groundTruth.fact:'), 'groundTruth.technicalFacts'],
    ['IDENTITY_ATTRIBUTION', find('character:'), find('groundTruth.fact:'), 'characters.characters'],
    ['INVESTIGATION_COVERAGE', find('evidenceRequirement:'), find('timeline.event:'), 'evidenceRequirements.requirements'],
    ['REFERENCE_CONTENT_ALIGNMENT', find('referenceMaterial:'), find('referenceMaterial:'), 'referenceMaterials'],
  ];
  return { schemaVersion: '1.0', reviewId: 'review_evidence_fixture',
    reviewerRole: 'INDEPENDENT_VERIFICATION_REVIEWER', subjectFingerprint: input.inputFingerprint,
    scenarioGeneratorSelfAssessmentUsed: false, technicalFactsModified: false,
    checks: rows.map(([category, subject, sourceRef, field]) => ({
      checkId: `review_${category.toLowerCase()}`, category,
      outcome: category === 'REFERENCE_CONTENT_ALIGNMENT' ? 'NOT_APPLICABLE' : 'PASS', field,
      reason: '独立レビューで整合性を確認した。', correctionHint: null,
      subjectRefs: [subject], sourceRefs: [sourceRef],
    })) };
}

const scenarioPackage = makeScenarioPackage(generationInput);
const importResult = importScenarioPackage({ generationInput, scenarioPackage });
const verificationInput = buildScenarioVerificationInput({ generationInput, importResult, scenarioPackage });
const verificationResult = verifyScenario({ verificationInput, semanticReview: semanticReview(verificationInput) });

export function verifiedScenarioFixture(input = generationInput) {
  if (input === generationInput) {
    return structuredClone({ generationInput, scenarioPackage, importResult, verificationInput,
      verificationResult });
  }
  const packageForInput = makeScenarioPackage(input);
  const imported = importScenarioPackage({ generationInput: input,
    scenarioPackage: packageForInput });
  const verificationForInput = buildScenarioVerificationInput({ generationInput: input,
    importResult: imported, scenarioPackage: packageForInput });
  const verified = verifyScenario({ verificationInput: verificationForInput,
    semanticReview: semanticReview(verificationForInput) });
  return structuredClone({ generationInput: input, scenarioPackage: packageForInput,
    importResult: imported, verificationInput: verificationForInput,
    verificationResult: verified });
}

export { semanticReview };
