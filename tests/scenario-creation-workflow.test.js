import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCatalog } from '../server/generation/catalog.js';
import { buildScenarioPreview, createDefaultConfiguration,
  validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildInvestigationAssignments, INVESTIGATION_BUILDERS }
  from '../server/generation/investigation-registry.js';
import { assignDialogueTemplate, COURT_DIALOGUE_TEMPLATE }
  from '../server/generation/dialogue-template.js';
import { AutoGenerationManager, autoAuthorView, createAutoAuthorSession }
  from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated, generatedPlayerView } from '../server/generated-game.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

const catalog = await loadCatalog();

test('Scenario ConfigurationはAttack 1個と因果関係のある2個を受理する', () => {
  const single = validateScenarioConfiguration(createDefaultConfiguration(), catalog);
  assert.equal(single.status, 'VALID'); assert.equal(single.technical.attackGraphResult.graphs[0].structure, 'SINGLE');
  const chain = validateScenarioConfiguration(createDefaultConfiguration({ difficulty: 2,
    attackIds: ['phishing', 'reflected_xss'] }), catalog);
  assert.equal(chain.status, 'VALID'); assert.equal(chain.technical.attackGraphResult.graphs[0].structure, 'LINEAR');
});

test('Attack 3個の無関係な並置と4個目を拒否する', () => {
  const three = createDefaultConfiguration({ difficulty: 3,
    attackIds: ['phishing', 'reflected_xss', 'sql_injection'] });
  let result = validateScenarioConfiguration(three, catalog);
  assert.equal(result.status, 'INVALID'); assert.equal(result.errors[0].code, 'INVALID_ATTACK_COMBINATION');
  const four = structuredClone(three); four.attacks.push({ ...four.attacks[2], attackId: 'reflected_xss', order: 3 });
  result = validateScenarioConfiguration(four, catalog);
  assert.equal(result.status, 'INVALID'); assert.ok(result.errors.some(item => item.code === 'INVALID_COUNT'));
});

test('Occurrence Time、Investigation support、Log Sourceを決定論的に検証する', () => {
  const configuration = createDefaultConfiguration({ difficulty: 2,
    attackIds: ['phishing', 'reflected_xss'] });
  configuration.attacks[1].occurrenceTime = configuration.attacks[0].occurrenceTime;
  let result = validateScenarioConfiguration(configuration, catalog);
  assert.ok(result.errors.some(item => item.code === 'INVALID_TIME_ORDER'));
  configuration.attacks[1].occurrenceTime = '2026-01-15T09:30:00+09:00';
  configuration.attacks[1].investigationTypes = ['EMAIL'];
  result = validateScenarioConfiguration(configuration, catalog);
  assert.ok(result.errors.some(item => item.code === 'UNSUPPORTED_INVESTIGATION'));
  configuration.attacks[1].investigationTypes = ['WEB_LOG'];
  configuration.attacks[1].investigationSourceNodeId = 'client-host';
  result = validateScenarioConfiguration(configuration, catalog);
  assert.ok(result.errors.some(item => item.code === 'INVESTIGATION_SOURCE_UNAVAILABLE'));
});

