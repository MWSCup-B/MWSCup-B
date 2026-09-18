let token = null;
let bootstrap = null;
let author = null;
let polling = null;
let networkModel = null;
let initializationReady = false;
const initializationHelp = 'サーバーを再起動（npm start）して画面を再読み込みしてください。';
const byId = id => document.getElementById(id);
const panels = ['mode-panel', 'manual-panel', 'makotomaru-panel', 'preview-panel',
  'generation-panel', 'ready-panel', 'failure-panel'];
const svgNs = 'http://www.w3.org/2000/svg';

function setInitializationState(ready, message = '') {
  initializationReady = ready;
  const notice = byId('initialization-status');
  notice.textContent = message; notice.hidden = ready;
  for (const id of ['choose-manual', 'choose-makotomaru', 'manual-create', 'makotomaru-create']) {
    byId(id).disabled = !ready || Boolean(author?.canCancel);
  }
}

function requireInitialized() {
  if (!initializationReady) throw new Error(`初期設定の読み込みが完了していません。${initializationHelp}`);
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`初期設定の${field}が取得できないか、形式が不正です。${initializationHelp}`);
  }
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`初期設定の${field}が配列ではありません。${initializationHelp}`);
  }
}

function requireNetwork(value) {
  requireObject(value, 'network');
  for (const kind of ['subnets', 'nodes', 'services', 'connections']) {
    requireArray(value[kind], `network.${kind}`);
    value[kind].forEach(item => requireObject(item, `network.${kind}の項目`));
  }
  for (const node of value.nodes) {
    requireArray(node.roles, 'network.nodes.roles');
    requireArray(node.logSources, 'network.nodes.logSources');
  }
}

function readInitialConfiguration(value) {
  requireObject(value, 'bootstrap');
  const preset = value.defaultManualConfiguration;
  requireObject(preset, 'defaultManualConfiguration');
  requireNetwork(preset.network);
  requireObject(preset.incidentContext, 'incidentContext');
  requireArray(preset.attacks, 'attacks');
  for (const key of ['attacks', 'investigationTypes', 'nodeTypes']) requireArray(value[key], key);
  if (!preset.attacks.length || ![1, 2, 3].includes(preset.difficulty)) {
    throw new Error(`初期設定の攻撃または難易度が不正です。${initializationHelp}`);
  }
  for (const attack of preset.attacks) {
    requireObject(attack, 'attacksの項目');
    requireArray(attack.investigationTypes, 'attacks.investigationTypes');
    if (typeof attack.occurrenceTime !== 'string' || typeof attack.evidenceAnswer !== 'string'
      || !value.attacks.some(item => item.id === attack.attackId)) {
      throw new Error(`初期設定の攻撃・発生日時・証拠の答えが取得できません。${initializationHelp}`);
    }
  }
  return preset;
}

function requireRenderedConfiguration() {
  requireNetwork(networkModel);
  for (const kind of ['subnets', 'nodes', 'services', 'connections']) {
    const rows = document.querySelectorAll(`[data-network-kind="${kind}"]`);
    if (rows.length !== networkModel[kind].length) {
      throw new Error(`Network Builderの${kind}が正しく表示されていないため送信できません。${initializationHelp}`);
    }
  }
  const selected = [...document.querySelectorAll('input[name="attack"]:checked')].map(item => item.value);
  const cards = [...document.querySelectorAll('[data-attack-id]')];
  if (cards.length !== selected.length || selected.some(id => !cards.some(card => card.dataset.attackId === id))) {
    throw new Error(`攻撃の詳細が正しく表示されていないため送信できません。${initializationHelp}`);
  }
}

async function api(path, body = null) {
  const response = await fetch(path, { method: body == null ? 'GET' : 'POST',
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

function input(parent, label, value, key, type = 'text') {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const control = document.createElement('input'); control.type = type; control.value = value ?? '';
  control.dataset.key = key; wrapper.append(control); parent.append(wrapper); return control;
}

function select(parent, label, value, key, options) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const control = document.createElement('select'); control.dataset.key = key;
  for (const [id, title] of options) { const option = document.createElement('option');
    option.value = id; option.textContent = title; option.selected = id === value; control.append(option); }
  wrapper.append(control); parent.append(wrapper); return control;
}

function multiSelect(parent, label, values, key, options) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const control = document.createElement('select'); control.dataset.key = key;
  control.multiple = true; control.size = Math.min(5, options.length);
  const selected = new Set(values);
  for (const [id, title] of options) { const option = document.createElement('option');
    option.value = id; option.textContent = title; option.selected = selected.has(id); control.append(option); }
  wrapper.append(control); parent.append(wrapper); return control;
}

function removeButton(parent, collection, item) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'danger-link';
  button.textContent = '削除'; button.addEventListener('click', () => {
    collection.splice(collection.indexOf(item), 1); renderNetworkBuilder(); renderAttackDetails();
  }); parent.append(button);
}

