import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { createManualAttackPreset, validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildScenarioTemplate, validateScenarioEvidenceCoverage } from '../server/generation/scenario-template.js';
import { buildInvestigationStages } from '../server/generation/investigation-registry.js';
import { applyScenarioRevision, buildScenarioRevisionInput } from '../server/generation/scenario-revision.js';
import { importScenarioPackage } from '../server/generation/scenario-interface.js';
import { stageEvidenceProblems } from '../server/generation/scenario-stage-plan.js';
import { AutoGenerationManager, createAutoAuthorSession, autoAuthorView } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { CodexTimeoutError } from '../server/codex/codex-errors.js';

const catalog = await loadCatalog();
function fixture() {
  const configuration = createManualAttackPreset(['phishing', 'stored_xss', 'unauthorized_login'], catalog);
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const scenarioPackage = buildScenarioTemplate({ configuration, generationInput });
  return { configuration, generationInput, scenarioPackage };
}
const stageRequirements = value => value.evidenceRequirements.requirements.filter(item => item.investigationStage);
const groundKey = ground => `${ground.attackNodeId}/${ground.sourceId}`;
function revisionFor(requirement, values) {
  return { schemaVersion: '1.0', requirementUpdates: [{ requirementId: requirement.requirementId,
    description: null, grounds: null, stageText: null, ...values }] };
}

test('3攻撃5調査先の争点と資料を具体化し、送受信・実行・認証は取得後にだけ扱う', () => {
  const value = fixture();
  const { scenarioPackage, configuration, generationInput } = value;
  const originalInput = structuredClone(generationInput);
  const requirements = stageRequirements(scenarioPackage);
  assert.equal(requirements.length, 5);
  const stages = buildInvestigationStages(configuration, generationInput);
  assert.deepEqual(requirements.map(item => item.investigationStage.sourceNodeId), stages.map(item => item.sourceNodeId));
  for (const [index, requirement] of requirements.entries()) {
    const available = stages.slice(0, index + 1).flatMap(stage => stage.routes.map(route => groundKey(route.ground)));
    assert.ok(requirement.grounds.every(ground => available.includes(groundKey(ground))));
    for (const field of ['claim', 'questionFocus', 'expectedInference', 'limitedRefutation']) {
      assert.ok(requirement.investigationStage[field].length > 10, field);
    }
    assert.equal(requirement.investigationStage.subjectCharacterId, 'character_defendant');
  }
  assert.deepEqual(requirements[0].grounds.map(item => item.sourceId), ['email_record']);
  assert.match(requirements[0].investigationStage.questionFocus, /保存メールの誘導内容・リンク.*実際のアクセス/);
  assert.match(requirements[0].investigationStage.limitedRefutation, /URLの不一致を必要条件にしない/);
  assert.ok(requirements[1].grounds.some(item => item.sourceId === 'credential_submission_record'));
  assert.match(requirements[1].investigationStage.expectedInference, /送信・受信/);
  assert.deepEqual(requirements[2].grounds.map(item => item.sourceId), ['authentication_record']);
  assert.match(requirements[2].investigationStage.expectedInference, /投稿完了までは示さない/);
  assert.ok(requirements[3].grounds.some(item => item.sourceId === 'application_session_record'));
  assert.ok(requirements[3].grounds.every(item => item.sourceId !== 'browser_execution_record'));
  assert.match(requirements[3].investigationStage.claim, /アカウントとWeb側のセッション.*どんな操作/);
  assert.match(requirements[3].investigationStage.expectedInference, /資格情報の受理、セッション利用、投稿完了/);
  assert.ok(requirements[4].grounds.some(item => item.sourceId === 'browser_execution_record'));
  assert.match(requirements[4].investigationStage.expectedInference, /保存・閲覧要求だけでは実行成功は分からない/);
  assert.match(requirements[4].investigationStage.limitedRefutation, /別の法廷を追加しない/);
  assert.deepEqual(validateScenarioEvidenceCoverage(value), []);
  assert.equal(importScenarioPackage({ generationInput, scenarioPackage }).status, 'VALID');
  assert.deepEqual(generationInput, originalInput);
  for (const attack of configuration.attacks) {
    const goal = attack.attackId === 'credential_phishing'
      ? '保存メールの誘導リンクとWeb要求、偽フォームへの送信記録' : attack.evidenceAnswer;
    assert.ok(scenarioPackage.evidenceRequirements.requirements.some(item => item.description.includes(goal)));
  }
  for (const observation of scenarioPackage.evidenceRequirements.requirements.filter(item => item.requirementId.startsWith('requirement_observation_'))) {
    assert.ok(configuration.attacks.every(attack => !observation.description.includes(attack.evidenceAnswer)));
  }
});

