import { digest, sameValues, validateEvidenceImportResult, validateEvidenceSet,
  validateGameCaseHandoff } from './evidence-validator.js';
import { validateScenarioVerificationResult } from './scenario-verifier.js';
import { fail, validateDocument } from './schema.js';

export const GAME_CASE_TITLE = 'セキュリティインシデント調査';
export const GAME_CASE_SYNOPSIS = '取得可能な証拠と証言を確認し、主張の矛盾を指摘してください。';

export const PROGRESSION_STATES = ['TITLE', 'INITIAL_COURT', 'INVESTIGATION',
  'RETRIAL_COURT', 'OBJECTION', 'ACQUITTED', 'GUILTY_RETRY', 'BLOCKED'];
export const PROGRESSION_TRANSITIONS = [
  { from: 'TITLE', event: 'START', to: 'INITIAL_COURT' },
  { from: 'INITIAL_COURT', event: 'INITIAL_RULING', to: 'INVESTIGATION' },
  { from: 'INVESTIGATION', event: 'RETURN_TO_COURT_CONDITION_MET', to: 'RETRIAL_COURT' },
  { from: 'RETRIAL_COURT', event: 'SELECT_OBJECTION', to: 'OBJECTION' },
  { from: 'OBJECTION', event: 'SUCCESS', to: 'ACQUITTED' },
  { from: 'OBJECTION', event: 'FAILURE', to: 'GUILTY_RETRY' },
  { from: 'GUILTY_RETRY', event: 'RETURN_TO_INVESTIGATION', to: 'INVESTIGATION' },
  { from: 'GUILTY_RETRY', event: 'LIMIT_REACHED', to: 'BLOCKED' },
];

function unique(items, key, field) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) fail('DUPLICATE_ID', field, '識別子または参照が重複しています。');
    seen.add(value);
  }
}

const sorted = values => [...values].sort();

function graphRefs(input) {
  return [input.evidenceSet.attackGraphRef, input.gameCaseHandoff.attackGraphRef,
    input.verificationResult.attackGraphRef, input.scenarioPackage.scenarioDraft.attackGraphRef,
    input.characters.attackGraphRef, input.timeline.attackGraphRef, input.progressionPlan.attackGraphRef];
}

export function progressionPlanCore(plan) {
  return { scenarioId: plan.scenarioId, evidenceSetId: plan.evidenceSetId,
    attackGraphRef: plan.attackGraphRef,
    initialCourtEvidenceIds: plan.initialCourtEvidenceIds,
    initialCourtStatementIds: plan.initialCourtStatementIds,
    investigationEvidenceIds: plan.investigationEvidenceIds,
    retrialStatementIds: plan.retrialStatementIds,
    returnToCourtCondition: plan.returnToCourtCondition,
    objectionRules: plan.objectionRules, retryPolicy: plan.retryPolicy,
    publicMessages: plan.publicMessages };
}

export function validateGameProgressionPlan(plan) {
  validateDocument('game-progression-plan', plan);
  for (const [field, values] of [['initialCourtEvidenceIds', plan.initialCourtEvidenceIds],
    ['initialCourtStatementIds', plan.initialCourtStatementIds],
    ['investigationEvidenceIds', plan.investigationEvidenceIds],
    ['retrialStatementIds', plan.retrialStatementIds]]) {
    unique(values, value => value, `game-progression-plan.${field}`);
  }
  unique(plan.objectionRules, item => item.objectionRuleId,
    'game-progression-plan.objectionRules.objectionRuleId');
  for (const rule of plan.objectionRules) unique(rule.acceptedEvidenceIds, value => value,
    `game-progression-plan.objectionRules.${rule.objectionRuleId}.acceptedEvidenceIds`);
  if (!Number.isSafeInteger(plan.retryPolicy.maxCourtAttempts)
    || plan.retryPolicy.maxCourtAttempts < 1) {
    fail('INVALID_RETRY_LIMIT', 'game-progression-plan.retryPolicy.maxCourtAttempts',
      'maxCourtAttemptsは1以上の安全な整数として明示する必要があります。');
  }
  const expected = digest(progressionPlanCore(plan));
  if (plan.fingerprint !== expected
    || plan.planId !== `progression_plan_${expected.slice(0, 20)}`) {
    fail('PROGRESSION_PLAN_FINGERPRINT_MISMATCH', 'game-progression-plan.fingerprint',
      'Game Progression Planの内容、ID、fingerprintが一致しません。');
  }
  return plan;
}

export function conversionInputCore(input) {
  return {
    evidenceImportResult: input.evidenceImportResult, gameCaseHandoff: input.gameCaseHandoff,
    evidenceSet: input.evidenceSet, scenarioPackage: input.scenarioPackage,
    characters: input.characters, timeline: input.timeline,
    verificationResult: input.verificationResult, progressionPlan: input.progressionPlan,
    contradictions: input.contradictions, exonerations: input.exonerations,
  };
}