function splitList(value) { return value.split(',').map(item => item.trim()).filter(Boolean); }

function syncNetworkModel() {
  requireNetwork(networkModel);
  for (const row of document.querySelectorAll('[data-network-kind]')) {
    const kind = row.dataset.networkKind; const index = Number(row.dataset.index);
    const item = networkModel[kind][index]; if (!item) continue;
    for (const control of row.querySelectorAll('[data-key]')) {
      const value = control.multiple ? [...control.selectedOptions].map(option => option.value)
        : control.dataset.key === 'roles' ? splitList(control.value) : control.value;
      item[control.dataset.key] = value;
    }
  }
}

function networkRow(kind, item, index) {
  const row = document.createElement('article'); row.className = 'builder-card compact-builder';
  row.dataset.networkKind = kind; row.dataset.index = String(index);
  if (kind === 'subnets') {
    input(row, 'ID', item.subnetId, 'subnetId'); input(row, '表示名', item.label, 'label');
    input(row, 'CIDR', item.cidr, 'cidr'); input(row, 'Trust Boundary', item.trustBoundaryId, 'trustBoundaryId');
  } else if (kind === 'nodes') {
    input(row, 'ID', item.nodeId, 'nodeId'); input(row, '表示名', item.label, 'label');
    select(row, 'Node Type', item.nodeType, 'nodeType', bootstrap.nodeTypes.map(id => [id, id]));
    select(row, 'OS', item.os, 'os', ['windows', 'linux', 'macos', 'network', 'other'].map(id => [id, id]));
    input(row, 'IP', item.ip, 'ip'); select(row, 'Subnet', item.subnetId, 'subnetId',
      optionPairs(networkModel.subnets, 'subnetId', 'label'));
    input(row, 'Trust Boundary', item.trustBoundaryId, 'trustBoundaryId');
    input(row, 'Roles（カンマ区切り）', item.roles.join(', '), 'roles');
    multiSelect(row, 'Log Sources', item.logSources, 'logSources',
      bootstrap.investigationTypes.map(value => [value.id, value.label]));
  } else if (kind === 'services') {
    input(row, 'ID', item.serviceId, 'serviceId'); input(row, '表示名', item.label, 'label');
    select(row, 'Node', item.nodeId, 'nodeId', optionPairs(networkModel.nodes, 'nodeId', 'label'));
    select(row, 'Service Type', item.serviceType, 'serviceType', [
      'web_browser', 'email', 'web_application', 'sql_database', 'proxy', 'authentication', 'file', 'logging'].map(id => [id, id]));
    select(row, 'Platform', item.platform, 'platform',
      ['browser', 'email', 'web', 'sql', 'proxy', 'auth', 'file', 'logging'].map(id => [id, id]));
  } else {
    select(row, '接続元Node', item.fromNodeId, 'fromNodeId', optionPairs(networkModel.nodes, 'nodeId', 'label'));
    select(row, '接続先Node', item.toNodeId, 'toNodeId', optionPairs(networkModel.nodes, 'nodeId', 'label'));
  }
  removeButton(row, networkModel[kind], item); return row;
}

