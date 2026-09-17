import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGeneratedGame, validateGameMakeResult }
  from '../server/generation/game-make.js';
import { actGenerated, createGeneratedGame, generatedPlayerView }
  from '../server/generated-game.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';

function built() {
  const fixture = readyGameCaseFixture();
  return { fixture, ...buildGeneratedGame(fixture.gameCaseResult) };
}

function startInvestigation(session, runtime) {
  actGenerated(session, runtime, { action: 'begin' });
  actGenerated(session, runtime, { action: 'continue' });
}

function discover(session, runtime, evidenceId) {
  if (evidenceId === 'evidence_technical_b') discover(session, runtime, 'evidence_technical_a');
  const request = evidenceId === 'evidence_technical_a'
    ? { targetId: 'target_web_server', investigationActionId: 'action_audit_log' }
    : evidenceId === 'evidence_technical_b'
      ? { targetId: 'target_web_server', investigationActionId: 'action_analyze_network_log' }
      : { targetId: 'target_client_endpoint', investigationActionId: 'action_inspect_device' };
  if (!session.discoveredEvidenceIds.includes(evidenceId)) {
    actGenerated(session, runtime, { action: 'investigate', ...request });
  }
}

function discoverAndCollect(session, runtime, evidenceId) {
  discover(session, runtime, evidenceId);
  actGenerated(session, runtime, { action: 'collect', evidenceId });
}

test('READY Game CaseだけをBUILTにしてEvaluation Handoffを生成する', () => {
  const { gameMakeResult } = built();
  assert.equal(gameMakeResult.status, 'BUILT');
  assert.equal(validateGameMakeResult(gameMakeResult), gameMakeResult);
  assert.equal(gameMakeResult.evaluationHandoff.state, 'BUILT');
  assert.equal(gameMakeResult.evaluationHandoff.eligibleForEvaluation, true);
});

test('READY以外とHandoff・fingerprint改変をBLOCKEDにする', () => {
  for (const mutate of [
    value => { value.status = 'BLOCKED'; value.ready = false; },
    value => { value.uiIntegrationHandoff.progressionFingerprint = '0'.repeat(64); },
    value => { value.gameCase.fingerprint = '0'.repeat(64); },
  ]) {
    const value = readyGameCaseFixture().gameCaseResult;
    mutate(value);
    const result = buildGeneratedGame(value);
    assert.equal(result.gameMakeResult.status, 'BLOCKED');
    assert.equal(result.gameMakeResult.evaluationHandoff, null);
    assert.equal(result.runtime, null);
  }
});

test('Generated sessionはTITLEからInitial CourtとInvestigationへ進む', () => {
  const { runtime } = built();
  const session = createGeneratedGame(runtime);
  assert.equal(generatedPlayerView(session, runtime).currentState, 'TITLE');
  const initial = actGenerated(session, runtime, { action: 'begin' });
  assert.equal(initial.currentState, 'INITIAL_COURT');
  assert.equal(initial.initialCourt.attributionStatus, 'ALLEGATION_ONLY');
  assert.equal(initial.initialCourt.presentedEvidence[0].publicContent,
    runtime.gameCase.detective.evidence.find(item =>
      item.evidenceId === 'evidence_technical_b').publicContent);
  assert.equal(actGenerated(session, runtime, { action: 'continue' }).currentState, 'INVESTIGATION');
});

test('InvestigationはTarget + Actionで発見したEvidenceだけを取得しBackend sessionへ保存する', () => {
  const { runtime } = built();
  const session = createGeneratedGame(runtime); startInvestigation(session, runtime);
  const initial = generatedPlayerView(session, runtime);
  assert.equal(initial.discoveredEvidence.length, 0);
  assert.ok(initial.investigationTargets.length >= 2);
  assert.throws(() => actGenerated(session, runtime, { action: 'investigate',
    targetId: 'missing_target', investigationActionId: 'action_audit_log' }),
  { code: 'UNKNOWN_INVESTIGATION_TARGET' });
  assert.throws(() => actGenerated(session, runtime, { action: 'investigate',
    targetId: 'target_web_server', investigationActionId: 'action_check_email' }),
  { code: 'INVESTIGATION_ACTION_NOT_AVAILABLE' });
  assert.throws(() => actGenerated(session, runtime,
    { action: 'collect', evidenceId: 'evidence_technical_a' }), { code: 'EVIDENCE_NOT_DISCOVERED' });
  const found = actGenerated(session, runtime, { action: 'investigate',
    targetId: 'target_web_server', investigationActionId: 'action_audit_log' });
  assert.equal(found.lastInvestigationResult.discovered, true);
  assert.deepEqual(found.lastInvestigationResult.discoveredEvidenceIds, ['evidence_technical_a']);
  assert.equal(found.discoveredEvidence[0].discoveryState, 'DISCOVERED');
  actGenerated(session, runtime, { action: 'collect', evidenceId: 'evidence_technical_a' });
  assert.deepEqual(session.collectedEvidenceIds, ['evidence_technical_a']);
  assert.equal(generatedPlayerView(session, runtime).discoveredEvidence[0].discoveryState, 'COLLECTED');
  assert.doesNotMatch(JSON.stringify(generatedPlayerView(session, runtime)), /requiredForCourtIds/);
});

