import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoGenerationManager, autoAuthorBootstrap, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { actGenerated, createGeneratedGame, generatedPlayerView } from '../server/generated-game.js';
import { sourceLines } from '../server/generation/investigation-workspace.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { currentCorrectPair } from './helpers/court-issues.js';
import { courtEvidenceLines, requiredCourtEvidence } from '../server/generation/court-evidence.js';
import { publicCourtQuestion } from '../server/generation/court-questions.js';

let runtime;
test.before(async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const author = createAutoAuthorSession();
  manager.submitManual(author, autoAuthorBootstrap().defaultManualConfiguration);
  await manager.waitForIdle(); manager.approve(author); await manager.waitForIdle();
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  runtime = author.runtime;
});

function start() {
  const session = createGeneratedGame(runtime);
  actGenerated(session, runtime, { action: 'begin' });
  actGenerated(session, runtime, { action: 'continue' });
  return session;
}

test('court receives the saved source lines in original order, without unsaved context or duplicate saves', () => {
  const session = start();
  const pair = currentCorrectPair(runtime, 1);
  const source = runtime.gameCase.detective.evidence.find(item => item.evidenceId === pair.evidenceId);
  const original = source.publicContent;
  const lines = sourceLines(source);
  assert.ok(lines.length > 2);
  for (const material of generatedPlayerView(session, runtime).workbench.materials) {
    actGenerated(session, runtime, { action: 'workspace-read', materialId: material.materialId });
    actGenerated(session, runtime, { action: 'save-fact', materialId: material.materialId, line: material.materialId === pair.evidenceId ? lines.length : 1 });
  }
  for (const line of [1, lines.length]) actGenerated(session, runtime, { action: 'save-fact', materialId: pair.evidenceId, line });
  const expected = [{ line: 1, text: lines[0] }, { line: lines.length, text: lines.at(-1) }];
  const investigation = generatedPlayerView(session, runtime);
  assert.deepEqual(investigation.collectedEvidence.find(item => item.evidenceId === pair.evidenceId).savedFacts, expected);
  const court = actGenerated(session, runtime, { action: 'retrial', ...pair });
  const submitted = court.presentableEvidence.find(item => item.evidenceId === pair.evidenceId);
  assert.deepEqual(submitted.savedFacts, expected);
  assert.equal(submitted.publicContent, lines[0] + '\n' + lines.at(-1));
  assert.notEqual(submitted.publicContent, original);
  assert.equal(source.publicContent, original);
  assert.doesNotMatch(JSON.stringify(court), /correctOptionIndex|supportingQuotes|groundTruth/);
  submitted.savedFacts[0].text = 'tampered client copy';
  assert.deepEqual(generatedPlayerView(session, runtime).presentableEvidence.find(item => item.evidenceId === pair.evidenceId).savedFacts, expected);

  actGenerated(session, runtime, { action: 'investigation' });
  actGenerated(session, runtime, { action: 'save-fact', materialId: pair.evidenceId, line: 2 });
  const updated = actGenerated(session, runtime, { action: 'retrial', ...pair });
  assert.deepEqual(updated.presentableEvidence.find(item => item.evidenceId === pair.evidenceId).savedFacts,
    [expected[0], { line: 2, text: lines[1] }, expected[1]]);
  assert.deepEqual(generatedPlayerView(start(), runtime).collectedEvidence, []);
});

test('legacy whole-document collection stays compatible and cannot overwrite a later explicit excerpt', () => {
  const session = start();
  const { evidenceId } = currentCorrectPair(runtime, 1);
  const source = runtime.gameCase.detective.evidence.find(item => item.evidenceId === evidenceId);
  const read = () => actGenerated(session, runtime, { action: 'inspect-material', materialId: evidenceId, methodId: 'read' });
  const legacy = read().collectedEvidence.find(item => item.evidenceId === evidenceId);
  assert.equal(legacy.publicContent, source.publicContent);
  assert.equal(legacy.savedFacts, undefined);
  actGenerated(session, runtime, { action: 'workspace-read', materialId: evidenceId });
  actGenerated(session, runtime, { action: 'save-fact', materialId: evidenceId, line: 2 });
  const saved = read().collectedEvidence.find(item => item.evidenceId === evidenceId);
  assert.equal(saved.publicContent, sourceLines(source)[1]);
  assert.deepEqual(saved.savedFacts, [{ line: 2, text: sourceLines(source)[1] }]);
  assert.ok(!session.wholeDocumentEvidenceIds.includes(evidenceId));
});

