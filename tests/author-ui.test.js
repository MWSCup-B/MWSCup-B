import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAuthorBootstrap } from '../server/auto-generation-service.js';
import { loadCatalog } from '../server/generation/catalog.js';
import { normalizeScenarioConfiguration, validateScenarioConfiguration }
  from '../server/generation/scenario-configuration.js';
import { startAuthorDom } from './helpers/author-dom.js';

const catalog = await loadCatalog();

test('Author実scriptが4項目と証拠の答えを表示し、入力済みの有効なNetworkを送信する', async () => {
  const bootstrap = autoAuthorBootstrap(); const page = startAuthorDom(bootstrap); await page.ready;
  assert.equal(page.byId('initialization-status').hidden, true);
  assert.equal(page.byId('choose-manual').disabled, false);
  for (const [kind, count] of [['subnets', 2], ['nodes', 5], ['services', 4], ['connections', 5]]) {
    assert.equal(page.document.querySelectorAll(`[data-network-kind="${kind}"]`).length, count);
  }
  const cards = page.document.querySelectorAll('[data-attack-id]');
  assert.equal(cards.length, 1); assert.equal(cards[0].dataset.attackId, 'phishing');
  assert.equal(cards[0].querySelector('[data-key="evidenceAnswer"]').value,
    'メール文のリンク先と実際に遷移するリンク先が異なること');
  await page.byId('choose-manual').dispatch('click');
  await page.byId('manual-create').dispatch('click');
  const submitted = page.calls.find(call => call.path === '/api/author/manual').body.configuration;
  assert.deepEqual(submitted.network, bootstrap.defaultManualConfiguration.network);
  const result = validateScenarioConfiguration(normalizeScenarioConfiguration(submitted, catalog), catalog);
  assert.equal(result.status, 'VALID', JSON.stringify(result.errors));
});

test('初期設定応答を待つ間は操作できず、強制呼出しでもnetwork:nullを送信しない', async () => {
  let resolveBootstrap;
  const page = startAuthorDom(new Promise(resolve => { resolveBootstrap = resolve; }));
  assert.equal(page.byId('choose-manual').disabled, true);
  assert.equal(page.byId('manual-create').disabled, true);
  await page.byId('choose-manual').dispatch('click', { force: true });
  await page.byId('manual-create').dispatch('click', { force: true });
  assert.deepEqual(page.calls.map(call => call.path), ['/api/author/start']);
  resolveBootstrap(autoAuthorBootstrap()); await page.ready;
  assert.equal(page.byId('choose-manual').disabled, false);
});

for (const [label, mutate] of [
  ['旧サーバー応答（presetなし）', value => { delete value.defaultManualConfiguration; }],
  ['network:null', value => { value.defaultManualConfiguration.network = null; }],
  ['network配列', value => { value.defaultManualConfiguration.network = []; }],
  ['nodes欠落', value => { delete value.defaultManualConfiguration.network.nodes; }],
]) test(`${label}は見える位置に初期化エラーを表示し、生成APIへ送信しない`, async () => {
  const bootstrap = autoAuthorBootstrap(); mutate(bootstrap);
  const page = startAuthorDom(bootstrap); await page.ready;
  assert.equal(page.byId('initialization-status').hidden, false);
  assert.match(page.byId('initialization-status').textContent, /初期設定.*再起動/);
  assert.equal(page.byId('choose-manual').disabled, true);
  assert.equal(page.byId('choose-makotomaru').disabled, true);
  await page.byId('manual-create').dispatch('click', { force: true });
  await page.byId('makotomaru-create').dispatch('click', { force: true });
  assert.deepEqual(page.calls.map(call => call.path), ['/api/author/start']);
});

test('フォーム要素の欠落も初期化未完了とし、生成を許可しない', async () => {
  const page = startAuthorDom(autoAuthorBootstrap(), { missingElementId: 'service-rows' });
  await page.ready;
  assert.equal(page.byId('initialization-status').hidden, false);
  assert.equal(page.byId('manual-create').disabled, true);
  await page.byId('manual-create').dispatch('click', { force: true });
  assert.equal(page.calls.length, 0);
});

test('初期設定API失敗を空の詳細設定画面として扱わない', async () => {
  const page = startAuthorDom(null, { startError: new Error('通信できませんでした。') });
  await page.ready;
  assert.equal(page.byId('initialization-status').hidden, false);
  assert.equal(page.byId('choose-manual').disabled, true);
});

test('再描画で編集値を戻さず、Network欄が消えた状態では送信しない', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  const card = page.document.querySelector('[data-attack-id]');
  card.querySelector('[data-key="evidenceAnswer"]').value = '利用者が編集した証拠の答え';
  await page.byId('incident-date').dispatch('change');
  assert.equal(page.document.querySelector('[data-key="evidenceAnswer"]').value,
    '利用者が編集した証拠の答え');
  page.byId('node-rows').replaceChildren();
  await page.byId('manual-create').dispatch('click');
  assert.match(page.byId('manual-errors').textContent, /nodes.*送信できません/);
  assert.deepEqual(page.calls.map(call => call.path), ['/api/author/start']);
});
