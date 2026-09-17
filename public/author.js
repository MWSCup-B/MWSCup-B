import { WIZARD_STEPS, createProgressionBuilder, investigationCompletionId,
  maxReachableStep, moveWizard, nextRuleId, nextTargetId, objectionCandidates,
  progressionDraft, removeRule, removeTarget, upsertRule, upsertTarget,
  validateProgressionBuilder, wizardCompletion } from './author-builder.js';

const byId = id => document.getElementById(id);
const TARGET_TYPES = ['ENDPOINT', 'SERVER', 'MAILBOX', 'LOG_SOURCE', 'NETWORK_DEVICE',
  'FILE_SYSTEM', 'BROWSER', 'APPLICATION'];
const STEP_REQUIREMENTS = [
  { message: 'Network A～DとDifficulty ★1～3を選び、「Scenario生成準備」を実行してください。', focusId: 'prepare-scenario' },
  { message: 'Scenario Prompt/Inputの生成を待ってください。', focusId: 'scenario-option' },
  { message: 'Scenario JSONをImportし、VALIDにしてください。', focusId: 'import-scenario' },
  { message: 'ReviewをVERIFIEDにした後、「Evidence生成準備」を実行してください。', focusId: 'import-review' },
  { message: 'Evidence Generation Inputを準備してください。', focusId: 'evidence-input' },
  { message: 'Evidence JSONをImportし、VALIDにしてください。', focusId: 'import-evidence' },
  { message: 'Builderの必須項目を設定し、「Planを検証」を実行してください。', focusId: 'validate-progression' },
  { message: 'BuildとEvaluationを実行してください。', focusId: 'build-game' },
];
let token = null;
let bootstrap = null;
let author = null;
let busy = false;
let uiError = '';
let operationStatus = '';
let currentStep = 0;
let upstreamDirty = false;
let localDirtyStep = null;
let builder = null;
let builderSourceKey = null;
let builderPreview = null;
let builderDirty = true;
let builderValidation = { valid: false, errors: [], warnings: [] };
let editingTargetId = null;
let editingRuleId = null;

function jsonText(value) { return value == null ? '' : JSON.stringify(value, null, 2); }

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
  busy = true; uiError = ''; operationStatus = '処理中です。完了するまでお待ちください。';
  renderBusy(true); renderOperationStatus();
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
    operationStatus = '処理が完了しました。';
    syncBuilder(); render();
    return value;
  } catch (error) {
    uiError = error instanceof SyntaxError
      ? 'JSON形式が不正です。' : error.message;
    operationStatus = '処理に失敗しました。表示された内容を修正して再実行してください。';
    return null;
  } finally { busy = false; renderBusy(false); render(); }
}

function renderBusy(value) {
  document.querySelectorAll('button').forEach(button => { button.disabled = value; });
}

function renderOperationStatus() {
  const target = byId('operation-status'); target.textContent = operationStatus;
  target.className = `operation-status${busy ? ' busy' : ''}`;
  document.querySelector('.author-main')?.setAttribute('aria-busy', String(busy));
}

function syncBuilder() {
  const source = author?.progressionPlan ?? author?.progressionPlanTemplate;
  const fingerprint = author?.evidenceImportResult?.evidenceSet?.fingerprint ?? '';
  const key = source ? `${source.evidenceSetId}:${fingerprint}` : null;
  if (!source) {
    builder = null; builderSourceKey = null; builderPreview = null; builderDirty = true;
    return;
  }
  if (builderSourceKey !== key) {
    builder = createProgressionBuilder(source); builderSourceKey = key;
    builderPreview = author?.progressionPlan ? { status: 'VALID',
      progressionPlan: author.progressionPlan, issues: [] } : null;
    builderDirty = !author?.progressionPlan; editingTargetId = null; editingRuleId = null;
  }
  builderValidation = validateProgressionBuilder(builder, author?.progressionReferences);
}

function renderAttacks() {
  const target = byId('attack-list');
  if (target.childElementCount || !bootstrap) return;
  for (const attack of bootstrap.attacks) {
    const label = document.createElement('label'); label.className = 'attack-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = attack.id;
    input.addEventListener('change', markUpstreamDirty);
    const text = document.createElement('span');
    text.textContent = `${attack.label} (${attack.id}) — ${attack.description}`;
    label.append(input, text); target.append(label);
  }
  byId('network-json').value = jsonText(bootstrap.examples.network);
  byId('context-json').value = jsonText(bootstrap.examples.scenarioContext);
  const networkList = byId('prototype-network-list');
  for (const network of bootstrap.prototype.networks) {
    const label = document.createElement('label'); label.className = 'network-card';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'prototype-network';
    input.value = network.networkId; input.addEventListener('change', markUpstreamDirty);
    if (!networkList.childElementCount) input.checked = true;
    const image = document.createElement('img'); image.src = network.diagramPath;
    image.alt = `${network.displayName}のNetwork構成図`;
    const title = document.createElement('strong'); title.textContent = `Network ${network.code} — ${network.displayName}`;
    const detail = document.createElement('span');
    detail.textContent = `${network.nodes.length} nodes / ${network.logSources.join('・')}`;
    label.append(input, image, title, detail); networkList.append(label);
  }
  const difficultyList = byId('prototype-difficulty-list');
  for (const difficulty of bootstrap.prototype.difficulties) {
    const label = document.createElement('label'); label.className = 'difficulty-option';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'prototype-difficulty';
    input.value = String(difficulty.difficulty); input.addEventListener('change', markUpstreamDirty);
    if (difficulty.difficulty === 1) input.checked = true;
    const text = document.createElement('span');
    text.textContent = `${difficulty.label}（Evidence ${difficulty.requiredEvidenceCount}件）`;
    label.append(input, text); difficultyList.append(label);
  }
}

