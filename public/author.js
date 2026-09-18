let token = null;
let bootstrap = null;
let author = null;
let polling = null;
let networkModel = null;
const byId = id => document.getElementById(id);
const panels = ['mode-panel', 'manual-panel', 'makotomaru-panel', 'preview-panel',
  'generation-panel', 'ready-panel', 'failure-panel'];
const svgNs = 'http://www.w3.org/2000/svg';

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

function removeButton(parent, collection, item) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'danger-link';
  button.textContent = '削除'; button.addEventListener('click', () => {
    collection.splice(collection.indexOf(item), 1); renderNetworkBuilder();
  }); parent.append(button);
}

function splitList(value) { return value.split(',').map(item => item.trim()).filter(Boolean); }

function syncNetworkModel() {
  for (const row of document.querySelectorAll('[data-network-kind]')) {
    const kind = row.dataset.networkKind; const index = Number(row.dataset.index);
    const item = networkModel[kind][index]; if (!item) continue;
    for (const control of row.querySelectorAll('[data-key]')) {
      const value = ['roles', 'logSources'].includes(control.dataset.key)
        ? splitList(control.value) : control.value;
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
    input(row, 'IP', item.ip, 'ip'); input(row, 'Subnet ID', item.subnetId, 'subnetId');
    input(row, 'Trust Boundary', item.trustBoundaryId, 'trustBoundaryId');
    input(row, 'Roles（カンマ区切り）', item.roles.join(', '), 'roles');
    input(row, 'Log Sources（カンマ区切り）', item.logSources.join(', '), 'logSources');
  } else if (kind === 'services') {
    input(row, 'ID', item.serviceId, 'serviceId'); input(row, '表示名', item.label, 'label');
    input(row, 'Node ID', item.nodeId, 'nodeId');
    select(row, 'Service Type', item.serviceType, 'serviceType', [
      'web_browser', 'email', 'web_application', 'sql_database', 'proxy', 'authentication', 'file', 'logging'].map(id => [id, id]));
    select(row, 'Platform', item.platform, 'platform',
      ['browser', 'email', 'web', 'sql', 'proxy', 'auth', 'file', 'logging'].map(id => [id, id]));
  } else {
    input(row, '接続元Node', item.fromNodeId, 'fromNodeId'); input(row, '接続先Node', item.toNodeId, 'toNodeId');
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
  const svg = byId(id); svg.replaceChildren(); const width = 900; const rowHeight = 130;
  const subnetGroups = network.subnets.map((subnet, index) => ({ subnet, index,
    nodes: network.nodes.filter(node => node.subnetId === subnet.subnetId) }));
  svg.setAttribute('viewBox', `0 0 ${width} ${Math.max(180, subnetGroups.length * rowHeight)}`);
  const positions = new Map();
  subnetGroups.forEach(({ subnet, index, nodes }) => {
    const y = index * rowHeight + 10; const rect = document.createElementNS(svgNs, 'rect');
    rect.setAttribute('x', '10'); rect.setAttribute('y', String(y)); rect.setAttribute('width', '880');
    rect.setAttribute('height', '110'); rect.setAttribute('rx', '12'); rect.setAttribute('class', 'diagram-subnet'); svg.append(rect);
    const title = document.createElementNS(svgNs, 'text'); title.setAttribute('x', '24'); title.setAttribute('y', String(y + 22));
    title.textContent = `${subnet.label} (${subnet.cidr}) / ${subnet.trustBoundaryId}`; svg.append(title);
    nodes.forEach((node, nodeIndex) => { const x = 45 + nodeIndex * Math.max(145, 780 / Math.max(nodes.length, 1));
      positions.set(node.nodeId, { x, y: y + 45 }); const box = document.createElementNS(svgNs, 'rect');
      box.setAttribute('x', String(x)); box.setAttribute('y', String(y + 34)); box.setAttribute('width', '125');
      box.setAttribute('height', '58'); box.setAttribute('rx', '8'); box.setAttribute('class', 'diagram-node'); svg.append(box);
      const line1 = document.createElementNS(svgNs, 'text'); line1.setAttribute('x', String(x + 8)); line1.setAttribute('y', String(y + 56));
      line1.textContent = node.label; svg.append(line1); const line2 = document.createElementNS(svgNs, 'text');
      line2.setAttribute('x', String(x + 8)); line2.setAttribute('y', String(y + 77)); line2.textContent = `${node.ip} / ${node.nodeType}`;
      line2.setAttribute('class', 'diagram-caption'); svg.append(line2); });
  });
  for (const connection of network.connections) { const from = positions.get(connection.fromNodeId); const to = positions.get(connection.toNodeId);
    if (!from || !to) continue; const line = document.createElementNS(svgNs, 'line');
    line.setAttribute('x1', String(from.x + 125)); line.setAttribute('y1', String(from.y + 20));
    line.setAttribute('x2', String(to.x)); line.setAttribute('y2', String(to.y + 20)); line.setAttribute('class', 'diagram-connection');
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

function renderAttackDetails() {
  syncNetworkModel(); const target = byId('attack-details'); const existing = new Map(
    [...target.querySelectorAll('[data-attack-id]')].map(node => [node.dataset.attackId, Object.fromEntries(
      [...node.querySelectorAll('[data-key]')].map(control => [control.dataset.key, control.type === 'checkbox' ? control.checked : control.value]))]));
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
    input(card, '想定効果', saved.expectedEffect ?? `${attack.label}の定義済み効果`, 'expectedEffect'); input(card, 'Notes', saved.notes ?? '', 'notes'); target.append(card); });
}

function collectConfiguration() {
  syncNetworkModel(); const difficulty = Number(byId('manual-difficulty').value); const attacks = [];
  for (const card of document.querySelectorAll('[data-attack-id]')) {
    const get = key => card.querySelector(`[data-key="${key}"]`)?.value ?? '';
    const investigations = [...card.querySelectorAll('[data-key^="investigation:"]:checked')]
      .map(control => control.dataset.key.split(':')[1]);
    attacks.push({ attackId: card.dataset.attackId, order: Number(get('order')),
      occurrenceTime: `${get('occurrenceTime')}:00+09:00`, sourceNodeId: get('sourceNodeId'),
      targetNodeId: get('targetNodeId'), targetServiceId: get('targetServiceId'),
      investigationTypes: investigations, investigationSourceNodeId: get('investigationSourceNodeId'),
      expectedEffect: get('expectedEffect'), notes: get('notes') });
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
    text(article, 'strong', `${item.phase} / attempt ${item.attempt ?? '-'}`); text(article, 'p', `${item.errorCode ?? item.code} — ${item.field}`);
    if (item.schemaName) text(article, 'p', `Schema: ${item.schemaName}`); text(article, 'p', item.reason); text(article, 'p', item.correctionHint); target.append(article); }
}

function showPanel(id) { panels.forEach(panel => { byId(panel).hidden = panel !== id; }); }

function renderPreview() {
  const preview = author.scenarioPreview; if (!preview) return; byId('preview-summary').textContent = preview.incidentSummary;
  byId('preview-target').textContent = preview.targetSystem; byId('preview-difficulty').textContent = preview.difficultyLabel;
  const attacks = byId('preview-attacks'); attacks.replaceChildren(); for (const attack of preview.attacks) {
    const card = document.createElement('article'); card.className = 'builder-card'; text(card, 'h3', `Attack ${attack.order}: ${attack.label}`);
    text(card, 'p', `発生: ${attack.occurrenceTime}`); text(card, 'p', `${attack.source} → ${attack.target} / ${attack.targetService}`);
    text(card, 'p', `調査: ${attack.investigations.map(item => item.label).join('、')}`); attacks.append(card); }
  drawNetwork('preview-network-diagram', preview.network); const detail = byId('preview-author-details'); detail.replaceChildren();
  text(detail, 'p', `Configuration ID: ${preview.configurationId}`); text(detail, 'p', `Mode: ${preview.mode}`);
  byId('preview-regenerate').hidden = !author.canRegenerate;
}

function render() {
  const state = author.currentState;
  if (state === 'MODE_SELECTION') showPanel('mode-panel');
  else if (state === 'MANUAL_CONFIGURATION') showPanel('manual-panel');
  else if (state === 'MAKOTOMARU_CONFIGURATION') showPanel('makotomaru-panel');
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
async function postAuthor(path, body = {}) { const value = await api(path, body); author = value.author; render(); if (author.canCancel) beginPolling(); }

async function chooseMode(mode) { await postAuthor('/api/author/select-mode', { mode }); }
byId('choose-manual').addEventListener('click', () => chooseMode('MANUAL'));
byId('choose-makotomaru').addEventListener('click', () => chooseMode('MAKOTOMARU'));
byId('manual-back').addEventListener('click', () => { author.currentState = 'MODE_SELECTION'; render(); });
byId('makotomaru-back').addEventListener('click', () => { author.currentState = 'MODE_SELECTION'; render(); });
byId('manual-create').addEventListener('click', async () => { byId('manual-errors').replaceChildren(); try {
  await postAuthor('/api/author/manual', { configuration: collectConfiguration() });
  if (author.configurationValidation?.status === 'INVALID') for (const item of author.configurationValidation.errors) text(byId('manual-errors'), 'p', `${item.code}: ${item.reason}`);
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
  networkModel.subnets.push({ subnetId: `subnet-${n}`, label: `Subnet ${n}`, cidr: `10.${n}.0.0/24`, trustBoundaryId: `zone-${n}` }); renderNetworkBuilder(); });
byId('add-node').addEventListener('click', () => { syncNetworkModel(); const n = networkModel.nodes.length + 1;
  networkModel.nodes.push({ nodeId: `node-${n}`, label: `Node ${n}`, nodeType: 'SERVER', os: 'linux', ip: `10.10.0.${n + 50}`, subnetId: networkModel.subnets[0]?.subnetId ?? 'subnet-1', trustBoundaryId: networkModel.subnets[0]?.trustBoundaryId ?? 'zone-1', roles: ['server'], logSources: ['APPLICATION_LOG'] }); renderNetworkBuilder(); });
byId('add-service').addEventListener('click', () => { syncNetworkModel(); const n = networkModel.services.length + 1;
  networkModel.services.push({ serviceId: `service-${n}`, nodeId: networkModel.nodes[0]?.nodeId ?? 'node-1', label: `Service ${n}`, serviceType: 'logging', platform: 'logging' }); renderNetworkBuilder(); });
byId('add-connection').addEventListener('click', () => { syncNetworkModel(); networkModel.connections.push({ fromNodeId: networkModel.nodes[0]?.nodeId ?? '', toNodeId: networkModel.nodes[1]?.nodeId ?? '' }); renderNetworkBuilder(); });
byId('incident-date').addEventListener('change', renderAttackDetails);

try { const value = await api('/api/author/start', {}); token = value.token; bootstrap = value.bootstrap;
  author = value.author; networkModel = structuredClone(bootstrap.defaultNetwork); const today = new Date().toISOString().slice(0, 10);
  byId('incident-date').value = today; byId('organization-name').value = '青葉ソリューションズ'; byId('victim-system').value = '社内ポータル';
  byId('accused-role').value = 'システム利用者'; byId('suspicion-reason').value = '被告人の利用端末に割り当てられたIPアドレスが記録に含まれていたため。';
  renderAttackOptions(); document.querySelector('input[name="attack"][value="reflected_xss"]').checked = true;
  renderNetworkBuilder(); renderAttackDetails(); render();
} catch (error) { byId('manual-errors').textContent = error.message; }
