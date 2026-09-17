import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server/server.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';

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
    /groundTruth|judgment|acceptedEvidenceIds|requiredForCourtIds|contradictionRef|exonerationRef|sourceRefs|requirementIds|attackGraphRef|provenance|fingerprint/);
}

test('Generated HTTP APIでTITLEからACQUITTEDまでプレイできる', async t => {
  const post = await setup(t);
  let response = await post('/api/start', {}); let data = await response.json();
  const token = data.token; assert.equal(data.game.currentState, 'TITLE'); assertPublic(data);
  for (const body of [{ action: 'begin' }, { action: 'continue' },
    { action: 'collect', evidenceId: 'evidence_technical_a' }, { action: 'retrial' },
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
  for (const body of [{ action: 'begin' }, { action: 'continue' },
    { action: 'collect', evidenceId: 'evidence_technical_a' }, { action: 'retrial' }]) {
    await post('/api/action', body, a.token);
  }
  assert.equal((await post('/api/action', { action: 'objection',
    evidenceId: 'evidence_technical_a' }, a.token)).status, 400);
  for (const body of [{ action: 'begin' }, { action: 'continue' },
    { action: 'collect', evidenceId: 'evidence_technical_b' }, { action: 'retrial' }]) {
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
