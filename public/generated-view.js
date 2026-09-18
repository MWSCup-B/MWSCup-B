import { assetPath } from './visual-assets.js';

// View state contains selections only. Progress, ownership and verdicts belong to the server.
const view = { key: '', state: '', page: 0, target: null, evidence: null, statement: null };
const phases = { TITLE: '事件ファイル', INITIAL_COURT: '開廷', INVESTIGATION: '記録調査',
  RETRIAL_COURT: '争点審理', GUILTY_RETRY: '立証の再検討', ACQUITTED: '審理終結', BLOCKED: '審理停止' };
const types = { EMAIL: 'メール', WEB_ACCESS_LOG: 'アクセス記録', TESTIMONY: '供述調書',
  NETWORK_LOG: '通信記録', APPLICATION_LOG: 'アプリケーション記録' };
function el(tag, text, css) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (css) node.className = css;
  return node;
}
function button(text, click, css = '', disabled = false) {
  const node = el('button', text, css); node.type = 'button'; node.disabled = disabled;
  node.addEventListener('click', click); return node;
}
function portrait(role, name, active = false) {
  const figure = el('figure', undefined, `case-person${active ? ' is-speaking' : ''}`);
  const img = el('img'); img.src = assetPath(`${role}_neutral`); img.alt = '';
  figure.append(img, el('figcaption', name)); return figure;
}
function panel(title) {
  const node = el('section', undefined, 'case-panel'); node.append(el('h2', title)); return node;
}
function dialogue(speaker, text, badge = '法廷での発言') {
  const box = el('section', undefined, 'case-dialogue');
  box.setAttribute('aria-label', '会話');
  box.append(el('span', badge, 'case-eyebrow'), el('h2', speaker), el('p', text)); return box;
}
function stage(speaker = '証言者', role = 'prosecutor') {
  const node = el('div', undefined, 'case-stage');
  node.append(portrait('defense', '弁護側', role === 'defense'),
    portrait('judge', '審理官', role === 'judge'), portrait('witness', role === 'prosecutor' ? speaker : '証言者', role === 'prosecutor'));
  return node;
}
function evidenceReader(item) {
  const node = el('article', undefined, 'case-document');
  if (!item) { node.append(el('p', '資料を選ぶと、ここに原文が表示されます。')); return node; }
  // Evidence is untrusted text: never make links, HTML, or commands executable.
  const content = el('pre', item.publicContent, 'case-document-content');
  content.tabIndex = 0; content.setAttribute('aria-label', `${item.title}の原文`);
  node.append(el('span', types[item.type] ?? item.type, 'case-eyebrow'), el('h3', item.title), content);
  return node;
}
function evidenceBrowser(items, redraw, options = {}) {
  const section = panel(options.title ?? '証拠ファイル');
  const list = el('div', undefined, 'case-file-list'); list.setAttribute('aria-label', '資料の選択');
  if (!items.some(item => item.evidenceId === view.evidence)) view.evidence = items[0]?.evidenceId ?? null;
  for (const item of items) {
    const selected = item.evidenceId === view.evidence;
    const label = `${types[item.type] ?? item.type} · ${item.title}${item.discoveryState === 'DISCOVERED' ? '［未登録］' : ''}`;
    const choice = button(label, () => { view.evidence = item.evidenceId; redraw('evidence'); },
      `case-file${selected ? ' is-selected' : ''}`);
    choice.dataset.evidenceId = item.evidenceId; choice.setAttribute('aria-pressed', String(selected));
    list.append(choice);
  }
  if (!items.length) list.append(el('p', 'まだ資料がありません。調査先と方法を選んでください。', 'case-muted'));
  section.append(list);
  const selected = items.find(item => item.evidenceId === view.evidence);
  section.append(evidenceReader(selected));
  if (selected && options.collect) section.append(button(
    selected.discoveryState === 'COLLECTED' ? '証拠ファイルに登録済み' : 'この資料を証拠として登録',
    () => options.collect(selected.evidenceId), 'case-primary', selected.discoveryState === 'COLLECTED'));
  return section;
}

