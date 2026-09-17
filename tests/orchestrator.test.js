import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates } from '../server/generation/candidate-builder.js';
import { buildAttackGraphs } from '../server/generation/attack-graph.js';
import { importScenarioPackage } from '../server/generation/scenario-interface.js';
import { buildGeneratedGame } from '../server/generation/game-make.js';
import { buildGameEvaluationInput, evaluateGame } from '../server/generation/game-evaluator.js';
import { digest } from '../server/generation/evidence-validator.js';
import { advanceWorkflow, createOrchestrator, invalidateWorkflowFrom,
  recordCourtAttempt, recordScenarioRevision, validateOrchestratorResult,
  waitForExternal, WORKFLOW_GATES } from '../server/generation/orchestrator.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';

function artifacts(options) {
  const fixture = readyGameCaseFixture(options);
  const technical = fixture.generationInput.technicalInput;
  const candidates = buildCandidates({ definitions: technical.attackDefinitions,
    network: technical.network, context: technical.scenarioContext,
    selection: { schemaVersion: '1.0', selectedAttackIds: fixture.generationInput.selectedAttackIds } });
  const graph = buildAttackGraphs({ definitions: technical.attackDefinitions,
    network: technical.network, context: technical.scenarioContext,
    candidate: candidates.candidates[0] });
  const { gameMakeResult } = buildGeneratedGame(fixture.gameCaseResult);
  const evaluationInput = buildGameEvaluationInput({ gameMakeResult,
    gameCaseResult: fixture.gameCaseResult, evidenceSet: fixture.evidenceSet,
    verificationResult: fixture.verificationResult, scenarioPackage: fixture.scenarioPackage });
  const evaluation = evaluateGame(evaluationInput);
  const selection = { schemaVersion: '1.0',
    selectedAttackIds: fixture.generationInput.selectedAttackIds };
  const inputFingerprint = digest({ selection, network: technical.network,
    scenarioContext: technical.scenarioContext, attackDefinitions: technical.attackDefinitions });
  return { fixture, inputFingerprint, values: {
    INPUT_VALIDATION: { schemaVersion: '1.0', status: 'VALID', inputId: 'technical_input',
      inputFingerprint, selection, network: technical.network,
      scenarioContext: technical.scenarioContext, attackDefinitions: technical.attackDefinitions },
    CANDIDATE_BUILDER: candidates, ATTACK_GRAPH: graph,
    SCENARIO_IMPORT: fixture.importResult, VERIFICATION: fixture.verificationResult,
    EVIDENCE_IMPORT: fixture.evidenceImportResult,
    GAME_CASE_CONVERSION: fixture.gameCaseResult, GAME_PROGRESSION: fixture.gameCaseResult,
    GAME_MAKE: gameMakeResult, EVALUATION: evaluation,
  } };
}

function through(values, inputFingerprint, stop = WORKFLOW_GATES.length) {
  let workflow = createOrchestrator({ inputFingerprint, courtAttemptLimit: 3 });
  for (const gate of WORKFLOW_GATES.slice(0, stop)) workflow = advanceWorkflow(workflow,
    { gate, artifact: values[gate], upstreamFingerprint: workflow.chainFingerprint });
  return workflow;
}

test('標準Workflowを順番に管理し全gate成功時だけACCEPTEDにする', () => {
  const { values, inputFingerprint } = artifacts();
  const workflow = through(values, inputFingerprint);
  assert.equal(workflow.currentState, 'ACCEPTED');
  assert.equal(workflow.currentGate, 'COMPLETE');
  assert.deepEqual(workflow.completedGates, WORKFLOW_GATES);
  assert.equal(validateOrchestratorResult(workflow), workflow);
});

test('外部Codex境界を主要状態と分離して待機する', () => {
  const { values, inputFingerprint } = artifacts();
  let workflow = through(values, inputFingerprint, 3);
  workflow = waitForExternal(workflow);
  assert.equal(workflow.currentState, 'DRAFT');
  assert.equal(workflow.waitingFor, 'WAITING_EXTERNAL_SCENARIO');
  workflow = advanceWorkflow(workflow, { gate: 'SCENARIO_IMPORT',
    artifact: values.SCENARIO_IMPORT, upstreamFingerprint: workflow.chainFingerprint });
  assert.equal(workflow.waitingFor, null);
  assert.equal(waitForExternal(workflow).waitingFor, 'WAITING_EXTERNAL_REVIEW');
});

