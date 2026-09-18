import { randomBytes } from 'node:crypto';
import { GameError } from './game.js';
import { ValidationError } from './generation/schema.js';
import { loadCatalog } from './generation/catalog.js';
import { buildCandidates } from './generation/candidate-builder.js';
import { buildAttackGraphs } from './generation/attack-graph.js';
import { buildScenarioGenerationInputs, importScenarioPackage,
  SCENARIO_PROMPT_TEMPLATE } from './generation/scenario-interface.js';
import { buildScenarioReviewReferenceRules, buildScenarioVerificationInput,
  SCENARIO_VERIFICATION_PROMPT, validateScenarioVerificationReview,
  verifyScenario } from './generation/scenario-verifier.js';
import { buildEvidenceGenerationInput, EVIDENCE_PROMPT_TEMPLATE,
  importEvidencePackage } from './generation/evidence-interface.js';
import { buildGameCaseConversionInput, buildGameProgressionPlan,
  convertGameCase } from './generation/game-case-converter.js';
import { buildGeneratedGame } from './generation/game-make.js';
import { buildGameEvaluationInput, evaluateGame } from './generation/game-evaluator.js';
import { DEFAULT_INVESTIGATION_ACTIONS } from './generation/investigation-validator.js';
import { publicXssNetworks, xssTechnicalSelection } from './xss-networks.js';
import { buildXssPrototype, evaluateXssPrototype } from './xss-prototype.js';
import { CodexCancelledError, CodexError, CodexOutputError }
  from './codex/codex-errors.js';
import { sanitizeDiagnostic } from './codex/codex-output-parser.js';
import { AUTO_CODEX_OUTPUT_SCHEMAS } from './codex/auto-output-schemas.js';

const catalog = await loadCatalog();

export const AUTO_STATES = Object.freeze([
  'IDLE', 'CHECKING_CODEX', 'GENERATING_SCENARIO', 'VALIDATING_SCENARIO',
  'REVIEWING_SCENARIO', 'REVISING_SCENARIO', 'GENERATING_EVIDENCE',
  'BUILDING_INVESTIGATION', 'BUILDING_DIALOGUE', 'BUILDING_GAME', 'EVALUATING',
  'READY', 'FAILED', 'CANCELLED',
]);

const DEFAULT_MAX_ATTEMPTS = 3;

const PHASES = Object.freeze([
  ['codex', 'Codex接続確認'], ['scenario', 'Scenario生成'],
  ['validation', 'Scenario Validation'], ['verification', 'Independent Verification'],
  ['revision', 'Scenario修正'], ['evidence', 'Evidence生成'],
  ['investigation', 'Investigation生成'], ['dialogue', 'Dialogue作成'],
  ['game', 'Game Build'], ['evaluation', 'Evaluation'],
]);

function newAutoState() {
  return { generationId: null, state: 'IDLE', selection: null, attempt: 0,
    maxAttempts: DEFAULT_MAX_ATTEMPTS, startedAt: null, completedAt: null,
    failure: null, details: [], codexVersion: null,
    progress: Object.fromEntries(PHASES.map(([id, label]) => [id,
      { id, label, status: 'WAITING', attempt: null }])) };
}

export function createAutoAuthorSession() {
  return { auto: newAutoState(), technicalSelection: null, generationInput: null,
    scenarioPackage: null, scenarioImportResult: null, verificationInput: null,
    verificationResult: null, evidenceGenerationInput: null, evidenceImportResult: null,
    progressionPlan: null, gameCaseResult: null, gameMakeResult: null,
    evaluationResult: null, runtime: null, prototypeEvaluation: null, playId: null };
}

export function autoAuthorBootstrap() {
  return { attack: { id: 'reflected_xss', label: 'Cross-Site Scripting (XSS)' },
    networks: publicXssNetworks(), difficulties: [
      { difficulty: 1, label: '★1', requiredEvidenceCount: 1 },
      { difficulty: 2, label: '★2', requiredEvidenceCount: 2 },
      { difficulty: 3, label: '★3', requiredEvidenceCount: 3 },
    ] };
}

