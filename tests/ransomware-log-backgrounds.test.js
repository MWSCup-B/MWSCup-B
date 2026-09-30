import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLogBackgrounds } from '../server/generation/log-backgrounds.js';
import { isRansomwareLog, validateExplorableWebLogs, validateGeneratedLogFormats } from '../server/generation/evidence-log-format.js';
import { executeMaterialCommand } from '../server/generation/investigation-workspace.js';
import { ransomwareEvidence, ransomwareLogSamples } from './helpers/ransomware-evidence.js';

function fixture() {
  const evidenceArtifacts = Object.entries(ransomwareEvidence()).map(([sourceId, [type, title, publicContent]]) => ({
    evidenceId: sourceId, type, title, publicContent,
    sourceRefs: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT', sourceId, attackNodeId: 'ransom' }],
  }));
  return { evidenceArtifacts, logBackgrounds: ransomwareLogSamples(evidenceArtifacts),
    courtQuestions: [{ supportingQuotes: evidenceArtifacts.map(item => ({ evidenceId: item.evidenceId,
      quote: item.publicContent.split('\n')[0] })) }],
    materialInvestigations: evidenceArtifacts.map(item => ({ evidenceId: item.evidenceId, steps: [{ choices: [
      { operation: { kind: 'LINES', firstLine: 1, lastLine: item.publicContent.split('\n').length } },
      { operation: { kind: 'LINES', firstLine: 1, lastLine: 1 } },
    ] }] })),
  };
}
const rows = item => item.publicContent.trim().split('\n').map(JSON.parse);
const find = (draft, id) => draft.evidenceArtifacts.find(item => item.evidenceId === id);
const changeSample = (draft, id, change) => {
  const plan = draft.logBackgrounds.find(item => item.evidenceId === id);
  plan.samples[0] = JSON.stringify(change(JSON.parse(plan.samples[0])));
};

test('endpoint logs become 100 distinct rows without changing original bytes, quotations, line operations or file snapshots', () => {
  const input = fixture(), before = structuredClone(input), draft = prepareLogBackgrounds(input);
  assert.deepEqual(input, before);
  validateExplorableWebLogs(draft.evidenceArtifacts); validateGeneratedLogFormats(draft.evidenceArtifacts);
  for (const item of draft.evidenceArtifacts) {
    const original = find(input, item.evidenceId);
    if (!isRansomwareLog(item, draft.evidenceArtifacts)) { assert.deepEqual(item, original); continue; }
    const lines = item.publicContent.split('\n'), originalLines = original.publicContent.split('\n');
    assert.equal(lines.length, 100); assert.equal(new Set(lines).size, 100);
    assert.ok(item.publicContent.includes(original.publicContent));
    const position = lines.indexOf(originalLines[0]);
    assert.ok(position > 0 && position + originalLines.length < 100);
    const choices = draft.materialInvestigations.find(plan => plan.evidenceId === item.evidenceId).steps[0].choices;
    assert.deepEqual(choices[0].operation, { kind: 'LINES', firstLine: 1, lastLine: 100 });
    assert.deepEqual(choices[1].operation, { kind: 'LINES', firstLine: position + 1, lastLine: position + 1 });
  }
  assert.deepEqual(draft.courtQuestions, input.courtQuestions);
  assert.deepEqual(prepareLogBackgrounds(draft), draft);
});

test('searching 100 rows still finds only the original incident PID and unchanged period counts', () => {
  const input = fixture(), draft = prepareLogBackgrounds(input);
  const original = find(input, 'file_operation_record'), expanded = find(draft, 'file_operation_record');
  for (const command of [
    `jq -c 'select(.timestamp >= "2026-09-18T00:10:00.000Z" and .timestamp <= "2026-09-18T00:10:20.000Z") | [.pid, .executable, .operation]' material.txt | sort | uniq -c`,
    `jq -sc 'map(select(.pid == 4242)) | sort_by(.timestamp)[]' material.txt`,
  ]) {
    const result = executeMaterialCommand(expanded, command), base = executeMaterialCommand(original, command);
    assert.equal(result.valid, true); assert.equal(result.matchedRecords, 14);
    assert.equal(result.output, base.output);
  }
  const originalTimes = input.evidenceArtifacts.filter(item => isRansomwareLog(item, input.evidenceArtifacts)).flatMap(rows).map(row => Date.parse(row.timestamp));
  const originalLines = new Set(original.publicContent.split('\n'));
  for (const line of expanded.publicContent.split('\n').filter(line => !originalLines.has(line))) {
    const row = JSON.parse(line), time = Date.parse(row.timestamp);
    assert.ok(time < Math.min(...originalTimes) - 60000 || time > Math.max(...originalTimes) + 60000);
    assert.notEqual(row.pid, 4242); assert.notEqual(row.process_ref, 'training-writer');
  }
});

