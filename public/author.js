// 2026-09-24 修正後: mainのタイトル・モード・保存・設定UIとkawata-workの攻撃連鎖入力を接続。
// 修正前の全文: docs/history/author-creation-before-2026-09-24.js
import { caseStudyView } from './generated-view.js';
import { gameAudio } from './game-audio.js';
import { renderNetworkDiagram } from './network-diagram.js';
gameAudio.mount(document);
let lastAudioState = null;
let token = null, bootstrap = null, author = null, polling = null;
let initialized = false, submitting = false, pollingRequest = false;
let requestVersion = 0;
let selectedAttacks = [], entryView = globalThis.location?.hash === '#court' ? 'COURT'
  : globalThis.location?.hash === '#mode' ? 'ACTIVITY' : 'SPLASH';
let savedGameItems = null, savedGamesError = '';
const byId = id => document.getElementById(id);
const panels = ['splash-panel', 'activity-panel', 'court-entry-panel', 'help-panel', 'settings-panel',
  'selection-panel', 'preview-panel', 'generation-panel', 'ready-panel', 'failure-panel', 'shutdown-panel'];
const settingsKey = 'incident-craft-settings-v1';
const defaultSettings = { textSize: 'STANDARD', motion: 'STANDARD' };
const initializationHelp = 'サーバーを再起動（npm start）して画面を再読み込みしてください。';
function showError(message) { byId('operation-error').textContent = message; }
function setInitializationState(ready, message = '') {
  initialized = ready;
  byId('initialization-status').textContent = message;
  byId('initialization-status').hidden = ready;
  syncControls();
}
function requireInitialized() { if (!initialized) throw new Error('初期設定の読み込みが完了していません。'); }
function readSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey) ?? 'null');
    return { textSize: ['STANDARD', 'LARGE'].includes(value?.textSize)
      ? value.textSize : defaultSettings.textSize,
    motion: ['STANDARD', 'REDUCED'].includes(value?.motion)
      ? value.motion : defaultSettings.motion };
  } catch { return { ...defaultSettings }; }
}

function applySettings(settings, save = false) {
  const body = document.querySelector('body');
  body.dataset.textSize = settings.textSize;
  body.dataset.motion = settings.motion;
  if (save) {
    try { localStorage.setItem(settingsKey, JSON.stringify(settings)); }
    catch { byId('settings-status').textContent = 'ブラウザに設定を保存できませんでした。'; return; }
    byId('settings-status').textContent = '設定をこのブラウザに保存しました。';
  }
}

