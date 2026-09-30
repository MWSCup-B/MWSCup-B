import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { createSelectionConfiguration } from '../server/generation/scenario-selection.js';
import { validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildScenarioTemplate, validateScenarioEvidenceCoverage } from '../server/generation/scenario-template.js';
import { applyScenarioRevision } from '../server/generation/scenario-revision.js';
import { importScenarioPackage } from '../server/generation/scenario-interface.js';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { buildIncidentConclusion } from '../server/generation/incident-conclusion.js';
import { displayIncidentNarratives, groundIncidentQuestionExplanations } from '../server/generation/incident-design.js';

const catalog = await loadCatalog();
const selection = { schemaVersion: '1.0', attackIds: ['phishing', 'unauthorized_login', 'stored_xss'], settingId: 'company' };
function fixture() {
  const configuration = createSelectionConfiguration(selection, catalog);
  const { technical, errors } = validateScenarioConfiguration(configuration, catalog);
  assert.deepEqual(errors, []);
  const generationInput = technical.generationInput;
  return { configuration, generationInput, scenarioPackage: buildScenarioTemplate({ configuration, generationInput }) };
}
const narrativeUpdate = (narrative, changes = {}) => ({ attackNodeId: narrative.attackNodeId,
  allegation: null, prosecutionKnowledge: null, causalRefutation: null, verdictBasis: null, ...changes });
function narrativeFor(scenarioPackage, generationInput, attackId) {
  const node = generationInput.technicalInput.attackGraph.nodes.find(item => item.attackDefinitionId === attackId);
  return scenarioPackage.groundTruth.incidentNarratives.find(item => item.attackNodeId === node.nodeId);
}

test('終了後の解説は明示された人物IDだけを役名で表示し、検証済みNarrativeは変更しない', () => {
  const { configuration, generationInput, scenarioPackage } = fixture();
  const narratives = scenarioPackage.groundTruth.incidentNarratives;
  narratives[0].verdictBasis = 'user-aとcharacter_defendantの対応は教材内設定である。character_attackerの操作をログだけで同定しない。';
  const original = structuredClone(narratives);
  const expected = 'user-aと被告人の対応は教材内設定である。別の攻撃者の操作をログだけで同定しない。';
  assert.ok(buildIncidentConclusion(configuration, generationInput, narratives).includes(expected));
  const questions = [{ statementId: 'statement_1', explanation: 'model prose', supportingQuotes: [] }];
  const grounded = groundIncidentQuestionExplanations(questions, narratives);
  assert.ok(grounded[0].explanation.includes(expected));
  assert.doesNotMatch(grounded[0].explanation, /character_defendant|character_attacker/);
  assert.deepEqual(questions, [{ statementId: 'statement_1', explanation: 'model prose', supportingQuotes: [] }]);
  assert.deepEqual(narratives, original);
  const other = { ...narratives[0], verdictBasis: 'fact_private / requirement_private / character_defendant_extra' };
  assert.equal(displayIncidentNarratives([other])[0].verdictBasis, other.verdictBasis);
});

test('選択した3攻撃の反駁は取得定義に一致し、ログイン操作者の排除を要件にしない', () => {
  const value = fixture();
  const phishing = narrativeFor(value.scenarioPackage, value.generationInput, 'credential_phishing');
  const login = narrativeFor(value.scenarioPackage, value.generationInput, 'unauthorized_login');
  const stages = value.scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage);
  assert.match(phishing.allegation, /送信先・時刻・非秘密の合成相関ID/);
  assert.match(phishing.causalRefutation, /ブラウザ識別子、秘密値は要求しない/);
  assert.match(stages[1].investigationStage.claim, /送信は記録されています.*意図的に.*持ち出し/);
  assert.match(stages[1].investigationStage.expectedInference, /メール.*案内.*送受信/);
  assert.match(login.causalRefutation, /試行IDと認証連携IDの対応を要求せず/);
  assert.match(login.causalRefutation, /被告人の直接ログインを排除したりしない/);
  assert.match(login.verdictBasis, /本人操作が証明されないことと、本人操作を積極的に排除できたことは区別/);
  assert.match(stages[3].investigationStage.expectedInference, /教材内設定/);
  assert.match(stages[4].investigationStage.claim, /被告人が手動で投稿/);
  for (const id of ['stored_content_record', 'browser_execution_record', 'browser_request_initiator_record', 'announcement_audit_record'])
    assert.ok(stages[4].grounds.some(ref => ref.sourceId === id));
  assert.deepEqual(validateScenarioEvidenceCoverage(value), []);
});

