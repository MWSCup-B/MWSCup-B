import { assetPath } from './visual-assets.js';
import { renderInvestigationWorkspace } from './investigation-workspace.js';
import { gameAudio } from './game-audio.js';

const compactCourt = globalThis.matchMedia?.('(max-width: 720px)');
let redrawForViewport = null;
compactCourt?.addEventListener('change', () => redrawForViewport?.());

// View state contains selections only. Progress, ownership and verdicts belong to the server.
const view = { key: '', state: '', page: 0, target: null, evidence: null, deskEvidence: null, statement: null,
  interpretation: null, discoveryKey: '', scriptFinished: false, evidencePage: 0, filePage: 0, referencePage: 0,
  textPages: {}, choicePage: 0, material: null, submission: false, filters: {}, caseId: null };
const phases = { TITLE: '事件ファイル', INITIAL_COURT: '事件報告書', INVESTIGATION: '調査パート',
  RETRIAL_COURT: '法廷パート', GUILTY_RETRY: 'もう一度、調べよう', ACQUITTED: '判決', BLOCKED: '審理終了' };
const types = { EMAIL: 'メール', WEB_ACCESS_LOG: 'アクセス記録', TESTIMONY: '供述調書',
  NETWORK_LOG: '通信記録', APPLICATION_LOG: 'アプリケーション記録', FILE_METADATA: 'ファイル検査', DOCUMENT: '保存文書・設定',
  AUTHENTICATION_LOG: '認証記録', DEVICE_INFORMATION: '端末・実行計測資料', DATABASE_LOG: 'データベース記録' };
const targetTypes = { MAILBOX: ['メール保管庫', 'mail'], SERVER: ['サーバー', 'server'],
  ENDPOINT: ['端末', 'device'], LOG_SOURCE: ['ログ保管先', 'log'],
  NETWORK_DEVICE: ['ネットワーク機器', 'network'], FILE_SYSTEM: ['文書・供述資料', 'file'],
  BROWSER: ['ブラウザ', 'browser'], APPLICATION: ['アプリケーション', 'browser'] };
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
function portrait(role, name) {
  const figure = el('figure', undefined, 'case-person is-speaking');
  const img = el('img'); img.src = assetPath(['assistant', 'defense', 'prosecutor', 'judge'].includes(role) ? `${role}_penguin_v1` : role === 'assistant' ? 'assistant_portrait_v1'
    : ['defense', 'prosecutor'].includes(role) ? `${role}_portrait_v2` : `${role}_neutral`); img.alt = '';
  figure.setAttribute('aria-label', name);
  figure.append(img); return figure;
}
function panel(title) {
  const node = el('section', undefined, 'case-panel'); node.append(el('h2', title)); return node;
}
function dialogue(speaker, text) {
  const box = el('section', undefined, 'case-dialogue');
  box.setAttribute('aria-label', '会話');
  box.append(el('h2', speaker), el('p', text)); return box;
}
function reference(speaker, text, badge) {
  const box = el('aside', undefined, 'case-reference');
  box.setAttribute('aria-label', badge || speaker);
  box.append(el('span', badge, 'case-eyebrow'), el('strong', speaker), el('p', text));
  return box;
}
function sceneLine(line) {
  // Quoted testimony and player hypotheses are records, not a character's spoken line.
  if (!/引用|推理|確認できたこと/.test(line.badge ?? '')) return dialogue(line.speaker, line.text);
  const box = el('aside', undefined, 'case-reference case-scene-reference');
  box.setAttribute('aria-label', line.badge);
  box.append(el('h2', line.speaker), el('p', line.text));
  return box;
}
function hypothesisReference(text, redraw) {
  const pages = sourcePages(text, compactCourt?.matches ? 2 : 6);
  view.referencePage = Math.min(view.referencePage, pages.length - 1);
  const box = sceneLine({ speaker: '弁護士（あなた）', text: pages[view.referencePage], badge: 'あなたの推理 · まだ確認前' });
  if (pages.length > 1) {
    const controls = el('div', undefined, 'case-document-pages');
    controls.append(button('前の推理', () => { view.referencePage -= 1; redraw('hypothesis'); }, '', view.referencePage === 0),
      el('span', `${view.referencePage + 1} / ${pages.length}`),
      button('推理の続き', () => { view.referencePage += 1; redraw('hypothesis'); }, '', view.referencePage === pages.length - 1));
    box.append(controls);
  }
  return box;
}
function assistantPortrait() {
  const guide = el('aside', undefined, 'case-assistant-guide');
  guide.setAttribute('aria-label', '調査助手');
  guide.append(portrait('assistant', '調査助手'));
  return guide;
}
function stage(speaker = '証言者', role = 'witness') {
  const safeRole = ['defense', 'prosecutor', 'judge', 'witness', 'assistant'].includes(role) ? role : 'witness';
  const node = el('div', undefined, `case-stage case-stage-${safeRole}`);
  node.setAttribute('aria-label', `${speaker}の発言`);
  node.dataset.speakerRole = safeRole;
  node.append(portrait(safeRole, safeRole === 'defense' ? '弁護士（あなた）' : speaker));
  const bench = el('div', undefined, 'case-bench'); bench.setAttribute('aria-hidden', 'true');
  node.append(bench);
  return node;
}

// Keep the complete source, including whitespace, across pages. Paging is display-only.
function sourcePages(source, maxLines = 6, columns = 30) {
  const pages = []; let page = ''; let lines = 1; let column = 0;
  for (const character of source) {
    if (lines > maxLines) {
      pages.push(page); page = ''; lines = 1; column = 0;
    }
    page += character;
    if (character === '\n') { lines += 1; column = 0; }
    else { column += character === '\t' ? 4 : 1; if (column >= columns) { lines += 1; column = 0; } }
  }
  if (page || !pages.length) pages.push(page);
  return pages;
}

