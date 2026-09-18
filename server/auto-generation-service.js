import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GameError } from './game.js';
import { validateDocument, ValidationError } from './generation/schema.js';
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
import { buildScenarioPreview, createDefaultConfiguration, INVESTIGATION_TYPES,
  scenarioCreationBootstrap, validateScenarioConfiguration }
  from './generation/scenario-configuration.js';
import { buildInvestigationAssignments } from './generation/investigation-registry.js';
import { assignDialogueTemplate } from './generation/dialogue-template.js';
import { CodexCancelledError, CodexError, CodexOutputError }
  from './codex/codex-errors.js';
import { sanitizeDiagnostic } from './codex/codex-output-parser.js';
import { AUTO_CODEX_OUTPUT_SCHEMAS } from './codex/auto-output-schemas.js';

const catalog = await loadCatalog();
const MAKOTOMARU_PROMPT = await readFile(new URL('../prompts/makotomaru-configuration-v1.md',
  import.meta.url), 'utf8');

export const AUTO_STATES = Object.freeze([
  'MODE_SELECTION', 'MANUAL_CONFIGURATION', 'MAKOTOMARU_CONFIGURATION',
  'SCENARIO_DRAFT', 'SCENARIO_PREVIEW', 'USER_APPROVED', 'SCENARIO_VALIDATING',
  'SCENARIO_REVIEWING', 'SCENARIO_REVISING', 'VERIFIED', 'EVIDENCE_BUILDING',
  'INVESTIGATION_BUILDING', 'DIALOGUE_BUILDING', 'GAME_BUILDING', 'EVALUATING',
  'READY', 'FAILED', 'CANCELLED',
]);

const DEFAULT_MAX_ATTEMPTS = 3;

const PHASES = Object.freeze([
  ['configuration', 'Scenario Configuration'], ['codex', 'Codex接続確認'], ['scenario', 'Scenario生成'],
  ['validation', 'Scenario Validation'], ['verification', 'Independent Verification'],
  ['revision', 'Scenario修正'], ['evidence', 'Evidence生成'],
  ['investigation', 'Investigation生成'], ['dialogue', 'Dialogue作成'],
  ['game', 'Game Build'], ['evaluation', 'Evaluation'],
]);

function newAutoState() {
  return { generationId: null, state: 'MODE_SELECTION', selection: null, attempt: 0,
    maxAttempts: DEFAULT_MAX_ATTEMPTS, startedAt: null, completedAt: null,
    failure: null, details: [], codexVersion: null,
    progress: Object.fromEntries(PHASES.map(([id, label]) => [id,
      { id, label, status: 'WAITING', attempt: null }])) };
}

export function createAutoAuthorSession() {
  return { auto: newAutoState(), technicalSelection: null, generationInput: null,
    configuration: null, configurationValidation: null, scenarioPreview: null,
    userApproval: null, revisionFeedback: null, makotomaruRequest: null,
    scenarioPackage: null, scenarioImportResult: null, verificationInput: null,
    verificationResult: null, evidenceGenerationInput: null, evidenceImportResult: null,
    progressionPlan: null, gameCaseResult: null, gameMakeResult: null,
    evaluationResult: null, runtime: null, prototypeEvaluation: null, playId: null };
}

export function autoAuthorBootstrap() {
  return scenarioCreationBootstrap(catalog);
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
    canCancel: Boolean(session.autoOperationRunning),
    canApprove: auto.state === 'SCENARIO_PREVIEW',
    canRegenerate: auto.state === 'SCENARIO_PREVIEW'
      && session.configuration?.mode === 'MAKOTOMARU',
    configuration: session.configuration ? structuredClone(session.configuration) : null,
    configurationValidation: session.configurationValidation
      ? structuredClone(session.configurationValidation) : null,
    scenarioPreview: session.scenarioPreview ? structuredClone(session.scenarioPreview) : null,
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
  session.auto.selection = structuredClone(selection);
  session.auto.startedAt = new Date().toISOString();
}

function prepareGenerationInput(configuration) {
  const validation = validateScenarioConfiguration(configuration, catalog);
  if (validation.status !== 'VALID') throw new CodexError(
    'TECHNICAL_CONTRACT_UNSATISFIABLE', validation.errors[0]?.reason
      ?? 'Scenario Configurationが成立しません。', { phase: 'SCENARIO_DRAFT' });
  return { validation, technical: { network: validation.technical.network,
    scenarioContext: validation.technical.scenarioContext },
  generationInput: validation.technical.generationInput };
}

