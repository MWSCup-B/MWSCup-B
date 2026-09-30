import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAttackGraphs } from '../server/generation/attack-graph.js';
import { loadCatalog } from '../server/generation/catalog.js';
import { buildScenarioGenerationInputs, importScenarioPackage }
  from '../server/generation/scenario-interface.js';
import {
  MAX_REVISION_ATTEMPTS,
  SCENARIO_VERIFICATION_PROMPT,
  buildScenarioReviewReferenceRules,
  buildScenarioVerificationInput,
  validateEvidenceAgentHandoff,
  validateScenarioRevisionFeedback,
  validateScenarioVerificationInput,
  validateScenarioVerificationResult,
  validateScenarioVerificationReview,
  verifyScenario,
} from '../server/generation/scenario-verifier.js';

const definitions = await loadCatalog();
const [network, context, candidate] = await Promise.all(['network', 'scenario-context', 'candidate'].map(async name =>
  JSON.parse(await readFile(new URL(`./fixtures/attack-catalog/${name}.json`, import.meta.url), 'utf8'))));
const source = { definitions: structuredClone(definitions), network: structuredClone(network),
  context: structuredClone(context), candidate: structuredClone(candidate) };
const attackGraphResult = buildAttackGraphs(source);
const generationInput = buildScenarioGenerationInputs({ ...source, attackGraphResult })[0];

function scenarioPackage(input = generationInput) {
  const graph = input.technicalInput.attackGraph;
  const scenarioId = 'scenario_verification_fixture';
  const attackGraphRef = { ...input.attackGraphRef };
  const characters = {
    schemaVersion: '1.0', characterSetId: 'characters_verification', scenarioId, attackGraphRef,
    characters: [
      { characterId: 'character_defendant', displayName: '被告人',
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['defendant'], bindingRefs: [] },
      { characterId: 'character_attacker', displayName: '別の攻撃者',
        provenance: 'AI_GENERATED_SYNTHETIC', roles: ['attacker'], bindingRefs: [] },
    ],
  };
  const technicalFacts = [
    ...graph.nodes.map(node => ({ factId: `fact_${node.nodeId}`, sourceType: 'ATTACK_NODE',
      attackNodeId: node.nodeId, sourceId: node.nodeId })),
    ...graph.edges.map(edge => ({ factId: `fact_${edge.edgeId}`, sourceType: 'ATTACK_EDGE',
      attackNodeId: null, sourceId: edge.edgeId })),
  ];
  const groundTruth = {
    schemaVersion: '1.0', groundTruthId: 'ground_truth_verification', scenarioId, attackGraphRef,
    technicalFacts, characterFactRefs: [
      { characterId: 'character_defendant', role: 'defendant' },
      { characterId: 'character_attacker', role: 'attacker' },
    ],
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
    schemaVersion: '1.0', timelineId: 'timeline_verification', scenarioId, attackGraphRef,
    events, narrativeTimestamps: [],
  };
  const firstNode = graph.nodes[0];
  const firstDefinition = input.technicalInput.attackDefinitions
    .find(item => item.id === firstNode.attackDefinitionId);
  const learningObjectives = {
    schemaVersion: '1.0', learningObjectiveSetId: 'objectives_verification', scenarioId, attackGraphRef,
    objectives: [{
      objectiveId: 'objective_attack_trace', description: '選択攻撃の技術的痕跡を調査する。',
      origin: 'DERIVED_FROM_TECHNICAL_INPUT', selectedAttackIds: [firstNode.attackDefinitionId],
      attackNodeIds: [firstNode.nodeId], definitionReferenceRefs: [{
        attackDefinitionId: firstDefinition.id, referenceId: firstNode.referenceIds[0],
      }],
    }],
  };
  const artifactNode = graph.nodes.find(node => node.artifactEvaluations.some(item => item.state === 'SATISFIED'));
  const artifact = artifactNode.artifactEvaluations.find(item => item.state === 'SATISFIED');
  const evidenceRequirements = {
    schemaVersion: '1.0', evidenceRequirementSetId: 'requirements_verification', scenarioId, attackGraphRef,
    requirements: [
      { requirementId: 'requirement_attack', purpose: 'ATTACK_TRACE',
        description: '観測可能な技術痕跡から攻撃経路を確認する。',
        grounds: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT', sourceId: artifact.artifactId,
          attackNodeId: artifactNode.nodeId }], learningObjectiveIds: ['objective_attack_trace'] },
      { requirementId: 'requirement_timeline', purpose: 'TIMELINE_PROOF',
        description: '技術イベントの順序を確認する。',
        grounds: [{ sourceType: 'TIMELINE_EVENT', sourceId: events[0].eventId, attackNodeId: null }],
        learningObjectiveIds: [] },
      { requirementId: 'requirement_contradiction', purpose: 'CONTRADICTION_PROOF',
        description: '主張と技術的事実の矛盾を確認する。',
        grounds: [{ sourceType: 'GROUND_TRUTH_FACT', sourceId: technicalFacts[0].factId,
          attackNodeId: null }], learningObjectiveIds: [] },
      { requirementId: 'requirement_exoneration', purpose: 'EXONERATION_PROOF',
        description: '端末利用記録だけで人物を断定できないことを確認する。',
        grounds: [{ sourceType: 'CHARACTER', sourceId: 'character_defendant', attackNodeId: null }],
        learningObjectiveIds: [] },
    ],
  };
  const scenarioDraft = {
    schemaVersion: '1.0', scenarioId, state: 'DRAFT', attackGraphRef,
    groundTruthId: groundTruth.groundTruthId, characterSetId: characters.characterSetId,
    timelineId: timeline.timelineId, learningObjectiveSetId: learningObjectives.learningObjectiveSetId,
    evidenceRequirementSetId: evidenceRequirements.evidenceRequirementSetId,
  };
  return {
    schemaVersion: '1.0', generationInputRef: {
      generationInputId: input.generationInputId,
      inputDigest: input.attackGraphRef.inputDigest, graphId: input.attackGraphRef.graphId,
    },
    scenarioDraft, groundTruth, characters, timeline, learningObjectives, evidenceRequirements,
  };
}