function pagedText(key, speaker, text, redraw, { spoken = false, lines = compactCourt?.matches ? 4 : 7,
  columns = compactCourt?.matches ? 20 : 36 } = {}) {
  const pages = sourcePages(text, lines, columns);
  const index = Math.min(view.textPages[key] ?? 0, pages.length - 1);
  const box = spoken ? dialogue(speaker, pages[index]) : reference(speaker, pages[index], '');
  box.className += ' case-paged-text';
  box.dataset.textKey = key;
  if (pages.length > 1) {
    const controls = el('div', undefined, 'case-document-pages');
    controls.append(button('前の文', () => { view.textPages[key] = index - 1; redraw(); }, '', index === 0),
      el('span', `${index + 1} / ${pages.length}`),
      button('続きを読む', () => { view.textPages[key] = index + 1; redraw(); }, '', index === pages.length - 1));
    box.append(controls);
  }
  return box;
}
function courtEvidenceReader(item, redraw, lines = compactCourt?.matches ? 5 : 6) {
  const node = el('article', undefined, 'case-document case-court-document');
  if (!item) { node.append(el('p', '資料を選ぶと、ここに原文が表示されます。')); return node; }
  const pages = sourcePages(item.publicContent, lines, compactCourt?.matches ? 26 : 30);
  view.evidencePage = Math.min(view.evidencePage, pages.length - 1);
  node.append(el('span', `${types[item.type] ?? '資料'} · 原文`, 'case-eyebrow'), el('h3', item.title));
  const original = el('pre', pages[view.evidencePage], 'case-court-source'); original.tabIndex = 0;
  original.setAttribute('aria-label', `${item.title}の原文 ${view.evidencePage + 1}ページ`);
  node.append(original);
  const controls = el('div', undefined, 'case-document-pages');
  controls.append(button('前のページ', () => { view.evidencePage -= 1; redraw('document'); }, '', view.evidencePage === 0),
    el('span', `${view.evidencePage + 1} / ${pages.length}`),
    button('次のページ', () => { view.evidencePage += 1; redraw('document'); }, '', view.evidencePage === pages.length - 1));
  node.append(controls); return node;
}

function investigationViewer(game, redraw) {
  const currentIds = new Set(game.currentEvidenceIds ?? game.discoveredEvidence.map(item => item.evidenceId));
  const current = game.collectedEvidence.filter(item => currentIds.has(item.evidenceId));
  const previous = game.collectedEvidence.filter(item => !currentIds.has(item.evidenceId));
  const items = [...current, ...previous];
  if (!items.some(item => item.evidenceId === view.deskEvidence)) view.deskEvidence = items[0]?.evidenceId ?? null;
  const workbench = el('div', undefined, `case-evidence-workbench${items.length <= 1 ? ' is-single' : ''}`);
  if (items.length > 1) {
    const list = el('nav', undefined, 'case-evidence-selector'); list.setAttribute('aria-label', '閲覧する証拠を切り替える');
    for (const [label, group] of [['今回の証拠', current], ['これまでの証拠', previous]]) {
      if (!group.length) continue;
      list.append(el('h3', label));
      for (const item of group) {
        const selected = item.evidenceId === view.deskEvidence;
        const choice = button('', () => { view.deskEvidence = item.evidenceId; redraw('viewer-evidence'); },
          `case-evidence-card${selected ? ' is-selected' : ''}`);
        const symbol = el('span', item.type === 'EMAIL' ? '✉' : item.type.endsWith('_LOG') ? '≡' : '▤', 'case-evidence-symbol');
        symbol.setAttribute('aria-hidden', 'true');
        choice.append(symbol, el('strong', item.title), el('small', types[item.type] ?? '資料'));
        choice.dataset.viewerEvidenceId = item.evidenceId;
        choice.setAttribute('aria-pressed', String(selected)); choice.setAttribute('aria-controls', 'case-active-evidence');
        list.append(choice);
      }
    }
    workbench.append(list);
  }
  const reading = el('div', undefined, 'case-evidence-reading');
  const selected = items.find(item => item.evidenceId === view.deskEvidence);
  const display = el('div', undefined, 'case-active-evidence'); display.id = 'case-active-evidence';
  display.setAttribute('aria-label', '選択中の証拠');
  display.append(el('p', selected ? `${currentIds.has(selected.evidenceId) ? '今回の証拠' : '取得済みの証拠'} · ${items.indexOf(selected) + 1} / ${items.length}` : '資料なし', 'case-evidence-counter'),
    evidenceReader(selected));
  reading.append(display); workbench.append(reading);
  return { workbench, reading };
}

function creationLink() {
  const link = el('a', 'ゲーム制作へ戻る', 'case-return-link');
  link.href = '/author#mode';
  link.setAttribute('aria-label', 'この審理を離れ、ゲーム制作画面に戻る');
  return link;
}

function materialDesk(game, redraw, action) {
  const desk = el('div', undefined, 'case-material-desk');
  const list = panel(view.submission ? 'どの資料から証拠を得ましたか？' : '資料を選んで調べる');
  list.className += ' case-material-list';
  const materials = game.workbench.workspaceVersion && view.submission
    ? game.workbench.materials.filter(item => item.collected) : game.workbench.materials;
  if (!materials.some(item => item.materialId === view.material)) view.material = materials[0]?.materialId;
  for (const item of materials) {
    const selected = item.materialId === view.material;
    const choice = button(`${item.label}${item.collected ? '（確認済み）' : ''}`, () => {
      view.material = item.materialId; view.interpretation = null;
      if (!item.collected && !view.submission) action('inspect-material', { materialId: item.materialId, methodId: 'read' });
      else redraw('material');
    }, selected ? 'is-selected' : '');
    choice.dataset.materialId = item.materialId; choice.setAttribute('aria-pressed', String(selected)); list.append(choice);
  }
  const material = materials.find(item => item.materialId === view.material);
  const work = panel(view.submission ? '証拠と反論を選ぶ' : '資料を調べる');
  work.className += ' case-material-work';
  work.append(assistantPortrait());
  if (game.investigationClaim) work.append(reference('検察側の主張',
    game.investigationClaim.spokenContent, `争点 ${game.currentRound}`));
  const toggle = button(view.submission ? '資料の調査へ戻る' : '提出する証拠を決める', () => {
    if (game.workbench.workspaceVersion) { view.workspace.mode = 'scene'; redraw(); return; }
    view.submission = !view.submission; view.interpretation = null; redraw();
  });
  work.append(toggle);
  if (material && !view.submission) {
    const source = (game.collectedEvidence ?? []).find(item => item.evidenceId === material.materialId);
    if (source) work.append(searchableSource(source));
    else work.append(button('原文を開く', () => action('inspect-material', { materialId: material.materialId, methodId: 'read' }), 'case-primary'));
  } else if (material?.question) {
    work.append(el('p', '選んだ資料を根拠に、どの反論を提示しますか。'));
    const choices = el('div', undefined, 'case-interpretations'); choices.setAttribute('aria-label', '反対主張の4択');
    material.question.choices.forEach((choice, index) => {
      const option = button(`${String.fromCharCode(65 + index)}. ${reasoningText(choice.text)}`, () => {
        view.interpretation = choice.choiceId; redraw('interpretation');
      }, `case-interpretation${view.interpretation === choice.choiceId ? ' is-selected' : ''}`);
      option.dataset.choiceId = choice.choiceId; option.setAttribute('aria-pressed', String(view.interpretation === choice.choiceId)); choices.append(option);
    });
    work.append(choices, button('この資料と主張で法廷へ', () => action('retrial', {
      evidenceId: material.materialId, interpretationChoiceId: view.interpretation }), 'case-primary', !view.interpretation));
  } else work.append(el('p', '資料の原文を開き、関連する記録を調査してください。'));
  desk.append(list, work); return desk;
}

