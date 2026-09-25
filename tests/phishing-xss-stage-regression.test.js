import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { createSelectionConfiguration } from '../server/generation/scenario-selection.js';
import { validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildScenarioTemplate, validateScenarioEvidenceCoverage } from '../server/generation/scenario-template.js';
import { buildInvestigationStages } from '../server/generation/investigation-registry.js';
import { buildQuestionBackground } from '../server/generation/investigation-lessons.js';
import { phishingMaterialPolicy } from '../server/generation/attack-learning.js';
import { buildScenarioRevisionInput, applyScenarioRevision } from '../server/generation/scenario-revision.js';
import { importScenarioPackage } from '../server/generation/scenario-interface.js';
import { AutoGenerationManager, createAutoAuthorSession, autoAuthorView } from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated } from '../server/generated-game.js';
import { collectCurrentTarget, currentCorrectPair, enterCurrentCourt } from './helpers/court-issues.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

const catalog = await loadCatalog();
const key = ground => `${ground.attackNodeId}/${ground.sourceId}`;
const requirements = value => value.evidenceRequirements.requirements.filter(item => item.investigationStage);
function fixture(attackIds = ['phishing', 'stored_xss']) {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds, settingId: 'company' }, catalog);
  const validation = validateScenarioConfiguration(configuration, catalog);
  assert.equal(validation.status, 'VALID');
  const generationInput = validation.technical.generationInput;
  return { configuration, generationInput, scenarioPackage: buildScenarioTemplate({ configuration, generationInput }) };
}
function update(requirement, values = {}) {
  return { requirementId: requirement.requirementId, description: null, grounds: null, stageText: null, ...values };
}

test('URL不一致を確認済み事実にせず、制作者の目標と合成資料の比較値を区別する', () => {
  for (const attacks of [['phishing', 'stored_xss'], ['phishing', 'unauthorized_login', 'stored_xss']]) {
    const value = fixture(attacks);
    const original = structuredClone({ configuration: value.configuration, generationInput: value.generationInput });
    const goal = value.scenarioPackage.evidenceRequirements.requirements.find(item => item.requirementId === 'requirement_goal_1');
    if (value.configuration.attacks[0].attackId === 'phishing') {
      assert.match(goal.description, /保存メールに記載された誘導内容・リンク/);
      assert.doesNotMatch(goal.description, /実際に遷移するリンク先/);
    } else assert.match(goal.description, /保存メールの誘導リンクとWeb要求、偽フォームへの送信記録/);
    assert.match(goal.description, /制作者の想定回答.*Ground Truthで確認済みの事実ではない/);
    assert.match(goal.description, /合成資料内の設定値/);
    assert.match(requirements(value.scenarioPackage)[0].investigationStage.expectedInference, /不一致.*確認済みの技術的事実.*裏付けない/);
    assert.equal(importScenarioPackage(value).status, 'VALID');
    assert.deepEqual({ configuration: value.configuration, generationInput: value.generationInput }, original);
  }
});

test('共有Web取得元ではフィッシングを比較し、XSSの実行比較を端末資料の段階に置く', () => {
  const value = fixture(); const plans = requirements(value.scenarioPackage);
  const stages = buildInvestigationStages(value.configuration, value.generationInput);
  assert.equal(plans.length, 3);
  const phishing = value.generationInput.technicalInput.attackGraph.nodes.find(node => node.attackDefinitionId === 'phishing').nodeId;
  const xss = value.generationInput.technicalInput.attackGraph.nodes.find(node => node.attackDefinitionId === 'stored_xss').nodeId;
  // The XSS records remain available on their original host, outside this question.
  assert.ok(stages[1].routes.some(route => route.ground.attackNodeId === xss));
  assert.deepEqual(new Set(plans[1].grounds.map(key)), new Set([`${phishing}/email_record`, `${phishing}/web_access_record`]));
  assert.doesNotMatch(plans[1].description + plans[1].investigationStage.questionFocus, /Stored XSS|ブラウザ実行計測/);
  assert.doesNotMatch(buildQuestionBackground(stages, 1, value.generationInput), /Stored XSS/);
  for (const sourceId of ['stored_content_record', 'web_access_record', 'browser_execution_record'])
    assert.ok(plans[2].grounds.some(ground => ground.attackNodeId === xss && ground.sourceId === sourceId));
  assert.match(plans[2].investigationStage.questionFocus, /Stored XSS/);
  assert.deepEqual(validateScenarioEvidenceCoverage(value), []);
});