test('Narrativeの差分は真相・被害・技術参照を固定し、要件差分と一緒に適用できる', () => {
  const value = fixture();
  const original = structuredClone(value);
  const narrative = narrativeFor(value.scenarioPackage, value.generationInput, 'unauthorized_login');
  const requirement = value.scenarioPackage.evidenceRequirements.requirements.find(item => item.requirementId === 'requirement_goal_2');
  const text = '認証結果とセッション確立を記録の範囲で比較する。人物の排除や資格情報取得経路の証明は行わない。';
  const revision = { schemaVersion: '1.0', incidentNarrativeUpdates: [narrativeUpdate(narrative, { causalRefutation: text })],
    requirementUpdates: [{ requirementId: requirement.requirementId, description: text, grounds: null, stageText: null }] };
  const revised = applyScenarioRevision({ ...value, revision });
  const expected = structuredClone(value.scenarioPackage);
  narrativeFor(expected, value.generationInput, 'unauthorized_login').causalRefutation = text;
  expected.evidenceRequirements.requirements.find(item => item.requirementId === requirement.requirementId).description = text;
  assert.deepEqual(revised, expected);
  assert.deepEqual(value, original);
  assert.equal(importScenarioPackage({ generationInput: value.generationInput, scenarioPackage: revised }).status, 'VALID');
  for (const incidentNarrativeUpdates of [undefined, null, []]) {
    const legacy = { schemaVersion: '1.0', requirementUpdates: [] };
    if (incidentNarrativeUpdates !== undefined) legacy.incidentNarrativeUpdates = incidentNarrativeUpdates;
    assert.deepEqual(applyScenarioRevision({ ...value, revision: legacy }), value.scenarioPackage);
  }
});

test('不明・重複Narrativeと真相・人物・effect・資料・技術入力の変更を拒否する', () => {
  const value = fixture(); const original = structuredClone(value);
  const narrative = narrativeFor(value.scenarioPackage, value.generationInput, 'unauthorized_login');
  const invalid = [
    [narrativeUpdate({ attackNodeId: 'unknown' })],
    [narrativeUpdate(narrative), narrativeUpdate(narrative)],
    ...['attackerAction', 'impact', 'impactEffectId', 'attackerCharacterId', 'defendantCharacterId', 'requiredArtifactIds', 'technicalFacts']
      .map(field => [narrativeUpdate(narrative, { [field]: narrative[field] ?? [] })]),
  ];
  for (const incidentNarrativeUpdates of invalid) assert.throws(() => applyScenarioRevision({ ...value,
    revision: { schemaVersion: '1.0', requirementUpdates: [], incidentNarrativeUpdates } }));
  assert.deepEqual(value, original);
  for (const field of ['attackerAction', 'impact', 'impactEffectId', 'attackerCharacterId', 'defendantCharacterId', 'requiredArtifactIds']) {
    const proposed = structuredClone(value.scenarioPackage);
    const item = narrativeFor(proposed, value.generationInput, 'unauthorized_login');
    item[field] = field === 'requiredArtifactIds' ? ['email_record', 'web_access_record'] : 'changed';
    const imported = importScenarioPackage({ generationInput: value.generationInput, scenarioPackage: proposed });
    assert.equal(imported.status, 'INVALID', field);
    assert.ok(imported.errors.some(error => error.code === 'INCIDENT_NARRATIVE_UNGROUNDED'), field);
  }
  const legacy = fixture(); delete legacy.scenarioPackage.groundTruth.incidentNarratives;
  assert.throws(() => applyScenarioRevision({ ...legacy,
    revision: { schemaVersion: '1.0', requirementUpdates: [], incidentNarrativeUpdates: [narrativeUpdate(narrative)] } }),
  { code: 'SCENARIO_REVISION_TARGET_INVALID' });
});

