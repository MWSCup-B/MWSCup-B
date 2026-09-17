import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameCaseConversionInput, buildGameProgressionPlan, convertGameCase }
  from '../server/generation/game-case-converter.js';
import { digest } from '../server/generation/evidence-validator.js';
import {
  conversionInputCore,
  gameCaseCore,
  evaluateObjection,
  projectPublicGameCase,
  progressionPlanCore,
  validateGameCase,
  validateGameCaseBundle,
  validateGameCaseConversionInput,
  validateGameCaseResult,
  validateGameProgressionPlan,
  validatePublicGameCase,
  validateUiIntegrationHandoff,
} from '../server/generation/game-case-validator.js';
import { phase7Fixture } from './helpers/phase7-evidence.js';

function conversionInput() {
  const fixture = phase7Fixture();
  const progressionPlan = buildGameProgressionPlan({
    scenarioId: fixture.evidenceSet.scenarioId,
    evidenceSetId: fixture.evidenceSet.evidenceSetId,
    attackGraphRef: fixture.evidenceSet.attackGraphRef,
    initialCourtEvidenceIds: ['evidence_technical_b'],
    initialCourtStatementIds: ['statement_seen_operation'],
    investigationEvidenceIds: ['evidence_technical_a', 'evidence_technical_b', 'evidence_testimony'],
    retrialStatementIds: ['statement_seen_operation', 'statement_checked_time'],
    returnToCourtCondition: 'ALL_REQUIRED_EVIDENCE_COLLECTED',
    objectionRules: [{ objectionRuleId: 'objection_seen_operation',
      targetStatementId: 'statement_seen_operation',
      acceptedEvidenceIds: ['evidence_technical_a'],
      contradictionRef: 'contradiction_seen_operation',
      exonerationRef: 'exoneration_defendant' }],
    retryPolicy: { maxCourtAttempts: 3, onFailure: 'RETURN_TO_INVESTIGATION',
      onLimitReached: 'BLOCKED' },
    publicMessages: {
      initialRuling: '現時点の証拠から被告人への疑いが残るため、追加調査を行います。',
      acquittalRuling: '被告人を無罪とします。',
      acquittalExplanation: '取得した記録により、検察側の人物断定を伴う主張は維持できません。',
      failureFeedback: 'この証拠では、この主張を崩せません。',
    },
  });
  const input = buildGameCaseConversionInput({ evidenceImportResult: fixture.evidenceImportResult,
    gameCaseHandoff: fixture.gameCaseHandoff, evidenceSet: fixture.evidenceSet,
    scenarioPackage: fixture.scenarioPackage, characters: fixture.scenarioPackage.characters,
    timeline: fixture.scenarioPackage.timeline, verificationResult: fixture.verificationResult,
    progressionPlan,
    contradictions: fixture.contradictions, exonerations: fixture.exonerations });
  return { fixture, progressionPlan, input };
}

function readyBundle() {
  const { fixture, progressionPlan, input } = conversionInput();
  return { fixture, progressionPlan, input, result: convertGameCase(input) };
}

function reseal(gameCase) {
  gameCase.fingerprint = digest(gameCaseCore(gameCase));
  gameCase.gameCaseId = `game_case_${gameCase.fingerprint.slice(0, 20)}`;
  return gameCase;
}

function resealPlanAndInput(input) {
  input.progressionPlan.fingerprint = digest(progressionPlanCore(input.progressionPlan));
  input.progressionPlan.planId = `progression_plan_${input.progressionPlan.fingerprint.slice(0, 20)}`;
  input.inputFingerprint = digest(conversionInputCore(input));
  input.conversionInputId = `game_case_input_${input.inputFingerprint.slice(0, 20)}`;
}

test('VALID Evidence SetからInternal/Public Game CaseをREADYで生成する', () => {
  const { input, result } = readyBundle();
  assert.equal(result.status, 'READY');
  assert.equal(result.ready, true);
  assert.equal(validateGameCaseConversionInput(input), input);
  assert.equal(validateGameCaseResult(result), result);
  assert.equal(validateGameCase(result.gameCase), result.gameCase);
  assert.equal(validatePublicGameCase(result.publicGameCase, input), result.publicGameCase);
  assert.equal(validateGameCaseBundle({ input, gameCase: result.gameCase,
    publicGameCase: result.publicGameCase }).gameCase, result.gameCase);
});