function sourceMaps(input) {
  const artifacts = new Map(input.evidenceSet.evidenceArtifacts.map(item => [item.evidenceId, item]));
  const statements = new Map();
  for (const artifact of artifacts.values()) {
    if (artifact.type !== 'TESTIMONY') continue;
    for (const statement of artifact.testimony.statements) statements.set(statement.statementId,
      { artifact, statement, witnessCharacterId: artifact.testimony.witnessCharacterId });
  }
  return { artifacts, statements,
    contradictions: new Map(input.contradictions.map(item => [item.contradictionId, item])),
    exonerations: new Map(input.exonerations.map(item => [item.exonerationId, item])) };
}

function validateProgressionPlanReferences(input) {
  const plan = input.progressionPlan;
  const { artifacts, statements, contradictions, exonerations } = sourceMaps(input);
  if (plan.scenarioId !== input.evidenceSet.scenarioId
    || plan.evidenceSetId !== input.evidenceSet.evidenceSetId
    || !sameValues(plan.attackGraphRef, input.evidenceSet.attackGraphRef)) {
    fail('PROGRESSION_PLAN_SOURCE_MISMATCH', 'game-case-conversion-input.progressionPlan',
      'Game Progression Planが同じScenario、Evidence Set、Attack Graphを参照していません。');
  }
  for (const [field, ids] of [['initialCourtEvidenceIds', plan.initialCourtEvidenceIds],
    ['investigationEvidenceIds', plan.investigationEvidenceIds]]) {
    if (ids.some(id => !artifacts.has(id))) fail('BROKEN_EVIDENCE_REFERENCE',
      `game-progression-plan.${field}`, 'Game Progression Planが存在しないEvidenceを参照しています。');
  }
  if (plan.investigationEvidenceIds.some(id => artifacts.get(id).visibility !== 'PLAYER_OBTAINABLE')) {
    fail('UNOBTAINABLE_INVESTIGATION_EVIDENCE', 'game-progression-plan.investigationEvidenceIds',
      'InvestigationにはPLAYER_OBTAINABLEなEvidenceだけを配置できます。');
  }
  for (const [field, ids] of [['initialCourtStatementIds', plan.initialCourtStatementIds],
    ['retrialStatementIds', plan.retrialStatementIds]]) {
    if (ids.some(id => !statements.has(id))) fail('BROKEN_STATEMENT_REFERENCE',
      `game-progression-plan.${field}`, 'Game Progression Planが存在しないTESTIMONY statementを参照しています。');
  }
  const retrial = new Set(plan.retrialStatementIds);
  const investigation = new Set(plan.investigationEvidenceIds);
  if (plan.initialCourtEvidenceIds.some(id => !investigation.has(id))) {
    fail('INITIAL_COURT_EVIDENCE_NOT_INVESTIGABLE',
      'game-progression-plan.initialCourtEvidenceIds',
      'Initial Court Evidenceは公開本文を保持し、Investigationで再調査可能である必要があります。');
  }
  for (const rule of plan.objectionRules) {
    const contradiction = contradictions.get(rule.contradictionRef);
    const exoneration = exonerations.get(rule.exonerationRef);
    if (!retrial.has(rule.targetStatementId) || !statements.has(rule.targetStatementId)) {
      fail('OBJECTION_STATEMENT_NOT_RETRIABLE',
        `game-progression-plan.objectionRules.${rule.objectionRuleId}.targetStatementId`,
        'Objection対象statementがRetrial Courtへ配置されていません。');
    }
    if (!contradiction || contradiction.statementRef !== rule.targetStatementId) {
      fail('BROKEN_CONTRADICTION_REFERENCE',
        `game-progression-plan.objectionRules.${rule.objectionRuleId}.contradictionRef`,
        'Objection ruleが対象statementのContradictionを参照していません。');
    }
    if (!exoneration) fail('BROKEN_EXONERATION_REFERENCE',
      `game-progression-plan.objectionRules.${rule.objectionRuleId}.exonerationRef`,
      'Objection ruleが存在するExonerationを参照していません。');
    if (!sameValues(sorted(rule.acceptedEvidenceIds), sorted(contradiction.conflictingEvidenceIds))
      || rule.acceptedEvidenceIds.some(id => !exoneration.supportingEvidenceIds.includes(id))) {
      fail('OBJECTION_RULE_SOURCE_MISMATCH',
        `game-progression-plan.objectionRules.${rule.objectionRuleId}`,
        'Objection ruleがContradictionとExonerationの既存参照だけから再現できません。');
    }
    for (const id of rule.acceptedEvidenceIds) {
      const artifact = artifacts.get(id);
      if (!artifact || artifact.type === 'TESTIMONY' || !investigation.has(id)
        || artifact.visibility !== 'PLAYER_OBTAINABLE') {
        fail('UNOBTAINABLE_JUDGMENT_EVIDENCE',
          `game-progression-plan.objectionRules.${rule.objectionRuleId}.acceptedEvidenceIds`,
          '正解EvidenceがInvestigationで取得可能な技術Evidenceではありません。');
      }
      if (!artifact.purpose.includes('CONTRADICTION_PROOF')) fail('UNSUPPORTED_JUDGMENT_EVIDENCE',
        `game-progression-plan.objectionRules.${rule.objectionRuleId}.acceptedEvidenceIds`,
        '正解EvidenceがVERIFIED CONTRADICTION_PROOFに対応していません。');
    }
  }
  const feedback = plan.publicMessages.failureFeedback;
  const answerIds = plan.objectionRules.flatMap(rule =>
    [rule.targetStatementId, ...rule.acceptedEvidenceIds]);
  if (answerIds.some(id => feedback.includes(id))) {
    fail('FAILURE_FEEDBACK_LEAKS_ANSWER', 'game-progression-plan.publicMessages.failureFeedback',
      '失敗Feedbackに正解statementまたはEvidence IDを含めることはできません。');
  }
}

