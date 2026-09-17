import { readFile } from 'node:fs/promises';
import { ValidationError, validateDocument } from './schema.js';
import {
  canonical,
  digest,
  evidenceAgentFingerprint,
  evidenceSetCore,
  sameValues,
  validateEvidenceAgentInput,
  validateEvidenceArtifact,
  validateEvidenceConsistency,
  validateEvidenceFeedback,
  validateEvidenceImportResult,
  validateEvidenceSet,
  validateGameCaseHandoff,
} from './evidence-validator.js';

export const EVIDENCE_PROMPT_TEMPLATE_VERSION = '1.0';
export const EVIDENCE_PROMPT_TEMPLATE = await readFile(
  new URL('../../prompts/evidence-generation-v1.md', import.meta.url), 'utf8');

const OUTPUT_SCHEMA_NAMES = ['evidence-import-package', 'evidence-artifact', 'contradiction', 'exoneration'];
const OUTPUT_SCHEMAS = new Map(await Promise.all(OUTPUT_SCHEMA_NAMES.map(async name => [name,
  JSON.parse(await readFile(new URL(`../../schemas/${name}.schema.json`, import.meta.url), 'utf8')),
])));

function generationRef(input) {
  return input.evidenceAgentInput ? {
    evidenceGenerationInputId: input.evidenceGenerationInputId,
    inputFingerprint: input.evidenceAgentInput.inputFingerprint,
    verificationId: input.evidenceAgentInput.verificationResult.verificationId,
  } : null;
}

function externalIssue(error, hint, evidenceId = null, requirementId = null, sourceRefs = ['evidence-import-package']) {
  return {
    code: error.code ?? 'INVALID_EVIDENCE_PACKAGE',
    field: error.field ?? 'evidence-import-package', evidenceId, requirementId,
    reason: error.message, correctionHint: hint, sourceRefs,
  };
}

function blockIssue(error) {
  return {
    code: error.code ?? 'EVIDENCE_GENERATION_BLOCKED', field: error.field ?? 'evidence-agent-input',
    reason: error.message, correctionHint:
      'Phase 6以前の正本からVerification ResultとEvidence Agent Handoffを再生成してください。',
    sourceRefs: ['phase6:verification'],
  };
}

function outputContract() {
  return {
    schemaVersion: '1.0',
    requiredArtifacts: ['evidenceArtifacts', 'contradictions', 'exonerations'],
    schemas: OUTPUT_SCHEMA_NAMES.map(name => ({ name, schemaVersion: '1.0',
      jsonSchema: structuredClone(OUTPUT_SCHEMAS.get(name)) })),
  };
}

export function buildEvidenceAgentInput({ scenarioVerificationInput, verificationResult }) {
  const scenarioPackage = scenarioVerificationInput.scenarioPackage;
  const technical = scenarioVerificationInput.generationInput.technicalInput;
  const core = {
    scenarioVerificationInput: structuredClone(scenarioVerificationInput),
    verificationResult: structuredClone(verificationResult),
    evidenceAgentHandoff: structuredClone(verificationResult.evidenceAgentHandoff),
    scenarioImportPackage: structuredClone(scenarioPackage),
    groundTruth: structuredClone(scenarioPackage.groundTruth),
    timeline: structuredClone(scenarioPackage.timeline),
    characters: structuredClone(scenarioPackage.characters),
    learningObjectives: structuredClone(scenarioPackage.learningObjectives),
    evidenceRequirements: structuredClone(scenarioPackage.evidenceRequirements),
    attackGraph: structuredClone(technical.attackGraph), network: structuredClone(technical.network),
    scenarioContext: structuredClone(technical.scenarioContext),
    attackDefinitions: structuredClone(technical.attackDefinitions),
  };
  const inputFingerprint = digest(core);
  return validateEvidenceAgentInput({
    schemaVersion: '1.0', evidenceAgentInputId: `evidence_agent_input_${inputFingerprint.slice(0, 20)}`,
    inputFingerprint, ...core,
  });
}