export function renderGeneratedGame({ screen, game, action }) {
  const key = `${game.gameCaseId}:${game.currentState}:${game.currentRound}`;
  const changed = view.key !== key;
  const previousState = view.state;
  if (changed) { view.page = 0; view.statement = null; view.evidence = null; }
  view.key = key; view.state = game.currentState;
  const investigation = game.currentState === 'INVESTIGATION';
  screen.className = `case-game ${investigation ? 'case-investigation' : 'case-court'}`;
  document.body.classList.add('playing-generated');

  function draw(focus = '') {
    screen.replaceChildren();
    const header = el('header', undefined, 'case-topbar');
    const identity = el('div'); identity.append(el('span', 'RECORD / HEARING', 'case-eyebrow'));
    const heading = el('h1', phases[game.currentState] ?? '記録審理');
    heading.id = 'screen-title'; heading.tabIndex = -1; identity.append(heading);
    header.append(identity, el('p', game.title, 'case-title'));
    if (!['TITLE', 'INITIAL_COURT'].includes(game.currentState)) {
      const status = el('div', undefined, 'case-status');
      status.append(el('span', `争点 ${game.currentRound} / ${game.totalRounds}`));
      if (game.remainingAttempts !== undefined && !['ACQUITTED', 'BLOCKED'].includes(game.currentState)) {
        status.append(el('span', `残り提示 ${game.remainingAttempts}回`));
      }
      header.append(status);
    }
    screen.append(header);
    const progress = el('ol', undefined, 'case-issue-track'); progress.setAttribute('aria-label', '争点の進行');
    for (let round = 1; round <= game.totalRounds; round += 1) {
      const solved = round < game.currentRound || game.currentState === 'ACQUITTED';
      const item = el('li', `${String(round).padStart(2, '0')} ${solved ? '解決' : '争点'}`,
        solved ? 'is-solved' : round === game.currentRound ? 'is-current' : '');
      if (round === game.currentRound) item.setAttribute('aria-current', 'step');
      progress.append(item);
    }
    if (game.currentState !== 'TITLE') screen.append(progress);
    const body = el('div', undefined, 'case-body'); screen.append(body);
    if (game.participants?.length) {
      const people = el('aside', undefined, 'case-participants'); people.setAttribute('aria-label', '登場人物');
      for (const person of game.participants) {
        const item = el('div'); const icon = el('img'); icon.alt = '';
        icon.src = assetPath(person.publicRole === 'DEFENDANT' ? 'defendant_neutral' : 'witness_neutral');
        item.append(icon, el('span', `${person.publicRole === 'DEFENDANT' ? '被告人' : '証言者'}：${person.displayName}`));
        people.append(item);
      }
      body.append(people);
    }

    if (game.currentState === 'TITLE') {
      const intro = el('div', undefined, 'case-intro');
      intro.append(el('span', '記録と主張のあいだに、答えを探す。', 'case-eyebrow'),
        el('h2', '記録審理室'), el('p', game.synopsis),
        el('p', '調べる。照合する。根拠を示す。記録が語る範囲を見極め、争点を一つずつ解決してください。'),
        button('事件ファイルを開く', () => action('begin'), 'case-primary'));
      body.append(stage('申立て側'), intro);
    } else if (game.currentState === 'INITIAL_COURT') {
      const court = game.initialCourt;
      const pages = [...court.prosecutionStatements.map(item => ({
        speaker: item.speaker?.displayName ?? '証言者', text: item.spokenContent, role: 'prosecutor',
      })), { speaker: '審理官', text: court.publicRuling, role: 'judge' }];
      const line = pages[Math.min(view.page, pages.length - 1)];
      body.append(stage(line.speaker, line.role), dialogue(line.speaker, line.text,
        '冒頭陳述 · 証言・主張は技術的事実とは区別してください'));
      const controls = el('div', undefined, 'case-controls');
      controls.append(button('前の発言', () => { view.page -= 1; draw('dialogue'); }, '', view.page === 0),
        el('span', `${view.page + 1} / ${pages.length}`));
      controls.append(view.page < pages.length - 1
        ? button('次の発言', () => { view.page += 1; draw('dialogue'); }, 'case-primary')
        : button('調査室へ移動', () => action('continue'), 'case-primary'));
      body.append(controls, evidenceBrowser(court.presentedEvidence, draw, { title: '法廷で提示された資料' }));
    } else if (investigation) {
      const workspace = el('div', undefined, 'case-workspace');
      const targets = panel('調査デスク');
      targets.append(el('p', '調査先 → 調査方法 → 資料の登録。資料は追加調査後も保持されます。', 'case-muted'));
      if (!game.investigationTargets.some(item => item.targetId === view.target)) {
        view.target = game.investigationTargets[0]?.targetId;
      }
      const map = el('div', undefined, 'case-target-grid');
      for (const target of game.investigationTargets) {
        const choice = button(target.displayName, () => { view.target = target.targetId; draw('target'); },
          `case-target${view.target === target.targetId ? ' is-selected' : ''}`);
        choice.append(el('small', target.targetType)); choice.dataset.targetId = target.targetId;
        choice.setAttribute('aria-pressed', String(view.target === target.targetId)); map.append(choice);
      }
      targets.append(map);
      const target = game.investigationTargets.find(item => item.targetId === view.target);
      if (target) {
        targets.append(el('h3', target.displayName), el('p', target.description));
        const methods = el('div', undefined, 'case-methods');
        for (const method of target.availableActions) methods.append(button(
          `${method.displayName}${method.completed ? ' · 再確認' : ''}`,
          () => action('investigate', { targetId: target.targetId, investigationActionId: method.actionId })));
        targets.append(methods);
      }
      const result = el('div', undefined, 'case-search-result'); result.setAttribute('role', 'status');
      result.append(el('strong', '調査報告'), el('p', game.lastInvestigationResult?.publicMessage ?? '調査方法を選んで記録を確認してください。'));
      for (const hint of game.lastInvestigationResult?.nextHints ?? []) result.append(el('p', hint));
      targets.append(result);
      workspace.append(targets, evidenceBrowser(game.discoveredEvidence, draw,
        { collect: evidenceId => action('collect', { evidenceId }) }));
      body.append(workspace);
      const footer = el('div', undefined, 'case-controls');
      footer.append(el('p', `発見 ${game.discoveredEvidence.length}件 ／ 登録 ${game.collectedEvidence.length}件`),
        button('法廷へ移動', () => action('retrial'), 'case-primary',
          game.canReturnToCourt === false || !game.collectedEvidence.length));
      body.append(footer, el('p', '証拠が足りなければ再調査できます。記録だけから人物や意図を決めつけないでください。', 'case-muted'));
    } else if (game.currentState === 'RETRIAL_COURT') {
      const statements = game.testimonies.flatMap(item => item.statements.map(statement => ({
        ...statement, speaker: item.speaker?.displayName ?? '証言者' })));
      const index = Math.min(view.page, Math.max(0, statements.length - 1));
      const current = statements[index];
      body.append(stage(current?.speaker ?? '証言者'));
      if (current) {
        body.append(dialogue(current.speaker, current.spokenContent, `争点 ${game.currentRound} · 証言 ${index + 1} / ${statements.length}`));
        const nav = el('div', undefined, 'case-controls');
        nav.append(button('前の証言', () => { view.page -= 1; draw('dialogue'); }, '', index === 0),
          button(view.statement === current.statementId ? '指摘対象として選択中' : 'この発言を指摘する',
            () => { view.statement = current.statementId; draw('statement'); }, 'case-select'),
          button('次の証言', () => { view.page += 1; draw('dialogue'); }, '', index === statements.length - 1));
        body.append(nav);
      }
      body.append(evidenceBrowser(game.presentableEvidence, draw, { title: '照合する証拠を選択' }));
      const chosen = statements.find(item => item.statementId === view.statement);
      const selection = el('section', undefined, 'case-presentation');
      selection.append(el('h2', '提示の確認'), el('p', chosen ? `指摘する発言：${chosen.spokenContent}` : '指摘する発言を選んでください。'),
        el('p', `証拠：${game.presentableEvidence.find(item => item.evidenceId === view.evidence)?.title ?? '未選択'}`));
      const controls = el('div', undefined, 'case-controls');
      if (game.canInvestigate) controls.append(button('提示せず追加調査へ', () => action('investigation')));
      controls.append(button('この証拠で主張を検証', () => action('objection', {
        statementId: view.statement, evidenceId: view.evidence }), 'case-primary', !chosen || !view.evidence));
      selection.append(controls); body.append(selection);
    } else if (game.currentState === 'GUILTY_RETRY') {
      body.append(stage('審理官', 'judge'), dialogue('審理官', game.publicFailureFeedback, '立証は未成立'),
        el('p', '解決済みの争点と登録した証拠は失われません。記録の意味と、証言が主張している範囲を再確認してください。', 'case-hint'),
        button('調査室へ戻って再検討', () => action('retry'), 'case-primary'));
    } else if (game.currentState === 'ACQUITTED') {
      body.append(stage('審理官', 'judge'), el('div', 'すべての争点を解決', 'case-verdict'),
        dialogue('審理官', game.acquittal.publicRuling, '最終判断'),
        el('p', game.acquittal.publicExplanation, 'case-hint'),
        el('p', 'この結論は、提示された資料とその証明可能な範囲に基づきます。', 'case-muted'));
    } else if (game.currentState === 'BLOCKED') {
      body.append(stage('審理官', 'judge'), dialogue('審理官', game.blockedMessage, '提示回数の上限'),
        el('p', 'この審理は終了しました。画面の再読み込みによる再開では、新しいプレイセッションになります。', 'case-hint'));
    }
    if (focus) {
      const candidates = [...screen.querySelectorAll('button')];
      const selected = focus === 'evidence' ? candidates.find(node => node.dataset.evidenceId === view.evidence)
        : focus === 'target' ? candidates.find(node => node.dataset.targetId === view.target)
          : screen.querySelector(focus === 'dialogue' ? '.case-dialogue' : '.case-presentation');
      if (selected) { if (selected.tagName !== 'BUTTON') selected.tabIndex = -1; selected.focus(); }
    }
  }
  draw();
  if (changed) {
    screen.querySelector('#screen-title').focus({ preventScroll: true });
    if (previousState && game.currentState !== 'TITLE') {
      const transition = el('div', undefined, 'case-transition'); transition.setAttribute('aria-hidden', 'true');
      const nextIssue = game.result?.hasNextRound && investigation;
      transition.append(el('small', nextIssue ? '争点解決 / 次の審理へ' : '場面転換'),
        el('strong', phases[game.currentState]), el('span', `争点 ${game.currentRound} / ${game.totalRounds}`));
      screen.append(transition);
      transition.addEventListener('animationend', () => transition.remove(), { once: true });
      // Fallback for reduced motion and browsers that do not dispatch animationend.
      setTimeout(() => transition.remove(), 1600);
    }
  }
}
