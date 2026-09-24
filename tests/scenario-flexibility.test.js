// 2026-09-20: シナリオの固定化と割当て失敗を再現し、技術検証を維持する回帰テスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { createDefaultConfiguration, validateScenarioConfiguration }
  from '../server/generation/scenario-configuration.js';
import { AutoGenerationManager, autoAuthorBootstrap, buildMakotomaruOutputSchema,
  createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { buildScenarioTemplate, validateScenarioDesignBoundary }
  from '../server/generation/scenario-template.js';
import { resolveAuthoringBindings, linkRequestBindings } from '../server/generation/authoring-bindings.js';

const catalog = await loadCatalog();

test('記述変更は許可し、Ground Truth・時刻・取得要件の改変は拒否する', () => {
  const configuration = createDefaultConfiguration();
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const template = buildScenarioTemplate({ configuration, generationInput });
  const changed = structuredClone(template);
  changed.evidenceRequirements.requirements[0].description = '構成に沿った学習上の問い';
  assert.doesNotThrow(() => validateScenarioDesignBoundary(template, changed));
  for (const mutate of [
    value => { value.groundTruth.technicalFacts = []; },
    value => { value.timeline.narrativeTimestamps[0].displayTimestamp = '2026-01-16T09:10:00+09:00'; },
    value => { value.evidenceRequirements.requirements[0].grounds = []; },
  ]) {
    const invalid = structuredClone(template); mutate(invalid);
    assert.throws(() => validateScenarioDesignBoundary(template, invalid),
      { code: 'SCENARIO_DESIGN_BOUNDARY_CHANGED' });
  }
});

test('Requestは独立し、同じ対象への前段効果がある場合だけ共有する', () => {
  const configuration = createDefaultConfiguration({ attackIds: ['phishing', 'reflected_xss', 'sql_injection'] });
  const single = createDefaultConfiguration();
  const network = validateScenarioConfiguration(single, catalog).technical.network;
  const definitions = new Map(catalog.map(d => [d.id, d]));
  const bindings = new Map(configuration.attacks.map(a => [a.attackId,
    resolveAuthoringBindings(network, a, definitions.get(a.attackId))]));
  assert.equal(new Set([...bindings.values()].map(b => b.request)).size, 3);
  linkRequestBindings(configuration.attacks, definitions, bindings);
  assert.equal(bindings.get('phishing').request, bindings.get('reflected_xss').request);
  assert.notEqual(bindings.get('phishing').request, bindings.get('sql_injection').request);
});

test('接続拒否・Platform不一致・全Role不足・逆順の攻撃連鎖を補完しない', () => {
  for (const mutate of [
    configuration => { configuration.network.connections = []; },
    configuration => { configuration.network.services.find(s => s.serviceId === 'web-service').platform = 'sql'; },
  ]) {
    const configuration = createDefaultConfiguration(); mutate(configuration);
    assert.equal(validateScenarioConfiguration(configuration, catalog).status, 'INVALID');
  }
  const definitions = structuredClone(catalog);
  definitions.find(d => d.id === 'reflected_xss').requiredRoles.find(r => r.binding === 'web_host').values.push('sensitive_service');
  assert.equal(validateScenarioConfiguration(createDefaultConfiguration(), definitions).status, 'INVALID');
  const reversed = createDefaultConfiguration({ attackIds: ['reflected_xss', 'phishing'] });
// 2026-09-20 修正前: 別RequestのXSSと後刻のフィッシングは因果を捏造せず独立攻撃として受理
//   assert.equal(validateScenarioConfiguration(reversed, catalog).status, 'INVALID');
// 2026-09-20 修正後: 別RequestのXSSと後刻のフィッシングは因果を捏造せず独立攻撃として受理
  const result = validateScenarioConfiguration(reversed, catalog);
  assert.equal(result.status, 'VALID');
  assert.equal(result.technical.generationInput.technicalInput.attackGraph.components.length, 2);
});

for (const preset of autoAuthorBootstrap().networkPresets) {
  for (const attackIds of [['phishing'], ['reflected_xss'], ['sql_injection'], ['phishing', 'reflected_xss']]) {
    test(`${preset.id} / ${attackIds.join('+')} を設計・独立検証・承認後にREADYへ変換する`, async () => {
      const configuration = structuredClone(autoAuthorBootstrap().defaultManualConfiguration);
      configuration.network = structuredClone(preset.network);
// 2026-09-20 修正前: 単独の初期値を使い、選択順で発生時刻を明示
//       configuration.attacks = attackIds.map((id, index) => ({ ...preset.attackDefaults.find(a => a.attackId === id), order: index + 1 }));
// 2026-09-20 修正後: 単独の初期値を使い、選択順で発生時刻を明示
      configuration.attacks = attackIds.map((id, index) => ({ ...preset.attackDefaults.find(a => a.attackId === id),
        order: index + 1, occurrenceTime: '2026-09-18T09:' + String(10 + index * 8).padStart(2, '0') + ':00+09:00' }));
      const runner = new MockCodexRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
      const session = createAutoAuthorSession(); manager.submitManual(session, configuration);
      await manager.waitForIdle();
      assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(session.auto.details));
      manager.approve(session); await manager.waitForIdle();
      assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
      assert.equal(session.evaluationResult.status, 'ACCEPTED');
      assert.deepEqual(session.configuration, configuration);
    });
  }
}

