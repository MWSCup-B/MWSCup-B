import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAuthorBootstrap } from '../server/auto-generation-service.js';
import { loadCatalog } from '../server/generation/catalog.js';
import { normalizeScenarioConfiguration, validateScenarioConfiguration }
  from '../server/generation/scenario-configuration.js';
import { startAuthorDom } from './helpers/author-dom.js';

const catalog = await loadCatalog();

async function advanceToReview(page) {
  for (let index = 0; index < 7; index++) await page.byId('manual-next').dispatch('click');
}

test('初期画面はGame Startだけを提示し、用途選択から作成方法へ段階遷移する', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  assert.equal(page.byId('splash-panel').hidden, false);
  assert.equal(page.byId('activity-panel').hidden, true);
  assert.equal(page.byId('mode-panel').hidden, true);
  assert.equal(page.byId('game-start').hidden, false);
  assert.ok(page.byId('ready-back'));
  await page.byId('game-start').dispatch('click');
  assert.equal(page.byId('splash-panel').hidden, true);
  assert.equal(page.byId('activity-panel').hidden, false);
  await page.byId('choose-court').dispatch('click');
  assert.equal(page.byId('court-entry-panel').hidden, false);
  assert.equal(page.byId('court-empty').hidden, false);
  await page.byId('court-create-game').dispatch('click');
  assert.equal(page.byId('mode-panel').hidden, false);
  assert.equal(page.byId('choose-manual').disabled, false);
  assert.deepEqual(page.calls.map(call => call.path), ['/api/author/start', '/api/author/games']);
});

test('裁判画面は保存済みゲームを表示し、起動URLと削除操作を提供する', async () => {
  const gameId = `saved_${'1'.repeat(32)}`;
  const page = startAuthorDom(autoAuthorBootstrap(), { savedGames: [{ gameId,
    savedAt: '2026-09-19T10:30:00.000Z', title: '青葉ソリューションズ — 社内ポータル',
    summary: '保存した事件の概要', targetSystem: '社内ポータル', difficulty: 2,
    attacks: ['フィッシング', '反射型XSS'] }] });
  await page.ready;
  await page.byId('game-start').dispatch('click');
  await page.byId('choose-court').dispatch('click');
  assert.equal(page.byId('court-empty').hidden, true);
  assert.match(page.byId('saved-game-list').textContent, /青葉ソリューションズ.*このゲームで遊ぶ/s);
  assert.equal(page.byId('saved-game-list').querySelector('a').href, `/?saved=${gameId}`);
  const remove = page.document.querySelector(`[data-game-id="${gameId}"]`);
  await remove.dispatch('click');
  assert.equal(page.byId('court-empty').hidden, false);
  assert.ok(page.calls.some(call => call.path.endsWith(gameId) && call.method === 'DELETE'));
});

test('ゲーム完成画面は保存完了を示し、モード選択へ戻れる', async () => {
  const page = startAuthorDom(autoAuthorBootstrap(), { initialAuthor: {
    currentState: 'READY', saved: true, playUrl: `/?saved=saved_${'2'.repeat(32)}`,
  } });
  await page.ready;
  assert.equal(page.byId('ready-panel').hidden, false);
  assert.match(page.byId('ready-save-status').textContent, /ローカルに保存されました/);
  await page.byId('ready-back').dispatch('click');
  assert.equal(page.byId('activity-panel').hidden, false);
  assert.ok(page.calls.some(call => call.path === '/api/author/menu'));
});

test('モード選択メニューから遊び方・設定・タイトルへ遷移できる', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  await page.byId('game-start').dispatch('click');
  await page.byId('menu-help').dispatch('click');
  assert.equal(page.byId('help-panel').hidden, false);
  await page.byId('help-back').dispatch('click');
  await page.byId('menu-settings').dispatch('click');
  assert.equal(page.byId('settings-panel').hidden, false);
  page.byId('setting-text-size').value = 'LARGE';
  page.byId('setting-motion').value = 'REDUCED';
  await page.byId('settings-apply').dispatch('click');
  assert.equal(page.document.querySelector('body').dataset.textSize, 'LARGE');
  assert.match(page.localStorage.getItem('incident-craft-settings-v1'), /REDUCED/);
  await page.byId('settings-back').dispatch('click');
  await page.byId('menu-title').dispatch('click');
  assert.equal(page.byId('splash-panel').hidden, false);
});