test('Retrialは複数statementを表示し未取得Evidenceを提示させない', () => {
  const { runtime } = built();
  const session = createGeneratedGame(runtime); startInvestigation(session, runtime);
  discoverAndCollect(session, runtime, 'evidence_technical_a');
  const court = actGenerated(session, runtime, { action: 'retrial' });
  assert.equal(court.testimonies[0].statements.length, 2);
  assert.throws(() => actGenerated(session, runtime, { action: 'objection',
    statementId: 'statement_seen_operation', evidenceId: 'evidence_technical_b' }),
  { code: 'EVIDENCE_NOT_OWNED' });
});

test('正しいstatementとEvidenceだけでACQUITTEDへ進む', () => {
  const { runtime } = built();
  const session = createGeneratedGame(runtime); startInvestigation(session, runtime);
  discoverAndCollect(session, runtime, 'evidence_technical_a');
  actGenerated(session, runtime, { action: 'retrial' });
  const view = actGenerated(session, runtime, { action: 'objection',
    statementId: 'statement_seen_operation', evidenceId: 'evidence_technical_a' });
  assert.equal(view.currentState, 'ACQUITTED');
  assert.equal(view.acquittal.publicRuling, '被告人を無罪とします。');
});

test('誤りはGUILTY_RETRYから再調査へ戻り上限でBLOCKEDになる', () => {
  const { runtime } = built();
  const session = createGeneratedGame(runtime); startInvestigation(session, runtime);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    discoverAndCollect(session, runtime, 'evidence_technical_a');
    discoverAndCollect(session, runtime, 'evidence_technical_b');
    actGenerated(session, runtime, { action: 'retrial' });
    const view = actGenerated(session, runtime, { action: 'objection',
      statementId: 'statement_checked_time', evidenceId: 'evidence_technical_b' });
    assert.equal(view.currentState, attempt === 3 ? 'BLOCKED' : 'GUILTY_RETRY');
    if (attempt < 3) actGenerated(session, runtime, { action: 'retry' });
  }
  assert.equal(session.previousAttempts.length, 3);
  assert.equal(session.attemptCount, 3);
});

test('statement未指定を拒否しBackendが暗黙選択しない', () => {
  const { runtime } = built();
  const session = createGeneratedGame(runtime); startInvestigation(session, runtime);
  discoverAndCollect(session, runtime, 'evidence_technical_a');
  actGenerated(session, runtime, { action: 'retrial' });
  assert.throws(() => actGenerated(session, runtime,
    { action: 'objection', evidenceId: 'evidence_technical_a' }), { code: 'STATEMENT_REQUIRED' });
});

test('公開viewへInternal Judgment・Ground Truth・fingerprintを出さない', () => {
  const { runtime } = built();
  const session = createGeneratedGame(runtime);
  for (const state of ['TITLE', 'INITIAL_COURT', 'INVESTIGATION']) {
    if (state === 'INITIAL_COURT') actGenerated(session, runtime, { action: 'begin' });
    if (state === 'INVESTIGATION') actGenerated(session, runtime, { action: 'continue' });
    assert.doesNotMatch(JSON.stringify(generatedPlayerView(session, runtime)),
      /judgment|acceptedEvidenceIds|requiredForCourtIds|contradictionRef|exonerationRef|groundTruth|fingerprint|attackGraphRef|provenance/);
  }
});

test('Browser描画はtextContentを使用しHTML実行APIを使わない', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
});
