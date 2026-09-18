import { AutoGenerationManager, autoAuthorView,
  createAutoAuthorSession } from '../server/auto-generation-service.js';
import { CodexRunner } from '../server/codex/codex-runner.js';
import { CodexJsonRunner } from '../server/codex/codex-json-runner.js';

const jsonRunner = new CodexJsonRunner(new CodexRunner({ cwd: process.cwd() }));
const manager = new AutoGenerationManager({ jsonRunner });
const session = createAutoAuthorSession();

manager.startMakotomaru(session, { schemaVersion: '1.0', difficulty: 1,
  attackCategory: 'ANY', complexity: 'STANDARD' });
await manager.waitForIdle();
if (session.auto.state === 'SCENARIO_PREVIEW') {
  manager.approve(session);
  await manager.waitForIdle();
}
const view = autoAuthorView(session);
console.log(JSON.stringify({ generationId: view.generationId, state: view.currentState,
  attempts: view.attempt, scenario: session.verificationResult?.status ?? null,
  evidence: session.evidenceImportResult?.status ?? null,
  gameCase: session.gameCaseResult?.status ?? null,
  evaluation: session.evaluationResult?.status ?? null,
  evaluationIssues: session.evaluationResult?.issues ?? null,
  prototypeEvaluation: session.prototypeEvaluation?.status ?? null,
  failure: view.failure, details: view.developerDetails }, null, 2));
if (view.currentState !== 'READY') process.exitCode = 1;
