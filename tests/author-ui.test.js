// 2026-09-24: mainの外枠とkawata-workの選択フローを合わせて検証。旧テストはdocs/historyにコメント保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAuthorBootstrap } from '../server/auto-generation-service.js';
import { buildScenarioPreview } from '../server/generation/scenario-configuration.js';
import { startAuthorDom } from './helpers/author-dom.js';

async function choose(page, ids) {
  page.byId('attack-1').value = ''; await page.byId('attack-1').dispatch('change');
  for (const [index, id] of ids.entries()) {
    const control = page.byId(`attack-${index + 1}`);
    assert.ok(control.children.some(option => option.value === id), `${ids}: ${id}が候補にある`);
    control.value = id; await control.dispatch('change');
  }
}
const options = (page, index) => page.byId(`attack-${index}`).children.map(option => option.value).filter(Boolean);

test('mainのタイトル・モード選択から攻撃と舞台へ進み、戻っても選択を保持する', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  assert.equal(page.byId('splash-panel').hidden, false);
  assert.equal(page.byId('splash-panel').querySelectorAll('button').length, 1);
  assert.equal(page.byId('selection-panel').hidden, true);
  await page.byId('game-start').dispatch('click');
  assert.equal(page.byId('activity-panel').hidden, false);
  await page.byId('choose-creation').dispatch('click');
  assert.equal(page.byId('selection-panel').hidden, false);
  assert.equal(page.byId('choose-manual'), null);
  assert.equal(page.byId('choose-makotomaru'), null);
  await choose(page, ['clickfix', 'ransomware']); page.byId('setting').value = 'school';
  await page.byId('selection-back').dispatch('click');
  assert.equal(page.byId('activity-panel').hidden, false);
  await page.byId('choose-creation').dispatch('click');
  assert.equal(page.byId('attack-2').value, 'ransomware');
  assert.equal(page.byId('setting').value, 'school');
  await page.byId('selection-back').dispatch('click');
  await page.byId('choose-court').dispatch('click');
  assert.equal(page.byId('court-empty').hidden, false);
  await page.byId('court-create-game').dispatch('click');
  assert.equal(page.byId('selection-panel').hidden, false);
  assert.ok(!page.calls.some(call => call.path === '/api/author/selection'));
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

test('入力は8種の攻撃と舞台だけで、自動設定項目を送信しない', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  assert.equal(page.byId('initialization-status').hidden, true);
  assert.equal(page.document.querySelectorAll('input').length, 0);
  assert.equal(page.byId('selection-panel').querySelectorAll('select').length, 4);
  assert.equal(options(page, 1).length, 8);
  assert.equal(page.byId('setting').children.length, 5);
  assert.equal(page.byId('create-scenario').disabled, false);
  await page.byId('create-scenario').dispatch('click');
  const submitted = page.calls.find(call => call.path === '/api/author/selection').body;
  assert.deepEqual(submitted, { request: { schemaVersion: '1.0', attackIds: ['phishing'], settingId: 'company' } });
  assert.ok(!page.calls.some(call => /manual|makotomaru|approve/.test(call.path)));
});

