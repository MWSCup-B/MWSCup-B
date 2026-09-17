import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { buildGeneratedGame } from '../server/generation/game-make.js';
import { buildGameEvaluationInput, evaluateGame } from '../server/generation/game-evaluator.js';
import { createGeneratedGame, actGenerated, generatedPlayerView } from '../server/generated-game.js';
import { advanceWorkflow, createOrchestrator } from '../server/generation/orchestrator.js';
import { digest } from '../server/generation/evidence-validator.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';

const forbiddenPublic = /groundTruth|judgment|acceptedEvidenceIds|requiredForCourtIds|contradictionRef|exonerationRef|attackGraphRef|provenance|fingerprint|sourceRefs|requirementIds/i;

test('Ground Truth先行と技術fact・架空人物・証言・推論のデータ分離を維持する', () => {
  const fixture = readyGameCaseFixture();
  const scenario = fixture.scenarioPackage;
  assert.equal(scenario.scenarioDraft.groundTruthId, scenario.groundTruth.groundTruthId);
  assert.ok(scenario.groundTruth.technicalFacts.every(item => item.sourceType.startsWith('ATTACK_')));
  assert.ok(scenario.characters.characters.every(item => item.provenance === 'AI_GENERATED_SYNTHETIC'));
  const testimony = fixture.evidenceSet.evidenceArtifacts.find(item => item.type === 'TESTIMONY');
  assert.ok(testimony.testimony.statements.every(item => item.technicalAssessment));
  assert.equal(Object.hasOwn(scenario.groundTruth, 'learnerInference'), false);
});

test('単一IP・端末・accountだけで人物断定せず複数根拠で無罪論証する', () => {
  const fixture = readyGameCaseFixture();
  assert.equal(fixture.gameCase.progression.initialCourt.attributionStatus, 'ALLEGATION_ONLY');
  assert.ok(fixture.exonerations.every(item => item.supportingEvidenceIds.length >= 2));
  assert.doesNotMatch(JSON.stringify(fixture.scenarioPackage.groundTruth),
    /ip[_ -]?address.*(is|equals).*character|account.*(is|equals).*character/i);
});

test('通常プレイだけで解答できhidden knowledgeを要求しない', () => {
  const fixture = readyGameCaseFixture();
  const { gameMakeResult } = buildGeneratedGame(fixture.gameCaseResult);
  const input = buildGameEvaluationInput({ gameMakeResult,
    gameCaseResult: fixture.gameCaseResult, evidenceSet: fixture.evidenceSet,
    verificationResult: fixture.verificationResult, scenarioPackage: fixture.scenarioPackage });
  const result = evaluateGame(input);
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.checks.find(item => item.category === 'SOLVABILITY').status, 'PASS');
});

test('Public Game Caseと全session viewにGround Truth・Internal Judgmentを含めない', () => {
  const fixture = readyGameCaseFixture();
  const { runtime } = buildGeneratedGame(fixture.gameCaseResult);
  const session = createGeneratedGame(runtime);
  const views = [generatedPlayerView(session, runtime)];
  actGenerated(session, runtime, { action: 'begin' }); views.push(generatedPlayerView(session, runtime));
  actGenerated(session, runtime, { action: 'continue' }); views.push(generatedPlayerView(session, runtime));
  assert.doesNotMatch(JSON.stringify(runtime.publicGameCase), forbiddenPublic);
  assert.ok(views.every(view => !forbiddenPublic.test(JSON.stringify(view))));
});

test('Evidenceを未信頼入力としてtextContentだけで描画する', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
});

test('Agent間成果物はすべてversion付きJSON Schemaで受け渡す', async () => {
  const names = (await readdir(new URL('../schemas/', import.meta.url))).filter(name => name.endsWith('.json'));
  assert.ok(names.length >= 40);
  for (const name of names) {
    const schema = JSON.parse(await readFile(new URL(`../schemas/${name}`, import.meta.url), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.properties.schemaVersion.const, '1.0');
  }
});

test('Generator自己評価だけでは合格せず独立VerificationとEvaluationを要求する', () => {
  const fixture = readyGameCaseFixture();
  assert.equal(fixture.verificationResult.independence.scenarioGeneratorSelfAssessmentUsed, false);
  assert.equal(fixture.verificationResult.independence.technicalChecksRecomputed, true);
  const { gameMakeResult } = buildGeneratedGame(fixture.gameCaseResult);
  assert.equal(gameMakeResult.status, 'BUILT');
  assert.notEqual(gameMakeResult.status, 'ACCEPTED');
});

test('Gate failure後続禁止と上流fingerprint拘束を適用する', () => {
  const inputFingerprint = digest({ input: 'compliance' });
  let workflow = createOrchestrator({ inputFingerprint, courtAttemptLimit: 3 });
  workflow = advanceWorkflow(workflow, { gate: 'INPUT_VALIDATION',
    artifact: { schemaVersion: '1.0', status: 'VALID', inputId: 'input', inputFingerprint },
    upstreamFingerprint: '0'.repeat(64) });
  assert.equal(workflow.currentState, 'BLOCKED');
  assert.deepEqual(workflow.completedGates, []);
});

