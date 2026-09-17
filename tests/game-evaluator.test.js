import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratedGame } from '../server/generation/game-make.js';
import { buildGameEvaluationInput, evaluateGame, validateGameEvaluationInput,
  validateGameEvaluationResult } from '../server/generation/game-evaluator.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';

function evaluationFixture(options) {
  const fixture = readyGameCaseFixture(options);
  const { gameMakeResult } = buildGeneratedGame(fixture.gameCaseResult);
  const input = buildGameEvaluationInput({ gameMakeResult,
    gameCaseResult: fixture.gameCaseResult, evidenceSet: fixture.evidenceSet,
    verificationResult: fixture.verificationResult, scenarioPackage: fixture.scenarioPackage });
  return { fixture, gameMakeResult, input };
}

test('独立Evaluationが正常・再試行・試行上限経路を通してACCEPTEDにする', () => {
  const { input } = evaluationFixture();
  const result = evaluateGame(input);
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.accepted, true);
  assert.equal(result.checks.length, 10);
  assert.ok(result.checks.every(item => item.status === 'PASS'));
  assert.equal(validateGameEvaluationResult(result), result);
});

test('Evaluation InputはBUILT HandoffとREADY成果物の正本を照合する', () => {
  const { input } = evaluationFixture();
  assert.equal(validateGameEvaluationInput(input), input);
  input.gameMakeResult.evaluationHandoff.eligibleForEvaluation = false;
  const result = evaluateGame(input);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.accepted, false);
  assert.equal(result.issues[0].category, 'UPSTREAM_INTEGRITY');
});

test('build fingerprint改変はEvaluation開始前にBLOCKEDにする', () => {
  const { input } = evaluationFixture();
  input.buildFingerprint = '0'.repeat(64);
  const result = evaluateGame(input);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.issues[0].code, 'BUILD_FINGERPRINT_MISMATCH');
});

test('上流ScenarioとEvidenceの混入をBLOCKEDにする', () => {
  const { input } = evaluationFixture();
  input.evidenceSet.scenarioId = 'scenario_other';
  const result = evaluateGame(input);
  assert.equal(result.status, 'BLOCKED');
});

test('再試行できないmaxCourtAttemptsはNEEDS_REVISIONにする', () => {
  const { input } = evaluationFixture({ maxCourtAttempts: 1 });
  const result = evaluateGame(input);
  assert.equal(result.status, 'NEEDS_REVISION');
  assert.equal(result.accepted, false);
  assert.ok(result.issues.some(item => item.code === 'RETRY_PLAYTHROUGH_FAILED'));
});

test('Evaluation Feedbackは機械可読な修正情報を持つ', () => {
  const { input } = evaluationFixture({ maxCourtAttempts: 1 });
  const issue = evaluateGame(input).issues[0];
  for (const field of ['code', 'category', 'target', 'reason', 'correctionHint', 'sourceRefs']) {
    assert.ok(Object.hasOwn(issue, field));
  }
});

test('EvaluationはGenerator自己評価を入力せず独立した経路評価を行う', () => {
  const { input } = evaluationFixture();
  assert.equal(Object.hasOwn(input, 'generatorEvaluation'), false);
  const categories = evaluateGame(input).checks.map(item => item.category);
  assert.deepEqual(categories, ['UPSTREAM_INTEGRITY', 'NORMAL_PLAYTHROUGH',
    'RETRY_PLAYTHROUGH', 'LIMIT_PLAYTHROUGH', 'INVESTIGATION_REACHABILITY',
    'INVESTIGATION_DISCLOSURE', 'SOLVABILITY',
    'BRUTE_FORCE_RESISTANCE', 'INFORMATION_DISCLOSURE', 'USABILITY']);
});
