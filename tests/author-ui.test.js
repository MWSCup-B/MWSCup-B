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
test('タイトルからゲーム生成へ進み、タイトルへ戻っても選択を保持する', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  assert.equal(page.byId('start-panel').hidden, false);
  assert.equal(page.byId('selection-panel').hidden, true);
  await page.byId('start-generation').dispatch('click');
  assert.equal(page.byId('selection-panel').hidden, false);
  await choose(page, ['clickfix', 'ransomware']); page.byId('setting').value = 'school';
  await page.byId('back-to-title').dispatch('click');
  assert.equal(page.byId('start-panel').hidden, false);
  await page.byId('start-generation').dispatch('click');
  assert.equal(page.byId('attack-2').value, 'ransomware');
  assert.equal(page.byId('setting').value, 'school');
  assert.equal(page.calls.length, 1, 'タイトル移動だけで生成しない');
});

test('進捗は工程に従って1%ずつ進み、記事切替や修正で重複加算しない', async () => {
  const progress = ['configuration', 'codex', 'scenario', 'validation', 'verification'].map(id => ({ id, label: id, status: 'COMPLETE' }));
  const page = startAuthorDom(autoAuthorBootstrap(), { initialAuthor: {
    currentState: 'EVIDENCE_BUILDING', canCancel: true,
    progress: [...progress, { id: 'revision', label: '修正', status: 'COMPLETE' }, { id: 'evidence', label: '証拠', status: 'RUNNING' }],
  } });
  await page.ready;
  assert.equal(page.byId('generation-percent-label').textContent, '0%');
  await page.advance(2000);
  assert.equal(page.byId('generation-panel').hidden, false);
  assert.equal(page.byId('generation-percent-label').textContent, '50%');
  assert.equal(page.byId('incident-1').hidden, false);
  await page.byId('incident-next').dispatch('click');
  assert.equal(page.byId('incident-1').hidden, true);
  assert.equal(page.byId('incident-2').hidden, false);
  assert.equal(page.byId('generation-percent-label').textContent, '50%');
  await page.byId('incident-next').dispatch('click');
  assert.equal(page.byId('incident-next').disabled, true);
  await page.byId('incident-prev').dispatch('click');
  assert.equal(page.byId('incident-2').hidden, false);
  const unfinished = startAuthorDom(autoAuthorBootstrap(), { initialAuthor: {
    currentState: 'EVALUATING', canCancel: true,
    progress: [...progress, ...['evidence', 'investigation', 'dialogue', 'game', 'evaluation'].map(id => ({ id, label: id, status: 'COMPLETE' }))],
  } });
  await unfinished.ready;
  await unfinished.advance(4000);
  assert.equal(unfinished.byId('generation-percent-label').textContent, '99%');
  const ready = startAuthorDom(autoAuthorBootstrap(), { initialAuthor: { currentState: 'READY', progress } });
  await ready.ready; await ready.advance(4000);
  assert.equal(ready.byId('generation-percent-label').textContent, '100%');
});

test('Evidence timeoutのDeveloper Detailは制限時間・経過時間・入出力bytesを安全に表示する', async () => {
  const page = startAuthorDom(autoAuthorBootstrap(), { initialAuthor: {
    currentState: 'FAILED', failure: { code: 'CODEX_TIMEOUT', message: '生成が時間内に完了しませんでした。' },
    developerDetails: [{ code: 'CODEX_TIMEOUT', phase: 'GENERATING_EVIDENCE', attempt: 1,
      retryable: false, timeoutMs: 600000, elapsedMs: 600012, promptBytes: 150000,
      stdoutBytes: 0, stderrBytes: 400, terminationSignal: 'SIGTERM',
      reason: 'アプリ側の制限時間を超えました。',
      correctionHint: 'CODEX_EVIDENCE_TIMEOUT_MSを確認してください。',
      stderr: 'must-not-display-cli-text', prompt: 'must-not-display-prompt' }],
  } });
  await page.ready;
  assert.equal(page.byId('failure-panel').hidden, false);
  const detail = page.byId('failure-details').textContent;
  for (const value of ['Timeout (ms): 600000', 'Elapsed (ms): 600012', 'Prompt (bytes): 150000',
    'stdout (bytes): 0', 'stderr (bytes): 400', 'Termination signal: SIGTERM', 'CODEX_EVIDENCE_TIMEOUT_MS']) {
    assert.ok(detail.includes(value), value);
  }
  assert.doesNotMatch(detail, /must-not-display/);
});