function renderNetworkBuilder() {
  for (const kind of ['subnets', 'nodes', 'services', 'connections']) {
    const target = byId(`${kind.slice(0, -1)}-rows`); target.replaceChildren();
    networkModel[kind].forEach((item, index) => target.append(networkRow(kind, item, index)));
  }
  drawNetwork('manual-network-diagram', networkModel);
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

function renderAttackOptions() {
  const target = byId('attack-options'); target.replaceChildren();
  for (const attack of bootstrap.attacks) { const label = document.createElement('label'); label.className = 'choice-card';
    const control = document.createElement('input'); control.type = 'checkbox'; control.name = 'attack'; control.value = attack.id;
    control.addEventListener('change', () => { const selected = [...document.querySelectorAll('input[name="attack"]:checked')];
      if (selected.length > 3) { control.checked = false; byId('manual-errors').textContent = '攻撃手法は最大3つです。'; }
      renderAttackDetails(); }); label.append(control); text(label, 'strong', attack.label); target.append(label); }
}

function optionPairs(items, id, label) { return items.map(item => [item[id], item[label]]); }

function renderAttackDetails(initialAttacks = []) {
  // 初回のみBackendのプリセットを使い、その後の再描画では利用者の入力を優先する。
  const defaults = initialAttacks.map(attack => [attack.attackId, {
    ...attack, order: String(attack.order), occurrenceTime: attack.occurrenceTime.slice(0, 16),
    ...Object.fromEntries(bootstrap.investigationTypes.map(({ id }) =>
      [`investigation:${id}`, attack.investigationTypes.includes(id)])),
  }]);
  syncNetworkModel(); const target = byId('attack-details'); const existing = new Map(
    [...defaults, ...[...target.querySelectorAll('[data-attack-id]')].map(node => [node.dataset.attackId, Object.fromEntries(
      [...node.querySelectorAll('[data-key]')].map(control => [control.dataset.key, control.type === 'checkbox' ? control.checked : control.value]))])]);
  target.replaceChildren(); const selected = [...document.querySelectorAll('input[name="attack"]:checked')].map(item => item.value);
  const nodes = optionPairs(networkModel.nodes, 'nodeId', 'label'); const services = optionPairs(networkModel.services, 'serviceId', 'label');
  selected.forEach((attackId, index) => { const attack = bootstrap.attacks.find(item => item.id === attackId); const saved = existing.get(attackId) ?? {};
    const card = document.createElement('article'); card.className = 'builder-card'; card.dataset.attackId = attackId;
    text(card, 'h3', `Attack ${index + 1}: ${attack.label}`);
    select(card, 'Attack Order', saved.order ?? String(index + 1), 'order', ['1', '2', '3'].map(value => [value, value]));
    input(card, '発生日時', saved.occurrenceTime ?? `${byId('incident-date').value || '2026-01-15'}T09:${String(10 + index * 8).padStart(2, '0')}`, 'occurrenceTime', 'datetime-local');
    select(card, 'Source Node', saved.sourceNodeId ?? (attackId === 'reflected_xss' ? 'client-host' : 'sender-host'), 'sourceNodeId', nodes);
    select(card, 'Target Node', saved.targetNodeId ?? 'web-host', 'targetNodeId', nodes);
    select(card, 'Target Service', saved.targetServiceId ?? 'web-service', 'targetServiceId', services);
    select(card, 'Investigation Source', saved.investigationSourceNodeId ?? (attackId === 'phishing' ? 'mail-host' : 'web-host'), 'investigationSourceNodeId', nodes);
    const group = document.createElement('fieldset'); text(group, 'legend', '調査方法');
    attack.supportedInvestigationTypes.forEach((type, typeIndex) => { const label = document.createElement('label');
      const box = document.createElement('input'); box.type = 'checkbox'; box.dataset.key = `investigation:${type}`;
      box.checked = saved[`investigation:${type}`] ?? typeIndex === 0; label.append(box);
      label.append(document.createTextNode(bootstrap.investigationTypes.find(item => item.id === type).label)); group.append(label); }); card.append(group);
    const evidenceAnswer = input(card, '証拠から導く答え', saved.evidenceAnswer ?? '',
      'evidenceAnswer');
    evidenceAnswer.required = true;
    evidenceAnswer.placeholder = '選択した記録から確認できる具体的な事実';
    select(card, '想定効果', saved.expectedEffect ?? attack.expectedEffects[0].label,
      'expectedEffect', attack.expectedEffects.map(effect => [effect.label, effect.label]));
    input(card, 'Notes', saved.notes ?? '', 'notes'); target.append(card); });
}

function collectConfiguration() {
  requireInitialized(); requireRenderedConfiguration();
  syncNetworkModel(); const difficulty = Number(byId('manual-difficulty').value); const attacks = [];
  for (const card of document.querySelectorAll('[data-attack-id]')) {
    const get = key => card.querySelector(`[data-key="${key}"]`)?.value ?? '';
    const investigations = [...card.querySelectorAll('[data-key^="investigation:"]:checked')]
      .map(control => control.dataset.key.split(':')[1]);
    attacks.push({ attackId: card.dataset.attackId, order: Number(get('order')),
      occurrenceTime: get('occurrenceTime'), sourceNodeId: get('sourceNodeId'),
      targetNodeId: get('targetNodeId'), targetServiceId: get('targetServiceId'),
      investigationTypes: investigations, investigationSourceNodeId: get('investigationSourceNodeId'),
      evidenceAnswer: get('evidenceAnswer'), expectedEffect: get('expectedEffect'), notes: get('notes') });
  }
  return { schemaVersion: '1.0', configurationId: `configuration_${crypto.randomUUID().replaceAll('-', '')}`,
    mode: 'MANUAL', difficulty, evidenceCount: difficulty, network: structuredClone(networkModel), attacks,
    incidentContext: { incidentDate: byId('incident-date').value,
      organizationName: byId('organization-name').value, victimSystem: byId('victim-system').value,
      accusedRole: byId('accused-role').value, initialSuspicionReason: byId('suspicion-reason').value } };
}

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

function showPanel(id) { panels.forEach(panel => { byId(panel).hidden = panel !== id; }); }

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
  }
  byId('preview-regenerate').hidden = !author.canRegenerate;
}

