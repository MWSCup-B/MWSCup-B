import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { createManualAttackPreset, scenarioCreationBootstrap, validateScenarioConfiguration }
  from '../server/generation/scenario-configuration.js';
import { buildEvidenceInvestigationPlan } from '../server/generation/investigation-registry.js';
import { buildScenarioTemplate } from '../server/generation/scenario-template.js';
import { buildAttackGraphs } from '../server/generation/attack-graph.js';
import { AutoGenerationManager, autoAuthorView, createAutoAuthorSession }
  from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated } from '../server/generated-game.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { collectCurrentTarget, enterCurrentCourt, currentCorrectPair } from './helpers/court-issues.js';

const catalog = await loadCatalog();
const presets = scenarioCreationBootstrap(catalog).manualAttackPresets;

for (const { attackIds, configuration } of presets) {
  test(`プリセット ${attackIds.join('+')}: 全選択攻撃・因果順序・全資料を維持する`, async () => {
    const before = structuredClone(configuration);
    const validation = validateScenarioConfiguration(configuration, catalog);
    assert.equal(validation.status, 'VALID', JSON.stringify(validation.errors));
    const input = validation.technical.generationInput;
    const graph = input.technicalInput.attackGraph;
    assert.equal(graph.components.length, 1);
    assert.equal(graph.nodes.length, attackIds.length);
    assert.equal(configuration.difficulty, attackIds.length);
    assert.deepEqual(configuration.attacks.map(attack => attack.attackId === 'credential_phishing'
      ? 'phishing' : attack.attackId).sort(), [...attackIds].sort());
    const plan = buildEvidenceInvestigationPlan(configuration, input);
    assert.ok(plan.length >= 2);
    const scenario = buildScenarioTemplate({ configuration, generationInput: input });
    for (const attack of configuration.attacks) {
      assert.ok(scenario.evidenceRequirements.requirements.some(requirement =>
        requirement.description.includes(attack.attackId === 'phishing'
          ? '保存メールに記載された誘導内容・リンク' : attack.attackId === 'credential_phishing'
            ? '保存メールの誘導リンクとWeb要求、偽フォームへの送信記録' : attack.evidenceAnswer)));
    }
    const runner = new MockCodexRunner();
    const manager = new AutoGenerationManager({ jsonRunner: runner });
    const session = createAutoAuthorSession();
    manager.submitManual(session, configuration); await manager.waitForIdle();
    assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(autoAuthorView(session).developerDetails));
    assert.equal(runner.evidenceCalls, 0, 'Approval前にEvidenceを生成しない');
    manager.approve(session); await manager.waitForIdle();
    assert.equal(session.auto.state, 'READY', JSON.stringify(autoAuthorView(session).developerDetails));
    const draftInput = runner.calls.find(call => call.phase === 'GENERATING_EVIDENCE').data.evidenceDraftInput;
    assert.equal(draftInput.contextFormat, 'DEDUPLICATED_VERIFIED_INPUT_V1');
    assert.deepEqual(draftInput.evidenceAgentInput.scenarioVerificationInput, session.verificationInput);
    assert.deepEqual(draftInput.evidenceAgentInput.verificationResult, session.verificationResult);
    const previousInput = { ...draftInput, evidenceAgentInput: session.evidenceGenerationInput.evidenceAgentInput };
    assert.ok(Buffer.byteLength(JSON.stringify(draftInput)) < Buffer.byteLength(JSON.stringify(previousInput)) * 0.7);
    assert.equal(session.evaluationResult.status, 'ACCEPTED');
    assert.equal(session.runtime.gameCase.progression.courtIssues.length, session.runtime.gameCase.detective.investigationTargets.length);
    const artifacts = session.evidenceImportResult.evidenceSet.evidenceArtifacts;
    for (const route of plan) {
      assert.ok(artifacts.some(artifact => artifact.type === route.evidenceType
        && artifact.sourceRefs.some(ref => ref.sourceId === route.ground.sourceId
          && ref.attackNodeId === route.ground.attackNodeId)));
    }
    const runtime = session.runtime;
    const game = createGeneratedGame(runtime);
    actGenerated(game, runtime, { action: 'begin' });
    actGenerated(game, runtime, { action: 'continue' });
    for (let round = 1; round <= runtime.gameCase.progression.courtRoundCount; round += 1) {
      collectCurrentTarget(game, runtime);
      enterCurrentCourt(game, runtime);
      actGenerated(game, runtime, { action: 'objection', ...currentCorrectPair(runtime, round) });
    }
    assert.equal(game.currentState, 'ACQUITTED');
    assert.ok(artifacts.filter(item => item.type !== 'TESTIMONY').every(artifact => game.collectedEvidenceIds.includes(artifact.evidenceId)));
    assert.deepEqual(configuration, before);
  });
}

