import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { buildAttackSelectionPaths, createSelectionConfiguration } from '../server/generation/scenario-selection.js';
import { SCENARIO_SETTINGS } from '../server/generation/author-options.js';
import { validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildScenarioTemplate } from '../server/generation/scenario-template.js';
import { importScenarioPackage } from '../server/generation/scenario-interface.js';
import { buildInvestigationStages } from '../server/generation/investigation-registry.js';
import { buildQuestionBackground } from '../server/generation/investigation-lessons.js';
import { observationAnchors } from '../server/generation/court-questions.js';
import { AutoGenerationManager, autoAuthorView, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

const catalog = await loadCatalog();
test('all 17 supported attack paths in all five settings keep complete teaching text within the scenario contract', () => {
  const paths = buildAttackSelectionPaths(catalog);
  assert.equal(paths.length, 17);
  for (const attackIds of paths) for (const setting of SCENARIO_SETTINGS) {
    const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds, settingId: setting.id }, catalog);
    const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
    const scenarioPackage = buildScenarioTemplate({ configuration, generationInput });
    const imported = importScenarioPackage({ generationInput, scenarioPackage });
    assert.equal(imported.status, 'VALID', `${setting.id}: ${attackIds}: ${JSON.stringify(imported.errors)}`);
    const last = scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage).at(-1);
    assert.match(last.investigationStage.claim, /被告人/);
    assert.match(last.investigationStage.limitedRefutation, /既存の最終法廷内/);
  }
});

test('ClickFix has distinct observation and comparison disputes, with the full process lesson visible to review', () => {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds: ['clickfix'], settingId: 'company' }, catalog);
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const requirements = buildScenarioTemplate({ configuration, generationInput }).evidenceRequirements.requirements
    .filter(requirement => requirement.investigationStage);
  assert.equal(requirements.length, 2);
  assert.deepEqual(requirements[0].grounds.map(item => item.sourceId), ['clickfix_page_record']);
  assert.match(requirements[0].investigationStage.claim, /修復案内.*表示/);
  assert.match(requirements[0].investigationStage.claim, /案内どおりの処理.*実行.*みるべき/);
  const final = requirements[1];
  assert.deepEqual(new Set(final.grounds.map(item => item.sourceId)), new Set(['clickfix_page_record', 'process_execution_record']));
  assert.match(final.investigationStage.claim, /要求IDと端末のプロセス相関ID/);
  assert.match(final.investigationStage.claim, /被告人/);
  for (const meaning of [/プロセスは動いているプログラム/, /親子関係とは/, /実行アカウント/, /起動結果/, /アカウントは実際の人物とは限りません/]) {
    assert.match(final.description, meaning);
  }
  assert.match(final.investigationStage.expectedInference, /対応・因果が資料で確認できなければ未確認/);
  assert.match(final.investigationStage.limitedRefutation, /時刻の一致、因果を新設しない/);
});

test('question specificity reads real values in nested JSON and arrays without accepting column names', () => {
  const observation = [{ timestamp: '2026-09-18T09:10:00+09:00', request_id: 'request-17',
    process: { device_id: 'PC1', process_ref: 'process-23', result: 'started' } }];
  for (const content of [JSON.stringify(observation), JSON.stringify(observation, null, 2),
    observation.map(row => JSON.stringify(row)).join('\n')]) {
    assert.deepEqual(observationAnchors(content), ['request-17', 'PC1', 'process-23']);
  }
  assert.deepEqual(observationAnchors('request_id: request-17\nparent_ref: parent-22'), ['request-17', 'parent-22']);
});

test('the first authentication question background excludes future session evidence', () => {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds: ['unauthorized_login'], settingId: 'company' }, catalog);
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const stages = buildInvestigationStages(configuration, generationInput);
  const first = buildQuestionBackground(stages, 0, generationInput);
  const second = buildQuestionBackground(stages, 1, generationInput);
  assert.doesNotMatch(first, /これまでに取得した.*認証監査/);
  assert.doesNotMatch(first, /取得済みの.*セッション資料/);
  assert.match(second, /これまでに取得した同じ攻撃の資料：認証監査/);
});

test('a process observation never supplies an unrecorded privilege level', () => {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds: ['ransomware'], settingId: 'company' }, catalog);
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const first = buildScenarioTemplate({ configuration, generationInput }).evidenceRequirements.requirements
    .find(requirement => requirement.investigationStage);
  assert.deepEqual(first.grounds.map(item => item.sourceId), ['file_operation_record', 'process_execution_record']);
  assert.doesNotMatch(first.investigationStage.expectedInference, /記録された権限/);
  assert.match(first.investigationStage.expectedInference, /実行ユーザー識別子は権限や実際の操作者を示すものではなく/);
});

test('one repair receives both the missing testimony provenance and the invalid question quote', async () => {
  class ReportedFailureRunner extends MockCodexRunner {
    async runJson(args) {
      const draft = await super.runJson(args);
      if (args.phase !== 'GENERATING_EVIDENCE') return draft;
      if (this.evidenceCalls === 1) {
        const testimony = draft.evidenceArtifacts.find(item => item.type === 'TESTIMONY');
        const requirements = args.data.evidenceDraftInput.evidenceAgentInput.scenarioVerificationInput
          .scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage);
        testimony.requirementIds = requirements.map(item => item.requirementId);
        testimony.purpose = ['CONTRADICTION_PROOF'];
        testimony.sourceRefs = [{ sourceType: 'CHARACTER', sourceId: 'character_witness', attackNodeId: null }];
        draft.courtQuestions[0].supportingQuotes[0].quote = '公開原文に存在しない引用です。';
      } else {
        this.feedback = structuredClone(args.feedback);
        // Return the valid fixture only after the repair contains both diagnoses.
        assert.ok(this.feedback.errors.some(item => item.code === 'EVIDENCE_GROUND_MISMATCH'
          && item.requirementId === 'requirement_stage_1' && item.evidenceId));
        assert.ok(this.feedback.errors.some(item => item.code === 'EVIDENCE_QUESTION_QUOTE_MISMATCH'));
      }
      return draft;
    }
  }
  const runner = new ReportedFailureRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['clickfix'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
  assert.equal(runner.evidenceCalls, 2);
  assert.match(runner.feedback.errors.find(item => item.code === 'EVIDENCE_GROUND_MISMATCH').correctionHint,
    /clickfix_page_record/);
});

test('an exhausted verification stays blocked and asks for the actual deficiency instead of a blind retry', async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner({ evidenceInvalid: true }) });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['clickfix'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  const view = autoAuthorView(session);
  assert.equal(view.currentState, 'FAILED');
  assert.equal(session.runtime, null);
  const final = view.developerDetails.find(issue => issue.code === 'EVIDENCE_GENERATION_FAILED');
  assert.match(final.correctionHint, /不足条件や参照先/);
  assert.match(final.correctionHint, /再生成だけでは解消できません/);
});