async function api(path, body = null, method = null) {
  const response = await fetch(path, { method: method ?? (body == null ? 'GET' : 'POST'),
    headers: { ...(body == null ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body == null ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? '処理に失敗しました。');
  return value;
}

function text(parent, tag, value, className = '') {
  const node = document.createElement(tag); if (className) node.className = className;
  node.textContent = value; parent.append(node); return node;
}

function selectedIds() {
  return [...selectedAttacks];
}
function matchesPrefix(path, prefix) {
  return prefix.every((id, index) => path[index] === id);
}
function nextChoices(prefix) {
  const ids = new Set(bootstrap.attackSelectionPaths
    .filter(path => path.length === prefix.length + 1 && matchesPrefix(path, prefix))
    .map(path => path[prefix.length]));
  return bootstrap.attackChoices.filter(choice => ids.has(choice.id));
}
function validSelectedPath() {
  return Boolean(bootstrap?.attackSelectionPaths.some(path => path.length === selectedAttacks.length
    && matchesPrefix(path, selectedAttacks)));
}
function syncControls() {
  const busy = submitting || Boolean(author?.canCancel);
  byId('choose-creation').disabled = !initialized || busy;
  byId('court-create-game').disabled = !initialized || busy;
  byId('selection-back').disabled = busy;
  for (let index = 0; index < 3; index += 1) {
    byId(`attack-${index + 1}`).disabled = !initialized || busy || byId(`attack-step-${index + 1}`).hidden;
  }
  byId('setting').disabled = !initialized || busy;
  byId('generation-model').disabled = !initialized || busy;
  byId('generation-effort').disabled = !initialized || busy;
  byId('create-scenario').disabled = !initialized || busy || !validSelectedPath()
    || !bootstrap.settings.some(item => item.id === byId('setting').value);
  byId('preview-approve').disabled = submitting || !author?.canApprove;
  byId('preview-reject').disabled = submitting || !author?.canApprove;
  byId('cancel').disabled = submitting || !author?.canCancel;
  byId('retry').disabled = busy;
  byId('selection-count').textContent = `${selectedIds().length} / 3 種類を選択中`;
}
function validateBootstrap(value) {
  const choices = value?.attackChoices; const settings = value?.settings;
  const defaults = value?.selectionDefaults;
  if (value?.maxSelectedAttacks !== 3 || !Array.isArray(choices) || !choices.length
    || !Array.isArray(settings) || !settings.length
    || [...choices, ...settings].some(item => !item || typeof item.id !== 'string'
      || !/^[a-z][a-z0-9_]*$/.test(item.id) || typeof item.label !== 'string' || !item.label)
    || new Set(choices.map(item => item.id)).size !== choices.length
    || new Set(settings.map(item => item.id)).size !== settings.length
    || defaults?.schemaVersion !== '1.0' || !Array.isArray(defaults.attackIds)
    || !defaults.attackIds.length || defaults.attackIds.length > 3
    || new Set(defaults.attackIds).size !== defaults.attackIds.length
    || defaults.attackIds.some(id => !choices.some(item => item.id === id))
    || !settings.some(item => item.id === defaults.settingId)) {
    throw new Error('攻撃と舞台の初期設定が不足しているか、形式が不正です。');
  }
  const paths = value.attackSelectionPaths;
  if (!Array.isArray(paths) || !paths.length || paths.length > 400
    || paths.some(path => !Array.isArray(path) || !path.length || path.length > 3
      || new Set(path).size !== path.length || path.some(id => !choices.some(choice => choice.id === id)))
    || new Set(paths.map(path => JSON.stringify(path))).size !== paths.length
    || choices.some(choice => !paths.some(path => path.length === 1 && path[0] === choice.id))
    || paths.some(path => path.some((_, index) => !paths.some(prefix => prefix.length === index + 1
      && matchesPrefix(path, prefix))))
    || !paths.some(path => path.length === defaults.attackIds.length && matchesPrefix(path, defaults.attackIds))) {
    throw new Error('関連する攻撃の選択順データが不足しているか、形式が不正です。');
  }
}
function renderAttackSteps() {
  for (let index = 0; index < 3; index += 1) {
    const control = byId(`attack-${index + 1}`);
    const choices = index <= selectedAttacks.length ? nextChoices(selectedAttacks.slice(0, index)) : [];
    byId(`attack-step-${index + 1}`).hidden = index > 0 && !choices.length;
    control.replaceChildren();
    const empty = document.createElement('option'); empty.value = '';
    empty.textContent = index === 0 ? '1件目を選択してください' : `追加しない（${index}件で作成）`;
    empty.selected = !selectedAttacks[index]; control.append(empty);
    for (const choice of choices) {
      const option = document.createElement('option'); option.value = choice.id;
      option.textContent = choice.label; option.selected = choice.id === selectedAttacks[index];
      control.append(option);
    }
  }
  const count = selectedAttacks.length;
  const labels = selectedAttacks.map(id => bootstrap.attackChoices.find(choice => choice.id === id).label);
  byId('selection-count').textContent = `${count} / 3 種類を選択中`;
  byId('attack-chain-status').textContent = !count ? 'まず1件目を選択してください。'
    : `${labels.join(' → ')}。` + (count === 3 ? '最大3件まで選択しました。'
      : nextChoices(selectedAttacks).length ? `この${count}件で作成するか、続くインシデントを追加できます。`
        : `現在の教材には、この後に続く候補がありません。この${count}件で作成できます。`);
}
function changeAttack(index) {
  if (!initialized || submitting || author?.canCancel) return;
  const value = byId(`attack-${index + 1}`).value;
  if (index > selectedAttacks.length || (value && !nextChoices(selectedAttacks.slice(0, index))
    .some(choice => choice.id === value))) {
    showError('直前のインシデントからつながる候補を選択してください。');
    renderAttackSteps(); syncControls(); return;
  }
  if (value === (selectedAttacks[index] ?? '')) return;
  const cleared = selectedAttacks.length > index + 1;
  selectedAttacks = [...selectedAttacks.slice(0, index), ...(value ? [value] : [])];
  showError(''); renderAttackSteps(); syncControls();
  if (cleared) byId('attack-chain-status').textContent += ' 前の選択を変えたため、それ以降の選択を解除しました。';
}
function renderChoices() {
  selectedAttacks = [...bootstrap.selectionDefaults.attackIds];
  renderAttackSteps();
  const setting = byId('setting'); setting.replaceChildren();
  for (const item of bootstrap.settings) {
    const option = document.createElement('option'); option.value = item.id;
    option.textContent = item.label; option.selected = item.id === bootstrap.selectionDefaults.settingId;
    setting.append(option);
  }
  const generation = bootstrap.generationOptions ?? { models: [''], reasoningEfforts: [''], defaults: { model: '', reasoningEffort: '' } };
  const selected = author?.generationSettings ?? generation.defaults;
  for (const [id, values, current] of [['generation-model', generation.models, selected.model],
    ['generation-effort', generation.reasoningEfforts, selected.reasoningEffort]]) {
    const control = byId(id); control.replaceChildren();
    for (const value of values) {
      const option = document.createElement('option'); option.value = value;
      option.textContent = value || '既定（Codex）'; option.selected = value === current; control.append(option);
    }
  }
}
function drawNetwork(id, network) { renderNetworkDiagram(byId(id), network, document); }

function renderProgress(targetId) {
  const target = byId(targetId); target.replaceChildren(); for (const item of author.progress) {
    const suffix = item.status === 'COMPLETE' ? '✓' : item.status === 'RUNNING' ? '実行中…'
      : item.status === 'FAILED' ? '失敗' : item.status === 'SKIPPED' ? '不要' : '待機中';
    text(target, 'li', `${item.label}　${suffix}${item.attempt ? ` ${item.attempt} / ${author.maxAttempts}` : ''}`, item.status.toLowerCase()); }
}

function renderDetails(targetId) {
  const target = byId(targetId); target.replaceChildren(); if (!author.developerDetails.length) text(target, 'p', '詳細情報はありません。');
  for (const item of author.developerDetails) { const article = document.createElement('article'); article.className = 'card';
    text(article, 'strong', `${item.phase} / attempt ${item.attempt ?? '-'}`);
    text(article, 'p', `${item.errorCode ?? item.code}${item.field ? ` — ${item.field}` : ''}`);
    if (item.schemaName) text(article, 'p', `Schema: ${item.schemaName}`);
    if (item.exitCode !== null && item.exitCode !== undefined) text(article, 'p', `Exit code: ${item.exitCode}`);
    if (item.httpStatus !== null && item.httpStatus !== undefined) text(article, 'p', `HTTP status: ${item.httpStatus}`);
    if (item.retryable !== undefined) text(article, 'p', `Retryable: ${item.retryable}`);
    if (item.receivedType) text(article, 'p', `Received type: ${item.receivedType}`);
    if (item.length !== null && item.length !== undefined) text(article, 'p', `Length: ${item.length}`);
    if (item.expectedMinLength !== null && item.expectedMinLength !== undefined) text(article, 'p', `Expected minLength: ${item.expectedMinLength}`);
    if (item.expectedMaxLength !== null && item.expectedMaxLength !== undefined) text(article, 'p', `Expected maxLength: ${item.expectedMaxLength}`);
    if (item.expectedPattern) text(article, 'p', `Expected pattern: ${item.expectedPattern}`);
    if (item.expectedFormat) text(article, 'p', `Expected format: ${item.expectedFormat}`);
    if (item.reason) text(article, 'p', item.reason);
    if (item.correctionHint) text(article, 'p', item.correctionHint);
    target.append(article); }
}

function savedDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  return match ? `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}` : '保存日時不明';
}

function renderSavedGames() {
  const list = byId('saved-game-list');
  const empty = byId('court-empty');
  const status = byId('saved-games-status');
  list.replaceChildren();
  if (savedGameItems === null) {
    empty.hidden = true; status.textContent = savedGamesError || '保存したゲームを読み込んでいます…';
    return;
  }
  if (!savedGameItems.length) {
    empty.hidden = false;
    status.textContent = savedGamesError || '保存したゲームはありません。';
    return;
  }
  empty.hidden = true;
  status.textContent = `${savedGameItems.length}件のゲームが保存されています。`;
  for (const game of savedGameItems) {
    const card = document.createElement('article'); card.className = 'saved-game-card';
    const heading = document.createElement('div'); heading.className = 'saved-game-card-heading';
    const headingCopy = document.createElement('div');
    text(headingCopy, 'p', `SAVED CASE · ${savedDate(game.savedAt)}`, 'mode-label');
    text(headingCopy, 'h2', game.title);
    const difficulty = text(heading, 'span', `${'★'.repeat(game.difficulty)}`, 'saved-game-difficulty');
    difficulty.setAttribute('aria-label', `難易度 ${game.difficulty}`);
    heading.insertBefore(headingCopy, difficulty);
    card.append(heading);
    text(card, 'p', game.summary, 'saved-game-summary');
    text(card, 'p', game.cleared ? `クリア済み · ${savedDate(game.clearedAt)}` : '未クリア · 解説はクリア後に公開', 'saved-game-clear');
    const facts = document.createElement('p'); facts.className = 'saved-game-facts';
    facts.textContent = `対象：${game.targetSystem}　攻撃：${game.attacks.join('、')}`; card.append(facts);
    const actions = document.createElement('div'); actions.className = 'saved-game-actions';
    const play = document.createElement('a'); play.className = 'button-link';
    play.href = `/?saved=${encodeURIComponent(game.gameId)}`; play.textContent = 'このゲームで遊ぶ';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger-link';
    remove.textContent = '削除'; remove.dataset.gameId = game.gameId;
    remove.addEventListener('click', async () => {
      if (!confirm(`「${game.title}」を削除しますか？`)) return;
      remove.disabled = true; status.textContent = 'ゲームを削除しています…';
      try {
        await api(`/api/author/games/${encodeURIComponent(game.gameId)}`, null, 'DELETE');
        savedGameItems = savedGameItems.filter(item => item.gameId !== game.gameId);
        savedGamesError = ''; renderSavedGames();
      } catch (error) { remove.disabled = false; status.textContent = error.message; }
    });
    actions.append(play);
    if (game.cleared) {
      const studyButton = document.createElement('button'); studyButton.type = 'button'; studyButton.textContent = '解説資料';
      studyButton.setAttribute('aria-haspopup', 'dialog');
      studyButton.addEventListener('click', async () => {
        studyButton.disabled = true;
        try {
          const { study } = await api(`/api/author/games/${encodeURIComponent(game.gameId)}/study`);
          const dialog = byId('study-dialog');
          byId('study-dialog-title').textContent = `${game.title} — 解説資料`;
          byId('study-dialog-content').replaceChildren(caseStudyView(study));
          dialog.addEventListener('close', () => { studyButton.focus(); gameAudio.setScene('title'); }, { once: true });
          dialog.showModal();
          gameAudio.setScene('explanation');
          byId('study-dialog-close').focus();
        } catch (error) { status.textContent = error.message; }
        finally { studyButton.disabled = false; }
      });
      actions.append(studyButton);
    }
    actions.append(remove); card.append(actions); list.append(card);
  }
}

async function loadSavedGames() {
  savedGameItems = null; savedGamesError = ''; renderSavedGames();
  try { savedGameItems = (await api('/api/author/games')).games ?? []; }
  catch (error) { savedGameItems = []; savedGamesError = error.message; }
  renderSavedGames();
}

function renderPreview() {
  const preview = author.scenarioPreview; if (!preview) return; byId('preview-summary').textContent = preview.incidentSummary;
  byId('preview-target').textContent = preview.targetSystem; byId('preview-difficulty').textContent = preview.difficultyLabel;
  byId('preview-verification').textContent = preview.verification?.status === 'VERIFIED'
    ? 'Backend検証・独立AIレビュー済み' : '未検証';
  const attacks = byId('preview-attacks'); attacks.replaceChildren(); for (const attack of preview.attacks) {
    const card = document.createElement('article'); card.className = 'builder-card'; text(card, 'h3', `Attack ${attack.order}: ${attack.label}`);
    text(card, 'p', `発生: ${attack.occurrenceTime}`); text(card, 'p', `${attack.source} → ${attack.target} / ${attack.targetService}`);
    text(card, 'p', `調査: ${attack.investigations.map(item => item.label).join('、')}`); attacks.append(card); }
  drawNetwork('preview-network-diagram', preview.network); const detail = byId('preview-author-details'); detail.replaceChildren();
  text(detail, 'p', `Configuration ID: ${preview.configurationId}`); text(detail, 'p', `Mode: ${preview.mode}`);
  for (const check of preview.verification?.checks ?? []) {
    text(detail, 'p', `${check.category}: ${check.outcome} — ${check.reason}`);
  }
  for (const attack of author.configuration?.attacks ?? []) {
    text(detail, 'p', `Attack ${attack.order} の証拠の答え: ${attack.evidenceAnswer}`);
    if (attack.notes) text(detail, 'p', `Attack ${attack.order} の成立条件: ${attack.notes}`);
  }

}


function showPanel(id) {
  panels.forEach(panel => { byId(panel).hidden = panel !== id; });
  byId('author-steps').hidden = !['selection-panel', 'preview-panel', 'generation-panel', 'ready-panel', 'failure-panel'].includes(id);
  const current = id === 'selection-panel' ? 0 : id === 'preview-panel' ? 1 : 2;
  for (const item of document.querySelectorAll('[data-flow-step]')) {
    const number = Number(item.dataset.flowStep);
    item.className = number === current ? 'current' : number < current ? 'complete' : '';
    item.setAttribute('aria-current', number === current ? 'step' : 'false');
  }
}
function render() {
  const state = author?.currentState ?? 'MODE_SELECTION';
  gameAudio.setScene(byId('study-dialog').open ? 'explanation' : author?.canCancel ? 'generation' : 'title');
  if (state === 'READY' && lastAudioState && lastAudioState !== 'READY') void gameAudio.effect('success');
  lastAudioState = state;
  if (author?.canCancel) {
    showPanel('generation-panel'); renderProgress('generation-progress'); renderDetails('detail-list');
    byId('generation-message').textContent = state.includes('REVIEW') || state.includes('VALIDAT')
      ? '攻撃経路と調査方法を確認しています…' : '選択した攻撃と舞台からゲームを作成しています…';
  } else if (state === 'SCENARIO_PREVIEW') { showPanel('preview-panel'); renderPreview(); }
  else if (state === 'READY') {
    showPanel('ready-panel'); renderProgress('ready-progress'); byId('play-game').href = author.playUrl;
    byId('ready-save-status').textContent = author.saved
      ? '✓ このゲームはローカルに保存されました。「裁判」の一覧からいつでも開始できます。'
      : 'ゲームの保存状態を確認しています…';
  } else if (['FAILED', 'CANCELLED'].includes(state)) {
    showPanel('failure-panel'); byId('failure-message').textContent = author.failure?.message ?? '生成を中止しました。';
    renderDetails('failure-details');
  } else {
    const entryPanels = { SPLASH: 'splash-panel', ACTIVITY: 'activity-panel', COURT: 'court-entry-panel',
      SELECTION: 'selection-panel', HELP: 'help-panel', SETTINGS: 'settings-panel' };
    showPanel(state === 'MODE_SELECTION' ? entryPanels[entryView] ?? 'splash-panel' : 'selection-panel');
    if (entryView === 'COURT') renderSavedGames();
  }
  syncControls();
  if (!author?.canCancel && polling) { clearInterval(polling); polling = null; }
}
async function refresh() {
  if (pollingRequest || submitting) return;
  pollingRequest = true;
  const version = requestVersion;
  try { const response = await api('/api/author/status');
    if (version === requestVersion && !submitting) { author = response.author; render(); } }
  catch (error) { showError(error.message); byId('generation-message').textContent = '状態の更新に失敗しました。' + error.message; }
  finally { pollingRequest = false; }
}
async function postAuthor(path, body = {}) {
  if (submitting) return;
  requireInitialized(); submitting = true; syncControls(); showError('');
  requestVersion += 1;
  try {
    author = (await api(path, body)).author;
    if (author.canCancel) polling ??= setInterval(refresh, 400);
  } catch (error) { showError(error.message); }
  finally { submitting = false; render(); }
}
function bindAuthorControls() {
byId('study-dialog-close').addEventListener('click', () => byId('study-dialog').close());
byId('game-start').addEventListener('click', () => { entryView = 'ACTIVITY'; render(); });
byId('activity-back').addEventListener('click', () => { entryView = 'SPLASH'; render(); });
byId('choose-creation').addEventListener('click', () => { entryView = 'SELECTION'; render(); });
byId('choose-court').addEventListener('click', async () => { entryView = 'COURT'; render(); await loadSavedGames(); });
byId('court-entry-back').addEventListener('click', () => { entryView = 'ACTIVITY'; render(); });
byId('court-create-game').addEventListener('click', () => { entryView = 'SELECTION'; render(); });
byId('menu-help').addEventListener('click', () => { byId('app-menu').open = false; entryView = 'HELP'; render(); });
byId('menu-settings').addEventListener('click', () => {
  byId('app-menu').open = false; const settings = readSettings();
  byId('setting-text-size').value = settings.textSize; byId('setting-motion').value = settings.motion;
  byId('settings-status').textContent = ''; entryView = 'SETTINGS'; render();
});
byId('menu-title').addEventListener('click', () => { byId('app-menu').open = false; entryView = 'SPLASH'; render(); });
byId('menu-exit').addEventListener('click', () => {
  byId('app-menu').open = false; const dialog = byId('exit-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
});
byId('help-back').addEventListener('click', () => { entryView = 'ACTIVITY'; render(); });
byId('settings-back').addEventListener('click', () => { entryView = 'ACTIVITY'; render(); });
byId('settings-apply').addEventListener('click', () => applySettings({
  textSize: byId('setting-text-size').value, motion: byId('setting-motion').value,
}, true));
byId('exit-cancel').addEventListener('click', () => {
  const dialog = byId('exit-dialog'); if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
});
for (const [id, saveData] of [['exit-save', true], ['exit-without-save', false]]) {
  byId(id).addEventListener('click', async () => {
    const buttons = [byId('exit-save'), byId('exit-without-save'), byId('exit-cancel')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      await api('/api/author/shutdown', { saveData });
      const dialog = byId('exit-dialog'); if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      showPanel('shutdown-panel');
      gameAudio.setScene('silent');
    } catch (error) {
      buttons.forEach(button => { button.disabled = false; });
      byId('exit-dialog-title').textContent = `終了できませんでした：${error.message}`;
    }
  });
}

  byId('selection-back').addEventListener('click', async () => {
    entryView = 'ACTIVITY'; await postAuthor('/api/author/menu');
  });
  for (let index = 0; index < 3; index++) byId('attack-' + (index + 1)).addEventListener('change', () => changeAttack(index));
  byId('setting').addEventListener('change', () => { showError(''); syncControls(); });
  byId('create-scenario').addEventListener('click', async () => {
    if (!initialized || submitting || author?.canCancel || !validSelectedPath()) return;
    const settingId = byId('setting').value;
    if (!bootstrap.settings.some(item => item.id === settingId)) { showError('登録された舞台を選択してください。'); return; }
    const model = byId('generation-model').value;
    const reasoningEffort = byId('generation-effort').value;
    const options = bootstrap.generationOptions;
    if (options && (!options.models.includes(model) || !options.reasoningEfforts.includes(reasoningEffort))) {
      showError('一覧からモデルとエフォートを選択してください。'); return;
    }
    await postAuthor('/api/author/selection', { request: { schemaVersion: '1.0', attackIds: selectedIds(), settingId },
      generationSettings: { schemaVersion: '1.0', model, reasoningEffort } });
  });
  byId('preview-approve').addEventListener('click', () => author?.canApprove && postAuthor('/api/author/approve'));
  byId('preview-reject').addEventListener('click', () => author?.canApprove && postAuthor('/api/author/reject'));
  byId('cancel').addEventListener('click', () => author?.canCancel && postAuthor('/api/author/cancel'));
  byId('ready-back').addEventListener('click', async () => { entryView = 'ACTIVITY'; await postAuthor('/api/author/menu'); });
  byId('retry').addEventListener('click', async () => { entryView = 'SELECTION'; await postAuthor('/api/author/menu'); });
}
try {
  applySettings(readSettings());
  setInitializationState(false, '初期設定を読み込んでいます…');
  bindAuthorControls();
  const value = await api('/api/author/start', {}); token = value.token;
  validateBootstrap(value.bootstrap); bootstrap = value.bootstrap; author = value.author;
  renderChoices();
  const request = author.selection?.request;
  if (request && bootstrap.attackSelectionPaths.some(path => path.length === request.attackIds.length && matchesPrefix(path, request.attackIds))
    && bootstrap.settings.some(item => item.id === request.settingId)) {
    selectedAttacks = [...request.attackIds]; byId('setting').value = request.settingId; renderAttackSteps();
  }
  setInitializationState(true); render();
  if (entryView === 'COURT') {
    // A completed player session returns to the archive even if authoring was READY.
    if (!author.canCancel && author.currentState !== 'MODE_SELECTION') await postAuthor('/api/author/menu');
    await loadSavedGames();
  }
  if (author.canCancel) polling ??= setInterval(refresh, 400);
} catch (error) {
  initialized = false;
  byId('initialization-status').hidden = false;
  byId('initialization-status').textContent = '初期設定の読み込みに失敗しました。' + error.message + ' ' + initializationHelp;
  showPanel('splash-panel');
  for (const id of ['choose-creation', 'court-create-game', 'create-scenario']) if (byId(id)) byId(id).disabled = true;
}