const basePackage = scenarioPackage();
const baseImportResult = importScenarioPackage({ generationInput, scenarioPackage: basePackage });

function verificationInput({ attempt = 0, referenceContents = [] } = {}) {
  return buildScenarioVerificationInput({
    generationInput: structuredClone(generationInput), importResult: structuredClone(baseImportResult),
    scenarioPackage: structuredClone(basePackage), referenceContents, revisionAttemptsUsed: attempt,
  });
}

function semanticReview(input, outcomes = {}) {
  const requirementRef = input.allowedReviewRefs.find(item => item.startsWith('evidenceRequirement:'));
  const objectiveRef = input.allowedReviewRefs.find(item => item.startsWith('learningObjective:'));
  const factRef = input.allowedReviewRefs.find(item => item.startsWith('groundTruth.fact:'));
  const characterRef = input.allowedReviewRefs.find(item => item.startsWith('character:'));
  const materialRef = input.allowedReviewRefs.find(item => item.startsWith('referenceMaterial:'));
  const nodeRef = input.allowedReviewRefs.find(item => item.startsWith('attackGraph.node:'));
  const evidenceSourceRef = input.allowedReviewRefs.find(item => item.startsWith('attackGraph.artifact:'))
    ?? input.allowedReviewRefs.find(item => item.startsWith('timeline.event:'));
  const definitions = [
    ['EVIDENCE_GROUND_ALIGNMENT', requirementRef, evidenceSourceRef, 'evidenceRequirements.requirements'],
    ['LEARNING_OBJECTIVE_ALIGNMENT', objectiveRef, nodeRef, 'learningObjectives.objectives'],
    ['FACT_NARRATIVE_SEPARATION', factRef, factRef, 'groundTruth.technicalFacts'],
    ['IDENTITY_ATTRIBUTION', characterRef, factRef, 'characters.characters'],
    ['INVESTIGATION_COVERAGE', requirementRef, evidenceSourceRef, 'evidenceRequirements.requirements'],
    ['REFERENCE_CONTENT_ALIGNMENT', materialRef, materialRef, 'referenceMaterials'],
  ];
  const hasContent = input.referenceMaterials.some(item => item.availability === 'CONTENT_AVAILABLE');
  return {
    schemaVersion: '1.0', reviewId: 'review_independent_fixture',
    reviewerRole: 'INDEPENDENT_VERIFICATION_REVIEWER', subjectFingerprint: input.inputFingerprint,
    scenarioGeneratorSelfAssessmentUsed: false, technicalFactsModified: false,
    checks: definitions.map(([category, subjectRef, sourceRef, field]) => {
      const outcome = outcomes[category]
        ?? (category === 'REFERENCE_CONTENT_ALIGNMENT' && !hasContent ? 'NOT_APPLICABLE' : 'PASS');
      return {
        checkId: `review_${category.toLowerCase()}`, category, outcome, field,
        reason: `${category}の独立レビュー結果です。`,
        correctionHint: ['FAIL', 'UNKNOWN'].includes(outcome)
          ? '技術境界を変更せず、対象成果物の説明または要件を修正してください。' : null,
        subjectRefs: [subjectRef], sourceRefs: [sourceRef],
      };
    }),
  };
}