function markUpstreamDirty() {
  if (!author?.scenarioOptions?.length) return;
  upstreamDirty = true; builder = null; builderPreview = null; builderDirty = true;
  currentStep = 0; render();
}

function markImportedDataDirty(step) {
  const wasComplete = (step === 2 && author?.scenarioImportResult?.status === 'VALID')
    || (step === 3 && author?.verificationResult?.status === 'VERIFIED')
    || (step === 5 && author?.evidenceImportResult?.status === 'VALID');
  if (!wasComplete) return;
  localDirtyStep = localDirtyStep == null ? step : Math.min(localDirtyStep, step);
  builder = null; builderSourceKey = null; builderPreview = null; builderDirty = true;
  currentStep = Math.min(currentStep, step); render();
}

function selectedAttacks() {
  return [...document.querySelectorAll('#attack-list input:checked')].map(item => item.value);
}

function prototypeSelection() {
  return { networkId: document.querySelector('input[name="prototype-network"]:checked')?.value,
    difficulty: Number(document.querySelector('input[name="prototype-difficulty"]:checked')?.value) };
}

function renderOptions() {
  const select = byId('scenario-option'); const selected = select.value;
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
  byId('scenario-input').value = jsonText(author?.prototypeGenerationBrief ?? option?.generationInput);
}

function setOutput(id, value) { byId(id).textContent = jsonText(value); }

function completion() {
  const values = wizardCompletion(author, { upstreamDirty,
    progressionValid: builderValidation.valid && builderPreview?.status === 'VALID' && !builderDirty });
  if (localDirtyStep != null) for (let index = localDirtyStep; index < values.length; index += 1) {
    values[index] = false;
  }
  return values;
}

function renderWizard() {
  const prototypeMode = !byId('developer-inputs').open;
  if (prototypeMode) {
    const indices = [0, 1, 2, 3, 7];
    const completeByStep = {
      0: Boolean(author?.scenarioOptions?.length) && !upstreamDirty,
      1: Boolean(author?.scenarioOptions?.length) && !upstreamDirty,
      2: author?.scenarioImportResult?.status === 'VALID' && localDirtyStep == null,
      3: author?.verificationResult?.status === 'VERIFIED' && localDirtyStep == null,
      7: author?.currentState === 'ACCEPTED' && Boolean(author?.playUrl),
    };
    if (!indices.includes(currentStep)) currentStep = indices.find(step => !completeByStep[step]) ?? 7;
    const currentPosition = indices.indexOf(currentStep);
    const firstIncomplete = indices.findIndex(step => !completeByStep[step]);
    const reachablePosition = firstIncomplete < 0 ? indices.length - 1 : firstIncomplete;
    document.querySelectorAll('.wizard-scene').forEach(section => {
      section.hidden = Number(section.dataset.wizardStep) !== currentStep;
    });
    const labels = ['入力', 'Scenario', 'Import', 'Verification', 'Build / Play'];
    const progress = byId('wizard-progress'); progress.replaceChildren();
    indices.forEach((step, position) => {
      const control = document.createElement('button'); control.type = 'button';
      control.textContent = `${position + 1}. ${labels[position]}`;
      control.className = step === currentStep ? 'current' : completeByStep[step] ? 'complete' : 'locked';
      control.disabled = busy || position > reachablePosition;
      control.addEventListener('click', () => { currentStep = step; render(); }); progress.append(control);
    });
    byId('wizard-back').disabled = busy || currentPosition === 0;
    byId('wizard-next').disabled = busy || currentPosition === indices.length - 1;
    byId('wizard-position').textContent = `${currentPosition + 1} / ${indices.length}`;
    byId('wizard-requirement').textContent = completeByStep[currentStep]
      ? 'この工程は完了しています。「次へ」で進めます。'
      : currentStep === 7 ? '検証済みScenarioからXSSゲームをBuildしてください。'
        : STEP_REQUIREMENTS[currentStep].message;
    return;
  }
  const complete = completion(); const reachable = maxReachableStep(complete);
  if (currentStep > reachable) currentStep = reachable;
  document.querySelectorAll('.wizard-scene').forEach(section => {
    section.hidden = Number(section.dataset.wizardStep) !== currentStep;
  });
  const progress = byId('wizard-progress'); progress.replaceChildren();
  WIZARD_STEPS.forEach((step, index) => {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = `${index + 1}. ${step.shortLabel}`;
    button.className = index === currentStep ? 'current' : complete[index] ? 'complete' : 'locked';
    button.disabled = busy || index > reachable;
    button.setAttribute('aria-current', index === currentStep ? 'step' : 'false');
    button.addEventListener('click', () => { currentStep = moveWizard(currentStep, index, complete); render(); });
    progress.append(button);
  });
  byId('wizard-back').disabled = busy || currentStep === 0;
  byId('wizard-next').disabled = busy || currentStep === WIZARD_STEPS.length - 1;
  byId('wizard-position').textContent = `${currentStep + 1} / ${WIZARD_STEPS.length}`;
  byId('wizard-requirement').textContent = complete[currentStep]
    ? 'この工程は完了しています。「次へ」で進めます。'
    : STEP_REQUIREMENTS[currentStep].message;
}

