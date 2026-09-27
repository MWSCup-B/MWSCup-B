import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AutoGenerationManager, autoAuthorBootstrap, createAutoAuthorSession }
  from '../server/auto-generation-service.js';
import { actGenerated, createGeneratedGame, generatedPlayerView } from '../server/generated-game.js';
import { courtIssueGenerationProblems } from '../server/generation/court-issues.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { observationAnchors } from '../server/generation/court-questions.js';
import { currentCorrectPair, syncQuestionQuotes, collectCurrentTarget, enterCurrentCourt, inspectMaterial } from './helpers/court-issues.js';

test('Scenario revision and independent review prompts preserve the new distinct-issue count', async () => {
  for (const name of ['scenario-generation-v1', 'scenario-verification-v1']) {
    const prompt = await readFile(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');
    assert.match(prompt, /調査対象ごとに1回/);
    assert.match(prompt, /異なる争点/);
    assert.doesNotMatch(prompt, /は法廷ラウンド数に対応し/);
  }
});

async function generate({ difficulty = 1, changeDraft } = {}) {
  const runner = new MockCodexRunner();
  const run = runner.runJson.bind(runner);
  runner.runJson = async args => {
    const value = await run(args);
    if (args.phase === 'GENERATING_EVIDENCE') changeDraft?.(value);
    return value;
  };
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const author = createAutoAuthorSession();
  const configuration = autoAuthorBootstrap().defaultManualConfiguration;
  configuration.difficulty = difficulty; configuration.evidenceCount = difficulty;
  manager.submitManual(author, configuration); await manager.waitForIdle();
  assert.equal(author.auto.state, 'SCENARIO_PREVIEW');
  manager.approve(author); await manager.waitForIdle();
  return { author, runner };
}

function begin(runtime) {
  const session = createGeneratedGame(runtime);
  actGenerated(session, runtime, { action: 'begin' });
  actGenerated(session, runtime, { action: 'continue' }); return session;
}
function acquire(session, runtime, ids = runtime.gameCase.detective.evidence.map(item => item.evidenceId)) {
  for (const rule of runtime.gameCase.detective.evidenceDiscoveryRules) {
    if (!session.availableInvestigationTargets.includes(rule.targetId)) continue;
    if (ids.includes(rule.evidenceId)) inspectMaterial(session, runtime, rule.evidenceId);
  }
}

for (const difficulty of [1, 2, 3]) test(`★${difficulty}: all materials initially selectable, explicit investigation and no replay of solved claims`, async () => {
  const { author } = await generate({ difficulty });
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  const { runtime } = author; const session = begin(runtime);
  const count = runtime.gameCase.detective.investigationTargets.length;
  assert.equal(runtime.gameCase.progression.courtIssues.length, count);
  const solved = new Set();
  for (let round = 1; round <= count; round += 1) {
    const initial = generatedPlayerView(session, runtime);
    assert.equal(initial.investigationTargets.length, count);
    collectCurrentTarget(session, runtime);
    assert.equal(generatedPlayerView(session, runtime).workbench.materials.find(item => item.materialId === currentCorrectPair(runtime, round).evidenceId).question.choices.length, 4);
    assert.ok(generatedPlayerView(session, runtime).currentEvidenceIds.length > 0);
    assert.ok(generatedPlayerView(session, runtime).currentEvidenceIds.every(id => session.collectedEvidenceIds.includes(id)));
    assert.throws(() => actGenerated(session, runtime, { action: 'retrial', evidenceId: currentCorrectPair(runtime, round).evidenceId }), { code: 'INTERPRETATION_CHOICE_REQUIRED' });
    const view = enterCurrentCourt(session, runtime);
    const pair = currentCorrectPair(runtime, round);
    assert.equal(solved.has(pair.statementId), false);
    for (const id of solved) {
      assert.ok(!view.testimonies.some(item => item.statements.some(statement => statement.statementId === id)));
      assert.throws(() => actGenerated(session, runtime, { action: 'objection', statementId: id,
        evidenceId: pair.evidenceId }), error => error.code === 'STATEMENT_NOT_IN_CURRENT_ISSUE');
      assert.equal(session.currentState, 'RETRIAL_COURT'); assert.equal(session.attemptCount, 0);
    }
    const result = actGenerated(session, runtime, { action: 'objection', ...pair });
    solved.add(pair.statementId);
    assert.equal(result.currentState, round === count ? 'ACQUITTED' : 'INVESTIGATION');
    assert.doesNotMatch(JSON.stringify(result), /courtIssues|judgmentRuleIds|requiredEvidenceIds|groundTruth/);
  }
});

test('questions needing a future investigation are rejected within the bounded revision loop', async () => {
  const { author, runner } = await generate({ changeDraft: draft => {
    for (const item of draft.contradictions) item.conflictingEvidenceIds = ['evidence_technical_a', 'evidence_technical_b'];
    syncQuestionQuotes(draft);
    for (const question of draft.courtQuestions) question.explanation += question.supportingQuotes
      .map(item => observationAnchors(item.quote)[0]).join('、');
  } });
  assert.equal(author.auto.state, 'FAILED'); assert.equal(author.runtime, null);
  assert.equal(runner.evidenceCalls, 2);
  assert.ok(author.auto.details.some(item => item.code === 'SEQUENTIAL_INVESTIGATION_UNSOLVABLE'));
});

test('a stage cannot reuse an earlier source as its only support', async () => {
  const { author } = await generate({ changeDraft: draft => {
    draft.contradictions.find(item => item.statementRef === 'statement_seen_operation')
      .conflictingEvidenceIds = ['evidence_technical_a'];
    syncQuestionQuotes(draft);
  } });
  assert.equal(author.auto.state, 'FAILED');
  assert.ok(author.auto.details.some(item => item.code === 'INVESTIGATION_STAGE_EVIDENCE_MISSING'));
});

test('final acquittal requires multiple verified support records, not just the selected correct evidence', async () => {
  const { author } = await generate(); const { runtime } = author;
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  const session = begin(runtime); acquire(session, runtime, ['evidence_technical_a']);
  enterCurrentCourt(session, runtime);
  actGenerated(session, runtime, { action: 'objection', ...currentCorrectPair(runtime, 1) });
  assert.equal(session.currentRound, 2);
  collectCurrentTarget(session, runtime);
  const owned = [...session.collectedEvidenceIds];
  // Even with automatic collection, a corrupted/incomplete session cannot skip the gate.
  session.collectedEvidenceIds = ['evidence_technical_a'];
  assert.equal(generatedPlayerView(session, runtime).workbench.progress.complete, false);
  assert.throws(() => enterCurrentCourt(session, runtime), { code: 'COURT_RETURN_CONDITION_NOT_MET' });
  session.collectedEvidenceIds = owned;
  enterCurrentCourt(session, runtime);
  actGenerated(session, runtime, { action: 'objection', ...currentCorrectPair(runtime, 2) });
  assert.equal(generatedPlayerView(session, runtime).currentState, 'ACQUITTED');
});

test('explicit material investigation refuses unmet dependencies atomically', async () => {
  const { author } = await generate();
  const runtime = author.runtime;
  const session = createGeneratedGame(runtime);
  actGenerated(session, runtime, { action: 'begin' });
  const firstTarget = runtime.gameCase.progression.courtIssues[0].investigationTargetId;
  const rules = runtime.gameCase.detective.evidenceDiscoveryRules;
  const future = rules.find(rule => rule.targetId !== firstTarget).evidenceId;
  rules.find(rule => rule.targetId === firstTarget).prerequisites.requiredEvidenceIds = [future];
  actGenerated(session, runtime, { action: 'continue' });
  const before = structuredClone(session);
  assert.throws(() => inspectMaterial(session, runtime, rules.find(rule => rule.targetId === firstTarget).evidenceId), { code: 'MATERIAL_PREREQUISITES_REQUIRED' });
  assert.deepEqual(session, before);
});

test('missing or duplicated claims stop after bounded revisions instead of repeating one claim', async () => {
  const { author, runner } = await generate({ changeDraft: draft => {
    draft.contradictions.splice(1);
    const testimony = draft.evidenceArtifacts.find(item => item.type === 'TESTIMONY');
    testimony.testimony.statements = testimony.testimony.statements.filter(item => !item.statementId.startsWith('statement_issue_'));
    testimony.publicContent = testimony.testimony.statements.map(item => item.spokenContent).join('\n');
  } });
  assert.equal(author.auto.state, 'FAILED'); assert.equal(runner.evidenceCalls, 2);
  assert.equal(author.runtime, null);
  assert.ok(author.auto.details.some(item => item.code === 'DISTINCT_COURT_ISSUES_REQUIRED'));
  const set = { evidenceArtifacts: [{ type: 'TESTIMONY', testimony: { statements: [
    { statementId: 'a', spokenContent: '同じ主張' }, { statementId: 'b', spokenContent: '同じ 主張' }] } }],
  contradictions: [{ statementRef: 'a' }, { statementRef: 'b' }] };
  assert.equal(courtIssueGenerationProblems(set, 2)[0].code, 'DISTINCT_COURT_ISSUES_REQUIRED');
});