test('Game CaseはPhase 7 publicContentを改変せず全Artifactを保持する', () => {
  const { fixture, result } = readyBundle();
  assert.deepEqual(result.gameCase.detective.evidence.map(item => [item.evidenceId, item.publicContent]),
    fixture.evidenceSet.evidenceArtifacts.map(item => [item.evidenceId, item.publicContent]));
  assert.ok(result.gameCase.detective.evidence.every(item => item.availability === 'AVAILABLE'));
});

test('Public Game Caseからjudgment・provenance・技術参照を分離する', () => {
  const { result } = readyBundle();
  assert.ok(result.gameCase.judgment.judgmentRules.length >= 1);
  const text = JSON.stringify(result.publicGameCase);
  for (const value of ['judgment', 'provenance', 'sourceRefs', 'requirementIds',
    'groundTruthRefs', 'technicalAssessment', 'attackGraphRef', 'fingerprint']) {
    assert.ok(!text.includes(`"${value}"`));
  }
});

test('Scenario Characterを秘密role・binding・provenanceなしで公開投影する', () => {
  const { result } = readyBundle();
  const attacker = result.publicGameCase.characters.find(item => item.characterId === 'case_character_002');
  assert.equal(attacker.publicRole, 'PARTICIPANT');
  assert.equal(attacker.displayName, '関係者 002');
  assert.doesNotMatch(JSON.stringify(result.publicGameCase.characters),
    /attacker|攻撃者|bindingRefs|AI_GENERATED/);
});

test('TESTIMONYだけをCourtroom testimonyにし技術Evidenceだけを提示可能にする', () => {
  const { result } = readyBundle();
  assert.deepEqual(result.gameCase.courtroom.testimonies.map(item => item.testimonyEvidenceId),
    ['evidence_testimony']);
  assert.deepEqual(result.gameCase.courtroom.presentableEvidenceIds,
    ['evidence_technical_a', 'evidence_technical_b']);
});

test('Judgment ruleをContradictionとExonerationの共通根拠だけから構築する', () => {
  const { result } = readyBundle();
  const rule = result.gameCase.judgment.judgmentRules[0];
  assert.deepEqual(rule.acceptedEvidenceIds, ['evidence_technical_a']);
  assert.equal(rule.targetStatementId, 'statement_seen_operation');
  assert.equal(rule.contradictionRef, 'contradiction_seen_operation');
  assert.equal(rule.exonerationRef, 'exoneration_defendant');
  assert.equal(rule.matchMode, 'ANY_PRESENTED');
});

test('VALID以外のEvidence Import ResultをBLOCKEDにし部分成果物を返さない', () => {
  const { input } = conversionInput();
  input.evidenceImportResult.status = 'INVALID';
  input.evidenceImportResult.valid = false;
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.gameCase, null);
  assert.equal(result.publicGameCase, null);
  assert.equal(result.uiIntegrationHandoff, null);
});

test('Game Case Handoff改変を検出してBLOCKEDにする', () => {
  const { input } = conversionInput();
  input.gameCaseHandoff.evidenceSetFingerprint = '0'.repeat(64);
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.errors.some(item => item.code === 'GAME_CASE_HANDOFF_MISMATCH'));
});

test('Evidence SetまたはConversion Inputのfingerprint不一致をBLOCKEDにする', () => {
  for (const mutate of [
    input => { input.evidenceSet.fingerprint = '0'.repeat(64); },
    input => { input.inputFingerprint = '0'.repeat(64); },
  ]) {
    const { input } = conversionInput(); mutate(input);
    const result = convertGameCase(input);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.uiIntegrationHandoff, null);
  }
});

test('Scenario ID・Verification ID・Attack Graph不一致を拒否する', () => {
  for (const mutate of [
    input => { input.characters.scenarioId = 'scenario_other'; },
    input => { input.verificationResult.verificationId = 'verification_other'; },
    input => { input.timeline.attackGraphRef.graphId = 'graph_other'; },
  ]) {
    const { input } = conversionInput(); mutate(input);
    assert.equal(convertGameCase(input).status, 'BLOCKED');
  }
});