function detail(issue, phase, attempt) {
  const errorCode = issue?.code ?? 'AUTO_GENERATION_FAILED';
  return { phase, attempt, code: errorCode, errorCode,
    field: issue?.field ?? 'generation',
    schemaName: issue?.schemaName ?? null,
    cliErrorCode: issue?.cliErrorCode ?? null,
    reason: sanitizeDiagnostic(issue?.reason ?? issue?.details ?? issue?.message
      ?? '生成処理に失敗しました。'),
    correctionHint: sanitizeDiagnostic(issue?.correctionHint
      ?? '入力条件を変えずに、もう一度生成してください。') };
}

function mark(session, id, status, attempt = null) {
  const item = session.auto.progress[id];
  if (item) Object.assign(item, { status, attempt });
}

function setPhase(session, state, progressId, attempt = null) {
  session.auto.state = state;
  if (progressId) mark(session, progressId, 'RUNNING', attempt);
}

function complete(session, progressId, attempt = null) {
  mark(session, progressId, 'COMPLETE', attempt);
}

function publicFailure(code) {
  if (code === 'CODEX_UNAVAILABLE') return 'Codexを利用できません。Codex CLIでChatGPTアカウントへログインしてください。';
  if (code === 'CODEX_TIMEOUT') return 'Codexの応答が時間内に完了しませんでした。';
  if (code === 'MAX_REVISION_EXCEEDED') return '技術的に成立するScenarioを生成できませんでした。';
  if (code === 'GENERATION_CANCELLED') return 'ゲーム生成を中止しました。';
  if (code === 'CODEX_OUTPUT_SCHEMA_INVALID') return '生成用データ形式の内部エラーが発生しました。';
  return 'ゲームの自動生成に失敗しました。';
}

export function autoAuthorView(session) {
  const auto = session.auto ?? newAutoState();
  return { generationId: auto.generationId, currentState: auto.state,
    selection: auto.selection ? structuredClone(auto.selection) : null,
    attempt: auto.attempt, maxAttempts: auto.maxAttempts,
    progress: PHASES.map(([id]) => structuredClone(auto.progress[id])),
    canCancel: !['IDLE', 'READY', 'FAILED', 'CANCELLED'].includes(auto.state),
    failure: auto.failure ? structuredClone(auto.failure) : null,
    developerDetails: structuredClone(auto.details),
    playUrl: auto.state === 'READY' && session.playId ? `/?game=${session.playId}` : null };
}

function logPhase(session, phase, attempt, started, result) {
  console.info(JSON.stringify({ generationId: session.auto.generationId, phase, attempt,
    duration: Date.now() - started, result }));
}

async function measured(session, phase, attempt, operation) {
  const started = Date.now();
  try {
    const value = await operation(); logPhase(session, phase, attempt, started, 'SUCCESS');
    return value;
  } catch (error) {
    logPhase(session, phase, attempt, started, error.code ?? 'FAILED'); throw error;
  }
}

const REPAIRABLE_CODES = [
  /MISSING/, /REQUIRED/, /REFERENCE/, /SCHEMA/, /FORMAT/, /MALFORMED/, /EVIDENCE/,
  /CONSISTENCY/, /ALIGNMENT/, /ATTRIBUTION/, /COVERAGE/, /NARRATIVE/, /TIMELINE/,
];

export function classifyBlocked(issues) {
  const values = issues ?? [];
  if (values.length && values.every(issue => REPAIRABLE_CODES.some(pattern =>
    pattern.test(issue.code ?? '')) || issue.disposition === 'REVISION')) return 'REPAIRABLE_BLOCKED';
  return 'HARD_BLOCKED';
}

function resetForGeneration(session, selection) {
  const fresh = createAutoAuthorSession();
  for (const key of Object.keys(session)) delete session[key];
  Object.assign(session, fresh);
  session.auto = newAutoState();
  session.auto.generationId = `generation_${randomBytes(12).toString('hex')}`;
  session.auto.selection = { attackType: 'reflected_xss', networkId: selection.networkId,
    difficulty: selection.difficulty };
  session.auto.startedAt = new Date().toISOString();
}

