import test from 'node:test';
import assert from 'node:assert/strict';
import { executeMaterialCommand, commandTemplates, workspaceAction, workspaceMaterial, investigationProgress }
  from '../server/generation/investigation-workspace.js';
import { buildTechnicalEvidenceCatalog, technicalEvidenceCoverageIssues } from '../server/generation/technical-evidence-catalog.js';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated, generatedPlayerView } from '../server/generated-game.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { currentCorrectPair } from './helpers/court-issues.js';

const log = { evidenceId: 'auth', title: '認証記録', type: 'AUTHENTICATION_LOG',
  publicContent: Array.from({ length: 41 }, (_, index) => JSON.stringify({ timestamp: `2026-09-27T10:${String(index).padStart(2, '0')}:00Z`,
    source_ip: index % 2 ? '192.0.2.20' : '192.0.2.10', account: `user-${index % 4}`, result: index < 30 ? 'failure' : 'success' })).join('\n') };

test('fixed-log commands preserve full output and counts; unsupported shell syntax stays data', () => {
  assert.equal(executeMaterialCommand(log, 'cat material.txt').matchedRecords, 41);
  const tail = executeMaterialCommand(log, 'tail -n 12 material.txt');
  assert.equal(tail.matchedRecords, 12); assert.deepEqual(tail.lines, Array.from({ length: 12 }, (_, index) => index + 30));
  assert.equal(executeMaterialCommand(log, 'grep -F "failure" material.txt').matchedRecords, 30);
  assert.equal(executeMaterialCommand(log, `jq -c 'select(.result == "success")' material.txt`).matchedRecords, 11);
  const count = executeMaterialCommand(log, "jq -r '.account' material.txt | sort | uniq -c");
  assert.deepEqual(count.lines, []); assert.match(count.output, /11 user-0/);
  const missing = { ...log, publicContent: '{"account":"a"}\n{"account":null}\n{"result":"failure"}' };
  assert.equal(executeMaterialCommand(missing, "jq -r '.account' material.txt | sort | uniq -c").output, '1 a\n2 null');
  for (const command of ['cat /etc/passwd', 'cat material.txt; whoami', '$(whoami)', 'curl https://example.com', 'cat -n 5 material.txt', 'tail -n 0 material.txt'])
    assert.equal(executeMaterialCommand(log, command).valid, false);
  const hostile = { ...log, publicContent: '$(touch unsafe)\n<script>unsafe</script>\n' };
  assert.equal(executeMaterialCommand(hostile, 'grep -F "$(touch unsafe)" material.txt').output, '$(touch unsafe)');
  for (const template of commandTemplates(log).filter(item => ['成功', '失敗'].includes(item.label)))
    assert.equal(executeMaterialCommand(log, template.command).valid, true);
  for (const publicContent of ['{"account":9007199254740993}', '{"result":"failure","result":"success"}']) {
    const item = { ...log, publicContent };
    assert.equal(executeMaterialCommand(item, 'cat material.txt').output, publicContent);
    assert.equal(executeMaterialCommand(item, `jq -c 'select(.result == "success")' material.txt`).valid, false);
    assert.deepEqual(executeMaterialCommand(item, 'cat material.txt').observations, []);
  }
});

test('observations never collect evidence and forged facts are rejected; completion includes related documents', () => {
  const game = { detective: { evidence: [log], evidenceDiscoveryRules: [{ evidenceId: 'auth', targetId: 'server', actionId: 'read',
    prerequisites: { requiredEvidenceIds: [], requiredCompletedActionIds: [] } }] },
  progression: { courtIssues: [{ requiredEvidenceIds: ['auth', 'policy'], question: { supportingQuotes: [] } }] } };
  const session = { currentRound: 1, collectedEvidenceIds: [], discoveredEvidenceIds: [], completedInvestigationActions: [] };
  assert.throws(() => workspaceAction(session, game, { action: 'save-fact', materialId: 'auth', line: 1 }), { code: 'FACT_NOT_SEEN' });
  workspaceAction(session, game, { action: 'workspace-command', materialId: 'auth', command: 'head -n 1 material.txt' });
  assert.deepEqual(workspaceMaterial(session, log).facts.map(item => item.line), [1]);
  workspaceAction(session, game, { action: 'save-observation', materialId: 'auth', field: 'source_ip', value: '192.0.2.10' });
  assert.deepEqual(session.collectedEvidenceIds, []);
  assert.throws(() => workspaceAction(session, game, { action: 'save-observation', materialId: 'auth', field: 'source_ip', value: '192.0.2.20' }), { code: 'OBSERVATION_NOT_SEEN' });
  workspaceAction(session, game, { action: 'save-fact', materialId: 'auth', line: 1 });
  assert.equal(investigationProgress(session, game).complete, false);
  session.collectedEvidenceIds.push('policy'); assert.equal(investigationProgress(session, game).complete, true);
  const unusual = structuredClone(game);
  unusual.detective.evidence[0].evidenceId = 'constructor';
  unusual.detective.evidenceDiscoveryRules[0].evidenceId = 'constructor';
  workspaceAction(session, unusual, { action: 'workspace-read', materialId: 'constructor' });
  workspaceAction(session, unusual, { action: 'save-fact', materialId: 'constructor', line: 1 });
  assert.equal(workspaceMaterial(session, unusual.detective.evidence[0]).savedFacts[0].line, 1);
});