function option(container, { value, checked, label, detail = '', disabled = false, onChange }) {
  const wrapper = document.createElement('label');
  const input = document.createElement('input'); input.type = 'checkbox'; input.value = value;
  input.checked = checked; input.disabled = disabled;
  const title = document.createElement('span'); title.textContent = label;
  wrapper.append(input, title);
  if (detail) { const small = document.createElement('small'); small.textContent = detail; wrapper.append(small); }
  input.addEventListener('change', () => onChange(input.checked, value));
  container.append(wrapper); return input;
}

function short(value, length = 180) {
  const text = typeof value === 'string' ? value : jsonText(value);
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function evidenceLabel(id) {
  const item = author?.progressionReferences?.evidence.find(value => value.evidenceId === id);
  return item ? `${item.title} (${item.evidenceId})` : id;
}

function statementLabel(id) {
  const item = author?.progressionReferences?.statements.find(value => value.statementId === id);
  return item ? `${item.speakerDisplayName}: ${item.spokenContent} (${item.statementId})` : id;
}

function setMembership(field, value, checked) {
  const values = new Set(builder[field]); checked ? values.add(value) : values.delete(value);
  builder[field] = [...values]; changed({ rerender: field === 'investigationEvidenceIds' });
}

function renderEvidenceChoices(containerId, field) {
  const container = byId(containerId); container.replaceChildren();
  for (const evidence of author?.progressionReferences?.evidence ?? []) {
    const disabled = evidence.visibility !== 'PLAYER_OBTAINABLE';
    option(container, { value: evidence.evidenceId, checked: builder[field].includes(evidence.evidenceId),
      disabled, label: `${evidence.evidenceId} — ${evidence.title}`,
      detail: `${short(evidence.publicContent)}${disabled ? '（PLAYER_OBTAINABLEではありません）' : ''}`,
      onChange: checked => setMembership(field, evidence.evidenceId, checked) });
  }
}

function renderStatementChoices(containerId, field) {
  const container = byId(containerId); container.replaceChildren();
  for (const statement of author?.progressionReferences?.statements ?? []) {
    option(container, { value: statement.statementId, checked: builder[field].includes(statement.statementId),
      label: `${statement.statementId} — ${statement.speakerDisplayName}（Testimony: ${statement.testimonyEvidenceId}）`,
      detail: statement.spokenContent,
      onChange: checked => { setMembership(field, statement.statementId, checked); renderRetrialSummary(); } });
  }
}

function setSelect(select, values, selected, label) {
  select.replaceChildren();
  for (const value of values) {
    const item = document.createElement('option'); item.value = value.value;
    item.textContent = label(value); select.append(item);
  }
  if ([...select.options].some(item => item.value === selected)) select.value = selected;
}

function renderTargetForm() {
  const type = byId('target-type'); const selectedType = type.value || 'SERVER';
  setSelect(type, TARGET_TYPES.map(value => ({ value })), selectedType, item => item.value);
  const source = byId('target-source'); const selectedSource = source.value;
  setSelect(source, (author?.progressionReferences?.investigationSourceNodes ?? []).map(item => ({
    value: `${item.sourceType}|${item.sourceId}`, ...item })), selectedSource,
  item => `${item.sourceType}: ${item.sourceId}`);
  const checked = new Set([...document.querySelectorAll('#target-actions input:checked')]
    .map(item => item.value));
  const actions = byId('target-actions'); actions.replaceChildren();
  for (const action of builder.investigationActions) {
    const allowed = action.allowedTargetTypes.includes(type.value);
    option(actions, { value: action.actionId, checked: allowed && checked.has(action.actionId),
      disabled: !allowed,
      label: `${action.displayName} — ${action.actionType}`,
      detail: `${action.description}${allowed ? '' : '（このTarget Typeでは利用不可）'}`,
      onChange: () => {} });
  }
  if (!byId('target-id').value && !editingTargetId) byId('target-id').value =
    nextTargetId(type.value, builder.investigationTargets.map(item => item.targetId));
}

function clearTargetForm() {
  editingTargetId = null; byId('target-id').value = ''; byId('target-display-name').value = '';
  byId('target-description').value = ''; byId('target-initial').checked = false;
  document.querySelectorAll('#target-actions input').forEach(input => { input.checked = false; });
  byId('target-errors').replaceChildren(); byId('save-target').textContent = 'Targetを追加';
  byId('cancel-target').hidden = true; renderTargetForm();
}

function editTarget(targetId) {
  const target = builder.investigationTargets.find(item => item.targetId === targetId); if (!target) return;
  editingTargetId = targetId; byId('target-id').value = target.targetId;
  byId('target-type').value = target.targetType; byId('target-display-name').value = target.displayName;
  byId('target-description').value = target.description;
  byId('target-source').value = `${target.sourceNodeRef.sourceType}|${target.sourceNodeRef.sourceId}`;
  byId('target-initial').checked = target.initiallyAvailable; renderTargetForm();
  document.querySelectorAll('#target-actions input').forEach(input => {
    input.checked = target.availableActionIds.includes(input.value);
  });
  byId('save-target').textContent = 'Targetを更新'; byId('cancel-target').hidden = false;
}

function saveTarget() {
  const id = byId('target-id').value.trim(); const displayName = byId('target-display-name').value.trim();
  const description = byId('target-description').value.trim(); const source = byId('target-source').value.split('|');
  const availableActionIds = [...document.querySelectorAll('#target-actions input:checked')]
    .map(item => item.value);
  const messages = [];
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) messages.push('Target IDは小文字英数字、_、-で入力してください。');
  if (!displayName) messages.push('公開名を入力してください。');
  if (!description) messages.push('説明を入力してください。');
  if (source.length !== 2) messages.push('Source候補を選択してください。');
  if (!availableActionIds.length) messages.push('利用可能Actionを1件以上選択してください。');
  if (builder.investigationTargets.some(item => item.targetId === id && item.targetId !== editingTargetId)) {
    messages.push('Target IDが重複しています。');
  }
  showMessages('target-errors', messages); if (messages.length) return;
  builder = upsertTarget(builder, { schemaVersion: '1.0', targetId: id,
    targetType: byId('target-type').value, displayName, description,
    sourceNodeRef: { sourceType: source[0], sourceId: source[1] }, availableActionIds,
    initiallyAvailable: byId('target-initial').checked }, editingTargetId);
  clearTargetForm(); changed({ rerender: true });
}

