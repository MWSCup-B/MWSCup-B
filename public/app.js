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
  screen.append(element('p', '証拠を調査し、第2法廷で提示するEvidenceを取得してください。'));
  screen.append(element('h2', '調査対象'));
  for (const candidate of game.evidenceCandidates) {
    const row = element('div', undefined, 'card');
    row.append(element('strong', candidate.title), element('p', candidate.type, 'kind'),
      button(candidate.collected ? '取得済み' : '取得する',
        () => action('collect', { evidenceId: candidate.evidenceId }), candidate.collected));
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
  if (!game) {
    const title = element('h1', 'インシデント調査ゲーム');
    title.id = 'screen-title'; title.tabIndex = -1;
    screen.append(title, element('p', 'ゲームデータを検証して開始します。'),
      button('ゲーム開始', () => request('/api/start', playId ? { playId } : {})));
    title.focus(); return;
  }
  if (game.mode === 'GENERATED') renderGenerated();
  else renderFixture();
}

render();