for (const id of ['clickfix', 'sql_injection', 'password_spray', 'ransomware', 'unrestricted_file_upload']) {
  test(`新しい攻撃 ${id} と学校を選んで送信できる`, async () => {
    const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
    await choose(page, [id]); page.byId('setting').value = 'school';
    await page.byId('create-scenario').dispatch('click');
    assert.deepEqual(page.calls.at(-1).body.request,
      { schemaVersion: '1.0', attackIds: [id], settingId: 'school' });
  });
}
test('1→2→3の候補を直前に合わせて絞り、選択順で送信する', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  assert.deepEqual(options(page, 2), ['stored_xss', 'unauthorized_login', 'clickfix']);
  assert.equal(page.byId('attack-step-3').hidden, true);
  await choose(page, ['phishing', 'clickfix']);
  assert.deepEqual(options(page, 3), ['ransomware']);
  assert.equal(page.byId('attack-step-3').hidden, false);
  await choose(page, ['phishing', 'clickfix', 'ransomware']);
  assert.equal(page.byId('attack-4'), null);
  assert.match(page.byId('attack-chain-status').textContent, /最大3件/);
  await page.byId('create-scenario').dispatch('click');
  assert.deepEqual(page.calls.at(-1).body.request.attackIds, ['phishing', 'clickfix', 'ransomware']);
  await choose(page, ['password_spray', 'unauthorized_login']);
  assert.deepEqual(options(page, 3), ['stored_xss']);
  page.byId('attack-3').value = 'stored_xss'; await page.byId('attack-3').dispatch('change');
  await page.byId('create-scenario').dispatch('click');
  assert.deepEqual(page.calls.at(-1).body.request.attackIds, ['password_spray', 'unauthorized_login', 'stored_xss']);
});
test('前段を変えた場合だけ後続を解除し、2件目からの分岐・逆順を候補に出さない', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  await choose(page, ['phishing', 'clickfix', 'ransomware']);
  await page.byId('attack-1').dispatch('change');
  assert.equal(page.byId('attack-3').value, 'ransomware', '同じ値の再選択なら保持');
  page.byId('attack-2').value = 'unauthorized_login'; await page.byId('attack-2').dispatch('change');
  assert.equal(page.byId('attack-3').value, '');
  assert.deepEqual(options(page, 3), ['stored_xss']);
  assert.match(page.byId('attack-chain-status').textContent, /解除/);
  page.byId('attack-1').value = 'clickfix'; await page.byId('attack-1').dispatch('change');
  assert.equal(page.byId('attack-2').value, '');
  assert.deepEqual(options(page, 2), ['ransomware']);
  assert.equal(page.byId('attack-step-3').hidden, true);
  await choose(page, ['phishing', 'stored_xss']);
  assert.deepEqual(options(page, 3), [], '1件目からは関連しても2件目から続かないClickFixは出さない');
});
test('後続候補のない攻撃も1件で生成でき、2件で止める選択もできる', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  for (const id of ['sql_injection', 'ransomware', 'unrestricted_file_upload', 'stored_xss']) {
    await choose(page, [id]);
    assert.equal(page.byId('attack-step-2').hidden, true);
    assert.equal(page.byId('attack-step-3').hidden, true);
    assert.match(page.byId('attack-chain-status').textContent, /候補がありません.*1件で作成/);
    assert.equal(page.byId('create-scenario').disabled, false);
  }
  await choose(page, ['phishing', 'clickfix', 'ransomware']);
  page.byId('attack-3').value = ''; await page.byId('attack-3').dispatch('change');
  await page.byId('create-scenario').dispatch('click');
  assert.deepEqual(page.calls.at(-1).body.request.attackIds, ['phishing', 'clickfix']);
});
test('候補外の項目を画面へ注入しても選択・送信に採用しない', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  await choose(page, ['phishing', 'clickfix']);
  const injected = page.document.createElement('option'); injected.value = 'sql_injection';
  page.byId('attack-3').append(injected); page.byId('attack-3').value = 'sql_injection';
  await page.byId('attack-3').dispatch('change');
  assert.match(page.byId('operation-error').textContent, /直前/);
  assert.equal(page.byId('attack-3').value, '');
  await page.byId('create-scenario').dispatch('click');
  assert.deepEqual(page.calls.at(-1).body.request.attackIds, ['phishing', 'clickfix']);
});
test('0件では生成できず、強制クリックでも送信しない', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  await choose(page, []);
  assert.equal(page.byId('create-scenario').disabled, true);
  await page.byId('create-scenario').dispatch('click', { force: true });
  assert.equal(page.calls.length, 1);
});

test('初期応答を待つ間や失敗時は生成APIに送信しない', async () => {
  let resolveBootstrap;
  const page = startAuthorDom(new Promise(resolve => { resolveBootstrap = resolve; }));
  assert.equal(page.byId('create-scenario').disabled, true);
  await page.byId('create-scenario').dispatch('click', { force: true });
  assert.deepEqual(page.calls.map(call => call.path), ['/api/author/start']);
  resolveBootstrap(autoAuthorBootstrap()); await page.ready;
  assert.equal(page.byId('create-scenario').disabled, false);
});