function render() {
  const state = author.currentState;
  if (state === 'MODE_SELECTION') showPanel('mode-panel');
  else if (state === 'MANUAL_CONFIGURATION') {
    if (author.canCancel) {
      showPanel('generation-panel'); renderProgress('generation-progress'); renderDetails('detail-list');
      byId('cancel').disabled = false; byId('generation-message').textContent = 'Scenario条件を確認しています…';
    } else { showPanel('manual-panel'); renderDetails('manual-detail-list'); }
    byId('manual-create').disabled = !initializationReady || author.canCancel; byId('manual-back').disabled = author.canCancel;
  }
  else if (state === 'MAKOTOMARU_CONFIGURATION') {
    if (author.canCancel) {
      showPanel('generation-panel'); renderProgress('generation-progress'); renderDetails('detail-list');
      byId('cancel').disabled = false; byId('generation-message').textContent = '真実丸が事件Scenarioを考えています…';
    } else showPanel('makotomaru-panel');
    byId('makotomaru-create').disabled = !initializationReady || author.canCancel; byId('makotomaru-back').disabled = author.canCancel;
  }
  else if (state === 'SCENARIO_PREVIEW') { showPanel('preview-panel'); renderPreview(); }
  else if (state === 'READY') { showPanel('ready-panel'); renderProgress('ready-progress'); byId('play-game').href = author.playUrl; }
  else if (['FAILED', 'CANCELLED'].includes(state)) { showPanel('failure-panel'); byId('failure-message').textContent = author.failure?.message ?? '生成を中止しました。'; renderDetails('failure-details'); }
  else { showPanel('generation-panel'); renderProgress('generation-progress'); renderDetails('detail-list');
    byId('cancel').disabled = !author.canCancel; byId('generation-message').textContent = state === 'MAKOTOMARU_CONFIGURATION'
      ? '真実丸が事件Scenarioを考えています…' : state.includes('REVIEW') || state.includes('VALIDAT') ? '攻撃経路と調査方法を確認しています…' : 'Contractに沿ってゲームを構築しています…'; }
  if (!author.canCancel && polling) { clearInterval(polling); polling = null; }
}

async function refresh() { try { author = (await api('/api/author/status')).author; render(); }
  catch (error) { byId('manual-errors').textContent = error.message; } }
function beginPolling() { polling ??= setInterval(refresh, 400); }
async function postAuthor(path, body = {}) { requireInitialized(); const value = await api(path, body); author = value.author; render(); if (author.canCancel) beginPolling(); }

