import test from 'node:test';
import assert from 'node:assert/strict';
import { correctCourtChoiceId, publicCourtQuestion, validateCourtQuestion,
  validateCourtQuestionSources } from '../server/generation/court-questions.js';
import { materializeEvidenceGenerationDraft } from '../server/generation/evidence-interface.js';
import { AutoGenerationManager, autoAuthorBootstrap, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { actGenerated, createGeneratedGame, generatedPlayerView } from '../server/generated-game.js';
import { phase7Fixture } from './helpers/phase7-evidence.js';
import { addCourtQuestions, addDistinctClaims, currentCorrectPair, collectCurrentTarget, enterCurrentCourt } from './helpers/court-issues.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

function questionDraft() {
  const draft = phase7Fixture().evidencePackage;
  for (const artifact of draft.evidenceArtifacts) delete artifact.integrity;
  addDistinctClaims(draft, 2); return addCourtQuestions(draft);
}

test('4択の根拠は既存の競合資料の原文に追跡でき、Evidence Import契約とは分離する', () => {
  const draft = questionDraft(); const before = structuredClone(draft);
  assert.equal(validateCourtQuestionSources(draft.courtQuestions, draft), draft.courtQuestions);
  const imported = materializeEvidenceGenerationDraft(draft);
  assert.equal(Object.hasOwn(imported, 'courtQuestions'), false);
  assert.deepEqual(imported.contradictions, draft.contradictions);
  assert.deepEqual(draft, before);
});

test('4択の不足・重複・未知争点・不存在引用・証言による技術資料の代用を拒否する', () => {
  for (const [code, mutate] of [
    ['EVIDENCE_COURT_QUESTIONS_REQUIRED', draft => { draft.courtQuestions.pop(); }],
    ['EVIDENCE_QUESTION_DUPLICATE_CHOICE', draft => { draft.courtQuestions[0].choices[1] = draft.courtQuestions[0].choices[0]; }],
    ['EVIDENCE_QUESTION_STATEMENT_MISMATCH', draft => { draft.courtQuestions[0].statementId = 'unknown_statement'; }],
    ['EVIDENCE_QUESTION_QUOTE_MISMATCH', draft => { draft.courtQuestions[0].supportingQuotes[0].quote = '本文に存在しない引用です。'; }],
    ['EVIDENCE_QUESTION_QUOTE_MISMATCH', draft => {
      draft.courtQuestions[0].supportingQuotes.push({ evidenceId: 'evidence_testimony', quote: 'その操作を直接見た' });
    }],
  ]) {
    const draft = questionDraft(); mutate(draft);
    assert.throws(() => validateCourtQuestionSources(draft.courtQuestions, draft), { code });
  }
  const question = questionDraft().courtQuestions[0]; question.choices.pop();
  assert.throws(() => validateCourtQuestion(question));
  for (const value of [null, undefined, [], 'not an object']) {
    assert.throws(() => materializeEvidenceGenerationDraft(value), { code: 'INVALID_TYPE' });
  }
});

test('公開する4択には正解位置・根拠引用・解説を含めず、正解位置で選択肢のIDや順序が変わらない', () => {
  const question = questionDraft().courtQuestions[0];
  const publicQuestion = publicCourtQuestion(question);
  assert.equal(publicQuestion.choices.length, 4);
  assert.ok(publicQuestion.choices.every(item => /^choice_[a-f0-9]{24}$/.test(item.choiceId)));
  assert.doesNotMatch(JSON.stringify(publicQuestion), /correctOptionIndex|correctChoiceId|supportingQuotes|explanation/);
  const other = { ...question, correctOptionIndex: 1 };
  assert.deepEqual(publicCourtQuestion(other), publicQuestion);
  assert.notEqual(correctCourtChoiceId(other), correctCourtChoiceId(question));
  const reordered = { ...question, choices: [...question.choices].reverse(),
    correctOptionIndex: 3 - question.correctOptionIndex };
  assert.deepEqual(publicCourtQuestion(reordered), publicQuestion);
  assert.equal(correctCourtChoiceId(reordered), correctCourtChoiceId(question));
});

test('4択と解決後の解説にも内部ID・正解ラベルを持ち込めない', () => {
  const agent = phase7Fixture().evidenceGenerationInput.evidenceAgentInput;
  for (const mutate of [
    question => { question.prompt = `検証結果 ${agent.verificationResult.verificationId}`; },
    question => { question.choices[0] = '正解はこの選択肢です。'; },
    question => { question.explanation = `人物ID ${agent.characters.characters[0].characterId}`; },
  ]) {
    const draft = questionDraft(); mutate(draft.courtQuestions[0]);
    assert.throws(() => validateCourtQuestionSources(draft.courtQuestions, draft, agent),
      { code: 'EVIDENCE_QUESTION_PRIVATE_LEAK' });
  }
});

async function generate(changeDraft = null, configuration = autoAuthorBootstrap().defaultManualConfiguration) {
  const runner = new MockCodexRunner(); const runJson = runner.runJson.bind(runner);
  runner.runJson = async args => {
    const value = await runJson(args);
    if (args.phase === 'GENERATING_EVIDENCE') changeDraft?.(value);
    return value;
  };
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const author = createAutoAuthorSession();
  manager.submitManual(author, configuration);
  await manager.waitForIdle(); assert.equal(author.auto.state, 'SCENARIO_PREVIEW');
  manager.approve(author); await manager.waitForIdle();
  return { author, runner };
}

function collectAll(session, runtime) {
  collectCurrentTarget(session, runtime);
}

test('冒頭説明と調査の準備状態を公開し、未発見の資料本文や正解は公開しない', async () => {
  const { author } = await generate(); assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  const { runtime } = author; const player = createGeneratedGame(runtime);
  const opening = actGenerated(player, runtime, { action: 'begin' });
  assert.match(opening.initialCourt.incidentOverview, /青葉ソリューションズ|社内ポータル/);
  assert.match(opening.initialCourt.prosecutionOpening, /案内メールが保存され/);
  assert.doesNotMatch(opening.initialCourt.prosecutionOpening, /From: notice@example\.invalid/);
  assert.match(opening.initialCourt.prosecutionOpening, /検察側の主張と疑いの経緯/);
  assert.match(opening.initialCourt.prosecutionOpening, /具体的な裏付け/);
  assert.equal(opening.initialCourt.attributionStatus, 'ALLEGATION_ONLY');
  const investigation = actGenerated(player, runtime, { action: 'continue' });
  assert.equal(investigation.discoveredEvidence.length, 0);
  assert.deepEqual(investigation.collectedEvidence, []);
  assert.ok(investigation.investigationTargets.some(target => target.targetType === 'MAILBOX'
    && target.availableActions.some(action => action.actionId === 'action_check_email' && action.status === 'READY')));
  assert.equal(investigation.investigationTargets.length, runtime.gameCase.detective.investigationTargets.length);
  assert.doesNotMatch(JSON.stringify(investigation), /correctOptionIndex|supportingQuotes|requiredEvidenceIds/);
  for (const item of runtime.gameCase.detective.evidence.filter(item => !investigation.currentEvidenceIds.includes(item.evidenceId))) {
    assert.ok(!JSON.stringify(investigation).includes(item.publicContent));
  }
  const first = runtime.gameCase.detective.evidenceDiscoveryRules[0];
  collectCurrentTarget(player, runtime);
  const updated = generatedPlayerView(player, runtime);
  assert.equal(updated.workbench.materials.find(item => item.materialId === first.evidenceId).question.choices.length, 4);
});

test('解釈の省略・別争点・未知IDは拒否し、誤解釈でも回数を消費して再調査・上限へ進む', async () => {
  const { author } = await generate(); const { runtime } = author;
  assert.ok(runtime, JSON.stringify(author.auto.details));
  const session = createGeneratedGame(runtime);
  actGenerated(session, runtime, { action: 'begin' }); actGenerated(session, runtime, { action: 'continue' });
  collectAll(session, runtime);
  const view = generatedPlayerView(session, runtime);
  const pair = currentCorrectPair(runtime);
  assert.equal(view.workbench.materials.find(item => item.materialId === pair.evidenceId).question.choices.length, 4);
  assert.equal(Object.hasOwn(view.result ?? {}, 'publicExplanation'), false);
  const otherChoice = correctCourtChoiceId(runtime.gameCase.progression.courtIssues[1].question);
  for (const interpretationChoiceId of [undefined, 'choice_unknown', otherChoice]) {
    assert.throws(() => actGenerated(session, runtime, { action: 'retrial', evidenceId: pair.evidenceId, interpretationChoiceId }),
      { code: 'INTERPRETATION_CHOICE_REQUIRED' });
    assert.equal(session.currentState, 'INVESTIGATION'); assert.equal(session.attemptCount, 0);
  }
  const wrong = view.workbench.materials.find(item => item.materialId === pair.evidenceId).question.choices.find(choice => choice.choiceId !== pair.interpretationChoiceId).choiceId;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const court = enterCurrentCourt(session, runtime, wrong);
    assert.equal(court.pendingInterpretation.choiceId, wrong);
    assert.equal(court.courtQuestion, undefined);
    assert.throws(() => actGenerated(session, runtime, { action: 'objection', ...pair }),
      { code: 'INTERPRETATION_CHANGED_IN_COURT' });
    const failed = actGenerated(session, runtime, { action: 'objection', ...pair, interpretationChoiceId: wrong });
    assert.equal(failed.currentState, attempt === 3 ? 'BLOCKED' : 'INVESTIGATION');
    assert.equal(failed.remainingAttempts, 3 - attempt);
    assert.equal(session.previousAttempts.at(-1).interpretationChoiceId, wrong);
    assert.doesNotMatch(JSON.stringify(failed), /correctOptionIndex|correctChoiceId|supportingQuotes|publicExplanation/);
    if (attempt < 3) {
      assert.equal(failed.investigationTargets[0].targetId, view.investigationTargets[0].targetId);
      assert.deepEqual(failed.collectedEvidence, view.collectedEvidence);
      assert.equal(failed.currentRound, 1);
    }
  }
});