test('Phase 6 VERIFIED後のScenario Package改変を検出する', () => {
  const { input } = conversionInput();
  input.scenarioPackage.characters.characters[0].displayName = '改変名';
  input.characters = structuredClone(input.scenarioPackage.characters);
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.errors.some(item => item.code === 'SCENARIO_PACKAGE_MODIFIED'));
});

test('Character参照切れとTESTIMONY参照切れを拒否する', () => {
  for (const mutate of [
    input => { input.evidenceSet.evidenceArtifacts.find(item => item.type === 'TESTIMONY')
      .testimony.witnessCharacterId = 'character_missing'; },
    input => { input.contradictions[0].testimonyEvidenceId = 'evidence_missing'; },
  ]) {
    const { input } = conversionInput(); mutate(input);
    assert.equal(convertGameCase(input).status, 'BLOCKED');
  }
});

test('Evidence・statement・Contradiction・Exoneration参照切れを拒否する', () => {
  for (const mutate of [
    input => { input.contradictions[0].conflictingEvidenceIds = ['evidence_missing']; },
    input => { input.contradictions[0].statementRef = 'statement_missing'; },
    input => { input.contradictions[0].contradictionId = 'contradiction_missing'; },
    input => { input.exonerations[0].exonerationId = 'exoneration_missing'; },
  ]) {
    const { input } = conversionInput(); mutate(input);
    assert.equal(convertGameCase(input).status, 'BLOCKED');
  }
});

test('同じIDを使ったContradiction・Exoneration本体の差し替えを拒否する', () => {
  for (const mutate of [
    input => { input.contradictions[0].reason = '差し替えられた理由'; },
    input => { input.exonerations[0].reason = '差し替えられた理由'; },
  ]) {
    const { input } = conversionInput(); mutate(input);
    const result = convertGameCase(input);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.errors.some(item => ['CONTRADICTION_SET_MISMATCH',
      'EXONERATION_SET_MISMATCH'].includes(item.code)));
  }
});

test('statement IDの重複をGame Case Validationで拒否する', () => {
  const { input, result } = readyBundle();
  const testimony = result.gameCase.courtroom.testimonies[0];
  testimony.statements.push({ ...testimony.statements[0], displayOrder: 1 });
  reseal(result.gameCase);
  assert.throws(() => validateGameCaseBundle({ input, gameCase: result.gameCase,
    publicGameCase: projectPublicGameCase(result.gameCase) }), { code: 'DUPLICATE_ID' });
});

test('Judgment ruleのstatement・Evidence・Contradiction参照改変を拒否する', () => {
  for (const mutate of [
    rule => { rule.targetStatementId = 'statement_missing'; },
    rule => { rule.acceptedEvidenceIds = ['evidence_missing']; },
    rule => { rule.contradictionRef = 'contradiction_missing'; },
  ]) {
    const { input, result } = readyBundle(); mutate(result.gameCase.judgment.judgmentRules[0]);
    reseal(result.gameCase);
    assert.throws(() => validateGameCaseBundle({ input, gameCase: result.gameCase,
      publicGameCase: projectPublicGameCase(result.gameCase) }));
  }
});

test('取得・提示不能Evidenceを正解条件にできない', () => {
  const { input, result } = readyBundle();
  result.gameCase.courtroom.presentableEvidenceIds = ['evidence_technical_b'];
  reseal(result.gameCase);
  assert.throws(() => validateGameCaseBundle({ input, gameCase: result.gameCase,
    publicGameCase: projectPublicGameCase(result.gameCase) }), { code: 'RETRIAL_COURT_MISMATCH' });
});

test('Judgment ruleにGround Truth直接知識を追加できない', () => {
  const { result } = readyBundle();
  result.gameCase.judgment.judgmentRules[0].groundTruthRef = 'fact_private';
  assert.throws(() => validateGameCase(result.gameCase), { code: 'UNKNOWN_FIELD' });
});

