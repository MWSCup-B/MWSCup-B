import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoGenerationManager, autoAuthorBootstrap, autoAuthorView, createAutoAuthorSession }
  from '../server/auto-generation-service.js';
import { actGenerated, createGeneratedGame } from '../server/generated-game.js';
import { buildGameCaseConversionInput, buildGameProgressionPlan, convertGameCase }
  from '../server/generation/game-case-converter.js';
import { findIncorrectObjectionPair } from '../server/generation/game-case-validator.js';
import { buildGameEvaluationInput, evaluateGame } from '../server/generation/game-evaluator.js';
import { buildGeneratedGame } from '../server/generation/game-make.js';
import { CodexOutputError } from '../server/codex/codex-errors.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { currentCorrectPair } from './helpers/court-issues.js';

const observationId = 'statement_mail_link_observation';

function appendGroundedObservation(draft) {
  const artifact = draft.evidenceArtifacts.find(item => item.type === 'TESTIMONY');
  const spokenContent = '保存メールには案内のリンクが含まれています。';
  artifact.testimony.statements.push({ statementId: observationId, spokenContent,
    technicalAssessment: 'CONSISTENT', contradictionCandidate: false,
    groundTruthRefs: [...artifact.testimony.statements[0].groundTruthRefs] });
  artifact.publicContent += `\n架空の調査担当者の発言: 「${spokenContent}」`;
}

async function generate({ difficulty = 1, alreadyPlayable = false, repair = appendGroundedObservation } = {}) {
  const runner = new MockCodexRunner();
  const runJson = runner.runJson.bind(runner);
  runner.runJson = async args => {
    let draft = await runJson(args);
    if (args.phase !== 'GENERATING_EVIDENCE') return draft;
    if (args.data.courtChoiceRevisionBase) {
      draft = structuredClone(args.data.courtChoiceRevisionBase);
      repair(draft);
    } else {
      // メール・Web記録のどちらも同じ人物断定への反駁資料となる実生成相当の構成。
      // 通常mockはメールだけを正解にするため、この全組合せ正解のケースを見落としていた。
      for (const contradiction of draft.contradictions) {
        contradiction.conflictingEvidenceIds = ['evidence_technical_a', 'evidence_technical_b'];
      }
      const testimony = draft.evidenceArtifacts.find(item => item.type === 'TESTIMONY');
      testimony.testimony.statements = testimony.testimony.statements.filter(item => item.technicalAssessment === 'CONTRADICTED');
      testimony.publicContent = testimony.testimony.statements.map(item => item.spokenContent).join('\n');
      if (alreadyPlayable) appendGroundedObservation(draft);
    }
    return draft;
  };
  let evaluationCalls = 0;
  const manager = new AutoGenerationManager({ jsonRunner: runner,
    evaluator: input => { evaluationCalls += 1; return evaluateGame(input); } });
  const session = createAutoAuthorSession();
  const configuration = autoAuthorBootstrap().defaultManualConfiguration;
  configuration.difficulty = difficulty; configuration.evidenceCount = difficulty;
  const originalConfiguration = structuredClone(configuration);
  manager.submitManual(session, configuration); await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  const approvedScenario = structuredClone(session.scenarioPackage);
  manager.approve(session); await manager.waitForIdle();
  assert.deepEqual(session.configuration, originalConfiguration);
  assert.deepEqual(session.scenarioPackage, approvedScenario);
  return { session, runner, evaluationCalls, view: autoAuthorView(session) };
}

function collectAll(runtime) {
  const player = createGeneratedGame(runtime);
  actGenerated(player, runtime, { action: 'begin' });
  actGenerated(player, runtime, { action: 'continue' });
  for (const rule of runtime.gameCase.detective.evidenceDiscoveryRules) {
    actGenerated(player, runtime, { action: 'investigate', targetId: rule.targetId,
      investigationActionId: rule.actionId });
    actGenerated(player, runtime, { action: 'collect', evidenceId: rule.evidenceId });
  }
  return player;
}

test('誤答探索は複数ruleの正解の和集合を使い、公開されない選択肢を作らない', () => {
  const choices = { statementIds: ['claim'], presentableEvidenceIds: ['mail', 'web'],
    objectionRules: [{ targetStatementId: 'claim', acceptedEvidenceIds: ['mail'] },
      { targetStatementId: 'claim', acceptedEvidenceIds: ['web'] }] };
  assert.equal(findIncorrectObjectionPair(choices), null);
  assert.deepEqual(findIncorrectObjectionPair({ ...choices, statementIds: ['claim', 'observation'] }),
    { statementId: 'observation', evidenceId: 'mail' });
  assert.deepEqual(findIncorrectObjectionPair({ ...choices, objectionRules: choices.objectionRules.slice(0, 1) }),
    { statementId: 'claim', evidenceId: 'web' });
  assert.equal(findIncorrectObjectionPair({ ...choices, presentableEvidenceIds: [] }), null);
  assert.equal(findIncorrectObjectionPair({ ...choices, statementIds: [] }), null);
});

