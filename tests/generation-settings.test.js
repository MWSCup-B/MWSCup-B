import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoGenerationManager, autoAuthorView, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { normalizeGenerationSettings } from '../server/codex/generation-settings.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { autoAuthorBootstrap } from '../server/auto-generation-service.js';
import { startAuthorDom } from './helpers/author-dom.js';

test('攻撃・舞台の基盤設計後もモデル・エフォートは独立検証、修正、証拠生成まで維持される', async () => {
  const runner = new MockCodexRunner({ reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'] });
  const manager = new AutoGenerationManager({ jsonRunner: runner }); const session = createAutoAuthorSession();
  const settings = { schemaVersion: '1.0', model: 'gpt-5.5', reasoningEffort: 'high' };
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['clickfix'], settingId: 'company' }, settings);
  settings.model = 'modified';
  await manager.waitForIdle(); assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  assert.equal(autoAuthorView(session).generationSettings.model, 'gpt-5.5');
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
  const invocations = runner.calls.filter(item => item.kind === 'invocation');
  assert.ok(!invocations.some(call => call.phase === 'GENERATING_SCENARIO'));
  for (const phase of ['REVIEWING_SCENARIO', 'REVISING_SCENARIO', 'GENERATING_EVIDENCE'])
    assert.ok(invocations.some(call => call.phase === phase), phase);
  for (const call of invocations) {
    assert.deepEqual(call.generationSettings, { schemaVersion: '1.0', model: 'gpt-5.5', reasoningEffort: 'high' });
  }
  const other = createAutoAuthorSession(); assert.equal(other.generationSettings.model, '');
});

test('未登録設定、コマンド注入、未知エフォートを生成開始前に拒否する', () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() }); const session = createAutoAuthorSession();
  const before = structuredClone(session);
  for (const value of [null, { schemaVersion: '2.0', model: '', reasoningEffort: '' },
    { schemaVersion: '1.0', model: 'a; command', reasoningEffort: 'high' },
    { schemaVersion: '1.0', model: 'gpt-5.5', reasoningEffort: 'infinite' },
    { schemaVersion: '1.0', model: '', reasoningEffort: '', command: 'evil' }]) {
    assert.throws(() => manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['clickfix'], settingId: 'company' }, value), { code: 'INVALID_GENERATION_SETTINGS' });
    assert.deepEqual(session, before);
  }
  assert.equal(normalizeGenerationSettings().model, '');
});

test('制作画面のモデルとエフォートを送信し、既定への選び直しも明示する', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  page.byId('generation-model').value = 'gpt-5.5'; page.byId('generation-effort').value = 'high';
  await page.byId('create-scenario').dispatch('click');
  assert.deepEqual(page.calls.at(-1).body.generationSettings, { schemaVersion: '1.0', model: 'gpt-5.5', reasoningEffort: 'high' });
  page.byId('generation-model').value = ''; page.byId('generation-effort').value = '';
  await page.byId('create-scenario').dispatch('click');
  assert.deepEqual(page.calls.at(-1).body.generationSettings, { schemaVersion: '1.0', model: '', reasoningEffort: '' });
});