test('正しい解釈と誤った証拠では通過せず、両方が対応した時だけ次の争点へ進む', async () => {
  const configuration = autoAuthorBootstrap().manualAttackPresets.find(item => item.attackIds.length === 3).configuration;
  const { author } = await generate(null, configuration); const { runtime } = author; assert.ok(runtime, JSON.stringify(author.auto.details));
  const session = createGeneratedGame(runtime);
  actGenerated(session, runtime, { action: 'begin' }); actGenerated(session, runtime, { action: 'continue' });
  collectAll(session, runtime); enterCurrentCourt(session, runtime);
  actGenerated(session, runtime, { action: 'objection', ...currentCorrectPair(runtime) });
  collectAll(session, runtime); enterCurrentCourt(session, runtime);
  // The second stage now needs the earlier mail as well as the new records.
  // The next attack's stage supplies a genuinely unrelated collected record.
  actGenerated(session, runtime, { action: 'objection', ...currentCorrectPair(runtime, 2) });
  collectAll(session, runtime); enterCurrentCourt(session, runtime);
  const correct = currentCorrectPair(runtime, 3);
  const rule = runtime.gameCase.judgment.judgmentRules.find(item => item.targetStatementId === correct.statementId);
  const wrongEvidence = session.collectedEvidenceIds.find(id => !rule.acceptedEvidenceIds.includes(id));
  assert.ok(wrongEvidence);
  assert.throws(() => actGenerated(session, runtime, { action: 'objection', ...correct, evidenceId: wrongEvidence }), { code: 'MATERIAL_CHANGED_IN_COURT' });
  actGenerated(session, runtime, { action: 'investigation' });
  const wrongQuestion = generatedPlayerView(session, runtime).workbench.materials.find(item => item.materialId === wrongEvidence).question;
  actGenerated(session, runtime, { action: 'retrial', evidenceId: wrongEvidence, interpretationChoiceId: wrongQuestion.choices[0].choiceId });
  const failed = actGenerated(session, runtime, { action: 'objection', statementId: correct.statementId, evidenceId: wrongEvidence });
  assert.equal(failed.currentState, 'INVESTIGATION'); assert.equal(failed.result.publicExplanation, undefined);
  enterCurrentCourt(session, runtime);
  const passed = actGenerated(session, runtime, { action: 'objection', ...correct });
  assert.equal(passed.currentState, 'INVESTIGATION'); assert.equal(passed.currentRound, 4);
  assert.equal(passed.result.publicExplanation, undefined);
  assert.equal(passed.caseStudy, undefined);
});

test('4択が欠落した生成物は2回で停止し、旧形式として黙って通過させない', async () => {
  const { author, runner } = await generate(draft => { delete draft.courtQuestions; });
  assert.equal(author.auto.state, 'FAILED'); assert.equal(author.runtime, null); assert.equal(runner.evidenceCalls, 2);
  assert.ok(author.auto.details.some(item => item.code === 'EVIDENCE_COURT_QUESTIONS_REQUIRED'));
});

test('不正な4択の引用を同じEvidence上限内で差し戻し、修正後だけREADYにする', async () => {
  let calls = 0;
  const { author, runner } = await generate(draft => {
    if (++calls === 1) draft.courtQuestions[0].supportingQuotes[0].quote = '原文に存在しない引用です。';
  });
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  assert.equal(runner.evidenceCalls, 2);
  const repair = runner.calls.filter(call => call.phase === 'GENERATING_EVIDENCE')[1];
  assert.match(JSON.stringify(repair.feedback), /EVIDENCE_QUESTION_QUOTE_MISMATCH/);
  assert.ok(author.auto.details.some(item => item.code === 'EVIDENCE_QUESTION_QUOTE_MISMATCH'));
});