test('Public Game CaseへのGround Truth・内部ID漏えいを検出する', () => {
  const { input, result } = readyBundle();
  for (const leaked of [input.scenarioPackage.groundTruth.groundTruthId,
    input.verificationResult.verificationId, input.evidenceSet.attackGraphRef.graphId]) {
    const publicCase = structuredClone(result.publicGameCase);
    publicCase.detective.evidence[0].publicContent += leaked;
    assert.throws(() => validatePublicGameCase(publicCase, input),
      { code: 'PUBLIC_GAME_CASE_INTERNAL_ID_LEAK' });
  }
});

test('Public Game Caseへのprovenance・judgment追加をSchemaで拒否する', () => {
  const { input, result } = readyBundle();
  for (const field of ['provenance', 'judgment']) {
    const publicCase = structuredClone(result.publicGameCase);
    publicCase[field] = {};
    assert.throws(() => validatePublicGameCase(publicCase, input), { code: 'UNKNOWN_FIELD' });
  }
});

test('別Scenarioまたは別graphの成果物を混入できない', () => {
  for (const mutate of [
    input => { input.evidenceSet.scenarioId = 'scenario_other'; },
    input => { input.gameCaseHandoff.attackGraphRef.graphId = 'graph_other'; },
  ]) {
    const { input } = conversionInput(); mutate(input);
    const result = convertGameCase(input);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.gameCase, null);
  }
});

test('通常プレイで公開statementと取得可能Evidenceから少なくとも1 ruleを満たせる', () => {
  const { result } = readyBundle();
  const statements = new Set(result.publicGameCase.courtroom.testimonies
    .flatMap(item => item.statements.map(statement => statement.statementId)));
  const available = new Set(result.publicGameCase.detective.evidence
    .filter(item => item.availability === 'AVAILABLE').map(item => item.evidenceId));
  assert.ok(result.gameCase.judgment.judgmentRules.some(rule => statements.has(rule.targetStatementId)
    && rule.acceptedEvidenceIds.some(id => available.has(id)
      && result.publicGameCase.courtroom.presentableEvidenceIds.includes(id))));
});

test('READYの場合だけ整合するUI Integration Handoffを生成する', () => {
  const { result } = readyBundle();
  assert.equal(result.uiIntegrationHandoff.state, 'GAME_CASE_READY');
  assert.equal(result.uiIntegrationHandoff.eligibleForUiIntegration, true);
  assert.equal(validateUiIntegrationHandoff(result.uiIntegrationHandoff,
    result.gameCase, result.publicGameCase), result.uiIntegrationHandoff);
  const changed = structuredClone(result.uiIntegrationHandoff);
  changed.publicGameCaseFingerprint = '0'.repeat(64);
  assert.throws(() => validateUiIntegrationHandoff(changed, result.gameCase, result.publicGameCase),
    { code: 'UI_INTEGRATION_HANDOFF_MISMATCH' });
});

test('固定の中立title/synopsis以外をConverterが新規生成しない', () => {
  const { result } = readyBundle();
  assert.equal(result.publicGameCase.title, 'セキュリティインシデント調査');
  assert.equal(result.publicGameCase.synopsis,
    '取得可能な証拠と証言を確認し、主張の矛盾を指摘してください。');
  assert.doesNotMatch(JSON.stringify(result.publicGameCase), /phishing|sql_injection|reflected_xss/);
});

test('Game Progression Planから逆転型State Machineを生成する', () => {
  const { progressionPlan, result } = readyBundle();
  assert.equal(validateGameProgressionPlan(progressionPlan), progressionPlan);
  assert.deepEqual(result.gameCase.progression.states, ['TITLE', 'INITIAL_COURT', 'INVESTIGATION',
    'RETRIAL_COURT', 'OBJECTION', 'ACQUITTED', 'GUILTY_RETRY', 'BLOCKED']);
  assert.deepEqual(result.gameCase.progression.transitions.map(item => [item.from, item.to]), [
    ['TITLE', 'INITIAL_COURT'], ['INITIAL_COURT', 'INVESTIGATION'],
    ['INVESTIGATION', 'RETRIAL_COURT'], ['RETRIAL_COURT', 'OBJECTION'],
    ['OBJECTION', 'ACQUITTED'], ['OBJECTION', 'GUILTY_RETRY'],
    ['GUILTY_RETRY', 'INVESTIGATION'], ['GUILTY_RETRY', 'BLOCKED'],
  ]);
});

