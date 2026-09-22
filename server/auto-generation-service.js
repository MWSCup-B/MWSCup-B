import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GameError } from './game.js';
import { validateDocument, ValidationError } from './generation/schema.js';
import { loadCatalog } from './generation/catalog.js';
import { buildCandidates } from './generation/candidate-builder.js';
import { buildAttackGraphs } from './generation/attack-graph.js';
import { buildScenarioGenerationInputs, importScenarioPackage } from './generation/scenario-interface.js';
import { applyScenarioRevision, buildScenarioRevisionInput, SCENARIO_REVISION_PROMPT }
  from './generation/scenario-revision.js';
import { buildScenarioReviewReferenceRules, buildScenarioVerificationInput,
  SCENARIO_VERIFICATION_PROMPT, validateScenarioVerificationReview,
  verifyScenario } from './generation/scenario-verifier.js';
import { buildEvidenceGenerationInput, EVIDENCE_PROMPT_TEMPLATE,
  buildEvidenceGenerationDraftInput, materializeEvidenceGenerationDraft,
  importEvidencePackage } from './generation/evidence-interface.js';
import { buildGameCaseConversionInput, buildGameProgressionPlan,
  convertGameCase } from './generation/game-case-converter.js';
import { buildGeneratedGame } from './generation/game-make.js';
import { findIncorrectObjectionPair } from './generation/game-case-validator.js';
import { sameValues } from './generation/evidence-validator.js';
import { buildGameEvaluationInput, evaluateGame } from './generation/game-evaluator.js';
import { DEFAULT_INVESTIGATION_ACTIONS } from './generation/investigation-validator.js';
import { buildScenarioPreview, createDefaultConfiguration, INVESTIGATION_TYPES,
  normalizeScenarioConfiguration, scenarioCreationBootstrap, validateScenarioConfiguration }
  from './generation/scenario-configuration.js';
import { buildInvestigationStages, buildInvestigationAssignments }
  from './generation/investigation-registry.js';
import { assignDialogueTemplate } from './generation/dialogue-template.js';
import { buildIncidentOverview, buildProsecutionOpening } from './generation/incident-report.js';
import { validateGeneratedLogFormats } from './generation/evidence-log-format.js';
import { createSelectionConfiguration, buildAttackSelectionPaths } from './generation/scenario-selection.js';
import { courtIssueGenerationProblems, requestedCourtIssueCount } from './generation/court-issues.js';
import { validateCourtQuestionSources } from './generation/court-questions.js';
import { validateSequentialPlan } from './generation/sequential-investigation.js';
import { stageEvidenceProblems } from './generation/scenario-stage-plan.js';
import { buildQuestionBackground } from './generation/investigation-lessons.js';
import { buildIncidentConclusion } from './generation/incident-conclusion.js';
import { LEARNING_OBSERVATION_FIELDS, validateLearningObservations } from './generation/learning-observations.js';
import { buildScenarioTemplate, validateScenarioEvidenceCoverage }
  from './generation/scenario-template.js';
import { CodexCancelledError, CodexError, CodexOutputError }
  from './codex/codex-errors.js';
import { sanitizeDiagnostic } from './codex/codex-output-parser.js';
import { AUTO_CODEX_OUTPUT_SCHEMAS } from './codex/auto-output-schemas.js';

const catalog = await loadCatalog();
// 今回の追加プリセットは詳細設定用。真実丸の既定Network/選択契約は維持し、
// そのNetworkに存在しない認証・偽フォーム設備を必要とする定義を混入させない。
const makotomaruCatalog = catalog.filter(item => ['phishing', 'reflected_xss', 'sql_injection'].includes(item.id));
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

let attackSelectionPaths = null;
export function autoAuthorBootstrap() {
  // The server-owned catalog is fixed for this process. Do not send technical
  // graphs or answer mappings to the form, and do not share mutable cached IDs.
  attackSelectionPaths ??= buildAttackSelectionPaths(catalog);
  return { ...scenarioCreationBootstrap(catalog),
    attackSelectionPaths: structuredClone(attackSelectionPaths) };
}

