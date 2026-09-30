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
import { spokenProsecutionClaim } from '../server/generation/scenario-stage-plan.js';
import { evidencePublicContentAnnotationProblems } from '../server/generation/evidence-draft-validation.js';
import { AutoGenerationManager, autoAuthorView, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

const catalog = await loadCatalog();

test('ClickFix completes its own technical proof before a separate later harm stage', () => {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds: ['clickfix', 'ransomware'], settingId: 'company' }, catalog);
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const scenario = buildScenarioTemplate({ configuration, generationInput });
  const stages = scenario.evidenceRequirements.requirements.filter(item => item.investigationStage);
  const comparison = stages.slice(0, -1).find(item => ['clickfix_page_record', 'process_execution_record']
    .every(id => item.grounds.some(ground => ground.sourceId === id)));
  assert.ok(comparison);
  const clickfix = generationInput.technicalInput.attackGraph.nodes.find(node => node.attackDefinitionId === 'clickfix');
  assert.ok(comparison.grounds.every(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT'));
  assert.ok(comparison.grounds.every(ground => ground.attackNodeId === clickfix.nodeId));
  assert.match(comparison.investigationStage.claim, /被告人が攻撃用処理を作成し、攻撃目的でその処理を直接起動/);
  assert.match(comparison.description, /instruction_ref/);
  assert.match(comparison.investigationStage.expectedInference, /instruction_ref/);
  assert.doesNotMatch(comparison.investigationStage.expectedInference + comparison.investigationStage.limitedRefutation,
    /CASE_FACT|caseSupport|調査報告|直接観察/);
  assert.ok(stages.at(-1).grounds.every(ground => ground.attackNodeId !== clickfix.nodeId));
});

test('all registered attack allegations become direct courtroom claims without an attack-id text map', () => {
  assert.equal(catalog.length, 16);
  for (const attack of catalog) {
    const allegation = attack.incidentNarrative?.allegation;
    assert.ok(allegation, attack.id);
    const claim = spokenProsecutionClaim(allegation, '');
    assert.match(claim, /被告人/, attack.id);
    assert.match(claim, /ということです。$/, attack.id);
    assert.doesNotMatch(claim, /当該|判断できます/, attack.id);
    assert.doesNotMatch(claim, /検察側は|と主張している|それだけで/, attack.id);
  }
});

test('all 17 supported attack paths in all five settings keep complete teaching text within the scenario contract', () => {
  const paths = buildAttackSelectionPaths(catalog);
  assert.equal(paths.length, 17);
  for (const attackIds of paths) for (const setting of SCENARIO_SETTINGS) {
    const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds, settingId: setting.id }, catalog);
    const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
    const scenarioPackage = buildScenarioTemplate({ configuration, generationInput });
    const imported = importScenarioPackage({ generationInput, scenarioPackage });
    assert.equal(imported.status, 'VALID', `${setting.id}: ${attackIds}: ${JSON.stringify(imported.errors)}`);
    const stages = scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage);
    const last = stages.at(-1);
    assert.match(last.investigationStage.claim, /被告人/);
    assert.ok(last.grounds.every(ground => ground.sourceType === 'ATTACK_GRAPH_ARTIFACT'));
    assert.ok(scenarioPackage.evidenceRequirements.requirements.every(requirement => requirement.purpose !== 'IDENTITY_PROOF'
      && requirement.grounds.every(ground => ground.sourceType !== 'CASE_FACT')));
    assert.equal(scenarioPackage.groundTruth.caseFacts?.length ?? 0, 0);
    for (const node of generationInput.technicalInput.attackGraph.nodes) {
      const ownStages = stages.filter(stage => stage.grounds.some(ground => ground.attackNodeId === node.nodeId));
      assert.ok(ownStages.length, `attack has its own technical investigation: ${node.attackDefinitionId}`);
      assert.ok(ownStages.at(-1).grounds.every(ground => ground.attackNodeId === node.nodeId));
    }
    assert.doesNotMatch(last.investigationStage.expectedInference + last.investigationStage.limitedRefutation,
      /Ground Truth|incidentNarratives|CASE_FACT|caseSupport|調査報告|直接観察/);
    const defendant = scenarioPackage.characters.characters.find(item => item.characterId === 'character_defendant');
    for (const node of generationInput.technicalInput.attackGraph.nodes) {
      const binding = node.bindings.find(item => item.name === 'victim')
        ?? node.bindings.find(item => item.name === 'account');
      if (binding) assert.ok(defendant.bindingRefs.some(ref => ref.attackNodeId === node.nodeId
        && ref.bindingName === binding.name && ref.entityId === binding.entityId));
    }
  }
});