for (const difficulty of [1, 2, 3]) {
  test(`Phishing ★${difficulty}: 全組合せ正解を限定修正し、誤答・retry・上限・正解の全経路を保持する`, async () => {
    const { session, runner, view, evaluationCalls } = await generate({ difficulty });
    assert.equal(view.currentState, 'READY', JSON.stringify(view.developerDetails));
    assert.equal(evaluationCalls, 1); assert.equal(runner.evidenceCalls, 2);
// 2026-09-20 修正前: 初回Scenario設計を含む呼出回数・失敗工程を検証する
//     assert.equal(runner.reviewCalls, 1); assert.equal(runner.scenarioCalls, 0);
// 2026-09-20 修正後: 初回Scenario設計を含む呼出回数・失敗工程を検証する
    assert.equal(runner.reviewCalls, 1); assert.equal(runner.scenarioCalls, 1);
    assert.equal(session.evaluationResult.status, 'ACCEPTED');
    assert.ok(session.evaluationResult.checks.every(item => item.status === 'PASS'));
    const calls = runner.calls.filter(item => item.phase === 'GENERATING_EVIDENCE');
    const base = calls[1].data.courtChoiceRevisionBase;
    assert.equal(calls[1].feedback.classification, 'REPAIRABLE_BLOCKED');
    assert.equal(calls[1].feedback.errors[0].code, 'EVIDENCE_NO_INCORRECT_OBJECTION_PAIR');
    assert.deepEqual(calls[0].data.evidenceDraftInput, calls[1].data.evidenceDraftInput);
    assert.ok(base); assert.equal(Object.hasOwn(calls[0].data, 'courtChoiceRevisionBase'), false);
    const set = session.evidenceImportResult.evidenceSet;
    assert.deepEqual(set.contradictions, base.contradictions);
    assert.deepEqual(set.exonerations, base.exonerations);
    assert.equal(set.evidenceArtifacts.length, base.evidenceArtifacts.length);
    for (const original of base.evidenceArtifacts) {
      const revised = set.evidenceArtifacts.find(item => item.evidenceId === original.evidenceId);
      if (original.type !== 'TESTIMONY') {
        const { integrity, ...draft } = revised;
        assert.deepEqual(draft, original);
      } else {
        assert.deepEqual(revised.testimony.statements.slice(0, original.testimony.statements.length),
          original.testimony.statements);
        assert.ok(revised.publicContent.startsWith(original.publicContent));
      }
    }
    const runtime = session.runtime;
    const rule = runtime.gameCase.judgment.judgmentRules[0];
    assert.deepEqual(rule.acceptedEvidenceIds, ['evidence_technical_a', 'evidence_technical_b']);
    const incorrect = { statementId: observationId, evidenceId: 'evidence_technical_a' };
    const player = collectAll(runtime);
    actGenerated(player, runtime, { action: 'retrial' });
    const failed = actGenerated(player, runtime, { action: 'objection', ...incorrect });
    assert.equal(failed.currentState, 'GUILTY_RETRY'); assert.equal(failed.attemptCount, 1);
    assert.doesNotMatch(JSON.stringify(failed), /acceptedEvidenceIds|technicalAssessment|groundTruthRefs/);
    assert.equal(actGenerated(player, runtime, { action: 'retry' }).currentState, 'INVESTIGATION');
    for (let round = 1; round <= difficulty + 1; round += 1) {
      const court = actGenerated(player, runtime, { action: 'retrial' });
      assert.ok(court.testimonies.some(item => item.statements.some(statement =>
        statement.statementId === observationId)));
      const result = actGenerated(player, runtime, { action: 'objection', ...currentCorrectPair(runtime, round) });
      assert.equal(result.currentState, round === difficulty + 1 ? 'ACQUITTED' : 'INVESTIGATION');
    }
    const limited = collectAll(runtime);
    assert.equal(runtime.gameCase.progression.retryPolicy.maxCourtAttempts, 3);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      actGenerated(limited, runtime, { action: 'retrial' });
      const result = actGenerated(limited, runtime, { action: 'objection', ...incorrect });
      assert.equal(result.attemptCount, attempt);
      assert.equal(result.currentState, attempt === 3 ? 'BLOCKED' : 'GUILTY_RETRY');
      if (attempt < 3) actGenerated(limited, runtime, { action: 'retry' });
    }
  });
}

test('初回から裏付けのある観測発言と反駁対象があれば追加生成せずREADYになる', async () => {
  const { view, runner, evaluationCalls } = await generate({ alreadyPlayable: true });
  assert.equal(view.currentState, 'READY', JSON.stringify(view.developerDetails));
  assert.equal(runner.evidenceCalls, 1); assert.equal(evaluationCalls, 1);
  assert.ok(!view.developerDetails.some(item => item.code === 'EVIDENCE_NO_INCORRECT_OBJECTION_PAIR'));
});