function verificationInputWithCaseFact() {
  const packageWithObservation = structuredClone(basePackage);
  const node = generationInput.technicalInput.attackGraph.nodes
    .find(item => item.state === 'SATISFIED'
      && item.artifactEvaluations.some(artifact => artifact.state === 'SATISFIED'));
  const artifact = node.artifactEvaluations.find(item => item.state === 'SATISFIED');
  packageWithObservation.characters.characters.push({
    characterId: 'character_observer', displayName: '第三者の立会人',
    provenance: 'AI_GENERATED_SYNTHETIC', roles: ['witness'], bindingRefs: [],
  });
  packageWithObservation.groundTruth.characterFactRefs.push({
    characterId: 'character_observer', role: 'witness',
  });
  packageWithObservation.groundTruth.caseFacts = [{
    schemaVersion: '1.0', factId: 'case_observation_review_fixture', attackNodeId: node.nodeId,
    witnessCharacterId: 'character_observer', subjectCharacterId: 'character_attacker',
    excludedCharacterId: 'character_defendant', observation: '対象操作を行う人物を直接確認した。',
    relatedArtifactIds: [artifact.artifactId],
  }];
  const importResult = importScenarioPackage({ generationInput, scenarioPackage: packageWithObservation });
  assert.equal(importResult.status, 'VALID');
  return buildScenarioVerificationInput({ generationInput, importResult,
    scenarioPackage: packageWithObservation });
}

test('実在するCASE_FACTの参照を人物帰属と関連する意味レビューの根拠に使用できる', () => {
  const input = verificationInputWithCaseFact();
  const factRef = 'caseFact:case_observation_review_fixture';
  const rules = buildScenarioReviewReferenceRules(input);
  assert.ok(input.allowedReviewRefs.includes(factRef));
  const categories = ['EVIDENCE_GROUND_ALIGNMENT', 'FACT_NARRATIVE_SEPARATION',
    'IDENTITY_ATTRIBUTION', 'INVESTIGATION_COVERAGE'];
  const review = semanticReview(input);
  for (const category of categories) {
    assert.ok(rules[category].sourceRefs.includes(factRef));
    review.checks.find(check => check.category === category).sourceRefs = [factRef];
  }
  assert.equal(validateScenarioVerificationReview(review, input), review);
  assert.equal(verifyScenario({ verificationInput: input, semanticReview: review }).status, 'VERIFIED');
});