// Legacy questions can contain the attack's name. Keep their answer IDs intact,
// but do not disclose the name in an unjudged hypothesis. Never edit source text.
function reasoningText(text) {
  return text.replace(/(?:Stored|Reflected)\s*XSS|SQLインジェクション|(?:蓄積|格納|反射)型XSS|クロスサイトスクリプティング/gi, 'この攻撃');
}

function searchableSource(item) {
  const node = el('section', undefined, 'case-searchable-source');
  const label = el('label', '原文を絞り込む（空白で区切って複数指定）');
  const input = el('input'); input.type = 'search'; input.maxLength = 200;
  input.value = view.filters[item.evidenceId] ?? ''; input.setAttribute('aria-label', '原文の検索文字列');
  label.append(input);
  const count = el('p', '', 'case-muted'); count.setAttribute('role', 'status');
  const output = el('pre', '', 'case-filtered-source'); output.tabIndex = 0;
  output.setAttribute('aria-label', `${item.title}の原文と行番号`);
  const lines = item.publicContent.replace(/\n$/, '').split('\n');
  const update = () => {
    view.filters[item.evidenceId] = input.value;
    const terms = input.value.trim().split(/\s+/).filter(Boolean);
    const matches = lines.map((line, index) => ({ line, index }))
      .filter(({ line }) => terms.every(term => line.toLowerCase().includes(term.toLowerCase())));
    count.textContent = `${matches.length} / ${lines.length} 行${terms.length ? '（絞り込み中）' : '（全文）'}`;
    output.textContent = matches.map(({ line, index }) => `${index + 1}  ${line}`).join('\n');
  };
  input.addEventListener('input', update);
  node.append(el('h3', item.title), label, button('全文に戻す', () => { input.value = ''; update(); input.focus(); }), count, output);
  update(); return node;
}

export function caseStudyView(study) {
  const node = el('article', undefined, 'case-study');
  node.append(el('h2', '事件の解説資料'), el('h3', '発生していたインシデント'), el('p', study.incident));
  node.append(el('h3', '資料の調べ方'));
  node.append(el('p', 'まず資料全体を確認し、事件の時刻や対象を手がかりに候補を絞ります。残った記録を前後の行や別の資料と照合し、同じ対象のどの処理を記録したものかを確かめます。検索に一致したことだけで、その記録が事件の原因だとは決まりません。'));
  for (const item of study.materials) {
    const section = el('details'); section.append(el('summary', item.label));
    if (item.vocabulary) section.append(el('p', item.vocabulary));
    for (const step of item.procedures) section.append(el('p', `${step.label} — ${step.description}`));
    const source = el('pre', item.content); source.tabIndex = 0; section.append(source); node.append(section);
  }
  for (const [index, issue] of study.issues.entries()) {
    const section = el('section', undefined, 'case-study-issue');
    section.append(el('h3', `争点 ${index + 1} の調査と結論`));
    if (issue.claim) section.append(el('h4', '検察側の主張'), el('p', issue.claim));
    if (issue.references?.length) {
      section.append(el('h4', '判断の根拠になった記録'));
      for (const ref of issue.references) {
        section.append(el('p', ref.title), el('pre', ref.quote));
      }
    }
    if (issue.answer) section.append(el('h4', '証拠から導ける反論'), el('p', issue.answer));
    section.append(el('h4', '読み解き方と、判断できる範囲'), el('p', issue.explanation));
    node.append(section);
  }
  return node;
}

