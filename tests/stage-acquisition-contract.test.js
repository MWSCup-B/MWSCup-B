import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAuthorBootstrap } from '../server/auto-generation-service.js';
import { loadCatalog } from '../server/generation/catalog.js';
import { createSelectionConfiguration } from '../server/generation/scenario-selection.js';
import { validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildScenarioTemplate, validateScenarioEvidenceCoverage } from '../server/generation/scenario-template.js';
import { importScenarioPackage } from '../server/generation/scenario-interface.js';
import { buildInvestigationStages } from '../server/generation/investigation-registry.js';
import { stageEvidenceProblems } from '../server/generation/scenario-stage-plan.js';

const catalog = await loadCatalog();
const bootstrap = autoAuthorBootstrap();
const key = ground => `${ground.sourceType}/${ground.attackNodeId}/${ground.sourceId}`;

test('every selectable path and setting has attack-local, ordered, obtainable technical requirements only', () => {
  for (const attackIds of bootstrap.attackSelectionPaths) for (const setting of bootstrap.settings) {
    const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds, settingId: setting.id }, catalog);
    const validation = validateScenarioConfiguration(configuration, catalog);
    assert.equal(validation.status, 'VALID');
    const generationInput = validation.technical.generationInput;
    const before = structuredClone({ configuration, generationInput });
    const scenarioPackage = buildScenarioTemplate({ configuration, generationInput });
    const value = { configuration, generationInput, scenarioPackage };
    assert.equal(importScenarioPackage(value).status, 'VALID');
    assert.deepEqual(validateScenarioEvidenceCoverage(value), [], attackIds.join('+'));
    const claims = scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage)
      .map(item => item.investigationStage.claim.normalize('NFKC').replace(/\s/g, ''));
    assert.equal(new Set(claims).size, claims.length, 'Separate stages require distinct, source-specific claims');
    const stages = buildInvestigationStages(configuration, generationInput);
    assert.equal(scenarioPackage.groundTruth.caseFacts?.length ?? 0, 0);
    assert.ok(scenarioPackage.evidenceRequirements.requirements.every(requirement => requirement.purpose !== 'IDENTITY_PROOF'
      && requirement.grounds.every(ground => ground.sourceType !== 'CASE_FACT')));
    const acquired = new Set();
    for (const [index, stage] of stages.entries()) {
      for (const route of stage.routes) {
        assert.equal(route.ground.attackNodeId, stage.attackNodeId);
        assert.ok(!acquired.has(key(route.ground)), 'A source is acquired once, even on a shared host');
        acquired.add(key(route.ground));
      }
    }
    for (const requirement of scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage)) {
      assert.ok(requirement.grounds.every(ground => acquired.has(key(ground))));
      assert.doesNotMatch(`${requirement.description} ${requirement.investigationStage.expectedInference}`,
        /CASE_FACT|caseSupport|調査報告|直接観察/);
    }
    assert.deepEqual({ configuration, generationInput }, before, 'Planning must not alter technical inputs');
  }
});

test('internal observation data never becomes a player investigation route', () => {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds: ['stored_xss'], settingId: 'company' }, catalog);
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const scenarioPackage = buildScenarioTemplate({ configuration, generationInput });
  const stages = buildInvestigationStages(configuration, generationInput);
  assert.ok(stages.length > 0);
  assert.ok(stages.every(stage => stage.routes.every(route => route.ground.sourceType === 'ATTACK_GRAPH_ARTIFACT')));
  assert.ok(scenarioPackage.evidenceRequirements.requirements.every(requirement => requirement.grounds
    .every(ground => ground.sourceType !== 'CASE_FACT')));
});

test('Evidence cannot recombine already-separated attack issues into the final contradiction', () => {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0',
    attackIds: ['phishing', 'unauthorized_login', 'stored_xss'], settingId: 'company' }, catalog);
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const scenarioPackage = buildScenarioTemplate({ configuration, generationInput });
  const requirements = scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage);
  const routes = buildInvestigationStages(configuration, generationInput).flatMap(stage => stage.routes);
  const evidenceArtifacts = routes.map((route, index) => ({ evidenceId: `source_${index}`, type: route.evidenceType,
    sourceRefs: [route.ground] }));
  const statements = requirements.map((_, index) => ({ statementId: `claim_${index}`, technicalAssessment: 'CONTRADICTED' }));
  const contradictions = requirements.map((requirement, index) => ({ statementRef: statements[index].statementId,
    conflictingEvidenceIds: evidenceArtifacts.filter(artifact => requirement.grounds.some(ground =>
      key(ground) === key(artifact.sourceRefs[0]))).map(item => item.evidenceId) }));
  evidenceArtifacts.push({ evidenceId: 'testimony', type: 'TESTIMONY', testimony: { statements } });
  const evidenceSet = { evidenceArtifacts, contradictions };
  assert.deepEqual(stageEvidenceProblems(evidenceSet, scenarioPackage), []);
  contradictions.at(-1).conflictingEvidenceIds.push(evidenceArtifacts[0].evidenceId);
  assert.ok(stageEvidenceProblems(evidenceSet, scenarioPackage).some(item =>
    item.code === 'INVESTIGATION_STAGE_EVIDENCE_SCOPE_MISMATCH'));
});

test('credential phishing disputes preparation and collection, not the induced victim\'s input itself', () => {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0',
    attackIds: ['phishing', 'unauthorized_login', 'stored_xss'], settingId: 'company' }, catalog);
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const scenario = buildScenarioTemplate({ configuration, generationInput });
  const node = generationInput.technicalInput.attackGraph.nodes.find(item => item.attackDefinitionId === 'credential_phishing');
  const completion = scenario.evidenceRequirements.requirements.find(item => item.investigationStage
    && item.grounds.some(ground => ground.attackNodeId === node.nodeId
      && ground.sourceId === 'credential_submission_record'));
  assert.ok(completion.grounds.every(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT'));
  assert.match(completion.investigationStage.claim, /被告人が偽メール・偽フォームと情報の受信先を用意し、資格情報を収集/);
  assert.doesNotMatch(completion.investigationStage.claim, /資格情報を意図的に外部へ送信/);
  assert.doesNotMatch(completion.investigationStage.expectedInference, /調査報告|直接観察|CASE_FACT/);
  assert.match(completion.investigationStage.limitedRefutation, /被告人が誘導に従って入力・送信したこと自体は否定せず/);
  const incident = generationInput.technicalInput.attackDefinitions.find(item => item.id === 'credential_phishing').incidentNarrative;
  assert.match(incident.attackerAction, /被告人は.*フォームへ入力して送信/);
  assert.match(incident.prosecutionKnowledge, /準備した人物を特定する記録がない/);
  assert.match(incident.verdictBasis, /可能性を排除できない/);
  assert.match(incident.verdictBasis, /第三者が実行したと断定.*しない/);
});