for (const [label, mutate] of [
  ['選択肢欠落', value => { delete value.attackChoices; }],
  ['舞台欠落', value => { value.settings = []; }],
  ['不正な初期攻撃', value => { value.selectionDefaults.attackIds = ['unknown']; }],
  ['重複選択肢', value => { value.attackChoices.push(value.attackChoices[0]); }],
  ['不正な最大数', value => { value.maxSelectedAttacks = 4; }],
  ['関連候補なしの旧サーバー応答', value => { delete value.attackSelectionPaths; }],
  ['関連候補に未知ID', value => { value.attackSelectionPaths.push(['phishing', 'unknown']); }],
  ['関連候補の前段欠落', value => { value.attackSelectionPaths = value.attackSelectionPaths.filter(path =>
    path.join('>') !== 'phishing>clickfix'); }],
  ['関連候補の重複', value => { value.attackSelectionPaths.push(value.attackSelectionPaths[0]); }],
]) test(`${label}は見える位置へエラーを表示する`, async () => {
  const bootstrap = autoAuthorBootstrap(); mutate(bootstrap);
  const page = startAuthorDom(bootstrap); await page.ready;
  assert.equal(page.byId('initialization-status').hidden, false);
  assert.match(page.byId('initialization-status').textContent, /初期設定.*再起動/);
  await page.byId('create-scenario').dispatch('click', { force: true });
  assert.equal(page.calls.length, 1);
});

test('部品欠落とAPIエラーを空の正常画面として扱わない', async () => {
  for (const options of [{ missingElementId: 'setting' }, { startError: new Error('接続エラー') }]) {
    const page = startAuthorDom(autoAuthorBootstrap(), options); await page.ready;
    assert.equal(page.byId('initialization-status').hidden, false);
    assert.equal(page.byId('create-scenario').disabled, true);
  }
});

test('開始応答を待つ間の二重送信を防ぎ、処理中はキャンセルだけを許可する', async () => {
  let resolveResponse;
  const page = startAuthorDom(autoAuthorBootstrap(), { responses: {
    '/api/author/selection': () => new Promise(resolve => { resolveResponse = resolve; }),
  } }); await page.ready;
  const pending = page.byId('create-scenario').dispatch('click');
  await page.byId('create-scenario').dispatch('click', { force: true });
  assert.equal(page.calls.filter(call => call.path === '/api/author/selection').length, 1);
  resolveResponse({ currentState: 'SCENARIO_REVIEWING', canCancel: true }); await pending;
  assert.equal(page.byId('generation-panel').hidden, false);
  assert.equal(page.byId('setting').disabled, true);
  assert.equal(page.byId('cancel').disabled, false);
});

test('プレビュー承認を自動送信せず、選び直し後も攻撃と舞台を保持する', async () => {
  const bootstrap = autoAuthorBootstrap();
  const preview = buildScenarioPreview(bootstrap.defaultManualConfiguration);
  preview.verification = { status: 'VERIFIED', checks: [] };
  const page = startAuthorDom(bootstrap, { responses: {
    '/api/author/selection': () => ({ currentState: 'SCENARIO_PREVIEW', canApprove: true,
      scenarioPreview: preview, configuration: bootstrap.defaultManualConfiguration }),
    '/api/author/reject': () => ({ currentState: 'MANUAL_CONFIGURATION', canApprove: false }),
  } }); await page.ready;
  await choose(page, ['clickfix']); page.byId('setting').value = 'government';
  await page.byId('create-scenario').dispatch('click');
  assert.equal(page.byId('preview-panel').hidden, false);
  assert.ok(!page.calls.some(call => call.path.endsWith('/approve')));
  assert.ok(page.byId('preview-network-diagram').children.length > 0);
  await page.byId('preview-reject').dispatch('click');
  assert.equal(page.byId('selection-panel').hidden, false);
  assert.equal(page.byId('setting').value, 'government');
  assert.equal(page.byId('attack-1').value, 'clickfix');
});

test('送信エラーは画面上で伝え、入力を保持して操作を回復する', async () => {
  const page = startAuthorDom(autoAuthorBootstrap(), { responses: {
    '/api/author/selection': () => { throw new Error('通信に失敗しました'); },
  } }); await page.ready;
  await page.byId('create-scenario').dispatch('click');
  assert.match(page.byId('operation-error').textContent, /通信に失敗/);
  assert.equal(page.byId('create-scenario').disabled, false);
  assert.equal(page.byId('setting').value, 'company');
});
