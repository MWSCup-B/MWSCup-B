import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLogBackgrounds } from '../server/generation/log-backgrounds.js';
import { validateExplorableWebLogs, validateGeneratedLogFormats } from '../server/generation/evidence-log-format.js';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

function fixture() {
  const lines = ['{"timestamp":"2026-09-18T09:10:00Z","request_id":"req-051","status":200,"sequence":9007199254740993}',
    '{"timestamp":"2026-09-18T09:10:01Z","request_id":"req-052","status":200}'];
  return { evidenceArtifacts: [{ evidenceId: 'web', type: 'WEB_ACCESS_LOG', publicContent: lines.join('\r\n') + '\r\n' }],
    logBackgrounds: [{ evidenceId: 'web', samples: [200, 304, 404].map((status, i) => JSON.stringify({
      timestamp: '2026-09-18T09:00:00Z', request_id: `req-${101 + i}`, request_target: ['/home', '/help', '/favicon.ico'][i], status })) }],
    courtQuestions: [{ supportingQuotes: [{ evidenceId: 'web', quote: lines[0] }] }],
    materialInvestigations: [{ evidenceId: 'web', steps: [{ choices: [
      { operation: { kind: 'LINES', firstLine: 1, lastLine: 2 } },
      { operation: { kind: 'LINES', firstLine: 2, lastLine: 2 } },
    ] }] }] };
}
test('ordinary samples expand before sealing, preserving incident bytes, quotes, chronology and line operations', () => {
  const input = fixture(), before = structuredClone(input), draft = prepareLogBackgrounds(input);
  assert.deepEqual(input, before);
  assert.equal(draft.logBackgrounds, undefined);
  const item = draft.evidenceArtifacts[0], rows = item.publicContent.trimEnd().split(/\r?\n/);
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows).size, 100);
  assert.ok(item.publicContent.includes(input.evidenceArtifacts[0].publicContent));
  assert.ok(item.publicContent.includes('9007199254740993'));
  const first = rows.indexOf(input.courtQuestions[0].supportingQuotes[0].quote);
  assert.ok(first > 0 && first < 98);
  assert.equal(rows.filter(line => JSON.parse(line).request_id === 'req-051').length, 1);
  const times = rows.map(row => Date.parse(JSON.parse(row).timestamp));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  const choices = draft.materialInvestigations[0].steps[0].choices;
  assert.deepEqual(choices[0].operation, { kind: 'LINES', firstLine: 1, lastLine: 100 });
  assert.deepEqual(choices[1].operation, { kind: 'LINES', firstLine: first + 2, lastLine: first + 2 });
  validateGeneratedLogFormats([item]); validateExplorableWebLogs([item]);
  assert.deepEqual(prepareLogBackgrounds(draft), draft);
});

test('ordinary timestamps retain the source precision and timezone, and incident positions vary', () => {
  const positions = new Set();
  for (const suffix of ['Z', '+09:00', '.123-04:00']) {
    const input = fixture();
    input.evidenceArtifacts[0].publicContent = input.evidenceArtifacts[0].publicContent.replaceAll('00Z', `00${suffix}`).replaceAll('01Z', `01${suffix}`);
    input.logBackgrounds[0].samples = input.logBackgrounds[0].samples.map(line => line.replace('00Z', `00${suffix}`));
    input.courtQuestions[0].supportingQuotes[0].quote = input.evidenceArtifacts[0].publicContent.split('\r\n')[0];
    const rows = prepareLogBackgrounds(input).evidenceArtifacts[0].publicContent.trimEnd().split(/\r?\n/);
    positions.add(rows.indexOf(input.courtQuestions[0].supportingQuotes[0].quote));
    assert.ok(rows.every(line => JSON.parse(line).timestamp.endsWith(suffix)));
    const times = rows.map(line => Date.parse(JSON.parse(line).timestamp));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  }
  assert.ok(positions.size > 1);
});
test('background expansion rejects unknown or duplicate targets and cannot manufacture a quoted answer', () => {
  for (const mutate of [
    draft => { draft.logBackgrounds[0].evidenceId = 'absent'; },
    draft => { draft.logBackgrounds.push(structuredClone(draft.logBackgrounds[0])); },
    draft => { draft.evidenceArtifacts[0].type = 'TESTIMONY'; },
    draft => { draft.courtQuestions[0].supportingQuotes[0].quote = 'a fabricated answer'; },
  ]) {
    const draft = fixture(); mutate(draft);
    assert.throws(() => prepareLogBackgrounds(draft), { code: 'EVIDENCE_LOG_BACKGROUND_INVALID' });
  }
});
for (const broken of [false, true]) test(`compact drafts ${broken ? 'reject broken incident links despite matching ordinary rows' : 'become searchable games through normal integrity gates'}`, async () => {
  class CompactRunner extends MockCodexRunner {
    async runJson(args) {
      const draft = await super.runJson(args);
      if (args.phase !== 'GENERATING_EVIDENCE') return draft;
      draft.logBackgrounds = [];
      for (const item of draft.evidenceArtifacts.filter(item => item.type.endsWith('_LOG'))) {
        const lines = item.publicContent.split('\n');
        draft.logBackgrounds.push({ evidenceId: item.evidenceId, samples: lines.slice(1, 4) });
        item.publicContent = lines[0];
        if (broken && item.type === 'DATABASE_LOG') {
          const row = JSON.parse(item.publicContent); row.request_id = 'unrelated-request';
          item.publicContent = JSON.stringify(row);
        }
        for (const step of draft.materialInvestigations.find(plan => plan.evidenceId === item.evidenceId).steps)
          for (const choice of step.choices) if (choice.operation.kind === 'LINES' && choice.operation.lastLine === lines.length)
            choice.operation.lastLine = 1;
      }
      for (const quote of draft.courtQuestions.flatMap(question => question.supportingQuotes)) {
        const source = draft.evidenceArtifacts.find(item => item.evidenceId === quote.evidenceId);
        // Only compact the logs: the report still needs its observation and
        // preserved target identifiers, not merely its heading.
        if (source.type.endsWith('_LOG')) quote.quote = source.publicContent.split('\n')[0];
      }
      return draft;
    }
  }
  const manager = new AutoGenerationManager({ jsonRunner: new CompactRunner() });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['sql_injection'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, broken ? 'FAILED' : 'READY', JSON.stringify(session.auto.details));
  if (broken) assert.ok(session.auto.details.some(issue => issue.code === 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING'));
  else validateExplorableWebLogs(session.evidenceImportResult.evidenceSet.evidenceArtifacts);
});
