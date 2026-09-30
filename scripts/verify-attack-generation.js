// Runs the existing author pipeline and a complete player path. This is a test
// author session: approving the preview does not publish a server game.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { AutoGenerationManager, autoAuthorBootstrap, autoAuthorView, createAutoAuthorSession }
  from '../server/auto-generation-service.js';
import { CodexRunner } from '../server/codex/codex-runner.js';
import { CodexJsonRunner } from '../server/codex/codex-json-runner.js';
import { actGenerated, createGeneratedGame } from '../server/generated-game.js';
import { correctCourtChoiceId } from '../server/generation/court-questions.js';
import { courtEvidenceLines, requiredCourtEvidence } from '../server/generation/court-evidence.js';

const { values } = parseArgs({ options: {
  real: { type: 'boolean', default: false },
  attacks: { type: 'string' }, setting: { type: 'string', default: 'company' },
  concurrency: { type: 'string', default: '1' }, output: { type: 'string' },
  'capture-dir': { type: 'string' },
} });
const concurrency = Number(values.concurrency);
if (![1, 2].includes(concurrency)) throw new Error('--concurrency must be 1 or 2');
const bootstrap = autoAuthorBootstrap();
const paths = values.attacks ? [values.attacks.split(',')]
  : [...bootstrap.attackSelectionPaths].sort((a, b) => a.length - b.length);
if (paths.some(path => !bootstrap.attackSelectionPaths.some(valid => JSON.stringify(valid) === JSON.stringify(path)))) {
  throw new Error('Select a registered attack path; comma-separated IDs preserve incident order.');
}
if (!bootstrap.settings.some(setting => setting.id === values.setting)) throw new Error('Unknown setting');
const captureDirectory = values['capture-dir'] ? resolve(values['capture-dir']) : null;
if (captureDirectory) await mkdir(captureDirectory, { recursive: true, mode: 0o700 });
const results = [];
let index = 0;
let reportWrite = Promise.resolve();

function play(runtime) {
  const player = createGeneratedGame(runtime);
  actGenerated(player, runtime, { action: 'begin' });
  actGenerated(player, runtime, { action: 'continue' });
  for (const issue of runtime.gameCase.progression.courtIssues) {
    // Save the verified original support again for each issue, just as a player
    // must do after the previous issue's submitted evidence is cleared.
    for (const materialId of requiredCourtEvidence(runtime.gameCase, player.currentRound)) {
      actGenerated(player, runtime, { action: 'workspace-read', materialId });
      for (const line of courtEvidenceLines(runtime.gameCase, player.currentRound, materialId)) {
        actGenerated(player, runtime, { action: 'save-fact', materialId, line });
      }
    }
    const rule = runtime.gameCase.judgment.judgmentRules.find(item => issue.judgmentRuleIds.includes(item.ruleId));
    const interpretationChoiceId = correctCourtChoiceId(issue.question);
    const evidenceId = rule.acceptedEvidenceIds[0];
    actGenerated(player, runtime, { action: 'retrial', interpretationChoiceId, evidenceId });
    actGenerated(player, runtime, { action: 'objection', interpretationChoiceId,
      statementId: rule.targetStatementId, evidenceId: rule.acceptedEvidenceIds[0] });
  }
  return player.currentState;
}

async function verify(attackIds) {
  const started = Date.now(); const captures = [];
  const runner = values.real ? new CodexJsonRunner(new CodexRunner())
    : new (await import('../tests/helpers/mock-codex.js')).MockCodexRunner();
  const jsonRunner = {
    checkAvailability: options => runner.checkAvailability(options),
    async runJson(args) {
      const event = { phase: args.phase, feedback: args.feedback ?? null };
      captures.push(event);
      try { event.output = await runner.runJson(args); return event.output; }
      catch (error) { event.error = { code: error.code, message: error.message }; throw error; }
    },
  };
  const manager = new AutoGenerationManager({ jsonRunner });
  const session = createAutoAuthorSession();
  let playState = null; let failure = null;
  try {
    manager.submitSelection(session, { schemaVersion: '1.0', attackIds, settingId: values.setting });
    await manager.waitForIdle();
    if (session.auto.state === 'SCENARIO_PREVIEW') {
      manager.approve(session); await manager.waitForIdle();
    }
    if (session.auto.state === 'READY') playState = play(session.runtime);
  } catch (error) { failure = { code: error.code ?? 'AUDIT_ERROR', message: error.message }; }
  const view = autoAuthorView(session);
  const result = { attackIds, state: session.auto.state, playState,
    passed: session.auto.state === 'READY' && playState === 'ACQUITTED',
    scenario: session.verificationResult?.status ?? null,
    evidence: session.evidenceImportResult?.status ?? null,
    evaluation: session.evaluationResult?.status ?? null,
    calls: captures.map(({ phase }) => phase), durationMs: Date.now() - started,
    failure: failure ?? view.failure, details: view.developerDetails };
  results.push(result);
  // Captures contain private synthetic test answers. They are opt-in, protected
  // local diagnostics, never part of the report or a player response.
  if (captureDirectory) await writeFile(join(captureDirectory, `${attackIds.join('--')}.json`),
    JSON.stringify({ result, captures }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ attackIds, passed: result.passed, state: result.state,
    playState, durationMs: result.durationMs, errors: result.details?.map(item => item.code) }));
  if (values.output) {
    reportWrite = reportWrite.then(() => writeFile(resolve(values.output), JSON.stringify({
      mode: values.real ? 'REAL_CODEX' : 'MOCK', setting: values.setting,
      complete: results.length === paths.length, results,
    }, null, 2), { mode: 0o600 }));
    await reportWrite;
  }
}

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (index < paths.length) await verify(paths[index++]);
}));
if (results.some(result => !result.passed)) process.exitCode = 1;