test('Network manual configurationとPreview用SVG UIを提供する', async () => {
  const configuration = createDefaultConfiguration();
  const preview = buildScenarioPreview(configuration);
  assert.equal(preview.network.subnets.length, 2); assert.equal(preview.network.nodes[0].ip, '203.0.113.10');
  const html = await readFile(new URL('../public/author.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/author.js', import.meta.url), 'utf8');
  assert.match(html, /Subnet追加/); assert.match(html, /Node追加/); assert.match(html, /Service追加/);
  assert.match(html, /manual-network-diagram/); assert.match(source, /createElementNS/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
});

test('攻撃別Investigation RegistryはAttack Definition外を生成しない', () => {
  assert.deepEqual(Object.keys(INVESTIGATION_BUILDERS).sort(),
    ['phishing', 'reflected_xss', 'sql_injection']);
  const configuration = createDefaultConfiguration({ difficulty: 2,
    attackIds: ['phishing', 'reflected_xss'] });
  const assignments = buildInvestigationAssignments(configuration);
  assert.deepEqual(assignments.map(item => item.attackId), ['phishing', 'reflected_xss']);
  assert.deepEqual(assignments[0].investigationTypes, ['EMAIL']);
});

test('ManualはPreviewで停止しUser Approval前にVerification/Evidenceへ進まない', async () => {
  const runner = new MockCodexRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession(); manager.submitManual(session,
    createDefaultConfiguration({ difficulty: 2, attackIds: ['phishing', 'reflected_xss'] }));
  await manager.waitForIdle(); let view = autoAuthorView(session);
  assert.equal(view.currentState, 'SCENARIO_PREVIEW'); assert.equal(runner.reviewCalls, 0);
  assert.equal(runner.evidenceCalls, 0); assert.equal(view.playUrl, null); assert.equal(view.canApprove, true);
  manager.approve(session); await manager.waitForIdle(); view = autoAuthorView(session);
  assert.equal(view.currentState, 'READY'); assert.equal(session.verificationResult.status, 'VERIFIED');
});

test('User Rejectは設定へ戻り、真実丸はinvalid outputを最大3回内で自動修正する', async () => {
  let runner = new MockCodexRunner(); let manager = new AutoGenerationManager({ jsonRunner: runner });
  let session = createAutoAuthorSession(); manager.submitManual(session, createDefaultConfiguration());
  await manager.waitForIdle(); manager.reject(session); assert.equal(session.auto.state, 'MANUAL_CONFIGURATION');
  runner = new MockCodexRunner({ invalidMakotomaruOutput: 2 });
  manager = new AutoGenerationManager({ jsonRunner: runner }); session = createAutoAuthorSession();
  manager.startMakotomaru(session, { schemaVersion: '1.0', difficulty: 3,
    attackCategory: 'ANY', complexity: 'COMPLEX' }); await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW'); assert.equal(runner.makotomaruCalls, 3);
  assert.equal(session.configuration.mode, 'MAKOTOMARU'); assert.ok(session.configuration.attacks.length <= 3);
});

function playToAcquittal(runtime) {
  const game = createGeneratedGame(runtime); actGenerated(game, runtime, { action: 'begin' });
  actGenerated(game, runtime, { action: 'continue' });
  for (const rule of runtime.gameCase.detective.evidenceDiscoveryRules) {
    actGenerated(game, runtime, { action: 'investigate', targetId: rule.targetId,
      investigationActionId: rule.actionId });
    if (game.discoveredEvidenceIds.includes(rule.evidenceId)) actGenerated(game, runtime,
      { action: 'collect', evidenceId: rule.evidenceId });
  }
  const judgment = runtime.gameCase.judgment.rules[0];
  for (let round = 1; round <= (runtime.roundCount ?? 1); round += 1) {
    actGenerated(game, runtime, { action: 'retrial' });
    actGenerated(game, runtime, { action: 'objection', statementId: judgment.targetStatementId,
      evidenceId: judgment.acceptedEvidenceIds[0] });
  }
  return game;
}

test('E2E A: MANUAL 2 Attack / ★★ はEvidence 2・Court Round 2・ACQUITTEDへ到達する', async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const session = createAutoAuthorSession(); manager.submitManual(session,
    createDefaultConfiguration({ difficulty: 2, attackIds: ['phishing', 'reflected_xss'] }));
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY'); assert.equal(session.evidenceChain.length, 2);
  assert.equal(session.dialoguePlan.rounds.length, 2);
  const game = playToAcquittal(session.runtime); assert.equal(game.currentState, 'ACQUITTED');
  assert.equal(game.currentRound, 2);
});

test('E2E B: MAKOTOMARU ★★★ は自動Configuration・Preview・Evidence 3・Round 3を経てACQUITTEDになる', async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const session = createAutoAuthorSession(); manager.startMakotomaru(session, {
    schemaVersion: '1.0', difficulty: 3, attackCategory: 'ANY', complexity: 'COMPLEX' });
  await manager.waitForIdle(); assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  manager.approve(session); await manager.waitForIdle(); assert.equal(session.auto.state, 'READY');
  assert.equal(session.evidenceChain.length, 3); assert.equal(session.dialoguePlan.rounds.length, 3);
  const game = playToAcquittal(session.runtime); assert.equal(game.currentState, 'ACQUITTED');
  assert.equal(game.currentRound, 3);
});

test('Dialogue Assignmentは固定Templateへslotを割り当てる', () => {
  assert.deepEqual(COURT_DIALOGUE_TEMPLATE.slice(0, 3), ['INTRO', 'INITIAL_COURT', 'INVESTIGATION']);
  const plan = assignDialogueTemplate({ configuration: createDefaultConfiguration(),
    scenarioPackage: { scenarioDraft: { title: '合成事件' } },
    evidenceSet: { evidenceArtifacts: [{ type: 'LOG', title: 'Web記録' }], exonerations: [] } });
  assert.equal(plan.slots.charge, '合成事件'); assert.equal(plan.fixedLines.objection, '異議あり！！');
});

test('Author viewとPlayer viewにGround Truth・内部判定・credentialを漏らさない', async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const session = createAutoAuthorSession(); manager.submitManual(session, createDefaultConfiguration());
  await manager.waitForIdle(); assert.doesNotMatch(JSON.stringify(autoAuthorView(session)),
    /groundTruth|acceptedEvidenceIds|accessToken|refreshToken/);
  manager.approve(session); await manager.waitForIdle(); const game = createGeneratedGame(session.runtime);
  assert.doesNotMatch(JSON.stringify(generatedPlayerView(game, session.runtime)),
    /groundTruth|scenarioConfiguration|attackGraph|acceptedEvidenceIds|verificationResult|prompt/i);
});
