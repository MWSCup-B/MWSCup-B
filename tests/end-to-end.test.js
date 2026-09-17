import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates } from '../server/generation/candidate-builder.js';
import { buildAttackGraphs } from '../server/generation/attack-graph.js';
import { importScenarioPackage } from '../server/generation/scenario-interface.js';
import { verifyScenario } from '../server/generation/scenario-verifier.js';
import { importEvidencePackage } from '../server/generation/evidence-interface.js';
import { convertGameCase } from '../server/generation/game-case-converter.js';
import { buildGeneratedGame } from '../server/generation/game-make.js';
import { buildGameEvaluationInput, evaluateGame } from '../server/generation/game-evaluator.js';
import { digest } from '../server/generation/evidence-validator.js';
import { advanceWorkflow, createOrchestrator, invalidateWorkflowFrom, WORKFLOW_GATES }
  from '../server/generation/orchestrator.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';
import { semanticReview } from './helpers/verified-scenario.js';

function e2eArtifacts(options) {
  const fixture = readyGameCaseFixture(options);
  const technical = fixture.generationInput.technicalInput;
  const candidateResult = buildCandidates({ definitions: technical.attackDefinitions,
    network: technical.network, context: technical.scenarioContext,
    selection: { schemaVersion: '1.0', selectedAttackIds: fixture.generationInput.selectedAttackIds } });
  const graphResult = buildAttackGraphs({ definitions: technical.attackDefinitions,
    network: technical.network, context: technical.scenarioContext,
    candidate: candidateResult.candidates[0] });
  const { gameMakeResult } = buildGeneratedGame(fixture.gameCaseResult);
  const evaluationInput = buildGameEvaluationInput({ gameMakeResult,
    gameCaseResult: fixture.gameCaseResult, evidenceSet: fixture.evidenceSet,
    verificationResult: fixture.verificationResult, scenarioPackage: fixture.scenarioPackage });
  const evaluationResult = evaluateGame(evaluationInput);
  const selection = { schemaVersion: '1.0',
    selectedAttackIds: fixture.generationInput.selectedAttackIds };
  const inputFingerprint = digest({ selection, network: technical.network,
    scenarioContext: technical.scenarioContext, attackDefinitions: technical.attackDefinitions });
  return { fixture, inputFingerprint, artifacts: {
    INPUT_VALIDATION: { schemaVersion: '1.0', status: 'VALID',
      inputId: 'technical_input', inputFingerprint, selection, network: technical.network,
      scenarioContext: technical.scenarioContext, attackDefinitions: technical.attackDefinitions },
    CANDIDATE_BUILDER: candidateResult, ATTACK_GRAPH: graphResult,
    SCENARIO_IMPORT: fixture.importResult, VERIFICATION: fixture.verificationResult,
    EVIDENCE_IMPORT: fixture.evidenceImportResult,
    GAME_CASE_CONVERSION: fixture.gameCaseResult, GAME_PROGRESSION: fixture.gameCaseResult,
    GAME_MAKE: gameMakeResult, EVALUATION: evaluationResult,
  } };
}

function runTo(data, count = WORKFLOW_GATES.length) {
  let workflow = createOrchestrator({ inputFingerprint: data.inputFingerprint,
    courtAttemptLimit: data.fixture.progressionPlan.retryPolicy.maxCourtAttempts });
  for (const gate of WORKFLOW_GATES.slice(0, count)) workflow = advanceWorkflow(workflow,
    { gate, artifact: data.artifacts[gate], upstreamFingerprint: workflow.chainFingerprint });
  return workflow;
}

test('Attack Selectionから独立Evaluationまでの合成E2EがACCEPTEDへ到達する', () => {
  const data = e2eArtifacts();
  const workflow = runTo(data);
  assert.equal(data.artifacts.CANDIDATE_BUILDER.status, 'CREATED');
  assert.equal(data.artifacts.ATTACK_GRAPH.status, 'CREATED');
  assert.equal(data.artifacts.SCENARIO_IMPORT.status, 'VALID');
  assert.equal(data.artifacts.VERIFICATION.status, 'VERIFIED');
  assert.equal(data.artifacts.EVIDENCE_IMPORT.status, 'VALID');
  assert.equal(data.artifacts.GAME_CASE_CONVERSION.status, 'READY');
  assert.equal(data.artifacts.GAME_MAKE.status, 'BUILT');
  assert.equal(data.artifacts.EVALUATION.status, 'ACCEPTED');
  assert.equal(workflow.currentState, 'ACCEPTED');
});

