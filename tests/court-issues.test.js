import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AutoGenerationManager, autoAuthorBootstrap, createAutoAuthorSession }
  from '../server/auto-generation-service.js';
import { actGenerated, createGeneratedGame, generatedPlayerView } from '../server/generated-game.js';
import { courtIssueGenerationProblems } from '../server/generation/court-issues.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { currentCorrectPair } from './helpers/court-issues.js';

test('Scenario revision and independent review prompts preserve the new distinct-issue count', async () => {
  for (const name of ['scenario-generation-v1', 'scenario-verification-v1']) {
    const prompt = await readFile(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');
    assert.match(prompt, /difficulty \+ 1/);
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
    actGenerated(session, runtime, { action: 'investigate', targetId: rule.targetId, investigationActionId: rule.actionId });
    if (ids.includes(rule.evidenceId)) actGenerated(session, runtime, { action: 'collect', evidenceId: rule.evidenceId });
  }
}

for (const difficulty of [1, 2, 3]) test(`★${difficulty} resolves ${difficulty + 1} distinct claims and cannot replay a solved answer`, async () => {
  const { author } = await generate({ difficulty });
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  const { runtime } = author; const session = begin(runtime); acquire(session, runtime);
  assert.equal(runtime.gameCase.progression.courtIssues.length, difficulty + 1);
  const solved = new Set();
  for (let round = 1; round <= difficulty + 1; round += 1) {
    const view = actGenerated(session, runtime, { action: 'retrial' });
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
    assert.equal(result.currentState, round === difficulty + 1 ? 'ACQUITTED' : 'INVESTIGATION');
    assert.doesNotMatch(JSON.stringify(result), /courtIssues|judgmentRuleIds|requiredEvidenceIds|groundTruth/);
  }
});

test('incomplete corroboration returns to investigation without losing evidence; wrong and insufficient attempts share finite budget', async () => {
  const { author } = await generate({ changeDraft: draft => {
    for (const item of draft.contradictions) item.conflictingEvidenceIds = ['evidence_technical_a', 'evidence_technical_b'];
  } });
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  const { runtime } = author; const session = begin(runtime);
  acquire(session, runtime, ['evidence_technical_a']);
  const pair = currentCorrectPair(runtime);
  const view = actGenerated(session, runtime, { action: 'retrial' });
  assert.equal(view.currentState, 'RETRIAL_COURT'); // A return to court is not a solvability oracle.
  actGenerated(session, runtime, { action: 'investigation' });
  assert.equal(session.attemptCount, 0);
  actGenerated(session, runtime, { action: 'retrial' });
  const failure = actGenerated(session, runtime, { action: 'objection', ...pair });
  assert.equal(failure.currentState, 'GUILTY_RETRY'); assert.equal(failure.remainingAttempts, 2);
  assert.doesNotMatch(JSON.stringify(failure), /evidence_technical_b|requiredEvidenceIds|acceptedEvidenceIds/);
  actGenerated(session, runtime, { action: 'retry' });
  assert.deepEqual(session.collectedEvidenceIds, ['evidence_technical_a']);
  actGenerated(session, runtime, { action: 'collect', evidenceId: 'evidence_technical_b' });
  actGenerated(session, runtime, { action: 'retrial' });
  actGenerated(session, runtime, { action: 'objection', ...pair });
  assert.equal(session.currentRound, 2); assert.equal(session.attemptCount, 0);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    actGenerated(session, runtime, { action: 'retrial' });
    const failed = actGenerated(session, runtime, { action: 'objection',
      statementId: 'statement_record_exists', evidenceId: 'evidence_technical_a' });
    assert.equal(failed.remainingAttempts, 3 - attempt);
    assert.equal(failed.currentState, attempt === 3 ? 'BLOCKED' : 'GUILTY_RETRY');
    if (attempt < 3) actGenerated(session, runtime, { action: 'retry' });
  }
  assert.throws(() => actGenerated(session, runtime, { action: 'retry' }), /現在の状態/);
});

test('final acquittal requires multiple verified support records, not just the selected correct evidence', async () => {
  const { author } = await generate(); const { runtime } = author;
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  const session = begin(runtime); acquire(session, runtime, ['evidence_technical_a']);
  actGenerated(session, runtime, { action: 'retrial' });
  actGenerated(session, runtime, { action: 'objection', ...currentCorrectPair(runtime, 1) });
  assert.equal(session.currentRound, 2);
  actGenerated(session, runtime, { action: 'retrial' });
  const failed = actGenerated(session, runtime, { action: 'objection', ...currentCorrectPair(runtime, 2) });
  assert.equal(failed.currentState, 'GUILTY_RETRY');
  actGenerated(session, runtime, { action: 'retry' });
  actGenerated(session, runtime, { action: 'collect', evidenceId: 'evidence_technical_b' });
  actGenerated(session, runtime, { action: 'retrial' });
  actGenerated(session, runtime, { action: 'objection', ...currentCorrectPair(runtime, 2) });
  assert.equal(generatedPlayerView(session, runtime).currentState, 'ACQUITTED');
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