function renderTargets() {
  const container = byId('target-list'); container.replaceChildren();
  for (const target of builder.investigationTargets) {
    const card = document.createElement('article'); const heading = document.createElement('strong');
    heading.textContent = `${target.displayName} (${target.targetId})`;
    const summary = document.createElement('p'); summary.textContent =
      `${target.targetType} / ${target.sourceNodeRef.sourceType}:${target.sourceNodeRef.sourceId}\n${target.availableActionIds.map(id => builder.investigationActions.find(action => action.actionId === id)?.displayName ?? id).join('、')} / ${target.initiallyAvailable ? '初期Target' : '要Unlock'}`;
    const row = document.createElement('div'); row.className = 'button-row';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '編集';
    edit.addEventListener('click', () => editTarget(target.targetId));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = '削除';
    remove.addEventListener('click', () => { builder = removeTarget(builder, target.targetId); clearTargetForm(); clearRuleForm(); changed({ rerender: true }); });
    row.append(edit, remove); card.append(heading, summary, row); container.append(card);
  }
}

function renderRuleForm() {
  const targetSelect = byId('rule-target'); const targetValue = targetSelect.value;
  setSelect(targetSelect, builder.investigationTargets.map(item => ({ value: item.targetId, ...item })),
    targetValue, item => `${item.displayName} (${item.targetId})`);
  const target = builder.investigationTargets.find(item => item.targetId === targetSelect.value);
  const actionSelect = byId('rule-action'); const actionValue = actionSelect.value;
  setSelect(actionSelect, (target?.availableActionIds ?? []).map(id => ({ value: id,
    action: builder.investigationActions.find(item => item.actionId === id) })), actionValue,
  item => `${item.action?.displayName ?? item.value} (${item.action?.actionType ?? item.value})`);
  const evidenceSelect = byId('rule-evidence'); const evidenceValue = evidenceSelect.value;
  setSelect(evidenceSelect, builder.investigationEvidenceIds.map(id => ({ value: id })), evidenceValue,
    item => evidenceLabel(item.value));
  const selectedEvidence = new Set([...document.querySelectorAll('#rule-prerequisite-evidence input:checked')].map(item => item.value));
  const evidenceBox = byId('rule-prerequisite-evidence'); evidenceBox.replaceChildren();
  for (const id of builder.investigationEvidenceIds) option(evidenceBox, { value: id,
    checked: selectedEvidence.has(id), label: evidenceLabel(id), onChange: () => {} });
  const selectedActions = new Set([...document.querySelectorAll('#rule-prerequisite-actions input:checked')].map(item => item.value));
  const actionBox = byId('rule-prerequisite-actions'); actionBox.replaceChildren();
  for (const candidate of builder.investigationTargets.flatMap(item => item.availableActionIds.map(actionId => ({
    value: investigationCompletionId(item.targetId, actionId), target: item,
    action: builder.investigationActions.find(action => action.actionId === actionId) })))) {
    option(actionBox, { value: candidate.value, checked: selectedActions.has(candidate.value),
      label: `${candidate.target.displayName} → ${candidate.action?.displayName ?? candidate.value}`,
      onChange: () => {} });
  }
  const selectedUnlocks = new Set([...document.querySelectorAll('#rule-unlock-targets input:checked')].map(item => item.value));
  const unlockBox = byId('rule-unlock-targets'); unlockBox.replaceChildren();
  for (const item of builder.investigationTargets) option(unlockBox, { value: item.targetId,
    checked: selectedUnlocks.has(item.targetId), label: `${item.displayName} (${item.targetId})`,
    onChange: () => {} });
}