function detail(issue, phase, attempt) {
  const errorCode = issue?.code ?? 'AUTO_GENERATION_FAILED';
  if (errorCode === 'CODEX_USAGE_LIMIT_REACHED') return {
    phase, code: errorCode, errorCode,
    httpStatus: issue?.httpStatus ?? null, retryable: Boolean(issue?.retryable),
  };
  return { phase, attempt, code: errorCode, errorCode,
    field: issue?.field ?? 'generation',
    schemaName: issue?.schemaName ?? null,
    cliErrorCode: issue?.cliErrorCode ?? null,
    cliErrorClass: issue?.cliErrorClass ?? null,
    exitCode: issue?.exitCode ?? null,
    httpStatus: issue?.httpStatus ?? null,
    retryable: Boolean(issue?.retryable),
    ...(errorCode === 'CODEX_TIMEOUT' ? {
      timeoutMs: issue?.timeoutMs ?? null, elapsedMs: issue?.elapsedMs ?? null,
      promptBytes: issue?.promptBytes ?? null,
      stdoutBytes: issue?.stdoutBytes ?? null, stderrBytes: issue?.stderrBytes ?? null,
      terminationSignal: issue?.terminationSignal ?? null,
    } : {}),
    receivedType: issue?.receivedType ?? null,
    length: issue?.length ?? null,
    expectedMinLength: issue?.expectedMinLength ?? null,
    expectedMaxLength: issue?.expectedMaxLength ?? null,
    expectedPattern: issue?.expectedPattern ?? null,
    expectedFormat: issue?.expectedFormat ?? null,
    reason: sanitizeDiagnostic(issue?.reason ?? issue?.details ?? issue?.message
      ?? '生成処理に失敗しました。'),
    correctionHint: sanitizeDiagnostic(issue?.correctionHint
      ?? (errorCode === 'EVALUATION_REJECTED'
        ? 'Developer Detailの個別の評価エラーを確認し、該当工程を修正してください。'
        : ['MAX_REVISION_EXCEEDED', 'EVIDENCE_GENERATION_FAILED'].includes(errorCode)
          ? '直前の審査・検証エラーにある不足条件や参照先を確認してください。入力で観測が確認できない場合、再生成だけでは解消できません。未確認の証拠を推測で追加しないでください。'
        : '入力条件を変えずに、もう一度生成してください。')) };
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
  if (code === 'CODEX_USAGE_LIMIT_REACHED') return 'Codexの利用上限に達しています。利用枠の回復後にもう一度実行してください。';
  if (code === 'CODEX_TIMEOUT') return 'Codexの応答が時間内に完了しませんでした。';
  if (code === 'CODEX_MODEL_UNAVAILABLE') return '指定されたCodexモデルを利用できません。';
  if (code === 'CODEX_INPUT_TOO_LARGE') return 'Codexへ送る生成入力が上限を超えました。';
  if (code === 'CODEX_HTTP_ERROR') return 'Codexサービスとの通信に失敗しました。';
  if (code === 'MAX_REVISION_EXCEEDED') return '技術的に成立するScenarioを生成できませんでした。';
  if (code === 'GENERATION_CANCELLED') return 'ゲーム生成を中止しました。';
  if (code === 'CODEX_OUTPUT_SCHEMA_INVALID') return '生成用データ形式の内部エラーが発生しました。';
  if (code === 'EVALUATION_REJECTED') return 'ゲームの最終検証で問題が見つかりました。Developer Detailの理由を確認してください。';
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

function logPhase(session, phase, attempt, started, result, error = null) {
  console.info(JSON.stringify({ generationId: session.auto.generationId, phase, attempt,
    duration: Date.now() - started, result,
    ...(error?.code === 'CODEX_TIMEOUT' ? {
      timeoutMs: error.timeoutMs, elapsedMs: error.elapsedMs,
      promptBytes: error.promptBytes, stdoutBytes: error.stdoutBytes, stderrBytes: error.stderrBytes,
      exitCode: error.exitCode, terminationSignal: error.terminationSignal,
    } : {}) }));
}

async function measured(session, phase, attempt, operation) {
  const started = Date.now();
  try {
    const value = await operation(); logPhase(session, phase, attempt, started, 'SUCCESS');
    return value;
  } catch (error) {
    logPhase(session, phase, attempt, started, error.code ?? 'FAILED', error); throw error;
  }
}

const REPAIRABLE_CODES = [
  /MISSING/, /REQUIRED/, /REFERENCE/, /SCHEMA/, /FORMAT/, /MALFORMED/, /EVIDENCE/,
  /CONSISTENCY/, /ALIGNMENT/, /ATTRIBUTION/, /COVERAGE/, /NARRATIVE/, /TIMELINE/,
  // A generated cross-reference mismatch can be revised without changing verified facts.
  // Do not classify arbitrary *_MISMATCH (including upstream corruption) as repairable.
  /^CONTRADICTION_GROUND_MISMATCH$/,
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

function buildAutomaticProgression(session, courtQuestions) {
  const set = session.evidenceImportResult.evidenceSet;
  const artifacts = set.evidenceArtifacts.filter(item => item.type !== 'TESTIMONY');
  const testimony = set.evidenceArtifacts.filter(item => item.type === 'TESTIMONY');
  const statements = testimony.flatMap(item => item.testimony.statements);
  const firstAttack = [...session.configuration.attacks].sort((a, b) => a.order - b.order)[0];
  const firstNodeId = firstAttack?.investigationSourceNodeId;
  if (!firstNodeId || !artifacts.length || !statements.length) throw new CodexError(
    'GAME_CASE_INPUT_INCOMPLETE', 'Game Caseに必要なEvidenceまたはTestimonyが不足しています。',
    { phase: 'BUILDING_INVESTIGATION' });
  const stages = buildInvestigationStages(session.configuration, session.generationInput);
  const targets = stages.map((stage, index) => ({ schemaVersion: '1.0', targetId: stage.targetId,
    targetType: stage.targetType, displayName: stage.displayName,
    description: `${stage.displayName}に保管された事件資料。`,
    sourceNodeRef: { sourceType: 'NETWORK_NODE', sourceId: stage.sourceNodeId },
    availableActionIds: [...new Set(stage.routes.map(route => route.actionId))], initiallyAvailable: index === 0 }));
  const artifactRoutes = artifacts.map(artifact => {
    const sources = stages.flatMap(stage => stage.routes.map(route => ({ ...route, targetId: stage.targetId })))
      .filter(item => artifact.sourceRefs.some(ref =>
      ref.sourceType === 'ATTACK_GRAPH_ARTIFACT' && ref.attackNodeId === item.ground.attackNodeId
      && ref.sourceId === item.ground.sourceId));
    const route = sources.find(item => item.evidenceType === artifact.type);
    if (!route || new Set(sources.map(item => item.targetId)).size !== 1) throw new ValidationError(
      'SEQUENTIAL_EVIDENCE_SOURCE_MISMATCH', 'evidenceArtifacts.sourceRefs',
      '技術資料の取得元を一つの調査対象へ対応付けてください。異なる取得元の資料は分けてください。');
    return { targetId: route.targetId, actionId: route.actionId };
  });
  const evidenceDiscoveryRules = artifacts.map((artifact, index) => ({ schemaVersion: '1.0',
    ruleId: `discovery_auto_${index + 1}`, evidenceId: artifact.evidenceId,
    ...artifactRoutes[index],
    prerequisites: { requiredEvidenceIds: [],
      requiredCompletedActionIds: [] },
    discoveryResult: { publicMessage: '手がかりを見つけた。原文を読んで、証拠ファイルに残しておこう。', discovered: true,
      unlockedTargetIds: targets.slice(targets.findIndex(target => target.targetId === artifactRoutes[index].targetId) + 1,
        targets.findIndex(target => target.targetId === artifactRoutes[index].targetId) + 2).map(target => target.targetId),
      nextHints: ['この調査先の資料を登録したら、そこから分かることを4択で選ぼう。'] }, repeatable: false }));
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
  const openingEvidence = [artifacts.find((item, index) => artifactRoutes[index].targetId === targets[0].targetId)];
  // Contradiction array order is not the investigation order. Match the first
  // staged testimony to the opening source instead of quoting a later claim.
  const openingStatementId = statements.find(item => set.contradictions
    .some(contradiction => contradiction.statementRef === item.statementId))?.statementId ?? statements[0].statementId;
  return buildGameProgressionPlan({ scenarioId: set.scenarioId,
    evidenceSetId: set.evidenceSetId, attackGraphRef: set.attackGraphRef,
    initialCourtEvidenceIds: openingEvidence.map(item => item?.evidenceId),
    initialCourtStatementIds: [openingStatementId],
    investigationEvidenceIds: artifacts.map(item => item.evidenceId),
    investigationActions: structuredClone(DEFAULT_INVESTIGATION_ACTIONS),
    investigationTargets: targets, evidenceDiscoveryRules,
    initialAvailableTargetIds: [targets[0].targetId],
    retrialStatementIds: statements.map(item => item.statementId),
    returnToCourtCondition: 'CURRENT_TARGET_EVIDENCE_COLLECTED',
    courtRoundCount: stages.length, investigationMode: 'SEQUENTIAL_TARGETS',
    courtIssueMode: 'DISTINCT_CLAIMS', courtQuestions, objectionRules,
    retryPolicy: { maxCourtAttempts: 3, onFailure: 'RETURN_TO_INVESTIGATION',
      onLimitReached: 'BLOCKED' },
    publicMessages: {
      incidentOverview: buildIncidentOverview(session.configuration, session.generationInput),
      prosecutionOpening: buildProsecutionOpening(openingEvidence,
        statements.filter(item => item.statementId === openingStatementId)),
      initialRuling: '疑いだけでは判断できません。弁護人は記録を調べ、主張の根拠を確かめてください。',
      acquittalRuling: '被告人を無罪とします。',
      acquittalExplanation: buildIncidentConclusion(session.configuration, session.generationInput),
      failureFeedback: 'その推理は、この証拠では支えられません。同じ調査先に戻って、記録を読み直してください。' } });
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
  if (session.gameCaseResult.status !== 'READY' || session.gameMakeResult.status !== 'BUILT') {
    const issue = [...session.gameCaseResult.errors, ...session.gameMakeResult.errors][0];
    throw new CodexError(issue?.code ?? 'GAME_BUILD_FAILED',
      issue?.reason ?? '既存Game Case Contractへ変換できませんでした。',
      { phase: 'BUILDING_GAME' });
  }
}

// 全組合せが正解のdraftを修正する際は、既存の証拠・論証・証言を維持し、
// 裏付けのあるCONSISTENT statementとその公開文だけを既存TESTIMONYへ追記する。
function preservesCourtChoiceRevision(base, draft) {
  const { evidenceArtifacts: originals, ...baseFields } = base;
  const { evidenceArtifacts: revised, ...revisedFields } = draft;
  if (!sameValues(baseFields, revisedFields) || originals.length !== revised.length) return false;
  return originals.every(original => {
    const revision = revised.find(item => item.evidenceId === original.evidenceId);
    if (!revision) return false;
    if (original.type !== 'TESTIMONY') return sameValues(original, revision);
    const { publicContent, testimony, ...fields } = original;
    const { publicContent: newContent, testimony: newTestimony, ...newFields } = revision;
    if (!sameValues(fields, newFields) || !newTestimony
      || newTestimony.witnessCharacterId !== testimony.witnessCharacterId
      || !newContent.startsWith(publicContent)
      || !sameValues(newTestimony.statements.slice(0, testimony.statements.length), testimony.statements)) {
      return false;
    }
    return newTestimony.statements.slice(testimony.statements.length).every(statement =>
      statement.technicalAssessment === 'CONSISTENT' && !statement.contradictionCandidate
      && statement.groundTruthRefs.length > 0);
  });
}

// A fresh CLI invocation has no access to the failed draft. Give the Evidence Agent
// the exact conflicting references, retaining the draft as untrusted data, not instructions.
function buildEvidenceGroundRevision(draft, issues) {
  if (!issues.length || issues.some(item => item.code !== 'CONTRADICTION_GROUND_MISMATCH')) return null;
  const fields = new Set(issues.map(item => item.field));
  const mismatches = draft.contradictions.filter(item => fields.has(
    `contradictions.${item.contradictionId}.groundTruthRefs`)).map(contradiction => {
    const testimony = draft.evidenceArtifacts.find(item => item.evidenceId === contradiction.testimonyEvidenceId);
    const statement = testimony?.testimony?.statements.find(item => item.statementId === contradiction.statementRef);
    return statement ? { contradictionId: contradiction.contradictionId,
      testimonyEvidenceId: contradiction.testimonyEvidenceId, statementId: statement.statementId,
      statementGroundTruthRefs: statement.groundTruthRefs,
      contradictionGroundTruthRefs: contradiction.groundTruthRefs,
      unexpectedGroundTruthRefs: contradiction.groundTruthRefs.filter(ref => !statement.groundTruthRefs.includes(ref)),
    } : null;
  }).filter(Boolean);
  return mismatches.length ? structuredClone({ schemaVersion: '1.0', draft, mismatches }) : null;
}

function preservesEvidenceGroundRevision(revision, draft) {
  // Compare copies with only the reported reference slots omitted. Never intersect,
  // merge, or overwrite the model's actual references to make validation pass.
  const withoutRevisableRefs = value => {
    const copy = structuredClone(value);
    for (const mismatch of revision.mismatches) {
      const contradiction = copy.contradictions.find(item => item.contradictionId === mismatch.contradictionId);
      const testimony = copy.evidenceArtifacts.find(item => item.evidenceId === mismatch.testimonyEvidenceId);
      const statement = testimony?.testimony?.statements.find(item => item.statementId === mismatch.statementId);
      if (contradiction) delete contradiction.groundTruthRefs;
      if (statement) delete statement.groundTruthRefs;
    }
    return copy;
  };
  return sameValues(withoutRevisableRefs(revision.draft), withoutRevisableRefs(draft));
}

function feedbackFromIssues(issues, classification) {
  return { classification, errors: (issues ?? []).map(item => ({ code: item.code,
    field: item.field, reason: item.reason, correctionHint: item.correctionHint,
    ...(item.evidenceId ? { evidenceId: item.evidenceId } : {}),
    ...(item.requirementId ? { requirementId: item.requirementId } : {}) })) };
}

function compactCondition(item) {
  return { source: item.source, predicate: item.predicate, args: item.args,
    value: item.value, description: item.description };
}

function compactAttackDefinition(definition) {
  return {
    id: definition.id, label: definition.label, category: definition.category,
    description: definition.description,
    supportedInvestigationTypes: definition.supportedInvestigationTypes,
    bindings: definition.bindings,
    requiredRoles: definition.requiredRoles,
    platforms: definition.platforms,
    requiredServices: definition.requiredServices,
    prerequisites: definition.prerequisites.map(compactCondition),
    requiredPrivileges: definition.requiredPrivileges.map(compactCondition),
    requiredReachability: definition.requiredReachability,
    effects: definition.effects.map(compactCondition),
    observableArtifacts: definition.observableArtifacts.map(item => ({ id: item.id,
      description: item.description, conditions: item.conditions.map(compactCondition) })),
  };
}

function makotomaruInput(request) {
  return { request,
    allowedAttacks: makotomaruCatalog.map(compactAttackDefinition),
    networkTemplate: autoAuthorBootstrap().defaultNetwork,
    investigationTypes: Object.entries(INVESTIGATION_TYPES).map(([id, item]) => ({
      id, label: item.label,
    })),
  };
}

function constrainedString(schema, values) {
  return { ...schema, enum: [...new Set(values)] };
}

export function buildMakotomaruOutputSchema(request) {
  const schema = structuredClone(AUTO_CODEX_OUTPUT_SCHEMAS.makotomaru.canonicalSchema);
  const configuration = schema.properties.configuration.properties;
  const attack = configuration.attacks.items.properties;
  const network = autoAuthorBootstrap().defaultNetwork;
  const nodeIds = network.nodes.map(item => item.nodeId);
  const serviceIds = network.services.map(item => item.serviceId);
  configuration.mode = { const: 'MAKOTOMARU' };
  configuration.difficulty = { const: request.difficulty };
  configuration.evidenceCount = { const: request.difficulty };
  attack.attackId = constrainedString(attack.attackId, makotomaruCatalog.map(item => item.id));
  attack.sourceNodeId = constrainedString(attack.sourceNodeId, nodeIds);
  attack.targetNodeId = constrainedString(attack.targetNodeId, nodeIds);
  attack.targetServiceId = constrainedString(attack.targetServiceId, serviceIds);
  attack.investigationSourceNodeId = constrainedString(attack.investigationSourceNodeId,
    nodeIds);
  attack.expectedEffect = constrainedString(attack.expectedEffect,
    makotomaruCatalog.flatMap(item => item.effects.map(effect => effect.description)));
  return schema;
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
    if (this.active) throw new GameError('GENERATION_LOCKED', 'generation',
      '現在ゲームを生成中です。', 409);
    resetForGeneration(session, { mode: 'MANUAL', difficulty: configuration?.difficulty });
    session.auto.maxAttempts = this.maxAttempts;
    const normalized = normalizeScenarioConfiguration(configuration, catalog);
    session.configuration = structuredClone(normalized);
    const validation = validateScenarioConfiguration(normalized, catalog);
    session.configurationValidation = { status: validation.status,
      errors: structuredClone(validation.errors) };
    if (validation.status !== 'VALID') {
      session.auto.details.push(...validation.errors.map(item => detail(item,
        'MANUAL_CONFIGURATION', null)));
      session.auto.state = 'MANUAL_CONFIGURATION';
      return autoAuthorView(session);
    }
    session.configurationValidation = { status: 'VALID', errors: [] };
    // #begin starts an async operation; publish the busy state before its first await.
    session.auto.state = 'MANUAL_CONFIGURATION';
    return this.#begin(session, signal => this.#createDraft(session, signal));
  }

  startMakotomaru(session, request) {
    if (this.active) throw new GameError('GENERATION_LOCKED', 'generation',
      '現在ゲームを生成中です。', 409);
    try { validateDocument('makotomaru-request', request); }
    catch (error) { throw new GameError(error.code ?? 'INVALID_MAKOTOMARU_REQUEST',
      error.field ?? 'request', error.message); }
    resetForGeneration(session, { mode: 'MAKOTOMARU', difficulty: request.difficulty });
    session.auto.maxAttempts = this.maxAttempts;
    session.makotomaruRequest = structuredClone(request);
    // #begin starts an async operation; publish the busy state before its first await.
    session.auto.state = 'MAKOTOMARU_CONFIGURATION';
    return this.#begin(session, signal => this.#createMakotomaruDraft(session, signal));
  }

  submitSelection(session, request) {
    if (this.active) throw new GameError('GENERATION_LOCKED', 'generation',
      '現在ゲームを生成中です。', 409);
    let configuration;
    try { configuration = createSelectionConfiguration(request, catalog); }
    catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      throw new GameError(error.code, error.field, error.message);
    }
    this.submitManual(session, configuration);
    session.auto.selection = { mode: 'MANUAL', inputMode: 'ATTACK_SETTING',
      request: structuredClone(request) };
    return autoAuthorView(session);
  }

  approve(session) {
    if (session.auto.state !== 'SCENARIO_PREVIEW' || !session.scenarioPackage
      || session.verificationResult?.status !== 'VERIFIED') {
      throw new GameError('SCENARIO_PREVIEW_REQUIRED', 'approval',
        '独立検証済みでPreview中のScenarioだけを承認できます。', 409);
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
      (error.phase === 'GENERATING_EVIDENCE' ? session.auto.progress.evidence.attempt : session.auto.attempt) || null));
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
      const revisionInput = buildScenarioRevisionInput({ generationInput: session.generationInput,
        configuration: session.configuration, scenarioPackage: session.scenarioPackage });
      const revision = await measured(session, phase, attempt,
        () => this.jsonRunner.runJson({ instruction: SCENARIO_REVISION_PROMPT,
          data: revisionInput, feedback,
          outputSchema: AUTO_CODEX_OUTPUT_SCHEMAS.scenarioRevision.canonicalSchema,
          outputSchemaName: AUTO_CODEX_OUTPUT_SCHEMAS.scenarioRevision.name, phase, signal }));
      session.scenarioPackage = applyScenarioRevision({ revision, scenarioPackage: session.scenarioPackage,
        configuration: session.configuration, generationInput: session.generationInput });
      complete(session, attempt === 1 ? 'scenario' : 'revision', attempt);
      if (attempt > 1) complete(session, 'scenario', attempt);
      return true;
    } catch (error) {
      if (!(error instanceof ValidationError) && !(error instanceof CodexOutputError)) throw error;
      const item = { code: error.code ?? 'SCENARIO_SCHEMA_INVALID',
        field: error.field ?? 'scenario-revision', reason: error.message,
        correctionHint: error.correctionHint ?? 'scenario-revision Schemaに適合する修正差分だけを返してください。' };
      session.auto.details.push(detail(item, phase, attempt));
      return this.#generateScenario(session, signal,
        { ...feedbackFromIssues([...(feedback?.errors ?? []), item], 'REPAIRABLE_BLOCKED'),
          ...(feedback?.revisionTargets ? { revisionTargets: feedback.revisionTargets } : {}) });
    }
  }

  #createScenarioTemplate(session) {
    session.auto.attempt = 1;
    setPhase(session, 'SCENARIO_DRAFT', 'scenario', 1);
    session.scenarioPackage = buildScenarioTemplate({
      generationInput: session.generationInput, configuration: session.configuration,
    });
    validateDocument('scenario-import-package', session.scenarioPackage);
    complete(session, 'scenario', 1);
  }

  async #validateReviewForPreview(session, signal) {
    while (session.auto.attempt <= this.maxAttempts) {
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
        continue;
      }
      const coverageIssues = validateScenarioEvidenceCoverage({
        generationInput: session.generationInput, configuration: session.configuration,
        scenarioPackage: session.scenarioPackage });
      if (coverageIssues.length) {
        session.auto.details.push(...coverageIssues.map(item => detail(item,
          'SCENARIO_VALIDATING', attempt)));
        await this.#generateScenario(session, signal,
          feedbackFromIssues(coverageIssues, 'REPAIRABLE_BLOCKED'));
        continue;
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
      if (verification.status === 'VERIFIED') {
        complete(session, 'verification', attempt); session.auto.state = 'VERIFIED';
        session.scenarioPreview = buildScenarioPreview(session.configuration, session.scenarioPackage, session.generationInput);
        session.scenarioPreview.verification = { status: verification.status,
          checks: verification.checks.map(check => ({ category: check.category,
            outcome: check.outcome, reason: check.reason })) };
        session.userApproval = null; session.auto.state = 'SCENARIO_PREVIEW';
        return;
      }
      const issues = verification.issues ?? [];
      const classification = verification.status === 'NEEDS_REVISION'
        ? 'REPAIRABLE_BLOCKED' : classifyBlocked(issues);
      session.auto.details.push(...issues.map(item => detail(item, 'SCENARIO_REVIEWING', attempt)));
      if (classification === 'HARD_BLOCKED') throw new CodexError('HARD_BLOCKED',
        'Independent Verificationを継続できません。', { phase: 'SCENARIO_REVIEWING' });
      await this.#generateScenario(session, signal,
        verification.revisionFeedback ?? feedbackFromIssues(issues, classification));
    }
    throw new CodexError('MAX_REVISION_EXCEEDED',
      '最大試行回数までに検証済みScenarioを作成できませんでした。',
      { phase: 'SCENARIO_REVISING' });
  }

  async #createDraft(session, signal) {
    await this.#ensureCodex(session, signal); this.#prepare(session);
    complete(session, 'configuration');
    this.#createScenarioTemplate(session);
    await this.#validateReviewForPreview(session, signal);
  }

  async #createMakotomaruDraft(session, signal) {
    await this.#ensureCodex(session, signal);
    setPhase(session, 'MAKOTOMARU_CONFIGURATION', 'configuration');
    let feedback = null;
    const outputSchema = buildMakotomaruOutputSchema(session.makotomaruRequest);
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      session.auto.attempt = attempt;
      mark(session, 'configuration', 'RUNNING', attempt);
      const result = await measured(session, 'MAKOTOMARU_CONFIGURATION', attempt,
        () => this.jsonRunner.runJson({ instruction: MAKOTOMARU_PROMPT,
          data: makotomaruInput(session.makotomaruRequest), feedback,
          outputSchema,
          outputSchemaName: AUTO_CODEX_OUTPUT_SCHEMAS.makotomaru.name,
          phase: 'MAKOTOMARU_CONFIGURATION', signal }));
      let errors = [];
      try { validateDocument('makotomaru-result', result);
        result.configuration.mode = 'MAKOTOMARU';
        result.configuration.difficulty = session.makotomaruRequest.difficulty;
        result.configuration.evidenceCount = session.makotomaruRequest.difficulty;
        result.configuration = normalizeScenarioConfiguration(result.configuration, catalog);
        const validation = validateScenarioConfiguration(result.configuration, catalog);
        errors = validation.errors;
      } catch (error) { errors = [{ code: error.code ?? 'MAKOTOMARU_OUTPUT_INVALID',
        field: error.field ?? 'makotomaru-result', reason: error.message,
        correctionHint: 'Scenario Configuration Contractに適合させてください。' }]; }
      if (!errors.length) {
        session.configuration = structuredClone(result.configuration);
        session.configurationValidation = { status: 'VALID', errors: [] };
        complete(session, 'configuration', attempt); this.#prepare(session);
        this.#createScenarioTemplate(session);
        await this.#validateReviewForPreview(session, signal); return;
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
    if (session.verificationResult?.status !== 'VERIFIED') throw new CodexError(
      'SCENARIO_NOT_VERIFIED', '独立検証済みScenarioではありません。',
      { phase: 'USER_APPROVED' });
    session.auto.state = 'VERIFIED';

    setPhase(session, 'EVIDENCE_BUILDING', 'evidence');
    session.evidenceGenerationInput = buildEvidenceGenerationInput({
      scenarioVerificationInput: session.verificationInput,
      verificationResult: session.verificationResult });
    if (session.evidenceGenerationInput.status !== 'READY') throw new CodexError(
      'HARD_BLOCKED', 'Evidence Generation Inputを作成できません。',
      { phase: 'GENERATING_EVIDENCE' });
    let evidenceFeedback = null;
    let evidenceProgressionPlan = null;
    let courtChoiceRevisionBase = null;
    let evidenceGroundRevision = null;
    const evidenceDraftInput = buildEvidenceGenerationDraftInput(session.evidenceGenerationInput);
    const investigationStages = buildInvestigationStages(session.configuration, session.generationInput);
    const questionBackgrounds = investigationStages.map((stage, index) => ({ targetId: stage.targetId,
      description: buildQuestionBackground(investigationStages, index, session.generationInput) }));
    for (let evidenceAttempt = 1; evidenceAttempt <= 2; evidenceAttempt += 1) {
      mark(session, 'evidence', 'RUNNING', evidenceAttempt);
      let evidencePackage;
      let draft;
      try {
        draft = await measured(session, 'GENERATING_EVIDENCE', evidenceAttempt,
          () => this.jsonRunner.runJson({ instruction: EVIDENCE_PROMPT_TEMPLATE,
            data: { evidenceDraftInput,
              learningObservationFields: Object.fromEntries(buildInvestigationStages(session.configuration, session.generationInput)
                .flatMap(stage => stage.routes).filter(route => LEARNING_OBSERVATION_FIELDS[route.ground.sourceId])
                .map(route => [route.ground.sourceId, LEARNING_OBSERVATION_FIELDS[route.ground.sourceId]])),
              ...(courtChoiceRevisionBase ? { courtChoiceRevisionBase } : {}),
              ...(evidenceGroundRevision ? { evidenceGroundRevision } : {}),
              investigationStages, questionBackgrounds,
              requestedCourtIssueCount: requestedCourtIssueCount(session.configuration, session.generationInput),
              requestedEvidenceChainLength: session.configuration.difficulty }, feedback: evidenceFeedback,
            outputSchema: AUTO_CODEX_OUTPUT_SCHEMAS.evidenceDraft.canonicalSchema,
            outputSchemaName: AUTO_CODEX_OUTPUT_SCHEMAS.evidenceDraft.name,
            phase: 'GENERATING_EVIDENCE', signal }));
        evidencePackage = materializeEvidenceGenerationDraft(draft);
        validateGeneratedLogFormats(evidencePackage.evidenceArtifacts);
        validateLearningObservations(evidencePackage.evidenceArtifacts);
      } catch (error) {
        if (!(error instanceof CodexOutputError) && !(error instanceof ValidationError)) throw error;
        const issue = { code: error.code, field: error.field ?? 'evidence-generation-draft',
          reason: error.message,
          correctionHint: '指定draft Schemaに適合する単一JSONオブジェクトを返し、integrityは出力しないでください。既存のRequirement・ground・証言・複数資料の参照を維持してください。' };
        session.auto.details.push(detail(issue, 'GENERATING_EVIDENCE', evidenceAttempt));
        evidenceFeedback = feedbackFromIssues([issue], 'REPAIRABLE_BLOCKED');
        continue;
      }
      if (evidenceGroundRevision && !preservesEvidenceGroundRevision(evidenceGroundRevision, draft)) {
        const issues = [{ code: 'EVIDENCE_GROUND_REPAIR_CHANGED_INPUT', field: 'evidence-generation-draft',
          reason: '根拠参照の修正で、対象以外の証拠・証言・論証・4択が変更されています。',
          correctionHint: 'evidenceGroundRevision.draftを維持し、mismatchesで指定されたContradictionと対象statementのgroundTruthRefsだけを、検証済みfactと資料の意味に基づいて見直してください。' }];
        session.auto.details.push(...issues.map(item => detail(item, 'GENERATING_EVIDENCE', evidenceAttempt)));
        evidenceFeedback = feedbackFromIssues(issues, 'REPAIRABLE_BLOCKED');
        continue;
      }
      if (courtChoiceRevisionBase && !preservesCourtChoiceRevision(courtChoiceRevisionBase, draft)) {
        const issues = [{ code: 'EVIDENCE_COURT_REPAIR_CHANGED_INPUT', field: 'evidence-generation-draft',
          reason: '誤答選択肢の修正で、既存の証拠・論証・証言が変更されています。',
          correctionHint: 'courtChoiceRevisionBaseを維持し、既存TESTIMONYのstatementsとpublicContentの末尾に、既存Ground Truthと資料に裏付けられるCONSISTENTな発言だけを追記してください。' }];
        session.auto.details.push(...issues.map(item => detail(item, 'GENERATING_EVIDENCE', evidenceAttempt)));
        evidenceFeedback = feedbackFromIssues(issues, 'REPAIRABLE_BLOCKED');
        continue;
      }
      session.evidenceImportResult = importEvidencePackage({
        generationInput: session.evidenceGenerationInput, evidencePackage });
      const evidenceImported = session.evidenceImportResult;
      let issues = [...evidenceImported.errors];
      // The draft's artifact/contradiction schemas have already been checked.
      // Collect question defects even when provenance failed, so the same bounded
      // repair can address both. No invalid import can proceed to game creation.
      try { validateCourtQuestionSources(draft.courtQuestions, evidencePackage,
        session.evidenceGenerationInput.evidenceAgentInput); }
      catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        issues.push({ code: error.code, field: error.field, reason: error.message,
          correctionHint: '該当の4択の問題文で、選択された攻撃の仕組みと必要な用語を簡潔に示し、supportingQuotesに引用した公開原文の対象・値を使って事件の段階を問うてください。解説では各資料の値を比較してください。引用と技術資料は維持し、参照のエラーも同じ修正で解消してください。' });
      }
      if (evidenceImported.status === 'VALID') {
        issues.push(...courtIssueGenerationProblems(evidenceImported.evidenceSet,
          requestedCourtIssueCount(session.configuration, session.generationInput)));
        issues.push(...stageEvidenceProblems(evidenceImported.evidenceSet, session.scenarioPackage));
        if (issues.length) {
          session.auto.details.push(...issues.map(item => detail(item, 'GENERATING_EVIDENCE', evidenceAttempt)));
          evidenceFeedback = feedbackFromIssues(issues, 'REPAIRABLE_BLOCKED');
          continue;
        }
        let plan;
        try {
          plan = buildAutomaticProgression(session, draft.courtQuestions);
          validateSequentialPlan(plan, evidenceImported.evidenceSet);
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          issues = [{ code: error.code, field: error.field, reason: error.message,
            correctionHint: 'investigationStagesの順に、各対象で新しく得た資料と過去の資料だけで解ける主張・4択・根拠を作ってください。取得元と技術的事実は維持します。' }];
          session.auto.details.push(...issues.map(item => detail(item, 'GENERATING_EVIDENCE', evidenceAttempt)));
          evidenceFeedback = feedbackFromIssues(issues, 'REPAIRABLE_BLOCKED');
          continue;
        }
        const presentableEvidenceIds = evidenceImported.evidenceSet.evidenceArtifacts
          .filter(item => item.type !== 'TESTIMONY' && plan.investigationEvidenceIds.includes(item.evidenceId))
          .map(item => item.evidenceId);
        const issueTargets = [...new Set(plan.objectionRules.map(rule => rule.targetStatementId))];
        if (issueTargets.every(target => findIncorrectObjectionPair({
          statementIds: plan.retrialStatementIds.filter(id => id === target || !issueTargets.includes(id)),
          presentableEvidenceIds, objectionRules: plan.objectionRules.filter(rule => rule.targetStatementId === target) }))) {
          evidenceProgressionPlan = plan;
          break;
        }
        courtChoiceRevisionBase ??= structuredClone(draft);
        issues = [{ code: 'EVIDENCE_NO_INCORRECT_OBJECTION_PAIR',
          field: 'evidenceArtifacts.testimony.statements',
          reason: '提示可能な技術Evidenceと証言の全組合せが正解で、誤答・再試行・試行上限の経路を構成できません。',
          correctionHint: 'courtChoiceRevisionBaseの証拠・論証・既存証言を変更せず、既存資料とGround Truthに裏付けられるCONSISTENTな発言を既存TESTIMONYのstatementsとpublicContentの末尾へ追記してください。正解の削除、無関係な資料や人物事実の追加は禁止です。' }];
      }
      session.auto.details.push(...issues.map(item => detail(item,
        'GENERATING_EVIDENCE', evidenceAttempt)));
      if (classifyBlocked(issues) === 'HARD_BLOCKED') break;
      if (evidenceAttempt < 2 && evidenceImported.status === 'INVALID') {
        evidenceGroundRevision ??= buildEvidenceGroundRevision(draft, issues);
      }
      evidenceFeedback = feedbackFromIssues(issues, 'REPAIRABLE_BLOCKED');
    }
    if (!evidenceProgressionPlan) throw new CodexError(
      'EVIDENCE_GENERATION_FAILED', '有効なEvidence Packageを生成できませんでした。',
      { phase: 'GENERATING_EVIDENCE' });
    complete(session, 'evidence', session.auto.progress.evidence.attempt);

    setPhase(session, 'INVESTIGATION_BUILDING', 'investigation');
    session.investigationAssignments = buildInvestigationAssignments(session.configuration);
    session.evidenceChain = session.evidenceImportResult.evidenceSet.evidenceArtifacts
      .slice(0, session.configuration.evidenceCount).map(item => item.evidenceId);
    session.progressionPlan = evidenceProgressionPlan;
    complete(session, 'investigation');
    setPhase(session, 'DIALOGUE_BUILDING', 'dialogue');
    session.dialoguePlan = assignDialogueTemplate({ configuration: session.configuration,
      scenarioPackage: session.scenarioPackage,
      generationInput: session.generationInput,
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
    if (session.evaluationResult.status !== 'ACCEPTED') {
      // Evaluationはfieldではなくtargetを返す。内部成果物全体を公開せず、
      // 個別の理由と修正指針だけを既存の安全な診断表示へ引き継ぐ。
      session.auto.details.push(...(session.evaluationResult.issues ?? []).map(item => detail({
        code: item.code, field: item.target, reason: item.reason,
        correctionHint: item.correctionHint,
      }, 'EVALUATING', session.auto.attempt)));
      throw new CodexError('EVALUATION_REJECTED', 'EvaluationがGameを拒否しました。',
        { phase: 'EVALUATING' });
    }
    complete(session, 'evaluation');
    if (session.auto.progress.revision.status === 'WAITING') {
      session.auto.progress.revision.status = 'SKIPPED';
    }
    session.auto.state = 'READY'; session.auto.completedAt = new Date().toISOString();
  }

}