function buildAutomaticProgression(session) {
  const set = session.evidenceImportResult.evidenceSet;
  const artifacts = set.evidenceArtifacts;
  const testimony = artifacts.filter(item => item.type === 'TESTIMONY');
  const statements = testimony.flatMap(item => item.testimony.statements);
  const firstAttack = [...session.configuration.attacks].sort((a, b) => a.order - b.order)[0];
  const firstNodeId = firstAttack?.investigationSourceNodeId;
  if (!firstNodeId || !artifacts.length || !statements.length) throw new CodexError(
    'GAME_CASE_INPUT_INCOMPLETE', 'Game Caseに必要なEvidenceまたはTestimonyが不足しています。',
    { phase: 'BUILDING_INVESTIGATION' });
  const sourceNode = session.configuration.network.nodes.find(item => item.nodeId === firstNodeId);
  const target = { schemaVersion: '1.0', targetId: 'target_scenario', targetType: 'SERVER',
    displayName: sourceNode?.label ?? '関連システム', description: '事件に関係する合成環境の調査対象です。',
    sourceNodeRef: { sourceType: 'NETWORK_NODE', sourceId: firstNodeId },
    availableActionIds: ['action_audit_log', 'action_inspect_device', 'action_inspect_file',
      'action_analyze_network_log', 'action_review_auth_log', 'action_check_configuration'],
    initiallyAvailable: true };
  const selectedActions = session.configuration.attacks.flatMap(attack =>
    attack.investigationTypes.map(type => INVESTIGATION_TYPES[type].actionId));
  const ruleActions = selectedActions.length ? selectedActions : ['action_audit_log'];
  const evidenceDiscoveryRules = artifacts.map((artifact, index) => ({ schemaVersion: '1.0',
    ruleId: `discovery_auto_${index + 1}`, evidenceId: artifact.evidenceId,
    targetId: target.targetId, actionId: ruleActions[index % ruleActions.length],
    prerequisites: { requiredEvidenceIds: index ? [artifacts[index - 1].evidenceId] : [],
      requiredCompletedActionIds: [] },
    discoveryResult: { publicMessage: '関連する合成記録が見つかりました。', discovered: true,
      unlockedTargetIds: [], nextHints: index < artifacts.length - 1
        ? ['関連する次の記録を確認できます。'] : [] }, repeatable: false }));
  const baseRules = set.contradictions.map((contradiction, index) => {
    const exoneration = set.exonerations.find(item =>
      contradiction.conflictingEvidenceIds.every(id => item.supportingEvidenceIds.includes(id)))
      ?? set.exonerations[0];
    return { objectionRuleId: `objection_auto_${index + 1}`,
      targetStatementId: contradiction.statementRef,
      acceptedEvidenceIds: [...contradiction.conflictingEvidenceIds],
      contradictionRef: contradiction.contradictionId,
      exonerationRef: exoneration?.exonerationId ?? 'missing_exoneration' };
  });
  const objectionRules = baseRules;
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
  session.runtime = built.runtime;
  session.runtime.roundCount = session.configuration.difficulty;
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
    evaluator = evaluateGame } = {}) {
    this.jsonRunner = jsonRunner;
    this.maxAttempts = maxAttempts;
    this.evaluator = evaluator;
    this.active = null;
  }

  #begin(session, operation) {
    if (this.active) throw new GameError('GENERATION_LOCKED', 'generation',
      '現在ゲームを生成中です。', 409);
    const controller = new AbortController();
    session.autoOperationRunning = true;
    const promise = operation(controller.signal)
      .catch(error => this.#fail(session, error))
      .finally(() => { session.autoOperationRunning = false;
        if (this.active?.session === session) this.active = null; });
    this.active = { session, controller, promise };
    return autoAuthorView(session);
  }

  selectMode(session, mode) {
    if (!['MANUAL', 'MAKOTOMARU'].includes(mode)) throw new GameError(
      'INVALID_SCENARIO_MODE', 'mode', '詳細設定または真実丸を選択してください。');
    if (this.active) throw new GameError('GENERATION_LOCKED', 'generation',
      '現在ゲームを生成中です。', 409);
    session.auto.state = mode === 'MANUAL' ? 'MANUAL_CONFIGURATION' : 'MAKOTOMARU_CONFIGURATION';
    session.auto.selection = { mode };
    return autoAuthorView(session);
  }

  submitManual(session, configuration) {
    resetForGeneration(session, { mode: 'MANUAL', difficulty: configuration?.difficulty });
    session.auto.maxAttempts = this.maxAttempts;
    session.configuration = structuredClone(configuration);
    const validation = validateScenarioConfiguration(configuration, catalog);
    session.configurationValidation = { status: validation.status,
      errors: structuredClone(validation.errors) };
    if (validation.status !== 'VALID') {
      session.auto.state = 'MANUAL_CONFIGURATION';
      return autoAuthorView(session);
    }
    session.configurationValidation = { status: 'VALID', errors: [] };
    return this.#begin(session, signal => this.#createDraft(session, signal));
  }

  startMakotomaru(session, request) {
    try { validateDocument('makotomaru-request', request); }
    catch (error) { throw new GameError(error.code ?? 'INVALID_MAKOTOMARU_REQUEST',
      error.field ?? 'request', error.message); }
    resetForGeneration(session, { mode: 'MAKOTOMARU', difficulty: request.difficulty });
    session.auto.maxAttempts = this.maxAttempts;
    session.makotomaruRequest = structuredClone(request);
    return this.#begin(session, signal => this.#createMakotomaruDraft(session, signal));
  }

  approve(session) {
    if (session.auto.state !== 'SCENARIO_PREVIEW' || !session.scenarioPackage) {
      throw new GameError('SCENARIO_PREVIEW_REQUIRED', 'approval',
        'Preview中のScenarioだけを承認できます。', 409);
    }
    session.userApproval = { status: 'USER_APPROVED', approvedAt: new Date().toISOString(),
      configurationId: session.configuration.configurationId };
    session.auto.state = 'USER_APPROVED';
    return this.#begin(session, signal => this.#continueApproved(session, signal));
  }

  reject(session) {
    if (this.active || session.auto.state !== 'SCENARIO_PREVIEW') throw new GameError(
      'SCENARIO_PREVIEW_REQUIRED', 'approval', 'Preview中のScenarioだけを修正できます。', 409);
    session.userApproval = { status: 'REJECTED', rejectedAt: new Date().toISOString() };
    session.scenarioPackage = null; session.scenarioPreview = null;
    session.auto.state = session.configuration.mode === 'MAKOTOMARU'
      ? 'MAKOTOMARU_CONFIGURATION' : 'MANUAL_CONFIGURATION';
    return autoAuthorView(session);
  }

  regenerate(session) {
    if (session.auto.state !== 'SCENARIO_PREVIEW'
      || session.configuration?.mode !== 'MAKOTOMARU' || !session.makotomaruRequest) {
      throw new GameError('MAKOTOMARU_PREVIEW_REQUIRED', 'generation',
        '真実丸のPreviewからだけ作り直せます。', 409);
    }
    const request = structuredClone(session.makotomaruRequest);
    resetForGeneration(session, { mode: 'MAKOTOMARU', difficulty: request.difficulty });
    session.auto.maxAttempts = this.maxAttempts; session.makotomaruRequest = request;
    return this.#begin(session, signal => this.#createMakotomaruDraft(session, signal));
  }

  // 公開APIからは使用しない旧テスト用互換入口。Preview作成後に明示的な内部承認を記録する。
  start(session, selection) {
    if (!selection || ![1, 2, 3].includes(selection.difficulty)) throw new GameError(
      'INVALID_XSS_SELECTION', 'selection', '難易度★1～3を選択してください。');
    const configuration = createDefaultConfiguration({ mode: 'MANUAL',
      difficulty: selection.difficulty, attackIds: ['reflected_xss'] });
    resetForGeneration(session, { mode: 'MANUAL', difficulty: selection.difficulty });
    session.auto.maxAttempts = this.maxAttempts; session.configuration = configuration;
    session.configurationValidation = { status: 'VALID', errors: [] };
    return this.#begin(session, signal => this.#legacyApprovedRun(session, signal));
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

  async #ensureCodex(session, signal) {
    if (session.auto.codexVersion) return;
    setPhase(session, 'CHECKING_CODEX', 'codex');
    const capability = await measured(session, 'CHECKING_CODEX', null,
      () => this.jsonRunner.checkAvailability({ signal }));
    session.auto.codexVersion = capability.version; complete(session, 'codex');
  }

  #prepare(session) {
    const prepared = prepareGenerationInput(session.configuration);
    session.technicalSelection = prepared.technical;
    session.generationInput = prepared.generationInput;
    session.configurationValidation = { status: prepared.validation.status, errors: [] };
  }

  async #generateScenario(session, signal, feedback = null) {
    const attempt = session.auto.attempt + 1;
    if (attempt > this.maxAttempts) throw new CodexError('MAX_REVISION_EXCEEDED',
      '最大試行回数までにScenarioを生成できませんでした。', { phase: 'SCENARIO_REVISING' });
    session.auto.attempt = attempt;
    const phase = attempt === 1 ? 'GENERATING_SCENARIO' : 'REVISING_SCENARIO';
    setPhase(session, attempt === 1 ? 'SCENARIO_DRAFT' : 'SCENARIO_REVISING',
      attempt === 1 ? 'scenario' : 'revision', attempt);
    try {
      const scenarioPackage = await measured(session, phase, attempt,
        () => this.jsonRunner.runJson({ instruction: SCENARIO_PROMPT_TEMPLATE,
          data: { scenarioGenerationInput: session.generationInput,
            scenarioConfiguration: session.configuration,
            requestedDifficulty: session.configuration.difficulty }, feedback,
          outputSchema: AUTO_CODEX_OUTPUT_SCHEMAS.scenario.canonicalSchema,
          outputSchemaName: AUTO_CODEX_OUTPUT_SCHEMAS.scenario.name, phase, signal }));
      validateDocument('scenario-import-package', scenarioPackage);
      session.scenarioPackage = structuredClone(scenarioPackage);
      complete(session, attempt === 1 ? 'scenario' : 'revision', attempt);
      if (attempt > 1) complete(session, 'scenario', attempt);
      session.scenarioPreview = buildScenarioPreview(session.configuration, scenarioPackage);
      session.userApproval = null; session.auto.state = 'SCENARIO_PREVIEW';
      return true;
    } catch (error) {
      if (!(error instanceof ValidationError) && !(error instanceof CodexOutputError)) throw error;
      const item = { code: error.code ?? 'SCENARIO_SCHEMA_INVALID',
        field: error.field ?? 'scenario-import-package', reason: error.message,
        correctionHint: '指定Schemaに適合する単一JSONオブジェクトだけを返してください。' };
      session.auto.details.push(detail(item, phase, attempt));
      return this.#generateScenario(session, signal,
        feedbackFromIssues([item], 'REPAIRABLE_BLOCKED'));
    }
  }

  async #createDraft(session, signal) {
    await this.#ensureCodex(session, signal); this.#prepare(session);
    complete(session, 'configuration');
    await this.#generateScenario(session, signal);
  }

  async #createMakotomaruDraft(session, signal) {
    await this.#ensureCodex(session, signal);
    setPhase(session, 'MAKOTOMARU_CONFIGURATION', 'configuration');
    let feedback = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const result = await measured(session, 'MAKOTOMARU_CONFIGURATION', attempt,
        () => this.jsonRunner.runJson({ instruction: MAKOTOMARU_PROMPT,
          data: { request: session.makotomaruRequest,
            allowedAttacks: catalog.map(item => ({ id: item.id, category: item.category,
              supportedInvestigationTypes: item.supportedInvestigationTypes })),
            networkTemplate: autoAuthorBootstrap().defaultNetwork,
            investigationTypes: Object.keys(INVESTIGATION_TYPES) }, feedback,
          outputSchema: AUTO_CODEX_OUTPUT_SCHEMAS.makotomaru.canonicalSchema,
          outputSchemaName: AUTO_CODEX_OUTPUT_SCHEMAS.makotomaru.name,
          phase: 'MAKOTOMARU_CONFIGURATION', signal }));
      let errors = [];
      try { validateDocument('makotomaru-result', result);
        result.configuration.mode = 'MAKOTOMARU';
        result.configuration.difficulty = session.makotomaruRequest.difficulty;
        result.configuration.evidenceCount = session.makotomaruRequest.difficulty;
        const validation = validateScenarioConfiguration(result.configuration, catalog);
        errors = validation.errors;
      } catch (error) { errors = [{ code: error.code ?? 'MAKOTOMARU_OUTPUT_INVALID',
        field: error.field ?? 'makotomaru-result', reason: error.message,
        correctionHint: 'Scenario Configuration Contractに適合させてください。' }]; }
      if (!errors.length) {
        session.configuration = structuredClone(result.configuration);
        session.configurationValidation = { status: 'VALID', errors: [] };
        complete(session, 'configuration', attempt); this.#prepare(session);
        await this.#generateScenario(session, signal); return;
      }
      session.auto.details.push(...errors.map(item => detail(item,
        'MAKOTOMARU_CONFIGURATION', attempt)));
      feedback = feedbackFromIssues(errors, 'REPAIRABLE_BLOCKED');
    }
    throw new CodexError('MAX_REVISION_EXCEEDED',
      '真実丸が有効なScenario Configurationを提案できませんでした。',
      { phase: 'MAKOTOMARU_CONFIGURATION' });
  }

  async #legacyApprovedRun(session, signal) {
    await this.#createDraft(session, signal);
    while (session.auto.state === 'SCENARIO_PREVIEW') {
      session.userApproval = { status: 'USER_APPROVED', approvedAt: new Date().toISOString(),
        configurationId: session.configuration.configurationId, legacyCompatibility: true };
      await this.#continueApproved(session, signal);
    }
  }

  async #continueApproved(session, signal) {
    if (session.userApproval?.status !== 'USER_APPROVED') throw new CodexError(
      'USER_APPROVAL_REQUIRED', 'ユーザ承認がありません。', { phase: 'USER_APPROVED' });
    const attempt = session.auto.attempt;
    setPhase(session, 'SCENARIO_VALIDATING', 'validation', attempt);
    session.scenarioImportResult = importScenarioPackage({
      generationInput: session.generationInput, scenarioPackage: session.scenarioPackage });
    if (session.scenarioImportResult.status !== 'VALID') {
      const issues = session.scenarioImportResult.errors;
      const classification = classifyBlocked(issues);
      session.auto.details.push(...issues.map(item => detail(item, 'SCENARIO_VALIDATING', attempt)));
      if (classification === 'HARD_BLOCKED') throw new CodexError('HARD_BLOCKED',
        'Scenario Validationを継続できません。', { phase: 'SCENARIO_VALIDATING' });
      await this.#generateScenario(session, signal, feedbackFromIssues(issues, classification));
      return;
    }
    complete(session, 'validation', attempt);
    session.verificationInput = buildScenarioVerificationInput({
      generationInput: session.generationInput,
      importResult: session.scenarioImportResult, scenarioPackage: session.scenarioPackage,
      revisionAttemptsUsed: attempt - 1 });
    setPhase(session, 'SCENARIO_REVIEWING', 'verification', attempt);
    const verification = await measured(session, 'REVIEWING_SCENARIO', attempt,
      () => reviewWithRepair({ jsonRunner: this.jsonRunner,
        verificationInput: session.verificationInput, signal, session, attempt }));
    if (verification.status !== 'VERIFIED') {
      const issues = verification.issues ?? [];
      const classification = verification.status === 'NEEDS_REVISION'
        ? 'REPAIRABLE_BLOCKED' : classifyBlocked(issues);
      session.auto.details.push(...issues.map(item => detail(item, 'SCENARIO_REVIEWING', attempt)));
      if (classification === 'HARD_BLOCKED') throw new CodexError('HARD_BLOCKED',
        'Independent Verificationを継続できません。', { phase: 'SCENARIO_REVIEWING' });
      await this.#generateScenario(session, signal, feedbackFromIssues(issues, classification));
      return;
    }
    complete(session, 'verification', attempt); session.auto.state = 'VERIFIED';

    setPhase(session, 'EVIDENCE_BUILDING', 'evidence', session.auto.attempt);
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
              requestedEvidenceChainLength: session.configuration.difficulty }, feedback: evidenceFeedback,
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

    setPhase(session, 'INVESTIGATION_BUILDING', 'investigation');
    session.investigationAssignments = buildInvestigationAssignments(session.configuration);
    session.evidenceChain = session.evidenceImportResult.evidenceSet.evidenceArtifacts
      .slice(0, session.configuration.evidenceCount).map(item => item.evidenceId);
    session.progressionPlan = buildAutomaticProgression(session);
    complete(session, 'investigation');
    setPhase(session, 'DIALOGUE_BUILDING', 'dialogue');
    session.dialoguePlan = assignDialogueTemplate({ configuration: session.configuration,
      scenarioPackage: session.scenarioPackage,
      evidenceSet: session.evidenceImportResult.evidenceSet });
    complete(session, 'dialogue');
    setPhase(session, 'GAME_BUILDING', 'game');
    buildContractGameCase(session);
    complete(session, 'game');
    setPhase(session, 'EVALUATING', 'evaluation');
    session.evaluationResult = this.evaluator(buildGameEvaluationInput({
      gameMakeResult: session.gameMakeResult, gameCaseResult: session.gameCaseResult,
      evidenceSet: session.evidenceImportResult.evidenceSet,
      verificationResult: session.verificationResult, scenarioPackage: session.scenarioPackage }));
    if (session.evaluationResult.status !== 'ACCEPTED') throw new CodexError(
      'EVALUATION_REJECTED', 'EvaluationがGameを拒否しました。', { phase: 'EVALUATING' });
    complete(session, 'evaluation');
    if (session.auto.progress.revision.status === 'WAITING') {
      session.auto.progress.revision.status = 'SKIPPED';
    }
    session.auto.state = 'READY'; session.auto.completedAt = new Date().toISOString();
  }
}
