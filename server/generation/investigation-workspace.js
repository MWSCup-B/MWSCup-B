// Pure operations on sealed teaching data. No filesystem, process, shell or eval.
import { GameError } from '../game.js';
import { investigationCompletionId } from './investigation-validator.js';

export const sourceLines = item => {
  const lines = item.publicContent.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
};
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value);
const ownList = (map, key) => map && Object.hasOwn(map, key) ? map[key] : [];
const valueFields = /^(source_ip|sourceIp|client_ip|remote_ip|account|username|user|host|hostname|timestamp|request_target|session_ref|request_ref|correlation_id|device_id)$/;
const rowsOf = item => sourceLines(item).map((text, index) => {
  let value;
  try { value = JSON.parse(text); } catch { value = null; }
  // If parsing discards duplicate keys or rounds a number, retain only the raw
  // view/search capability. Never teach a lossy interpretation as a fact.
  const compact = text.replace(/"(?:\\.|[^"\\])*"|\s+/g, token => token.startsWith('"') ? token : '');
  if (value && JSON.stringify(value) !== compact) value = null;
  return { line: index + 1, text, value: value && typeof value === 'object' && !Array.isArray(value) ? value : null };
});
export function materialCapabilities(item) {
  const rows = rowsOf(item);
  return { console: item.type.endsWith('_LOG'), json: rows.length > 0 && rows.every(row => row.value),
    authentication: item.type === 'AUTHENTICATION_LOG', fields: [...new Set(rows.flatMap(row =>
      Object.entries(row.value ?? {}).filter(([, value]) => scalar(value)).map(([key]) => key)))] };
}

export const COMMAND_HELP = '固定資料だけを調べる疑似コマンドです。cat material.txt / head -n 12 material.txt / tail -n 12 material.txt / grep -F "検索値" material.txt / jq -c \'select(.項目 == "値")\' material.txt / jq -r \'.項目\' material.txt | sort | uniq -c。head/tail は1〜100件。grepは正規表現ではなく文字列検索です。IPやアカウントだけでは操作者を確定できません。';

export function commandTemplates(item) {
  const capabilities = materialCapabilities(item);
  const templates = [
    { label: '全文', command: 'cat material.txt' },
    { label: '先頭', command: 'head -n 12 material.txt' },
    { label: '末尾', command: 'tail -n 12 material.txt' },
    { label: '文字列検索', command: 'grep -F "検索値" material.txt' },
  ];
  if (capabilities.json) {
    const field = capabilities.fields.find(key => /^(source_ip|account|result|status)$/.test(key));
    if (field) templates.push({ label: '項目別件数', command: `jq -r '.${field}' material.txt | sort | uniq -c` });
    // Exact meaning values only: "unsuccessful" must never match "success".
    for (const [label, pattern] of [['成功', /^(success|succeeded|accepted|authenticated|granted|true)$/i],
      ['失敗', /^(failure|failed|rejected|denied|invalid|false)$/i]]) {
      const pair = rowsOf(item).flatMap(row => Object.entries(row.value))
        .find(([key, value]) => /^(result|status|session_accepted)$/.test(key) && pattern.test(String(value)));
      if (capabilities.authentication && pair) templates.push({ label,
        command: `jq -c 'select(.${pair[0]} == ${JSON.stringify(pair[1])})' material.txt` });
    }
  }
  return templates;
}

export function executeMaterialCommand(item, input) {
  const error = message => ({ command: typeof input === 'string' ? input.slice(0, 500) : '', valid: false,
    output: message, lines: [], observations: [], matchedRecords: 0, totalRecords: sourceLines(item).length });
  if (typeof input !== 'string' || input.length > 500 || /[\x00-\x1f]/.test(input)) return error('対応していないコマンドです。helpで構文を確認してください。');
  const command = input.trim();
  if (command === 'help') return error(COMMAND_HELP);
  const rows = rowsOf(item);
  let selected;
  let output;
  const simple = command.match(/^(cat|head|tail)(?: -n (\d{1,3}))? (?:-- )?material\.txt$/);
  const grep = command.match(/^grep (?:-F )?("(?:\\.|[^"\\])*") material\.txt$/);
  const select = command.match(/^jq -c 'select\(\.([a-zA-Z_][a-zA-Z_0-9]*) == ("(?:\\.|[^"\\])*"|true|false|-?\d+(?:\.\d+)?)\)' material\.txt$/);
  const count = command.match(/^jq -r '\.([a-zA-Z_][a-zA-Z_0-9]*)' material\.txt \| sort \| uniq -c$/);
  if (simple) {
    const [, op, raw] = simple; const n = Number(raw);
    if (op === 'cat' ? raw !== undefined : !Number.isInteger(n) || n < 1 || n > 100) return error('head/tailの件数は1〜100、catは件数指定なしです。');
    selected = op === 'cat' ? rows : op === 'head' ? rows.slice(0, n) : rows.slice(-n);
  } else if (grep) {
    let needle;
    try { needle = JSON.parse(grep[1]); } catch { return error('検索値の引用符を確認してください。'); }
    if (!needle || needle.length > 200) return error('検索値は1〜200文字です。');
    selected = rows.filter(row => row.text.includes(needle));
  } else if (select || count) {
    const field = (select ?? count)[1];
    if (!materialCapabilities(item).json || !rows.some(row => Object.hasOwn(row.value, field))) return error('この資料に指定のJSON項目はありません。');
    if (select) {
      let value;
      try { value = JSON.parse(select[2]); } catch { return error('比較値の形式を確認してください。'); }
      selected = rows.filter(row => Object.hasOwn(row.value, field) && row.value[field] === value);
    } else {
      if (rows.some(row => row.value[field] != null && !scalar(row.value[field])))
        return error('この集計構文は文字列・数値・真偽値・nullの項目に対応します。');
      const counts = new Map();
      for (const row of rows) {
        const value = row.value[field] == null ? 'null' : String(row.value[field]);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      output = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([value, n]) => `${n} ${value}`).join('\n');
      selected = []; // Aggregate output cannot prove that an original row was read.
    }
  } else return error('対応していないコマンドです。helpで構文を確認してください。');
  const observations = new Map();
  for (const row of selected) for (const [field, value] of Object.entries(row.value ?? {})) {
    if (valueFields.test(field) && scalar(value) && String(value).length <= 200)
      observations.set(`${field}:${value}`, { field, value: String(value) });
  }
  return { command, valid: true, output: output ?? selected.map(row => row.text).join('\n'),
    lines: selected.map(row => row.line), observations: [...observations.values()],
    matchedRecords: count ? rows.length : selected.length, totalRecords: rows.length };
}