function clearRuleForm() {
  editingRuleId = null; byId('rule-public-message').value = ''; byId('rule-next-hints').value = '';
  byId('rule-repeatable').checked = false; byId('rule-errors').replaceChildren();
  byId('save-rule').textContent = 'Discovery Ruleを追加'; byId('cancel-rule').hidden = true;
  document.querySelectorAll('#rule-prerequisite-evidence input, #rule-prerequisite-actions input, #rule-unlock-targets input')
    .forEach(input => { input.checked = false; });
}

function editRule(ruleId) {
  const rule = builder.evidenceDiscoveryRules.find(item => item.ruleId === ruleId); if (!rule) return;
  editingRuleId = ruleId; byId('rule-target').value = rule.targetId; renderRuleForm();
  byId('rule-action').value = rule.actionId; byId('rule-evidence').value = rule.evidenceId;
  document.querySelectorAll('#rule-prerequisite-evidence input').forEach(input => {
    input.checked = rule.prerequisites.requiredEvidenceIds.includes(input.value);
  });
  document.querySelectorAll('#rule-prerequisite-actions input').forEach(input => {
    input.checked = rule.prerequisites.requiredCompletedActionIds.includes(input.value);
  });
  document.querySelectorAll('#rule-unlock-targets input').forEach(input => {
    input.checked = rule.discoveryResult.unlockedTargetIds.includes(input.value);
  });
  byId('rule-public-message').value = rule.discoveryResult.publicMessage;
  byId('rule-next-hints').value = rule.discoveryResult.nextHints.join('\n');
  byId('rule-repeatable').checked = rule.repeatable;
  byId('save-rule').textContent = 'Discovery Ruleを更新'; byId('cancel-rule').hidden = false;
}

function saveRule() {
  const targetId = byId('rule-target').value; const actionId = byId('rule-action').value;
  const evidenceId = byId('rule-evidence').value; const publicMessage = byId('rule-public-message').value.trim();
  const messages = [];
  const target = builder.investigationTargets.find(item => item.targetId === targetId);
  if (!target) messages.push('Targetを選択してください。');
  if (!target?.availableActionIds.includes(actionId)) messages.push('Targetで利用可能なActionを選択してください。');
  if (!builder.investigationEvidenceIds.includes(evidenceId)) messages.push('発見Evidenceを選択してください。');
  if (!publicMessage) messages.push('Public Resultを入力してください。');
  showMessages('rule-errors', messages); if (messages.length) return;
  const existing = builder.evidenceDiscoveryRules.find(item => item.ruleId === editingRuleId);
  const ruleId = existing?.ruleId ?? nextRuleId(builder.evidenceDiscoveryRules.map(item => item.ruleId));
  const values = selector => [...document.querySelectorAll(`${selector} input:checked`)].map(item => item.value);
  builder = upsertRule(builder, { schemaVersion: '1.0', ruleId, evidenceId, targetId, actionId,
    prerequisites: { requiredEvidenceIds: values('#rule-prerequisite-evidence'),
      requiredCompletedActionIds: values('#rule-prerequisite-actions') },
    discoveryResult: { publicMessage, discovered: true,
      unlockedTargetIds: values('#rule-unlock-targets'),
      nextHints: byId('rule-next-hints').value.split('\n').map(item => item.trim()).filter(Boolean) },
    repeatable: byId('rule-repeatable').checked }, editingRuleId);
  clearRuleForm(); changed({ rerender: true });
}

function renderRules() {
  const container = byId('rule-list'); container.replaceChildren();
  builder.evidenceDiscoveryRules.forEach((rule, index) => {
    const target = builder.investigationTargets.find(item => item.targetId === rule.targetId);
    const action = builder.investigationActions.find(item => item.actionId === rule.actionId);
    const card = document.createElement('article'); const heading = document.createElement('strong');
    heading.textContent = `${index + 1}. ${target?.displayName ?? rule.targetId} → ${action?.displayName ?? rule.actionId} → ${evidenceLabel(rule.evidenceId)}`;
    const summary = document.createElement('p'); summary.textContent = `${rule.discoveryResult.publicMessage}\nPrerequisite Evidence: ${rule.prerequisites.requiredEvidenceIds.join('、') || 'なし'}\nPrerequisite Action: ${rule.prerequisites.requiredCompletedActionIds.join('、') || 'なし'}\nUnlock: ${rule.discoveryResult.unlockedTargetIds.join('、') || 'なし'}`;
    const row = document.createElement('div'); row.className = 'button-row';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '編集';
    edit.addEventListener('click', () => editRule(rule.ruleId));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = '削除';
    remove.addEventListener('click', () => { builder = removeRule(builder, rule.ruleId); clearRuleForm(); changed({ rerender: true }); });
    row.append(edit, remove); card.append(heading, summary, row); container.append(card);
  });
}

function candidates() { return objectionCandidates(author?.progressionReferences); }