export function validateGameCaseConversionInput(input) {
  validateDocument('game-case-conversion-input', input);
  validateEvidenceImportResult(input.evidenceImportResult);
  validateEvidenceSet(input.evidenceSet);
  validateGameCaseHandoff(input.gameCaseHandoff, input.evidenceSet);
  validateScenarioVerificationResult(input.verificationResult);
  validateDocument('scenario-import-package', input.scenarioPackage);
  validateDocument('character', input.characters);
  validateDocument('timeline', input.timeline);
  validateGameProgressionPlan(input.progressionPlan);
  input.contradictions.forEach(item => validateDocument('contradiction', item));
  input.exonerations.forEach(item => validateDocument('exoneration', item));
  if (input.evidenceImportResult.status !== 'VALID' || !input.evidenceImportResult.valid
    || !input.evidenceImportResult.evidenceSet || !input.evidenceImportResult.gameCaseHandoff) {
    fail('EVIDENCE_SET_NOT_VALID', 'game-case-conversion-input.evidenceImportResult.status',
      'VALIDなEvidence Import ResultだけをGame Caseへ変換できます。');
  }
  if (!sameValues(input.evidenceSet, input.evidenceImportResult.evidenceSet)) fail('EVIDENCE_SET_MISMATCH',
    'game-case-conversion-input.evidenceSet', 'Evidence SetがVALID Evidence Import Resultの正本と一致しません。');
  if (!sameValues(input.gameCaseHandoff, input.evidenceImportResult.gameCaseHandoff)) fail('GAME_CASE_HANDOFF_MISMATCH',
    'game-case-conversion-input.gameCaseHandoff', 'Game Case HandoffがVALID Evidence Import ResultのHandoffと一致しません。');
  if (input.verificationResult.status !== 'VERIFIED' || input.verificationResult.issues.length
    || !input.verificationResult.evidenceAgentHandoff) fail('SCENARIO_NOT_VERIFIED',
    'game-case-conversion-input.verificationResult.status', '未解決issueのないVERIFIED Scenarioだけを変換できます。');
  const draft = input.scenarioPackage.scenarioDraft;
  if (!sameValues(input.characters, input.scenarioPackage.characters)
    || !sameValues(input.timeline, input.scenarioPackage.timeline)) fail('SCENARIO_ARTIFACT_MISMATCH',
    'game-case-conversion-input.scenarioPackage', 'CharactersまたはTimelineがVERIFIED Scenario Packageと一致しません。');
  if (input.verificationResult.evidenceAgentHandoff.scenarioPackageFingerprint !== digest(input.scenarioPackage)) {
    fail('SCENARIO_PACKAGE_MODIFIED', 'game-case-conversion-input.scenarioPackage',
      'Phase 6 VERIFIED後にScenario Packageが変更されています。');
  }
  const scenarioIds = [input.evidenceSet.scenarioId, input.gameCaseHandoff.scenarioId,
    input.verificationResult.scenarioId, draft.scenarioId, input.characters.scenarioId,
    input.timeline.scenarioId, input.progressionPlan.scenarioId];
  if (scenarioIds.some(value => value !== draft.scenarioId)) fail('SCENARIO_ID_MISMATCH',
    'game-case-conversion-input', 'Evidence、Handoff、Verification、Scenario、ProgressionのscenarioIdが一致しません。');
  const verificationIds = [input.evidenceSet.verificationId, input.gameCaseHandoff.verificationId,
    input.verificationResult.verificationId];
  if (verificationIds.some(value => value !== input.verificationResult.verificationId)) fail('VERIFICATION_ID_MISMATCH',
    'game-case-conversion-input', 'Evidence Set、Handoff、Verification ResultのverificationIdが一致しません。');
  if (graphRefs(input).some(ref => !sameValues(ref, draft.attackGraphRef))) fail('ATTACK_GRAPH_REFERENCE_MISMATCH',
    'game-case-conversion-input', 'Evidence、Handoff、Verification、Scenario、ProgressionのAttack Graph参照が一致しません。');
  const { artifacts } = sourceMaps(input);
  const facts = new Set(input.scenarioPackage.groundTruth.technicalFacts.map(item => item.factId));
  const events = new Set(input.timeline.events.map(item => item.eventId));
  const characters = new Map(input.characters.characters.map(item => [item.characterId, item]));
  for (const artifact of artifacts.values()) {
    for (const ref of artifact.sourceRefs) {
      if (ref.sourceType === 'GROUND_TRUTH_FACT' && !facts.has(ref.sourceId)) fail('BROKEN_GROUND_TRUTH_REFERENCE',
        `evidenceSet.${artifact.evidenceId}.sourceRefs`, 'EvidenceのGround Truth参照が存在しません。');
      if (ref.sourceType === 'TIMELINE_EVENT' && !events.has(ref.sourceId)) fail('BROKEN_TIMELINE_REFERENCE',
        `evidenceSet.${artifact.evidenceId}.sourceRefs`, 'EvidenceのTimeline参照が存在しません。');
      if (ref.sourceType === 'CHARACTER' && !characters.has(ref.sourceId)) fail('BROKEN_CHARACTER_REFERENCE',
        `evidenceSet.${artifact.evidenceId}.sourceRefs`, 'EvidenceのCharacter参照が存在しません。');
    }
    if (artifact.type === 'TESTIMONY' && !characters.has(artifact.testimony?.witnessCharacterId)) {
      fail('BROKEN_CHARACTER_REFERENCE', `evidenceSet.${artifact.evidenceId}.testimony`,
        'TESTIMONYの証言者がScenario Charactersに存在しません。');
    }
  }
  unique(input.contradictions, item => item.contradictionId, 'contradictions.contradictionId');
  unique(input.exonerations, item => item.exonerationId, 'exonerations.exonerationId');
  if (!sameValues(input.contradictions, input.evidenceSet.contradictions)
    || !sameValues(sorted(input.contradictions.map(item => item.contradictionId)), sorted(input.evidenceSet.contradictionRefs))) {
    fail('CONTRADICTION_SET_MISMATCH', 'game-case-conversion-input.contradictions',
      'ContradictionがVALID Evidence Setの正本と一致しません。');
  }
  if (!sameValues(input.exonerations, input.evidenceSet.exonerations)
    || !sameValues(sorted(input.exonerations.map(item => item.exonerationId)), sorted(input.evidenceSet.exonerationRefs))) {
    fail('EXONERATION_SET_MISMATCH', 'game-case-conversion-input.exonerations',
      'ExonerationがVALID Evidence Setの正本と一致しません。');
  }
  for (const contradiction of input.contradictions) {
    const testimony = artifacts.get(contradiction.testimonyEvidenceId);
    const statement = testimony?.testimony?.statements.find(item => item.statementId === contradiction.statementRef);
    if (testimony?.type !== 'TESTIMONY' || !statement || statement.technicalAssessment !== 'CONTRADICTED') {
      fail('BROKEN_CONTRADICTION_REFERENCE', `contradictions.${contradiction.contradictionId}`,
        'Contradictionが有効なTESTIMONY statementを参照していません。');
    }
    if (contradiction.conflictingEvidenceIds.some(id => !artifacts.has(id) || artifacts.get(id).type === 'TESTIMONY')) {
      fail('BROKEN_EVIDENCE_REFERENCE', `contradictions.${contradiction.contradictionId}`,
        'Contradictionの競合Evidenceが有効な技術Evidenceではありません。');
    }
    if (contradiction.groundTruthRefs.some(id => !facts.has(id))) fail('BROKEN_GROUND_TRUTH_REFERENCE',
      `contradictions.${contradiction.contradictionId}`, 'ContradictionのGround Truth参照が存在しません。');
  }
  for (const exoneration of input.exonerations) {
    const defendant = characters.get(exoneration.defendantCharacterId);
    if (!defendant?.roles.includes('defendant')) fail('BROKEN_EXONERATION_REFERENCE',
      `exonerations.${exoneration.exonerationId}.defendantCharacterId`,
      'Exonerationがdefendant役のCharacterを参照していません。');
    if (new Set(exoneration.supportingEvidenceIds).size < 2
      || exoneration.supportingEvidenceIds.some(id => !artifacts.has(id))) fail('INSUFFICIENT_EXONERATION_SUPPORT',
      `exonerations.${exoneration.exonerationId}`, 'Exonerationが異なるEvidenceを2件以上参照していません。');
    if (exoneration.groundTruthRefs.some(id => !facts.has(id))) fail('BROKEN_GROUND_TRUTH_REFERENCE',
      `exonerations.${exoneration.exonerationId}`, 'ExonerationのGround Truth参照が存在しません。');
  }
  if (input.gameCaseHandoff.state !== 'EVIDENCE_READY'
    || !input.gameCaseHandoff.eligibleForGameCaseGeneration) fail('GAME_CASE_HANDOFF_NOT_READY',
    'game-case-conversion-input.gameCaseHandoff.state', 'EVIDENCE_READYなHandoffだけを変換できます。');
  validateProgressionPlanReferences(input);
  const expectedFingerprint = digest(conversionInputCore(input));
  if (input.inputFingerprint !== expectedFingerprint
    || input.conversionInputId !== `game_case_input_${expectedFingerprint.slice(0, 20)}`) {
    fail('CONVERSION_INPUT_FINGERPRINT_MISMATCH', 'game-case-conversion-input.inputFingerprint',
      'Conversion Inputの内容、ID、fingerprintが一致しません。');
  }
  return input;
}