test('全組合せ正解のままならEvidence生成2回で停止し、VALIDなImportを成功と取り違えない', async () => {
  const { session, view, runner, evaluationCalls } = await generate({ repair: () => {} });
  assert.equal(view.currentState, 'FAILED'); assert.equal(view.failure.code, 'EVIDENCE_GENERATION_FAILED');
  assert.equal(runner.evidenceCalls, 2); assert.equal(evaluationCalls, 0);
  assert.equal(session.evidenceImportResult.status, 'VALID');
  assert.equal(session.progressionPlan, null); assert.equal(session.runtime, null); assert.equal(view.playUrl, null);
  assert.deepEqual(view.developerDetails.filter(item => item.code === 'EVIDENCE_NO_INCORRECT_OBJECTION_PAIR')
    .map(item => item.attempt), [1, 2]);
});

test('誤答選択肢修正の非JSON応答でも以前のVALID Importで後続工程へ進まない', async () => {
  const { view, runner, evaluationCalls } = await generate({ repair: () => {
    throw new CodexOutputError('単一JSONを取得できません。', { phase: 'GENERATING_EVIDENCE' });
  } });
  assert.equal(view.currentState, 'FAILED'); assert.equal(runner.evidenceCalls, 2);
  assert.equal(evaluationCalls, 0); assert.equal(view.playUrl, null);
  assert.ok(view.developerDetails.some(item => item.code === 'MALFORMED_CODEX_JSON'));
});

for (const [name, alter] of [
  ['正解Evidenceの削除', draft => { draft.contradictions[0].conflictingEvidenceIds.pop(); }],
  ['技術本文の変更', draft => { draft.evidenceArtifacts[0].publicContent += '\n別の観測'; }],
  ['既存証言の削除', draft => { draft.evidenceArtifacts.find(item => item.type === 'TESTIMONY').testimony.statements.shift(); }],
  ['根拠のない追加発言', draft => { draft.evidenceArtifacts.find(item => item.type === 'TESTIMONY').testimony.statements.at(-1).groundTruthRefs = []; }],
]) {
  test(`誤答を作るための${name}を拒否する`, async () => {
    const { view, runner, evaluationCalls } = await generate({ repair: draft => {
      appendGroundedObservation(draft); alter(draft);
    } });
    assert.equal(view.currentState, 'FAILED'); assert.equal(view.playUrl, null);
    assert.equal(runner.evidenceCalls, 2); assert.equal(evaluationCalls, 0);
    assert.ok(view.developerDetails.some(item => item.code === 'EVIDENCE_COURT_REPAIR_CHANGED_INPUT'));
  });
}

test('全組合せ正解のGameは最終Evaluationも拒否し、retryPolicy不足と区別した理由を返す', async () => {
  const { session, view } = await generate({ alreadyPlayable: true });
  assert.equal(view.currentState, 'READY', JSON.stringify(view.developerDetails));
  const evidenceSet = session.evidenceImportResult.evidenceSet;
  const progressionPlan = buildGameProgressionPlan({ ...session.progressionPlan,
    // Backward-compatible legacy contract: the final evaluator must still reject it.
    courtIssueMode: undefined, courtRoundCount: 1,
    retrialStatementIds: session.progressionPlan.retrialStatementIds.filter(id => id !== observationId) });
  const conversionInput = buildGameCaseConversionInput({ evidenceSet, progressionPlan,
    evidenceImportResult: session.evidenceImportResult,
    gameCaseHandoff: session.evidenceImportResult.gameCaseHandoff,
    scenarioPackage: session.scenarioPackage, characters: session.scenarioPackage.characters,
    timeline: session.scenarioPackage.timeline, verificationResult: session.verificationResult,
    scenarioGenerationInput: session.generationInput,
    contradictions: evidenceSet.contradictions, exonerations: evidenceSet.exonerations });
  const gameCaseResult = convertGameCase(conversionInput);
  assert.equal(gameCaseResult.status, 'READY');
  const { gameMakeResult } = buildGeneratedGame(gameCaseResult);
  const evaluation = evaluateGame(buildGameEvaluationInput({ gameMakeResult, gameCaseResult,
    evidenceSet, verificationResult: session.verificationResult, scenarioPackage: session.scenarioPackage }));
  assert.equal(evaluation.status, 'BLOCKED');
  assert.deepEqual(evaluation.issues.map(item => item.code),
    ['RETRY_PLAYTHROUGH_FAILED', 'LIMIT_PLAYTHROUGH_FAILED', 'INSUFFICIENT_BRUTE_FORCE_RESISTANCE']);
  for (const issue of evaluation.issues) {
    assert.match(issue.reason, /全組合せが正解/);
    assert.match(issue.correctionHint, /CONSISTENT/);
    assert.doesNotMatch(issue.correctionHint, /maxCourtAttempts|retryPolicy/);
  }
});