test('ordinary file/process pairs and observed parent pairs keep identities and time order through expansion', () => {
  const input = fixture();
  const plan = input.logBackgrounds.find(item => item.evidenceId === 'process_execution_record');
  // The first ordinary application also launches the second and third.
  plan.samples = plan.samples.map((line, i) => {
    const row = JSON.parse(line);
    return JSON.stringify(i ? { ...row, parent_ref: 'proc-801', parent_pid: 80001 } : row);
  });
  const draft = prepareLogBackgrounds(input), starts = rows(find(draft, 'process_execution_record'));
  let matchedFiles = 0, matchedParents = 0;
  for (const row of rows(find(draft, 'file_operation_record')).filter(row => row.pid >= 10000)) {
    const start = starts.find(start => start.process_ref === row.process_ref);
    if (!start) continue; // The two saved excerpts can end at different cycles.
    matchedFiles++;
    for (const key of ['pid', 'device_id', 'user_ref', 'executable']) assert.equal(start[key], row[key]);
    assert.ok(Date.parse(start.timestamp) <= Date.parse(row.timestamp));
  }
  for (const row of starts.filter(row => row.pid >= 10000)) {
    const parent = starts.find(parent => parent.process_ref === row.parent_ref);
    if (!parent) continue;
    matchedParents++; assert.equal(parent.pid, row.parent_pid);
    assert.ok(Date.parse(parent.timestamp) <= Date.parse(row.timestamp));
  }
  assert.ok(matchedFiles > 30); assert.ok(matchedParents > 30);
  assert.equal(new Set(starts.map(row => row.process_ref)).size, starts.length);
  assert.equal(new Set(starts.map(row => row.pid)).size, starts.length);
});

test('100-row requirements apply only to logs from the matching ransomware node', () => {
  const input = fixture(), process = find(input, 'process_execution_record');
  const clickfix = { ...structuredClone(process), sourceRefs: [{ ...process.sourceRefs[0], attackNodeId: 'clickfix' }] };
  const context = [...input.evidenceArtifacts, clickfix];
  assert.equal(isRansomwareLog(clickfix, context), false);
  validateExplorableWebLogs([clickfix], context);
  for (const item of input.evidenceArtifacts.filter(item => isRansomwareLog(item, context))) {
    assert.throws(() => validateExplorableWebLogs([item], context), { code: 'EVIDENCE_LOG_CONTEXT_REQUIRED' });
    assert.throws(() => validateExplorableWebLogs([{ ...item, publicContent: Array(100).fill(item.publicContent.split('\n')[0]).join('\n') }], context),
      { code: 'EVIDENCE_LOG_CONTEXT_REQUIRED' });
  }
});

for (const [name, id, change] of [
  ['incident PID', 'file_operation_record', row => ({ ...row, pid: 4242 })],
  ['incident ref', 'file_operation_record', row => ({ ...row, process_ref: 'training-writer' })],
  ['damaged path', 'file_operation_record', row => ({ ...row, path: 'C:/training/sales/report-0.pdf' })],
  ['another host', 'file_operation_record', row => ({ ...row, device_id: 'new-host' })],
  ['new observation', 'file_operation_record', row => ({ ...row, source_ip: '192.0.2.1' })],
  ['mismatched PID', 'file_operation_record', row => ({ ...row, pid: 88888 })],
  ['reversed operation time', 'file_operation_record', row => ({ ...row, timestamp: '2020-01-01T00:00:00Z' })],
  ['incident parent', 'process_execution_record', row => ({ ...row, parent_pid: 4000, parent_ref: 'training-launcher' })],
]) test(`ordinary rows cannot introduce ${name}`, () => {
  const input = fixture(); changeSample(input, id, change);
  assert.throws(() => prepareLogBackgrounds(input), { code: 'EVIDENCE_LOG_BACKGROUND_INVALID' });
});