function prepareGenerationInput(selection) {
  const technical = xssTechnicalSelection(selection.networkId, selection.difficulty);
  if (!technical) throw new CodexError('TECHNICAL_CONTRACT_UNSATISFIABLE',
    '選択されたNetworkとDifficultyから技術入力を作成できません。',
    { phase: 'GENERATING_SCENARIO' });
  const attackSelection = { schemaVersion: '1.0', selectedAttackIds: ['reflected_xss'] };
  const candidateResult = buildCandidates({ definitions: catalog, network: technical.network,
    context: technical.scenarioContext, selection: attackSelection });
  if (candidateResult.status !== 'CREATED') throw new CodexError(
    'TECHNICAL_CONTRACT_UNSATISFIABLE', candidateResult.issues[0]?.reason
      ?? '成立するAttack Candidateがありません。', { phase: 'GENERATING_SCENARIO' });
  for (const candidate of candidateResult.candidates) {
    const graphResult = buildAttackGraphs({ definitions: catalog, network: technical.network,
      context: technical.scenarioContext, candidate });
    if (graphResult.status !== 'CREATED') continue;
    const inputs = buildScenarioGenerationInputs({ attackGraphResult: graphResult,
      definitions: catalog, network: technical.network,
      context: technical.scenarioContext, candidate });
    if (inputs.length) return { technical, generationInput: inputs[0] };
  }
  throw new CodexError('TECHNICAL_CONTRACT_UNSATISFIABLE',
    '成立済みAttack Graphを生成できません。', { phase: 'GENERATING_SCENARIO' });
}

function buildAutomaticProgression(session) {
  const set = session.evidenceImportResult.evidenceSet;
  const artifacts = set.evidenceArtifacts;
  const testimony = artifacts.filter(item => item.type === 'TESTIMONY');
  const statements = testimony.flatMap(item => item.testimony.statements);
  const firstNodeId = session.generationInput.technicalInput.network.nodes[0]?.id;
  if (!firstNodeId || !artifacts.length || !statements.length) throw new CodexError(
    'GAME_CASE_INPUT_INCOMPLETE', 'Game Caseに必要なEvidenceまたはTestimonyが不足しています。',
    { phase: 'BUILDING_INVESTIGATION' });
  const target = { schemaVersion: '1.0', targetId: 'target_auto_xss', targetType: 'SERVER',
    displayName: 'XSS関連システム', description: '事件に関係する合成環境の調査対象です。',
    sourceNodeRef: { sourceType: 'NETWORK_NODE', sourceId: firstNodeId },
    availableActionIds: ['action_audit_log', 'action_inspect_device', 'action_inspect_file',
      'action_analyze_network_log', 'action_review_auth_log', 'action_check_configuration'],
    initiallyAvailable: true };
  const ruleActions = ['action_audit_log', 'action_analyze_network_log',
    'action_check_configuration', 'action_inspect_file'];
  const evidenceDiscoveryRules = artifacts.map((artifact, index) => ({ schemaVersion: '1.0',
    ruleId: `discovery_auto_${index + 1}`, evidenceId: artifact.evidenceId,
    targetId: target.targetId, actionId: ruleActions[index % ruleActions.length],
    prerequisites: { requiredEvidenceIds: index ? [artifacts[index - 1].evidenceId] : [],
      requiredCompletedActionIds: [] },
    discoveryResult: { publicMessage: '関連する合成記録が見つかりました。', discovered: true,
      unlockedTargetIds: [], nextHints: index < artifacts.length - 1
        ? ['関連する次の記録を確認できます。'] : [] }, repeatable: false }));
  const objectionRules = set.contradictions.map((contradiction, index) => {
    const exoneration = set.exonerations.find(item =>
      contradiction.conflictingEvidenceIds.every(id => item.supportingEvidenceIds.includes(id)))
      ?? set.exonerations[0];
    return { objectionRuleId: `objection_auto_${index + 1}`,
      targetStatementId: contradiction.statementRef,
      acceptedEvidenceIds: [...contradiction.conflictingEvidenceIds],
      contradictionRef: contradiction.contradictionId,
      exonerationRef: exoneration?.exonerationId ?? 'missing_exoneration' };
  });
  return buildGameProgressionPlan({ scenarioId: set.scenarioId,
    evidenceSetId: set.evidenceSetId, attackGraphRef: set.attackGraphRef,
    initialCourtEvidenceIds: [artifacts.find(item => item.type !== 'TESTIMONY')?.evidenceId
      ?? artifacts[0].evidenceId],
    initialCourtStatementIds: [set.contradictions[0]?.statementRef ?? statements[0].statementId],
    investigationEvidenceIds: artifacts.map(item => item.evidenceId),
    investigationActions: structuredClone(DEFAULT_INVESTIGATION_ACTIONS),
    investigationTargets: [target], evidenceDiscoveryRules,
    initialAvailableTargetIds: [target.targetId],
    retrialStatementIds: statements.map(item => item.statementId),
    returnToCourtCondition: 'ALL_REQUIRED_EVIDENCE_COLLECTED', objectionRules,
    retryPolicy: { maxCourtAttempts: 3, onFailure: 'RETURN_TO_INVESTIGATION',
      onLimitReached: 'BLOCKED' },
    publicMessages: { initialRuling: '現在の証拠だけでは被告人への疑いが残ります。',
      acquittalRuling: '被告人を無罪とします。',
      acquittalExplanation: '取得した複数の技術記録から、人物を断定する主張は維持できません。',
      failureFeedback: 'その証拠では現在の主張を崩せません。追加調査を行ってください。' } });
}