function evidenceReader(item) {
  const node = el('article', undefined, 'case-document');
  if (!item) { node.append(el('p', '資料を選ぶと、ここに原文が表示されます。')); return node; }
  const mail = item.type === 'EMAIL';
  const testimony = item.type === 'TESTIMONY';
  const device = item.type === 'DEVICE_INFORMATION';
  const log = ['WEB_ACCESS_LOG', 'NETWORK_LOG', 'APPLICATION_LOG', 'AUTHENTICATION_LOG', 'DATABASE_LOG'].includes(item.type);
  node.className += mail ? ' case-mail-viewer' : log ? ' case-log-viewer' : ' case-record-sheet';
  const chrome = el('header', undefined, 'case-document-toolbar');
  chrome.append(el('span', mail ? 'メール保管庫' : log ? 'ログビューアー' : device ? '端末調査票' : testimony ? '供述調書' : '資料閲覧', 'case-document-app'),
    el('span', '教材用資料 · 読み取り専用', 'case-document-mode'));
  node.append(chrome, el('span', types[item.type] ?? '資料', 'case-eyebrow'), el('h3', item.title));
  // Evidence is untrusted text: never make links, HTML, or commands executable.
  const content = el('pre', item.publicContent, 'case-document-content');
  content.tabIndex = 0; content.setAttribute('aria-label', `${item.title}の原文`);
  const lines = item.publicContent.split(/\r?\n/);
  let formatted = false;
  if (mail) {
    const headerNames = { from: '差出人', to: '宛先', subject: '件名', date: '日時', cc: 'Cc',
      'content-type': '形式', '差出人': '差出人', '宛先': '宛先', '件名': '件名', '日時': '日時' };
    const fields = el('dl', undefined, 'case-mail-fields');
    const bodyLines = [];
    let readingHeaders = true;
    for (const text of lines) {
      const match = readingHeaders && /^(From|To|Subject|Date|Cc|Content-Type|差出人|宛先|件名|日時)\s*[:：]\s*(.*)$/i.exec(text);
      if (match) fields.append(el('dt', headerNames[match[1].toLowerCase()]), el('dd', match[2]));
      else {
        bodyLines.push(text);
        // Synthetic labels may precede headers; never pull header-looking lines out of the body.
        if (fields.children.length || !/^(?:教材用|合成|保存メール)/.test(text)) readingHeaders = false;
      }
    }
    if (fields.children.length) node.append(fields);
    const body = el('div', undefined, 'case-mail-body');
    body.append(el('pre', bodyLines.join('\n'), 'case-mail-text'));
    node.append(body); formatted = true;
  } else if (log) {
    const scroll = el('div', undefined, 'case-log-scroll'); scroll.tabIndex = 0;
    scroll.setAttribute('aria-label', `${item.title}の記録一覧`);
    const previewLines = lines.slice(0, lines.at(-1) === '' ? -1 : undefined);
    let records = null;
    try {
      const parsed = previewLines.map(line => JSON.parse(line));
      if (parsed.length && parsed.every((record, index) => record && typeof record === 'object' && !Array.isArray(record)
        && Object.keys(record).length && JSON.stringify(record) === previewLines[index])) records = parsed;
    } catch { /* Preserve legacy native logs verbatim. */ }
    const columns = records ? [...new Set(records.flatMap(record => Object.keys(record)))] : [];
    const table = el('table', undefined, 'case-log-table');
    const head = el('thead'); const headings = el('tr');
    headings.append(el('th', '行'));
    for (const label of records ? columns : ['記録（原文）']) headings.append(el('th', label));
    head.append(headings); table.append(head);
    const rows = el('tbody');
    for (const [index, text] of previewLines.entries()) {
      const row = el('tr'); row.append(el('td', String(index + 1), 'case-line-number'));
      const values = records ? columns.map(key => !Object.hasOwn(records[index], key) ? ''
        : JSON.stringify(records[index][key])) : [text];
      for (const value of values) row.append(el('td', value));
      rows.append(row);
    }
    table.append(rows); scroll.append(table); node.append(scroll);
    node.append(el('p', '行番号は閲覧用です。元の記録には含まれません。', 'case-document-note'));
    formatted = true;
  } else if (device || testimony) {
    const sheet = el('div', undefined, 'case-sheet-body');
    sheet.append(content);
    node.append(el('p', testimony ? '証言者の主張 · 技術的事実とは分けて確認' : '計測資料 · 記録された項目を確認', 'case-document-note'), sheet);
    formatted = true;
  }
  if (!formatted) node.append(content);
  return node;
}
function evidenceBrowser(items, redraw, options = {}) {
  const section = panel(options.title ?? '証拠ファイル');
  section.className += ' case-evidence-browser';
  const list = el('div', undefined, 'case-file-list'); list.setAttribute('aria-label', '資料の選択');
  if (!items.some(item => item.evidenceId === view.evidence)) view.evidence = options.autoSelect === false ? null : items[0]?.evidenceId ?? null;
  const paged = options.court === true;
  const filesPerPage = compactCourt?.matches ? 2 : 4;
  const pageCount = Math.max(1, Math.ceil(items.length / filesPerPage));
  view.filePage = Math.min(view.filePage, pageCount - 1);
  for (const item of paged ? items.slice(view.filePage * filesPerPage, (view.filePage + 1) * filesPerPage) : items) {
    const selected = item.evidenceId === view.evidence;
    const label = `${types[item.type] ?? item.type} · ${item.title}${item.discoveryState === 'DISCOVERED' ? '［未登録］' : ''}`;
    const choice = button(label, () => { view.evidence = item.evidenceId; view.evidencePage = 0; redraw('evidence'); },
      `case-file${selected ? ' is-selected' : ''}`);
    choice.dataset.evidenceId = item.evidenceId; choice.setAttribute('aria-pressed', String(selected));
    list.append(choice);
  }
  if (!items.length) list.append(el('p', 'まだ資料がありません。調査先と方法を選んでください。', 'case-muted'));
  section.append(list);
  if (paged && pageCount > 1) {
    const pages = el('div', undefined, 'case-document-pages');
    pages.append(button('前の資料一覧', () => { view.filePage -= 1; redraw(); }, '', view.filePage === 0),
      el('span', `資料一覧 ${view.filePage + 1} / ${pageCount}`),
      button('次の資料一覧', () => { view.filePage += 1; redraw(); }, '', view.filePage === pageCount - 1));
    section.append(pages);
  }
  const selected = items.find(item => item.evidenceId === view.evidence);
  section.append(paged ? courtEvidenceReader(selected, redraw, options.sourceLines) : evidenceReader(selected));
  if (selected && options.collect) section.append(button(
    selected.discoveryState === 'COLLECTED' ? '証拠ファイルに登録済み' : 'この資料を証拠として登録',
    () => options.collect(selected.evidenceId), 'case-primary', selected.discoveryState === 'COLLECTED'));
  return section;
}

// Presentation-only compatibility for saved reports. Evidence bytes remain untouched.
function reportText(value = '') {
  return value.replaceAll('具体的な手口と、主張を裏付ける証拠は調査と審理で確認します。', '')
    .replaceAll('具体的な裏付けと記録の意味は、これからの調査と審理で確認します。', '').trim();
}