test('接続先からDBを一意に決定し、無関係な同RoleのDBを追加しても生成できる', () => {
  const configuration = createDefaultConfiguration({ attackIds: ['sql_injection'] });
  configuration.network.nodes.push({ ...configuration.network.nodes.find(n => n.nodeId === 'db-host'),
    nodeId: 'other-db', ip: '10.10.0.60' });
  configuration.network.services.push({ ...configuration.network.services.find(s => s.nodeId === 'db-host'),
    serviceId: 'other-db-service', nodeId: 'other-db' });
  const result = validateScenarioConfiguration(configuration, catalog);
  assert.equal(result.status, 'VALID', JSON.stringify(result.errors));
  const binding = result.technical.candidate.assignments[0].bindings.find(b => b.name === 'database');
  assert.equal(binding.entityId, 'db-service');
});

test('真実丸は全登録Network presetを受け取り各構成のIDを出力できる', async () => {
  const runner = new MockCodexRunner();
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.startMakotomaru(session, { schemaVersion: '1.0', difficulty: 1,
    attackCategory: 'ANY', complexity: 'STANDARD' });
  await manager.waitForIdle();
  const data = runner.calls.find(c => c.phase === 'MAKOTOMARU_CONFIGURATION').data;
  assert.deepEqual(data.networkPresets.map(p => p.id), autoAuthorBootstrap().networkPresets.map(p => p.id));
  const attack = buildMakotomaruOutputSchema({ difficulty: 1 }).properties.configuration.properties.attacks.items.properties;
  for (const preset of autoAuthorBootstrap().networkPresets) {
    assert.ok(preset.network.nodes.every(n => attack.sourceNodeId.enum.includes(n.nodeId)));
    assert.ok(preset.network.services.every(s => attack.targetServiceId.enum.includes(s.serviceId)));
  }
});

test('初回にScenario Agentが事件条件に沿って設計し、独立検証と承認を経由する', async () => {
  class Designer extends MockCodexRunner {
    async runJson(args) {
      const result = await super.runJson(args);
      if (args.phase === 'GENERATING_SCENARIO') {
        result.characters.characters.find(c => c.characterId === 'character_witness').displayName = '架空の支店監査担当者';
      }
      return result;
    }
  }
  const runner = new Designer(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  const configuration = createDefaultConfiguration();
  configuration.incidentContext.organizationName = '架空の支店';
  manager.submitManual(session, configuration); await manager.waitForIdle();
  const design = runner.calls.find(c => c.phase === 'GENERATING_SCENARIO');
  assert.ok(design, '初回Scenario Agentが呼ばれていない');
  assert.equal(design.data.scenarioConfiguration.incidentContext.organizationName, '架空の支店');
  assert.equal(session.scenarioPackage.characters.characters.find(c => c.characterId === 'character_witness').displayName,
    '架空の支店監査担当者');
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  assert.equal(runner.reviewCalls, 1); assert.equal(runner.evidenceCalls, 0);
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY');
  assert.equal(session.evaluationResult.status, 'ACCEPTED');
});

test('Scenario Agentが技術構造を書き換え続ける場合は上限で停止しReview・Evidenceへ進まない', async () => {
  class InvalidDesigner extends MockCodexRunner {
    async runJson(args) {
      const result = await super.runJson(args);
      if (['GENERATING_SCENARIO', 'REVISING_SCENARIO'].includes(args.phase)) {
        result.groundTruth.technicalFacts = [];
      }
      return result;
    }
  }
  const runner = new InvalidDesigner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession(); manager.submitManual(session, createDefaultConfiguration());
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'FAILED');
  assert.equal(runner.scenarioCalls, 3);
  assert.equal(runner.reviewCalls, 0); assert.equal(runner.evidenceCalls, 0);
  assert.ok(session.auto.details.some(d => d.code === 'SCENARIO_DESIGN_BOUNDARY_CHANGED'));
});

test('複数攻撃で1000文字の調査目的を設定しても要件の長さ制限内に保持する', () => {
  const configuration = createDefaultConfiguration({ attackIds: ['phishing', 'reflected_xss'] });
  for (const attack of configuration.attacks) attack.evidenceAnswer = '観測事実'.repeat(250);
  const validation = validateScenarioConfiguration(configuration, catalog);
  assert.equal(validation.status, 'VALID');
  const template = buildScenarioTemplate({ configuration, generationInput: validation.technical.generationInput });
  for (const requirement of template.evidenceRequirements.requirements) assert.ok(requirement.description.length <= 2000);
  for (const attack of configuration.attacks) assert.ok(template.evidenceRequirements.requirements
// 2026-09-24 修正前: 統合前の契約。
//     .some(r => r.requirementId.startsWith('requirement_observation_') && r.description.includes(attack.evidenceAnswer)));
// 2026-09-24 修正後: main制作画面・初回設計とkawata-workのゲーム生成を統合。
    .some(r => r.requirementId.startsWith('requirement_goal_') && r.description.includes(attack.evidenceAnswer)));
});