test('CASE_FACTの未知IDや誤prefixは拒否し、不正参照とcategoryを限定長で示す', () => {
  const input = verificationInputWithCaseFact();
  for (const ref of ['caseFact:invented', 'groundTruth.fact:case_observation_review_fixture',
    'groundTruth.caseFacts[0]', `caseFact:${'x'.repeat(500)}`]) {
    const review = semanticReview(input);
    const check = review.checks.find(item => item.category === 'IDENTITY_ATTRIBUTION');
    check.sourceRefs = [ref];
    assert.throws(() => validateScenarioVerificationReview(review, input), error => {
      assert.equal(error.code, 'UNSUPPORTED_REVIEW_REFERENCE');
      assert.match(error.field, /review_identity_attribution\.sourceRefs\[0\]$/);
      assert.match(error.message, /IDENTITY_ATTRIBUTION.*sourceRefs\[0\]=/);
      assert.ok(error.message.includes(ref.slice(0, 80)));
      assert.ok(error.message.length < 800);
      return true;
    });
    assert.equal(verifyScenario({ verificationInput: input, semanticReview: review }).status, 'BLOCKED');
  }
});

test('不正参照の診断は先頭3件に制限し、制御文字をそのまま出さない', () => {
  const input = verificationInputWithCaseFact();
  const review = semanticReview(input);
  const check = review.checks.find(item => item.category === 'IDENTITY_ATTRIBUTION');
  check.subjectRefs = ['character:invented\n\r\t\u001b'];
  check.sourceRefs = Array.from({ length: 4 }, (_, index) => `caseFact:missing_${index}`);
  assert.throws(() => validateScenarioVerificationReview(review, input), error => {
    assert.equal(error.code, 'UNSUPPORTED_REVIEW_REFERENCE');
    assert.match(error.field, /\.subjectRefs\[0\]$/);
    assert.match(error.message, /ほか2件/);
    assert.doesNotMatch(error.message, /[\n\r\t\u001b]/);
    assert.ok(error.message.length < 800);
    return true;
  });
});

test('CASE_FACTを人物帰属の対象にしたり無関係なcategoryの唯一の根拠にしない', () => {
  const input = verificationInputWithCaseFact();
  const factRef = 'caseFact:case_observation_review_fixture';
  for (const [category, field] of [['IDENTITY_ATTRIBUTION', 'subjectRefs'],
    ['LEARNING_OBJECTIVE_ALIGNMENT', 'sourceRefs'], ['REFERENCE_CONTENT_ALIGNMENT', 'sourceRefs']]) {
    const review = semanticReview(input);
    review.checks.find(check => check.category === category)[field] = [factRef];
    assert.throws(() => validateScenarioVerificationReview(review, input), { code: 'IRRELEVANT_REVIEW_GROUND' });
  }
});

test('Deterministic Verificationと独立意味的レビューの両方を通過してVERIFIEDにする', () => {
  const input = verificationInput();
  const review = semanticReview(input);
  const before = structuredClone({ input, review });
  const result = verifyScenario({ verificationInput: input, semanticReview: review });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.evidenceAgentEligible, true);
  assert.equal(result.checks.length, 13);
  assert.ok(result.checks.every(item => ['PASS', 'NOT_APPLICABLE'].includes(item.outcome)));
  assert.equal(result.issues.length, 0);
  assert.equal(validateScenarioVerificationResult(result), result);
  assert.equal(validateEvidenceAgentHandoff(result.evidenceAgentHandoff), result.evidenceAgentHandoff);
  assert.deepEqual({ input, review }, before);
});

test('独立レビューなし・自己評価利用・未知参照をBLOCKEDにする', () => {
  const input = verificationInput();
  assert.equal(verifyScenario({ verificationInput: input }).status, 'BLOCKED');

  const selfReview = semanticReview(input);
  selfReview.scenarioGeneratorSelfAssessmentUsed = true;
  const selfResult = verifyScenario({ verificationInput: input, semanticReview: selfReview });
  assert.equal(selfResult.status, 'BLOCKED');
  assert.equal(selfResult.issues[0].category, 'INDEPENDENT_REVIEW');

  const invented = semanticReview(input);
  invented.checks[0].sourceRefs = ['attackGraph.node:invented'];
  assert.equal(verifyScenario({ verificationInput: input, semanticReview: invented }).status, 'BLOCKED');
});

