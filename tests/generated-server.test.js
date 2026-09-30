import test from 'node:test';
import { procedureMethods } from '../server/generation/investigation-procedures.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server/server.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';
import { AutoGenerationManager, autoAuthorBootstrap, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { currentCorrectPair } from './helpers/court-issues.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { requiredCourtEvidence } from '../server/generation/investigation-workspace.js';

async function setup(t, result = readyGameCaseFixture().gameCaseResult) {
  const server = createAppServer({ mode: 'GENERATED', gameCaseResult: result });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, body, token) => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

function assertPublic(value) {
  assert.doesNotMatch(JSON.stringify(value),
    /groundTruth|judgment|acceptedEvidenceIds|requiredForCourtIds|requiredEvidenceIds|requiredCompletedActionIds|evidenceDiscoveryRules|sourceNodeRef|contradictionRef|exonerationRef|sourceRefs|requirementIds|attackGraphRef|provenance|fingerprint|correctOptionIndex|correctChoiceId|supportingQuotes/);
}

test('reference-based artwork is served only from explicitly allowed PNG asset paths', async t => {
  const server = createAppServer({ mode: 'GENERATED', gameCaseResult: readyGameCaseFixture().gameCaseResult });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['backgrounds/courtroom-v2.png', 'backgrounds/investigation-v2.png',
    'characters/defense-portrait-v2.png', 'characters/prosecutor-portrait-v2.png',
    'characters/assistant-portrait-v1.png', 'title/title.png']) {
    const response = await fetch(`${origin}/assets/${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const data = Buffer.from(await response.arrayBuffer());
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  for (const path of ['/image/anything.png', '/assets/characters/unregistered.png',
    '/assets/characters/defense-portrait-v2.png:Zone.Identifier']) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
});

const discoverA = [
  { action: 'investigate', targetId: 'target_web_server',
    investigationActionId: 'action_audit_log' },
  { action: 'collect', evidenceId: 'evidence_technical_a' },
];
const discoverB = [
  { action: 'investigate', targetId: 'target_web_server',
    investigationActionId: 'action_audit_log' },
  { action: 'investigate', targetId: 'target_web_server',
    investigationActionId: 'action_analyze_network_log' },
  { action: 'collect', evidenceId: 'evidence_technical_b' },
];

test('Generated HTTP APIでTITLEからACQUITTEDまでプレイできる', async t => {
  const post = await setup(t);
  let response = await post('/api/start', {}); let data = await response.json();
  const token = data.token; assert.equal(data.game.currentState, 'TITLE'); assertPublic(data);
  for (const body of [{ action: 'begin' }, { action: 'continue' }, ...discoverA, { action: 'retrial' },
    { action: 'objection', statementId: 'statement_seen_operation',
      evidenceId: 'evidence_technical_a' }]) {
    response = await post('/api/action', body, token); assert.equal(response.status, 200);
    data = await response.json(); assertPublic(data);
  }
  assert.equal(data.game.currentState, 'ACQUITTED');
});

test('Generated HTTP APIはstatement省略・別session Evidence・内部fieldを拒否する', async t => {
  const post = await setup(t);
  const a = await (await post('/api/start', {})).json();
  const b = await (await post('/api/start', {})).json();
  for (const body of [{ action: 'begin' }, { action: 'continue' }, ...discoverA,
    { action: 'retrial' }]) {
    await post('/api/action', body, a.token);
  }
  assert.equal((await post('/api/action', { action: 'objection',
    evidenceId: 'evidence_technical_a' }, a.token)).status, 400);
  for (const body of [{ action: 'begin' }, { action: 'continue' }, ...discoverB,
    { action: 'retrial' }]) {
    await post('/api/action', body, b.token);
  }
  assert.equal((await post('/api/action', { action: 'objection',
    statementId: 'statement_seen_operation', evidenceId: 'evidence_technical_a' }, b.token)).status, 409);
  assert.equal((await post('/api/action', { action: 'retry', judgment: {} }, b.token)).status, 400);
});

test('BLOCKED buildでは開始を拒否しFixtureへフォールバックしない', async t => {
  const result = readyGameCaseFixture().gameCaseResult;
  result.uiIntegrationHandoff.progressionFingerprint = '0'.repeat(64);
  const post = await setup(t, result);
  const response = await post('/api/start', {});
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.error.code, 'GAME_BUILD_BLOCKED');
  assertPublic(data);
});

test('Server modeは必須でGeneratedとFixtureを暗黙混在させない', () => {
  assert.throws(() => createAppServer(), { code: 'GAME_MODE_REQUIRED' });
});

test('4択HTTP APIは解釈省略・正解注入を拒否し、全争点を解釈と証拠で解決できる', async t => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const author = createAutoAuthorSession();
  manager.submitManual(author, autoAuthorBootstrap().defaultManualConfiguration);
  await manager.waitForIdle(); manager.approve(author); await manager.waitForIdle();
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  const post = await setup(t, author.gameCaseResult);
  const started = await (await post('/api/start', {})).json(); const { token } = started;
  assert.equal(started.game.answerMode, 'INTERPRETATION_AND_EVIDENCE'); assertPublic(started);
  async function action(body) {
    const response = await post('/api/action', body, token);
    assert.equal(response.status, 200); const value = await response.json(); assertPublic(value); return value.game;
  }
  await action({ action: 'begin' }); await action({ action: 'continue' });
  let game;
  for (let round = 1; round <= author.runtime.gameCase.progression.courtRoundCount; round += 1) {
    const issue = author.runtime.gameCase.progression.courtIssues[round - 1];
    for (const rule of author.runtime.gameCase.detective.evidenceDiscoveryRules.filter(item => item.targetId === issue.investigationTargetId)) {
      if (round === 1) {
        const forged = await post('/api/action', { action: 'save-fact', materialId: rule.evidenceId, line: 1 }, token);
        assert.equal(forged.status, 400);
        assert.equal((await forged.json()).error.code, 'FACT_NOT_SEEN');
        game = await action({ action: 'workspace-command', materialId: rule.evidenceId, command: 'cat material.txt; whoami' });
        assert.equal(game.workbench.materials.find(item => item.materialId === rule.evidenceId).history.at(-1).valid, false);
        game = await action({ action: 'workspace-read', materialId: rule.evidenceId });
        assert.equal(game.workbench.materials.find(item => item.materialId === rule.evidenceId).collected, false);
        game = await action({ action: 'save-fact', materialId: rule.evidenceId, line: 1 });
        continue;
      }
      const plan = author.runtime.gameCase.progression.materialInvestigations.find(item => item.evidenceId === rule.evidenceId);
      for (const [index, step] of plan.steps.entries()) game = await action({ action: 'inspect-material', materialId: rule.evidenceId,
        methodId: procedureMethods(plan, index).find(item => item.index === step.correctOptionIndex).methodId });
    }
    for (const materialId of requiredCourtEvidence(author.runtime.gameCase, round)) {
      game = await action({ action: 'workspace-read', materialId });
      game = await action({ action: 'save-fact', materialId, line: 1 });
    }
    const evidenceId = currentCorrectPair(author.runtime, round).evidenceId;
    assert.equal(game.workbench.materials.find(item => item.materialId === evidenceId).question.choices.length, 4);
    const rejected = await post('/api/action', { action: 'retrial', evidenceId }, token);
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error.code, 'INTERPRETATION_CHOICE_REQUIRED');
    game = await action({ action: 'retrial', evidenceId, interpretationChoiceId: currentCorrectPair(author.runtime, round).interpretationChoiceId });
    if (round === 1) {
      const submitted = game.presentableEvidence.find(item => item.evidenceId === evidenceId);
      const source = author.runtime.gameCase.detective.evidence.find(item => item.evidenceId === evidenceId);
      assert.deepEqual(submitted.savedFacts, [{ line: 1, text: source.publicContent.split(/\r?\n/)[0] }]);
      assert.equal(submitted.publicContent, submitted.savedFacts[0].text);
      assert.notEqual(submitted.publicContent, source.publicContent);
    }
    const injected = await post('/api/action', { action: 'objection', ...currentCorrectPair(author.runtime, round),
      correctOptionIndex: 0 }, token);
    assert.equal(injected.status, 400);
    game = await action({ action: 'objection', ...currentCorrectPair(author.runtime, round) });
    assert.equal(typeof game.result.publicExplanation, game.currentState === 'ACQUITTED' ? 'string' : 'undefined');
  }
  assert.equal(game.currentState, 'ACQUITTED');
});
