// 2026-09-24 修正前: 制作UIの外観を保ちながら攻撃・舞台の入力方式へ移行。旧コードは履歴としてコメント保存。
// public/author.js
// let token = null;
// let bootstrap = null;
// let author = null;
// let polling = null;
// let networkModel = null;
// let activeNetworkPresetId = null;
// let initializationReady = false;
// let entryView = 'SPLASH';
// let savedGameItems = null;
// let savedGamesError = '';
// let manualStep = 0;
// let lastOverallStep = 0;
// const manualStepNames = ['事件情報', '攻撃手法', '攻撃内容・調査', 'Subnet',
//   'Node', 'Service', 'Connection', '構成図確認'];
// const itemIndexes = { 'attack-details': 0, subnet: 0, node: 0, service: 0, connection: 0 };
// const initializationHelp = 'サーバーを再起動（npm start）して画面を再読み込みしてください。';
// const byId = id => document.getElementById(id);
// const panels = ['splash-panel', 'activity-panel', 'court-entry-panel', 'mode-panel',
//   'help-panel', 'settings-panel',
//   'manual-panel', 'makotomaru-panel', 'preview-panel', 'generation-panel',
//   'ready-panel', 'failure-panel', 'shutdown-panel'];
// const svgNs = 'http://www.w3.org/2000/svg';
// const settingsKey = 'incident-craft-settings-v1';
// const defaultSettings = { textSize: 'STANDARD', motion: 'STANDARD' };
//
// function readSettings() {
//   try {
//     const value = JSON.parse(localStorage.getItem(settingsKey) ?? 'null');
//     return { textSize: ['STANDARD', 'LARGE'].includes(value?.textSize)
//       ? value.textSize : defaultSettings.textSize,
//     motion: ['STANDARD', 'REDUCED'].includes(value?.motion)
//       ? value.motion : defaultSettings.motion };
//   } catch { return { ...defaultSettings }; }
// }
//
// function applySettings(settings, save = false) {
//   const body = document.querySelector('body');
//   body.dataset.textSize = settings.textSize;
//   body.dataset.motion = settings.motion;
//   if (save) {
//     try { localStorage.setItem(settingsKey, JSON.stringify(settings)); }
//     catch { byId('settings-status').textContent = 'ブラウザに設定を保存できませんでした。'; return; }
//     byId('settings-status').textContent = '設定をこのブラウザに保存しました。';
//   }
// }
//
// function setInitializationState(ready, message = '') {
//   initializationReady = ready;
//   const notice = byId('initialization-status');
//   notice.textContent = message; notice.hidden = ready;
//   for (const id of ['choose-manual', 'choose-makotomaru', 'manual-create', 'makotomaru-create']) {
//     byId(id).disabled = !ready || Boolean(author?.canCancel);
//   }
// }
//
// function requireInitialized() {
//   if (!initializationReady) throw new Error(`初期設定の読み込みが完了していません。${initializationHelp}`);
// }
//
// function requireObject(value, field) {
//   if (!value || typeof value !== 'object' || Array.isArray(value)) {
//     throw new Error(`初期設定の${field}が取得できないか、形式が不正です。${initializationHelp}`);
//   }
// }
//
// function requireArray(value, field) {
//   if (!Array.isArray(value)) {
//     throw new Error(`初期設定の${field}が配列ではありません。${initializationHelp}`);
//   }
// }
//
// function requireNetwork(value) {
//   requireObject(value, 'network');
//   for (const kind of ['subnets', 'nodes', 'services', 'connections']) {
//     requireArray(value[kind], `network.${kind}`);
//     value[kind].forEach(item => requireObject(item, `network.${kind}の項目`));
//   }
//   for (const node of value.nodes) {
//     requireArray(node.roles, 'network.nodes.roles');
//     requireArray(node.logSources, 'network.nodes.logSources');
//   }
// }
//
// function readInitialConfiguration(value) {
//   requireObject(value, 'bootstrap');
//   const preset = value.defaultManualConfiguration;
//   requireObject(preset, 'defaultManualConfiguration');
//   requireNetwork(preset.network);
//   requireObject(preset.incidentContext, 'incidentContext');
//   requireArray(preset.attacks, 'attacks');
//   for (const key of ['attacks', 'investigationTypes', 'nodeTypes']) requireArray(value[key], key);
//   if (value.networkPresets !== undefined) requireArray(value.networkPresets, 'networkPresets');
//   if (!preset.attacks.length || ![1, 2, 3].includes(preset.difficulty)) {
//     throw new Error(`初期設定の攻撃または難易度が不正です。${initializationHelp}`);
//   }
//   for (const attack of preset.attacks) {
//     requireObject(attack, 'attacksの項目');
//     requireArray(attack.investigationTypes, 'attacks.investigationTypes');
//     if (typeof attack.occurrenceTime !== 'string' || typeof attack.evidenceAnswer !== 'string'
//       || !value.attacks.some(item => item.id === attack.attackId)) {
//       throw new Error(`初期設定の攻撃・発生日時・証拠の答えが取得できません。${initializationHelp}`);
//     }
//   }
//   return preset;
// }
//
// function requireRenderedConfiguration() {
//   requireNetwork(networkModel);
//   for (const kind of ['subnets', 'nodes', 'services', 'connections']) {
//     const rows = document.querySelectorAll(`[data-network-kind="${kind}"]`);
//     if (rows.length !== networkModel[kind].length) {
//       throw new Error(`Network Builderの${kind}が正しく表示されていないため送信できません。${initializationHelp}`);
//     }
//   }
//   const selected = [...document.querySelectorAll('input[name="attack"]:checked')].map(item => item.value);
//   const cards = [...document.querySelectorAll('[data-attack-id]')];
//   if (cards.length !== selected.length || selected.some(id => !cards.some(card => card.dataset.attackId === id))) {
//     throw new Error(`攻撃の詳細が正しく表示されていないため送信できません。${initializationHelp}`);
//   }
// }
//
// async function api(path, body = null, method = null) {
//   const response = await fetch(path, { method: method ?? (body == null ? 'GET' : 'POST'),
//     headers: { ...(body == null ? {} : { 'Content-Type': 'application/json' }),
//       ...(token ? { Authorization: `Bearer ${token}` } : {}) },
//     ...(body == null ? {} : { body: JSON.stringify(body) }) });
//   const value = await response.json();
//   if (!response.ok) throw new Error(value.error?.message ?? '処理に失敗しました。');
//   return value;
// }
//
// function text(parent, tag, value, className = '') {
//   const node = document.createElement(tag); if (className) node.className = className;
//   node.textContent = value; parent.append(node); return node;
// }
//
// function input(parent, label, value, key, type = 'text') {
//   const wrapper = document.createElement('label'); wrapper.textContent = label;
//   const control = document.createElement('input'); control.type = type; control.value = value ?? '';
//   control.dataset.key = key; wrapper.append(control); parent.append(wrapper); return control;
// }
//
// function select(parent, label, value, key, options) {
//   const wrapper = document.createElement('label'); wrapper.textContent = label;
//   const control = document.createElement('select'); control.dataset.key = key;
//   if (value && !options.some(([id]) => id === value)) {
//     options = [[value, `${value}（現在の構成にありません）`], ...options];
//   }
//   for (const [id, title] of options) { const option = document.createElement('option');
//     option.value = id; option.textContent = title; option.selected = id === value; control.append(option); }
//   wrapper.append(control); parent.append(wrapper); return control;
// }
//
// function multiSelect(parent, label, values, key, options) {
//   const wrapper = document.createElement('label'); wrapper.textContent = label;
//   const control = document.createElement('select'); control.dataset.key = key;
//   control.multiple = true; control.size = Math.min(5, options.length);
//   const selected = new Set(values);
//   for (const [id, title] of options) { const option = document.createElement('option');
//     option.value = id; option.textContent = title; option.selected = selected.has(id); control.append(option); }
//   wrapper.append(control); parent.append(wrapper); return control;
// }
//
// function removeButton(parent, collection, item) {
//   const button = document.createElement('button'); button.type = 'button'; button.className = 'danger-link';
//   button.textContent = '削除'; button.addEventListener('click', () => {
//     syncNetworkModel();
//     collection.splice(collection.indexOf(item), 1); renderNetworkBuilder(); renderAttackDetails();
//   }); parent.append(button);
// }
//
// function updateItemPager(kind) {
//   const target = byId(kind === 'attack-details' ? kind : `${kind}-rows`);
//   const rows = [...target.querySelectorAll('article')];
//   itemIndexes[kind] = Math.min(itemIndexes[kind], Math.max(0, rows.length - 1));
//   rows.forEach((row, index) => { row.hidden = index !== itemIndexes[kind]; });
//   byId(`${kind}-position`).textContent = rows.length
//     ? `${itemIndexes[kind] + 1} / ${rows.length}` : '0 / 0';
//   byId(`${kind}-previous`).disabled = itemIndexes[kind] === 0;
//   byId(`${kind}-next`).disabled = !rows.length || itemIndexes[kind] === rows.length - 1;
// }
//
// function resetManualScroll() { byId('manual-step-content').scrollTop = 0; }
//
// function showManualStep(index) {
//   if (index < 0 || index >= manualStepNames.length) return;
//   if (networkModel && manualStep >= 3 && manualStep <= 6) {
//     syncNetworkModel(); renderNetworkBuilder(); renderAttackDetails();
//   }
//   manualStep = index;
//   for (const step of document.querySelectorAll('[data-manual-step]')) {
//     step.hidden = Number(step.dataset.manualStep) !== index;
//   }
//   for (const label of document.querySelectorAll('[data-manual-step-label]')) {
//     const number = Number(label.dataset.manualStepLabel);
//     label.className = number === index ? 'current' : number < index ? 'complete' : '';
//     label.setAttribute('aria-current', number === index ? 'step' : 'false');
//   }
//   byId('manual-step-count').textContent = `${index + 1} / ${manualStepNames.length}　${manualStepNames[index]}`;
//   byId('manual-previous').disabled = index === 0;
//   byId('manual-next').hidden = index === manualStepNames.length - 1;
//   byId('manual-create').hidden = index !== manualStepNames.length - 1;
//   byId('manual-errors').replaceChildren();
//   resetManualScroll();
//   if (index === 7) {
//     byId('manual-network-summary').textContent =
//       `${networkModel.subnets.length} Subnets / ${networkModel.nodes.length} Nodes / `
//       + `${networkModel.services.length} Services / ${networkModel.connections.length} Connections`;
//     drawNetwork('manual-network-diagram', networkModel);
//   }
//   renderOverallProgress();
// }
//
// function splitList(value) { return value.split(',').map(item => item.trim()).filter(Boolean); }
//
// function syncNetworkModel() {
//   requireNetwork(networkModel);
//   for (const row of document.querySelectorAll('[data-network-kind]')) {
//     const kind = row.dataset.networkKind; const index = Number(row.dataset.index);
//     const item = networkModel[kind][index]; if (!item) continue;
//     for (const control of row.querySelectorAll('[data-key]')) {
//       const value = control.multiple ? (() => {
//         const selected = [...control.selectedOptions].map(option => option.value);
//         const previous = Array.isArray(item[control.dataset.key]) ? item[control.dataset.key] : [];
//         return [...previous.filter(id => selected.includes(id)),
//           ...selected.filter(id => !previous.includes(id))];
//       })()
//         : control.dataset.key === 'roles' ? splitList(control.value) : control.value;
//       item[control.dataset.key] = value;
//     }
//   }
// }
//
// function networkRow(kind, item, index) {
//   const row = document.createElement('article'); row.className = 'builder-card compact-builder';
//   row.dataset.networkKind = kind; row.dataset.index = String(index);
//   if (kind === 'subnets') {
//     input(row, 'ID', item.subnetId, 'subnetId'); input(row, '表示名', item.label, 'label');
//     input(row, 'CIDR', item.cidr, 'cidr'); input(row, 'Trust Boundary', item.trustBoundaryId, 'trustBoundaryId');
//   } else if (kind === 'nodes') {
//     input(row, 'ID', item.nodeId, 'nodeId'); input(row, '表示名', item.label, 'label');
//     select(row, 'Node Type', item.nodeType, 'nodeType', bootstrap.nodeTypes.map(id => [id, id]));
//     select(row, 'OS', item.os, 'os', ['windows', 'linux', 'macos', 'network', 'other'].map(id => [id, id]));
//     input(row, 'IP', item.ip, 'ip'); select(row, 'Subnet', item.subnetId, 'subnetId',
//       optionPairs(networkModel.subnets, 'subnetId', 'label'));
//     input(row, 'Trust Boundary', item.trustBoundaryId, 'trustBoundaryId');
//     input(row, 'Roles（カンマ区切り）', item.roles.join(', '), 'roles');
//     multiSelect(row, 'Log Sources', item.logSources, 'logSources',
//       bootstrap.investigationTypes.map(value => [value.id, value.label]));
//   } else if (kind === 'services') {
//     input(row, 'ID', item.serviceId, 'serviceId'); input(row, '表示名', item.label, 'label');
//     select(row, 'Node', item.nodeId, 'nodeId', optionPairs(networkModel.nodes, 'nodeId', 'label'));
//     select(row, 'Service Type', item.serviceType, 'serviceType', [
// // 2026-09-20 修正前: SSHとローカル実行環境を編集可能にする
// //       'web_browser', 'email', 'web_application', 'sql_database', 'proxy', 'authentication', 'file', 'logging'].map(id => [id, id]));
// // 2026-09-20 修正後: SSHとローカル実行環境を編集可能にする
//       'web_browser', 'email', 'web_application', 'sql_database', 'proxy', 'authentication', 'file', 'logging', 'remote_access', 'local_execution'].map(id => [id, id]));
//     select(row, 'Platform', item.platform, 'platform',
// // 2026-09-20 修正前: 実行環境のOSを保持
// //       ['browser', 'email', 'web', 'sql', 'proxy', 'auth', 'file', 'logging'].map(id => [id, id]));
// // 2026-09-20 修正後: 実行環境のOSを保持
//       ['browser', 'email', 'web', 'sql', 'proxy', 'auth', 'file', 'logging', 'ssh', 'linux', 'windows'].map(id => [id, id]));
//   } else {
//     select(row, '接続元Node', item.fromNodeId, 'fromNodeId', optionPairs(networkModel.nodes, 'nodeId', 'label'));
//     select(row, '接続先Node', item.toNodeId, 'toNodeId', optionPairs(networkModel.nodes, 'nodeId', 'label'));
//   }
//   removeButton(row, networkModel[kind], item); return row;
// }
//
// function renderNetworkBuilder() {
//   for (const kind of ['subnets', 'nodes', 'services', 'connections']) {
//     const target = byId(`${kind.slice(0, -1)}-rows`); target.replaceChildren();
//     networkModel[kind].forEach((item, index) => target.append(networkRow(kind, item, index)));
//     updateItemPager(kind.slice(0, -1));
//   }
//   drawNetwork('manual-network-diagram', networkModel);
// }
//
// function renderNetworkPresetPicker() {
//   const control = byId('network-preset'); control.replaceChildren();
//   for (const preset of bootstrap.networkPresets ?? []) {
//     const option = document.createElement('option'); option.value = preset.id;
//     option.textContent = preset.label; option.selected = preset.id === activeNetworkPresetId;
//     control.append(option);
//   }
//   const selected = bootstrap.networkPresets?.find(item => item.id === control.value);
//   byId('network-preset-description').textContent = selected?.description ??
//     '利用できる構成テンプレートはありません。';
//   byId('apply-network-preset').disabled = !selected;
// }
//
// function drawNetwork(id, network) {
//   const svg = byId(id); svg.replaceChildren(); const rowHeight = 165;
//   const subnetGroups = network.subnets.map((subnet, index) => ({ subnet, index,
//     nodes: network.nodes.filter(node => node.subnetId === subnet.subnetId) }));
//   const width = Math.max(900, 70 + Math.max(1, ...subnetGroups.map(group => group.nodes.length)) * 145);
//   svg.setAttribute('viewBox', `0 0 ${width} ${Math.max(180, subnetGroups.length * rowHeight)}`);
//   const positions = new Map();
//   subnetGroups.forEach(({ subnet, index, nodes }) => {
//     const y = index * rowHeight + 10; const rect = document.createElementNS(svgNs, 'rect');
//     rect.setAttribute('x', '10'); rect.setAttribute('y', String(y)); rect.setAttribute('width', String(width - 20));
//     rect.setAttribute('height', '145'); rect.setAttribute('rx', '12'); rect.setAttribute('class', 'diagram-subnet'); svg.append(rect);
//     const title = document.createElementNS(svgNs, 'text'); title.setAttribute('x', '24'); title.setAttribute('y', String(y + 22));
//     title.textContent = `${subnet.label} (${subnet.cidr}) / ${subnet.trustBoundaryId}`; svg.append(title);
//     nodes.forEach((node, nodeIndex) => { const x = 45 + nodeIndex * Math.max(145, (width - 120) / Math.max(nodes.length, 1));
//       positions.set(node.nodeId, { x, y: y + 45 }); const box = document.createElementNS(svgNs, 'rect');
//       box.setAttribute('x', String(x)); box.setAttribute('y', String(y + 34)); box.setAttribute('width', '125');
//       box.setAttribute('height', '92'); box.setAttribute('rx', '8'); box.setAttribute('class', 'diagram-node'); svg.append(box);
//       const line1 = document.createElementNS(svgNs, 'text'); line1.setAttribute('x', String(x + 8)); line1.setAttribute('y', String(y + 56));
//       line1.textContent = node.label; svg.append(line1); const line2 = document.createElementNS(svgNs, 'text');
//       line2.setAttribute('x', String(x + 8)); line2.setAttribute('y', String(y + 77)); line2.textContent = `${node.ip} / ${node.nodeType}`;
//       line2.setAttribute('class', 'diagram-caption'); svg.append(line2);
//       const line3 = document.createElementNS(svgNs, 'text'); line3.setAttribute('x', String(x + 8));
//       line3.setAttribute('y', String(y + 96)); line3.setAttribute('class', 'diagram-caption');
//       line3.textContent = `Role: ${node.roles.join(', ')}`; svg.append(line3);
//       const serviceLabels = network.services.filter(service => service.nodeId === node.nodeId)
//         .map(service => `${service.label} [${service.serviceType}]`);
//       const line4 = document.createElementNS(svgNs, 'text'); line4.setAttribute('x', String(x + 8));
//       line4.setAttribute('y', String(y + 114)); line4.setAttribute('class', 'diagram-caption');
//       line4.textContent = serviceLabels.length ? `Service: ${serviceLabels.join(', ')}` : 'Service: なし';
//       svg.append(line4); });
//   });
//   for (const connection of network.connections) { const from = positions.get(connection.fromNodeId); const to = positions.get(connection.toNodeId);
//     if (!from || !to) continue; const line = document.createElementNS(svgNs, 'line');
//     line.setAttribute('x1', String(from.x + 125)); line.setAttribute('y1', String(from.y + 35));
//     line.setAttribute('x2', String(to.x)); line.setAttribute('y2', String(to.y + 35)); line.setAttribute('class', 'diagram-connection');
//     svg.insertBefore(line, svg.firstChild); }
// }
//
// // 2026-09-20 修正前: 段階を任意に絞り込み、全段階を必須にせず1～6件選択
// // function renderAttackOptions() {
// //   const target = byId('attack-options'); target.replaceChildren();
// //   for (const attack of bootstrap.attacks) { const label = document.createElement('label'); label.className = 'choice-card';
// //     const control = document.createElement('input'); control.type = 'checkbox'; control.name = 'attack'; control.value = attack.id;
// //     control.addEventListener('change', () => { const selected = [...document.querySelectorAll('input[name="attack"]:checked')];
// //       if (selected.length > 3) { control.checked = false; byId('manual-errors').textContent = '攻撃手法は最大3つです。'; }
// //       renderAttackDetails(); }); label.append(control); text(label, 'strong', attack.label); target.append(label); }
// // }
// //
// // 2026-09-20 修正後: 段階を任意に絞り込み、全段階を必須にせず1～6件選択
// function renderAttackOptions() {
//   const target = byId('attack-options'); target.replaceChildren(); target.className = 'attack-browser';
//   const filter = select(target, '攻撃の段階（どの段階からでも選べます）', '', 'stageFilter',
//     [['', 'すべて'], ...(bootstrap.attackStages ?? []).map(stage => [stage.id, stage.label])]);
//   const choices = document.createElement('div'); choices.className = 'choice-grid'; target.append(choices);
//   const status = text(target, 'p', '', 'step-hint'); status.id = 'attack-selection-status';
//   const refresh = () => {
//     for (const card of choices.children) card.hidden = Boolean(filter.value)
//       && !bootstrap.attacks.find(attack => attack.id === card.dataset.choiceId)?.stages?.includes(filter.value);
//     const ids = [...document.querySelectorAll('input[name="attack"]:checked')].map(input => input.value);
//     status.textContent = ids.length + ' / ' + (bootstrap.attackSelectionLimit ?? 6)
//       + '件を選択：' + ids.map(id => bootstrap.attacks.find(a => a.id === id).label).join('、');
//   };
//   for (const attack of bootstrap.attacks) {
//     const label = document.createElement('label'); label.className = 'choice-card'; label.dataset.choiceId = attack.id;
//     const control = document.createElement('input'); control.type = 'checkbox'; control.name = 'attack'; control.value = attack.id;
//     control.addEventListener('change', () => {
//       const count = document.querySelectorAll('input[name="attack"]:checked').length;
//       if (count > (bootstrap.attackSelectionLimit ?? 6)) {
//         control.checked = false; byId('manual-errors').textContent = '攻撃手法は最大' + (bootstrap.attackSelectionLimit ?? 6) + 'つです。';
//       } else byId('manual-errors').textContent = '';
//       renderAttackDetails(); refresh();
//     });
//     label.append(control); text(label, 'strong', attack.label);
//     text(label, 'small', (attack.stages ?? []).map(id => bootstrap.attackStages?.find(s => s.id === id)?.label ?? id).join('・'));
//     choices.append(label);
//   }
//   filter.addEventListener('change', refresh); refresh();
// }
//
// // 2026-09-20: 選択順で初期時刻を作る。カタログ位置による分の桁あふれを防ぐ。
// function initialAttackTime(index) {
//   const minute = 9 * 60 + 10 + index * 8;
//   return (byId('incident-date').value || '2026-01-15') + 'T'
//     + String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
// }
//
// // 2026-09-20: 途中解除後の追加でも、保存済み日時と同じ初期時刻を作らない。
// function nextAttackTime(index, existing) {
//   const latest = [...existing.values()].map(item => item.occurrenceTime?.slice(0, 16))
//     .filter(value => value && value.startsWith(byId('incident-date').value)).sort().at(-1);
//   if (!latest) return initialAttackTime(index);
//   const instant = new Date(latest + ':00Z');
//   return Number.isFinite(instant.getTime())
//     ? new Date(instant.getTime() + 8 * 60 * 1000).toISOString().slice(0, 16) : initialAttackTime(index);
// }
//
// function optionPairs(items, id, label) { return items.map(item => [item[id], item[label]]); }
//
// function renderAttackDetails(initialAttacks = []) {
//   // 初回のみBackendのプリセットを使い、その後の再描画では利用者の入力を優先する。
//   const defaults = initialAttacks.map(attack => [attack.attackId, {
//     ...attack, order: String(attack.order), occurrenceTime: attack.occurrenceTime.slice(0, 16),
//     ...Object.fromEntries(bootstrap.investigationTypes.map(({ id }) =>
//       [`investigation:${id}`, attack.investigationTypes.includes(id)])),
//   }]);
//   syncNetworkModel(); const target = byId('attack-details'); const existing = new Map(
//     [...defaults, ...[...target.querySelectorAll('[data-attack-id]')].map(node => [node.dataset.attackId, Object.fromEntries(
//       [...node.querySelectorAll('[data-key]')].map(control => [control.dataset.key, control.type === 'checkbox' ? control.checked : control.value]))])]);
// // 2026-09-20 修正前: 既存の選択順を保持し、途中解除後は1から連番へ振り直す
// //   target.replaceChildren(); const selected = [...document.querySelectorAll('input[name="attack"]:checked')].map(item => item.value);
// // 2026-09-20 修正後: 既存の選択順を保持し、途中解除後は1から連番へ振り直す
//   const checked = [...document.querySelectorAll('input[name="attack"]:checked')].map(item => item.value);
//   const retained = [...existing.keys()].filter(id => checked.includes(id))
//     .sort((a, b) => Number(existing.get(a).order) - Number(existing.get(b).order));
//   const selected = [...retained, ...checked.filter(id => !retained.includes(id))];
//   target.replaceChildren();
//   const nodes = optionPairs(networkModel.nodes, 'nodeId', 'label'); const services = optionPairs(networkModel.services, 'serviceId', 'label');
//   const activePreset = bootstrap.networkPresets?.find(item => item.id === activeNetworkPresetId);
//   selected.forEach((attackId, index) => { const attack = bootstrap.attacks.find(item => item.id === attackId);
//     const hint = activePreset?.attackDefaults?.find(item => item.attackId === attackId) ?? {};
//     const stored = existing.get(attackId);
// // 2026-09-20 修正前: 新規選択の時刻を選択順から作り、編集済みの値は維持
// //     const saved = stored ?? { ...hint, order: String(index + 1),
// //       occurrenceTime: hint.occurrenceTime
// //         ? `${byId('incident-date').value || hint.occurrenceTime.slice(0, 10)}${hint.occurrenceTime.slice(10, 16)}`
// //         : '' };
// //
// // 2026-09-20 修正後: 新規選択の時刻を選択順から作り、編集済みの値は維持
//     const saved = stored ?? { evidenceAnswer: attack.authoring?.evidenceAnswer ?? '', ...hint,
//       order: String(index + 1), occurrenceTime: nextAttackTime(index, existing) };
//     const card = document.createElement('article'); card.className = 'builder-card'; card.dataset.attackId = attackId;
//     text(card, 'h3', `Attack ${index + 1}: ${attack.label}`);
// // 2026-09-20 修正前: 選択数に応じた順番変更と開始条件・対応構成の表示
// //     select(card, 'Attack Order', saved.order ?? String(index + 1), 'order', ['1', '2', '3'].map(value => [value, value]));
// // 2026-09-20 修正後: 選択数に応じた順番変更と開始条件・対応構成の表示
//     text(card, 'p', attack.description ?? '', 'step-hint');
//     const compatiblePresets = (bootstrap.networkPresets ?? []).filter(preset => preset.attackDefaults.some(a => a.attackId === attackId));
//     text(card, 'p', '対応テンプレート：' + compatiblePresets.map(preset => preset.label).join(' / '), 'step-hint');
//     const conditions = document.createElement('details'); text(conditions, 'summary', '成立に必要な条件（前段がない場合は開始時点の設定）');
//     for (const condition of attack.startingConditions ?? []) text(conditions, 'p', condition);
//     card.append(conditions);
//     const orderControl = select(card, 'Attack Order', String(index + 1), 'order', selected.map((_, i) => [String(i + 1), String(i + 1)]));
//     orderControl.addEventListener('change', () => {
//       const cards = [...target.querySelectorAll('[data-attack-id]')];
//       cards.splice(cards.indexOf(card), 1); cards.splice(Number(orderControl.value) - 1, 0, card);
//       cards.forEach((item, i) => { item.querySelector('[data-key="order"]').value = String(i + 1); });
//       renderAttackDetails();
//       byId('manual-errors').textContent = '順番を変更しました。発生日時もこの順番になるよう確認してください。';
//     });
//     const occurrenceTime = saved.occurrenceTime?.length > 16
//       ? saved.occurrenceTime.slice(0, 16) : saved.occurrenceTime;
//     input(card, '発生日時', occurrenceTime ?? `${byId('incident-date').value || '2026-01-15'}T09:${String(10 + index * 8).padStart(2, '0')}`, 'occurrenceTime', 'datetime-local');
// // 2026-09-20 修正前: 対応しない構成では先頭Nodeを暗黙に選ばず、不足する指定を明示
// //     select(card, 'Source Node', saved.sourceNodeId ?? '', 'sourceNodeId', nodes);
// //     select(card, 'Target Node', saved.targetNodeId ?? '', 'targetNodeId', nodes);
// //     select(card, 'Target Service', saved.targetServiceId ?? '', 'targetServiceId', services);
// //     select(card, 'Investigation Source', saved.investigationSourceNodeId ?? '', 'investigationSourceNodeId', nodes);
// // 2026-09-20 修正後: 対応しない構成では先頭Nodeを暗黙に選ばず、不足する指定を明示
//     select(card, 'Source Node', saved.sourceNodeId ?? '', 'sourceNodeId', [['', '選択してください'], ...nodes]);
//     select(card, 'Target Node', saved.targetNodeId ?? '', 'targetNodeId', [['', '選択してください'], ...nodes]);
//     select(card, 'Target Service', saved.targetServiceId ?? '', 'targetServiceId', [['', '選択してください'], ...services]);
//     select(card, 'Investigation Source', saved.investigationSourceNodeId ?? '', 'investigationSourceNodeId', [['', '選択してください'], ...nodes]);
//     const group = document.createElement('fieldset'); text(group, 'legend', '調査方法');
//     attack.supportedInvestigationTypes.forEach((type, typeIndex) => { const label = document.createElement('label');
//       const box = document.createElement('input'); box.type = 'checkbox'; box.dataset.key = `investigation:${type}`;
// // 2026-09-20 修正前: カタログ先頭の調査方法ではなく攻撃定義の既定値を使う
// //       box.checked = saved[`investigation:${type}`] ?? typeIndex === 0; label.append(box);
// // 2026-09-20 修正後: カタログ先頭の調査方法ではなく攻撃定義の既定値を使う
//       box.checked = saved[`investigation:${type}`] ?? (saved.investigationTypes
//         ? saved.investigationTypes.includes(type) : type === attack.authoring?.preferredInvestigationType); label.append(box);
//       label.append(document.createTextNode(bootstrap.investigationTypes.find(item => item.id === type).label)); group.append(label); }); card.append(group);
//     const evidenceAnswer = input(card, '証拠から導く答え', saved.evidenceAnswer ?? '',
//       'evidenceAnswer');
//     evidenceAnswer.required = true;
//     evidenceAnswer.placeholder = '選択した記録から確認できる具体的な事実';
//     select(card, '想定効果', saved.expectedEffect ?? attack.expectedEffects[0].label,
//       'expectedEffect', attack.expectedEffects.map(effect => [effect.label, effect.label]));
//     input(card, 'Notes', saved.notes ?? '', 'notes'); target.append(card); });
//   const status = byId('attack-selection-status');
//   if (status) status.textContent = selected.length + ' / ' + (bootstrap.attackSelectionLimit ?? 6)
//     + '件を選択：' + selected.map(id => bootstrap.attacks.find(a => a.id === id).label).join('、');
//   updateItemPager('attack-details');
// }
//
// function collectConfiguration() {
//   requireInitialized(); requireRenderedConfiguration();
//   syncNetworkModel(); const difficulty = Number(byId('manual-difficulty').value); const attacks = [];
//   for (const card of document.querySelectorAll('[data-attack-id]')) {
//     const get = key => card.querySelector(`[data-key="${key}"]`)?.value ?? '';
//     const investigations = [...card.querySelectorAll('[data-key^="investigation:"]:checked')]
//       .map(control => control.dataset.key.split(':')[1]);
//     attacks.push({ attackId: card.dataset.attackId, order: Number(get('order')),
//       occurrenceTime: get('occurrenceTime'), sourceNodeId: get('sourceNodeId'),
//       targetNodeId: get('targetNodeId'), targetServiceId: get('targetServiceId'),
//       investigationTypes: investigations, investigationSourceNodeId: get('investigationSourceNodeId'),
//       evidenceAnswer: get('evidenceAnswer'), expectedEffect: get('expectedEffect'), notes: get('notes') });
//   }
//   return { schemaVersion: '1.0', configurationId: `configuration_${crypto.randomUUID().replaceAll('-', '')}`,
//     mode: 'MANUAL', difficulty, evidenceCount: difficulty, network: structuredClone(networkModel), attacks,
//     incidentContext: { incidentDate: byId('incident-date').value,
//       organizationName: byId('organization-name').value, victimSystem: byId('victim-system').value,
//       accusedRole: byId('accused-role').value, initialSuspicionReason: byId('suspicion-reason').value } };
// }
//
// function renderProgress(targetId) {
//   const target = byId(targetId); target.replaceChildren(); for (const item of author.progress) {
//     const suffix = item.status === 'COMPLETE' ? '✓' : item.status === 'RUNNING' ? '実行中…'
//       : item.status === 'FAILED' ? '失敗' : item.status === 'SKIPPED' ? '不要' : '待機中';
//     text(target, 'li', `${item.label}　${suffix}${item.attempt ? ` ${item.attempt} / ${author.maxAttempts}` : ''}`, item.status.toLowerCase()); }
// }
//
// function renderDetails(targetId) {
//   const target = byId(targetId); target.replaceChildren(); if (!author.developerDetails.length) text(target, 'p', '詳細情報はありません。');
//   for (const item of author.developerDetails) { const article = document.createElement('article'); article.className = 'card';
//     text(article, 'strong', `${item.phase} / attempt ${item.attempt ?? '-'}`);
//     text(article, 'p', `${item.errorCode ?? item.code}${item.field ? ` — ${item.field}` : ''}`);
//     if (item.schemaName) text(article, 'p', `Schema: ${item.schemaName}`);
//     if (item.exitCode !== null && item.exitCode !== undefined) text(article, 'p', `Exit code: ${item.exitCode}`);
//     if (item.httpStatus !== null && item.httpStatus !== undefined) text(article, 'p', `HTTP status: ${item.httpStatus}`);
//     if (item.retryable !== undefined) text(article, 'p', `Retryable: ${item.retryable}`);
//     if (item.receivedType) text(article, 'p', `Received type: ${item.receivedType}`);
//     if (item.length !== null && item.length !== undefined) text(article, 'p', `Length: ${item.length}`);
//     if (item.expectedMinLength !== null && item.expectedMinLength !== undefined) text(article, 'p', `Expected minLength: ${item.expectedMinLength}`);
//     if (item.expectedMaxLength !== null && item.expectedMaxLength !== undefined) text(article, 'p', `Expected maxLength: ${item.expectedMaxLength}`);
//     if (item.expectedPattern) text(article, 'p', `Expected pattern: ${item.expectedPattern}`);
//     if (item.expectedFormat) text(article, 'p', `Expected format: ${item.expectedFormat}`);
//     if (item.reason) text(article, 'p', item.reason);
//     if (item.correctionHint) text(article, 'p', item.correctionHint);
//     target.append(article); }
// }
//
// function showPanel(id) { panels.forEach(panel => { byId(panel).hidden = panel !== id; }); }
//
// function savedDate(value) {
//   const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
//   return match ? `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}` : '保存日時不明';
// }
//
// function renderSavedGames() {
//   const list = byId('saved-game-list');
//   const empty = byId('court-empty');
//   const status = byId('saved-games-status');
//   list.replaceChildren();
//   if (savedGameItems === null) {
//     empty.hidden = true; status.textContent = savedGamesError || '保存したゲームを読み込んでいます…';
//     return;
//   }
//   if (!savedGameItems.length) {
//     empty.hidden = false;
//     status.textContent = savedGamesError || '保存したゲームはありません。';
//     return;
//   }
//   empty.hidden = true;
//   status.textContent = `${savedGameItems.length}件のゲームが保存されています。`;
//   for (const game of savedGameItems) {
//     const card = document.createElement('article'); card.className = 'saved-game-card';
//     const heading = document.createElement('div'); heading.className = 'saved-game-card-heading';
//     const headingCopy = document.createElement('div');
//     text(headingCopy, 'p', `SAVED CASE · ${savedDate(game.savedAt)}`, 'mode-label');
//     text(headingCopy, 'h2', game.title);
//     const difficulty = text(heading, 'span', `${'★'.repeat(game.difficulty)}`, 'saved-game-difficulty');
//     difficulty.setAttribute('aria-label', `難易度 ${game.difficulty}`);
//     heading.insertBefore(headingCopy, difficulty);
//     card.append(heading);
//     text(card, 'p', game.summary, 'saved-game-summary');
//     const facts = document.createElement('p'); facts.className = 'saved-game-facts';
//     facts.textContent = `対象：${game.targetSystem}　攻撃：${game.attacks.join('、')}`; card.append(facts);
//     const actions = document.createElement('div'); actions.className = 'saved-game-actions';
//     const play = document.createElement('a'); play.className = 'button-link';
//     play.href = `/?saved=${encodeURIComponent(game.gameId)}`; play.textContent = 'このゲームで遊ぶ';
//     const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger-link';
//     remove.textContent = '削除'; remove.dataset.gameId = game.gameId;
//     remove.addEventListener('click', async () => {
//       if (!confirm(`「${game.title}」を削除しますか？`)) return;
//       remove.disabled = true; status.textContent = 'ゲームを削除しています…';
//       try {
//         await api(`/api/author/games/${encodeURIComponent(game.gameId)}`, null, 'DELETE');
//         savedGameItems = savedGameItems.filter(item => item.gameId !== game.gameId);
//         savedGamesError = ''; renderSavedGames();
//       } catch (error) { remove.disabled = false; status.textContent = error.message; }
//     });
//     actions.append(play, remove); card.append(actions); list.append(card);
//   }
// }
//
// async function loadSavedGames() {
//   savedGameItems = null; savedGamesError = ''; renderSavedGames();
//   try { savedGameItems = (await api('/api/author/games')).games ?? []; }
//   catch (error) { savedGameItems = []; savedGamesError = error.message; }
//   renderSavedGames();
// }
//
// function renderOverallProgress() {
//   const state = author?.currentState;
//   const current = state === 'MODE_SELECTION' ? 0
//     : state === 'MANUAL_CONFIGURATION' ? (manualStep < 3 ? 1 : 2)
//       : state === 'MAKOTOMARU_CONFIGURATION' ? 1
//         : state === 'SCENARIO_PREVIEW' ? 3
//           : ['FAILED', 'CANCELLED'].includes(state) ? lastOverallStep
//             : ['CHECKING_CODEX', 'GENERATING_SCENARIO', 'SCENARIO_VALIDATING',
//               'SCENARIO_REVIEWING', 'SCENARIO_REVISING', 'VERIFIED'].includes(state)
//               ? (author?.configuration?.mode === 'MANUAL' ? 2 : 1) : 4;
//   lastOverallStep = current;
//   for (const item of document.querySelectorAll('[data-flow-step]')) {
//     const number = Number(item.dataset.flowStep);
//     item.className = number === current ? 'current' : number < current ? 'complete' : '';
//     item.setAttribute('aria-current', number === current ? 'step' : 'false');
//   }
// }
//
// function renderPreview() {
//   const preview = author.scenarioPreview; if (!preview) return; byId('preview-summary').textContent = preview.incidentSummary;
//   byId('preview-target').textContent = preview.targetSystem; byId('preview-difficulty').textContent = preview.difficultyLabel;
//   byId('preview-verification').textContent = preview.verification?.status === 'VERIFIED'
//     ? 'Backend検証・独立AIレビュー済み' : '未検証';
//   const attacks = byId('preview-attacks'); attacks.replaceChildren(); for (const attack of preview.attacks) {
//     const card = document.createElement('article'); card.className = 'builder-card'; text(card, 'h3', `Attack ${attack.order}: ${attack.label}`);
//     text(card, 'p', `発生: ${attack.occurrenceTime}`); text(card, 'p', `${attack.source} → ${attack.target} / ${attack.targetService}`);
//     text(card, 'p', `調査: ${attack.investigations.map(item => item.label).join('、')}`); attacks.append(card); }
//   drawNetwork('preview-network-diagram', preview.network); const detail = byId('preview-author-details'); detail.replaceChildren();
//   text(detail, 'p', `Configuration ID: ${preview.configurationId}`); text(detail, 'p', `Mode: ${preview.mode}`);
//   for (const check of preview.verification?.checks ?? []) {
//     text(detail, 'p', `${check.category}: ${check.outcome} — ${check.reason}`);
//   }
//   for (const attack of author.configuration?.attacks ?? []) {
//     text(detail, 'p', `Attack ${attack.order} の証拠の答え: ${attack.evidenceAnswer}`);
//   }
//   byId('preview-regenerate').hidden = !author.canRegenerate;
// }
//
// function render() {
//   const state = author.currentState;
//   if (state === 'MODE_SELECTION') {
//     const entryPanels = { SPLASH: 'splash-panel', ACTIVITY: 'activity-panel',
//       COURT: 'court-entry-panel', MODE: 'mode-panel', HELP: 'help-panel',
//       SETTINGS: 'settings-panel' };
//     showPanel(entryPanels[entryView] ?? 'splash-panel');
//     if (entryView === 'COURT') renderSavedGames();
//   }
//   else if (state === 'MANUAL_CONFIGURATION') {
//     if (author.canCancel) {
//       showPanel('generation-panel'); renderProgress('generation-progress'); renderDetails('detail-list');
//       byId('cancel').disabled = false; byId('generation-message').textContent = 'Scenario条件を確認しています…';
//     } else { showPanel('manual-panel'); renderDetails('manual-detail-list'); showManualStep(manualStep); }
//     byId('manual-create').disabled = !initializationReady || author.canCancel; byId('manual-back').disabled = author.canCancel;
//   }
//   else if (state === 'MAKOTOMARU_CONFIGURATION') {
//     if (author.canCancel) {
//       showPanel('generation-panel'); renderProgress('generation-progress'); renderDetails('detail-list');
//       byId('cancel').disabled = false; byId('generation-message').textContent = '真実丸が事件Scenarioを考えています…';
//     } else showPanel('makotomaru-panel');
//     byId('makotomaru-create').disabled = !initializationReady || author.canCancel; byId('makotomaru-back').disabled = author.canCancel;
//   }
//   else if (state === 'SCENARIO_PREVIEW') { showPanel('preview-panel'); renderPreview(); }
//   else if (state === 'READY') {
//     showPanel('ready-panel'); renderProgress('ready-progress'); byId('play-game').href = author.playUrl;
//     byId('ready-save-status').textContent = author.saved
//       ? '✓ このゲームはローカルに保存されました。「裁判」の一覧からいつでも開始できます。'
//       : 'ゲームの保存状態を確認しています…';
//   }
//   else if (['FAILED', 'CANCELLED'].includes(state)) { showPanel('failure-panel'); byId('failure-message').textContent = author.failure?.message ?? '生成を中止しました。'; renderDetails('failure-details'); }
//   else { showPanel('generation-panel'); renderProgress('generation-progress'); renderDetails('detail-list');
//     byId('cancel').disabled = !author.canCancel; byId('generation-message').textContent = state === 'MAKOTOMARU_CONFIGURATION'
//       ? '真実丸が事件Scenarioを考えています…' : state.includes('REVIEW') || state.includes('VALIDAT') ? '攻撃経路と調査方法を確認しています…' : 'Contractに沿ってゲームを構築しています…'; }
//   renderOverallProgress();
//   if (!author.canCancel && polling) { clearInterval(polling); polling = null; }
// }
//
// async function refresh() { try { author = (await api('/api/author/status')).author; render(); }
//   catch (error) {
//     byId('manual-errors').textContent = error.message;
//     byId('generation-message').textContent = `状態の更新またはゲームの保存に失敗しました。${error.message}`;
//   } }
// function beginPolling() { polling ??= setInterval(refresh, 400); }
// async function postAuthor(path, body = {}) { requireInitialized(); const value = await api(path, body); author = value.author; render(); if (author.canCancel) beginPolling(); }
//
// async function chooseMode(mode) {
//   try { if (mode === 'MANUAL') manualStep = 0;
//     await postAuthor('/api/author/select-mode', { mode }); }
//   catch (error) { const notice = byId('initialization-status'); notice.hidden = false; notice.textContent = error.message; }
// }
// function bindAuthorControls() {
// byId('game-start').addEventListener('click', () => { entryView = 'ACTIVITY'; render(); });
// byId('activity-back').addEventListener('click', () => { entryView = 'SPLASH'; render(); });
// byId('choose-creation').addEventListener('click', () => { entryView = 'MODE'; render(); });
// byId('choose-court').addEventListener('click', async () => { entryView = 'COURT'; render(); await loadSavedGames(); });
// byId('court-entry-back').addEventListener('click', () => { entryView = 'ACTIVITY'; render(); });
// byId('court-create-game').addEventListener('click', () => { entryView = 'MODE'; render(); });
// byId('mode-flow-back').addEventListener('click', () => { entryView = 'ACTIVITY'; render(); });
// byId('menu-help').addEventListener('click', () => { byId('app-menu').open = false; entryView = 'HELP'; render(); });
// byId('menu-settings').addEventListener('click', () => {
//   byId('app-menu').open = false; const settings = readSettings();
//   byId('setting-text-size').value = settings.textSize; byId('setting-motion').value = settings.motion;
//   byId('settings-status').textContent = ''; entryView = 'SETTINGS'; render();
// });
// byId('menu-title').addEventListener('click', () => { byId('app-menu').open = false; entryView = 'SPLASH'; render(); });
// byId('menu-exit').addEventListener('click', () => {
//   byId('app-menu').open = false; const dialog = byId('exit-dialog');
//   if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
// });
// byId('help-back').addEventListener('click', () => { entryView = 'ACTIVITY'; render(); });
// byId('settings-back').addEventListener('click', () => { entryView = 'ACTIVITY'; render(); });
// byId('settings-apply').addEventListener('click', () => applySettings({
//   textSize: byId('setting-text-size').value, motion: byId('setting-motion').value,
// }, true));
// byId('exit-cancel').addEventListener('click', () => {
//   const dialog = byId('exit-dialog'); if (typeof dialog.close === 'function') dialog.close();
//   else dialog.removeAttribute('open');
// });
// for (const [id, saveData] of [['exit-save', true], ['exit-without-save', false]]) {
//   byId(id).addEventListener('click', async () => {
//     const buttons = [byId('exit-save'), byId('exit-without-save'), byId('exit-cancel')];
//     buttons.forEach(button => { button.disabled = true; });
//     try {
//       await api('/api/author/shutdown', { saveData });
//       const dialog = byId('exit-dialog'); if (typeof dialog.close === 'function') dialog.close();
//       else dialog.removeAttribute('open');
//       showPanel('shutdown-panel');
//     } catch (error) {
//       buttons.forEach(button => { button.disabled = false; });
//       byId('exit-dialog-title').textContent = `終了できませんでした：${error.message}`;
//     }
//   });
// }
// byId('choose-manual').addEventListener('click', () => chooseMode('MANUAL'));
// byId('choose-makotomaru').addEventListener('click', () => chooseMode('MAKOTOMARU'));
// byId('manual-back').addEventListener('click', () => { entryView = 'MODE'; author.currentState = 'MODE_SELECTION'; render(); });
// byId('manual-previous').addEventListener('click', () => showManualStep(manualStep - 1));
// byId('manual-next').addEventListener('click', () => {
//   if (manualStep === 1 && !document.querySelector('input[name="attack"]:checked')) {
//     byId('manual-errors').textContent = '攻撃手法を1つ以上選択してください。'; return;
//   }
//   showManualStep(manualStep + 1);
// });
// byId('makotomaru-back').addEventListener('click', () => { entryView = 'MODE'; author.currentState = 'MODE_SELECTION'; render(); });
// byId('manual-create').addEventListener('click', async () => { byId('manual-errors').replaceChildren(); try {
//   if (manualStep !== 7) return;
//   await postAuthor('/api/author/manual', { configuration: collectConfiguration() });
//   if (author.configurationValidation?.status === 'INVALID') for (const item of author.configurationValidation.errors) text(byId('manual-errors'), 'p', `${item.code} — ${item.field}: ${item.reason}`);
// } catch (error) { byId('manual-errors').textContent = error.message; } });
// byId('makotomaru-create').addEventListener('click', async () => { try { await postAuthor('/api/author/makotomaru', { request: {
//   schemaVersion: '1.0', difficulty: Number(byId('makotomaru-difficulty').value), attackCategory: byId('attack-category').value, complexity: byId('complexity').value } });
// } catch (error) { byId('makotomaru-error').textContent = error.message; } });
// byId('preview-approve').addEventListener('click', () => postAuthor('/api/author/approve'));
// byId('preview-reject').addEventListener('click', () => postAuthor('/api/author/reject'));
// byId('preview-regenerate').addEventListener('click', () => postAuthor('/api/author/regenerate'));
// byId('cancel').addEventListener('click', () => postAuthor('/api/author/cancel'));
// byId('ready-back').addEventListener('click', async () => {
//   try { entryView = 'ACTIVITY'; await postAuthor('/api/author/menu'); }
//   catch (error) { byId('ready-save-status').textContent = error.message; }
// });
// byId('retry').addEventListener('click', () => { entryView = 'MODE'; author.currentState = 'MODE_SELECTION'; render(); });
//
// for (const kind of Object.keys(itemIndexes)) {
//   byId(`${kind}-previous`).addEventListener('click', () => {
//     if (kind !== 'attack-details') syncNetworkModel();
//     itemIndexes[kind]--; updateItemPager(kind); resetManualScroll();
//   });
//   byId(`${kind}-next`).addEventListener('click', () => {
//     if (kind !== 'attack-details') syncNetworkModel();
//     itemIndexes[kind]++; updateItemPager(kind); resetManualScroll();
//   });
// }
// byId('add-subnet').addEventListener('click', () => { syncNetworkModel(); const n = networkModel.subnets.length + 1;
//   networkModel.subnets.push({ subnetId: `subnet-${n}`, label: `Subnet ${n}`, cidr: `10.${n}.0.0/24`, trustBoundaryId: `zone-${n}` }); itemIndexes.subnet = networkModel.subnets.length - 1;
//   renderNetworkBuilder(); renderAttackDetails(); });
// byId('add-node').addEventListener('click', () => { syncNetworkModel(); const n = networkModel.nodes.length + 1;
//   networkModel.nodes.push({ nodeId: `node-${n}`, label: `Node ${n}`, nodeType: 'SERVER', os: 'linux', ip: `10.10.0.${n + 50}`, subnetId: networkModel.subnets[0]?.subnetId ?? 'subnet-1', trustBoundaryId: networkModel.subnets[0]?.trustBoundaryId ?? 'zone-1', roles: ['server'], logSources: ['APPLICATION_LOG'] }); itemIndexes.node = networkModel.nodes.length - 1;
//   renderNetworkBuilder(); renderAttackDetails(); });
// byId('add-service').addEventListener('click', () => { syncNetworkModel(); const n = networkModel.services.length + 1;
//   networkModel.services.push({ serviceId: `service-${n}`, nodeId: networkModel.nodes[0]?.nodeId ?? 'node-1', label: `Service ${n}`, serviceType: 'logging', platform: 'logging' }); itemIndexes.service = networkModel.services.length - 1;
//   renderNetworkBuilder(); renderAttackDetails(); });
// byId('add-connection').addEventListener('click', () => { syncNetworkModel(); networkModel.connections.push({ fromNodeId: networkModel.nodes[0]?.nodeId ?? '', toNodeId: networkModel.nodes[1]?.nodeId ?? '' });
//   itemIndexes.connection = networkModel.connections.length - 1; renderNetworkBuilder(); renderAttackDetails(); });
// byId('network-preset').addEventListener('change', () => {
//   const selected = bootstrap.networkPresets?.find(item => item.id === byId('network-preset').value);
//   byId('network-preset-description').textContent = selected?.description ?? '';
// });
// byId('apply-network-preset').addEventListener('click', () => {
//   const selected = bootstrap.networkPresets?.find(item => item.id === byId('network-preset').value);
//   if (!selected) return;
//   activeNetworkPresetId = selected.id; networkModel = structuredClone(selected.network);
//   for (const key of Object.keys(itemIndexes)) if (key !== 'attack-details') itemIndexes[key] = 0;
//   const incidentDate = byId('incident-date').value;
// // 2026-09-20 修正前: 構成変更後も利用者の攻撃選択順を維持
// //   const selectedIds = new Set([...document.querySelectorAll('input[name="attack"]:checked')]
// //     .map(item => item.value));
// //   const defaults = selected.attackDefaults.filter(item => selectedIds.has(item.attackId))
// //     .map((item, index) => ({ ...item, order: index + 1,
// //       occurrenceTime: `${incidentDate}${item.occurrenceTime.slice(10)}` }));
// //
// // 2026-09-20 修正後: 構成変更後も利用者の攻撃選択順を維持
//   const selectedIds = [...byId('attack-details').querySelectorAll('[data-attack-id]')].map(card => card.dataset.attackId);
//   const defaults = selectedIds.map((id, index) => {
//     const item = selected.attackDefaults.find(attack => attack.attackId === id);
//     return { ...(item ?? { attackId: id, investigationTypes: [],
//       evidenceAnswer: bootstrap.attacks.find(a => a.id === id).authoring?.evidenceAnswer ?? '' }),
//       order: index + 1, occurrenceTime: initialAttackTime(index) + ':00+09:00' };
//   });
//   byId('attack-details').replaceChildren();
//   renderNetworkBuilder(); renderAttackDetails(defaults);
// });
// byId('incident-date').addEventListener('change', () => renderAttackDetails());
// for (const id of ['subnet-rows', 'node-rows', 'service-rows', 'connection-rows']) {
//   byId(id).addEventListener('input', () => { syncNetworkModel(); drawNetwork('manual-network-diagram', networkModel); });
// }
// }
//
// try {
//   applySettings(readSettings());
//   setInitializationState(false, '初期設定を読み込んでいます…');
//   bindAuthorControls();
//   const value = await api('/api/author/start', {}); token = value.token; bootstrap = value.bootstrap;
//   const preset = readInitialConfiguration(bootstrap); author = value.author;
//   networkModel = structuredClone(preset.network);
//   activeNetworkPresetId = bootstrap.networkPresets?.find(item =>
//     JSON.stringify(item.network) === JSON.stringify(preset.network))?.id ?? null;
//   byId('manual-difficulty').value = String(preset.difficulty);
//   for (const [id, field] of [['incident-date', 'incidentDate'], ['organization-name', 'organizationName'],
//     ['victim-system', 'victimSystem'], ['accused-role', 'accusedRole'], ['suspicion-reason', 'initialSuspicionReason']]) {
//     byId(id).value = preset.incidentContext[field];
//   }
//   renderAttackOptions(); const selectedAttacks = new Set(preset.attacks.map(attack => attack.attackId));
//   for (const control of document.querySelectorAll('input[name="attack"]')) {
//     control.checked = selectedAttacks.has(control.value);
//   }
//   renderNetworkPresetPicker(); renderNetworkBuilder(); renderAttackDetails(preset.attacks); requireRenderedConfiguration();
//   setInitializationState(true); render();
// } catch (error) {
//   const message = error.message.includes(initializationHelp) ? error.message : `${error.message} ${initializationHelp}`;
//   setInitializationState(false, `初期設定の読み込みに失敗しました。${message}`);
//   showPanel('splash-panel');
// }
//
// public/author.html
// <!doctype html>
// <html lang="ja">
// <head>
//   <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
//   <title>インシデントクラフト — 作って！解いて！攻撃を学ぶ！ —</title>
//   <link rel="stylesheet" href="/style.css"><script type="module" src="/author.js"></script>
// </head>
// <body class="author-page">
//   <header><p>インシデントクラフト — 作って！解いて！攻撃を学ぶ！ —</p></header>
//   <main class="author-main">
//     <nav aria-label="作成手順"><ol class="wizard-progress"><li data-flow-step="0">1 作成方法</li><li data-flow-step="1">2 Attack / 真実丸</li><li data-flow-step="2">3 Network</li><li data-flow-step="3">4 Scenario Preview</li><li data-flow-step="4">5 Game Generation</li></ol></nav>
//     <p id="initialization-status" role="status" aria-live="polite">初期設定を読み込んでいます…</p>
//     <section id="splash-panel" class="title-stage" aria-labelledby="splash-title">
//       <div class="title-frame">
//         <div class="title-lockup">
//           <h1 id="splash-title">インシデント<span>クラフト</span></h1>
//           <p class="title-subtitle"><span></span>作って！解いて！攻撃を学ぶ！<span></span></p>
//         </div>
//         <div class="craft-scene" aria-hidden="true">
//           <svg class="craft-art threat-art" viewBox="0 0 260 180">
//             <g class="gear gear-large"><circle cx="120" cy="75" r="45"/><circle class="gear-hole" cx="120" cy="75" r="22"/><path d="M111 13h18l4 22-13 9-13-9zM111 137h18l4-22-13-9-13 9zM58 66v18l22 4 9-13-9-13zM182 66v18l-22 4-9-13 9-13zM76 28l13-13 18 14-3 15-16 3zM151 123l13-13 16 3 3 15-18 14zM164 15l13 13-12 19-16-3-3-15zM89 110l13 13-3 16-15 3-14-18z"/></g>
//             <path class="circuit-line" d="M16 128h48l18-18h35M178 118h40l20-20M37 150h54"/>
//             <circle class="circuit-dot" cx="16" cy="128" r="6"/><circle class="circuit-dot" cx="238" cy="98" r="6"/>
//             <g class="threat-face"><path d="M64 101c35 0 55 20 55 44 0 22-22 34-55 34S9 167 9 145c0-24 20-44 55-44z"/><path class="threat-mark" d="M29 132q15 18 28 0M71 132q15 18 28 0M27 151q37 32 75 0-8 25-38 25-29 0-37-25z"/></g>
//           </svg>
//           <svg class="craft-art guardian-art" viewBox="0 0 300 210">
//             <ellipse class="guardian-shadow" cx="145" cy="194" rx="105" ry="10"/>
//             <path class="guardian-tail" d="M77 143 25 121l34 49z"/>
//             <path class="guardian-body" d="M59 135c0-63 36-108 87-108s88 45 88 108c0 42-30 61-88 61s-87-19-87-61z"/>
//             <path class="guardian-belly" d="M77 124c0-43 27-76 69-76s70 33 70 76c0 37-24 55-70 55s-69-18-69-55z"/>
//             <path class="guardian-crest" d="m96 42 22-34 10 28 25-27 2 33z"/>
//             <path class="guardian-brow" d="M84 85q30-24 53 2M207 85q-30-24-53 2"/>
//             <path class="guardian-eye" d="m89 91 39 5-8 17-27-5zM201 91l-39 5 8 17 27-5z"/>
//             <path class="guardian-beak" d="m128 119 19-12 20 12-20 17z"/>
//             <path class="guardian-foot" d="m107 190-19 15 28-7 14 9-4-18M181 190l20 15-29-7-13 9 3-18"/>
//             <g class="shield"><path d="M196 61q43-20 83 0v61q0 52-42 76-41-24-41-76z"/><path class="shield-inner" d="M207 70q31-14 61 0v50q0 40-31 61-30-21-30-61z"/><path class="shield-mark" d="m221 121 12 13 25-31"/></g>
//           </svg>
//           <svg class="craft-art evidence-art" viewBox="0 0 260 180">
//             <g class="evidence-card"><rect x="18" y="30" width="122" height="96" rx="8"/><path d="M38 55h72M38 75h82M38 95h50"/><circle cx="112" cy="99" r="13"/></g>
//             <path class="gavel-head" d="m139 44 65-32 19 36-65 32zM126 58l9-5 28 54-9 5z"/>
//             <path class="gavel-handle" d="m151 105 16-8 67 56-9 14z"/>
//             <path class="gavel-base" d="M122 155q36-22 74 0v14h-74z"/>
//             <path class="scan-line" d="M20 143h72l18-18M50 160h55"/><circle class="circuit-dot" cx="20" cy="143" r="6"/>
//           </svg>
//         </div>
//         <div class="start-prompt"><button id="game-start" type="button">Game Start! <span>▶</span></button></div>
//       </div>
//     </section>
//     <section id="activity-panel" class="choice-stage" hidden aria-labelledby="activity-title">
//       <div class="selection-shell">
//         <button id="activity-back" class="stage-back" type="button">← タイトルへ</button>
//         <details id="app-menu" class="app-menu">
//           <summary aria-label="メニューを開く"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></summary>
//           <nav class="app-menu-popover" aria-label="システムメニュー"><button id="menu-help" type="button">遊び方</button><button id="menu-settings" type="button">設定</button><button id="menu-title" type="button">タイトルへ戻る</button><button id="menu-exit" class="menu-exit" type="button">ゲーム終了</button></nav>
//         </details>
//         <div class="selection-heading"><p>SELECT YOUR PATH</p><h1 id="activity-title">何を始めますか？</h1><span>事件を組み立てるか、完成した事件の法廷へ向かいます。</span></div>
//         <div class="activity-card-grid">
//           <article class="activity-card creation-card"><div class="activity-icon" aria-hidden="true"><span class="mini-gear">⚙</span><span class="mini-nodes">◇—◇</span></div><p class="mode-label">CASE CREATION</p><h2>ゲーム作成</h2><p>攻撃とNetworkを設計して、調査と裁判のScenarioを作ります。</p><button id="choose-creation" type="button">作成方法を選ぶ <span>→</span></button></article>
//           <article class="activity-card court-card"><div class="activity-icon court-symbol" aria-hidden="true"><span>◆</span><span>⚖</span></div><p class="mode-label">COURT PLAY</p><h2>裁判</h2><p>作成済みのゲームで証拠を集め、矛盾を示して無罪を立証します。</p><button id="choose-court" type="button">裁判へ進む <span>→</span></button></article>
//         </div>
//       </div>
//     </section>
//     <section id="help-panel" class="choice-stage info-stage" hidden aria-labelledby="help-title">
//       <div class="selection-shell info-shell"><button id="help-back" class="stage-back" type="button">← モード選択へ</button><div class="selection-heading"><p>HOW TO PLAY</p><h1 id="help-title">遊び方</h1><span>事件を作り、記録を調べ、証拠で主張を検証します。</span></div><div class="guide-grid"><article><span>01</span><h2>ゲームを作る</h2><p>詳細設定または真実丸で、攻撃とNetworkを含むScenarioを作成します。</p></article><article><span>02</span><h2>事件を調査する</h2><p>保存したゲームを「裁判」から開き、端末やログを調べて証拠を登録します。</p></article><article><span>03</span><h2>法廷で示す</h2><p>証言の対象と証拠を選び、記録から説明できる矛盾を一つずつ示します。</p></article></div></div>
//     </section>
//     <section id="settings-panel" class="choice-stage info-stage" hidden aria-labelledby="settings-title">
//       <div class="selection-shell info-shell settings-shell"><button id="settings-back" class="stage-back" type="button">← モード選択へ</button><div class="selection-heading"><p>SETTINGS</p><h1 id="settings-title">設定</h1><span>このブラウザでの表示方法を調整します。</span></div><div class="settings-card"><label>文字サイズ<select id="setting-text-size"><option value="STANDARD">標準</option><option value="LARGE">大きく</option></select></label><label>画面演出<select id="setting-motion"><option value="STANDARD">標準</option><option value="REDUCED">控えめ</option></select></label><p id="settings-status" role="status" aria-live="polite"></p><button id="settings-apply" type="button">設定を適用</button></div></div>
//     </section>
//     <section id="court-entry-panel" class="choice-stage" hidden aria-labelledby="court-entry-title">
//       <div class="selection-shell saved-games-shell">
//         <button id="court-entry-back" class="stage-back" type="button">← 選択へ戻る</button>
//         <div class="selection-heading saved-games-heading"><p>COURT ARCHIVE</p><h1 id="court-entry-title">保存したゲーム</h1><span>事件ファイルを選んで、調査と裁判を始めます。</span></div>
//         <p id="saved-games-status" class="saved-games-status" role="status" aria-live="polite"></p>
//         <div id="saved-game-list" class="saved-game-list" aria-label="保存したゲームの一覧"></div>
//         <div id="court-empty" class="court-empty" hidden><div class="court-entry-mark" aria-hidden="true">⚖</div><h2>保存したゲームはありません</h2><p>先にScenarioを作成すると、完成したゲームがここに保存されます。</p><button id="court-create-game" type="button">ゲームを作成する <span>→</span></button></div>
//       </div>
//     </section>
//     <section id="mode-panel" class="choice-stage" hidden aria-labelledby="mode-title">
//       <div class="selection-shell build-selection-shell">
//         <button id="mode-flow-back" class="stage-back" type="button">← 選択へ戻る</button>
//         <div class="mode-choice-heading"><span>SELECT A BUILD MODE</span><h1 id="mode-title">Scenario作成方法</h1></div>
//         <div class="mode-card-grid">
//           <article class="mode-card manual-mode-card"><div class="mode-number">01</div><div class="mode-card-copy"><p class="mode-label">CUSTOM BUILD</p><h3>詳細設定</h3><p>事件、攻撃、調査方法、Networkを順番に組み立てます。</p><ul><li>すべて自分で設定</li><li>技術条件を細かく確認</li></ul></div><button id="choose-manual" type="button" disabled>詳細設定で作成 <span>→</span></button></article>
//           <article class="mode-card makotomaru-card"><div class="mode-number">02</div><div class="mode-card-copy"><p class="mode-label">ASSISTED BUILD</p><h3>真実丸に任せる</h3><p>難易度と好みから、成立するScenario条件をAIが提案します。</p><ul><li>選択項目は最小限</li><li>セキュリティ初学者向け</li></ul></div><button id="choose-makotomaru" type="button" disabled>真実丸と作成 <span>→</span></button></article>
//         </div>
//       </div>
//     </section>
//     <section id="manual-panel" hidden aria-labelledby="manual-title">
//       <div class="manual-heading"><div><p class="eyebrow">SCENARIO BUILDER / 詳細設定</p><h1 id="manual-title">事件の条件を組み立てる</h1></div><p id="manual-step-count" class="step-count" aria-live="polite"></p></div>
//       <nav class="manual-flow" aria-label="詳細設定の流れ"><ol>
//         <li data-manual-step-label="0">事件情報</li><li data-manual-step-label="1">攻撃手法</li><li data-manual-step-label="2">攻撃内容・調査</li><li data-manual-step-label="3">Subnet</li>
//         <li data-manual-step-label="4">Node</li><li data-manual-step-label="5">Service</li><li data-manual-step-label="6">Connection</li><li data-manual-step-label="7">構成図確認</li>
//       </ol></nav>
//       <div id="manual-step-content" class="manual-step-content">
//       <fieldset data-manual-step="0"><legend>事件情報</legend><p class="step-hint">この事件の舞台と、最初に疑われた理由を決めます。</p><div class="form-grid">
//         <label>事件日<input id="incident-date" type="date" required></label><label>組織名<input id="organization-name" maxlength="120" required></label>
//         <label>被害System<input id="victim-system" maxlength="120" required></label><label>被告人の役割<input id="accused-role" maxlength="120" required></label>
//         <label class="wide">最初に疑われた理由<input id="suspicion-reason" maxlength="500" required></label><label>Difficulty<select id="manual-difficulty"><option value="1">★1</option><option value="2">★★</option><option value="3">★★★</option></select></label>
//       </div></fieldset>
//       <!-- 2026-09-20 修正前: 先頭からの連鎖を必須にしない
//       <fieldset data-manual-step="1" hidden><legend>攻撃手法（1～3個）</legend><p class="step-hint">事件で使う攻撃を選びます。複数選択はAttack Graphで因果関係を構築できる場合だけ利用できます。</p><div id="attack-options" class="choice-grid"></div></fieldset>
//       -->
//       <!-- 2026-09-20 修正後: 全段階を埋めず任意選択 -->
//       <fieldset data-manual-step="1" hidden><legend>攻撃手法（1～6個）</legend><p class="step-hint">一つだけでも、複数の段階からでも選べます。すべての段階を埋める必要はありません。独立した攻撃も選択でき、実際の前提条件が合う場合だけ連鎖します。</p><div id="attack-options" class="choice-grid"></div></fieldset>
//       <fieldset data-manual-step="2" hidden><legend>具体的な攻撃内容と調査方法</legend><p class="step-hint">攻撃の順序、対象、記録から調べる内容を決めます。</p><div class="item-pager"><button id="attack-details-previous" class="secondary" type="button">前の攻撃</button><span id="attack-details-position"></span><button id="attack-details-next" class="secondary" type="button">次の攻撃</button></div><div id="attack-details" class="builder-list attack-detail-list"></div></fieldset>
//       <fieldset data-manual-step="3" hidden><legend>サブネット構成</legend><p class="step-hint">検証済みのひな型を選ぶか、現在の構成を編集してネットワークの範囲と信頼境界を設定します。</p><div class="preset-picker"><label>構成テンプレート<select id="network-preset"></select></label><button id="apply-network-preset" class="secondary" type="button">この構成を読み込む</button><span id="network-preset-description"></span></div><div class="item-pager"><button id="subnet-previous" class="secondary" type="button">前のSubnet</button><span id="subnet-position"></span><button id="subnet-next" class="secondary" type="button">次のSubnet</button></div><div id="subnet-rows" class="builder-list"></div><button id="add-subnet" class="secondary add-item" type="button">Subnet追加</button></fieldset>
//       <fieldset data-manual-step="4" hidden><legend>サブネット内のノード設定</legend><p class="step-hint">端末の役割、OS、IP、取得できるログを設定します。</p><div class="item-pager"><button id="node-previous" class="secondary" type="button">前のNode</button><span id="node-position"></span><button id="node-next" class="secondary" type="button">次のNode</button></div><div id="node-rows" class="builder-list"></div><button id="add-node" class="secondary add-item" type="button">Node追加</button></fieldset>
//       <fieldset data-manual-step="5" hidden><legend>ノードごとのサービス設定</legend><p class="step-hint">各サービスを、動作するNodeに結び付けます。</p><div class="item-pager"><button id="service-previous" class="secondary" type="button">前のService</button><span id="service-position"></span><button id="service-next" class="secondary" type="button">次のService</button></div><div id="service-rows" class="builder-list"></div><button id="add-service" class="secondary add-item" type="button">Service追加</button></fieldset>
//       <fieldset data-manual-step="6" hidden><legend>各ノードの接続状況</legend><p class="step-hint">通信を許す接続元と接続先を設定します。</p><div class="item-pager"><button id="connection-previous" class="secondary" type="button">前のConnection</button><span id="connection-position"></span><button id="connection-next" class="secondary" type="button">次のConnection</button></div><div id="connection-rows" class="builder-list"></div><button id="add-connection" class="secondary add-item" type="button">Connection追加</button></fieldset>
//       <fieldset data-manual-step="7" hidden><legend>ネットワーク構成の確認</legend><p class="step-hint">構成図を確認してからScenario案を作成します。</p><p id="manual-network-summary" class="review-metrics"></p><svg id="manual-network-diagram" class="network-diagram" role="img" aria-label="設定中のNetwork Diagram"></svg><details><summary>Developer Detail</summary><div id="manual-detail-list" class="detail-list"></div></details></fieldset>
//       </div>
//       <div id="manual-errors" class="error-list" role="alert"></div>
//       <div class="button-row manual-actions"><button id="manual-back" class="secondary" type="button">作成方法へ戻る</button><span class="action-spacer"></span><button id="manual-previous" class="secondary" type="button">前へ</button><button id="manual-next" type="button">次へ</button><button id="manual-create" type="button" disabled hidden>Scenario案を作成</button></div>
//     </section>
//     <section id="makotomaru-panel" hidden aria-labelledby="makotomaru-title"><h1 id="makotomaru-title">真実丸</h1><p class="assistant-message">難易度と好みを選ぶと、登録済みの技術条件から成立するScenario Configurationを提案します。</p>
//       <div class="form-grid"><label>Difficulty<select id="makotomaru-difficulty"><option value="1">★1</option><option value="2">★★</option><option value="3">★★★</option></select></label>
//         <label>Attack Category<select id="attack-category"><option value="ANY">おまかせ</option><option value="WEB">Web攻撃</option><option value="AUTHENTICATION">認証攻撃</option><option value="SOCIAL_ENGINEERING">Social Engineering</option></select></label>
//         <label>Scenario Complexity<select id="complexity"><option value="SIMPLE">シンプル</option><option value="STANDARD" selected>標準</option><option value="COMPLEX">複雑</option></select></label></div>
//       <div class="button-row"><button id="makotomaru-back" class="secondary" type="button">作成方法へ戻る</button><button id="makotomaru-create" type="button" disabled>真実丸に考えてもらう</button></div><p id="makotomaru-error" role="alert"></p>
//     </section>
//     <section id="preview-panel" hidden aria-labelledby="preview-title"><h1 id="preview-title">Scenario Preview</h1><p class="gate-notice">この時点ではゲーム生成へ進みません。内容を確認して承認してください。</p>
//       <article class="preview-summary"><h2>事件概要</h2><p id="preview-summary"></p><dl><dt>対象System</dt><dd id="preview-target"></dd><dt>Difficulty</dt><dd id="preview-difficulty"></dd><dt>事前検証</dt><dd id="preview-verification"></dd></dl></article>
//       <h2>攻撃手法・発生時刻・調査方法</h2><div id="preview-attacks" class="builder-list"></div><h2>Network Diagram</h2><svg id="preview-network-diagram" class="network-diagram" role="img" aria-label="Scenario Network Diagram"></svg>
//       <details><summary>制作者向け詳細</summary><div id="preview-author-details"></div></details><div class="button-row"><button id="preview-reject" class="secondary" type="button">条件を修正</button><button id="preview-regenerate" class="secondary" type="button" hidden>真実丸に作り直してもらう</button><button id="preview-approve" type="button">このScenarioでゲームを作成</button></div>
//     </section>
//     <section id="generation-panel" aria-labelledby="generation-title" hidden><h1 id="generation-title">処理しています</h1><p id="generation-message" class="assistant-message"></p><ol id="generation-progress" class="generation-progress"></ol><div class="button-row"><button id="cancel" class="secondary" type="button">生成を中止</button></div><details><summary>詳細</summary><div id="detail-list" class="detail-list"></div></details></section>
//     <section id="ready-panel" aria-labelledby="ready-title" hidden><h1 id="ready-title">ゲームが完成しました</h1><p id="ready-save-status" class="save-complete" role="status"></p><ol id="ready-progress" class="generation-progress"></ol><div class="button-row ready-actions"><button id="ready-back" class="secondary" type="button">モード選択へ戻る</button><a id="play-game" class="button-link" href="/">ゲームをプレイする</a></div></section>
//     <section id="failure-panel" aria-labelledby="failure-title" hidden><h1 id="failure-title">ゲーム生成に失敗しました</h1><p id="failure-message"></p><button id="retry" type="button">作成方法へ戻る</button><details><summary>詳細</summary><div id="failure-details" class="detail-list"></div></details></section>
//     <section id="shutdown-panel" class="shutdown-stage" hidden aria-labelledby="shutdown-title"><div><p class="title-kicker">SERVER CLOSED</p><h1 id="shutdown-title">ゲームを終了しました</h1><p>ローカルサーバーを停止しました。このタブを閉じてください。</p></div></section>
//   </main>
//   <dialog id="exit-dialog" class="exit-dialog" aria-labelledby="exit-dialog-title"><form method="dialog"><p class="title-kicker">GAME EXIT</p><h2 id="exit-dialog-title">ゲームを終了しますか？</h2><p>完成したゲームはすでにローカルへ自動保存されています。</p><p>「保存せず終了」は現在の未完了な制作状態だけを破棄します。保存済みゲームは削除されません。</p><div class="exit-dialog-actions"><button id="exit-cancel" class="secondary" value="cancel">キャンセル</button><button id="exit-without-save" class="secondary danger-link" type="button">保存せず終了</button><button id="exit-save" type="button">保存して終了</button></div></form></dialog>
// </body>
// </html>
//
// tests/author-ui.test.js
// import test from 'node:test';
// import assert from 'node:assert/strict';
// import { autoAuthorBootstrap } from '../server/auto-generation-service.js';
// import { loadCatalog } from '../server/generation/catalog.js';
// import { normalizeScenarioConfiguration, validateScenarioConfiguration }
//   from '../server/generation/scenario-configuration.js';
// import { startAuthorDom } from './helpers/author-dom.js';
//
// const catalog = await loadCatalog();
//
// async function advanceToReview(page) {
//   for (let index = 0; index < 7; index++) await page.byId('manual-next').dispatch('click');
// }
//
// test('初期画面はGame Startだけを提示し、用途選択から作成方法へ段階遷移する', async () => {
//   const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
//   assert.equal(page.byId('splash-panel').hidden, false);
//   assert.equal(page.byId('activity-panel').hidden, true);
//   assert.equal(page.byId('mode-panel').hidden, true);
//   assert.equal(page.byId('game-start').hidden, false);
//   assert.ok(page.byId('ready-back'));
//   await page.byId('game-start').dispatch('click');
//   assert.equal(page.byId('splash-panel').hidden, true);
//   assert.equal(page.byId('activity-panel').hidden, false);
//   await page.byId('choose-court').dispatch('click');
//   assert.equal(page.byId('court-entry-panel').hidden, false);
//   assert.equal(page.byId('court-empty').hidden, false);
//   await page.byId('court-create-game').dispatch('click');
//   assert.equal(page.byId('mode-panel').hidden, false);
//   assert.equal(page.byId('choose-manual').disabled, false);
//   assert.deepEqual(page.calls.map(call => call.path), ['/api/author/start', '/api/author/games']);
// });
//
// test('裁判画面は保存済みゲームを表示し、起動URLと削除操作を提供する', async () => {
//   const gameId = `saved_${'1'.repeat(32)}`;
//   const page = startAuthorDom(autoAuthorBootstrap(), { savedGames: [{ gameId,
//     savedAt: '2026-09-19T10:30:00.000Z', title: '青葉ソリューションズ — 社内ポータル',
//     summary: '保存した事件の概要', targetSystem: '社内ポータル', difficulty: 2,
//     attacks: ['フィッシング', '反射型XSS'] }] });
//   await page.ready;
//   await page.byId('game-start').dispatch('click');
//   await page.byId('choose-court').dispatch('click');
//   assert.equal(page.byId('court-empty').hidden, true);
//   assert.match(page.byId('saved-game-list').textContent, /青葉ソリューションズ.*このゲームで遊ぶ/s);
//   assert.equal(page.byId('saved-game-list').querySelector('a').href, `/?saved=${gameId}`);
//   const remove = page.document.querySelector(`[data-game-id="${gameId}"]`);
//   await remove.dispatch('click');
//   assert.equal(page.byId('court-empty').hidden, false);
//   assert.ok(page.calls.some(call => call.path.endsWith(gameId) && call.method === 'DELETE'));
// });
//
// test('ゲーム完成画面は保存完了を示し、モード選択へ戻れる', async () => {
//   const page = startAuthorDom(autoAuthorBootstrap(), { initialAuthor: {
//     currentState: 'READY', saved: true, playUrl: `/?saved=saved_${'2'.repeat(32)}`,
//   } });
//   await page.ready;
//   assert.equal(page.byId('ready-panel').hidden, false);
//   assert.match(page.byId('ready-save-status').textContent, /ローカルに保存されました/);
//   await page.byId('ready-back').dispatch('click');
//   assert.equal(page.byId('activity-panel').hidden, false);
//   assert.ok(page.calls.some(call => call.path === '/api/author/menu'));
// });
//
// test('モード選択メニューから遊び方・設定・タイトルへ遷移できる', async () => {
//   const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
//   await page.byId('game-start').dispatch('click');
//   await page.byId('menu-help').dispatch('click');
//   assert.equal(page.byId('help-panel').hidden, false);
//   await page.byId('help-back').dispatch('click');
//   await page.byId('menu-settings').dispatch('click');
//   assert.equal(page.byId('settings-panel').hidden, false);
//   page.byId('setting-text-size').value = 'LARGE';
//   page.byId('setting-motion').value = 'REDUCED';
//   await page.byId('settings-apply').dispatch('click');
//   assert.equal(page.document.querySelector('body').dataset.textSize, 'LARGE');
//   assert.match(page.localStorage.getItem('incident-craft-settings-v1'), /REDUCED/);
//   await page.byId('settings-back').dispatch('click');
//   await page.byId('menu-title').dispatch('click');
//   assert.equal(page.byId('splash-panel').hidden, false);
// });
//
// test('ゲーム終了は保存確認後にshutdown APIを呼び、終了画面を表示する', async () => {
//   const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
//   await page.byId('game-start').dispatch('click');
//   await page.byId('menu-exit').dispatch('click');
//   assert.equal(page.byId('exit-dialog').open, true);
//   await page.byId('exit-save').dispatch('click');
//   const shutdown = page.calls.find(call => call.path === '/api/author/shutdown');
//   assert.deepEqual(shutdown.body, { saveData: true });
//   assert.equal(page.byId('shutdown-panel').hidden, false);
// });
//
// test('Author実scriptが4項目と証拠の答えを表示し、入力済みの有効なNetworkを送信する', async () => {
//   const bootstrap = autoAuthorBootstrap(); const page = startAuthorDom(bootstrap); await page.ready;
//   assert.equal(page.byId('initialization-status').hidden, true);
//   assert.equal(page.byId('choose-manual').disabled, false);
//   for (const [kind, count] of [['subnets', 2], ['nodes', 5], ['services', 4], ['connections', 5]]) {
//     assert.equal(page.document.querySelectorAll(`[data-network-kind="${kind}"]`).length, count);
//   }
//   const cards = page.document.querySelectorAll('[data-attack-id]');
//   assert.equal(cards.length, 1); assert.equal(cards[0].dataset.attackId, 'phishing');
//   assert.equal(cards[0].querySelector('[data-key="evidenceAnswer"]').value,
//     'メール文のリンク先と実際に遷移するリンク先が異なること');
//   await page.byId('choose-manual').dispatch('click');
//   assert.equal(page.document.querySelector('[data-manual-step="0"]').hidden, false);
//   assert.equal(page.document.querySelector('[data-manual-step="1"]').hidden, true);
//   await page.byId('manual-create').dispatch('click', { force: true });
//   assert.equal(page.calls.some(call => call.path === '/api/author/manual'), false);
//   await advanceToReview(page);
//   assert.equal(page.document.querySelector('[data-manual-step="7"]').hidden, false);
//   assert.equal(page.byId('manual-create').hidden, false);
//   await page.byId('manual-create').dispatch('click');
//   const submitted = page.calls.find(call => call.path === '/api/author/manual').body.configuration;
//   assert.deepEqual(submitted.network, bootstrap.defaultManualConfiguration.network);
//   const result = validateScenarioConfiguration(normalizeScenarioConfiguration(submitted, catalog), catalog);
//   assert.equal(result.status, 'VALID', JSON.stringify(result.errors));
// });
//
// test('初期設定応答を待つ間は操作できず、強制呼出しでもnetwork:nullを送信しない', async () => {
//   let resolveBootstrap;
//   const page = startAuthorDom(new Promise(resolve => { resolveBootstrap = resolve; }));
//   assert.equal(page.byId('choose-manual').disabled, true);
//   assert.equal(page.byId('manual-create').disabled, true);
//   await page.byId('choose-manual').dispatch('click', { force: true });
//   await page.byId('manual-create').dispatch('click', { force: true });
//   assert.deepEqual(page.calls.map(call => call.path), ['/api/author/start']);
//   resolveBootstrap(autoAuthorBootstrap()); await page.ready;
//   assert.equal(page.byId('choose-manual').disabled, false);
// });
//
// for (const [label, mutate] of [
//   ['旧サーバー応答（presetなし）', value => { delete value.defaultManualConfiguration; }],
//   ['network:null', value => { value.defaultManualConfiguration.network = null; }],
//   ['network配列', value => { value.defaultManualConfiguration.network = []; }],
//   ['nodes欠落', value => { delete value.defaultManualConfiguration.network.nodes; }],
// ]) test(`${label}は見える位置に初期化エラーを表示し、生成APIへ送信しない`, async () => {
//   const bootstrap = autoAuthorBootstrap(); mutate(bootstrap);
//   const page = startAuthorDom(bootstrap); await page.ready;
//   assert.equal(page.byId('initialization-status').hidden, false);
//   assert.match(page.byId('initialization-status').textContent, /初期設定.*再起動/);
//   assert.equal(page.byId('choose-manual').disabled, true);
//   assert.equal(page.byId('choose-makotomaru').disabled, true);
//   await page.byId('manual-create').dispatch('click', { force: true });
//   await page.byId('makotomaru-create').dispatch('click', { force: true });
//   assert.deepEqual(page.calls.map(call => call.path), ['/api/author/start']);
// });
//
// test('フォーム要素の欠落も初期化未完了とし、生成を許可しない', async () => {
//   const page = startAuthorDom(autoAuthorBootstrap(), { missingElementId: 'service-rows' });
//   await page.ready;
//   assert.equal(page.byId('initialization-status').hidden, false);
//   assert.equal(page.byId('manual-create').disabled, true);
//   await page.byId('manual-create').dispatch('click', { force: true });
//   assert.equal(page.calls.length, 0);
// });
//
// test('初期設定API失敗を空の詳細設定画面として扱わない', async () => {
//   const page = startAuthorDom(null, { startError: new Error('通信できませんでした。') });
//   await page.ready;
//   assert.equal(page.byId('initialization-status').hidden, false);
//   assert.equal(page.byId('choose-manual').disabled, true);
// });
//
// test('再描画で編集値を戻さず、Network欄が消えた状態では送信しない', async () => {
//   const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
//   await page.byId('choose-manual').dispatch('click');
//   const card = page.document.querySelector('[data-attack-id]');
//   card.querySelector('[data-key="evidenceAnswer"]').value = '利用者が編集した証拠の答え';
//   await page.byId('incident-date').dispatch('change');
//   assert.equal(page.document.querySelector('[data-key="evidenceAnswer"]').value,
//     '利用者が編集した証拠の答え');
//   await advanceToReview(page);
//   page.byId('node-rows').replaceChildren();
//   await page.byId('manual-create').dispatch('click');
//   assert.match(page.byId('manual-errors').textContent, /nodes.*送信できません/);
//   assert.deepEqual(page.calls.map(call => call.path),
//     ['/api/author/start', '/api/author/select-mode']);
// });
//
// test('Network presetで複数Attackを選んでも日時をdatetime-local形式で連番送信する', async () => {
//   const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
//   await page.byId('choose-manual').dispatch('click');
//   page.byId('network-preset').value = 'dmz-web';
//   await page.byId('apply-network-preset').dispatch('click');
//   const xss = page.document.querySelectorAll('input[name="attack"]')
//     .find(item => item.value === 'reflected_xss');
//   xss.checked = true; await xss.dispatch('change');
//   const cards = page.document.querySelectorAll('[data-attack-id]');
//   assert.equal(cards.length, 2);
//   assert.deepEqual(cards.map(card => card.querySelector('[data-key="order"]').value), ['1', '2']);
//   assert.ok(cards.every(card => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
//     .test(card.querySelector('[data-key="occurrenceTime"]').value)));
//   await advanceToReview(page);
//   await page.byId('manual-create').dispatch('click');
//   const submitted = page.calls.find(call => call.path === '/api/author/manual').body.configuration;
//   assert.deepEqual(submitted.attacks.map(item => item.order), [1, 2]);
//   const result = validateScenarioConfiguration(normalizeScenarioConfiguration(submitted, catalog), catalog);
//   assert.equal(result.status, 'VALID', JSON.stringify(result.errors));
// });
//
// test('詳細設定は順番に進み、Nodeなど複数件は1件ずつ表示して入力を保つ', async () => {
//   const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
//   await page.byId('choose-manual').dispatch('click');
//   const organization = page.byId('organization-name'); organization.value = '編集後の組織';
//   await page.byId('manual-next').dispatch('click');
//   assert.equal(page.document.querySelector('[data-manual-step="1"]').hidden, false);
//   await page.byId('manual-next').dispatch('click');
//   await page.byId('manual-next').dispatch('click');
//   await page.byId('manual-next').dispatch('click');
//   assert.equal(page.document.querySelector('[data-manual-step="4"]').hidden, false);
//   assert.equal(page.byId('node-position').textContent, '1 / 5');
//   assert.equal(page.document.querySelectorAll('[data-network-kind="nodes"]').filter(row => !row.hidden).length, 1);
//   await page.byId('node-next').dispatch('click');
//   assert.equal(page.byId('node-position').textContent, '2 / 5');
//   await page.byId('manual-previous').dispatch('click');
//   await page.byId('manual-previous').dispatch('click');
//   await page.byId('manual-previous').dispatch('click');
//   await page.byId('manual-previous').dispatch('click');
//   assert.equal(page.byId('organization-name').value, '編集後の組織');
// });
//
// test('NetworkのNode IDを変更しても攻撃対象を別Nodeへ黙って切り替えない', async () => {
//   const page = startAuthorDom(autoAuthorBootstrap()); await page.ready;
//   await page.byId('choose-manual').dispatch('click');
//   for (let index = 0; index < 4; index++) await page.byId('manual-next').dispatch('click');
//   const row = page.document.querySelectorAll('[data-network-kind="nodes"]')
//     .find(item => item.querySelector('[data-key="nodeId"]').value === 'web-host');
//   row.querySelector('[data-key="nodeId"]').value = 'renamed-web-host';
//   await page.byId('manual-next').dispatch('click');
//   const target = page.document.querySelector('[data-attack-id]')
//     .querySelector('[data-key="targetNodeId"]');
//   assert.equal(target.value, 'web-host');
//   assert.match(target.children[0].textContent, /現在の構成にありません/);
// });
//