test('ClickFix separates page-content and process-record stages, with the full process lesson visible to review', () => {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds: ['clickfix'], settingId: 'company' }, catalog);
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const scenario = buildScenarioTemplate({ configuration, generationInput });
  const requirements = scenario.evidenceRequirements.requirements.filter(requirement => requirement.investigationStage);
  assert.equal(requirements.length, 2);
  assert.deepEqual(requirements[0].grounds.map(item => item.sourceId), ['clickfix_page_record']);
  assert.match(requirements[0].investigationStage.claim, /修復案内.*表示/);
  assert.match(requirements[0].investigationStage.claim, /案内どおりの処理.*端末で動いた/);
  const final = requirements[1];
  assert.deepEqual(new Set(final.grounds.map(item => item.sourceId)),
    new Set(['clickfix_page_record', 'process_execution_record']));
  assert.match(final.investigationStage.claim, /プロセス実行記録.*ユーザー識別子/);
  assert.match(final.investigationStage.claim, /攻撃用処理を作成し、攻撃目的でその処理を直接起動/);
  assert.match(final.investigationStage.claim, /被告人/);
  assert.match(final.description, /同じinstruction_ref/);
  assert.match(final.description, /要求IDとプロセス相関IDを同一の番号にはしない/);
  assert.doesNotMatch(final.investigationStage.expectedInference, /CASE_FACT|caseSupport|調査報告|直接観察/);
  assert.match(final.investigationStage.expectedInference, /同じinstruction_ref/);
  assert.match(final.investigationStage.expectedInference, /処理がその後に端末で起動/);
  assert.doesNotMatch(final.investigationStage.expectedInference, /確認できなければ|未確認|Ground Truth/);
  assert.match(final.investigationStage.limitedRefutation, /利用者.*操作/);
  assert.doesNotMatch(final.investigationStage.limitedRefutation, /Ground Truth/);
  assert.deepEqual(scenario.characters.characters.find(item => item.characterId === 'character_defendant').bindingRefs,
    [{ attackNodeId: final.grounds[0].attackNodeId, bindingName: 'victim', entityId: 'user-a' }]);
  for (const meaning of [/プロセスは動いているプログラム/, /親子関係とは/, /実行アカウント/, /起動結果/, /アカウントは実際の人物とは限りません/]) {
    assert.match(final.description, meaning);
  }
  assert.match(final.investigationStage.limitedRefutation, /保存案内と端末記録の同じinstruction_ref/);
  assert.match(final.investigationStage.limitedRefutation, /というclaimを反駁/);
  assert.match(final.investigationStage.limitedRefutation, /被告人の利用者としての端末操作/);
  assert.doesNotMatch(final.investigationStage.limitedRefutation, /人物不明を正答/);
  const timeline = scenario.evidenceRequirements.requirements.find(requirement => requirement.purpose === 'TIMELINE_PROOF');
  assert.match(timeline.description, /publicContentへ時刻注記の行を追加しない/);
  assert.doesNotMatch(timeline.description, /合成時刻は合成値と明記/);
});

test('evidence public content rejects production notes without rejecting recorded ClickFix times', () => {
  const artifacts = [
    { publicContent: 'request_id: training-page-01\nresponse_time: 2026-09-18T09:10:00+09:00\ninstruction_ref: training-operation-01' },
    { publicContent: 'timestamp: 2026-09-18T09:10:12+09:00\nparent_process: explorer.exe\nprocess: powershell.exe' },
  ];
  assert.deepEqual(evidencePublicContentAnnotationProblems(artifacts), []);

  artifacts[0].publicContent += '\n時刻注記: response_timeは教材用の合成値です。実測時刻や時計同期を保証するものではありません。';
  artifacts[1].publicContent += '\n時刻注記: timestampは教材用の合成値です。実測時刻や時計同期を保証するものではありません。';
  const problems = evidencePublicContentAnnotationProblems(artifacts);
  assert.equal(problems.length, 2);
  assert.ok(problems.every(problem => problem.code === 'EVIDENCE_PUBLIC_CONTENT_ANNOTATION'));
  assert.deepEqual(problems.map(problem => problem.field),
    ['evidenceArtifacts[0].publicContent', 'evidenceArtifacts[1].publicContent']);
  assert.ok(problems.every(problem => /時刻注記の行だけを削除/.test(problem.correctionHint)));
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
