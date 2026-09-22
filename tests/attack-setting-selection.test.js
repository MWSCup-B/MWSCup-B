import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { AUTHOR_ATTACK_CHOICES, SCENARIO_SETTINGS } from '../server/generation/author-options.js';
import { createSelectionConfiguration, buildAttackSelectionPaths } from '../server/generation/scenario-selection.js';
import { validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildAttackGraphs } from '../server/generation/attack-graph.js';
import { buildScenarioTemplate } from '../server/generation/scenario-template.js';
import { validateStageRequirements } from '../server/generation/scenario-stage-plan.js';
import { buildEvidenceInvestigationPlan } from '../server/generation/investigation-registry.js';
import { AutoGenerationManager, createAutoAuthorSession, autoAuthorBootstrap } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { createGeneratedGame, actGenerated } from '../server/generated-game.js';
import { collectCurrentTarget, enterCurrentCourt, currentCorrectPair } from './helpers/court-issues.js';

const catalog = await loadCatalog();
const request = (attackIds, settingId = 'company') => ({ schemaVersion: '1.0', attackIds, settingId });
const expectedPaths = [
  ...AUTHOR_ATTACK_CHOICES.map(item => [item.id]),
  ['phishing', 'stored_xss'], ['phishing', 'unauthorized_login'], ['phishing', 'clickfix'],
  ['unauthorized_login', 'stored_xss'], ['clickfix', 'ransomware'], ['password_spray', 'unauthorized_login'],
  ['phishing', 'unauthorized_login', 'stored_xss'], ['phishing', 'clickfix', 'ransomware'],
  ['password_spray', 'unauthorized_login', 'stored_xss'],
];
const keys = paths => paths.map(path => path.join('>')).sort();

test('順序付き全400通りを検査し、直前からの因果関係だけを許可する', () => {
  const selections = [];
  const append = prefix => {
    for (const { id } of AUTHOR_ATTACK_CHOICES) if (!prefix.includes(id)) {
      const path = [...prefix, id]; selections.push(path);
      if (path.length < 3) append(path);
    }
  };
  append([]);
  let validCount = 0;
  assert.equal(selections.length, 400);
  for (const ids of selections) {
    const input = request(ids); const before = structuredClone(input);
    if (!expectedPaths.some(path => path.join('>') === ids.join('>'))) {
      assert.throws(() => createSelectionConfiguration(input, catalog), error =>
        ['INVALID_ATTACK_COMBINATION', 'ATTACK_DEPENDENCY_ORDER_MISMATCH', 'INVALID_ATTACK_SEQUENCE'].includes(error.code));
      assert.deepEqual(input, before);
      continue;
    }
    const config = createSelectionConfiguration(input, catalog);
    assert.deepEqual(input, before);
    assert.deepEqual(config.attacks.map(item => item.attackId === 'credential_phishing'
      ? 'phishing' : item.attackId), ids, '選択順を保持する');
    assert.equal(config.difficulty, ids.length);
    const validation = validateScenarioConfiguration(config, catalog);
    assert.equal(validation.status, 'VALID', JSON.stringify(validation.errors));
    validCount += 1;
    assert.equal(validation.technical.generationInput.technicalInput.attackGraph.components.length, 1);
    const scenario = buildScenarioTemplate({ configuration: config, generationInput: validation.technical.generationInput });
    assert.deepEqual(validateStageRequirements(config, validation.technical.generationInput, scenario), []);
    assert.ok(buildEvidenceInvestigationPlan(config, validation.technical.generationInput).length >= 2);
  }
  assert.equal(validCount, 17, '単独8・直接つながる2件6・直列の3件3');
});

test('候補は実際の技術グラフから導出し、公開データに根拠や答えを含めない', () => {
  const paths = buildAttackSelectionPaths(catalog);
  assert.deepEqual(keys(paths), keys(expectedPaths));
  for (const path of paths) for (let length = 1; length <= path.length; length += 1) {
    assert.ok(paths.some(prefix => prefix.join('>') === path.slice(0, length).join('>')));
  }
  const bootstrap = autoAuthorBootstrap();
  assert.deepEqual(keys(bootstrap.attackSelectionPaths), keys(paths));
  bootstrap.attackSelectionPaths[0].push('tampered');
  assert.deepEqual(keys(autoAuthorBootstrap().attackSelectionPaths), keys(paths));
  const changed = structuredClone(catalog);
  changed.find(item => item.id === 'clickfix').effects[0].predicate = 'independent_endpoint_execution';
  const changedPaths = buildAttackSelectionPaths(changed);
  assert.ok(!changedPaths.some(path => path.join('>') === 'clickfix>ransomware'), '固定の相性表でなくeffectとの一致を再検査');
});