function buildContractGameCase(session) {
  const set = session.evidenceImportResult.evidenceSet;
  const conversionInput = buildGameCaseConversionInput({
    evidenceImportResult: session.evidenceImportResult,
    gameCaseHandoff: session.evidenceImportResult.gameCaseHandoff, evidenceSet: set,
    scenarioPackage: session.scenarioPackage, characters: session.scenarioPackage.characters,
    timeline: session.scenarioPackage.timeline, verificationResult: session.verificationResult,
    progressionPlan: session.progressionPlan, scenarioGenerationInput: session.generationInput,
    contradictions: set.contradictions, exonerations: set.exonerations });
  session.gameCaseResult = convertGameCase(conversionInput);
  const built = buildGeneratedGame(session.gameCaseResult);
  session.gameMakeResult = built.gameMakeResult;
  if (session.gameCaseResult.status !== 'READY' || session.gameMakeResult.status !== 'BUILT') {
    const issue = [...session.gameCaseResult.errors, ...session.gameMakeResult.errors][0];
    throw new CodexError(issue?.code ?? 'GAME_BUILD_FAILED',
      issue?.reason ?? '既存Game Case Contractへ変換できませんでした。',
      { phase: 'BUILDING_GAME' });
  }
}

function feedbackFromIssues(issues, classification) {
  return { classification, errors: (issues ?? []).map(item => ({ code: item.code,
    field: item.field, reason: item.reason, correctionHint: item.correctionHint })) };
}