test('Initial Courtは明示IDだけを配置し人物断定をALLEGATION_ONLYとして保持する', () => {
  const { result } = readyBundle();
  const court = result.gameCase.progression.initialCourt;
  assert.deepEqual(court.presentedEvidenceIds, ['evidence_technical_b']);
  assert.deepEqual(court.prosecutionStatements.map(item => item.statementId),
    ['statement_seen_operation']);
  assert.equal(court.attributionStatus, 'ALLEGATION_ONLY');
  assert.equal(court.nextState, 'INVESTIGATION');
});

test('Initial Court Evidence参照切れをBLOCKEDにする', () => {
  const { input } = conversionInput();
  input.progressionPlan.initialCourtEvidenceIds = ['evidence_missing'];
  resealPlanAndInput(input);
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.errors.some(item => item.code === 'BROKEN_EVIDENCE_REFERENCE'));
});

test('Investigation Evidence参照切れをBLOCKEDにする', () => {
  const { input } = conversionInput();
  input.progressionPlan.investigationEvidenceIds.push('evidence_missing');
  resealPlanAndInput(input);
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.errors.some(item => item.code === 'BROKEN_EVIDENCE_REFERENCE'));
});

test('Retrial statement参照切れをBLOCKEDにする', () => {
  const { input } = conversionInput();
  input.progressionPlan.retrialStatementIds = ['statement_missing'];
  resealPlanAndInput(input);
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.errors.some(item => item.code === 'BROKEN_STATEMENT_REFERENCE'));
});

test('正解EvidenceがInvestigationで取得不能ならBLOCKEDにする', () => {
  const { input } = conversionInput();
  input.progressionPlan.investigationEvidenceIds = ['evidence_technical_b', 'evidence_testimony'];
  resealPlanAndInput(input);
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.errors.some(item => item.code === 'UNOBTAINABLE_JUDGMENT_EVIDENCE'));
});

test('正解EvidenceがRetrialで提示不能ならGame Caseを拒否する', () => {
  const { input, result } = readyBundle();
  result.gameCase.courtroom.presentableEvidenceIds = ['evidence_technical_b'];
  result.gameCase.progression.retrialCourt.presentableEvidenceIds = ['evidence_technical_b'];
  reseal(result.gameCase);
  assert.throws(() => validateGameCaseBundle({ input, gameCase: result.gameCase,
    publicGameCase: projectPublicGameCase(result.gameCase) }));
});

test('OBJECTIONはstatementIdとevidenceIdの正しい組合せだけを成功にする', () => {
  const { result } = readyBundle();
  const success = evaluateObjection(result.gameCase, { statementId: 'statement_seen_operation',
    evidenceId: 'evidence_technical_a', attemptCount: 0 });
  const wrongStatement = evaluateObjection(result.gameCase, { statementId: 'statement_checked_time',
    evidenceId: 'evidence_technical_a', attemptCount: 0 });
  const wrongEvidence = evaluateObjection(result.gameCase, { statementId: 'statement_seen_operation',
    evidenceId: 'evidence_technical_b', attemptCount: 0 });
  assert.deepEqual([success.outcome, success.nextState], ['SUCCESS', 'ACQUITTED']);
  assert.deepEqual([wrongStatement.outcome, wrongStatement.nextState], ['FAILURE', 'INVESTIGATION']);
  assert.deepEqual([wrongEvidence.outcome, wrongEvidence.nextState], ['FAILURE', 'INVESTIGATION']);
});

test('失敗はGUILTY_RETRYを経てInvestigationへ戻り上限到達時だけBLOCKEDになる', () => {
  const { result } = readyBundle();
  const retry = evaluateObjection(result.gameCase, { statementId: 'statement_checked_time',
    evidenceId: 'evidence_technical_b', attemptCount: 0 });
  const limit = evaluateObjection(result.gameCase, { statementId: 'statement_checked_time',
    evidenceId: 'evidence_technical_b', attemptCount: 2 });
  assert.equal(retry.state, 'GUILTY_RETRY');
  assert.equal(retry.nextState, 'INVESTIGATION');
  assert.equal(retry.previouslyPresentedStatementId, 'statement_checked_time');
  assert.equal(retry.previouslyPresentedEvidenceId, 'evidence_technical_b');
  assert.equal(limit.state, 'GUILTY_RETRY');
  assert.equal(limit.nextState, 'BLOCKED');
  assert.equal(retry.publicFailureFeedback, 'この証拠では、この主張を崩せません。');
});