test('Scenario不正はSCENARIO_IMPORTで停止する', () => {
  const data = e2eArtifacts();
  data.artifacts.SCENARIO_IMPORT = importScenarioPackage({
    generationInput: data.fixture.generationInput, scenarioPackage: { schemaVersion: '1.0' } });
  const workflow = runTo(data, 4);
  assert.equal(workflow.currentState, 'NEEDS_REVISION');
  assert.equal(workflow.currentGate, 'SCENARIO_IMPORT');
  assert.equal(workflow.completedGates.includes('VERIFICATION'), false);
});

test('独立Verification失敗はEvidenceへ進めない', () => {
  const data = e2eArtifacts();
  const review = semanticReview(data.fixture.verificationInput);
  review.checks[0].outcome = 'FAIL';
  review.checks[0].reason = '修正が必要な意味的不一致を検出した。';
  review.checks[0].correctionHint = 'Evidence Requirementの説明を参照根拠に合わせる。';
  data.artifacts.VERIFICATION = verifyScenario({
    verificationInput: data.fixture.verificationInput, semanticReview: review });
  const workflow = runTo(data, 5);
  assert.equal(data.artifacts.VERIFICATION.status, 'NEEDS_REVISION');
  assert.equal(workflow.currentState, 'NEEDS_REVISION');
  assert.equal(workflow.completedGates.includes('EVIDENCE_IMPORT'), false);
});

test('Evidence不正はGame Caseへ進めない', () => {
  const data = e2eArtifacts();
  data.artifacts.EVIDENCE_IMPORT = importEvidencePackage({
    generationInput: data.fixture.evidenceGenerationInput,
    evidencePackage: { schemaVersion: '1.0' } });
  const workflow = runTo(data, 6);
  assert.equal(data.artifacts.EVIDENCE_IMPORT.status, 'INVALID');
  assert.equal(workflow.currentState, 'NEEDS_REVISION');
  assert.equal(workflow.completedGates.includes('GAME_CASE_CONVERSION'), false);
});

test('Game Case不正はProgressionとUI buildへ進めない', () => {
  const data = e2eArtifacts();
  const brokenInput = structuredClone(data.fixture.conversionInput);
  brokenInput.progressionPlan.initialCourtEvidenceIds = ['missing_evidence'];
  data.artifacts.GAME_CASE_CONVERSION = convertGameCase(brokenInput);
  const workflow = runTo(data, 7);
  assert.equal(data.artifacts.GAME_CASE_CONVERSION.status, 'BLOCKED');
  assert.equal(workflow.currentState, 'BLOCKED');
  assert.equal(workflow.completedGates.includes('GAME_PROGRESSION'), false);
});

test('UI build失敗はEvaluationへ進めない', () => {
  const data = e2eArtifacts();
  const changed = structuredClone(data.fixture.gameCaseResult);
  changed.uiIntegrationHandoff.progressionFingerprint = '0'.repeat(64);
  data.artifacts.GAME_MAKE = buildGeneratedGame(changed).gameMakeResult;
  const workflow = runTo(data, 9);
  assert.equal(data.artifacts.GAME_MAKE.status, 'BLOCKED');
  assert.equal(workflow.currentState, 'BLOCKED');
  assert.equal(workflow.completedGates.includes('EVALUATION'), false);
});

test('Evaluation失敗は最終ACCEPTEDにしない', () => {
  const data = e2eArtifacts({ maxCourtAttempts: 1 });
  const workflow = runTo(data);
  assert.equal(data.artifacts.EVALUATION.status, 'NEEDS_REVISION');
  assert.equal(workflow.currentState, 'NEEDS_REVISION');
  assert.equal(workflow.completedGates.includes('EVALUATION'), false);
});

test('fingerprint改変と上流変更後の旧成果物は後続へ進めない', () => {
  const data = e2eArtifacts();
  let workflow = runTo(data, 6);
  const staleFingerprint = workflow.chainFingerprint;
  const newInput = data.inputFingerprint === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);
  workflow = invalidateWorkflowFrom(workflow, 'INPUT_VALIDATION', newInput);
  workflow = advanceWorkflow(workflow, { gate: 'INPUT_VALIDATION',
    artifact: { ...data.artifacts.INPUT_VALIDATION, inputFingerprint: newInput },
    upstreamFingerprint: staleFingerprint });
  assert.equal(workflow.currentState, 'BLOCKED');
  assert.equal(workflow.issues[0].code, 'STALE_UPSTREAM_ARTIFACT');
  assert.deepEqual(workflow.completedGates, []);
});