test('XSS単独の保存資料の段階も、未取得の実行計測との比較完了を要求しない', () => {
  const value = fixture(['stored_xss']); const plans = requirements(value.scenarioPackage);
  assert.doesNotMatch(plans[0].description, /必要資料をすべて取得済み|対応するブラウザ実行計測を照合する/);
  assert.match(plans[0].investigationStage.expectedInference, /実行成功は分からない/);
  assert.match(plans[1].description, /必要資料をすべて取得済み/);
  assert.deepEqual(validateScenarioEvidenceCoverage(value), []);
});

test('レビュー指示どおり共有段階を絞った修正を受理し、XSSの必須資料欠落は引き続き拒否する', () => {
  const value = fixture(); const plans = requirements(value.scenarioPackage);
  const stages = buildInvestigationStages(value.configuration, value.generationInput);
  const correctGrounds = structuredClone(plans[1].grounds);
  plans[1].grounds.push(...stages[1].routes.filter(route => !correctGrounds.some(ground => key(ground) === key(route.ground)))
    .map(route => structuredClone(route.ground)));
  const original = structuredClone(value);
  const input = buildScenarioRevisionInput(value);
  assert.deepEqual(input.stageRequirements[1].grounds, correctGrounds);
  const revised = applyScenarioRevision({ ...value, revision: { schemaVersion: '1.0', requirementUpdates: [
    update(plans[1], { grounds: correctGrounds }),
  ] } });
  assert.deepEqual(validateScenarioEvidenceCoverage({ ...value, scenarioPackage: revised }), []);
  assert.equal(importScenarioPackage({ ...value, scenarioPackage: revised }).status, 'VALID');
  assert.deepEqual(value, original);
  for (const missing of ['stored_content_record', 'web_access_record', 'browser_execution_record']) {
    const last = requirements(revised).at(-1);
    const xssNode = value.generationInput.technicalInput.attackGraph.nodes.find(node => node.attackDefinitionId === 'stored_xss').nodeId;
    assert.throws(() => applyScenarioRevision({ ...value, scenarioPackage: revised,
      revision: { schemaVersion: '1.0', requirementUpdates: [update(last, { grounds: last.grounds.filter(ground =>
        !(ground.attackNodeId === xssNode && ground.sourceId === missing)) })] } }), { code: 'INVESTIGATION_STAGE_PLAN_INVALID' });
  }
});

test('指摘された3項目を差分修正後に再レビューし、最大回数へ陥らず生成・無罪まで進める', async () => {
  class ReviewRunner extends MockCodexRunner {
    async runJson(args) {
      const result = await super.runJson(args);
      if (args.phase === 'REVIEWING_SCENARIO' && this.reviewCalls === 1) {
        for (const check of result.checks.filter(item => ['EVIDENCE_GROUND_ALIGNMENT', 'FACT_NARRATIVE_SEPARATION', 'INVESTIGATION_COVERAGE'].includes(item.category))) {
          check.outcome = 'FAIL'; check.reason = 'URL不一致の合成値と技術事実を区別し、Web段階をメールと要求記録の比較に限定してください。';
          check.correctionHint = 'XSSの比較はブラウザ実行計測を取得する後の段階へ残してください。';
        }
      }
      if (args.phase === 'REVISING_SCENARIO') {
        const stage = args.data.stageRequirements[1];
        const goal = args.data.scenarioTemplate.evidenceRequirements.requirements.find(item => item.requirementId === 'requirement_goal_1');
        return { schemaVersion: '1.0', requirementUpdates: [
          update(stage, { description: stage.description, grounds: stage.grounds }),
          update(goal, { description: `制作者の確認目標。${phishingMaterialPolicy('phishing')}` }),
        ] };
      }
      return result;
    }
  }
  const runner = new ReviewRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['phishing', 'stored_xss'], settingId: 'company' });
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(autoAuthorView(session).developerDetails));
  assert.equal(session.auto.attempt, 2); assert.equal(runner.reviewCalls, 2); assert.equal(runner.evidenceCalls, 0);
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(autoAuthorView(session).developerDetails));
  const game = createGeneratedGame(session.runtime);
  actGenerated(game, session.runtime, { action: 'begin' }); actGenerated(game, session.runtime, { action: 'continue' });
  for (let round = 1; round <= session.runtime.gameCase.progression.courtRoundCount; round++) {
    collectCurrentTarget(game, session.runtime); enterCurrentCourt(game, session.runtime);
    actGenerated(game, session.runtime, { action: 'objection', ...currentCorrectPair(session.runtime, round) });
  }
  assert.equal(game.currentState, 'ACQUITTED');
});
