import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoGenerationManager, autoAuthorBootstrap, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated, generatedPlayerView } from '../server/generated-game.js';
import { procedureCommand, procedureOutput, procedureMethods, validateMaterialPlans, materialPlanProblems } from '../server/generation/investigation-procedures.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { inspectMaterial } from './helpers/court-issues.js';

let runtime, runner;
test.before(async () => {
  runner = new MockCodexRunner();
  const manager = new AutoGenerationManager({ jsonRunner: runner }); const author = createAutoAuthorSession();
  manager.submitManual(author, autoAuthorBootstrap().defaultManualConfiguration);
  await manager.waitForIdle(); manager.approve(author); await manager.waitForIdle();
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details)); runtime = author.runtime;
});
function start() {
  const session = createGeneratedGame(runtime); actGenerated(session, runtime, { action: 'begin' });
  actGenerated(session, runtime, { action: 'continue' }); return session;
}

test('homework is supplied as bounded generation data and all sources are available before discovery', () => {
  const call = runner.calls.find(item => item.phase === 'GENERATING_EVIDENCE');
  assert.match(call.data.investigationHomework, /フィッシング[\s\S]*Stored XSS[\s\S]*ランサムウェア/);
  const view = generatedPlayerView(start(), runtime);
  assert.equal(view.workbench.materials.length, runtime.gameCase.detective.evidence.length);
  assert.equal(view.collectedEvidence.length, 0);
  assert.doesNotMatch(JSON.stringify(view), /correctOptionIndex|explanation|supportingQuotes/);
  for (const material of view.workbench.materials) assert.ok(material.methods.length >= 2 && material.methods.length <= 4);
});

test('wrong investigation returns its own result, does not advance, and skipped or forged steps are rejected atomically', () => {
  const session = start(); const plan = runtime.gameCase.progression.materialInvestigations[0];
  const choices = procedureMethods(plan, 0);
  const wrong = choices.find(item => item.index !== plan.steps[0].correctOptionIndex);
  const item = runtime.gameCase.detective.evidence.find(item => item.evidenceId === plan.evidenceId);
  const result = actGenerated(session, runtime, { action: 'inspect-material', materialId: plan.evidenceId, methodId: wrong.methodId });
  assert.equal(result.workbench.result.output, procedureOutput(item.publicContent, wrong.operation));
  assert.equal(result.workbench.materials[0].step.number, 1); assert.equal(session.collectedEvidenceIds.length, 0);
  const before = structuredClone(session);
  for (const methodId of ['full', 'cat /etc/passwd', procedureMethods(plan, 1)[0].methodId]) {
    assert.throws(() => actGenerated(session, runtime, { action: 'inspect-material', materialId: plan.evidenceId, methodId }), { code: 'UNKNOWN_INVESTIGATION_METHOD' });
    assert.deepEqual(session, before);
  }
  assert.throws(() => actGenerated(session, runtime, { action: 'collect', evidenceId: plan.evidenceId }), { code: 'EVIDENCE_NOT_DISCOVERED' });
  assert.throws(() => actGenerated(session, runtime, { action: 'investigate' }), { code: 'MATERIAL_METHOD_REQUIRED' });
});

test('all materials can be investigated in reverse order and results survive switching materials', () => {
  const session = start();
  for (const plan of [...runtime.gameCase.progression.materialInvestigations].reverse()) inspectMaterial(session, runtime, plan.evidenceId);
  const view = generatedPlayerView(session, runtime);
  for (const material of view.workbench.materials) {
    assert.equal(material.collected, true); assert.equal(material.methods.length, 0);
    assert.equal(material.question.choices.length, 4); assert.equal(material.result.complete, true);
  }
  assert.equal(view.caseStudy, undefined);
});

test('displayed commands and results use literal read-only operations, including hostile evidence text', () => {
  const content = 'normal\n$(touch unsafe)\n<a href="x">text</a>\n';
  const op = { kind: 'MATCH', needle: '$(touch unsafe)', firstLine: 1, lastLine: 3 };
  assert.equal(procedureCommand(op), "grep -nF -- '$(touch unsafe)' material.txt");
  assert.equal(procedureOutput(content, op), '2:$(touch unsafe)');
  assert.equal(procedureOutput(content, { ...op, kind: 'LINES', firstLine: 3 }), '<a href="x">text</a>');
  assert.equal(procedureOutput(content, { ...op, kind: 'COUNT' }), '3');
});

test('material validation refuses omitted materials, unavailable source lines, and an empty advancing operation', () => {
  const plans = structuredClone(runtime.gameCase.progression.materialInvestigations);
  const evidence = runtime.gameCase.detective.evidence;
  assert.throws(() => validateMaterialPlans(plans.slice(1), evidence), { code: 'INVALID_MATERIAL_PROCEDURES' });
  plans[0].steps[0].choices[0].operation.lastLine = 100000;
  assert.throws(() => validateMaterialPlans(plans, evidence), { code: 'INVALID_MATERIAL_PROCEDURES' });
  const valid = structuredClone(runtime.gameCase.progression.materialInvestigations);
  valid[0].steps[0].choices[0].operation = { kind: 'MATCH', needle: 'unavailable unique trace', firstLine: 1, lastLine: 1 };
  assert.throws(() => validateMaterialPlans(valid, evidence), { code: 'INVALID_MATERIAL_PROCEDURES' });
});

test('procedure repair identifies every affected material and its actual source line range', () => {
  const plans = structuredClone(runtime.gameCase.progression.materialInvestigations);
  const evidence = runtime.gameCase.detective.evidence;
  for (const plan of plans.slice(0, 2)) plan.steps[0].choices[0].operation.lastLine = 100000;
  const before = structuredClone(plans);
  const problems = materialPlanProblems(plans, evidence);
  assert.equal(problems.length, 2);
  plans.slice(0, 2).forEach((plan, index) => {
    assert.ok(problems[index].field.includes(plan.evidenceId));
    assert.match(problems[index].field, /steps\[0\]\.choices\[0\]\.operation$/);
    assert.match(problems[index].message, /原文は\d+行/);
    assert.match(problems[index].correctionHint, /firstLine.*lastLine/);
  });
  assert.deepEqual(plans, before);
});