test('ゲーム終了は保存確認後にshutdown APIを呼び、終了画面を表示する', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  await page.byId('game-start').dispatch('click');
  await page.byId('menu-exit').dispatch('click');
  assert.equal(page.byId('exit-dialog').open, true);
  await page.byId('exit-save').dispatch('click');
  const shutdown = page.calls.find(call => call.path === '/api/author/shutdown');
  assert.deepEqual(shutdown.body, { saveData: true });
  assert.equal(page.byId('shutdown-panel').hidden, false);
});

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
  assert.equal(page.document.querySelector('[data-manual-step="0"]').hidden, false);
  assert.equal(page.document.querySelector('[data-manual-step="1"]').hidden, true);
  await page.byId('manual-create').dispatch('click', { force: true });
  assert.equal(page.calls.some(call => call.path === '/api/author/manual'), false);
  await advanceToReview(page);
  assert.equal(page.document.querySelector('[data-manual-step="7"]').hidden, false);
  assert.equal(page.byId('manual-create').hidden, false);
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
  await page.byId('choose-manual').dispatch('click');
  const card = page.document.querySelector('[data-attack-id]');
  card.querySelector('[data-key="evidenceAnswer"]').value = '利用者が編集した証拠の答え';
  await page.byId('incident-date').dispatch('change');
  assert.equal(page.document.querySelector('[data-key="evidenceAnswer"]').value,
    '利用者が編集した証拠の答え');
  await advanceToReview(page);
  page.byId('node-rows').replaceChildren();
  await page.byId('manual-create').dispatch('click');
  assert.match(page.byId('manual-errors').textContent, /nodes.*送信できません/);
  assert.deepEqual(page.calls.map(call => call.path),
    ['/api/author/start', '/api/author/select-mode']);
});

test('詳細設定は順番に進み、Nodeなど複数件は1件ずつ表示して入力を保つ', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  await page.byId('choose-manual').dispatch('click');
  const organization = page.byId('organization-name'); organization.value = '編集後の組織';
  await page.byId('manual-next').dispatch('click');
  assert.equal(page.document.querySelector('[data-manual-step="1"]').hidden, false);
  await page.byId('manual-next').dispatch('click');
  await page.byId('manual-next').dispatch('click');
  await page.byId('manual-next').dispatch('click');
  assert.equal(page.document.querySelector('[data-manual-step="4"]').hidden, false);
  assert.equal(page.byId('node-position').textContent, '1 / 5');
  assert.equal(page.document.querySelectorAll('[data-network-kind="nodes"]').filter(row => !row.hidden).length, 1);
  await page.byId('node-next').dispatch('click');
  assert.equal(page.byId('node-position').textContent, '2 / 5');
  await page.byId('manual-previous').dispatch('click');
  await page.byId('manual-previous').dispatch('click');
  await page.byId('manual-previous').dispatch('click');
  await page.byId('manual-previous').dispatch('click');
  assert.equal(page.byId('organization-name').value, '編集後の組織');
});

test('NetworkのNode IDを変更しても攻撃対象を別Nodeへ黙って切り替えない', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  await page.byId('choose-manual').dispatch('click');
  for (let index = 0; index < 4; index++) await page.byId('manual-next').dispatch('click');
  const row = page.document.querySelectorAll('[data-network-kind="nodes"]')
    .find(item => item.querySelector('[data-key="nodeId"]').value === 'web-host');
  row.querySelector('[data-key="nodeId"]').value = 'renamed-web-host';
  await page.byId('manual-next').dispatch('click');
  const target = page.document.querySelector('[data-attack-id]')
    .querySelector('[data-key="targetNodeId"]');
  assert.equal(target.value, 'web-host');
  assert.match(target.children[0].textContent, /現在の構成にありません/);
});
