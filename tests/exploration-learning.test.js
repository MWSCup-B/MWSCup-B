import test from 'node:test';
import { courtEvidenceLines } from '../server/generation/court-evidence.js';
import assert from 'node:assert/strict';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated, generatedPlayerView } from '../server/generated-game.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { currentCorrectPair } from './helpers/court-issues.js';
import { validateExplorableWebLogs } from '../server/generation/evidence-log-format.js';
import { requiredCourtEvidence } from '../server/generation/investigation-workspace.js';

for (const state of ['FAILED', 'CANCELLED', 'READY', 'MODE_SELECTION']) {
  test(`${state}から制作条件を保持して戻り、失敗した成果物を再利用しない`, () => {
    const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
    const session = createAutoAuthorSession();
    session.auto.state = state;
    session.auto.selection = { request: { attackIds: ['sql_injection'], settingId: 'school' } };
    session.runtime = { obsolete: true };
    const previous = structuredClone(session.auto.selection);
    const result = manager.returnToMenu(session);
    assert.equal(result.currentState, 'MODE_SELECTION');
    assert.deepEqual(result.selection, previous);
    assert.ok(!session.runtime);
    session.autoOperationRunning = true;
    assert.throws(() => manager.returnToMenu(session), { code: 'GENERATION_LOCKED' });
  });
}

for (const attack of ['sql_injection', 'stored_xss']) {
  test(`${attack}: 全文の調査と固定された争点から反論し、詳細解説は終了後に読む`, async () => {
    const runner = new MockCodexRunner();
    const manager = new AutoGenerationManager({ jsonRunner: runner });
    const author = createAutoAuthorSession();
    manager.submitSelection(author, { schemaVersion: '1.0', attackIds: [attack], settingId: 'company' });
    await manager.waitForIdle();
    assert.equal(author.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(author.auto.details));
    assert.equal(runner.calls.filter(call => call.phase === 'REVISING_SCENARIO').length, 0);
    if (attack === 'sql_injection') {
      const stages = author.scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage);
      assert.match(stages.at(-1).investigationStage.questionFocus, /statement.*Webの入力本文.*要求しない/);
      assert.doesNotMatch(stages.at(-1).investigationStage.expectedInference, /Web要求の対象・入力部分/);
    }
    manager.approve(author); await manager.waitForIdle();
    assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
    const { runtime } = author;
    const session = createGeneratedGame(runtime);
    const opening = actGenerated(session, runtime, { action: 'begin' });
    assert.match(opening.initialCourt.incidentOverview, /事件が発生/);
    assert.doesNotMatch(opening.initialCourt.incidentOverview, /SQLインジェクション|Stored XSS/);
    assert.equal(opening.initialCourt.presentedMaterials.length, runtime.gameCase.detective.evidence.length);
    if (attack === 'sql_injection') assert.ok(opening.initialCourt.presentedMaterials.some(item => item.type === 'DATABASE_LOG'));
    actGenerated(session, runtime, { action: 'continue' });
    const firstClaim = generatedPlayerView(session, runtime).investigationClaim;
    for (const item of runtime.gameCase.detective.evidence) {
      const view = actGenerated(session, runtime, { action: 'inspect-material', materialId: item.evidenceId, methodId: 'read' });
      assert.equal(view.workbench.result.output, item.publicContent);
      assert.deepEqual(view.investigationClaim, firstClaim);
      assert.equal(view.caseStudy, undefined);
      if (item.type.endsWith('_LOG')) assert.ok(item.publicContent.trim().split('\n').length >= 100);
    }
    for (let round = 1; round <= runtime.gameCase.progression.courtRoundCount; round++) {
      for (const materialId of requiredCourtEvidence(runtime.gameCase, round)) {
        actGenerated(session, runtime, { action: 'workspace-read', materialId });
        for (const line of courtEvidenceLines(runtime.gameCase, round, materialId)) {
          actGenerated(session, runtime, { action: 'save-fact', materialId, line });
        }
      }
      const view = generatedPlayerView(session, runtime);
      const questions = view.workbench.materials.map(item => item.question);
      assert.ok(questions.every(question => JSON.stringify(question) === JSON.stringify(questions[0])));
      assert.doesNotMatch(JSON.stringify(questions), /Stored XSS|SQLインジェクション|correctOptionIndex|supportingQuotes|explanation/);
      const pair = currentCorrectPair(runtime, round);
      actGenerated(session, runtime, { action: 'retrial', ...pair });
      const next = actGenerated(session, runtime, { action: 'objection', ...pair });
      if (round < runtime.gameCase.progression.courtRoundCount) {
        assert.equal(next.result.publicExplanation, undefined);
        assert.equal(next.caseStudy, undefined);
      }
    }
    const ending = generatedPlayerView(session, runtime);
    assert.equal(ending.currentState, 'ACQUITTED');
    assert.equal(ending.caseStudy.incident,
      runtime.publicGameCase.progression.outcomes.acquitted.publicExplanation,
      '解説は審査済みの結論を表示し、非公開の事件設定や攻撃名を別途補わない');
    for (const issue of ending.caseStudy.issues) {
      assert.ok(issue.claim && issue.answer && issue.explanation && issue.references.length);
      for (const ref of issue.references) assert.ok(runtime.gameCase.detective.evidence
        .find(item => item.evidenceId === ref.evidenceId).publicContent.includes(ref.quote));
    }
  });
}

test('対象一行だけのWebログと同じ行の水増しを拒否する', () => {
  const item = { type: 'WEB_ACCESS_LOG', publicContent: '{"timestamp":"09:00","request_target":"/records"}' };
  assert.throws(() => validateExplorableWebLogs([item]), { code: 'EVIDENCE_LOG_CONTEXT_REQUIRED' });
  assert.throws(() => validateExplorableWebLogs([{ ...item, publicContent: Array(8).fill(item.publicContent).join('\n') }]),
    { code: 'EVIDENCE_LOG_CONTEXT_REQUIRED' });
});