test('saving every line of each required material supplies unchanged source rows to court', () => {
  const session = start();
  const pair = currentCorrectPair(runtime, 1);
  for (const materialId of requiredCourtEvidence(runtime.gameCase, 1)) {
    actGenerated(session, runtime, { action: 'workspace-read', materialId });
    actGenerated(session, runtime, { action: 'save-all-facts', materialId });
    const source = runtime.gameCase.detective.evidence.find(item => item.evidenceId === materialId);
    assert.deepEqual(session.savedFacts[materialId],
      sourceLines(source).map((text, index) => ({ line: index + 1, text })));
  }
  const court = actGenerated(session, runtime, { action: 'retrial', ...pair });
  assert.ok(court.presentableEvidence.every(item =>
    item.publicContent === sourceLines(runtime.gameCase.detective.evidence
      .find(source => source.evidenceId === item.evidenceId)).join('\n')));
  assert.equal(actGenerated(session, runtime, { action: 'objection', ...pair }).result.outcome, 'SUCCESS');
});

test('correct argument cannot advance with irrelevant or incomplete saved lines; restoring all support can', () => {
  const session = start();
  const pair = currentCorrectPair(runtime, 1);
  const required = requiredCourtEvidence(runtime.gameCase, 1);
  const incomplete = required.find(id => courtEvidenceLines(runtime.gameCase, 1, id).length > 1);
  assert.ok(incomplete, 'fixture must require multiple source lines');
  for (const materialId of required) {
    actGenerated(session, runtime, { action: 'workspace-read', materialId });
    const needed = courtEvidenceLines(runtime.gameCase, 1, materialId);
    const source = runtime.gameCase.detective.evidence.find(item => item.evidenceId === materialId);
    const unrelated = sourceLines(source).findIndex((_, index) => !needed.includes(index + 1)) + 1;
    for (const line of materialId === incomplete ? [unrelated || needed[0]] : needed) {
      actGenerated(session, runtime, { action: 'save-fact', materialId, line });
    }
  }
  assert.equal(generatedPlayerView(session, runtime).canReturnToCourt, true, 'do not reveal answer coverage before presentation');
  actGenerated(session, runtime, { action: 'retrial', ...pair });
  const failed = actGenerated(session, runtime, { action: 'objection', ...pair });
  assert.equal(failed.result.outcome, 'FAILURE');
  assert.equal(session.currentRound, 1);
  assert.equal(session.attemptCount, 1);
  assert.equal(session.currentState, 'INVESTIGATION');
  assert.doesNotMatch(JSON.stringify(failed), /supportingQuotes|correctOptionIndex|wholeDocumentEvidenceIds/);

  for (const line of courtEvidenceLines(runtime.gameCase, 1, incomplete)) {
    actGenerated(session, runtime, { action: 'save-fact', materialId: incomplete, line });
  }
  const wrongChoice = publicCourtQuestion(runtime.gameCase.progression.courtIssues[0].question).choices
    .find(choice => choice.choiceId !== pair.interpretationChoiceId).choiceId;
  actGenerated(session, runtime, { action: 'retrial', interpretationChoiceId: wrongChoice });
  assert.equal(actGenerated(session, runtime, { action: 'objection', statementId: pair.statementId }).result.outcome, 'FAILURE');
  assert.equal(session.currentRound, 1);
  actGenerated(session, runtime, { action: 'retrial', ...pair });
  const passed = actGenerated(session, runtime, { action: 'objection', ...pair });
  assert.equal(passed.result.outcome, 'SUCCESS');
  assert.equal(session.currentRound, 2);
  assert.deepEqual(session.savedFacts, {});
  assert.deepEqual(session.wholeDocumentEvidenceIds, []);
});

test('missing Workspace excerpts cannot fall back to a whole document', () => {
  const session = start();
  const pair = currentCorrectPair(runtime, 1);
  for (const materialId of requiredCourtEvidence(runtime.gameCase, 1)) {
    actGenerated(session, runtime, { action: 'workspace-read', materialId });
    for (const line of courtEvidenceLines(runtime.gameCase, 1, materialId)) {
      actGenerated(session, runtime, { action: 'save-fact', materialId, line });
    }
  }
  delete session.savedFacts[pair.evidenceId];
  const court = actGenerated(session, runtime, { action: 'retrial', ...pair });
  assert.equal(court.presentableEvidence.find(item => item.evidenceId === pair.evidenceId).publicContent, '');
  assert.equal(actGenerated(session, runtime, { action: 'objection', ...pair }).result.outcome, 'FAILURE');
  assert.equal(session.currentRound, 1);
});