test('意味的FAILとUNKNOWNをNEEDS_REVISIONおよび構造化Feedbackにする', () => {
  const input = verificationInput({ attempt: 1 });
  const review = semanticReview(input, {
    EVIDENCE_GROUND_ALIGNMENT: 'FAIL', IDENTITY_ATTRIBUTION: 'UNKNOWN',
  });
  const result = verifyScenario({ verificationInput: input, semanticReview: review });
  assert.equal(result.status, 'NEEDS_REVISION');
  assert.equal(result.evidenceAgentEligible, false);
  assert.equal(result.evidenceAgentHandoff, null);
  assert.equal(result.revisionFeedback.revisionTargets.length, 2);
  assert.deepEqual(result.revisionFeedback.attempt, {
    revisionAttemptsUsed: 1, maxRevisionAttempts: 3, nextRevisionAttempt: 2,
  });
  assert.equal(result.revisionFeedback.technicalBoundary.mustRemainUnchanged, true);
  assert.equal(validateScenarioRevisionFeedback(result.revisionFeedback), result.revisionFeedback);
});

test('攻撃経路・時系列・矛盾・無罪論証の目的不足をNEEDS_REVISIONにする', () => {
  const incompletePackage = structuredClone(basePackage);
  incompletePackage.evidenceRequirements.requirements = incompletePackage.evidenceRequirements.requirements
    .filter(item => item.purpose !== 'EXONERATION_PROOF');
  const importResult = importScenarioPackage({ generationInput, scenarioPackage: incompletePackage });
  assert.equal(importResult.status, 'VALID');
  const input = buildScenarioVerificationInput({ generationInput, importResult,
    scenarioPackage: incompletePackage });
  const result = verifyScenario({ verificationInput: input, semanticReview: semanticReview(input) });
  assert.equal(result.status, 'NEEDS_REVISION');
  assert.ok(result.issues.some(item => item.code === 'EVIDENCE_PURPOSE_COVERAGE_INCOMPLETE'));
  assert.equal(result.evidenceAgentHandoff, null);
});

test('3回目の修正版に不備が残る場合はREVISION_LIMIT_EXCEEDEDでBLOCKEDにする', () => {
  const input = verificationInput({ attempt: MAX_REVISION_ATTEMPTS });
  const result = verifyScenario({ verificationInput: input,
    semanticReview: semanticReview(input, { INVESTIGATION_COVERAGE: 'FAIL' }) });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.issues.some(item => item.code === 'REVISION_LIMIT_EXCEEDED'));
  assert.equal(result.revisionFeedback, null);
  assert.equal(result.evidenceAgentHandoff, null);
});

test('技術入力・Attack Graph・Phase 5B結果の改変を独立再計算でBLOCKEDにする', () => {
  for (const mutate of [
    input => { input.generationInput.technicalInput.network.nodes[0].roles.push('invented_role'); },
    input => { input.generationInput.technicalInput.attackGraph.nodes[0].evaluations[0].state = 'UNKNOWN'; },
    input => { input.importResult.status = 'INVALID'; },
  ]) {
    const input = verificationInput();
    mutate(input);
    const result = verifyScenario({ verificationInput: input, semanticReview: semanticReview(input) });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.evidenceAgentHandoff, null);
    assert.ok(result.issues.some(item => item.disposition === 'BLOCK'));
  }
});

test('Ground Truth・Timeline・Evidence Requirementの改変をBLOCKEDにする', () => {
  const mutations = [
    input => { input.scenarioPackage.groundTruth.technicalFacts.pop(); },
    input => { input.scenarioPackage.timeline.events.find(item => item.dependsOn.length).dependsOn = []; },
    input => {
      const ground = input.scenarioPackage.evidenceRequirements.requirements[0].grounds[0];
      ground.sourceId = 'artifact_invented';
    },
  ];
  for (const mutate of mutations) {
    const input = verificationInput();
    mutate(input);
    const result = verifyScenario({ verificationInput: input, semanticReview: semanticReview(input) });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.evidenceAgentEligible, false);
  }
});

