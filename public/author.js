let token = null;
let bootstrap = null;
let author = null;
let polling = null;
let pollingRequest = false;
let initialized = false;
let submitting = false;
let revision = 0;
let selectedAttacks = [];
let entered = false;
let incidentPage = 0;
let lastIncidentId = null;
let displayedPanel = null;
let progressTimer = null;
let progressValue = 0;
let progressTarget = 0;
let progressPhase = '';
let progressPhaseStartedAt = 0;
let progressPaused = false;
const byId = id => document.getElementById(id);
const panels = ['start-panel', 'selection-panel', 'preview-panel', 'generation-panel', 'ready-panel', 'failure-panel'];
const svgNs = 'http://www.w3.org/2000/svg';

async function api(path, body = null) {
  const response = await fetch(path, { method: body === null ? 'GET' : 'POST',
    headers: { ...(body === null ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === null ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? '処理に失敗しました。');
  return value;
}
function text(parent, tag, value, className = '') {
  const node = document.createElement(tag); node.textContent = value;
  if (className) node.className = className;
  parent.append(node); return node;
}
function showPanel(id) {
  if (id === 'generation-panel' && displayedPanel !== id) nextIncident();
  panels.forEach(panel => { byId(panel).hidden = panel !== id; });
  if (displayedPanel !== id) { globalThis.scrollTo?.({ top: 0, left: 0, behavior: 'instant' }); displayedPanel = id; }
  byId('author-steps').hidden = id === 'start-panel';
  const step = id === 'selection-panel' ? 'selection' : id === 'preview-panel' ? 'preview' : 'generation';
  for (const name of ['selection', 'preview', 'generation']) {
    byId(`wizard-${name}`).setAttribute('aria-current', step === name ? 'step' : 'false');
  }
}
function showError(message) { byId('operation-error').textContent = message; }
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
  byId('start-generation').disabled = !initialized || busy;
  byId('back-to-title').disabled = busy;
  for (let index = 0; index < 3; index += 1) {
    byId(`attack-${index + 1}`).disabled = !initialized || busy || byId(`attack-step-${index + 1}`).hidden;
  }
  byId('setting').disabled = !initialized || busy;
  byId('create-scenario').disabled = !initialized || busy || !validSelectedPath();
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
}
function drawNetwork(id, network) {
  const svg = byId(id); svg.replaceChildren(); const width = 900; const rowHeight = 165;
  const subnetGroups = network.subnets.map((subnet, index) => ({ subnet, index,
    nodes: network.nodes.filter(node => node.subnetId === subnet.subnetId) }));
  svg.setAttribute('viewBox', `0 0 ${width} ${Math.max(180, subnetGroups.length * rowHeight)}`);
  const positions = new Map();
  subnetGroups.forEach(({ subnet, index, nodes }) => {
    const y = index * rowHeight + 10; const rect = document.createElementNS(svgNs, 'rect');
    rect.setAttribute('x', '10'); rect.setAttribute('y', String(y)); rect.setAttribute('width', '880');
    rect.setAttribute('height', '145'); rect.setAttribute('rx', '12'); rect.setAttribute('class', 'diagram-subnet'); svg.append(rect);
    const title = document.createElementNS(svgNs, 'text'); title.setAttribute('x', '24'); title.setAttribute('y', String(y + 22));
    title.textContent = `${subnet.label} (${subnet.cidr}) / ${subnet.trustBoundaryId}`; svg.append(title);
    nodes.forEach((node, nodeIndex) => { const x = 45 + nodeIndex * Math.max(145, 780 / Math.max(nodes.length, 1));
      positions.set(node.nodeId, { x, y: y + 45 }); const box = document.createElementNS(svgNs, 'rect');
      box.setAttribute('x', String(x)); box.setAttribute('y', String(y + 34)); box.setAttribute('width', '125');
      box.setAttribute('height', '92'); box.setAttribute('rx', '8'); box.setAttribute('class', 'diagram-node'); svg.append(box);
      const line1 = document.createElementNS(svgNs, 'text'); line1.setAttribute('x', String(x + 8)); line1.setAttribute('y', String(y + 56));
      line1.textContent = node.label; svg.append(line1); const line2 = document.createElementNS(svgNs, 'text');
      line2.setAttribute('x', String(x + 8)); line2.setAttribute('y', String(y + 77)); line2.textContent = `${node.ip} / ${node.nodeType}`;
      line2.setAttribute('class', 'diagram-caption'); svg.append(line2);
      const line3 = document.createElementNS(svgNs, 'text'); line3.setAttribute('x', String(x + 8));
      line3.setAttribute('y', String(y + 96)); line3.setAttribute('class', 'diagram-caption');
      line3.textContent = `Role: ${node.roles.join(', ')}`; svg.append(line3);
      const serviceLabels = network.services.filter(service => service.nodeId === node.nodeId)
        .map(service => `${service.label} [${service.serviceType}]`);
      const line4 = document.createElementNS(svgNs, 'text'); line4.setAttribute('x', String(x + 8));
      line4.setAttribute('y', String(y + 114)); line4.setAttribute('class', 'diagram-caption');
      line4.textContent = serviceLabels.length ? `Service: ${serviceLabels.join(', ')}` : 'Service: なし';
      svg.append(line4); });
  });
  for (const connection of network.connections) { const from = positions.get(connection.fromNodeId); const to = positions.get(connection.toNodeId);
    if (!from || !to) continue; const line = document.createElementNS(svgNs, 'line');
    line.setAttribute('x1', String(from.x + 125)); line.setAttribute('y1', String(from.y + 35));
    line.setAttribute('x2', String(to.x)); line.setAttribute('y2', String(to.y + 35)); line.setAttribute('class', 'diagram-connection');
    svg.insertBefore(line, svg.firstChild); }
}


function renderProgress(targetId) {
  const target = byId(targetId); target.replaceChildren(); for (const item of author.progress) {
    const suffix = item.status === 'COMPLETE' ? '✓' : item.status === 'RUNNING' ? '実行中…'
      : item.status === 'FAILED' ? '失敗' : item.status === 'SKIPPED' ? '不要' : '待機中';
    text(target, 'li', `${item.label}　${suffix}${item.attempt ? ` ${item.attempt} / ${author.maxAttempts}` : ''}`, item.status.toLowerCase()); }
}

// Milestones are confirmed by the server. Movement within an active phase is
// explicitly an estimate, capped below its completion; only READY allows 100%.
const progressWeights = { configuration: 5, codex: 5, scenario: 20, validation: 5, verification: 15,
  evidence: 30, investigation: 5, dialogue: 5, game: 5, evaluation: 5 };
function progressGoal() {
  const complete = new Set(author.progress.filter(item => item.status === 'COMPLETE').map(item => item.id));
  const confirmed = Object.entries(progressWeights).reduce((sum, [id, weight]) => sum + (complete.has(id) ? weight : 0), 0);
  if (author.currentState === 'READY') return 100;
  if (author.currentState === 'SCENARIO_PREVIEW') return Math.min(99, confirmed);
  const running = author.progress.find(item => item.status === 'RUNNING' && progressWeights[item.id]);
  const phase = `${author.generationId ?? ''}:${author.currentState}:${running?.id}:${running?.attempt}`;
  if (phase !== progressPhase) { progressPhase = phase; progressPhaseStartedAt = Date.now(); }
  const weight = running && author.canCancel ? progressWeights[running.id] : 0;
  const elapsed = Math.max(0, Date.now() - progressPhaseStartedAt);
  const estimated = weight > 0 ? Math.floor((weight - 1) * (1 - Math.exp(-elapsed / (weight * 3000)))) : 0;
  return Math.min(99, confirmed + estimated);
}
function paintPercent() {
  byId('generation-percent').value = progressValue;
  byId('generation-percent').textContent = `${progressValue}%`;
  byId('generation-percent-label').textContent = `${progressValue}%`;
}
function resetPercent() {
  if (progressTimer !== null) clearInterval(progressTimer);
  progressTimer = null; progressValue = 0; progressTarget = 0; progressPhase = ''; progressPaused = false;
  paintPercent();
}
function tickPercent() {
  if (progressPaused || !author || ['FAILED', 'CANCELLED'].includes(author.currentState)) return;
  progressTarget = progressGoal();
  if (progressValue < progressTarget) { progressValue += 1; paintPercent(); }
  if (!author.canCancel && progressValue >= progressTarget) {
    clearInterval(progressTimer); progressTimer = null;
    if (displayedPanel === 'generation-panel' && ['READY', 'SCENARIO_PREVIEW'].includes(author.currentState)) render();
  }
}
function renderPercent() {
  if (['FAILED', 'CANCELLED'].includes(author.currentState)) {
    if (progressTimer !== null) clearInterval(progressTimer);
    progressTimer = null; return;
  }
  progressTarget = progressGoal();
  paintPercent();
  if ((author.canCancel || progressValue < progressTarget) && progressTimer === null) {
    progressTimer = setInterval(tickPercent, 40);
  }
}
function nextIncident() {
  const cards = [...byId('incident-cards').querySelectorAll('article')];
  try { lastIncidentId = globalThis.localStorage?.getItem('incident-craft:last-incident') ?? lastIncidentId; } catch { /* Storage may be disabled. */ }
  const previous = cards.findIndex(card => card.id === lastIncidentId);
  incidentPage = (previous + 1) % cards.length;
  renderIncident(true);
}
function renderIncident(remember = false) {
  const cards = [...byId('incident-cards').querySelectorAll('article')];
  cards.forEach((card, index) => { card.hidden = index !== incidentPage; });
  byId('incident-page').textContent = `${incidentPage + 1} / ${cards.length}`;
  byId('incident-prev').disabled = incidentPage === 0;
  byId('incident-next').disabled = incidentPage === cards.length - 1;
  if (remember) {
    lastIncidentId = cards[incidentPage].id;
    try { globalThis.localStorage?.setItem('incident-craft:last-incident', lastIncidentId); } catch { /* Keep rotating in memory. */ }
  }
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
    if (item.code === 'CODEX_TIMEOUT') {
      for (const [key, label] of [['timeoutMs', 'Timeout (ms)'], ['elapsedMs', 'Elapsed (ms)'],
        ['promptBytes', 'Prompt (bytes)'], ['stdoutBytes', 'stdout (bytes)'], ['stderrBytes', 'stderr (bytes)']]) {
        if (Number.isSafeInteger(item[key]) && item[key] >= 0) text(article, 'p', `${label}: ${item[key]}`);
      }
      if (item.terminationSignal) text(article, 'p', `Termination signal: ${item.terminationSignal}`);
    }
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


function renderPreview() {
  const preview = author.scenarioPreview;
  byId('preview-summary').textContent = preview.incidentSummary;
  byId('preview-target').textContent = preview.targetSystem;
  byId('preview-difficulty').textContent = preview.difficultyLabel;
  byId('preview-verification').textContent = preview.verification?.status === 'VERIFIED'
    ? '技術条件の検証・独立レビュー済み' : '未検証';
  const attacks = byId('preview-attacks'); attacks.replaceChildren();
  for (const attack of preview.attacks) {
    const card = document.createElement('article'); card.className = 'builder-card';
    text(card, 'h3', `${attack.order}. ${attack.label}`);
    text(card, 'p', `発生：${attack.occurrenceTime}`);
    text(card, 'p', `${attack.source} → ${attack.target} / ${attack.targetService}`);
    text(card, 'p', `調査：${attack.investigations.map(item => item.label).join('、')}`);
    attacks.append(card);
  }
  drawNetwork('preview-network-diagram', preview.network);
  const details = byId('preview-author-details'); details.replaceChildren();
  text(details, 'p', '以下は自動設定した教材の条件です。実在の組織・アカウント・被害を表しません。');
  for (const attack of author.configuration?.attacks ?? []) {
    text(details, 'p', `攻撃 ${attack.order} の前提：${attack.notes}`);
  }
}
function render() {
  const state = author.currentState;
  renderPercent();
  const settling = ['SCENARIO_PREVIEW', 'READY'].includes(state) && progressValue < progressTarget;
  if (author.canCancel || settling) {
    showPanel('generation-panel'); renderProgress('generation-progress'); renderDetails('detail-list');
    byId('generation-title').textContent = author.canApprove || author.progress.some(item => item.id === 'verification' && item.status === 'COMPLETE')
      ? 'ゲームを生成しています' : '事件案を作成しています';
    byId('generation-message').textContent = settling ? (state === 'READY' ? '生成が完了しました。ゲームを開く準備をしています。' : '検証が完了しました。事件案の確認画面を準備しています。')
      : state.includes('REVIEW') || state.includes('VALIDAT')
      ? '攻撃の成立条件と、資料から推理できるかを確認しています。'
      : '選んだ攻撃と舞台から、事件・資料・脚本を準備しています。';
    if (author.canCancel) polling ??= setInterval(refresh, 500);
  } else if (state === 'SCENARIO_PREVIEW') { showPanel('preview-panel'); renderPreview(); }
  else if (state === 'READY') {
    showPanel('ready-panel'); renderProgress('ready-progress');
    const url = author.playUrl;
    byId('play-game').href = typeof url === 'string' && /^\/\?game=[a-f0-9]{48}$/.test(url) ? url : '/author';
  } else if (['FAILED', 'CANCELLED'].includes(state)) {
    showPanel('failure-panel'); renderDetails('failure-details');
    byId('failure-message').textContent = author.failure?.message ?? '生成を中止しました。';
  } else {
    showPanel(entered ? 'selection-panel' : 'start-panel');
    if (author.configurationValidation?.status === 'INVALID') {
      showError(author.configurationValidation.errors.map(item =>
        `${item.code}：${item.reason} ${item.correctionHint ?? ''}`).join('\n'));
    }
  }
  if (!author.canCancel && polling) { clearInterval(polling); polling = null; }
  syncControls();
}
async function refresh() {
  if (pollingRequest || submitting) return;
  pollingRequest = true; const current = revision;
  try {
    const value = await api('/api/author/status');
    if (current === revision) { author = value.author; progressPaused = false; render(); }
  } catch (error) { progressPaused = true; showError(`進捗を取得できませんでした。${error.message}`); }
  finally { pollingRequest = false; }
}
async function postAuthor(path, body = {}) {
  if (!initialized || submitting) return;
  submitting = true; revision += 1; syncControls(); showError('');
  if (['/api/author/selection', '/api/author/approve'].includes(path)) {
    entered = true;
    showPanel('generation-panel');
    if (path.endsWith('/selection')) {
      resetPercent();
    } else renderPercent();
    byId('generation-title').textContent = path.endsWith('/selection') ? '事件案を作成しています' : 'ゲームを生成しています';
    byId('generation-message').textContent = '生成を開始しています…';
  }
  try { author = (await api(path, body)).author; render(); }
  catch (error) { render(); showError(error.message); }
  finally { submitting = false; syncControls(); }
}

try {
  for (const id of [...panels, 'attack-options', 'attack-1', 'attack-2', 'attack-3',
    'attack-step-1', 'attack-step-2', 'attack-step-3', 'attack-chain-status', 'setting', 'create-scenario', 'preview-approve',
    'preview-reject', 'cancel', 'retry', 'initialization-status', 'operation-error',
    'selection-count', 'preview-summary', 'preview-target', 'preview-difficulty', 'preview-verification',
    'preview-attacks', 'preview-network-diagram', 'preview-author-details', 'generation-message',
    'generation-progress', 'detail-list', 'ready-progress', 'play-game', 'failure-message', 'failure-details',
    'start-generation', 'back-to-title', 'author-steps', 'wizard-selection', 'wizard-preview', 'wizard-generation',
    'generation-title', 'generation-percent', 'generation-percent-label', 'incident-cards', 'incident-page', 'incident-prev', 'incident-next']) {
    if (!byId(id)) throw new Error(`画面の部品が不足しています：${id}`);
  }
  byId('start-generation').addEventListener('click', () => {
    if (!initialized || submitting || author?.canCancel) return;
    entered = true; render(); byId('selection-title').setAttribute('tabindex', '-1'); byId('selection-title').focus();
  });
  byId('back-to-title').addEventListener('click', () => {
    if (submitting || author?.canCancel) return;
    entered = false; render(); byId('start-generation').focus();
  });
  byId('incident-prev').addEventListener('click', () => { incidentPage = Math.max(0, incidentPage - 1); renderIncident(true); });
  byId('incident-next').addEventListener('click', () => {
    incidentPage = Math.min(byId('incident-cards').querySelectorAll('article').length - 1, incidentPage + 1); renderIncident(true);
  });
  renderIncident();
  for (let index = 0; index < 3; index += 1) {
    byId(`attack-${index + 1}`).addEventListener('change', () => changeAttack(index));
  }
  byId('create-scenario').addEventListener('click', () => {
    const attackIds = selectedIds();
    if (!initialized || author?.canCancel) return;
    if (!validSelectedPath()) { showError('発生順につながる攻撃を1～3種類選択してください。'); return; }
    return postAuthor('/api/author/selection', { request: {
      schemaVersion: '1.0', attackIds, settingId: byId('setting').value } });
  });
  byId('preview-approve').addEventListener('click', () => postAuthor('/api/author/approve'));
  byId('preview-reject').addEventListener('click', () => postAuthor('/api/author/reject'));
  byId('cancel').addEventListener('click', () => postAuthor('/api/author/cancel'));
  byId('retry').addEventListener('click', () => {
    if (submitting || author?.canCancel) return;
    entered = true; author.currentState = 'MODE_SELECTION'; showError(''); render();
  });
  const value = await api('/api/author/start', {});
  validateBootstrap(value.bootstrap);
  if (typeof value.token !== 'string' || !value.author) throw new Error('制作セッションを取得できません。');
  token = value.token; bootstrap = value.bootstrap; author = value.author;
  renderChoices(); initialized = true; byId('initialization-status').hidden = true; render();
} catch (error) {
  initialized = false;
  const notice = byId('initialization-status');
  if (notice) { notice.hidden = false; notice.textContent = `初期設定の読み込みに失敗しました。${error.message} サーバーを再起動して画面を再読み込みしてください。`; }
  if (byId('create-scenario')) byId('create-scenario').disabled = true;
}