export function projectCharacter(character, testimonySpeakerIds, publicCharacterId) {
  let publicRole = 'PARTICIPANT';
  let publicDescription = '事件の関係者。';
  let displayName = character.displayName;
  if (character.roles.includes('defendant')) {
    publicRole = 'DEFENDANT'; publicDescription = '攻撃実行を疑われている被告人。';
  } else if (testimonySpeakerIds.has(character.characterId) || character.roles.includes('witness')) {
    publicRole = 'WITNESS'; publicDescription = '法廷で証言する事件関係者。';
  }
  if (character.roles.includes('attacker')) {
    displayName = `関係者 ${publicCharacterId.slice(-3)}`;
    publicRole = 'PARTICIPANT'; publicDescription = '事件の関係者。';
  }
  return { characterId: publicCharacterId, displayName, publicRole, publicDescription };
}

export function deriveJudgmentRules(input) {
  return input.progressionPlan.objectionRules.map(rule => {
    const seed = [rule.contradictionRef, rule.exonerationRef];
    return { ruleId: `judgment_rule_${digest(seed).slice(0, 20)}`,
      targetStatementId: rule.targetStatementId,
      acceptedEvidenceIds: sorted(rule.acceptedEvidenceIds), matchMode: 'ANY_PRESENTED',
      contradictionRef: rule.contradictionRef, exonerationRef: rule.exonerationRef,
      successOutcome: 'CONTRADICTION_ESTABLISHED', failureOutcome: 'CONTRADICTION_NOT_ESTABLISHED' };
  }).sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

function publicIds(input) {
  return new Map(input.characters.characters
    .map((item, index) => [item.characterId, `case_character_${String(index + 1).padStart(3, '0')}`]));
}

function projectTestimonies(input, selectedStatementIds, ids) {
  const selected = new Set(selectedStatementIds);
  return input.evidenceSet.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')
    .map(item => ({ item, statements: item.testimony.statements.filter(statement => selected.has(statement.statementId)) }))
    .filter(({ statements }) => statements.length)
    .map(({ item, statements }, displayOrder) => ({ testimonyEvidenceId: item.evidenceId,
      speakerCharacterId: ids.get(item.testimony.witnessCharacterId),
      statements: statements.map((statement, statementOrder) => ({ statementId: statement.statementId,
        spokenContent: statement.spokenContent, displayOrder: statementOrder })), displayOrder }));
}

export function deriveGameCaseParts(input) {
  const artifacts = new Map(input.evidenceSet.evidenceArtifacts.map(item => [item.evidenceId, item]));
  const ids = publicIds(input);
  const testimonySpeakerIds = new Set(input.evidenceSet.evidenceArtifacts
    .filter(item => item.type === 'TESTIMONY').map(item => item.testimony.witnessCharacterId));
  const characters = input.characters.characters.map(item =>
    projectCharacter(item, testimonySpeakerIds, ids.get(item.characterId)));
  const evidence = input.progressionPlan.investigationEvidenceIds.map((id, displayOrder) => {
    const item = artifacts.get(id);
    return { evidenceId: item.evidenceId, title: item.title, type: item.type,
      publicContent: item.publicContent, availability: 'AVAILABLE', displayOrder };
  });
  const testimonies = projectTestimonies(input, input.progressionPlan.retrialStatementIds, ids);
  const presentableEvidenceIds = input.progressionPlan.investigationEvidenceIds
    .filter(id => artifacts.get(id).type !== 'TESTIMONY');
  const allStatements = new Map();
  for (const artifact of input.evidenceSet.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')) {
    for (const statement of artifact.testimony.statements) allStatements.set(statement.statementId,
      { statement, speakerCharacterId: ids.get(artifact.testimony.witnessCharacterId) });
  }
  const prosecutionStatements = input.progressionPlan.initialCourtStatementIds.map((id, displayOrder) => {
    const value = allStatements.get(id);
    return { statementId: id, speakerCharacterId: value.speakerCharacterId,
      spokenContent: value.statement.spokenContent, displayOrder };
  });
  const judgmentRules = deriveJudgmentRules(input);
  const progression = { schemaVersion: '1.0', initialState: 'TITLE',
    states: [...PROGRESSION_STATES], transitions: structuredClone(PROGRESSION_TRANSITIONS),
    initialCourt: { prosecutionStatements,
      presentedEvidenceIds: [...input.progressionPlan.initialCourtEvidenceIds],
      speakerCharacterIds: [...new Set(prosecutionStatements.map(item => item.speakerCharacterId))],
      publicRuling: input.progressionPlan.publicMessages.initialRuling,
      attributionStatus: 'ALLEGATION_ONLY', nextState: 'INVESTIGATION' },
    investigation: { availableEvidenceIds: [...input.progressionPlan.investigationEvidenceIds],
      collectedEvidenceIds: [],
      requiredForCourtIds: [...new Set(judgmentRules.flatMap(item => item.acceptedEvidenceIds))],
      returnToCourtCondition: input.progressionPlan.returnToCourtCondition },
    retrialCourt: { testimonies: structuredClone(testimonies),
      presentableEvidenceIds: [...presentableEvidenceIds] },
    objection: { action: 'OBJECTION', requiredInputs: ['statementId', 'evidenceId'],
      successState: 'ACQUITTED', failureState: 'GUILTY_RETRY' },
    retryState: { previouslyPresentedStatementId: null, previouslyPresentedEvidenceId: null,
      attemptCount: 0, publicFailureFeedback: input.progressionPlan.publicMessages.failureFeedback,
      nextState: 'INVESTIGATION' },
    retryPolicy: structuredClone(input.progressionPlan.retryPolicy),
    outcomes: { acquitted: { state: 'ACQUITTED',
      publicRuling: input.progressionPlan.publicMessages.acquittalRuling,
      publicExplanation: input.progressionPlan.publicMessages.acquittalExplanation },
    guiltyRetry: { state: 'GUILTY_RETRY',
      publicRuling: input.progressionPlan.publicMessages.failureFeedback,
      nextState: 'INVESTIGATION' } } };
  return { characters, detective: { evidence }, courtroom: { testimonies, presentableEvidenceIds },
    progression, judgment: { judgmentRules } };
}

export function gameCaseCore(gameCase) {
  return { scenarioId: gameCase.scenarioId, verificationId: gameCase.verificationId,
    evidenceSetId: gameCase.evidenceSetId, attackGraphRef: gameCase.attackGraphRef,
    title: gameCase.title, synopsis: gameCase.synopsis, characters: gameCase.characters,
    detective: gameCase.detective, courtroom: gameCase.courtroom,
    progression: gameCase.progression, judgment: gameCase.judgment,
    provenance: gameCase.provenance };
}

function projectPublicProgression(progression) {
  return { schemaVersion: '1.0', initialState: progression.initialState,
    initialCourt: structuredClone(progression.initialCourt),
    investigation: { availableEvidenceIds: [...progression.investigation.availableEvidenceIds],
      returnToCourtCondition: progression.investigation.returnToCourtCondition },
    retrialCourt: structuredClone(progression.retrialCourt),
    objection: { action: progression.objection.action,
      requiredInputs: [...progression.objection.requiredInputs] },
    retry: { state: 'GUILTY_RETRY', nextState: 'INVESTIGATION',
      publicFailureFeedback: progression.retryState.publicFailureFeedback },
    outcomes: { acquitted: structuredClone(progression.outcomes.acquitted) } };
}

export function projectPublicGameCase(gameCase) {
  return { schemaVersion: '1.0', gameCaseId: gameCase.gameCaseId, title: gameCase.title,
    synopsis: gameCase.synopsis, characters: structuredClone(gameCase.characters),
    detective: structuredClone(gameCase.detective), courtroom: structuredClone(gameCase.courtroom),
    progression: projectPublicProgression(gameCase.progression) };
}

function validateDisplayOrder(items, field) {
  items.forEach((item, index) => {
    if (!Number.isSafeInteger(item.displayOrder) || item.displayOrder !== index) {
      fail('INVALID_DISPLAY_ORDER', field, 'displayOrderは0から始まる一意な表示順である必要があります。');
    }
  });
}

export function validateGameCase(gameCase) {
  validateDocument('game-case', gameCase);
  validateDocument('game-progression', gameCase.progression);
  unique(gameCase.characters, item => item.characterId, 'game-case.characters.characterId');
  unique(gameCase.detective.evidence, item => item.evidenceId, 'game-case.detective.evidence.evidenceId');
  unique(gameCase.courtroom.testimonies, item => item.testimonyEvidenceId,
    'game-case.courtroom.testimonies.testimonyEvidenceId');
  unique(gameCase.courtroom.presentableEvidenceIds, item => item, 'game-case.courtroom.presentableEvidenceIds');
  unique(gameCase.judgment.judgmentRules, item => item.ruleId, 'game-case.judgment.judgmentRules.ruleId');
  unique(gameCase.courtroom.testimonies.flatMap(item => item.statements), item => item.statementId,
    'game-case.courtroom.testimonies.statements.statementId');
  validateDisplayOrder(gameCase.detective.evidence, 'game-case.detective.evidence');
  validateDisplayOrder(gameCase.courtroom.testimonies, 'game-case.courtroom.testimonies');
  validateDisplayOrder(gameCase.progression.initialCourt.prosecutionStatements,
    'game-case.progression.initialCourt.prosecutionStatements');
  for (const testimony of gameCase.courtroom.testimonies) validateDisplayOrder(testimony.statements,
    'game-case.courtroom.testimonies.statements');
  if (!sameValues(gameCase.progression.states, PROGRESSION_STATES)
    || !sameValues(gameCase.progression.transitions, PROGRESSION_TRANSITIONS)) fail('INVALID_PROGRESSION_STATE_MACHINE',
    'game-case.progression', 'Game Progressionの状態または遷移が正式なState Machineと一致しません。');
  if (!sameValues(gameCase.progression.retrialCourt, gameCase.courtroom)) fail('RETRIAL_COURT_MISMATCH',
    'game-case.progression.retrialCourt', 'Retrial CourtがCourtroom公開投影と一致しません。');
  if (!sameValues(gameCase.progression.investigation.availableEvidenceIds,
    gameCase.detective.evidence.map(item => item.evidenceId))) fail('INVESTIGATION_EVIDENCE_MISMATCH',
    'game-case.progression.investigation.availableEvidenceIds', 'Investigation Evidence一覧がDetective Partと一致しません。');
  if (gameCase.progression.investigation.collectedEvidenceIds.length
    || gameCase.progression.retryState.previouslyPresentedStatementId !== null
    || gameCase.progression.retryState.previouslyPresentedEvidenceId !== null
    || gameCase.progression.retryState.attemptCount !== 0) fail('INVALID_PROGRESSION_INITIAL_STATE',
    'game-case.progression', 'Game Case Contractのセッション初期状態が空または0ではありません。');
  if (!Number.isSafeInteger(gameCase.progression.retryPolicy.maxCourtAttempts)
    || gameCase.progression.retryPolicy.maxCourtAttempts < 1) fail('INVALID_RETRY_LIMIT',
    'game-case.progression.retryPolicy.maxCourtAttempts', 'maxCourtAttemptsは1以上の安全な整数である必要があります。');
  const expected = digest(gameCaseCore(gameCase));
  if (gameCase.fingerprint !== expected || gameCase.gameCaseId !== `game_case_${expected.slice(0, 20)}`) {
    fail('GAME_CASE_FINGERPRINT_MISMATCH', 'game-case.fingerprint',
      'Internal Game Caseの内容、ID、fingerprintが一致しません。');
  }
  return gameCase;
}

function walkKeys(value, visitor) {
  if (Array.isArray(value)) value.forEach(item => walkKeys(item, visitor));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    visitor(key, item); walkKeys(item, visitor);
  }
}