async function reviewWithRepair({ jsonRunner, verificationInput, signal, session, attempt }) {
  const run = feedback => jsonRunner.runJson({ instruction: SCENARIO_VERIFICATION_PROMPT,
    data: verificationInput, feedback,
    outputSchema: AUTO_CODEX_OUTPUT_SCHEMAS.review.canonicalSchema,
    outputSchemaName: AUTO_CODEX_OUTPUT_SCHEMAS.review.name,
    phase: 'REVIEWING_SCENARIO', signal });
  let review;
  try {
    review = await run(null);
    validateScenarioVerificationReview(review, verificationInput);
    session.verificationResult = verifyScenario({ verificationInput, semanticReview: review });
    return session.verificationResult;
  } catch (error) {
    if (!(error instanceof ValidationError) && !(error instanceof CodexOutputError)) throw error;
    session.auto.details.push(detail({ code: error.code ?? 'REVIEWER_SCHEMA_INVALID',
      field: error.field ?? 'review', reason: error.message,
      correctionHint: '技術的事実を変更せず、JSON形式とrequired fieldだけを修正してください。' },
    'REVIEWING_SCENARIO', attempt));
    const referenceRules = buildScenarioReviewReferenceRules(verificationInput);
    review = await run({ repairOnly: true, code: error.code ?? 'REVIEWER_SCHEMA_INVALID',
      field: error.field ?? 'review', reason: error.message,
      correctionHint: '形式、型、required field、category別の参照規則だけを修正し、技術的事実を追加しないでください。',
      referenceRules });
    validateScenarioVerificationReview(review, verificationInput);
    session.verificationResult = verifyScenario({ verificationInput, semanticReview: review });
    return session.verificationResult;
  }
}

export class AutoGenerationManager {
  constructor({ jsonRunner, maxAttempts = DEFAULT_MAX_ATTEMPTS,
    evaluator = evaluateGame, prototypeEvaluator = evaluateXssPrototype } = {}) {
    this.jsonRunner = jsonRunner;
    this.maxAttempts = maxAttempts;
    this.evaluator = evaluator;
    this.prototypeEvaluator = prototypeEvaluator;
    this.active = null;
  }

  start(session, selection) {
    if (this.active) throw new GameError('GENERATION_LOCKED', 'generation',
      '現在ゲームを生成中です。', 409);
    if (!selection || !['network-a', 'network-b', 'network-c', 'network-d']
      .includes(selection.networkId) || ![1, 2, 3].includes(selection.difficulty)) {
      throw new GameError('INVALID_XSS_SELECTION', 'selection',
        'Network A～Dと難易度★1～3を選択してください。');
    }
    resetForGeneration(session, selection);
    session.auto.maxAttempts = this.maxAttempts;
    const controller = new AbortController();
    const promise = this.#run(session, selection, controller.signal)
      .catch(error => this.#fail(session, error))
      .finally(() => { if (this.active?.session === session) this.active = null; });
    this.active = { session, controller, promise };
    return autoAuthorView(session);
  }

  cancel(session) {
    if (!this.active || this.active.session !== session) throw new GameError(
      'GENERATION_NOT_RUNNING', 'generation', '実行中のゲーム生成はありません。', 409);
    this.active.controller.abort();
    return autoAuthorView(session);
  }

  async waitForIdle() { await this.active?.promise; }

  #fail(session, error) {
    const cancelled = error instanceof CodexCancelledError;
    const code = error.code ?? 'AUTO_GENERATION_FAILED';
    session.auto.state = cancelled ? 'CANCELLED' : 'FAILED';
    session.auto.completedAt = new Date().toISOString();
    session.auto.failure = { code, message: publicFailure(code) };
    for (const running of Object.values(session.auto.progress)
      .filter(item => item.status === 'RUNNING')) running.status = 'FAILED';
    session.auto.details.push(detail(error, error.phase ?? session.auto.state,
      session.auto.attempt || null));
    session.runtime = null; session.playId = null;
  }

  async #run(session, selection, signal) {
    setPhase(session, 'CHECKING_CODEX', 'codex');
    const capability = await measured(session, 'CHECKING_CODEX', null,
      () => this.jsonRunner.checkAvailability({ signal }));
    session.auto.codexVersion = capability.version; complete(session, 'codex');

    const prepared = prepareGenerationInput(selection);
    session.technicalSelection = prepared.technical;
    session.generationInput = prepared.generationInput;

