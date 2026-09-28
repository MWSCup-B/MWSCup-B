import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { createSelectionConfiguration } from '../server/generation/scenario-selection.js';
import { validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildInvestigationStages } from '../server/generation/investigation-registry.js';
import { buildQuestionBackground } from '../server/generation/investigation-lessons.js';
import { buildIncidentConclusion } from '../server/generation/incident-conclusion.js';
import { generatedSceneDialogue } from '../server/generation/dialogue-template.js';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { actGenerated, createGeneratedGame, generatedPlayerView } from '../server/generated-game.js';
import { collectCurrentTarget, currentCorrectPair } from './helpers/court-issues.js';

const catalog = await loadCatalog();
function selected(attackIds) {
  const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds, settingId: 'company' }, catalog);
  const validation = validateScenarioConfiguration(configuration, catalog);
  assert.equal(validation.status, 'VALID');
  return { configuration, generationInput: validation.technical.generationInput };
}

test('ClickFix question background names the mechanism and available vocabulary without a player guide', () => {
  const { configuration, generationInput } = selected(['clickfix']);
  const original = structuredClone(generationInput);
  const stages = buildInvestigationStages(configuration, generationInput);
  const first = buildQuestionBackground(stages, 0, generationInput);
  const second = buildQuestionBackground(stages, 1, generationInput);
  assert.match(first, /ClickFixは.*利用者自身に端末で操作させる/);
  assert.match(first, /保存された案内は/);
  assert.doesNotMatch(first, /起動しました|暗号化|無罪|正答/);
  assert.match(second, /これまでに取得した同じ攻撃の資料：保存された案内/);
  assert.match(second, /プロセスは動いているプログラムの単位/);
  assert.doesNotMatch(second, /ましょう|確認してください/);
  assert.deepEqual(generationInput, original);
  const dialogue = generatedSceneDialogue({ currentState: 'INVESTIGATION',
    investigationTargets: [{ displayName: stages[0].displayName, description: first }] });
  assert.deepEqual(dialogue.filter(line => line.role === 'assistant'), []);
});

test('all selected attack question backgrounds and final explanations stay bounded and preserve the technical input', () => {
  for (const attackIds of [['phishing'], ['stored_xss'], ['unauthorized_login'], ['clickfix'], ['sql_injection'],
    ['password_spray'], ['ransomware'], ['unrestricted_file_upload'],
    ['phishing', 'clickfix', 'ransomware'], ['password_spray', 'unauthorized_login', 'stored_xss'],
    ['phishing', 'unauthorized_login', 'stored_xss']]) {
    const { configuration, generationInput } = selected(attackIds);
    const original = structuredClone({ configuration, generationInput });
    const stages = buildInvestigationStages(configuration, generationInput);
    for (let index = 0; index < stages.length; index += 1) {
      const background = buildQuestionBackground(stages, index, generationInput);
      assert.ok(background.length <= 1000, `${attackIds}: ${background.length}`);
      assert.doesNotMatch(background, /ましょう|確認してください/);
    }
    const conclusion = buildIncidentConclusion(configuration, generationInput);
    assert.ok(conclusion.length <= 2000, `${attackIds}: ${conclusion.length}`);
    assert.match(conclusion, /原因|要因|成功条件|環境|必要/);
    assert.match(conclusion, attackIds.some(id => ['stored_xss', 'sql_injection'].includes(id))
      ? /被害と発生原因[\s\S]*別の攻撃主体[\s\S]*無罪/ : /合理的な疑い/);
    assert.doesNotMatch(conclusion, /被告人は操作していない|真犯人|groundTruth|attack_node|fact_/);
    assert.deepEqual({ configuration, generationInput }, original);
  }
});