export function validatePublicGameCase(publicGameCase, input = null) {
  validateDocument('public-game-case', publicGameCase);
  validateDocument('public-game-progression', publicGameCase.progression);
  const forbidden = /^(groundTruth|verificationResult|sourceRefs|provenance|fingerprint|progressionFingerprint|contradictionRef|exonerationRef|judgment|attackGraphRef|requirementIds|technicalAssessment|groundTruthRefs|acceptedEvidenceIds|requiredForCourtIds|retryPolicy)$/i;
  walkKeys(publicGameCase, key => {
    if (forbidden.test(key)) fail('PUBLIC_GAME_CASE_INTERNAL_FIELD', `public-game-case.${key}`,
      'Public Game CaseにBackend内部フィールドが含まれています。');
  });
  if (input) {
    const forbiddenValues = [input.verificationResult.verificationId,
      input.evidenceSet.evidenceSetId, input.evidenceSet.fingerprint,
      input.evidenceSet.attackGraphRef.inputDigest, input.evidenceSet.attackGraphRef.graphId,
      input.gameCaseHandoff.handoffId, input.progressionPlan.planId, input.progressionPlan.fingerprint,
      ...input.evidenceSet.contradictionRefs, ...input.evidenceSet.exonerationRefs,
      input.scenarioPackage.groundTruth.groundTruthId,
      ...input.scenarioPackage.groundTruth.technicalFacts.flatMap(item => [item.factId, item.sourceId]),
      ...input.characters.characters.map(item => item.characterId),
      ...input.scenarioPackage.evidenceRequirements.requirements.map(item => item.requirementId)];
    const text = JSON.stringify(publicGameCase);
    if (forbiddenValues.some(value => value && text.includes(value))) fail('PUBLIC_GAME_CASE_INTERNAL_ID_LEAK',
      'public-game-case', 'Public Game CaseにGround Truthまたは内部成果物の識別子が含まれています。');
  }
  return publicGameCase;
}

