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
      assert.match(goal.description, /保存メールの誘導内容・リンク/);
      assert.doesNotMatch(goal.description, /実際に遷移するリンク先/);
    } else assert.match(goal.description, /専用の送受信記録がある攻撃ではその取得後に送受信を扱う/);
    assert.doesNotMatch(goal.description, /立会人|直接観察|調査報告/);
    assert.match(goal.description, /原文の識別値で対応付け/);
    assert.match(goal.description, /制作者の想定回答.*Ground Truthで確認済みの事実ではない/);
    assert.match(goal.description, /合成資料内の設定値/);
    const first = requirements(value.scenarioPackage)[0];
    assert.deepEqual(first.grounds.map(ground => ground.sourceId), ['email_record']);
    assert.match(first.investigationStage.expectedInference, /保存メール.*(?:案内|リンク)/);
    assert.match(first.investigationStage.expectedInference, /実際のアクセス.*確認できない/);
    assert.doesNotMatch(first.investigationStage.expectedInference,
      /因果の結論に使うリンク先と要求対象|一致を示せない資料は合格させない/);
    assert.equal(importScenarioPackage(value).status, 'VALID');
    assert.deepEqual({ configuration: value.configuration, generationInput: value.generationInput }, original);
  }
});

test('共有Web取得元でも攻撃別の調査段階とし、XSSの実行比較を端末資料の段階に置く', () => {
  const value = fixture(); const plans = requirements(value.scenarioPackage);
  const stages = buildInvestigationStages(value.configuration, value.generationInput);
  assert.equal(plans.length, 4);
  const phishing = value.generationInput.technicalInput.attackGraph.nodes.find(node => node.attackDefinitionId === 'phishing').nodeId;
  const xss = value.generationInput.technicalInput.attackGraph.nodes.find(node => node.attackDefinitionId === 'stored_xss').nodeId;
  assert.ok(stages[1].routes.every(route => route.ground.attackNodeId === phishing));
  assert.ok(stages[2].routes.every(route => route.ground.attackNodeId === xss));
  assert.equal(stages[1].sourceNodeId, stages[2].sourceNodeId);
  assert.notEqual(stages[1].targetId, stages[2].targetId);
  assert.deepEqual(new Set(plans[1].grounds.filter(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT').map(key)),
    new Set([`${phishing}/email_record`, `${phishing}/web_access_record`]));
  assert.ok(plans[1].grounds.every(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT'));
  assert.doesNotMatch(plans[1].description + plans[1].investigationStage.questionFocus, /Stored XSS|ブラウザのスクリプト実行記録/);
  assert.doesNotMatch(buildQuestionBackground(stages, 1, value.generationInput), /Stored XSS/);
  for (const sourceId of ['stored_content_record', 'web_access_record', 'browser_execution_record', 'announcement_audit_record', 'browser_request_initiator_record'])
    assert.ok(plans[3].grounds.some(ground => ground.attackNodeId === xss && ground.sourceId === sourceId));
  assert.ok(plans[3].grounds.every(ground => ground.attackNodeId === xss));
  assert.match(plans[3].investigationStage.questionFocus, /被害.*開始元/);
  assert.deepEqual(validateScenarioEvidenceCoverage(value), []);
});

test('XSS単独の保存資料の段階も、未取得の実行記録との比較完了を要求しない', () => {
  const value = fixture(['stored_xss']); const plans = requirements(value.scenarioPackage);
  assert.doesNotMatch(plans[0].description, /必要資料をすべて取得済み|対応するブラウザのスクリプト実行記録を照合する/);
  assert.match(plans[0].investigationStage.expectedInference, /実行成功は分からない/);
  assert.match(plans[1].description, /必要資料をすべて取得済み/);
  assert.deepEqual(validateScenarioEvidenceCoverage(value), []);
});

test('3攻撃の最終争点をXSSの範囲へ絞った修正を受理し、他攻撃の資料を再要求しない', () => {
  const value = fixture(['phishing', 'unauthorized_login', 'stored_xss']); const plans = requirements(value.scenarioPackage);
  assert.equal(plans.length, 6);
  const xssNode = value.generationInput.technicalInput.attackGraph.nodes.find(node => node.attackDefinitionId === 'stored_xss').nodeId;
  const last = plans.at(-1);
  const correctGrounds = structuredClone(last.grounds);
  assert.ok(correctGrounds.every(ground => ground.attackNodeId === xssNode));
  // Reproduce the old all-attacks final requirement, then apply the review's
  // bounded correction. Earlier completed issues still prove their attacks.
  last.grounds.push(...plans.slice(0, -1).flatMap(plan => plan.grounds)
    .filter(ground => ground.attackNodeId !== xssNode)
    .filter((ground, index, grounds) => grounds.findIndex(item => key(item) === key(ground)) === index)
    .map(ground => structuredClone(ground)));
  const original = structuredClone(value);
  const input = buildScenarioRevisionInput(value);
  assert.deepEqual(input.stageRequirements.at(-1).grounds, correctGrounds);
  const revised = applyScenarioRevision({ ...value, revision: { schemaVersion: '1.0', requirementUpdates: [
    update(last, { grounds: correctGrounds }),
  ] } });
  assert.deepEqual(validateScenarioEvidenceCoverage({ ...value, scenarioPackage: revised }), []);
  assert.equal(importScenarioPackage({ ...value, scenarioPackage: revised }).status, 'VALID');
  assert.deepEqual(value, original);
  for (const missing of ['stored_content_record', 'web_access_record', 'browser_execution_record']) {
    const last = requirements(revised).at(-1);
    assert.throws(() => applyScenarioRevision({ ...value, scenarioPackage: revised,
      revision: { schemaVersion: '1.0', requirementUpdates: [update(last, { grounds: last.grounds.filter(ground =>
        !(ground.attackNodeId === xssNode && ground.sourceId === missing)) })] } }), { code: 'INVESTIGATION_STAGE_PLAN_INVALID' });
  }
});

test('3攻撃を差分修正後に再レビューし、各攻撃の論証を6争点で積み上げて無罪まで進める', async () => {
  class ReviewRunner extends MockCodexRunner {
    async runJson(args) {
      const result = await super.runJson(args);
      if (args.phase === 'REVIEWING_SCENARIO' && this.reviewCalls === 1) {
        for (const check of result.checks.filter(item => ['EVIDENCE_GROUND_ALIGNMENT', 'FACT_NARRATIVE_SEPARATION', 'INVESTIGATION_COVERAGE'].includes(item.category))) {
          check.outcome = 'FAIL'; check.reason = 'URL不一致の合成値と技術事実を区別し、Web段階をメールと要求記録の比較に限定してください。';
          check.correctionHint = 'XSSの比較はブラウザのスクリプト実行記録を取得する後の段階へ残してください。';
        }
      }
      if (args.phase === 'REVISING_SCENARIO') {
        const stage = args.data.stageRequirements.at(-1);
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
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['phishing', 'unauthorized_login', 'stored_xss'], settingId: 'company' });
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(autoAuthorView(session).developerDetails));
  assert.equal(session.auto.attempt, 2); assert.equal(runner.reviewCalls, 2); assert.equal(runner.evidenceCalls, 0);
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(autoAuthorView(session).developerDetails));
  const plans = requirements(session.scenarioPackage);
  assert.equal(plans.length, 6);
  const set = session.evidenceImportResult.evidenceSet;
  const artifacts = set.evidenceArtifacts.filter(item => item.type !== 'TESTIMONY');
  const evidenceKeys = artifacts.flatMap(item => item.sourceRefs.filter(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT').map(key));
  assert.equal(evidenceKeys.length, new Set(evidenceKeys).size, '取得元を重複させた別IDの資料を作らない');
  const discoveryIds = session.runtime.gameCase.detective.evidenceDiscoveryRules.map(item => item.evidenceId);
  assert.equal(discoveryIds.length, new Set(discoveryIds).size, '同一資料を複数の調査先へ複製しない');
  for (const [index, plan] of plans.entries()) {
    const question = session.runtime.gameCase.progression.courtIssues[index].question;
    const ownNode = plan.grounds[0].attackNodeId;
    const statement = set.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')
      .flatMap(item => item.testimony.statements).find(item => item.statementId === question.statementId);
    const expectedFacts = [
      ...session.scenarioPackage.groundTruth.technicalFacts.filter(fact => fact.sourceType === 'ATTACK_NODE'
        && fact.attackNodeId === ownNode).map(fact => fact.factId),
    ];
    assert.deepEqual(statement.groundTruthRefs, expectedFacts);
    for (const quote of question.supportingQuotes) {
      const artifact = artifacts.find(item => item.evidenceId === quote.evidenceId);
      assert.ok(artifact.sourceRefs.every(ref => ref.attackNodeId === ownNode));
    }
    assert.ok(artifacts.every(item => !Object.hasOwn(item, 'caseSupport')
      && item.sourceRefs.every(ref => ref.sourceType !== 'CASE_FACT')));
  }
  const game = createGeneratedGame(session.runtime);
  actGenerated(game, session.runtime, { action: 'begin' }); actGenerated(game, session.runtime, { action: 'continue' });
  for (let round = 1; round <= session.runtime.gameCase.progression.courtRoundCount; round++) {
    collectCurrentTarget(game, session.runtime); enterCurrentCourt(game, session.runtime);
    actGenerated(game, session.runtime, { action: 'objection', ...currentCorrectPair(session.runtime, round) });
  }
  assert.equal(game.currentState, 'ACQUITTED');
});

for (const repair of [true, false]) test(`証言本文・技術資料・調査手順の不備を同時に返し、${repair ? '2稿目で修正できる' : '未修正なら上限で停止する'}`, async () => {
  const expectedCodes = ['TESTIMONY_CONTENT_MISMATCH', 'EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE',
    'EVIDENCE_REQUIREMENT_NOT_COVERED', 'INVALID_MATERIAL_PROCEDURES'];
  class EvidenceRepairRunner extends MockCodexRunner {
    async runJson(args) {
      const draft = await super.runJson(args);
      if (args.phase !== 'GENERATING_EVIDENCE') return draft;
      if (this.evidenceCalls === 2) {
        assert.deepEqual(args.data.evidenceRepairBase, this.firstDraft);
        for (const code of expectedCodes)
          assert.ok(args.feedback.errors.some(item => item.code === code), JSON.stringify(args.feedback.errors));
        assert.ok(args.feedback.errors.some(item => item.code === 'EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE'
          && /stored_content_record/.test(item.reason)));
      }
      if (this.evidenceCalls === 1 || !repair) {
        const testimony = draft.evidenceArtifacts.find(item => item.type === 'TESTIMONY');
        testimony.testimony.statements[0].spokenContent += '本文にはまだ転記されていない発言です。';
        const savedPost = draft.evidenceArtifacts.find(item => item.sourceRefs.some(ref => ref.sourceId === 'stored_content_record'));
        savedPost.publicContent = '{"event":"saved-content-summary-only"}';
        const sessionRecord = draft.evidenceArtifacts.find(item => item.sourceRefs.some(ref =>
          ref.sourceId === 'application_session_record'));
        draft.evidenceArtifacts = draft.evidenceArtifacts.filter(item => item !== sessionRecord);
        const plan = draft.materialInvestigations.find(item => item.evidenceId === savedPost.evidenceId);
        plan.steps[0].choices[0].operation.lastLine = 2;
      }
      if (this.evidenceCalls === 1) this.firstDraft = structuredClone(draft);
      return draft;
    }
  }
  const runner = new EvidenceRepairRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['phishing', 'unauthorized_login', 'stored_xss'], settingId: 'company' });
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(autoAuthorView(session).developerDetails));
  manager.approve(session); await manager.waitForIdle();
  assert.equal(runner.evidenceCalls, 2, JSON.stringify(autoAuthorView(session).developerDetails));
  assert.equal(session.auto.state, repair ? 'READY' : 'FAILED', JSON.stringify(autoAuthorView(session).developerDetails));
  assert.equal(runner.evidenceReviewCalls, repair ? 1 : 0);
  if (!repair) assert.equal(session.runtime, null);
  for (const code of expectedCodes)
    assert.ok(session.auto.details.some(item => item.attempt === 1 && item.code === code));
});
