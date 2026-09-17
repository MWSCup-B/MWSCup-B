const byId = id => document.getElementById(id);
let token = null;
let bootstrap = null;
let author = null;
let busy = false;

function jsonText(value) {
  return value == null ? '' : JSON.stringify(value, null, 2);
}

function parseJson(id) {
  const text = byId(id).value;
  if (new Blob([text]).size > 2 * 1024 * 1024) throw new Error('JSONは2MiB以内にしてください。');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSONオブジェクトを入力してください。');
  }
  return value;
}

async function api(path, body = {}, method = 'POST') {
  if (busy) return null;
  busy = true; renderBusy(true);
  try {
    const response = await fetch(path, { method,
      headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw new Error(`${value.error?.code ?? 'ERROR'}: ${value.error?.message ?? '処理に失敗しました。'}`);
    if (value.token) token = value.token;
    if (value.bootstrap) bootstrap = value.bootstrap;
    if (value.author) author = value.author;
    render();
    return value;
  } catch (error) {
    byId('author-errors').textContent = error instanceof SyntaxError
      ? 'JSON形式が不正です。' : error.message;
    return null;
  } finally { busy = false; render(); }
}

function renderBusy(value) {
  document.querySelectorAll('button').forEach(button => { button.disabled = value; });
}

function renderAttacks() {
  const target = byId('attack-list');
  if (target.childElementCount || !bootstrap) return;
  for (const attack of bootstrap.attacks) {
    const label = document.createElement('label'); label.className = 'attack-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = attack.id;
    const text = document.createElement('span');
    text.textContent = `${attack.label} (${attack.id}) — ${attack.description}`;
    label.append(input, text); target.append(label);
  }
  byId('network-json').value = jsonText(bootstrap.examples.network);
  byId('context-json').value = jsonText(bootstrap.examples.scenarioContext);
}

function selectedAttacks() {
  return [...document.querySelectorAll('#attack-list input:checked')].map(item => item.value);
}

function renderOptions() {
  const select = byId('scenario-option');
  const selected = select.value;
  select.replaceChildren();
  for (const option of author?.scenarioOptions ?? []) {
    const element = document.createElement('option'); element.value = option.optionId;
    element.textContent = `${option.optionId}: ${option.graphId}`; select.append(element);
  }
  if ([...select.options].some(item => item.value === selected)) select.value = selected;
  renderScenarioOption();
}

function renderScenarioOption() {
  const option = author?.scenarioOptions?.find(item => item.optionId === byId('scenario-option').value);
  byId('scenario-prompt').value = author?.scenarioPrompt ?? '';
  byId('scenario-input').value = jsonText(option?.generationInput);
}

function setOutput(id, value) { byId(id).textContent = jsonText(value); }

function render() {
  renderAttacks();
  byId('author-errors').replaceChildren();
  byId('workflow-state').textContent = author?.currentState ?? 'DRAFT';
  byId('waiting-state').textContent = author?.waitingFor ?? 'なし';
  byId('stage-state').textContent = author?.stage ?? 'INPUT';
  if (author?.issues?.length) setOutput('author-errors', author.issues);
  renderOptions();
  setOutput('prepare-result', author?.scenarioOptions?.length
    ? { status: 'SATISFIED', candidateGraphOptions: author.scenarioOptions.length } : author?.issues);
  setOutput('scenario-result', author?.scenarioImportResult);
  byId('verification-prompt').value = author?.verificationPrompt ?? '';
  byId('verification-input').value = jsonText(author?.verificationInput);
  setOutput('verification-result', author?.verificationResult);
  byId('evidence-prompt').value = author?.evidencePrompt ?? '';
  byId('evidence-input').value = jsonText(author?.evidenceGenerationInput);
  setOutput('evidence-result', author?.evidenceImportResult);
  setOutput('progression-references', author?.progressionReferences);
  if (author?.progressionPlanTemplate && !byId('progression-json').value.trim()) {
    byId('progression-json').value = jsonText(author.progressionPlanTemplate);
  }
  setOutput('build-result', { gameCaseStatus: author?.gameCaseStatus,
    gameMakeStatus: author?.gameMakeStatus,
    evaluation: author?.evaluationResult, orchestrator: author?.orchestrator });
  const play = byId('play-game');
  play.hidden = !(author?.currentState === 'ACCEPTED' && author?.playUrl);
  if (!play.hidden) play.href = author.playUrl;
  byId('prepare-evidence').disabled = author?.verificationResult?.status !== 'VERIFIED';
  byId('import-review').disabled = !author?.verificationInput;
  byId('import-evidence').disabled = !author?.evidenceGenerationInput;
  byId('build-game').disabled = author?.evidenceImportResult?.status !== 'VALID';
}

async function copy(id) {
  const text = byId(id).value;
  try { await navigator.clipboard.writeText(text); byId('author-errors').textContent = 'コピーしました。'; }
  catch { byId(id).focus(); byId(id).select(); byId('author-errors').textContent = '選択した内容をコピーしてください。'; }
}

function save(id) {
  const blob = new Blob([byId(id).value], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${id}.json`; link.click(); URL.revokeObjectURL(url);
}

function bindFile(fileId, textareaId) {
  byId(fileId).addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      byId('author-errors').textContent = 'JSONファイルは2MiB以内にしてください。'; return;
    }
    byId(textareaId).value = await file.text();
  });
}

byId('prepare-scenario').addEventListener('click', async () => {
  try { await api('/api/author/prepare-scenario', { selectedAttackIds: selectedAttacks(),
    network: parseJson('network-json'), scenarioContext: parseJson('context-json') }); }
  catch (error) { byId('author-errors').textContent = error.message; }
});
byId('scenario-option').addEventListener('change', renderScenarioOption);
byId('import-scenario').addEventListener('click', async () => {
  try { await api('/api/author/import-scenario', { optionId: byId('scenario-option').value,
    scenarioPackage: parseJson('scenario-json') }); }
  catch (error) { byId('author-errors').textContent = error.message; }
});
byId('import-review').addEventListener('click', async () => {
  try { await api('/api/author/import-review', { semanticReview: parseJson('review-json') }); }
  catch (error) { byId('author-errors').textContent = error.message; }
});
byId('prepare-evidence').addEventListener('click', () => api('/api/author/prepare-evidence'));
byId('import-evidence').addEventListener('click', async () => {
  try { await api('/api/author/import-evidence', { evidencePackage: parseJson('evidence-json') }); }
  catch (error) { byId('author-errors').textContent = error.message; }
});
byId('build-game').addEventListener('click', async () => {
  try { await api('/api/author/build', { progressionPlan: parseJson('progression-json') }); }
  catch (error) { byId('author-errors').textContent = error.message; }
});
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click',
  () => copy(button.dataset.copy)));
document.querySelectorAll('[data-save]').forEach(button => button.addEventListener('click',
  () => save(button.dataset.save)));
bindFile('scenario-file', 'scenario-json'); bindFile('review-file', 'review-json');
bindFile('evidence-file', 'evidence-json');

api('/api/author/start');
