let token = null;
let bootstrap = null;
let author = null;
let polling = null;
const byId = id => document.getElementById(id);

async function api(path, body = null) {
  const response = await fetch(path, { method: body == null ? 'GET' : 'POST',
    headers: { ...(body == null ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body == null ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? '処理に失敗しました。');
  return value;
}

function selected(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
}

function appendText(parent, tag, text, className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text; parent.append(element); return element;
}

function renderChoices() {
  const networks = byId('network-list'); networks.replaceChildren();
  for (const network of bootstrap.networks) {
    const label = document.createElement('label'); label.className = 'network-card';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'network';
    input.value = network.networkId; input.required = true;
    label.append(input); appendText(label, 'strong', `Network ${network.code}`);
    appendText(label, 'span', network.displayName);
    const image = document.createElement('img'); image.src = network.diagramPath;
    image.alt = `Network ${network.code} 構成図`; label.append(image); networks.append(label);
  }
  const difficulties = byId('difficulty-list'); difficulties.replaceChildren();
  for (const item of bootstrap.difficulties) {
    const label = document.createElement('label'); label.className = 'difficulty-option';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'difficulty';
    input.value = String(item.difficulty); input.required = true;
    label.append(input); appendText(label, 'strong', item.label); difficulties.append(label);
  }
}

function renderProgress(targetId) {
  const target = byId(targetId); target.replaceChildren();
  for (const item of author.progress) {
    const suffix = item.status === 'COMPLETE' ? '✓'
      : item.status === 'RUNNING' ? '実行中…' : item.status === 'FAILED' ? '失敗'
        : item.status === 'SKIPPED' ? '不要' : '待機中';
    const attempt = item.attempt ? ` ${item.attempt} / ${author.maxAttempts}` : '';
    appendText(target, 'li', `${item.label}　${suffix}${attempt}`, item.status.toLowerCase());
  }
}

function renderDetails(targetId) {
  const target = byId(targetId); target.replaceChildren();
  if (!author.developerDetails.length) appendText(target, 'p', '詳細情報はありません。');
  for (const item of author.developerDetails) {
    const article = document.createElement('article'); article.className = 'card';
    appendText(article, 'strong', `${item.phase} / attempt ${item.attempt ?? '-'}`);
    appendText(article, 'p', `${item.errorCode ?? item.code} — ${item.field}`);
    if (item.schemaName) appendText(article, 'p', `Schema: ${item.schemaName}`);
    if (item.cliErrorCode) appendText(article, 'p', `CLI: ${item.cliErrorCode}`);
    appendText(article, 'p', item.reason); appendText(article, 'p', item.correctionHint);
    target.append(article);
  }
}

function render() {
  const terminal = ['READY', 'FAILED', 'CANCELLED'].includes(author.currentState);
  byId('creation-panel').hidden = author.currentState !== 'IDLE';
  byId('generation-panel').hidden = author.currentState === 'IDLE' || terminal;
  byId('ready-panel').hidden = author.currentState !== 'READY';
  byId('failure-panel').hidden = !['FAILED', 'CANCELLED'].includes(author.currentState);
  if (author.currentState !== 'IDLE') renderProgress(
    author.currentState === 'READY' ? 'ready-progress' : 'generation-progress');
  byId('cancel').disabled = !author.canCancel;
  renderDetails('detail-list'); renderDetails('failure-details');
  if (author.currentState === 'READY') byId('play-game').href = author.playUrl;
  if (author.failure) byId('failure-message').textContent = author.failure.message;
  if (terminal && polling) { clearInterval(polling); polling = null; }
}

async function refresh() {
  try { const value = await api('/api/author/status'); author = value.author; render(); }
  catch (error) { byId('form-error').textContent = error.message; }
}

async function generate() {
  const networkId = selected('network'); const difficulty = Number(selected('difficulty'));
  if (!networkId || ![1, 2, 3].includes(difficulty)) {
    byId('form-error').textContent = 'Networkと難易度を選択してください。'; return;
  }
  byId('form-error').textContent = '';
  try {
    const value = await api('/api/author/generate', { networkId, difficulty });
    author = value.author; render(); polling ??= setInterval(refresh, 500);
  } catch (error) { byId('form-error').textContent = error.message; }
}

byId('generate').addEventListener('click', generate);
byId('retry').addEventListener('click', () => { author.currentState = 'IDLE'; render(); });
byId('cancel').addEventListener('click', async () => {
  try { const value = await api('/api/author/cancel', {}); author = value.author; render(); }
  catch (error) { byId('form-error').textContent = error.message; }
});

try {
  const value = await api('/api/author/start', {});
  token = value.token; bootstrap = value.bootstrap; author = value.author;
  renderChoices(); render();
} catch (error) { byId('form-error').textContent = error.message; }