test('登録referenceIdと資料metadataを照合し、本文がある場合だけ内容レビューを要求する', () => {
  const metadata = verificationInput();
  const metadataReview = semanticReview(metadata);
  assert.equal(metadataReview.checks.find(item => item.category === 'REFERENCE_CONTENT_ALIGNMENT').outcome,
    'NOT_APPLICABLE');
  assert.equal(verifyScenario({ verificationInput: metadata, semanticReview: metadataReview }).status, 'VERIFIED');

  const reference = generationInput.technicalInput.attackDefinitions
    .find(item => item.id === generationInput.technicalInput.attackGraph.nodes[0].attackDefinitionId)
    .references[0];
  const withContent = verificationInput({ referenceContents: [{
    attackDefinitionId: generationInput.technicalInput.attackGraph.nodes[0].attackDefinitionId,
    referenceId: reference.id, content: '検証用に提供された合成資料本文。',
  }] });
  const failed = verifyScenario({ verificationInput: withContent,
    semanticReview: semanticReview(withContent, { REFERENCE_CONTENT_ALIGNMENT: 'FAIL' }) });
  assert.equal(failed.status, 'BLOCKED');
  assert.ok(failed.issues.some(item => item.code === 'REFERENCE_CONTENT_ALIGNMENT_FAIL'));
});

test('Review必須6項目、fingerprint、本文有無とNOT_APPLICABLEの矛盾を拒否する', () => {
  const input = verificationInput();
  const missing = semanticReview(input);
  missing.checks.pop();
  assert.throws(() => validateScenarioVerificationReview(missing, input));
  const other = semanticReview(input);
  other.subjectFingerprint = '0'.repeat(64);
  assert.throws(() => validateScenarioVerificationReview(other, input), { code: 'REVIEW_SUBJECT_MISMATCH' });
  const wrongOutcome = semanticReview(input, { REFERENCE_CONTENT_ALIGNMENT: 'PASS' });
  assert.throws(() => validateScenarioVerificationReview(wrongOutcome, input), { code: 'INVALID_REVIEW_OUTCOME' });
});

test('Verification InputとResultのfingerprint・状態・Handoff矛盾を拒否する', () => {
  const input = verificationInput();
  assert.equal(validateScenarioVerificationInput(input), input);
  const changed = structuredClone(input);
  changed.scenarioPackage.characters.characters[0].displayName = '改変名';
  assert.throws(() => validateScenarioVerificationInput(changed), { code: 'VERIFICATION_INPUT_MISMATCH' });

  const result = verifyScenario({ verificationInput: input, semanticReview: semanticReview(input) });
  const inconsistent = structuredClone(result);
  inconsistent.status = 'NEEDS_REVISION';
  assert.throws(() => validateScenarioVerificationResult(inconsistent), { code: 'INVALID_VERIFICATION_RESULT' });
  const noHandoff = structuredClone(result);
  noHandoff.evidenceAgentHandoff = null;
  assert.throws(() => validateScenarioVerificationResult(noHandoff), { code: 'INVALID_VERIFICATION_RESULT' });
  const otherHandoff = structuredClone(result);
  otherHandoff.evidenceAgentHandoff.verificationId = 'verification_other';
  assert.throws(() => validateScenarioVerificationResult(otherHandoff),
    { code: 'INVALID_VERIFICATION_RESULT' });
});

test('Verification Promptは技術変更・自己評価・自由文章出力を禁止する', () => {
  assert.match(SCENARIO_VERIFICATION_PROMPT, /Scenario Generatorとは独立/);
  assert.match(SCENARIO_VERIFICATION_PROMPT, /UNKNOWN.*補完しない/);
  assert.match(SCENARIO_VERIFICATION_PROMPT, /合計6件/);
  assert.match(SCENARIO_VERIFICATION_PROMPT, /JSONオブジェクトを1件だけ/);
});
