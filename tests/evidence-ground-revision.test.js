import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoGenerationManager, autoAuthorBootstrap, autoAuthorView, createAutoAuthorSession }
  from '../server/auto-generation-service.js';
import { importEvidencePackage, materializeEvidenceGenerationDraft, EVIDENCE_PROMPT_TEMPLATE }
  from '../server/generation/evidence-interface.js';
import { actGenerated, createGeneratedGame } from '../server/generated-game.js';
import { currentCorrectPair, syncQuestionQuotes, collectCurrentTarget, enterCurrentCourt } from './helpers/court-issues.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { observationAnchors } from '../server/generation/court-questions.js';

// Keep a real three-attack graph with distinct authentication and execution facts.
// This is synthetic fixture corruption, not a reconstruction of the user's missing JSON.
function executionClaim(draft, input) {
  const graph = input.generationInput.technicalInput.attackGraph;
  const executionNode = graph.nodes.find(item => item.attackDefinitionId === 'stored_xss');
  const loginNode = graph.nodes.find(item => item.attackDefinitionId === 'unauthorized_login');
  const facts = input.scenarioPackage.groundTruth.technicalFacts;
  const executionFact = facts.find(item => item.sourceType === 'ATTACK_NODE' && item.attackNodeId === executionNode.nodeId);
  const loginFact = facts.find(item => item.sourceType === 'ATTACK_NODE' && item.attackNodeId === loginNode.nodeId);
  assert.ok(executionFact && loginFact && executionFact.factId !== loginFact.factId);
  const evidence = draft.evidenceArtifacts.find(item => item.type === 'DEVICE_INFORMATION'
    && item.sourceRefs.some(ref => ref.attackNodeId === executionNode.nodeId));
  assert.ok(evidence);
  const claims = draft.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')
    .flatMap(item => item.testimony.statements).filter(item => item.technicalAssessment === 'CONTRADICTED');
  const executionStage = input.scenarioPackage.evidenceRequirements.requirements.find(item => item.investigationStage
    && item.investigationStage.sourceNodeId === 'client-host').investigationStage;
  const contradiction = draft.contradictions.find(item => item.statementRef === claims[executionStage.order - 1].statementId);
  const testimony = draft.evidenceArtifacts.find(item => item.evidenceId === contradiction.testimonyEvidenceId);
  const statement = testimony.testimony.statements.find(item => item.statementId === contradiction.statementRef);
  const claim = '保存された投稿は表示するだけなので、ブラウザで実行された記録はありません。';
  testimony.publicContent = testimony.publicContent.replace(statement.spokenContent, claim);
  statement.spokenContent = claim; statement.groundTruthRefs = [executionFact.factId];
  contradiction.contradictionId = 'contradiction_execution';
  // 検証済み段階の保存・閲覧・実行計測への参照は維持し、Ground Truth参照だけを壊す。
  assert.ok(contradiction.conflictingEvidenceIds.includes(evidence.evidenceId));
  contradiction.groundTruthRefs = [executionFact.factId];
  contradiction.reason = 'ブラウザの実行計測資料が存在しないという主張と競合する。';
  const question = draft.courtQuestions.find(item => item.statementId === statement.statementId);
  question.prompt = 'training-script-01を含む保存・閲覧後のブラウザ計測資料から、どこまで言えますか。';
  question.choices = ['対象応答に対応するブラウザの実行計測記録がある。',
    '保存された投稿の資料だけで実行成功を確認できる。', '認証成功の記録だけでブラウザ実行まで確認できる。',
    'ブラウザの実行計測だけで操作者の氏名が確定する。'];
  question.correctOptionIndex = 0; question.explanation = question.choices[0];
  syncQuestionQuotes(draft);
  question.explanation += `照合した値：${question.supportingQuotes.map(item => observationAnchors(item.quote)[0]).join('、')}。`;
  const exoneration = draft.exonerations[0];
  exoneration.supportingEvidenceIds = [...new Set([...exoneration.supportingEvidenceIds, evidence.evidenceId])];
  exoneration.groundTruthRefs = [...new Set([...exoneration.groundTruthRefs, executionFact.factId])];
  return { statement, contradiction, executionFact, loginFact };
}