test('入力は8種の攻撃と舞台だけで、自動設定項目を送信しない', async () => {
  const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
  assert.equal(page.byId('initialization-status').hidden, true);
  assert.equal(page.document.querySelectorAll('input').length, 0);
  assert.equal(page.document.querySelectorAll('select').length, 4);
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

test('新規生成は0から100まで順に表示し、実行中は工程上限と99%を越えない', async () => {
  const bootstrap = autoAuthorBootstrap();
  const preview = buildScenarioPreview(bootstrap.defaultManualConfiguration);
  preview.verification = { status: 'VERIFIED', checks: [] };
  const first = ['configuration', 'codex', 'scenario', 'validation'].map(id => ({ id, label: id, status: 'COMPLETE' }));
  const reviewed = [...first, { id: 'verification', label: '検証', status: 'COMPLETE' }];
  const page = startAuthorDom(bootstrap, { responses: {
    '/api/author/selection': () => ({ currentState: 'SCENARIO_REVIEWING', canCancel: true,
      generationId: 'first', progress: [...first, { id: 'verification', status: 'RUNNING', attempt: 1 }] }),
    '/api/author/approve': () => ({ currentState: 'EVIDENCE_BUILDING', canApprove: false, canCancel: true,
      progress: [...reviewed, { id: 'evidence', status: 'RUNNING', attempt: 1 }] }),
  } });
  await page.ready; await page.byId('create-scenario').dispatch('click');
  assert.equal(page.byId('generation-percent-label').textContent, '0%');
  await page.advance(90000);
  const reviewing = Number.parseInt(page.byId('generation-percent-label').textContent, 10);
  assert.ok(reviewing > 35 && reviewing < 50);
  page.setAuthor({ currentState: 'SCENARIO_PREVIEW', canCancel: false, canApprove: true,
    progress: reviewed, scenarioPreview: preview, configuration: bootstrap.defaultManualConfiguration });
  await page.advance(3000);
  assert.equal(page.byId('generation-percent-label').textContent, '50%');
  assert.equal(page.byId('preview-panel').hidden, false);
  await page.advance(60000);
  assert.equal(page.byId('generation-percent-label').textContent, '50%', '承認待ちでは増やさない');
  await page.byId('preview-approve').dispatch('click');
  await page.advance(90000);
  const evidence = Number.parseInt(page.byId('generation-percent-label').textContent, 10);
  assert.ok(evidence > 50 && evidence < 80);
  page.setAuthor({ currentState: 'READY', canCancel: false,
    playUrl: `/?game=${'a'.repeat(48)}`, progress: [...reviewed,
      ...['evidence', 'investigation', 'dialogue', 'game', 'evaluation'].map(id => ({ id, label: id, status: 'COMPLETE' }))] });
  await page.advance(5000);
  assert.equal(page.byId('ready-panel').hidden, false);
  assert.deepEqual(page.percentHistory, Array.from({ length: 101 }, (_, index) => index));
});

test('進捗の推定は失敗と中止で停止し、新規生成で0へ戻る', async () => {
  for (const state of ['FAILED', 'CANCELLED']) {
    const page = startAuthorDom(autoAuthorBootstrap(), { initialAuthor: {
      currentState: 'EVIDENCE_BUILDING', canCancel: true,
      progress: [{ id: 'evidence', status: 'RUNNING', attempt: 1 }],
    }, responses: { '/api/author/selection': () => ({ currentState: 'SCENARIO_REVIEWING', canCancel: true, progress: [] }) } });
    await page.ready; await page.advance(60000);
    page.setAuthor({ currentState: state, canCancel: false }); await page.advance(500);
    const stopped = page.byId('generation-percent-label').textContent;
    await page.advance(60000);
    assert.equal(page.byId('generation-percent-label').textContent, stopped);
    await page.byId('retry').dispatch('click'); await page.byId('create-scenario').dispatch('click');
    assert.equal(page.byId('generation-percent-label').textContent, '0%');
  }
});

test('生成画面へ入るたび別の事例を表示し、再読み込み後も直前の事例を避ける', async () => {
  const storage = new Map();
  const initialAuthor = { currentState: 'SCENARIO_REVIEWING', canCancel: true, progress: [] };
  const page = startAuthorDom(autoAuthorBootstrap(), { storage, initialAuthor,
    responses: { '/api/author/cancel': () => ({ currentState: 'CANCELLED', canCancel: false }),
      '/api/author/selection': () => initialAuthor } });
  await page.ready;
  assert.equal(page.byId('incident-1').hidden, false);
  await page.advance(1000);
  assert.equal(page.byId('incident-1').hidden, false, '進捗の取得だけでは記事を切り替えない');
  await page.byId('cancel').dispatch('click'); await page.byId('retry').dispatch('click');
  await page.byId('create-scenario').dispatch('click');
  assert.equal(page.byId('incident-2').hidden, false);
  const reload = startAuthorDom(autoAuthorBootstrap(), { storage, initialAuthor }); await reload.ready;
  assert.equal(reload.byId('incident-3').hidden, false);
  const cycle = startAuthorDom(autoAuthorBootstrap(), { storage, initialAuthor }); await cycle.ready;
  assert.equal(cycle.byId('incident-1').hidden, false);
});