export function validateEvidenceGenerationInput(input) {
  validateDocument('evidence-generation-input', input);
  if (input.status === 'READY') {
    if (input.blocked || input.issues.length || !input.evidenceAgentInput || !input.outputContract) {
      throw new ValidationError('INVALID_EVIDENCE_GENERATION_INPUT', 'evidence-generation-input.status',
        'READY入力にBLOCKED状態、issue、または欠落した契約があります。');
    }
    validateEvidenceAgentInput(input.evidenceAgentInput);
    if (input.evidenceGenerationInputId
      !== `evidence_generation_${input.evidenceAgentInput.inputFingerprint.slice(0, 20)}`) {
      throw new ValidationError('EVIDENCE_INPUT_FINGERPRINT_MISMATCH',
        'evidence-generation-input.evidenceGenerationInputId', 'Generation Input IDがfingerprintと一致しません。');
    }
    if (!sameValues(input.outputContract, outputContract())) {
      throw new ValidationError('INVALID_OUTPUT_CONTRACT', 'evidence-generation-input.outputContract',
        'Evidence Importの同梱SchemaがBackendの正本と一致しません。');
    }
  } else if (!input.blocked || !input.issues.length || input.evidenceAgentInput || input.outputContract) {
    throw new ValidationError('INVALID_EVIDENCE_GENERATION_INPUT', 'evidence-generation-input.status',
      'BLOCKED入力のissueまたは成果物状態が矛盾しています。');
  }
  return input;
}

// Provider/APIを呼ばず、外部Codexへ渡す自己完結した入力だけを作成する。
export function buildEvidenceGenerationInput({ scenarioVerificationInput, verificationResult }) {
  try {
    const evidenceAgentInput = buildEvidenceAgentInput({ scenarioVerificationInput, verificationResult });
    return validateEvidenceGenerationInput({
      schemaVersion: '1.0',
      evidenceGenerationInputId: `evidence_generation_${evidenceAgentInput.inputFingerprint.slice(0, 20)}`,
      status: 'READY', blocked: false, generatorMode: 'EXTERNAL_USER_CODEX',
      promptTemplateVersion: EVIDENCE_PROMPT_TEMPLATE_VERSION, issues: [], evidenceAgentInput,
      outputContract: outputContract(),
    });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const fingerprint = digest({ code: error.code, field: error.field, message: error.message,
      verificationId: verificationResult?.verificationId ?? null });
    return validateEvidenceGenerationInput({
      schemaVersion: '1.0', evidenceGenerationInputId: `evidence_generation_blocked_${fingerprint.slice(0, 20)}`,
      status: 'BLOCKED', blocked: true, generatorMode: 'EXTERNAL_USER_CODEX',
      promptTemplateVersion: EVIDENCE_PROMPT_TEMPLATE_VERSION,
      issues: [blockIssue(error)], evidenceAgentInput: null, outputContract: null,
    });
  }
}

function resultBase(input, scenarioId = null, attackGraphRef = null) {
  return {
    schemaVersion: '1.0', valid: false, scope: 'EXTERNAL_EVIDENCE_IMPORT',
    generationInputRef: generationRef(input), scenarioId, attackGraphRef,
    evidenceSet: null, gameCaseHandoff: null,
  };
}

function blockedResult(input, errors) {
  return validateEvidenceImportResult({
    ...resultBase(input), status: 'BLOCKED',
    validationStages: { upstream: 'FAILED', schema: 'NOT_RUN', consistency: 'NOT_RUN' },
    errors, feedback: null,
  });
}

function invalidResult(input, scenarioId, attackGraphRef, stages, errors) {
  const ref = generationRef(input);
  const feedback = validateEvidenceFeedback({
    schemaVersion: '1.0', status: 'INVALID', generationInputRef: ref,
    errors: structuredClone(errors),
  });
  return validateEvidenceImportResult({
    ...resultBase(input, scenarioId, attackGraphRef), status: 'INVALID', validationStages: stages,
    errors, feedback,
  });
}

function makeEvidenceSet(input, evidencePackage, validation) {
  const agentInput = input.evidenceAgentInput;
  const core = {
    scenarioId: evidencePackage.scenarioId,
    verificationId: agentInput.verificationResult.verificationId,
    attackGraphRef: structuredClone(evidencePackage.attackGraphRef),
    evidenceArtifacts: structuredClone(evidencePackage.evidenceArtifacts),
    requirementCoverage: validation.requirementCoverage,
    contradictionRefs: validation.contradictionRefs,
    contradictions: structuredClone(evidencePackage.contradictions),
    exonerationRefs: validation.exonerationRefs,
    exonerations: structuredClone(evidencePackage.exonerations),
  };
  const fingerprint = digest(core);
  return validateEvidenceSet({ schemaVersion: '1.0',
    evidenceSetId: `evidence_set_${fingerprint.slice(0, 20)}`, ...core, fingerprint });
}