    let revisionFeedback = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      session.auto.attempt = attempt;
      setPhase(session, attempt === 1 ? 'GENERATING_SCENARIO' : 'REVISING_SCENARIO',
        attempt === 1 ? 'scenario' : 'revision', attempt);
      let scenarioPackage;
      try {
        scenarioPackage = await measured(session, session.auto.state, attempt,
          () => this.jsonRunner.runJson({ instruction: SCENARIO_PROMPT_TEMPLATE,
            data: { scenarioGenerationInput: session.generationInput,
              requestedDifficulty: selection.difficulty }, feedback: revisionFeedback,
            outputSchema: AUTO_CODEX_OUTPUT_SCHEMAS.scenario.canonicalSchema,
            outputSchemaName: AUTO_CODEX_OUTPUT_SCHEMAS.scenario.name,
            phase: session.auto.state, signal }));
      } catch (error) {
        if (!(error instanceof CodexOutputError)) throw error;
        const issue = { code: error.code, field: 'scenario-import-package',
          reason: error.message,
          correctionHint: '指定Schemaに適合する単一JSONオブジェクトだけを返してください。' };
        session.auto.details.push(detail(issue, session.auto.state, attempt));
        revisionFeedback = feedbackFromIssues([issue], 'REPAIRABLE_BLOCKED');
        continue;
      }
      complete(session, attempt === 1 ? 'scenario' : 'revision', attempt);
      if (attempt > 1) complete(session, 'scenario', attempt);

      setPhase(session, 'VALIDATING_SCENARIO', 'validation', attempt);
      session.scenarioPackage = structuredClone(scenarioPackage);
      session.scenarioImportResult = importScenarioPackage({
        generationInput: session.generationInput, scenarioPackage });
      if (session.scenarioImportResult.status !== 'VALID') {
        const issues = session.scenarioImportResult.errors;
        const classification = classifyBlocked(issues);
        session.auto.details.push(...issues.map(item => detail(item,
          'VALIDATING_SCENARIO', attempt)));
        revisionFeedback = feedbackFromIssues(issues, classification);
        if (classification === 'HARD_BLOCKED') throw new CodexError('HARD_BLOCKED',
          'Scenario Validationを継続できません。', { phase: 'VALIDATING_SCENARIO' });
        continue;
      }
      complete(session, 'validation', attempt);
      session.verificationInput = buildScenarioVerificationInput({
        generationInput: session.generationInput,
        importResult: session.scenarioImportResult, scenarioPackage,
        revisionAttemptsUsed: attempt - 1 });