function repairReferences(draft, revision, side) {
  for (const mismatch of revision.mismatches) {
    const contradiction = draft.contradictions.find(item => item.contradictionId === mismatch.contradictionId);
    const statement = draft.evidenceArtifacts.find(item => item.evidenceId === mismatch.testimonyEvidenceId)
      .testimony.statements.find(item => item.statementId === mismatch.statementId);
    // The fixture deliberately corrupted one known slot; real repair is done by the
    // Evidence Agent against the verified source, never by production array copying.
    if (side === 'contradiction') contradiction.groundTruthRefs = [...mismatch.statementGroundTruthRefs];
    else statement.groundTruthRefs = [...mismatch.contradictionGroundTruthRefs];
  }
}

async function generate({ side = 'contradiction', repair = repairReferences, mutateAfterRepair = null } = {}) {
  const runner = new MockCodexRunner(); const runJson = runner.runJson.bind(runner);
  let validDraft; let failedDraft;
  runner.runJson = async args => {
    let draft = await runJson(args);
    if (args.phase !== 'GENERATING_EVIDENCE') return draft;
    if (args.data.evidenceGroundRevision) {
      draft = structuredClone(args.data.evidenceGroundRevision.draft);
      repair(draft, args.data.evidenceGroundRevision, side);
      mutateAfterRepair?.(draft);
    } else {
      const slots = executionClaim(draft, args.data.evidenceDraftInput.evidenceAgentInput.scenarioVerificationInput);
      validDraft = structuredClone(draft);
      if (side === 'contradiction') slots.contradiction.groundTruthRefs.push(slots.loginFact.factId);
      else slots.statement.groundTruthRefs = [slots.loginFact.factId];
      failedDraft = structuredClone(draft);
    }
    return draft;
  };
  const manager = new AutoGenerationManager({ jsonRunner: runner }); const session = createAutoAuthorSession();
  const configuration = autoAuthorBootstrap().manualAttackPresets.find(item => item.attackIds.length === 3).configuration;
  const originalConfiguration = structuredClone(configuration);
  manager.submitManual(session, configuration); await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(session.auto.details));
  const approvedScenario = structuredClone(session.scenarioPackage);
  manager.approve(session); await manager.waitForIdle();
  assert.deepEqual(configuration, originalConfiguration);
  assert.deepEqual(session.configuration, originalConfiguration);
  assert.deepEqual(session.scenarioPackage, approvedScenario);
  return { session, runner, validDraft, failedDraft };
}

for (const side of ['contradiction', 'statement']) {
  test(`3攻撃の${side}根拠不一致を限定修正し、全争点を4択と証拠で解決できる`, async () => {
    const { session, runner, validDraft, failedDraft } = await generate({ side });
    assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
    assert.equal(runner.evidenceCalls, 2); assert.equal(runner.reviewCalls, 1); assert.equal(runner.scenarioCalls, 0);
    assert.equal(session.auto.progress.evidence.attempt, 2);
    assert.equal(session.auto.progress.evidence.status, 'COMPLETE');
    assert.equal(session.evaluationResult.status, 'ACCEPTED');
    const calls = runner.calls.filter(item => item.phase === 'GENERATING_EVIDENCE');
    assert.equal(Object.hasOwn(calls[0].data, 'evidenceGroundRevision'), false);
    assert.deepEqual(calls[0].data.evidenceDraftInput, calls[1].data.evidenceDraftInput);
    const revision = calls[1].data.evidenceGroundRevision;
    assert.deepEqual(revision.draft, failedDraft);
    assert.equal(revision.mismatches[0].contradictionId, 'contradiction_execution');
    assert.equal(revision.mismatches[0].unexpectedGroundTruthRefs.length, 1);
    assert.equal(calls[1].feedback.classification, 'REPAIRABLE_BLOCKED');
    assert.equal(calls[1].feedback.errors[0].code, 'CONTRADICTION_GROUND_MISMATCH');
    assert.equal(calls[1].feedback.errors[0].field, 'contradictions.contradiction_execution.groundTruthRefs');
    const set = session.evidenceImportResult.evidenceSet;
    assert.deepEqual(set.contradictions, validDraft.contradictions);
    assert.deepEqual(set.exonerations, validDraft.exonerations);
    assert.deepEqual(set.evidenceArtifacts.map(({ integrity, ...artifact }) => artifact), validDraft.evidenceArtifacts);
    assert.deepEqual(session.progressionPlan.courtQuestions, validDraft.courtQuestions);
    assert.doesNotMatch(JSON.stringify(autoAuthorView(session)), /evidenceGroundRevision|unexpectedGroundTruthRefs/);

    // The invalid first draft is still rejected by the unchanged canonical Import.
    const before = structuredClone(failedDraft);
    const rejected = importEvidencePackage({ generationInput: session.evidenceGenerationInput,
      evidencePackage: materializeEvidenceGenerationDraft(failedDraft) });
    assert.equal(rejected.status, 'INVALID'); assert.equal(rejected.evidenceSet, null);
    assert.deepEqual(rejected.errors.map(item => item.code), ['CONTRADICTION_GROUND_MISMATCH']);
    assert.deepEqual(failedDraft, before);
    const { runtime } = session; const player = createGeneratedGame(runtime);
    actGenerated(player, runtime, { action: 'begin' }); actGenerated(player, runtime, { action: 'continue' });
    for (let round = 1; round <= runtime.gameCase.progression.courtRoundCount; round += 1) {
      collectCurrentTarget(player, runtime);
      const court = enterCurrentCourt(player, runtime);
      assert.equal(court.pendingInterpretation.choiceId, currentCorrectPair(runtime, round).interpretationChoiceId);
      actGenerated(player, runtime, { action: 'objection', ...currentCorrectPair(runtime, round) });
    }
    assert.equal(player.currentState, 'ACQUITTED');
  });
}