for (const setting of SCENARIO_SETTINGS) test(`舞台 ${setting.label} を自動設定へ反映する`, () => {
  for (const attack of AUTHOR_ATTACK_CHOICES) {
    const config = createSelectionConfiguration(request([attack.id], setting.id), catalog);
    assert.equal(validateScenarioConfiguration(config, catalog).status, 'VALID');
    assert.equal(config.incidentContext.organizationName, setting.organizationName);
    assert.equal(config.incidentContext.accusedRole, setting.accusedRole);
    assert.equal(config.incidentContext.victimSystem, setting.victimSystem);
    assert.equal(config.network.subnets[1].label, setting.networkLabel);
    assert.ok(config.attacks[0].notes.length > 0);
    assert.match(config.attacks[0].occurrenceTime, /^2026-09-18T09:10:00\+09:00$/);
  }
});

test('空・4件・重複・未知・内部用攻撃・設定の上書きを入力境界で拒否する', () => {
  for (const value of [request([]), request(['phishing', 'clickfix', 'ransomware', 'sql_injection']),
    request(['clickfix', 'clickfix']), request(['unknown']), request(['credential_phishing']),
    request(['phishing'], 'unknown'), { ...request(['phishing']), network: {} },
    { ...request(['phishing']), difficulty: 3 }, { attackIds: ['clickfix'], settingId: 'school' }]) {
    assert.throws(() => createSelectionConfiguration(value, catalog));
  }
});

for (const ids of expectedPaths) test(`模擬生成から全調査・4択・法廷・無罪まで: ${ids.join(' → ')}`, async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const session = createAutoAuthorSession(); const chosen = request(ids, 'government');
  manager.submitSelection(session, chosen); await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(session.auto.details));
  assert.deepEqual(session.auto.selection.request, chosen);
  assert.deepEqual(session.scenarioPreview.attacks.map(attack => attack.attackId === 'credential_phishing'
    ? 'phishing' : attack.attackId), ids);
  assert.equal(session.evidenceImportResult, null, '承認前にEvidenceを生成しない');
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
  assert.equal(session.evaluationResult.status, 'ACCEPTED');
  const { runtime } = session; const game = createGeneratedGame(runtime);
  const opening = actGenerated(game, runtime, { action: 'begin' });
  assert.match(opening.initialCourt.incidentOverview, /水杜市役所/);
  actGenerated(game, runtime, { action: 'continue' });
  for (let round = 1; round <= runtime.gameCase.progression.courtRoundCount; round += 1) {
    collectCurrentTarget(game, runtime); enterCurrentCourt(game, runtime);
    actGenerated(game, runtime, { action: 'objection', ...currentCorrectPair(runtime, round) });
  }
  assert.equal(game.currentState, 'ACQUITTED');
});

test('新攻撃の利用者操作・権限・認証条件が欠ける場合、技術ゲートを通さない', () => {
  for (const [id, predicate] of [
    ['clickfix', 'user_runs_deceptive_instruction'], ['clickfix', 'user_level_execution_permitted'],
    ['password_spray', 'sprayed_candidate_matches_account'], ['password_spray', 'spray_attempt_not_blocked'],
    ['ransomware', 'endpoint_execution_available'], ['ransomware', 'user_can_modify_target_files'],
    ['unrestricted_file_upload', 'upload_storage_writable'], ['unrestricted_file_upload', 'upload_validation_inadequate'],
  ]) for (const value of [null, false]) {
    const config = createSelectionConfiguration(request([id]), catalog);
    const { technical } = validateScenarioConfiguration(config, catalog);
    const facts = Object.values(technical.scenarioContext).filter(Array.isArray).flat();
    facts.find(item => item.predicate === predicate).value = value;
    const graph = buildAttackGraphs({ definitions: catalog, network: technical.network,
      context: technical.scenarioContext, candidate: technical.candidate });
    assert.notEqual(graph.status, 'CREATED', `${id}: ${predicate}=${value}`);
  }
});

test('不足した新取得元を捏造せず、資料生成前に停止する', () => {
  for (const [id, hostId, logSource] of [
    ['clickfix', 'client-host', 'DEVICE'], ['password_spray', 'auth-host', 'CONFIGURATION'],
    ['ransomware', 'client-host', 'FILE'], ['unrestricted_file_upload', 'web-host', 'FILE'],
  ]) {
    const config = createSelectionConfiguration(request([id]), catalog);
    const host = config.network.nodes.find(item => item.nodeId === hostId);
    host.logSources = host.logSources.filter(type => type !== logSource);
    const { technical } = validateScenarioConfiguration(config, catalog);
    assert.throws(() => buildScenarioTemplate({ configuration: config, generationInput: technical.generationInput }),
      { code: 'EVIDENCE_SOURCE_UNAVAILABLE' });
  }
});

test('不成立の組合せはAIを起動せず、処理中の再送信はセッションを壊さない', async () => {
  const runner = new MockCodexRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  assert.throws(() => manager.submitSelection(session, request(['sql_injection', 'ransomware'])),
    { code: 'INVALID_ATTACK_COMBINATION' });
  assert.equal(session.configuration, null);
  assert.equal(runner.calls.length, 0);
  manager.submitSelection(session, request(['clickfix']));
  const generationId = session.auto.generationId;
  assert.throws(() => manager.submitSelection(session, request(['ransomware'])), { code: 'GENERATION_LOCKED' });
  assert.equal(session.auto.generationId, generationId);
  assert.deepEqual(session.auto.selection.request, request(['clickfix']));
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
});