export function validateGameCaseBundle({ input, gameCase, publicGameCase }) {
  validateGameCaseConversionInput(input);
  validateGameCase(gameCase);
  validatePublicGameCase(publicGameCase, input);
  const expected = deriveGameCaseParts(input);
  for (const [field, actual] of [['characters', gameCase.characters],
    ['detective', gameCase.detective], ['courtroom', gameCase.courtroom],
    ['progression', gameCase.progression], ['judgment', gameCase.judgment]]) {
    if (!sameValues(actual, expected[field])) fail(`${field.toUpperCase()}_PROJECTION_MISMATCH`,
      `game-case.${field}`, `${field}が明示されたProgression PlanとPhase 7成果物から再現できません。`);
  }
  const evidenceById = new Map(input.evidenceSet.evidenceArtifacts.map(item => [item.evidenceId, item]));
  const statementIds = new Set(gameCase.courtroom.testimonies
    .flatMap(item => item.statements.map(statement => statement.statementId)));
  const available = new Set(gameCase.progression.investigation.availableEvidenceIds);
  const presentable = new Set(gameCase.progression.retrialCourt.presentableEvidenceIds);
  const required = new Set(gameCase.progression.investigation.requiredForCourtIds);
  let solvable = false;
  for (const rule of gameCase.judgment.judgmentRules) {
    if (!statementIds.has(rule.targetStatementId)) fail('BROKEN_STATEMENT_REFERENCE',
      `game-case.judgment.${rule.ruleId}.targetStatementId`, 'Judgment ruleの対象statementがRetrial Courtに存在しません。');
    for (const id of rule.acceptedEvidenceIds) {
      if (!evidenceById.has(id)) fail('BROKEN_EVIDENCE_REFERENCE',
        `game-case.judgment.${rule.ruleId}.acceptedEvidenceIds`, 'Judgment ruleが存在しないEvidenceを要求しています。');
      if (!available.has(id) || !presentable.has(id)
        || evidenceById.get(id).visibility !== 'PLAYER_OBTAINABLE') fail('UNOBTAINABLE_JUDGMENT_EVIDENCE',
        `game-case.judgment.${rule.ruleId}.acceptedEvidenceIds`,
        'Judgment ruleがInvestigationで取得しRetrial Courtで提示できないEvidenceを要求しています。');
      if (!required.has(id)) fail('REQUIRED_COURT_EVIDENCE_MISMATCH',
        'game-case.progression.investigation.requiredForCourtIds', '正解EvidenceがInternal requiredForCourtIdsに含まれていません。');
    }
    if (rule.acceptedEvidenceIds.some(id => available.has(id) && presentable.has(id))) solvable = true;
  }
  if (!solvable) fail('ACQUITTED_UNREACHABLE', 'game-case.progression',
    '通常プレイでTITLEからACQUITTEDへ到達できるJudgment ruleがありません。');
  if (!sameValues(publicGameCase, projectPublicGameCase(gameCase))) fail('PUBLIC_GAME_CASE_MISMATCH',
    'public-game-case', 'Public Game CaseがInternal Game Caseの許可済み公開投影と一致しません。');
  return { gameCase, publicGameCase };
}