test('根拠の不一致が続く場合は2回で停止し、自動で共通部分へ補正しない', async () => {
  const { session, runner, failedDraft } = await generate({ repair() {} });
  assert.equal(session.auto.state, 'FAILED'); assert.equal(runner.evidenceCalls, 2);
  assert.equal(session.runtime, null); assert.equal(session.gameCaseResult, null);
  assert.equal(session.evaluationResult, null); assert.equal(session.evidenceImportResult.status, 'INVALID');
  assert.equal(session.auto.progress.evidence.attempt, 2);
  assert.equal(session.auto.progress.evidence.status, 'FAILED');
  assert.equal(session.auto.details.find(item => item.code === 'EVIDENCE_GENERATION_FAILED').attempt, 2);
  assert.deepEqual(session.auto.details.filter(item => item.code === 'CONTRADICTION_GROUND_MISMATCH')
    .map(item => item.attempt), [1, 2]);
  assert.deepEqual(runner.calls.filter(item => item.phase === 'GENERATING_EVIDENCE')[1]
    .data.evidenceGroundRevision.draft, failedDraft);
});

for (const [label, mutateAfterRepair] of [
  ['技術本文', draft => { draft.evidenceArtifacts[0].publicContent += '\n別の観測を追加'; }],
  ['競合する証拠', draft => { draft.contradictions.find(item => item.contradictionId === 'contradiction_execution')
    .conflictingEvidenceIds = ['evidence_technical_a']; }],
  ['4択', draft => { draft.courtQuestions[0].correctOptionIndex = 1; }],
  ['別の証言の根拠', draft => { draft.evidenceArtifacts.find(item => item.type === 'TESTIMONY')
    .testimony.statements.find(item => item.statementId === 'statement_record_exists').groundTruthRefs = []; }],
]) test(`根拠参照の限定修正で${label}を書き換えた生成物は公開しない`, async () => {
  const { session, runner } = await generate({ mutateAfterRepair });
  assert.equal(session.auto.state, 'FAILED'); assert.equal(runner.evidenceCalls, 2);
  assert.equal(session.runtime, null); assert.equal(session.evaluationResult, null);
  assert.ok(session.auto.details.some(item => item.code === 'EVIDENCE_GROUND_REPAIR_CHANGED_INPUT'));
});

test('両側を一致させても検証済みGround Truthにないfactは拒否する', async () => {
  const { session, runner } = await generate({ repair(draft, revision) {
    const mismatch = revision.mismatches[0];
    draft.contradictions.find(item => item.contradictionId === mismatch.contradictionId).groundTruthRefs = ['fact_nonexistent'];
    draft.evidenceArtifacts.find(item => item.evidenceId === mismatch.testimonyEvidenceId)
      .testimony.statements.find(item => item.statementId === mismatch.statementId).groundTruthRefs = ['fact_nonexistent'];
  } });
  assert.equal(session.auto.state, 'FAILED'); assert.equal(runner.evidenceCalls, 2);
  assert.equal(session.runtime, null);
  assert.ok(session.auto.details.some(item => item.code === 'BROKEN_GROUND_TRUTH_REFERENCE' && item.attempt === 2));
});

test('Evidence Promptはfactの包含関係と根拠参照だけの限定修正を要求する', () => {
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /groundTruth\.technicalFacts\[\]\.factId/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /全件一致は必須ではありません/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /evidenceGroundRevision/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /単純な和集合・共通部分/);
});