test('Gate順序違反と失敗は後続を成功扱いにしない', () => {
  const { values, inputFingerprint } = artifacts();
  let workflow = createOrchestrator({ inputFingerprint, courtAttemptLimit: 3 });
  workflow = advanceWorkflow(workflow, { gate: 'ATTACK_GRAPH', artifact: values.ATTACK_GRAPH,
    upstreamFingerprint: workflow.chainFingerprint });
  assert.equal(workflow.currentState, 'BLOCKED');
  assert.deepEqual(workflow.completedGates, []);
  assert.throws(() => advanceWorkflow(workflow, { gate: 'EVALUATION', artifact: values.EVALUATION,
    upstreamFingerprint: workflow.chainFingerprint }), { code: 'WORKFLOW_TERMINAL' });
});

test('上流変更は下流成果物を無効化し旧fingerprint再利用を拒否する', () => {
  const { values, inputFingerprint } = artifacts();
  let workflow = through(values, inputFingerprint, 8);
  const staleUpstream = workflow.chainFingerprint;
  const newFingerprint = 'a'.repeat(64) === inputFingerprint ? 'b'.repeat(64) : 'a'.repeat(64);
  workflow = invalidateWorkflowFrom(workflow, 'INPUT_VALIDATION', newFingerprint);
  assert.deepEqual(workflow.completedGates, []);
  workflow = advanceWorkflow(workflow, { gate: 'INPUT_VALIDATION',
    artifact: { ...values.INPUT_VALIDATION, inputFingerprint: newFingerprint },
    upstreamFingerprint: staleUpstream });
  assert.equal(workflow.currentState, 'BLOCKED');
  assert.equal(workflow.issues[0].code, 'STALE_UPSTREAM_ARTIFACT');
});

test('Scenario Revisionを最大3回に制限する', () => {
  const { values, inputFingerprint, fixture } = artifacts();
  let workflow = through(values, inputFingerprint, 3);
  const invalid = importScenarioPackage({ generationInput: fixture.generationInput,
    scenarioPackage: { schemaVersion: '1.0' } });
  for (let revision = 1; revision <= 4; revision += 1) {
    workflow = advanceWorkflow(workflow, { gate: 'SCENARIO_IMPORT', artifact: invalid,
      upstreamFingerprint: workflow.chainFingerprint });
    assert.equal(workflow.currentState, 'NEEDS_REVISION');
    workflow = recordScenarioRevision(workflow);
    if (revision < 4) assert.equal(workflow.retryCounters.scenarioRevision, revision);
  }
  assert.equal(workflow.currentState, 'BLOCKED');
  assert.equal(workflow.issues[0].code, 'REVISION_LIMIT_EXCEEDED');
});

test('Court retryはProgression Planの上限を使用する', () => {
  const { inputFingerprint } = artifacts();
  let workflow = createOrchestrator({ inputFingerprint, courtAttemptLimit: 2 });
  workflow = recordCourtAttempt(workflow);
  assert.equal(workflow.currentState, 'DRAFT');
  workflow = recordCourtAttempt(workflow);
  assert.equal(workflow.currentState, 'BLOCKED');
  assert.equal(workflow.issues[0].code, 'COURT_ATTEMPT_LIMIT_REACHED');
});

test('fingerprint不一致をGate failureとして伝播する', () => {
  const { values, inputFingerprint } = artifacts();
  let workflow = createOrchestrator({ inputFingerprint, courtAttemptLimit: 3 });
  workflow = advanceWorkflow(workflow, { gate: 'INPUT_VALIDATION', artifact: values.INPUT_VALIDATION,
    upstreamFingerprint: '0'.repeat(64) });
  assert.equal(workflow.currentState, 'BLOCKED');
  assert.equal(workflow.issues[0].code, 'STALE_UPSTREAM_ARTIFACT');
});