test('the final narrative uses confirmed graph causality and does not invent a preceding attack', () => {
  const { configuration, generationInput } = selected(['phishing', 'clickfix', 'ransomware']);
  const conclusion = buildIncidentConclusion(configuration, generationInput);
  assert.match(conclusion, /メールの誘導先が、この偽案内/);
  assert.match(conclusion, /暗号化の足がかりは、ClickFixによる端末実行/);
  assert.match(conclusion, /一般利用者の権限/);
  assert.match(conclusion, /書込み可能な対象ファイル/);
  generationInput.technicalInput.attackGraph.edges = [];
  assert.doesNotMatch(buildIncidentConclusion(configuration, generationInput), /誘導先が、この偽案内|足がかりは/);
  generationInput.technicalInput.attackGraph.nodes[0].state = 'BLOCKED';
  assert.throws(() => buildIncidentConclusion(configuration, generationInput), { code: 'INCIDENT_CONCLUSION_UNVERIFIED' });
  const standalone = selected(['ransomware']);
  assert.doesNotMatch(buildIncidentConclusion(standalone.configuration, standalone.generationInput), /ClickFix|メール|窃取|横展開/);
});

test('the investigation follows entry, instructions, execution and effects independently of graph storage order', () => {
  const { configuration, generationInput } = selected(['phishing', 'clickfix', 'ransomware']);
  const stages = buildInvestigationStages(configuration, generationInput);
  assert.deepEqual(stages.map(stage => [...new Set(stage.routes.map(route => route.ground.sourceId))]), [
    ['email_record'], ['web_access_record', 'clickfix_page_record'],
    ['process_execution_record'], ['file_encryption_record'],
  ]);
  const reordered = structuredClone(generationInput);
  reordered.technicalInput.attackGraph.nodes.reverse().forEach(node => node.artifactEvaluations.reverse());
  assert.deepEqual(buildInvestigationStages(configuration, reordered), stages);
});

test('generation gives question background only to the evidence writer and releases the conclusion after final success', async () => {
  class BackgroundRunner extends MockCodexRunner {
    async runJson(args) {
      if (args.phase === 'GENERATING_EVIDENCE') this.backgrounds = structuredClone(args.data.questionBackgrounds);
      return super.runJson(args);
    }
  }
  const runner = new BackgroundRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const author = createAutoAuthorSession();
  manager.submitSelection(author, { schemaVersion: '1.0', attackIds: ['clickfix'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(author); await manager.waitForIdle();
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  const runtime = author.runtime; const session = createGeneratedGame(runtime);
  const conclusion = runtime.gameCase.progression.outcomes.acquitted.publicExplanation;
  const assertPrivate = view => {
    assert.equal(view.acquittal, undefined);
    assert.equal(JSON.stringify(view).includes(conclusion), false);
  };
  assertPrivate(generatedPlayerView(session, runtime));
  actGenerated(session, runtime, { action: 'begin' });
  actGenerated(session, runtime, { action: 'continue' });
  for (let round = 0; round < runner.backgrounds.length; round += 1) {
    const view = generatedPlayerView(session, runtime);
    assertPrivate(view);
    assert.notEqual(view.investigationTargets[0].description, runner.backgrounds[round].description);
    assert.equal(JSON.stringify(view).includes(runner.backgrounds[round].description), false);
    const pair = currentCorrectPair(runtime, session.currentRound);
    collectCurrentTarget(session, runtime);
    actGenerated(session, runtime, { action: 'retrial', evidenceId: pair.evidenceId, interpretationChoiceId: pair.interpretationChoiceId });
    assertPrivate(generatedPlayerView(session, runtime));
    actGenerated(session, runtime, { action: 'objection', ...pair });
  }
  const final = generatedPlayerView(session, runtime);
  assert.equal(final.currentState, 'ACQUITTED');
  assert.equal(final.acquittal.publicExplanation, conclusion);
  assert.match(final.dialogue.find(line => line.role === 'prosecutor').text, /有罪の主張は維持できません。無罪との判断を受け入れます/);
  assert.equal(final.dialogue[0].text, final.result.publicExplanation);
});