test('Narrativeへの指摘が未修正なら再審査で止め、Evidence・ゲームへ進めない', async () => {
  class UnresolvedReviewer extends MockCodexRunner {
    async runJson(args) {
      const output = await super.runJson(args);
      if (args.phase === 'REVIEWING_SCENARIO') {
        const check = output.checks.find(item => item.category === 'IDENTITY_ATTRIBUTION');
        Object.assign(check, { outcome: 'FAIL', field: 'scenarioPackage.groundTruth.incidentNarratives',
          reason: '公開資料が支えない人物帰属が残っている。',
          correctionHint: '人物設定と公開資料による結論を分ける。' });
      }
      return output;
    }
  }
  const runner = new UnresolvedReviewer();
  const manager = new AutoGenerationManager({ jsonRunner: runner }); const session = createAutoAuthorSession();
  manager.submitSelection(session, selection); await manager.waitForIdle();
  assert.equal(session.auto.state, 'FAILED');
  assert.equal(session.auto.failure.code, 'MAX_REVISION_EXCEEDED');
  assert.equal(runner.reviewCalls, 3);
  assert.equal(runner.evidenceCalls, 0);
  assert.equal(session.runtime, null);
});

test('Narrativeへの審査指摘を差分で修正し、再Reviewした文面を判決解説まで維持する', async () => {
  const clarification = 'この二資料から資格情報の取得経路を復元しない。';
  class NarrativeReviewer extends MockCodexRunner {
    async runJson(args) {
      const output = await super.runJson(args);
      if (args.phase === 'REVISING_SCENARIO') {
        const narrative = narrativeFor(args.data.scenarioTemplate, { technicalInput: args.data.technicalInput }, 'unauthorized_login');
        return { schemaVersion: '1.0', requirementUpdates: [], incidentNarrativeUpdates: [
          narrativeUpdate(narrative, { causalRefutation: narrative.causalRefutation + clarification })] };
      }
      if (args.phase === 'REVIEWING_SCENARIO') {
        const narrative = narrativeFor(args.data.scenarioPackage, args.data.generationInput, 'unauthorized_login');
        if (!narrative.causalRefutation.endsWith(clarification)) {
          const check = output.checks.find(item => item.category === 'FACT_NARRATIVE_SEPARATION');
          Object.assign(check, { outcome: 'FAIL', field: 'scenarioPackage.groundTruth.incidentNarratives',
            reason: '認証資料による資格情報取得経路の証明範囲を明確にする必要がある。',
            correctionHint: 'incidentNarrativeのcausalRefutationに、二資料から取得経路を復元しないことを明記する。' });
        }
      }
      return output;
    }
  }
  const runner = new NarrativeReviewer();
  const manager = new AutoGenerationManager({ jsonRunner: runner }); const session = createAutoAuthorSession();
  manager.submitSelection(session, selection); await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(session.auto.details));
  assert.equal(runner.reviewCalls, 2);
  assert.equal(runner.evidenceCalls, 0);
  const reviews = runner.calls.filter(item => item.phase === 'REVIEWING_SCENARIO');
  assert.deepEqual(reviews[0].data.generationInput, reviews[1].data.generationInput);
  const updated = narrativeFor(session.scenarioPackage, session.generationInput, 'unauthorized_login');
  assert.ok(updated.causalRefutation.endsWith(clarification));
  assert.deepEqual(reviews[1].data.scenarioPackage, session.scenarioPackage);
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
  assert.ok(session.runtime.gameCase.progression.outcomes.acquitted.publicExplanation.includes(updated.causalRefutation));
});