async function chooseMode(mode) {
  try { await postAuthor('/api/author/select-mode', { mode }); }
  catch (error) { const notice = byId('initialization-status'); notice.hidden = false; notice.textContent = error.message; }
}
function bindAuthorControls() {
byId('choose-manual').addEventListener('click', () => chooseMode('MANUAL'));
byId('choose-makotomaru').addEventListener('click', () => chooseMode('MAKOTOMARU'));
byId('manual-back').addEventListener('click', () => { author.currentState = 'MODE_SELECTION'; render(); });
byId('makotomaru-back').addEventListener('click', () => { author.currentState = 'MODE_SELECTION'; render(); });
byId('manual-create').addEventListener('click', async () => { byId('manual-errors').replaceChildren(); try {
  await postAuthor('/api/author/manual', { configuration: collectConfiguration() });
  if (author.configurationValidation?.status === 'INVALID') for (const item of author.configurationValidation.errors) text(byId('manual-errors'), 'p', `${item.code} — ${item.field}: ${item.reason}`);
} catch (error) { byId('manual-errors').textContent = error.message; } });
byId('makotomaru-create').addEventListener('click', async () => { try { await postAuthor('/api/author/makotomaru', { request: {
  schemaVersion: '1.0', difficulty: Number(byId('makotomaru-difficulty').value), attackCategory: byId('attack-category').value, complexity: byId('complexity').value } });
} catch (error) { byId('makotomaru-error').textContent = error.message; } });
byId('preview-approve').addEventListener('click', () => postAuthor('/api/author/approve'));
byId('preview-reject').addEventListener('click', () => postAuthor('/api/author/reject'));
byId('preview-regenerate').addEventListener('click', () => postAuthor('/api/author/regenerate'));
byId('cancel').addEventListener('click', () => postAuthor('/api/author/cancel'));
byId('retry').addEventListener('click', () => { author.currentState = 'MODE_SELECTION'; render(); });

byId('add-subnet').addEventListener('click', () => { syncNetworkModel(); const n = networkModel.subnets.length + 1;
  networkModel.subnets.push({ subnetId: `subnet-${n}`, label: `Subnet ${n}`, cidr: `10.${n}.0.0/24`, trustBoundaryId: `zone-${n}` }); renderNetworkBuilder(); renderAttackDetails(); });
byId('add-node').addEventListener('click', () => { syncNetworkModel(); const n = networkModel.nodes.length + 1;
  networkModel.nodes.push({ nodeId: `node-${n}`, label: `Node ${n}`, nodeType: 'SERVER', os: 'linux', ip: `10.10.0.${n + 50}`, subnetId: networkModel.subnets[0]?.subnetId ?? 'subnet-1', trustBoundaryId: networkModel.subnets[0]?.trustBoundaryId ?? 'zone-1', roles: ['server'], logSources: ['APPLICATION_LOG'] }); renderNetworkBuilder(); renderAttackDetails(); });
byId('add-service').addEventListener('click', () => { syncNetworkModel(); const n = networkModel.services.length + 1;
  networkModel.services.push({ serviceId: `service-${n}`, nodeId: networkModel.nodes[0]?.nodeId ?? 'node-1', label: `Service ${n}`, serviceType: 'logging', platform: 'logging' }); renderNetworkBuilder(); renderAttackDetails(); });
byId('add-connection').addEventListener('click', () => { syncNetworkModel(); networkModel.connections.push({ fromNodeId: networkModel.nodes[0]?.nodeId ?? '', toNodeId: networkModel.nodes[1]?.nodeId ?? '' }); renderNetworkBuilder(); renderAttackDetails(); });
byId('incident-date').addEventListener('change', () => renderAttackDetails());
for (const id of ['subnet-rows', 'node-rows', 'service-rows', 'connection-rows']) {
  byId(id).addEventListener('input', () => { syncNetworkModel(); drawNetwork('manual-network-diagram', networkModel); });
}
}

try {
  setInitializationState(false, '初期設定を読み込んでいます…');
  bindAuthorControls();
  const value = await api('/api/author/start', {}); token = value.token; bootstrap = value.bootstrap;
  const preset = readInitialConfiguration(bootstrap); author = value.author;
  networkModel = structuredClone(preset.network);
  byId('manual-difficulty').value = String(preset.difficulty);
  for (const [id, field] of [['incident-date', 'incidentDate'], ['organization-name', 'organizationName'],
    ['victim-system', 'victimSystem'], ['accused-role', 'accusedRole'], ['suspicion-reason', 'initialSuspicionReason']]) {
    byId(id).value = preset.incidentContext[field];
  }
  renderAttackOptions(); const selectedAttacks = new Set(preset.attacks.map(attack => attack.attackId));
  for (const control of document.querySelectorAll('input[name="attack"]')) {
    control.checked = selectedAttacks.has(control.value);
  }
  renderNetworkBuilder(); renderAttackDetails(preset.attacks); requireRenderedConfiguration();
  setInitializationState(true); render();
} catch (error) {
  const message = error.message.includes(initializationHelp) ? error.message : `${error.message} ${initializationHelp}`;
  setInitializationState(false, `初期設定の読み込みに失敗しました。${message}`);
  showPanel('mode-panel');
}