function makeGameCaseHandoff(set) {
  return validateGameCaseHandoff({
    schemaVersion: '1.0', handoffId: `game_case_handoff_${set.fingerprint.slice(0, 20)}`,
    evidenceSetId: set.evidenceSetId, evidenceSetFingerprint: set.fingerprint,
    scenarioId: set.scenarioId, verificationId: set.verificationId,
    attackGraphRef: structuredClone(set.attackGraphRef), state: 'EVIDENCE_READY',
    eligibleForGameCaseGeneration: true,
  }, set);
}

// 外部JSONを自動修正せず、SchemaとConsistencyを通った場合だけEvidence Setへ昇格する。
export function importEvidencePackage({ generationInput, evidencePackage }) {
  try {
    validateEvidenceGenerationInput(generationInput);
    if (generationInput.status !== 'READY') return blockedResult(generationInput,
      generationInput.issues.map(item => ({ ...item, evidenceId: null, requirementId: null })));
    validateEvidenceAgentInput(generationInput.evidenceAgentInput);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return blockedResult(generationInput, [{ ...blockIssue(error), evidenceId: null, requirementId: null }]);
  }
  const input = generationInput.evidenceAgentInput;
  const expectedScenarioId = input.scenarioImportPackage.scenarioDraft.scenarioId;
  const expectedGraphRef = input.scenarioImportPackage.scenarioDraft.attackGraphRef;
  let scenarioId = evidencePackage?.scenarioId ?? null;
  try {
    validateDocument('evidence-import-package', evidencePackage);
    evidencePackage.evidenceArtifacts.forEach(validateEvidenceArtifact);
    evidencePackage.contradictions.forEach(item => validateDocument('contradiction', item));
    evidencePackage.exonerations.forEach(item => validateDocument('exoneration', item));
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return invalidResult(generationInput, scenarioId, expectedGraphRef,
      { upstream: 'PASSED', schema: 'FAILED', consistency: 'NOT_RUN' },
      [externalIssue(error, '同梱されたEvidence JSON Schema v1.0に合わせて構造を修正してください。')]);
  }
  const expectedRef = generationRef(generationInput);
  if (!sameValues(evidencePackage.generationInputRef, expectedRef)) {
    return invalidResult(generationInput, scenarioId, expectedGraphRef,
      { upstream: 'PASSED', schema: 'PASSED', consistency: 'FAILED' }, [{
        code: 'EVIDENCE_GENERATION_REFERENCE_MISMATCH', field: 'evidence-import-package.generationInputRef',
        evidenceId: null, requirementId: null,
        reason: 'Import Packageが対象Evidence Generation Inputを参照していません。',
        correctionHint: 'Generation Inputの参照値を変更せずコピーしてください。',
        sourceRefs: ['evidence-generation-input'],
      }]);
  }
  if (scenarioId !== expectedScenarioId || !sameValues(evidencePackage.attackGraphRef, expectedGraphRef)) {
    return invalidResult(generationInput, scenarioId, expectedGraphRef,
      { upstream: 'PASSED', schema: 'PASSED', consistency: 'FAILED' }, [{
        code: 'CROSS_SCENARIO_EVIDENCE', field: 'evidence-import-package', evidenceId: null,
        requirementId: null, reason: '別Scenarioまたは別Attack GraphのEvidenceが混入しています。',
        correctionHint: 'このGeneration InputのscenarioIdとattackGraphRefだけを使用してください。',
        sourceRefs: [`scenario:${expectedScenarioId}`, `attackGraph:${expectedGraphRef.graphId}`],
      }]);
  }
  const validation = validateEvidenceConsistency(evidencePackage, input);
  if (!validation.valid) return invalidResult(generationInput, scenarioId, expectedGraphRef,
    { upstream: 'PASSED', schema: 'PASSED', consistency: 'FAILED' }, validation.issues);
  const evidenceSet = makeEvidenceSet(generationInput, evidencePackage, validation);
  const gameCaseHandoff = makeGameCaseHandoff(evidenceSet);
  return validateEvidenceImportResult({
    ...resultBase(generationInput, scenarioId, expectedGraphRef), status: 'VALID', valid: true,
    validationStages: { upstream: 'PASSED', schema: 'PASSED', consistency: 'PASSED' },
    errors: [], feedback: null, evidenceSet, gameCaseHandoff,
  });
}

export { evidenceAgentFingerprint, evidenceSetCore, canonical };