      setPhase(session, 'REVIEWING_SCENARIO', 'verification', attempt);
      const reviewed = await measured(session, 'REVIEWING_SCENARIO', attempt,
        () => reviewWithRepair({ jsonRunner: this.jsonRunner,
          verificationInput: session.verificationInput, signal, session, attempt }));
      const verification = reviewed;
      if (verification?.status === 'VERIFIED') {
        complete(session, 'verification', attempt); revisionFeedback = null; break;
      }
      const issues = verification?.issues ?? reviewed.issues;
      const classification = verification?.status === 'NEEDS_REVISION'
        ? 'REPAIRABLE_BLOCKED' : classifyBlocked(issues);
      session.auto.details.push(...issues.map(item => detail(item,
        'REVIEWING_SCENARIO', attempt)));
      revisionFeedback = feedbackFromIssues(issues, classification);
      if (classification === 'HARD_BLOCKED') throw new CodexError('HARD_BLOCKED',
        'Independent Verificationを継続できません。', { phase: 'REVIEWING_SCENARIO' });
    }
    if (session.verificationResult?.status !== 'VERIFIED') throw new CodexError(
      'MAX_REVISION_EXCEEDED', '最大試行回数までにScenarioを検証できませんでした。',
      { phase: 'REVISING_SCENARIO' });

    setPhase(session, 'GENERATING_EVIDENCE', 'evidence', session.auto.attempt);
    session.evidenceGenerationInput = buildEvidenceGenerationInput({
      scenarioVerificationInput: session.verificationInput,
      verificationResult: session.verificationResult });
    if (session.evidenceGenerationInput.status !== 'READY') throw new CodexError(
      'HARD_BLOCKED', 'Evidence Generation Inputを作成できません。',
      { phase: 'GENERATING_EVIDENCE' });
    let evidenceFeedback = null;
    let evidenceImported = null;
    for (let evidenceAttempt = 1; evidenceAttempt <= 2; evidenceAttempt += 1) {
      let evidencePackage;
      try {
        evidencePackage = await measured(session, 'GENERATING_EVIDENCE', evidenceAttempt,
          () => this.jsonRunner.runJson({ instruction: EVIDENCE_PROMPT_TEMPLATE,
            data: { evidenceGenerationInput: session.evidenceGenerationInput,
              requestedEvidenceChainLength: selection.difficulty }, feedback: evidenceFeedback,
            outputSchema: AUTO_CODEX_OUTPUT_SCHEMAS.evidence.canonicalSchema,
            outputSchemaName: AUTO_CODEX_OUTPUT_SCHEMAS.evidence.name,
            phase: 'GENERATING_EVIDENCE', signal }));
      } catch (error) {
        if (!(error instanceof CodexOutputError)) throw error;
        const issue = { code: error.code, field: 'evidence-import-package',
          reason: error.message,
          correctionHint: '指定Schemaに適合する単一JSONオブジェクトだけを返してください。' };
        session.auto.details.push(detail(issue, 'GENERATING_EVIDENCE', evidenceAttempt));
        evidenceFeedback = feedbackFromIssues([issue], 'REPAIRABLE_BLOCKED');
        continue;
      }
      session.evidenceImportResult = importEvidencePackage({
        generationInput: session.evidenceGenerationInput, evidencePackage });
      evidenceImported = session.evidenceImportResult;
      if (evidenceImported.status === 'VALID') break;
      const issues = evidenceImported.errors;
      session.auto.details.push(...issues.map(item => detail(item,
        'GENERATING_EVIDENCE', evidenceAttempt)));
      if (classifyBlocked(issues) === 'HARD_BLOCKED') break;
      evidenceFeedback = feedbackFromIssues(issues, 'REPAIRABLE_BLOCKED');
    }
    if (evidenceImported?.status !== 'VALID') throw new CodexError(
      'EVIDENCE_GENERATION_FAILED', '有効なEvidence Packageを生成できませんでした。',
      { phase: 'GENERATING_EVIDENCE' });
    complete(session, 'evidence');

    setPhase(session, 'BUILDING_INVESTIGATION', 'investigation');
    session.progressionPlan = buildAutomaticProgression(session);
    complete(session, 'investigation');
    setPhase(session, 'BUILDING_DIALOGUE', 'dialogue');
    session.runtime = buildXssPrototype({ selection: session.technicalSelection,
      verificationResult: session.verificationResult, scenarioPackage: session.scenarioPackage,
      evidenceSet: session.evidenceImportResult.evidenceSet });
    complete(session, 'dialogue');
    setPhase(session, 'BUILDING_GAME', 'game');
    buildContractGameCase(session);
    complete(session, 'game');
    setPhase(session, 'EVALUATING', 'evaluation');
    session.evaluationResult = this.evaluator(buildGameEvaluationInput({
      gameMakeResult: session.gameMakeResult, gameCaseResult: session.gameCaseResult,
      evidenceSet: session.evidenceImportResult.evidenceSet,
      verificationResult: session.verificationResult, scenarioPackage: session.scenarioPackage }));
    session.prototypeEvaluation = this.prototypeEvaluator(session.runtime);
    if (session.evaluationResult.status !== 'ACCEPTED'
      || session.prototypeEvaluation.status !== 'ACCEPTED') throw new CodexError(
      'EVALUATION_REJECTED', 'EvaluationがGameを拒否しました。', { phase: 'EVALUATING' });
    complete(session, 'evaluation');
    if (session.auto.progress.revision.status === 'WAITING') {
      session.auto.progress.revision.status = 'SKIPPED';
    }
    session.auto.state = 'READY'; session.auto.completedAt = new Date().toISOString();
  }
}
