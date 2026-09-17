import { assetPath } from './visual-assets.js';

const screen = document.querySelector('#screen');
const errorBox = document.querySelector('#error');
let token = null;
let game = null;
let busy = false;
const playId = new URLSearchParams(location.search).get('game');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, handler, disabled = false) {
  const node = element('button', text);
  node.type = 'button';
  node.disabled = disabled;
  node.addEventListener('click', handler);
  return node;
}

async function request(path, body) {
  if (busy) return;
  busy = true;
  errorBox.textContent = '';
  const controls = [...screen.querySelectorAll('button, input')].map(node => [node, node.disabled]);
  controls.forEach(([node]) => { node.disabled = true; });
  try {
    const response = await fetch(path, { method: 'POST',
      headers: { 'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || '処理に失敗しました。');
    if (data.token) token = data.token;
    game = data.game;
    render();
  } catch (error) {
    errorBox.textContent = error instanceof TypeError
      ? '通信できません。サーバーの起動を確認してください。' : error.message;
  } finally {
    busy = false;
    controls.forEach(([node, disabled]) => { if (node.isConnected) node.disabled = disabled; });
  }
}

function action(actionName, fields = {}) {
  return request('/api/action', { action: actionName, ...fields });
}

function evidenceCard(item) {
  const node = element('div', undefined, 'card');
  node.append(element('strong', item.title),
    element('p', item.type ?? item.kind, 'kind'),
    element('p', item.publicContent ?? item.text));
  return node;
}

function renderInitialCourt() {
  const court = game.initialCourt;
  screen.append(element('p', '第1法廷では、現在提示されている主張と証拠を確認します。'));
  screen.append(element('h2', '検察側の主張'));
  for (const statement of court.prosecutionStatements) {
    const node = element('div', undefined, 'card');
    node.append(element('strong', statement.speaker.displayName),
      element('p', statement.spokenContent));
    screen.append(node);
  }
  screen.append(element('h2', '提示された証拠'));
  court.presentedEvidence.forEach(item => screen.append(evidenceCard(item)));
  screen.append(element('p', court.publicRuling, 'ruling'));
  screen.append(button('追加調査へ', () => action('continue')));
}

function renderInvestigation() {
  screen.append(element('p', '調査対象と方法を選び、Evidenceを発見して証拠品として取得してください。'));
  screen.append(element('h2', '調査対象'));
  for (const target of game.investigationTargets) {
    const row = element('div', undefined, 'card');
    row.append(element('strong', target.displayName), element('p', target.targetType, 'kind'),
      element('p', target.description));
    const actions = element('div', undefined, 'button-row');
    for (const investigationAction of target.availableActions) {
      actions.append(button(`${investigationAction.displayName}${investigationAction.completed ? '（実行済み）' : ''}`,
        () => action('investigate', { targetId: target.targetId,
          investigationActionId: investigationAction.actionId })));
    }
    row.append(actions);
    screen.append(row);
  }
  screen.append(element('h2', '直近の調査結果'));
  if (!game.lastInvestigationResult) screen.append(element('p', 'まだ調査を実行していません。'));
  else {
    const result = element('div', undefined, 'card');
    result.append(element('p', game.lastInvestigationResult.publicMessage));
    for (const hint of game.lastInvestigationResult.nextHints) result.append(element('p', hint, 'kind'));
    screen.append(result);
  }
  screen.append(element('h2', '発見済みEvidence'));
  if (!game.discoveredEvidence.length) screen.append(element('p', 'まだEvidenceを発見していません。'));
  for (const item of game.discoveredEvidence) {
    const row = evidenceCard(item);
    row.append(element('p', item.discoveryState, 'kind'),
      button(item.discoveryState === 'COLLECTED' ? '取得済み' : '証拠品として登録',
        () => action('collect', { evidenceId: item.evidenceId }),
        item.discoveryState === 'COLLECTED'));
    screen.append(row);
  }
  screen.append(element('h2', '取得済みEvidence'));
  if (!game.collectedEvidence.length) screen.append(element('p', 'まだEvidenceを取得していません。'));
  game.collectedEvidence.forEach(item => screen.append(evidenceCard(item)));
  screen.append(button('第2法廷へ', () => action('retrial'), !game.collectedEvidence.length));
}

function renderRetrialCourt() {
  screen.append(element('p', '矛盾するstatementと、提示する取得済みEvidenceを選択してください。'));
  const statements = element('fieldset');
  statements.append(element('legend', '指摘するstatement'));
  for (const testimony of game.testimonies) for (const statement of testimony.statements) {
    const label = element('label', undefined, 'card');
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'statement'; radio.value = statement.statementId;
    label.append(radio, element('strong', testimony.speaker.displayName),
      element('p', statement.spokenContent));
    statements.append(label);
  }
  const evidence = element('fieldset');
  evidence.append(element('legend', '提示するEvidence'));
  for (const item of game.presentableEvidence) {
    const label = element('label', undefined, 'card');
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'evidence'; radio.value = item.evidenceId;
    label.append(radio, element('strong', item.title), element('p', item.type, 'kind'),
      element('p', item.publicContent));
    evidence.append(label);
  }
  const present = button('異議あり！！', () => {
    const statement = statements.querySelector('input:checked');
    const item = evidence.querySelector('input:checked');
    if (statement && item) action('objection',
      { statementId: statement.value, evidenceId: item.value });
  }, true);
  const update = () => { present.disabled = !(statements.querySelector('input:checked')
    && evidence.querySelector('input:checked')); };
  statements.addEventListener('change', update);
  evidence.addEventListener('change', update);
  screen.append(statements, evidence, present);
}

function renderGenerated() {
  const titles = { TITLE: game.title, INITIAL_COURT: '第1法廷', INVESTIGATION: '探偵パート',
    RETRIAL_COURT: '第2法廷', GUILTY_RETRY: '有罪側判定', ACQUITTED: '無罪判決',
    BLOCKED: '進行停止' };
  const title = element('h1', titles[game.currentState] ?? 'インシデント調査ゲーム');
  title.id = 'screen-title'; title.tabIndex = -1; screen.append(title);
  if (game.currentState === 'TITLE') {
    screen.append(element('p', game.synopsis), button('事件を開始', () => action('begin')));
  } else if (game.currentState === 'INITIAL_COURT') renderInitialCourt();
  else if (game.currentState === 'INVESTIGATION') renderInvestigation();
  else if (game.currentState === 'RETRIAL_COURT') renderRetrialCourt();
  else if (game.currentState === 'GUILTY_RETRY') {
    screen.append(element('p', game.publicFailureFeedback),
      button('再調査する', () => action('retry')));
  } else if (game.currentState === 'ACQUITTED') {
    screen.append(element('p', game.acquittal.publicRuling, 'ruling'),
      element('p', game.acquittal.publicExplanation));
  } else if (game.currentState === 'BLOCKED') screen.append(element('p', game.blockedMessage));
  title.focus();
}

function imageAsset(assetId, alt, className) {
  const node = document.createElement('img'); node.src = assetPath(assetId);
  node.alt = alt; if (className) node.className = className; return node;
}

function prototypeScene(backgroundAssetId) {
  screen.className = 'prototype-scene scene-enter';
  const path = assetPath(backgroundAssetId);
  if (path) screen.style.backgroundImage = `linear-gradient(rgba(8, 15, 31, .30), rgba(8, 15, 31, .72)), url("${path}")`;
}

function character(role, expression, active) {
  const roleKey = role.toLowerCase();
  const assetId = game.assets.characters[roleKey]?.[expression]
    ?? game.assets.characters[roleKey]?.neutral;
  const node = element('figure', undefined, `court-character ${roleKey}${active ? ' active' : ''}`);
  node.append(imageAsset(assetId, `${role} ${expression}`), element('figcaption', role));
  return node;
}

function renderPrototypeCourt() {
  prototypeScene(game.backgroundAssetId);
  const dialogue = game.dialogue;
  const stage = element('div', undefined, 'court-stage');
  stage.append(character('PROSECUTOR', dialogue.speaker === 'PROSECUTOR' ? dialogue.expression : 'neutral', dialogue.speaker === 'PROSECUTOR'),
    character('JUDGE', 'neutral', dialogue.speaker === 'JUDGE'),
    character('DEFENSE', dialogue.speaker === 'DEFENSE' ? dialogue.expression : 'neutral', dialogue.speaker === 'DEFENSE'));
  const box = element('div', undefined, 'dialogue-box');
  box.append(element('strong', dialogue.speaker), element('p', dialogue.text),
    button(game.hasNextDialogue ? '次へ' : '調査へ', () => action('next-dialogue')));
  screen.append(element('h1', 'Initial Court'), stage, box);
}

function renderPrototypeInvestigation() {
  prototypeScene(game.backgroundAssetId);
  screen.append(element('h1', `Investigation — Round ${game.currentRound} / ${game.requiredEvidenceCount}`));
  const layout = element('div', undefined, 'investigation-layout');
  const network = element('div', undefined, 'network-viewer card');
  const diagram = document.createElement('img'); diagram.src = game.network.diagramPath;
  diagram.alt = `${game.network.displayName}の構成図。現在の調査対象は${game.investigationTarget.displayName}`;
  const nodeMap = element('div', undefined, 'network-node-map');
  game.network.nodes.forEach(node => nodeMap.append(element('span',
    `${node.displayName}\n${node.ip}`, node.id === game.highlightedNodeId ? 'highlighted' : '')));
  network.append(element('h2', game.network.displayName), diagram, nodeMap,
    element('p', `調査中: ${game.investigationTarget.displayName} / ${game.investigationTarget.sourceName}`, 'node-highlight-label'));
  const logs = element('div', undefined, 'log-panel'); logs.append(element('h2', 'Synthetic Log Viewer'));
  const pre = element('pre', game.syntheticLog.join('\n'), 'synthetic-log'); logs.append(pre);
  const choices = element('div', undefined, 'investigation-choices');
  game.choices.forEach((choice, index) => choices.append(button(
    `${String.fromCharCode(65 + index)}  ${choice.label}`,
    () => action('investigate', { choiceId: choice.choiceId }))));
  logs.append(element('p', '表示コマンドはゲーム内Simulationです。実行されません。', 'kind'), choices);
  layout.append(network, logs); screen.append(layout);
  if (game.investigationResult) {
    const result = element('div', undefined, `investigation-result ${game.investigationResult.success ? 'success' : 'failure'}`);
    result.append(element('strong', game.investigationResult.success ? 'Evidence発見' : '調査結果'),
      element('p', game.investigationResult.publicMessage));
    if (game.investigationResult.acquiredEvidence) result.append(evidenceCard(game.investigationResult.acquiredEvidence));
    screen.append(result);
  }
  if (game.canReturnToCourt) screen.append(button('Court Evidence Roundへ', () => action('court')));
}

function renderPrototypeEvidenceRound() {
  prototypeScene(game.backgroundAssetId);
  screen.append(element('h1', `Court Evidence Round ${game.currentRound}`));
  const stage = element('div', undefined, 'court-stage');
  stage.append(character('PROSECUTOR', game.courtResult?.success ? 'surprised' : 'confident', true),
    character('JUDGE', 'neutral', false), character('DEFENSE', game.courtResult?.success ? 'confident' : 'thinking', Boolean(game.courtResult?.success)));
  screen.append(stage, element('p', game.prosecutionDialogue, 'dialogue-box'));
  if (!game.courtResult) {
    const evidence = element('div', undefined, 'evidence-grid');
    game.presentableEvidence.forEach(item => {
      const card = evidenceCard(item); card.append(button('このEvidenceを提示',
        () => action('present-evidence', { evidenceId: item.evidenceId })));
      evidence.append(card);
    }); screen.append(evidence);
  } else {
    if (game.courtResult.objection) screen.append(imageAsset(game.courtResult.effectAssetId,
      '異議あり', 'objection-effect'));
    const dialogue = element('div', undefined, 'dialogue-box');
    game.courtResult.defenseDialogue.forEach(line => dialogue.append(element('p', line)));
    dialogue.append(element('p', game.courtResult.prosecutorDialogue));
    if (game.courtResult.hasNextRound) dialogue.append(button('追加調査へ', () => action('next-round')));
    if (game.courtResult.finishAvailable) dialogue.append(button('判決へ', () => action('finish')));
    screen.append(dialogue);
  }
}

function renderXssPrototype() {
  if (game.currentScene === 'INTRO') {
    prototypeScene(game.backgroundAssetId);
    const panel = element('div', undefined, 'intro-panel');
    panel.append(element('h1', 'Incident Brief'), element('p', game.publicSummary.incident),
      element('p', `被告人が疑われた理由：${game.publicSummary.suspicion}`),
      element('p', `罪状：${game.publicSummary.charge}`), button('裁判へ', () => action('begin')));
    screen.append(panel);
  } else if (game.currentScene === 'INITIAL_COURT') renderPrototypeCourt();
  else if (game.currentScene === 'INVESTIGATION') renderPrototypeInvestigation();
  else if (game.currentScene === 'COURT_EVIDENCE_ROUND') renderPrototypeEvidenceRound();
  else if (game.currentScene === 'ACQUITTED') {
    prototypeScene(game.backgroundAssetId);
    const panel = element('div', undefined, 'clear-panel');
    panel.append(character('JUDGE', 'neutral', true), element('p', game.judgeDialogue),
      element('h1', 'ACQUITTED'), element('strong', game.gameClear)); screen.append(panel);
  }
}

function renderFixture() {
  const titles = { detective: '探偵パート', courtroom: '法廷パート', result: '結果' };
  const title = element('h1', titles[game.phase]);
  title.id = 'screen-title'; title.tabIndex = -1; screen.append(title);
  if (game.phase === 'detective') {
    screen.append(element('p', '証拠候補を選んで取得してください。'));
    for (const candidate of game.candidates) {
      const owned = game.inventory.some(item => item.id === candidate.id);
      screen.append(button(`${candidate.title}：${owned ? '取得済み' : '取得する'}`,
        () => action('collect', { evidenceId: candidate.id }), owned));
    }
    game.inventory.forEach(item => screen.append(evidenceCard(item)));
    screen.append(button('法廷パートへ', () => action('courtroom'), !game.inventory.length));
  } else if (game.phase === 'courtroom') {
    screen.append(element('p', game.instruction), evidenceCard({ title: '証言', ...game.testimony }));
    for (const item of game.inventory) screen.append(button(`${item.title}を提示`,
      () => action('present', { evidenceId: item.id })));
  } else screen.append(element('p', game.result.success
    ? '矛盾の指摘が成立しました。' : 'この証拠では矛盾の指摘は成立しませんでした。'));
  title.focus();
}

function render() {
  screen.replaceChildren();
  screen.className = ''; screen.style.backgroundImage = '';
  if (!game) {
    const title = element('h1', 'インシデント調査ゲーム');
    title.id = 'screen-title'; title.tabIndex = -1;
    screen.append(title, element('p', 'ゲームデータを検証して開始します。'),
      button('ゲーム開始', () => request('/api/start', playId ? { playId } : {})));
    title.focus(); return;
  }
  if (game.mode === 'XSS_PROTOTYPE') renderXssPrototype();
  else if (game.mode === 'GENERATED') renderGenerated();
  else renderFixture();
}

render();