export function requiredCourtEvidence(gameCase, round) {
  const issue = gameCase.progression.courtIssues?.[round - 1];
  return [...new Set([...(issue?.requiredEvidenceIds ?? gameCase.progression.investigation.requiredForCourtIds),
    ...(issue?.question?.supportingQuotes.map(quote => quote.evidenceId) ?? [])])];
}

export function investigationProgress(session, gameCase) {
  const required = requiredCourtEvidence(gameCase, session.currentRound);
  const collected = required.filter(id => session.collectedEvidenceIds.includes(id));
  return { required: required.length, collected: collected.length, complete: required.length > 0 && required.length === collected.length };
}

export function workspaceMaterial(session, item) {
  const history = ownList(session.commandHistory, item.evidenceId);
  const seen = ownList(session.observedLines, item.evidenceId);
  // Candidates use only displayed original rows, never private answer quotations.
  const facts = sourceLines(item).flatMap((text, index) => seen.includes(index + 1) ? [{ line: index + 1, text }] : []);
  return { capabilities: materialCapabilities(item), templates: commandTemplates(item), history, facts,
    savedFacts: ownList(session.savedFacts, item.evidenceId) };
}

export function workspaceAction(session, gameCase, { action, materialId, command, field, value, line }) {
  const item = gameCase.detective.evidence.find(item => item.evidenceId === materialId && item.type !== 'TESTIMONY');
  const rule = gameCase.detective.evidenceDiscoveryRules.find(rule => rule.evidenceId === materialId
    && rule.prerequisites.requiredEvidenceIds.every(id => session.discoveredEvidenceIds.includes(id))
    && rule.prerequisites.requiredCompletedActionIds.every(id => session.completedInvestigationActions.includes(id)));
  if (!item || !rule) throw new GameError('MATERIAL_PREREQUISITES_REQUIRED', 'materialId', '取得条件を満たした資料を選んでください。');
  if (action === 'workspace-command' || action === 'workspace-read') {
    const result = executeMaterialCommand(item, action === 'workspace-read' ? 'cat material.txt' : command);
    session.commandHistory ??= {}; session.observedLines ??= {};
    const history = session.commandHistory[materialId] = ownList(session.commandHistory, materialId);
    history.push(result); if (history.length > 30) history.shift();
    session.observedLines[materialId] = [...new Set([...ownList(session.observedLines, materialId), ...result.lines])];
    // Read completion unlocks existing routes, but does not collect evidence.
    if (session.observedLines[materialId].length === sourceLines(item).length) {
      if (!session.discoveredEvidenceIds.includes(materialId)) session.discoveredEvidenceIds.push(materialId);
      const id = investigationCompletionId(rule.targetId, rule.actionId);
      if (!session.completedInvestigationActions.includes(id)) session.completedInvestigationActions.push(id);
    }
  } else if (action === 'save-observation') {
    const observed = rowsOf(item).some(row => ownList(session.observedLines, materialId).includes(row.line)
      && row.value && valueFields.test(field) && Object.hasOwn(row.value, field) && scalar(row.value[field]) && String(row.value[field]) === value);
    if (typeof field !== 'string' || typeof value !== 'string' || value.length > 200 || !observed)
      throw new GameError('OBSERVATION_NOT_SEEN', 'value', '表示した原文にある値だけを保存できます。');
    session.savedObservations ??= [];
    if (!session.savedObservations.some(entry => entry.materialId === materialId && entry.field === field && entry.value === value)) {
      if (session.savedObservations.length >= 100) throw new GameError('OBSERVATION_LIMIT', 'value', '保存値は100件までです。');
      session.savedObservations.push({ materialId, field, value });
    }
  } else if (action === 'save-fact') {
    if (!Number.isInteger(line) || !ownList(session.observedLines, materialId).includes(line))
      throw new GameError('FACT_NOT_SEEN', 'line', '表示した原文の行を選んでください。');
    session.savedFacts ??= {}; const facts = session.savedFacts[materialId] = ownList(session.savedFacts, materialId);
    if (!facts.some(fact => fact.line === line)) facts.push({ line, text: sourceLines(item)[line - 1] });
    if (!session.discoveredEvidenceIds.includes(materialId)) session.discoveredEvidenceIds.push(materialId);
    if (!session.collectedEvidenceIds.includes(materialId)) session.collectedEvidenceIds.push(materialId);
  }
}