function renderObjections() {
  const container = byId('objection-options'); container.replaceChildren();
  for (const candidate of candidates()) {
    const checked = builder.objectionRules.some(item => item.contradictionRef === candidate.contradictionRef
      && item.exonerationRef === candidate.exonerationRef);
    option(container, { value: candidate.candidateId, checked,
      label: `${statementLabel(candidate.targetStatementId)} → ${candidate.acceptedEvidenceIds.map(evidenceLabel).join(' / ')}`,
      detail: `matchMode: ANY_PRESENTED / ${candidate.contradictionRef} / ${candidate.exonerationRef}`,
      onChange: selected => {
        if (selected) builder.objectionRules.push({ objectionRuleId: candidate.objectionRuleId,
          targetStatementId: candidate.targetStatementId,
          acceptedEvidenceIds: [...candidate.acceptedEvidenceIds],
          contradictionRef: candidate.contradictionRef, exonerationRef: candidate.exonerationRef });
        else builder.objectionRules = builder.objectionRules.filter(item =>
          !(item.contradictionRef === candidate.contradictionRef
            && item.exonerationRef === candidate.exonerationRef));
        changed(); renderRetrialSummary();
      } });
  }
}

function renderRetrialSummary() {
  const container = byId('retrial-presentation-summary'); container.replaceChildren();
  for (const statementId of builder?.retrialStatementIds ?? []) {
    const article = document.createElement('article'); const heading = document.createElement('strong');
    heading.textContent = statementLabel(statementId);
    const evidence = document.createElement('p'); const ids = candidates()
      .filter(item => item.targetStatementId === statementId).flatMap(item => item.acceptedEvidenceIds);
    evidence.textContent = `提示可能Evidence: ${[...new Set(ids)].map(evidenceLabel).join('、') || '既存Judgmentに候補なし'}`;
    article.append(heading, evidence); container.append(article);
  }
}

function showMessages(id, messages, className = '') {
  const target = byId(id); target.replaceChildren();
  for (const message of messages) { const p = document.createElement('p'); p.textContent = message;
    if (className) p.className = className; target.append(p); }
}

function renderValidation() {
  if (!builder) { showMessages('builder-validation', ['Evidence Importを完了してください。']); return; }
  const all = [...builderValidation.errors.map(item => `❌ ${item.message}`),
    ...builderValidation.warnings.map(item => `⚠ ${item.message}`)];
  showMessages('builder-validation', all);
  const groups = [
    ['initial-errors', item => item.path.startsWith('initial') || item.path === 'publicMessages.initialRuling'],
    ['investigation-errors', item => item.path.startsWith('investigation') || item.path.startsWith('evidence:') || item.path.startsWith('target:') || item.path.startsWith('rule:')],
    ['retrial-errors', item => item.path.startsWith('retrial')],
    ['objection-errors', item => item.path.startsWith('objection')],
    ['retry-errors', item => item.path.startsWith('retryPolicy') || (item.path.startsWith('publicMessages') && item.path !== 'publicMessages.initialRuling')],
  ];
  for (const [id, matches] of groups) {
    const errors = builderValidation.errors.filter(matches).map(item => `❌ ${item.message}`);
    const warnings = builderValidation.warnings.filter(matches).map(item => `⚠ ${item.message}`);
    showMessages(id, [...errors, ...warnings]);
  }
}

function renderPreview() {
  setOutput('progression-preview', builderPreview?.progressionPlan ?? (builder ? progressionDraft(builder) : null));
}

function changed({ rerender = false } = {}) {
  builderDirty = true; builderPreview = null;
  builderValidation = validateProgressionBuilder(builder, author?.progressionReferences);
  if (rerender) renderBuilder(); else { renderValidation(); renderPreview(); renderWizard(); }
}

function renderBuilder() {
  if (!builder) { renderValidation(); renderPreview(); return; }
  renderEvidenceChoices('initial-evidence-options', 'initialCourtEvidenceIds');
  renderStatementChoices('initial-statement-options', 'initialCourtStatementIds');
  renderEvidenceChoices('investigation-evidence-options', 'investigationEvidenceIds');
  renderStatementChoices('retrial-statement-options', 'retrialStatementIds');
  byId('initial-ruling').value = builder.publicMessages.initialRuling;
  byId('return-condition').value = builder.returnToCourtCondition;
  byId('max-court-attempts').value = String(builder.retryPolicy.maxCourtAttempts);
  byId('acquittal-ruling').value = builder.publicMessages.acquittalRuling;
  byId('acquittal-explanation').value = builder.publicMessages.acquittalExplanation;
  byId('failure-feedback').value = builder.publicMessages.failureFeedback;
  renderTargetForm(); renderTargets(); renderRuleForm(); renderRules();
  renderObjections(); renderRetrialSummary(); renderValidation(); renderPreview();
}