test('technical preflight and coverage require the available route and correct non-testimony type', () => {
  const ground = { sourceType: 'ATTACK_GRAPH_ARTIFACT', attackNodeId: 'attack', sourceId: 'observed' };
  const requirements = [{ requirementId: 'req', grounds: [ground] }];
  assert.throws(() => buildTechnicalEvidenceCatalog([], requirements), { code: 'TECHNICAL_EVIDENCE_PREFLIGHT_FAIL' });
  const catalog = buildTechnicalEvidenceCatalog([{ routes: [{ ground, evidenceType: 'AUTHENTICATION_LOG', sourceNodeId: 'server', logSource: 'AUTH_LOG', actionId: 'read' }] }], requirements);
  for (const type of ['TESTIMONY', 'DOCUMENT']) assert.equal(technicalEvidenceCoverageIssues(catalog,
    [{ type, sourceRefs: [ground], requirementIds: ['req'] }]).length, 1);
  assert.deepEqual(technicalEvidenceCoverageIssues(catalog, [{ type: 'AUTHENTICATION_LOG', sourceRefs: [ground], requirementIds: ['req'] }]), []);
});

for (const attacks of [['unauthorized_login'], ['password_spray'], ['password_spray', 'unauthorized_login', 'stored_xss']]) {
  test(`${attacks.join(' → ')}: generation, shared workspace, sourced evidence, court and privacy`, async () => {
    const runner = new MockCodexRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
    const author = createAutoAuthorSession();
    manager.submitSelection(author, { schemaVersion: '1.0', attackIds: attacks, settingId: 'company' });
    await manager.waitForIdle(); assert.equal(author.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(author.auto.details));
    manager.approve(author); await manager.waitForIdle(); assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
    assert.ok(runner.calls.find(call => call.phase === 'GENERATING_EVIDENCE').data.technicalEvidenceCatalog.entries.length);
    const { runtime } = author; const session = createGeneratedGame(runtime);
    actGenerated(session, runtime, { action: 'begin' }); actGenerated(session, runtime, { action: 'continue' });
    for (const material of generatedPlayerView(session, runtime).workbench.materials) {
      const view = actGenerated(session, runtime, { action: 'workspace-read', materialId: material.materialId });
      assert.ok(!session.collectedEvidenceIds.includes(material.materialId));
      assert.doesNotMatch(JSON.stringify(view), /correctOptionIndex|groundTruth|supportingQuotes|expectedInference/);
      const current = view.workbench.materials.find(item => item.materialId === material.materialId);
      assert.ok(current.facts.length > 0);
      const observation = current.history.at(-1).observations.find(item => item.field === 'source_ip');
      if (observation) actGenerated(session, runtime, { action: 'save-observation', materialId: material.materialId, ...observation });
      actGenerated(session, runtime, { action: 'save-fact', materialId: material.materialId, line: 1 });
    }
    const saved = structuredClone(session.savedObservations ?? []);
    assert.deepEqual(generatedPlayerView(session, runtime).workbench.savedObservations, saved);
    for (let round = 1; round <= runtime.gameCase.progression.courtRoundCount; round++) {
      assert.equal(generatedPlayerView(session, runtime).workbench.progress.complete, true);
      const pair = currentCorrectPair(runtime, round);
      const court = actGenerated(session, runtime, { action: 'retrial', ...pair });
      for (const item of court.presentableEvidence) {
        assert.deepEqual(item.savedFacts, session.savedFacts[item.evidenceId]);
        assert.equal(item.publicContent, session.savedFacts[item.evidenceId].map(fact => fact.text).join('\n'));
      }
      actGenerated(session, runtime, { action: 'objection', ...pair });
    }
    assert.equal(session.currentState, 'ACQUITTED');
    const fresh = createGeneratedGame(runtime); actGenerated(fresh, runtime, { action: 'begin' });
    assert.deepEqual(actGenerated(fresh, runtime, { action: 'continue' }).workbench.savedObservations, []);
  });
}