test('後続資料の先取り・段階欠落・重複・順序変更・人物参照の変更をReview前に検出する', () => {
  for (const mutate of [
    requirements => requirements[0].grounds.push(requirements[1].grounds[0]),
    requirements => { requirements[0].investigationStage = null; },
    requirements => { requirements[0].investigationStage.targetId = requirements[1].investigationStage.targetId; },
    requirements => { requirements[0].investigationStage.order = 2; },
    requirements => { requirements[0].investigationStage.subjectCharacterId = 'character_attacker'; },
  ]) {
    const value = fixture(); mutate(stageRequirements(value.scenarioPackage));
    assert.ok(validateScenarioEvidenceCoverage(value).some(item => item.code === 'INVESTIGATION_STAGE_PLAN_INVALID'));
  }
});

test('Revisionは変更要件だけを適用し、技術入力・Ground Truth・時系列・取得元・IDを維持する', () => {
  const value = fixture(); const original = structuredClone(value);
  const requirement = stageRequirements(value.scenarioPackage)[0];
  const { claim, questionFocus, expectedInference, limitedRefutation } = requirement.investigationStage;
  const revision = revisionFor(requirement, { description: '保存メールだけを用いる段階別調査。',
    stageText: { claim, questionFocus, expectedInference, limitedRefutation: limitedRefutation + '後続資料は不要。' } });
  const revised = applyScenarioRevision({ ...value, revision });
  assert.equal(stageRequirements(revised)[0].description, revision.requirementUpdates[0].description);
  assert.deepEqual(value, original);
  for (const name of ['groundTruth', 'timeline', 'characters', 'scenarioDraft', 'generationInputRef', 'learningObjectives']) {
    assert.deepEqual(revised[name], original.scenarioPackage[name]);
  }
  assert.deepEqual(revised.evidenceRequirements.requirements.map(item => item.requirementId),
    original.scenarioPackage.evidenceRequirements.requirements.map(item => item.requirementId));
  assert.equal(importScenarioPackage({ generationInput: value.generationInput, scenarioPackage: revised }).status, 'VALID');
  assert.ok(Buffer.byteLength(JSON.stringify(revision)) < Buffer.byteLength(JSON.stringify(value.scenarioPackage)) / 5);
});

test('Revisionの全文返却・不明ID・重複・取得元改変・後続依存は拒否し、元データを破壊しない', () => {
  const value = fixture(); const original = structuredClone(value);
  const requirements = stageRequirements(value.scenarioPackage);
  for (const revision of [
    value.scenarioPackage,
    revisionFor({ requirementId: 'unknown' }, { description: '変更' }),
    { schemaVersion: '1.0', requirementUpdates: [revisionFor(requirements[0], {}).requirementUpdates[0], revisionFor(requirements[0], {}).requirementUpdates[0]] },
    revisionFor(requirements[0], { stageText: { ...requirements[0].investigationStage, sourceNodeId: 'changed' } }),
    revisionFor(requirements[0], { grounds: requirements[1].grounds }),
  ]) assert.throws(() => applyScenarioRevision({ ...value, revision }));
  assert.deepEqual(value, original);
});

test('Revision入力は外部生成用Schemaと未選択定義・重複Networkを省き、必要な技術情報を保持する', () => {
  const value = fixture(); const input = buildScenarioRevisionInput(value);
  const oldInput = { scenarioGenerationInput: value.generationInput,
    scenarioConfiguration: value.configuration, scenarioTemplate: value.scenarioPackage };
  assert.equal(input.contextFormat, 'SCENARIO_REQUIREMENT_REVISION_V1');
  assert.ok(!JSON.stringify(input).includes('artifactSchemas'));
  assert.deepEqual(input.technicalInput.attackGraph, value.generationInput.technicalInput.attackGraph);
  assert.deepEqual(input.technicalInput.network, value.generationInput.technicalInput.network);
  assert.deepEqual(input.technicalInput.scenarioContext, value.generationInput.technicalInput.scenarioContext);
  assert.deepEqual(input.authorIntent.attacks, value.configuration.attacks);
  assert.deepEqual(input.technicalInput.attackDefinitions.map(item => item.id).sort(), [...value.generationInput.selectedAttackIds].sort());
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < Buffer.byteLength(JSON.stringify(oldInput)) * 0.9);
});