export function evaluateObjection(gameCase, { statementId, evidenceId, attemptCount }) {
  validateGameCase(gameCase);
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 0) fail('INVALID_ATTEMPT_COUNT',
    'objection.attemptCount', 'attemptCountは0以上の安全な整数である必要があります。');
  const statements = new Set(gameCase.courtroom.testimonies
    .flatMap(item => item.statements.map(statement => statement.statementId)));
  const presentable = new Set(gameCase.courtroom.presentableEvidenceIds);
  if (!statements.has(statementId)) fail('BROKEN_STATEMENT_REFERENCE', 'objection.statementId',
    '選択されたstatementはRetrial Courtに存在しません。');
  if (!presentable.has(evidenceId)) fail('BROKEN_EVIDENCE_REFERENCE', 'objection.evidenceId',
    '提示されたEvidenceはRetrial Courtで提示できません。');
  const nextAttemptCount = attemptCount + 1;
  const matchedRule = gameCase.judgment.judgmentRules.find(rule =>
    rule.targetStatementId === statementId && rule.acceptedEvidenceIds.includes(evidenceId));
  if (matchedRule) return { outcome: 'SUCCESS', state: 'ACQUITTED', nextState: 'ACQUITTED',
    attemptCount: nextAttemptCount, judgmentRuleId: matchedRule.ruleId };
  const common = { outcome: 'FAILURE', state: 'GUILTY_RETRY', attemptCount: nextAttemptCount,
    judgmentRuleId: null, previouslyPresentedStatementId: statementId,
    previouslyPresentedEvidenceId: evidenceId,
    publicFailureFeedback: gameCase.progression.retryState.publicFailureFeedback };
  return { ...common, nextState: nextAttemptCount >= gameCase.progression.retryPolicy.maxCourtAttempts
    ? 'BLOCKED' : 'INVESTIGATION' };
}