test('空・重複・未知・4種類・旧UI専用の選択肢をプリセット生成へ通さない', () => {
  for (const ids of [[], ['phishing', 'phishing'], ['unknown'], ['reflected_xss'],
    ['phishing', 'stored_xss', 'unauthorized_login', 'sql_injection']]) {
    assert.throws(() => createManualAttackPreset(ids, catalog), { code: 'INVALID_ATTACK_SELECTION' });
  }
});

test('選択順に依存せず因果順序で準備し、既存プリセットを共有変更しない', () => {
  const ids = ['stored_xss', 'unauthorized_login', 'phishing'];
  const a = createManualAttackPreset(ids, catalog); const b = createManualAttackPreset([...ids].reverse(), catalog);
  assert.deepEqual(a.attacks.map(attack => attack.attackId), ['credential_phishing', 'unauthorized_login', 'stored_xss']);
  assert.deepEqual(a.attacks, b.attacks);
  a.network.nodes[0].label = '編集済み';
  assert.notEqual(a.network.nodes[0].label, b.network.nodes[0].label);
});

test('順序を反転した入力や不足した認証取得元・到達性を自動補完しない', () => {
  const ids = ['stored_xss', 'unauthorized_login'];
  const reversed = createManualAttackPreset(ids, catalog);
  reversed.attacks.reverse().forEach((attack, index) => {
    attack.order = index + 1; attack.occurrenceTime = `2026-09-18T09:${10 + index * 8}:00+09:00`;
  });
  assert.ok(validateScenarioConfiguration(reversed, catalog).errors
    .some(error => error.code === 'ATTACK_DEPENDENCY_ORDER_MISMATCH'));
  for (const mutate of [
    config => { config.network.nodes.find(node => node.nodeId === 'auth-host').logSources = []; },
    config => { config.network.connections = config.network.connections.filter(edge => edge.toNodeId !== 'auth-host'); },
    config => { config.network.services = config.network.services.filter(service => service.serviceId !== 'auth-service'); },
  ]) {
    const config = createManualAttackPreset(ids, catalog); mutate(config);
    const before = structuredClone(config);
    assert.equal(validateScenarioConfiguration(config, catalog).status, 'INVALID');
    assert.deepEqual(config, before);
  }
});

test('XSSの実行防御と認証条件が不明・不成立なら技術検証を通さない', () => {
  for (const predicate of ['password_only_authentication', 'credential_valid', 'script_execution_permitted',
    'stored_payload_precedes_retrieval']) {
    for (const value of [null, false]) {
      const config = createManualAttackPreset(['phishing', 'stored_xss', 'unauthorized_login'], catalog);
      const technical = validateScenarioConfiguration(config, catalog).technical;
      const condition = [...technical.scenarioContext.authenticationConditions,
        ...technical.scenarioContext.otherConditions].find(item => item.predicate === predicate);
      assert.ok(condition, predicate); condition.value = value;
      const result = buildAttackGraphs({ definitions: catalog, network: technical.network,
        context: technical.scenarioContext, candidate: technical.candidate });
      assert.notEqual(result.status, 'CREATED', predicate);
    }
  }
});

test('Stored XSSのブラウザの動作記録がない構成は証拠を捏造せず停止する', () => {
  const configuration = createManualAttackPreset(['stored_xss'], catalog);
  configuration.network.nodes.find(node => node.nodeId === 'client-host').logSources = ['BROWSER_HISTORY'];
  const { technical } = validateScenarioConfiguration(configuration, catalog);
  assert.throws(() => buildScenarioTemplate({ configuration, generationInput: technical.generationInput }),
    { code: 'EVIDENCE_SOURCE_UNAVAILABLE' });
});