test('retry loopの行き止まりとACQUITTED到達不能な遷移を拒否する', () => {
  for (const mutate of [
    progression => { progression.transitions.find(item => item.event === 'RETURN_TO_INVESTIGATION').to = 'BLOCKED'; },
    progression => { progression.transitions.find(item => item.event === 'SUCCESS').to = 'BLOCKED'; },
  ]) {
    const { result } = readyBundle();
    mutate(result.gameCase.progression);
    reseal(result.gameCase);
    assert.throws(() => validateGameCase(result.gameCase), { code: 'INVALID_PROGRESSION_STATE_MACHINE' });
  }
});

test('Public Game CaseはJudgment・requiredForCourtIds・retryPolicyを公開しない', () => {
  const { result } = readyBundle();
  const text = JSON.stringify(result.publicGameCase);
  for (const field of ['judgment', 'acceptedEvidenceIds', 'requiredForCourtIds', 'retryPolicy',
    'contradictionRef', 'exonerationRef']) assert.ok(!text.includes(`"${field}"`));
  assert.ok(text.includes('statement_seen_operation'));
  assert.ok(text.includes('evidence_technical_a'));
});

test('Initial Courtの公開構造へGround Truthや人物確定情報を追加できない', () => {
  const { result } = readyBundle();
  const publicCase = structuredClone(result.publicGameCase);
  publicCase.progression.initialCourt.groundTruthRefs = ['fact_private'];
  assert.throws(() => validatePublicGameCase(publicCase), { code: 'UNKNOWN_FIELD' });
  const internal = structuredClone(result.gameCase);
  internal.progression.initialCourt.attributionStatus = 'CONFIRMED_ACTOR';
  assert.throws(() => validateGameCase(internal), { code: 'UNSUPPORTED_VERSION' });
});

test('Progression変換でもPhase 7 Evidence publicContentを改変しない', () => {
  const { fixture, result } = readyBundle();
  const originals = new Map(fixture.evidenceSet.evidenceArtifacts
    .map(item => [item.evidenceId, item.publicContent]));
  for (const item of result.publicGameCase.detective.evidence) {
    assert.equal(item.publicContent, originals.get(item.evidenceId));
  }
});

test('Game Progression Plan改変と上流fingerprint不一致を検出する', () => {
  const { input } = conversionInput();
  input.progressionPlan.publicMessages.failureFeedback = '改変';
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.errors.some(item => item.code === 'PROGRESSION_PLAN_FINGERPRINT_MISMATCH'));
});

test('UI Integration HandoffへprogressionFingerprintを含め改変を拒否する', () => {
  const { result } = readyBundle();
  assert.equal(result.uiIntegrationHandoff.progressionFingerprint,
    digest(result.gameCase.progression));
  const changed = structuredClone(result.uiIntegrationHandoff);
  changed.progressionFingerprint = '0'.repeat(64);
  assert.throws(() => validateUiIntegrationHandoff(changed, result.gameCase,
    result.publicGameCase), { code: 'UI_INTEGRATION_HANDOFF_MISMATCH' });
});

test('Progression validation失敗ではUI Integration Handoffを生成しない', () => {
  const { input } = conversionInput();
  input.progressionPlan.retryPolicy.maxCourtAttempts = 0;
  resealPlanAndInput(input);
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.uiIntegrationHandoff, null);
});

test('失敗Feedbackへ正解statement・Evidence IDを直接含められない', () => {
  const { input } = conversionInput();
  input.progressionPlan.publicMessages.failureFeedback =
    'evidence_technical_aが正解です。';
  resealPlanAndInput(input);
  const result = convertGameCase(input);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.errors.some(item => item.code === 'FAILURE_FEEDBACK_LEAKS_ANSWER'));
});