export function validateUiIntegrationHandoff(handoff, gameCase, publicGameCase) {
  validateDocument('ui-integration-handoff', handoff);
  if (handoff.handoffId !== `ui_handoff_${gameCase.fingerprint.slice(0, 20)}`
    || handoff.gameCaseId !== gameCase.gameCaseId
    || handoff.gameCaseFingerprint !== gameCase.fingerprint
    || handoff.publicGameCaseFingerprint !== digest(publicGameCase)
    || handoff.progressionFingerprint !== digest(gameCase.progression)
    || handoff.scenarioId !== gameCase.scenarioId
    || handoff.evidenceSetId !== gameCase.evidenceSetId
    || handoff.verificationId !== gameCase.verificationId) {
    fail('UI_INTEGRATION_HANDOFF_MISMATCH', 'ui-integration-handoff',
      'UI Integration HandoffがREADY Game CaseとProgressionに一致しません。');
  }
  return handoff;
}

export function validateGameCaseResult(result) {
  validateDocument('game-case-result', result);
  if ((result.status === 'READY') !== result.ready) fail('INVALID_GAME_CASE_RESULT',
    'game-case-result.ready', 'statusとreadyが一致しません。');
  if (result.status === 'READY') {
    if (result.errors.length || !result.gameCase || !result.publicGameCase || !result.uiIntegrationHandoff) {
      fail('INVALID_GAME_CASE_RESULT', 'game-case-result.status',
        'READY結果にerrorまたは成果物欠落があります。');
    }
    validateGameCase(result.gameCase);
    validatePublicGameCase(result.publicGameCase);
    validateUiIntegrationHandoff(result.uiIntegrationHandoff, result.gameCase, result.publicGameCase);
  } else if (!result.errors.length || result.gameCase || result.publicGameCase || result.uiIntegrationHandoff) {
    fail('INVALID_GAME_CASE_RESULT', 'game-case-result.status',
      'BLOCKED結果が部分成果物を成功扱いしているか、理由を持ちません。');
  }
  return result;
}