test('実際の差分を適用して独立Reviewを再実行し、形式修正時にも元のレビュー指摘を維持する', async () => {
  class RevisionRunner extends MockCodexRunner {
    async runJson(options) {
      const output = await super.runJson(options);
// 2026-09-24 修正前: 統合前の契約。
//       if (options.phase === 'REVISING_SCENARIO') return revisionFor(stageRequirements(options.data.scenarioTemplate)[0],
//         { description: '独立レビューを受けて、保存メールで確認する範囲を明確化した調査。' });
// 2026-09-24 修正後: main制作画面・初回設計とkawata-workのゲーム生成を統合。
      if (options.phase === 'REVISING_SCENARIO') {
        if (!this.badRevisionSent) { this.badRevisionSent = true; return { schemaVersion: '1.0' }; }
        return revisionFor(stageRequirements(options.data.scenarioTemplate)[0],
          { description: '独立レビューを受けて、保存メールで確認する範囲を明確化した調査。' });
      }
      return output;
    }
  }
// 2026-09-24 修正前: 統合前の契約。
//   const runner = new RevisionRunner({ reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'], malformedScenarioOutput: 1 });
// 2026-09-24 修正後: main制作画面・初回設計とkawata-workのゲーム生成を統合。
  const runner = new RevisionRunner({ reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'] });
  const manager = new AutoGenerationManager({ jsonRunner: runner }); const session = createAutoAuthorSession();
  manager.submitManual(session, fixture().configuration); await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(autoAuthorView(session).developerDetails));
  const revisions = runner.calls.filter(item => item.phase === 'REVISING_SCENARIO');
  assert.equal(revisions.length, 2);
  assert.deepEqual(revisions[1].feedback.revisionTargets, revisions[0].feedback.revisionTargets);
  assert.match(stageRequirements(session.scenarioPackage)[0].description, /独立レビューを受けて/);
  assert.equal(runner.reviewCalls, 2);
  const lastReview = runner.calls.filter(item => item.phase === 'REVIEWING_SCENARIO').at(-1);
  assert.deepEqual(lastReview.data.scenarioPackage, session.scenarioPackage);
});

test('Revision timeoutは再試行せず停止し、未検証のScenarioやゲームを採用しない', async () => {
  class TimeoutRunner extends MockCodexRunner {
    async runJson(options) {
      if (options.phase === 'REVISING_SCENARIO') { this.timeouts = (this.timeouts ?? 0) + 1; throw new CodexTimeoutError(options.phase); }
      return super.runJson(options);
    }
  }
  const runner = new TimeoutRunner({ reviewOutcomes: ['NEEDS_REVISION'] });
  const manager = new AutoGenerationManager({ jsonRunner: runner }); const session = createAutoAuthorSession();
  manager.submitManual(session, fixture().configuration); await manager.waitForIdle();
  assert.equal(session.auto.state, 'FAILED'); assert.equal(session.auto.failure.code, 'CODEX_TIMEOUT');
  assert.equal(runner.timeouts, 1); assert.equal(runner.evidenceCalls, 0); assert.equal(session.runtime, null);
});

test('5調査先のEvidenceも段階別の必要資料を満たし、抜けた資料を検出する', async () => {
  const runner = new MockCodexRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession(); manager.submitManual(session, fixture().configuration);
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(autoAuthorView(session).developerDetails));
  const set = structuredClone(session.evidenceImportResult.evidenceSet);
  assert.deepEqual(stageEvidenceProblems(set, session.scenarioPackage), []);
  set.contradictions.forEach(item => { item.conflictingEvidenceIds = []; });
  assert.equal(stageEvidenceProblems(set, session.scenarioPackage).filter(item => item.code === 'INVESTIGATION_STAGE_EVIDENCE_MISSING').length, 5);
});