export function renderGeneratedGame({ screen, game, action }) {
  if (view.caseId !== game.gameCaseId) { view.caseId = game.gameCaseId; view.filters = {}; view.material = null; view.workspace = {}; view.explanationOpen = false; }
  const key = `${game.gameCaseId}:${game.currentState}:${game.currentRound}`;
  const changed = view.key !== key;
  if (changed && view.workspace) { view.workspace.mode = 'scene'; view.workspace.tool = null; }
  const previousState = view.state;
  if (changed) { view.page = 0; view.statement = null; view.evidence = null; view.deskEvidence = null; view.interpretation = null; view.scriptFinished = false; view.evidencePage = 0; view.filePage = 0; view.referencePage = 0; view.textPages = {}; view.choicePage = 0; view.submission = false; }
  view.key = key; view.state = game.currentState;
  const investigation = game.currentState === 'INVESTIGATION';
  const sequential = game.investigationMode === 'SEQUENTIAL_TARGETS';
  if (investigation) {
    const discovered = game.lastInvestigationResult?.discoveredEvidenceIds ?? [];
    const discoveryKey = `${game.gameCaseId}:${discovered.join(',')}`;
    if (discovered.length && discoveryKey !== view.discoveryKey) view.evidence = discovered[0];
    view.discoveryKey = discoveryKey;
  }
  const court = game.currentState === 'RETRIAL_COURT';
  document.body.classList.add('playing-generated');

  function draw(focus = '') {
    if (game.currentState === 'ACQUITTED' && view.explanationOpen) gameAudio.setScene('explanation');
    else gameAudio.forGame(game);
    const cinematic = game.currentState !== 'INITIAL_COURT' && !!game.dialogue?.length && !view.scriptFinished;
    const viewport = court || cinematic || ['TITLE', 'GUILTY_RETRY', 'ACQUITTED', 'BLOCKED'].includes(game.currentState);
    const inCourt = !investigation || (cinematic && !!game.result);
    screen.className = `case-game ${inCourt ? 'case-court' : 'case-investigation'}${viewport ? ' case-court-viewport' : ''}${game.currentState === 'ACQUITTED' && !cinematic ? ' case-final-verdict' : ''} case-state-${game.currentState.toLowerCase()}`;
    if (investigation && game.workbench?.workspaceVersion && !cinematic) screen.className += ' case-has-workspace';
    screen.replaceChildren();
    const header = el('header', undefined, 'case-topbar');
    const identity = el('div'); identity.append(el('span', 'RECORD / HEARING', 'case-eyebrow'));
    const heading = el('h1', phases[game.currentState] ?? '記録審理');
    heading.id = 'screen-title'; heading.tabIndex = -1; identity.append(heading);
    header.append(identity, el('p', game.title, 'case-title'), el('span', '主人公：弁護士（あなた）', 'case-player-role'));
    if (!['TITLE', 'INITIAL_COURT'].includes(game.currentState)) {
      const status = el('div', undefined, 'case-status');
      status.append(el('span', `${sequential ? '調査' : '争点'} ${game.currentRound} / ${game.totalRounds}`));
      if (game.remainingAttempts !== undefined && !['ACQUITTED', 'BLOCKED'].includes(game.currentState)) {
        status.append(el('span', `残り提示 ${game.remainingAttempts}回`));
      }
      header.append(status);
    }
    header.append(creationLink());
    gameAudio.attach(header);
    screen.append(header);
    const progress = el('ol', undefined, 'case-issue-track'); progress.setAttribute('aria-label', '争点の進行');
    for (let round = 1; round <= game.totalRounds; round += 1) {
      const solved = round < game.currentRound || game.currentState === 'ACQUITTED';
      const item = el('li', `${String(round).padStart(2, '0')} ${solved ? '解決' : '争点'}`,
        solved ? 'is-solved' : round === game.currentRound ? 'is-current' : '');
      if (round === game.currentRound) item.setAttribute('aria-current', 'step');
      progress.append(item);
    }
    if (!['TITLE', 'INITIAL_COURT'].includes(game.currentState)) screen.append(progress);
    let body = el('div', undefined, 'case-body'); screen.append(body);

    if (cinematic) {
      const script = game.dialogue.flatMap(line => sourcePages(line.text, compactCourt?.matches ? 5 : 6,
        compactCourt?.matches ? 20 : 48).map(text => ({ ...line, text })));
      const line = script[Math.min(view.page, script.length - 1)];
      const scene = el('div', undefined, 'case-cinematic');
      scene.append(stage(line.speaker, line.role), sceneLine(line));
      const controls = el('div', undefined, 'case-controls');
      controls.append(button('前の台詞', () => { view.page -= 1; draw('dialogue'); }, '', view.page === 0),
        el('span', `${view.page + 1} / ${script.length}`),
        view.page < script.length - 1
          ? button('次の台詞', () => { view.page += 1; draw('dialogue'); }, 'case-primary')
          : button(investigation ? '調査を始める' : game.currentState === 'ACQUITTED' ? '判決を確認する' : '証拠を選ぶ',
            () => { view.scriptFinished = true; draw(); screen.querySelector('#screen-title').focus(); }, 'case-primary'));
      scene.append(controls); body.append(scene); return;
    }

    if (game.currentState === 'TITLE') {
      const intro = el('div', undefined, 'case-intro');
      intro.append(el('span', '記録と主張のあいだに、答えを探す。', 'case-eyebrow'),
        el('h2', 'インシデントクラフト'), el('p', 'あなたは、この事件を担当する弁護士。被告人の弁護を引き受けた。'),
        el('p', '疑いを、証拠で確かめる。まずは事件報告書を開こう。'),
        button('事件ファイルを開く', () => action('begin'), 'case-primary'));
      const opening = el('div', undefined, 'case-opening');
      opening.append(stage('弁護士（あなた）', 'defense'), intro); body.append(opening);
    } else if (game.currentState === 'INITIAL_COURT') {
      const court = game.initialCourt;
      const report = el('article', undefined, 'case-incident-report');
      report.setAttribute('aria-label', '事件報告書');
      report.append(el('span', '検察官作成 · 有罪を求める理由書 · 教材内の架空設定', 'case-eyebrow'),
        el('h2', '事件報告書'), el('h3', '被害の概要'), el('p', reportText(court.incidentOverview ?? game.synopsis), 'case-incident-overview'),
        el('h3', '被告人に対する嫌疑と根拠'), el('p', reportText(court.prosecutionOpening ?? '検察側は、次の提出資料と供述を嫌疑の根拠としています。'), 'case-allegation'),
        el('h3', '提出資料'));
      for (const item of court.presentedEvidence) report.append(evidenceReader(item));
      for (const item of court.presentedMaterials ?? []) report.append(el('p', item.label));
      report.append(el('h3', '関係者の供述'));
      for (const item of court.prosecutionStatements) report.append(el('p',
        `${item.speaker?.displayName ?? '証言者'}「${item.spokenContent}」`));
      report.append(button('報告書を読んで調査へ', () => action('continue'), 'case-primary'));
      body.append(report);
    } else if (investigation && game.workbench) {
      if (game.workbench.workspaceVersion) body.append(renderInvestigationWorkspace(game, view.workspace ??= {}, action, draw,
        { el, button, submission: () => { view.submission = true; return materialDesk(game, draw, action); } }));
      else body.append(materialDesk(game, draw, action));
    } else if (investigation && sequential) {
      const desk = el('div', undefined, 'case-investigation-desk');
      desk.append(assistantPortrait()); body.append(desk); body = desk;
      const workspace = panel('証拠を読んで、推理する');
      workspace.className += ' case-reasoning-desk';
      workspace.append(el('p', `今回の資料：${game.investigationTargets[0]?.displayName ?? '調査資料'}`, 'case-desk-source'));
      const { workbench, reading } = investigationViewer(game, draw);
      const reasoning = el('section', undefined, 'case-evidence-reasoning');
      reasoning.setAttribute('aria-label', '証拠から何が言えるか');
      if (game.courtQuestion) {
        if (game.investigationClaim) reasoning.append(reference(game.investigationClaim.speaker?.displayName ?? '証言者',
          game.investigationClaim.spokenContent, '今回確かめる証言 · 証言者の主張'));
        reasoning.append(el('h3', game.courtQuestion.prompt));
        const choices = el('div', undefined, 'case-interpretations'); choices.setAttribute('aria-label', '推理の4択');
        game.courtQuestion.choices.forEach((choice, index) => {
          const selected = view.interpretation === choice.choiceId;
          const option = button(`${String.fromCharCode(65 + index)}. ${choice.text}`, () => {
            view.interpretation = choice.choiceId; draw('interpretation');
          }, `case-interpretation${selected ? ' is-selected' : ''}`);
          option.dataset.choiceId = choice.choiceId; option.setAttribute('aria-pressed', String(selected)); choices.append(option);
        });
        reasoning.append(choices);
      } else reasoning.append(el('p', '調査資料を準備できていません。ゲームの状態を確認してください。', 'case-muted'));
      const controls = el('div', undefined, 'case-controls');
      controls.append(button('この推理で法廷へ', () => action('retrial', { interpretationChoiceId: view.interpretation }),
        'case-primary', !game.canReturnToCourt || !game.courtQuestion || !view.interpretation));
      reasoning.append(controls); reading.append(reasoning); workspace.append(workbench); body.append(workspace);
    } else if (investigation) {
      body.append(assistantPortrait());
      const workspace = el('div', undefined, 'case-workspace');
      const targets = panel(sequential ? '1. 今回の調査先' : '1. 調査する対象を選ぶ');
      targets.append(el('p', sequential ? 'この場所に残った手がかりを集めよう。法廷で確かめたら、次の調査先へ。'
        : '調査先 → 調査方法 → 資料の登録。資料は追加調査後も保持されます。', 'case-muted'));
      if (!game.investigationTargets.some(item => item.targetId === view.target)) {
        view.target = game.investigationTargets[0]?.targetId;
      }
      const map = el('div', undefined, 'case-target-grid');
      for (const target of game.investigationTargets) {
        const [label, icon] = targetTypes[target.targetType] ?? ['調査資料', 'file'];
        const status = target.availableActions.some(method => method.status === 'READY') ? '調査できます'
          : target.availableActions.every(method => method.status === 'COMPLETE') ? '資料を発見済み' : '対象を選んで方法を確認';
        const choice = button('', () => { view.target = target.targetId; draw('target'); },
          `case-target${view.target === target.targetId ? ' is-selected' : ''}`);
        const symbol = el('span', undefined, `case-target-icon icon-${icon}`); symbol.setAttribute('aria-hidden', 'true');
        choice.append(symbol, el('strong', target.displayName), el('small', label), el('span', status, 'case-target-status'));
        choice.dataset.targetId = target.targetId;
        choice.setAttribute('aria-pressed', String(view.target === target.targetId)); map.append(choice);
      }
      targets.append(map);
      const target = game.investigationTargets.find(item => item.targetId === view.target);
      if (target) {
        targets.append(el('h3', '2. 調査方法を選ぶ'), el('p', target.description));
        const methods = el('div', undefined, 'case-methods');
        for (const method of target.availableActions) {
          const card = el('div', undefined, 'case-method-card');
          card.append(button(method.displayName,
            () => action('investigate', { targetId: target.targetId, investigationActionId: method.actionId }), '', method.status === 'WAITING'),
          el('p', method.description ?? 'この対象が保管している資料を確認します。'),
          el('small', method.status === 'WAITING' ? '先にほかの資料を調査してください。上の「次にすること」を確認できます。'
            : method.status === 'COMPLETE' ? '資料は発見済みです。証拠ファイルで読み直せます。' : '調査できます。ゲーム内の資料を読む操作です。'));
          methods.append(card);
        }
        targets.append(methods);
      }
      const result = el('div', undefined, 'case-search-result'); result.setAttribute('role', 'status');
      result.append(el('strong', '調査報告'), el('p', game.lastInvestigationResult?.publicMessage ?? '調査方法を選んで記録を確認してください。'));
      for (const hint of game.lastInvestigationResult?.nextHints ?? []) result.append(el('p', hint));
      targets.append(result);
      workspace.append(targets, evidenceBrowser(game.discoveredEvidence, draw,
        { title: '3. 原文を読み、証拠として登録する', collect: evidenceId => action('collect', { evidenceId }) }));
      body.append(workspace);
      if (game.courtQuestion) {
        const question = panel('4. 無罪につながる手がかりは？');
        if (game.investigationClaim) question.append(reference(game.investigationClaim.speaker?.displayName ?? '証言者',
          game.investigationClaim.spokenContent, '今回確かめる証言 · 証言者の主張'));
        question.append(el('p', game.courtQuestion.prompt), el('p', 'ここからはあなたの推理。記録から言えることを一つ選ぼう。'));
        const choices = el('div', undefined, 'case-interpretations'); choices.setAttribute('aria-label', '推理の4択');
        game.courtQuestion.choices.forEach((choice, index) => {
          const selected = view.interpretation === choice.choiceId;
          const option = button(`${String.fromCharCode(65 + index)}. ${choice.text}`, () => {
            view.interpretation = choice.choiceId; draw('interpretation');
          }, `case-interpretation${selected ? ' is-selected' : ''}`);
          option.dataset.choiceId = choice.choiceId; option.setAttribute('aria-pressed', String(selected)); choices.append(option);
        });
        question.append(choices); body.append(question);
      }
      const footer = el('div', undefined, 'case-controls');
      footer.append(el('p', `発見 ${game.discoveredEvidence.length}件 ／ 登録 ${game.collectedEvidence.length}件`),
        button(sequential ? 'この推理で法廷へ' : '法廷へ移動', () => action('retrial',
          sequential ? { interpretationChoiceId: view.interpretation } : {}), 'case-primary',
          game.canReturnToCourt === false || !game.collectedEvidence.length || (sequential && !view.interpretation)));
      body.append(footer, el('p', '証拠が足りなければ再調査できます。記録だけから人物や意図を決めつけないでください。', 'case-muted'));
    } else if (game.currentState === 'RETRIAL_COURT' && game.pendingInterpretation) {
      const selected = game.pendingInterpretation;
      if (selected.evidenceId) view.evidence = selected.evidenceId;
      const layout = el('div', undefined, 'case-court-layout');
      const speaker = el('div', undefined, 'case-court-speaker');
      speaker.append(stage('弁護士（あなた）', 'defense'),
        hypothesisReference(selected.text, draw),
        dialogue('弁護士（あなた）', 'この記録から、確かめていただきたい点があります。'));
      layout.append(speaker, evidenceBrowser(selected.evidenceId ? game.presentableEvidence.filter(item => item.evidenceId === selected.evidenceId) : game.presentableEvidence, draw,
        { title: 'この推理を支える証拠は？', autoSelect: false, court: true }));
      const controls = el('div', undefined, 'case-controls');
      controls.append(button('調査に戻って推理を選び直す', () => action('investigation')),
        button('この証拠を提示する', () => action('objection', { statementId: selected.statementId,
          interpretationChoiceId: selected.choiceId, evidenceId: view.evidence }), 'case-primary', !view.evidence));
      layout.append(controls); body.append(layout);
    } else if (game.currentState === 'RETRIAL_COURT' && game.courtQuestion) {
      const question = game.courtQuestion;
      const testimony = game.testimonies.find(item => item.statements.some(statement => statement.statementId === question.statementId));
      const claim = testimony?.statements.find(item => item.statementId === question.statementId);
      const layout = el('div', undefined, 'case-court-layout case-court-question-layout');
      const speaker = el('div', undefined, 'case-court-speaker');
      speaker.append(stage(testimony?.speaker?.displayName ?? '証言者'),
        pagedText('claim', testimony?.speaker?.displayName ?? '証言者',
          compactCourt?.matches ? `証言者の主張「${claim?.spokenContent ?? ''}」\n\n設問：${question.prompt}`
            : claim?.spokenContent ?? '提示資料から、どこまで言えるかを検討します。', draw,
          { spoken: !compactCourt?.matches, lines: 2, columns: compactCourt?.matches ? 22 : 32 }));
      const references = el('details', undefined, 'case-help');
      references.append(el('summary', '登録済み資料を読み返す（提示しません）'));
      for (const item of game.presentableEvidence) references.append(evidenceReader(item));
      speaker.append(references);
      const questionPanel = panel('1. 調査資料から言えることを選ぶ');
      if (!compactCourt?.matches) questionPanel.append(pagedText('question', '解釈を選ぶ', question.prompt, draw, { lines: 2, columns: 32 }));
      const choices = el('div', undefined, 'case-interpretations'); choices.setAttribute('aria-label', '解釈の4択');
      const choicePages = question.choices.map(choice => sourcePages(choice.text, 2, compactCourt?.matches ? 10 : 20));
      const choicePageCount = Math.max(...choicePages.map(pages => pages.length));
      view.choicePage = Math.min(view.choicePage, choicePageCount - 1);
      question.choices.forEach((choice, index) => {
        const selected = choice.choiceId === view.interpretation;
        const option = button(`${String.fromCharCode(65 + index)}. ${choicePages[index][view.choicePage] ?? '（この選択肢の続きはありません）'}`, () => {
          if (view.interpretation !== choice.choiceId) view.evidence = null;
          view.interpretation = choice.choiceId; draw('interpretation');
        }, `case-interpretation${selected ? ' is-selected' : ''}`);
        option.dataset.choiceId = choice.choiceId; option.setAttribute('aria-pressed', String(selected)); choices.append(option);
      });
      questionPanel.append(choices);
      if (choicePageCount > 1) {
        const pages = el('div', undefined, 'case-document-pages');
        pages.append(button('選択肢の前の文', () => { view.choicePage -= 1; draw(); }, '', view.choicePage === 0),
          el('span', `${view.choicePage + 1} / ${choicePageCount}`),
          button('選択肢の続き', () => { view.choicePage += 1; draw(); }, '', view.choicePage === choicePageCount - 1));
        questionPanel.append(pages);
      }
      speaker.append(questionPanel); layout.append(speaker);
      const selected = question.choices.find(choice => choice.choiceId === view.interpretation);
      layout.append(evidenceBrowser(selected ? game.presentableEvidence : [], draw,
        { title: '2. 解釈の根拠となる証拠を選ぶ', autoSelect: false, court: true, sourceLines: compactCourt?.matches ? 2 : 6 }));
      const submission = el('section', undefined, 'case-presentation');
      submission.append(el('h2', '3. 解釈と証拠を確認して提示する'),
        el('p', selected ? `選択中：${String.fromCharCode(65 + question.choices.indexOf(selected))}` : '4択から選んでください'),
        el('p', `証拠：${game.presentableEvidence.find(item => item.evidenceId === view.evidence)?.title ?? '未選択'}`),
        el('p', '選び直しは何度でもできます。提示すると1回分を使います。', 'case-muted'));
      const controls = el('div', undefined, 'case-controls');
      if (game.canInvestigate) controls.append(button('提示せず追加調査へ', () => action('investigation')));
      controls.append(button('解釈と証拠を提示', () => action('objection', {
        statementId: question.statementId, interpretationChoiceId: view.interpretation, evidenceId: view.evidence,
      }), 'case-primary', !selected || !view.evidence));
      submission.append(controls); layout.append(submission); body.append(layout);
    } else if (game.currentState === 'RETRIAL_COURT') {
      const statements = game.testimonies.flatMap(item => item.statements.map(statement => ({
        ...statement, speaker: item.speaker?.displayName ?? '証言者' })));
      const index = Math.min(view.page, Math.max(0, statements.length - 1));
      const current = statements[index];
      const layout = el('div', undefined, 'case-court-layout');
      const speaker = el('div', undefined, 'case-court-speaker');
      speaker.append(stage(current?.speaker ?? '証言者'));
      if (current) {
        speaker.append(pagedText(`statement-${current.statementId}`, current.speaker, current.spokenContent, draw,
          { spoken: true, lines: compactCourt?.matches ? 2 : 6, columns: compactCourt?.matches ? 18 : 30 }));
        const nav = el('div', undefined, 'case-controls');
        nav.append(button('前の証言', () => { view.page -= 1; draw('dialogue'); }, '', index === 0),
          button(view.statement === current.statementId ? '指摘対象として選択中' : 'この発言を指摘する',
            () => { view.statement = current.statementId; draw('statement'); }, 'case-select'),
          button('次の証言', () => { view.page += 1; draw('dialogue'); }, '', index === statements.length - 1));
        speaker.append(nav);
      }
      layout.append(speaker, evidenceBrowser(game.presentableEvidence, draw,
        { title: '照合する証拠を選択', court: true, sourceLines: compactCourt?.matches ? 3 : 6 }));
      const chosen = statements.find(item => item.statementId === view.statement);
      const selection = el('section', undefined, 'case-presentation');
      selection.append(el('h2', '提示の確認'), el('p', chosen ? `指摘する発言：証言 ${statements.indexOf(chosen) + 1}` : '指摘する発言を選んでください。'),
        el('p', `証拠：${game.presentableEvidence.find(item => item.evidenceId === view.evidence)?.title ?? '未選択'}`));
      const controls = el('div', undefined, 'case-controls');
      if (game.canInvestigate) controls.append(button('提示せず追加調査へ', () => action('investigation')));
      controls.append(button('この証拠で主張を検証', () => action('objection', {
        statementId: view.statement, evidenceId: view.evidence }), 'case-primary', !chosen || !view.evidence));
      selection.append(controls); layout.append(selection); body.append(layout);
    } else if (game.currentState === 'GUILTY_RETRY') {
      const result = el('div', undefined, 'case-result');
      result.append(el('h2', '証拠を読み直そう'),
        pagedText('failure', '検察官', game.publicFailureFeedback, draw, { spoken: true }),
        el('p', '解決済みの争点と登録した証拠は失われません。', 'case-muted'),
        button('調査室へ戻って再検討', () => action('retry'), 'case-primary'));
      body.append(result);
    } else if (game.currentState === 'ACQUITTED') {
      const result = el('div', undefined, 'case-result case-verdict-scene');
      const judgment = dialogue('裁判官', game.acquittal.publicRuling);
      judgment.querySelector('p').className = 'case-ruling';
      result.append(el('div', 'すべての争点を解決', 'case-verdict'), judgment);
      result.insertBefore(portrait('judge', '裁判官'), result.firstChild);
      const explanation = panel('解説'); explanation.className += ' case-ending-explanation';
      if (game.caseStudy) {
        explanation.append(button(view.explanationOpen ? '解説を閉じる' : '解説を開く', () => {
          view.explanationOpen = !view.explanationOpen; draw();
        }, 'case-primary'));
        if (view.explanationOpen) {
          const reader = el('section', undefined, 'case-study-reader');
          reader.setAttribute('aria-label', '事件の解説');
          reader.append(button('判決へ戻る', () => { view.explanationOpen = false; draw(); }), caseStudyView(game.caseStudy));
          explanation.append(reader);
        }
      }
      else explanation.append(el('p', game.acquittal.publicExplanation));
      result.append(explanation);
      const exit = el('a', 'ゲーム終了', 'case-primary case-finish'); exit.href = '/author#court';
      result.append(exit);
      body.append(result);
    } else if (game.currentState === 'BLOCKED') {
      const result = el('div', undefined, 'case-result case-verdict-blocked');
      result.append(pagedText('blocked', '審理終了', game.blockedMessage, draw, { spoken: true }),
        el('p', '記録を見直して、次の事件に挑もう。上の「ゲーム作成方法に戻る」から、新しいゲームを作れます。', 'case-hint'));
      body.append(result);
    }
    if (focus) {
      const candidates = [...screen.querySelectorAll('button')];
      const selected = focus === 'hypothesis' ? screen.querySelector('.case-reference')
        : focus === 'document' ? screen.querySelector('.case-court-source')
        : focus === 'viewer-evidence' ? candidates.find(node => node.dataset.viewerEvidenceId === view.deskEvidence)
        : focus === 'evidence' ? candidates.find(node => node.dataset.evidenceId === view.evidence)
        : focus === 'target' ? candidates.find(node => node.dataset.targetId === view.target)
          : focus === 'interpretation' ? candidates.find(node => node.dataset.choiceId === view.interpretation)
          : screen.querySelector(focus === 'dialogue' ? '.case-dialogue' : '.case-presentation');
      if (selected) { if (selected.tagName !== 'BUTTON') selected.tabIndex = -1; selected.focus(); }
    }
  }
  redrawForViewport = () => draw();
  draw();
  if (changed) {
    screen.querySelector('#screen-title').focus({ preventScroll: true });
    if (previousState && !['TITLE', 'INITIAL_COURT'].includes(game.currentState)) {
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