function render() {
  renderAttacks(); byId('author-errors').replaceChildren();
  const locallyDirty = upstreamDirty || localDirtyStep != null;
  byId('workflow-state').textContent = locallyDirty ? '上流入力変更・再実行待ち' : author?.currentState ?? 'DRAFT';
  byId('waiting-state').textContent = author?.waitingFor ?? 'なし';
  byId('stage-state').textContent = upstreamDirty ? 'INPUT' : author?.stage ?? 'INPUT';
  if (uiError) byId('author-errors').textContent = uiError;
  else if (author?.issues?.length && !upstreamDirty) setOutput('author-errors', author.issues);
  renderOperationStatus();
  renderOptions();
  setOutput('prepare-result', !upstreamDirty && author?.scenarioOptions?.length
    ? { status: 'SATISFIED', candidateGraphOptions: author.scenarioOptions.length } : null);
  const scenarioDirty = upstreamDirty || (localDirtyStep != null && localDirtyStep <= 2);
  const verificationDirty = upstreamDirty || (localDirtyStep != null && localDirtyStep <= 3);
  const evidenceDirty = upstreamDirty || (localDirtyStep != null && localDirtyStep <= 5);
  setOutput('scenario-result', scenarioDirty ? null : author?.scenarioImportResult);
  byId('verification-prompt').value = scenarioDirty ? '' : author?.verificationPrompt ?? '';
  byId('verification-input').value = scenarioDirty ? '' : jsonText(author?.verificationInput);
  setOutput('verification-result', verificationDirty ? null : author?.verificationResult);
  byId('evidence-prompt').value = verificationDirty ? '' : author?.evidencePrompt ?? '';
  byId('evidence-input').value = verificationDirty ? '' : jsonText(author?.evidenceGenerationInput);
  setOutput('evidence-result', evidenceDirty ? null : author?.evidenceImportResult);
  renderBuilder();
  setOutput('build-result', locallyDirty ? null : { gameCaseStatus: author?.gameCaseStatus,
    gameMakeStatus: author?.gameMakeStatus, evaluation: author?.evaluationResult,
    orchestrator: author?.orchestrator, prototypeEvaluation: author?.prototypeEvaluation });
  const play = byId('play-game');
  play.hidden = locallyDirty || !(author?.currentState === 'ACCEPTED' && author?.playUrl)
    || (!author?.prototypeSelection && builderDirty);
  if (!play.hidden) play.href = author.playUrl;
  byId('prepare-evidence').disabled = busy || author?.verificationResult?.status !== 'VERIFIED';
  byId('prepare-evidence').hidden = Boolean(author?.prototypeSelection) && !byId('developer-inputs').open;
  byId('build-xss-prototype').disabled = busy || author?.verificationResult?.status !== 'VERIFIED';
  byId('build-xss-prototype').hidden = !author?.prototypeSelection;
  byId('build-xss-prototype-final').disabled = busy || author?.verificationResult?.status !== 'VERIFIED';
  byId('build-xss-prototype-final').hidden = !author?.prototypeSelection;
  byId('build-game').hidden = Boolean(author?.prototypeSelection) && !byId('developer-inputs').open;
  byId('import-review').disabled = busy || !author?.verificationInput;
  byId('import-evidence').disabled = busy || !author?.evidenceGenerationInput;
  byId('validate-progression').disabled = busy || !builder;
  byId('build-game').disabled = busy || builderDirty || builderPreview?.status !== 'VALID';
  renderWizard();
}

async function validatePlan() {
  builderValidation = validateProgressionBuilder(builder, author?.progressionReferences);
  renderValidation(); if (!builderValidation.valid) { renderWizard(); return; }
  const value = await api('/api/author/preview-progression', { progressionPlan: progressionDraft(builder) });
  if (!value) return;
  builderPreview = value.preview; builderDirty = value.preview.status !== 'VALID';
  if (value.preview.status !== 'VALID') {
    const backendErrors = value.preview.issues.map(item => ({ code: item.code,
      path: item.field, message: item.reason }));
    builderValidation = { ...builderValidation, valid: false,
      errors: [...builderValidation.errors, ...backendErrors] };
  }
  render();
}

async function copy(id) {
  const node = byId(id); const text = 'value' in node ? node.value : node.textContent;
  try { await navigator.clipboard.writeText(text); byId('author-errors').textContent = 'コピーしました。'; }
  catch { node.focus(); if ('select' in node) node.select(); byId('author-errors').textContent = '選択した内容をコピーしてください。'; }
}

function save(id) {
  const node = byId(id); const text = 'value' in node ? node.value : node.textContent;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${id}.json`; link.click(); URL.revokeObjectURL(url);
}

function bindFile(fileId, textareaId, dirtyStep) {
  byId(fileId).addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      byId('author-errors').textContent = 'JSONファイルは2MiB以内にしてください。'; return;
    }
    byId(textareaId).value = await file.text();
    if (dirtyStep != null) markImportedDataDirty(dirtyStep);
  });
}

byId('prepare-scenario').addEventListener('click', async () => {
  try {
    const body = byId('developer-inputs').open
      ? { selectedAttackIds: selectedAttacks(), network: parseJson('network-json'),
        scenarioContext: parseJson('context-json') }
      : prototypeSelection();
    const value = await api('/api/author/prepare-scenario', body);
    if (value?.author?.scenarioOptions?.length) {
      upstreamDirty = false; localDirtyStep = null; currentStep = 1;
      operationStatus = `Scenario候補を${value.author.scenarioOptions.length}件生成しました。Step 2へ移動しました。`;
    }
  } catch (error) { uiError = error.message; operationStatus = '入力を確認してください。'; }
  render();
});
byId('network-json').addEventListener('input', markUpstreamDirty);
byId('context-json').addEventListener('input', markUpstreamDirty);
byId('scenario-option').addEventListener('change', renderScenarioOption);
byId('import-scenario').addEventListener('click', async () => {
  try { const value = await api('/api/author/import-scenario', { optionId: byId('scenario-option').value,
    scenarioPackage: parseJson('scenario-json') });
    if (value) { localDirtyStep = null; syncBuilder(); render(); } }
  catch (error) { byId('author-errors').textContent = error.message; }
});
byId('import-review').addEventListener('click', async () => {
  try { const value = await api('/api/author/import-review', { semanticReview: parseJson('review-json') });
    if (value) { localDirtyStep = null; syncBuilder(); render(); } }
  catch (error) { byId('author-errors').textContent = error.message; }
});
byId('prepare-evidence').addEventListener('click', () => api('/api/author/prepare-evidence'));
byId('build-xss-prototype').addEventListener('click', async () => {
  const value = await api('/api/author/build-xss-prototype');
  if (value?.author?.playUrl) currentStep = 7;
});
byId('build-xss-prototype-final').addEventListener('click', async () => {
  await api('/api/author/build-xss-prototype');
});
byId('import-evidence').addEventListener('click', async () => {
  try { const value = await api('/api/author/import-evidence', { evidencePackage: parseJson('evidence-json') });
    if (value) { localDirtyStep = null; syncBuilder(); render(); } }
  catch (error) { byId('author-errors').textContent = error.message; }
});
byId('build-game').addEventListener('click', async () => {
  if (!builder || builderDirty || builderPreview?.status !== 'VALID') return;
  await api('/api/author/build', { progressionPlan: progressionDraft(builder) });
});
byId('validate-progression').addEventListener('click', validatePlan);
byId('wizard-back').addEventListener('click', () => {
  if (!byId('developer-inputs').open) {
    const indices = [0, 1, 2, 3, 7]; const position = indices.indexOf(currentStep);
    currentStep = indices[Math.max(0, position - 1)]; render(); return;
  }
  currentStep = moveWizard(currentStep, 'back', completion()); render();
});
byId('wizard-next').addEventListener('click', () => {
  if (!byId('developer-inputs').open) {
    const indices = [0, 1, 2, 3, 7]; const position = indices.indexOf(currentStep);
    const ready = [Boolean(author?.scenarioOptions?.length) && !upstreamDirty,
      Boolean(author?.scenarioOptions?.length) && !upstreamDirty,
      author?.scenarioImportResult?.status === 'VALID' && localDirtyStep == null,
      author?.verificationResult?.status === 'VERIFIED' && localDirtyStep == null,
      author?.currentState === 'ACCEPTED'];
    if (!ready[position]) { byId('wizard-requirement').textContent = currentStep === 7
      ? '検証済みScenarioからXSSゲームをBuildしてください。' : STEP_REQUIREMENTS[currentStep].message; return; }
    currentStep = indices[Math.min(position + 1, indices.length - 1)]; render(); return;
  }
  const complete = completion();
  if (!complete[currentStep]) {
    byId('wizard-requirement').textContent = STEP_REQUIREMENTS[currentStep].message;
    const focusId = currentStep === 3 && author?.verificationResult?.status === 'VERIFIED'
      ? 'prepare-evidence' : STEP_REQUIREMENTS[currentStep].focusId;
    byId(focusId)?.focus();
    return;
  }
  currentStep = moveWizard(currentStep, 'next', complete); render();
});
byId('target-type').addEventListener('change', () => {
  if (!editingTargetId) byId('target-id').value = nextTargetId(byId('target-type').value,
    builder.investigationTargets.map(item => item.targetId));
  renderTargetForm();
});
byId('save-target').addEventListener('click', saveTarget);
byId('cancel-target').addEventListener('click', clearTargetForm);
byId('rule-target').addEventListener('change', renderRuleForm);
byId('save-rule').addEventListener('click', saveRule);
byId('cancel-rule').addEventListener('click', clearRuleForm);
for (const [id, update] of [
  ['initial-ruling', value => { builder.publicMessages.initialRuling = value; }],
  ['acquittal-ruling', value => { builder.publicMessages.acquittalRuling = value; }],
  ['acquittal-explanation', value => { builder.publicMessages.acquittalExplanation = value; }],
  ['failure-feedback', value => { builder.publicMessages.failureFeedback = value; }],
]) byId(id).addEventListener('input', event => { if (!builder) return; update(event.target.value); changed(); });
byId('return-condition').addEventListener('change', event => {
  builder.returnToCourtCondition = event.target.value; changed();
});
byId('max-court-attempts').addEventListener('input', event => {
  builder.retryPolicy.maxCourtAttempts = Number(event.target.value); changed();
});
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click',
  () => copy(button.dataset.copy)));
document.querySelectorAll('[data-save]').forEach(button => button.addEventListener('click',
  () => save(button.dataset.save)));
byId('scenario-json').addEventListener('input', () => markImportedDataDirty(2));
byId('review-json').addEventListener('input', () => markImportedDataDirty(3));
byId('evidence-json').addEventListener('input', () => markImportedDataDirty(5));
bindFile('scenario-file', 'scenario-json', 2); bindFile('review-file', 'review-json', 3);
bindFile('evidence-file', 'evidence-json', 5);
byId('developer-inputs').addEventListener('toggle', () => { currentStep = 0; render(); });

api('/api/author/start');
