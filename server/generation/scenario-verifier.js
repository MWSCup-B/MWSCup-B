import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildAttackGraphs } from './attack-graph.js';
import { validateEnvironment } from './evaluator.js';
import {
  importScenarioPackage,
  validateScenarioGenerationInput,
  validateScenarioImportResult,
} from './scenario-interface.js';
import { validateScenarioContract } from './scenario-validator.js';
import { fail, validateDocument, ValidationError } from './schema.js';

export const MAX_REVISION_ATTEMPTS = 3;
export const SCENARIO_VERIFICATION_PROMPT_VERSION = '1.0';
export const SCENARIO_VERIFICATION_PROMPT = await readFile(
  new URL('../../prompts/scenario-verification-v1.md', import.meta.url), 'utf8');

const DETERMINISTIC_CATEGORIES = ['PHASE_5B_GATE', 'ATTACK_GRAPH_RECONSTRUCTION',
  'ENVIRONMENT_ALIGNMENT', 'GROUND_TRUTH_TRACEABILITY', 'TIMELINE_CONSISTENCY',
  'EVIDENCE_PRODUCIBILITY', 'REFERENCE_INTEGRITY'];
const SEMANTIC_CATEGORIES = ['EVIDENCE_GROUND_ALIGNMENT', 'LEARNING_OBJECTIVE_ALIGNMENT',
  'FACT_NARRATIVE_SEPARATION', 'IDENTITY_ATTRIBUTION', 'INVESTIGATION_COVERAGE',
  'REFERENCE_CONTENT_ALIGNMENT'];
const ALL_CATEGORIES = [...DETERMINISTIC_CATEGORIES, ...SEMANTIC_CATEGORIES];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function sameValues(left, right) {
  return canonical(left) === canonical(right);
}

function ensureUnique(items, key, field) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) fail('DUPLICATE_ID', field, '同じ識別子または参照が重複しています。');
    seen.add(value);
  }
}

function verificationCore(input) {
  return {
    generationInput: input.generationInput,
    importResult: input.importResult,
    scenarioPackage: input.scenarioPackage,
    referenceMaterials: input.referenceMaterials,
    allowedReviewRefs: input.allowedReviewRefs,
  };
}

function relevantReferences(generationInput) {
  const graph = generationInput.technicalInput.attackGraph;
  const catalog = new Map(generationInput.technicalInput.attackDefinitions.map(item => [item.id, item]));
  return graph.nodes.flatMap(node => {
    const definition = catalog.get(node.attackDefinitionId);
    if (!definition) fail('UNREGISTERED_ATTACK', 'scenario-verification-input.referenceMaterials',
      'Attack GraphのAttack Definitionが見つかりません。');
    return node.referenceIds.map(referenceId => {
      const reference = definition.references.find(item => item.id === referenceId);
      if (!reference) fail('BROKEN_REFERENCE', 'scenario-verification-input.referenceMaterials',
        'Attack GraphのreferenceIdをAttack Definitionへ追跡できません。');
      return { definition, reference };
    });
  });
}

function buildAllowedReviewRefs(generationInput, scenarioPackage, materials) {
  const { technicalInput } = generationInput;
  const graph = technicalInput.attackGraph;
  const refs = [
    `scenarioDraft:${scenarioPackage.scenarioDraft.scenarioId}`,
    ...graph.nodes.map(item => `attackGraph.node:${item.nodeId}`),
    ...graph.edges.map(item => `attackGraph.edge:${item.edgeId}`),
    ...graph.nodes.flatMap(node => node.evaluations.map(item => `attackGraph.evaluation:${item.evaluationId}`)),
    ...graph.nodes.flatMap(node => node.effects.map(item => `attackGraph.effect:${item.effectId}`)),
    ...graph.nodes.flatMap(node => node.artifactEvaluations.map(item =>
      `attackGraph.artifact:${node.nodeId}:${item.artifactId}`)),
    ...technicalInput.network.nodes.map(item => `network.node:${item.id}`),
    ...technicalInput.network.services.map(item => `network.service:${item.id}`),
    ...technicalInput.network.reachability.map(item => `network.reachability:${item.from}:${item.toService}`),
    ...technicalInput.candidate.assignments.map(item => `candidate.attack:${item.attackId}`),
    ...technicalInput.attackDefinitions.map(item => `attackDefinition:${item.id}`),
    ...scenarioPackage.groundTruth.technicalFacts.map(item => `groundTruth.fact:${item.factId}`),
    ...(scenarioPackage.groundTruth.caseFacts ?? []).map(item => `caseFact:${item.factId}`),
    ...scenarioPackage.timeline.events.map(item => `timeline.event:${item.eventId}`),
    ...scenarioPackage.characters.characters.map(item => `character:${item.characterId}`),
    ...scenarioPackage.learningObjectives.objectives.map(item => `learningObjective:${item.objectiveId}`),
    ...scenarioPackage.evidenceRequirements.requirements.map(item => `evidenceRequirement:${item.requirementId}`),
    ...materials.map(item => `referenceMaterial:${item.materialId}`),
  ];
  for (const source of ['vulnerabilities', 'attackerInitialPrivileges', 'requiredUserActions',
    'loggingConfiguration', 'authenticationConditions', 'otherConditions']) {
    technicalInput.scenarioContext[source].forEach((_, index) => refs.push(`scenarioContext.${source}:${index}`));
  }
  return [...new Set(refs)].sort();
}

function makeReferenceMaterials(generationInput, referenceContents) {
  if (!Array.isArray(referenceContents)) fail('INVALID_REFERENCE_CONTENT', 'referenceContents',
    '参考資料本文は配列で指定してください。');
  ensureUnique(referenceContents, item => JSON.stringify([item.attackDefinitionId, item.referenceId]),
    'referenceContents');
  const contents = new Map(referenceContents.map(item => [
    JSON.stringify([item.attackDefinitionId, item.referenceId]), item.content,
  ]));
  const materials = relevantReferences(generationInput).map(({ definition, reference }) => {
    const key = JSON.stringify([definition.id, reference.id]);
    const content = contents.get(key);
    if (content !== undefined && (typeof content !== 'string' || !content.length || content.length > 50_000)) {
      fail('INVALID_REFERENCE_CONTENT', 'referenceContents.content',
        '参考資料本文は1文字以上50000文字以下の文字列にしてください。');
    }
    contents.delete(key);
    return {
      materialId: `reference_${definition.id}_${reference.id}`,
      attackDefinitionId: definition.id, referenceId: reference.id,
      title: reference.title, url: reference.url,
      availability: content === undefined ? 'METADATA_ONLY' : 'CONTENT_AVAILABLE',
      content: content ?? null,
    };
  });
  if (contents.size) fail('BROKEN_REFERENCE', 'referenceContents',
    '選択Attack Graphで使用していない参考資料本文が含まれています。');
  ensureUnique(materials, item => item.materialId, 'referenceMaterials.materialId');
  return materials.sort((a, b) => a.materialId.localeCompare(b.materialId));
}

export function buildScenarioVerificationInput({ generationInput, importResult, scenarioPackage,
  referenceContents = [], revisionAttemptsUsed = 0 }) {
  validateScenarioGenerationInput(generationInput);
  validateScenarioImportResult(importResult);
  if (!Number.isSafeInteger(revisionAttemptsUsed) || revisionAttemptsUsed < 0) {
    fail('INVALID_ATTEMPT', 'revisionAttemptsUsed', '再試行回数は0以上の安全な整数で指定してください。');
  }
  const recomputed = importScenarioPackage({ generationInput, scenarioPackage });
  if (!sameValues(recomputed, importResult)) fail('PHASE_5B_RESULT_MISMATCH', 'importResult',
    'Phase 5B Import Resultを同じ入力から再現できません。');
  const referenceMaterials = makeReferenceMaterials(generationInput, referenceContents);
  const allowedReviewRefs = buildAllowedReviewRefs(generationInput, scenarioPackage, referenceMaterials);
  const core = { generationInput: structuredClone(generationInput), importResult: structuredClone(importResult),
    scenarioPackage: structuredClone(scenarioPackage), referenceMaterials, allowedReviewRefs };
  const inputFingerprint = digest(core);
  return validateScenarioVerificationInput({
    schemaVersion: '1.0', verificationInputId: `verification_input_${inputFingerprint.slice(0, 20)}`,
    inputFingerprint,
    attempt: { revisionAttemptsUsed, maxRevisionAttempts: MAX_REVISION_ATTEMPTS },
    ...core,
  });
}

function validateReferenceMaterials(input) {
  ensureUnique(input.referenceMaterials, item => item.materialId, 'referenceMaterials.materialId');
  ensureUnique(input.referenceMaterials,
    item => JSON.stringify([item.attackDefinitionId, item.referenceId]), 'referenceMaterials');
  const expected = relevantReferences(input.generationInput);
  if (expected.length !== input.referenceMaterials.length) fail('REFERENCE_MATERIAL_MISMATCH',
    'referenceMaterials', 'Attack Graphの全referenceIdに対応する資料情報が必要です。');
  for (const { definition, reference } of expected) {
    const material = input.referenceMaterials.find(item => item.attackDefinitionId === definition.id
      && item.referenceId === reference.id);
    if (!material || material.title !== reference.title || material.url !== reference.url) {
      fail('REFERENCE_MATERIAL_MISMATCH', 'referenceMaterials',
        '参考資料情報が登録済みAttack Definitionと一致しません。');
    }
    if ((material.availability === 'CONTENT_AVAILABLE') !== (typeof material.content === 'string'
      && material.content.length > 0) || (material.availability === 'METADATA_ONLY' && material.content !== null)) {
      fail('REFERENCE_MATERIAL_MISMATCH', 'referenceMaterials.content',
        '参考資料本文のavailabilityとcontentが一致しません。');
    }
  }
}

export function validateScenarioVerificationInput(input) {
  validateDocument('scenario-verification-input', input);
  if (!Number.isSafeInteger(input.attempt.revisionAttemptsUsed) || input.attempt.revisionAttemptsUsed < 0) {
    fail('INVALID_ATTEMPT', 'scenario-verification-input.attempt.revisionAttemptsUsed',
      '再試行回数は0以上の安全な整数で指定してください。');
  }
  validateScenarioGenerationInput(input.generationInput);
  validateScenarioImportResult(input.importResult);
  validateReferenceMaterials(input);
  ensureUnique(input.allowedReviewRefs, item => item, 'allowedReviewRefs');
  const expectedRefs = buildAllowedReviewRefs(input.generationInput, input.scenarioPackage,
    input.referenceMaterials);
  if (!sameValues(input.allowedReviewRefs, expectedRefs)) fail('REVIEW_REFERENCE_MISMATCH',
    'allowedReviewRefs', '独立レビュー用の許可参照一覧を入力成果物から再現できません。');
  if (digest(verificationCore(input)) !== input.inputFingerprint) fail('VERIFICATION_INPUT_MISMATCH',
    'scenario-verification-input.inputFingerprint', 'Verification Inputの内容とfingerprintが一致しません。');
  return input;
}

export function buildScenarioReviewReferenceRules(input) {
  const allowedRefs = input.allowedReviewRefs;
  const hasObjectives = input.scenarioPackage.learningObjectives.objectives.length > 0;
  const hasRequirements = input.scenarioPackage.evidenceRequirements.requirements.length > 0;
  const prefixes = {
    EVIDENCE_GROUND_ALIGNMENT: {
      subject: hasRequirements ? ['evidenceRequirement:'] : ['scenarioDraft:'],
      source: ['attackGraph.artifact:', 'timeline.event:', 'groundTruth.fact:', 'character:', 'caseFact:'],
    },
    LEARNING_OBJECTIVE_ALIGNMENT: {
      subject: hasObjectives ? ['learningObjective:'] : ['scenarioDraft:'],
      source: ['attackGraph.node:', 'attackDefinition:', 'referenceMaterial:'],
    },
    FACT_NARRATIVE_SEPARATION: {
      subject: ['groundTruth.fact:', 'scenarioDraft:', 'evidenceRequirement:', 'character:'],
      source: ['attackGraph.node:', 'attackGraph.edge:', 'groundTruth.fact:', 'caseFact:'],
    },
    IDENTITY_ATTRIBUTION: {
      subject: input.scenarioPackage.characters.characters.length ? ['character:'] : ['scenarioDraft:'],
      source: ['groundTruth.fact:', 'attackGraph.node:', 'scenarioContext.', 'caseFact:'],
    },
    INVESTIGATION_COVERAGE: {
      subject: hasRequirements ? ['evidenceRequirement:'] : ['scenarioDraft:'],
      source: ['attackGraph.artifact:', 'timeline.event:', 'groundTruth.fact:', 'character:', 'caseFact:'],
    },
    REFERENCE_CONTENT_ALIGNMENT: {
      subject: ['referenceMaterial:'], source: ['referenceMaterial:'],
    },
  };
  return Object.fromEntries(Object.entries(prefixes).map(([category, rule]) => [category, {
    subjectRefs: allowedRefs.filter(ref => rule.subject.some(prefix => ref.startsWith(prefix))),
    sourceRefs: allowedRefs.filter(ref => rule.source.some(prefix => ref.startsWith(prefix))),
  }]));
}

export function validateScenarioVerificationReview(review, input) {
  validateDocument('scenario-verification-review', review);
  if (review.subjectFingerprint !== input.inputFingerprint) fail('REVIEW_SUBJECT_MISMATCH',
    'scenario-verification-review.subjectFingerprint', '独立レビューが別のVerification Inputを参照しています。');
  ensureUnique(review.checks, item => item.checkId, 'scenario-verification-review.checks.checkId');
  ensureUnique(review.checks, item => item.category, 'scenario-verification-review.checks.category');
  if (!sameValues(review.checks.map(item => item.category).sort(), [...SEMANTIC_CATEGORIES].sort())) {
    fail('INCOMPLETE_SEMANTIC_REVIEW', 'scenario-verification-review.checks',
      '独立意味的レビューの必須6項目が揃っていません。');
  }
  const allowedRefs = new Set(input.allowedReviewRefs);
  const hasContent = input.referenceMaterials.some(item => item.availability === 'CONTENT_AVAILABLE');
  const hasObjectives = input.scenarioPackage.learningObjectives.objectives.length > 0;
  const hasRequirements = input.scenarioPackage.evidenceRequirements.requirements.length > 0;
  const referenceRules = buildScenarioReviewReferenceRules(input);
  for (const check of review.checks) {
    ensureUnique(check.subjectRefs, item => item,
      `scenario-verification-review.checks.${check.checkId}.subjectRefs`);
    ensureUnique(check.sourceRefs, item => item,
      `scenario-verification-review.checks.${check.checkId}.sourceRefs`);
    const unsupported = ['subjectRefs', 'sourceRefs'].flatMap(kind => check[kind]
      .map((ref, index) => ({ kind, index, ref })).filter(item => !allowedRefs.has(item.ref)));
    if (unsupported.length) {
      const first = unsupported[0];
      const details = unsupported.slice(0, 3).map(item => {
        const value = JSON.stringify(item.ref).replace(/[\u007f-\u009f\u2028\u2029]/g, ' ');
        return `${item.kind}[${item.index}]=${value.length > 180 ? `${value.slice(0, 179)}…` : value}`;
      }).join('、');
      fail('UNSUPPORTED_REVIEW_REFERENCE',
        `scenario-verification-review.checks.${check.checkId}.${first.kind}[${first.index}]`,
        `${check.category}: allowedReviewRefsに存在しない参照です: ${details}`
        + (unsupported.length > 3 ? `（ほか${unsupported.length - 3}件）` : '')
        + '。入力の許可参照を確認して再レビューし、推測した参照へ置換しないでください。');
    }
    const rule = referenceRules[check.category];
    if (!check.subjectRefs.some(ref => rule.subjectRefs.includes(ref))
      || !check.sourceRefs.some(ref => rule.sourceRefs.includes(ref))) {
      fail('IRRELEVANT_REVIEW_GROUND', `scenario-verification-review.checks.${check.checkId}`,
        'レビュー項目の対象または根拠がcategoryに対応していません。');
    }
    if (['PASS', 'NOT_APPLICABLE'].includes(check.outcome) && check.correctionHint !== null) {
      fail('INVALID_REVIEW_OUTCOME', `scenario-verification-review.checks.${check.checkId}.correctionHint`,
        'PASSまたはNOT_APPLICABLEでは修正案を指定できません。');
    }
    if (['FAIL', 'UNKNOWN'].includes(check.outcome)
      && (typeof check.correctionHint !== 'string' || !check.correctionHint.length)) {
      fail('INVALID_REVIEW_OUTCOME', `scenario-verification-review.checks.${check.checkId}.correctionHint`,
        'FAILまたはUNKNOWNには修正案が必要です。');
    }
    if (check.category !== 'REFERENCE_CONTENT_ALIGNMENT' && check.outcome === 'NOT_APPLICABLE') {
      fail('INVALID_REVIEW_OUTCOME', `scenario-verification-review.checks.${check.checkId}.outcome`,
        '参考資料本文以外の必須レビューをNOT_APPLICABLEにできません。');
    }
    if (check.category === 'REFERENCE_CONTENT_ALIGNMENT'
      && ((hasContent && check.outcome === 'NOT_APPLICABLE')
        || (!hasContent && check.outcome !== 'NOT_APPLICABLE'))) {
      fail('INVALID_REVIEW_OUTCOME', `scenario-verification-review.checks.${check.checkId}.outcome`,
        '参考資料本文の有無と内容整合性レビュー結果が一致しません。');
    }
    if (((check.category === 'LEARNING_OBJECTIVE_ALIGNMENT' && !hasObjectives)
      || (['EVIDENCE_GROUND_ALIGNMENT', 'INVESTIGATION_COVERAGE'].includes(check.category)
        && !hasRequirements)) && check.outcome === 'PASS') {
      fail('INVALID_REVIEW_OUTCOME', `scenario-verification-review.checks.${check.checkId}.outcome`,
        '対象成果物が空の場合は意味的一致またはカバレッジをPASSにできません。');
    }
    if (check.category === 'REFERENCE_CONTENT_ALIGNMENT' && hasContent) {
      const requiredRefs = input.referenceMaterials.filter(item => item.availability === 'CONTENT_AVAILABLE')
        .map(item => `referenceMaterial:${item.materialId}`);
      if (requiredRefs.some(ref => !check.sourceRefs.includes(ref))) fail('INCOMPLETE_REFERENCE_REVIEW',
        `scenario-verification-review.checks.${check.checkId}.sourceRefs`,
        '本文が提供された全参考資料を内容整合性レビューの根拠に含める必要があります。');
    }
  }
  return review;
}

function emptyChecks() {
  return ALL_CATEGORIES.map(category => ({
    checkId: `check_${category.toLowerCase()}`,
    kind: DETERMINISTIC_CATEGORIES.includes(category) ? 'DETERMINISTIC' : 'SEMANTIC',
    category, outcome: 'UNKNOWN', reason: '検証を完了していません。', sourceRefs: ['verification:pending'],
  }));
}

function setCheck(checks, category, outcome, reason, sourceRefs) {
  const check = checks.find(item => item.category === category);
  Object.assign(check, { outcome, reason, sourceRefs });
}

function issue(index, code, category, disposition, field, reason, correctionHint,
  sourceRefs, targetId = null) {
  return {
    issueId: `issue_${String(index + 1).padStart(3, '0')}`, code, category, disposition,
    field, targetId, reason, correctionHint, sourceRefs,
  };
}

function validateEvidenceProducibility(input) {
  const { scenarioPackage, generationInput } = input;
  const graph = generationInput.technicalInput.attackGraph;
  for (const requirement of scenarioPackage.evidenceRequirements.requirements) {
    for (const ground of requirement.grounds) {
      if (ground.sourceType !== 'ATTACK_GRAPH_ARTIFACT') continue;
      const node = graph.nodes.find(item => item.nodeId === ground.attackNodeId);
      const artifact = node?.artifactEvaluations.find(item => item.artifactId === ground.sourceId);
      if (!artifact || artifact.state !== 'SATISFIED'
        || artifact.evaluations.some(item => item.state !== 'SATISFIED')) {
        fail('EVIDENCE_NOT_PRODUCIBLE', `evidenceRequirements.${requirement.requirementId}.grounds`,
          'Evidence Requirementが観測可能と確認されたartifactを参照していません。');
      }
    }
  }
  const requiredPurposes = ['ATTACK_TRACE', 'TIMELINE_PROOF', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF'];
  const purposes = new Set(scenarioPackage.evidenceRequirements.requirements.map(item => item.purpose));
  return requiredPurposes.filter(purpose => !purposes.has(purpose));
}

export function validateScenarioRevisionFeedback(feedback) {
  validateDocument('scenario-revision-feedback', feedback);
  if (!Number.isSafeInteger(feedback.attempt.revisionAttemptsUsed)
    || feedback.attempt.nextRevisionAttempt !== feedback.attempt.revisionAttemptsUsed + 1
    || feedback.attempt.nextRevisionAttempt > MAX_REVISION_ATTEMPTS) {
    fail('INVALID_REVISION_FEEDBACK', 'scenario-revision-feedback.attempt',
      'Scenario Revision Feedbackの再試行回数が不正です。');
  }
  return feedback;
}

export function validateEvidenceAgentHandoff(handoff) {
  validateDocument('evidence-agent-handoff', handoff);
  return handoff;
}

export function validateScenarioVerificationResult(result) {
  validateDocument('scenario-verification-result', result);
  ensureUnique(result.checks, item => item.checkId, 'scenario-verification-result.checks.checkId');
  ensureUnique(result.checks, item => item.category, 'scenario-verification-result.checks.category');
  ensureUnique(result.issues, item => item.issueId, 'scenario-verification-result.issues.issueId');
  if (!sameValues(result.checks.map(item => item.category).sort(), [...ALL_CATEGORIES].sort())) {
    fail('INVALID_VERIFICATION_RESULT', 'scenario-verification-result.checks',
      'Verification Resultの必須checkが揃っていません。');
  }
  for (const check of result.checks) {
    const expectedKind = DETERMINISTIC_CATEGORIES.includes(check.category) ? 'DETERMINISTIC' : 'SEMANTIC';
    if (check.kind !== expectedKind) fail('INVALID_VERIFICATION_RESULT',
      `scenario-verification-result.checks.${check.checkId}.kind`, 'checkの分類が不正です。');
  }
  const blockIssues = result.issues.filter(item => item.disposition === 'BLOCK');
  const revisionIssues = result.issues.filter(item => item.disposition === 'REVISION');
  if (!Number.isSafeInteger(result.attempt.revisionAttemptsUsed)
    || result.attempt.revisionAttemptsUsed < 0) {
    fail('INVALID_VERIFICATION_RESULT', 'scenario-verification-result.attempt.revisionAttemptsUsed',
      'Verification Resultの再試行回数が不正です。');
  }
  if (result.status === 'VERIFIED') {
    if (result.issues.length || result.revisionFeedback || !result.evidenceAgentEligible
      || !result.evidenceAgentHandoff || result.checks.some(item => !['PASS', 'NOT_APPLICABLE'].includes(item.outcome))) {
      fail('INVALID_VERIFICATION_RESULT', 'scenario-verification-result.status',
        'VERIFIED結果に未解決check、issue、またはHandoffの矛盾があります。');
    }
    validateEvidenceAgentHandoff(result.evidenceAgentHandoff);
    const handoff = result.evidenceAgentHandoff;
    if (handoff.verificationId !== result.verificationId
      || handoff.verificationInputFingerprint !== result.inputFingerprint
      || handoff.scenarioId !== result.scenarioId
      || !sameValues(handoff.attackGraphRef, result.attackGraphRef)) {
      fail('INVALID_VERIFICATION_RESULT', 'scenario-verification-result.evidenceAgentHandoff',
        'Evidence Agent Handoffが別のVerification ResultまたはScenarioを参照しています。');
    }
  } else if (result.status === 'NEEDS_REVISION') {
    if (blockIssues.length || !revisionIssues.length || !result.revisionFeedback
      || result.evidenceAgentEligible || result.evidenceAgentHandoff) {
      fail('INVALID_VERIFICATION_RESULT', 'scenario-verification-result.status',
        'NEEDS_REVISION結果のissue、Feedback、またはHandoffが矛盾しています。');
    }
    validateScenarioRevisionFeedback(result.revisionFeedback);
    const feedback = result.revisionFeedback;
    if (feedback.verificationId !== result.verificationId || feedback.scenarioId !== result.scenarioId
      || feedback.attempt.revisionAttemptsUsed !== result.attempt.revisionAttemptsUsed
      || feedback.technicalBoundary.inputDigest !== result.attackGraphRef.inputDigest
      || feedback.technicalBoundary.graphId !== result.attackGraphRef.graphId
      || feedback.revisionTargets.length !== revisionIssues.length) {
      fail('INVALID_VERIFICATION_RESULT', 'scenario-verification-result.revisionFeedback',
        'Scenario Revision Feedbackが別のVerification Resultを参照するか、修正対象が一致しません。');
    }
  } else if (!blockIssues.length || result.revisionFeedback || result.evidenceAgentEligible
    || result.evidenceAgentHandoff) {
    fail('INVALID_VERIFICATION_RESULT', 'scenario-verification-result.status',
      'BLOCKED結果のissue、Feedback、またはHandoffが矛盾しています。');
  }
  return result;
}

function artifactForCategory(category) {
  if (category === 'LEARNING_OBJECTIVE_ALIGNMENT') return 'learningObjectives';
  if (category === 'IDENTITY_ATTRIBUTION') return 'characters';
  if (category === 'FACT_NARRATIVE_SEPARATION') return 'groundTruth';
  return 'evidenceRequirements';
}

function makeRevisionFeedback(verificationId, input, issues) {
  const scenarioId = input.scenarioPackage.scenarioDraft.scenarioId;
  return validateScenarioRevisionFeedback({
    schemaVersion: '1.0', status: 'NEEDS_REVISION', verificationId, scenarioId,
    technicalBoundary: { ...input.generationInput.attackGraphRef, mustRemainUnchanged: true },
    attempt: {
      revisionAttemptsUsed: input.attempt.revisionAttemptsUsed,
      maxRevisionAttempts: MAX_REVISION_ATTEMPTS,
      nextRevisionAttempt: input.attempt.revisionAttemptsUsed + 1,
    },
    revisionTargets: issues.map(item => ({
      code: item.code, category: item.category, artifact: artifactForCategory(item.category),
      targetId: item.targetId, field: item.field, reason: item.reason,
      correctionHint: item.correctionHint, sourceRefs: item.sourceRefs,
    })),
  });
}

function makeHandoff(verificationId, input) {
  const draft = input.scenarioPackage.scenarioDraft;
  return validateEvidenceAgentHandoff({
    schemaVersion: '1.0', handoffId: `handoff_${verificationId.slice('verification_'.length)}`,
    verificationId, verificationInputFingerprint: input.inputFingerprint,
    scenarioPackageFingerprint: digest(input.scenarioPackage), scenarioId: draft.scenarioId,
    attackGraphRef: { ...draft.attackGraphRef }, groundTruthId: draft.groundTruthId,
    timelineId: draft.timelineId, learningObjectiveSetId: draft.learningObjectiveSetId,
    evidenceRequirementSetId: draft.evidenceRequirementSetId,
    eligibleForEvidenceGeneration: true,
  });
}

// 判定だけを行う。入力、Scenario、技術状態、Orchestratorのattempt状態は変更しない。
export function verifyScenario({ verificationInput, semanticReview = null }) {
  validateDocument('scenario-verification-input', verificationInput);
  const input = verificationInput;
  const checks = emptyChecks();
  const issues = [];
  const scenarioId = input.scenarioPackage.scenarioDraft?.scenarioId ?? 'scenario_unresolved';
  const graphRef = input.generationInput.attackGraphRef;
  const verificationId = `verification_${digest([input.inputFingerprint,
    input.attempt.revisionAttemptsUsed]).slice(0, 20)}`;
  let reviewId = 'review_not_completed';

  try {
    validateScenarioVerificationInput(input);
    setCheck(checks, 'REFERENCE_INTEGRITY', 'PASS',
      'Attack DefinitionのreferenceIdと提供資料情報が一致しています。',
      input.referenceMaterials.map(item => `referenceMaterial:${item.materialId}`));
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    setCheck(checks, 'REFERENCE_INTEGRITY', 'FAIL', error.message, ['verificationInput']);
    issues.push(issue(issues.length, error.code, 'INPUT_INTEGRITY', 'BLOCK', error.field,
      error.message, 'Phase 5Bの正本からVerification Inputを再構築してください。', ['verificationInput']));
  }

  let phase5Result = null;
  try {
    validateScenarioGenerationInput(input.generationInput);
    validateEnvironment(input.generationInput.technicalInput.network,
      input.generationInput.technicalInput.scenarioContext,
      input.generationInput.technicalInput.attackDefinitions);
    const rebuilt = buildAttackGraphs({
      definitions: input.generationInput.technicalInput.attackDefinitions,
      network: input.generationInput.technicalInput.network,
      context: input.generationInput.technicalInput.scenarioContext,
      candidate: input.generationInput.technicalInput.candidate,
    });
    const graph = input.generationInput.technicalInput.attackGraph;
    if (rebuilt.status !== 'CREATED' || rebuilt.inputDigest !== input.generationInput.attackGraphRef.inputDigest
      || !sameValues(rebuilt.graphs.find(item => item.graphId === graph.graphId), graph)) {
      fail('ATTACK_GRAPH_RECONSTRUCTION_MISMATCH', 'generationInput.technicalInput.attackGraph',
        '技術入力から同一Attack Graphを独立再構築できません。');
    }
    setCheck(checks, 'ATTACK_GRAPH_RECONSTRUCTION', 'PASS',
      'Network、Scenario Context、candidate、Attack Definitionから同一graphを再構築しました。',
      [`attackGraph.node:${graph.nodes[0].nodeId}`]);
    setCheck(checks, 'ENVIRONMENT_ALIGNMENT', 'PASS',
      '対象割当て、service所属、明示reachability、成立条件が技術入力と一致しています。',
      [`candidate.attack:${graph.selectedAttackIds[0]}`]);
    phase5Result = importScenarioPackage({ generationInput: input.generationInput,
      scenarioPackage: input.scenarioPackage });
    validateScenarioImportResult(input.importResult);
    if (!sameValues(phase5Result, input.importResult) || phase5Result.status !== 'VALID') {
      fail('PHASE_5B_NOT_VALID', 'importResult', 'Phase 5BのVALID結果を独立再現できません。');
    }
    setCheck(checks, 'PHASE_5B_GATE', 'PASS', 'Phase 5BのVALID結果を同じ入力から再現しました。',
      [`scenarioDraft:${scenarioId}`]);

    const contract = validateScenarioContract({
      attackGraphResult: rebuilt,
      definitions: input.generationInput.technicalInput.attackDefinitions,
      scenarioDraft: input.scenarioPackage.scenarioDraft,
      groundTruth: input.scenarioPackage.groundTruth,
      characters: input.scenarioPackage.characters,
      timeline: input.scenarioPackage.timeline,
      learningObjectives: input.scenarioPackage.learningObjectives,
      evidenceRequirements: input.scenarioPackage.evidenceRequirements,
    });
    if (contract.status !== 'VALID') fail(contract.issues[0].code, contract.issues[0].field,
      contract.issues[0].reason);
    setCheck(checks, 'GROUND_TRUTH_TRACEABILITY', 'PASS',
      'Ground Truthの技術factをAttack Graphの全nodeとedgeへ追跡できました。',
      input.scenarioPackage.groundTruth.technicalFacts.map(item => `groundTruth.fact:${item.factId}`));
    setCheck(checks, 'TIMELINE_CONSISTENCY', 'PASS',
      'Timelineの依存関係が因果edgeと実行制約に一致しています。',
      input.scenarioPackage.timeline.events.map(item => `timeline.event:${item.eventId}`));
    const missingPurposes = validateEvidenceProducibility(input);
    if (missingPurposes.length) {
      setCheck(checks, 'EVIDENCE_PRODUCIBILITY', 'FAIL',
        `Evidence Requirementに必要な目的が不足しています: ${missingPurposes.join(', ')}`,
        [`scenarioDraft:${scenarioId}`]);
      issues.push(issue(issues.length, 'EVIDENCE_PURPOSE_COVERAGE_INCOMPLETE',
        'EVIDENCE_PRODUCIBILITY', 'REVISION', 'evidenceRequirements.requirements',
        '攻撃経路、時系列、矛盾、無罪論証に必要なEvidence Requirement目的が揃っていません。',
        '不足するpurposeを持ち、既存Ground Truthまたは観測可能なartifactへ追跡できる要件を追加してください。',
        [`scenarioDraft:${scenarioId}`]));
    } else {
      setCheck(checks, 'EVIDENCE_PRODUCIBILITY', 'PASS',
        'Evidence RequirementのgroundはPhase 7が参照可能で、必要な調査目的をカバーしています。',
        input.scenarioPackage.evidenceRequirements.requirements.map(item =>
          `evidenceRequirement:${item.requirementId}`));
    }
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    for (const category of DETERMINISTIC_CATEGORIES.filter(item => item !== 'REFERENCE_INTEGRITY')) {
      const check = checks.find(item => item.category === category);
      if (check.outcome === 'UNKNOWN') setCheck(checks, category, 'FAIL', error.message, ['verificationInput']);
    }
    issues.push(issue(issues.length, error.code, 'TECHNICAL_VERIFICATION', 'BLOCK', error.field,
      error.message, 'Phase 5B以前の成果物と技術入力を修正し、下流成果物を再生成してください。',
      ['verificationInput']));
  }

  if (!issues.some(item => item.disposition === 'BLOCK')) {
    try {
      if (!semanticReview) fail('INDEPENDENT_REVIEW_REQUIRED', 'semanticReview',
        '独立した意味的レビューがありません。');
      validateScenarioVerificationReview(semanticReview, input);
      reviewId = semanticReview.reviewId;
      for (const reviewCheck of semanticReview.checks) {
        setCheck(checks, reviewCheck.category, reviewCheck.outcome, reviewCheck.reason,
          reviewCheck.sourceRefs);
        if (['FAIL', 'UNKNOWN'].includes(reviewCheck.outcome)) {
          const referenceFailure = reviewCheck.category === 'REFERENCE_CONTENT_ALIGNMENT';
          const code = `${reviewCheck.category}_${reviewCheck.outcome}`;
          issues.push(issue(issues.length, code, reviewCheck.category,
            referenceFailure ? 'BLOCK' : 'REVISION', reviewCheck.field, reviewCheck.reason,
            reviewCheck.correctionHint, reviewCheck.sourceRefs, reviewCheck.subjectRefs[0]));
        }
      }
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      for (const category of SEMANTIC_CATEGORIES) setCheck(checks, category, 'UNKNOWN',
        error.message, ['semanticReview']);
      issues.push(issue(issues.length, error.code, 'INDEPENDENT_REVIEW', 'BLOCK', error.field,
        error.message, '同じVerification Inputを対象に、独立ReviewerからSchema適合レビューを取得してください。',
        ['semanticReview']));
    }
  }

  if (input.attempt.revisionAttemptsUsed > MAX_REVISION_ATTEMPTS
    || (input.attempt.revisionAttemptsUsed >= MAX_REVISION_ATTEMPTS
      && issues.some(item => item.disposition === 'REVISION'))) {
    issues.push(issue(issues.length, 'REVISION_LIMIT_EXCEEDED', 'REVISION_CONTROL', 'BLOCK',
      'attempt.revisionAttemptsUsed', 'Scenario修正後の再検証回数が上限3回に達しました。',
      'Orchestratorで処理を停止し、上流設計または人手による判断へ差し戻してください。',
      ['verificationInput.attempt']));
  }

  const blocked = issues.some(item => item.disposition === 'BLOCK');
  const needsRevision = issues.some(item => item.disposition === 'REVISION');
  const status = blocked ? 'BLOCKED' : needsRevision ? 'NEEDS_REVISION' : 'VERIFIED';
  const revisionFeedback = status === 'NEEDS_REVISION'
    ? makeRevisionFeedback(verificationId, input, issues.filter(item => item.disposition === 'REVISION')) : null;
  const handoff = status === 'VERIFIED' ? makeHandoff(verificationId, input) : null;
  return validateScenarioVerificationResult({
    schemaVersion: '1.0', verificationId, status, scope: 'PRE_EVIDENCE_SCENARIO_VERIFICATION',
    scenarioId, inputFingerprint: input.inputFingerprint, attackGraphRef: { ...graphRef },
    attempt: { ...input.attempt },
    independence: { reviewId, scenarioGeneratorSelfAssessmentUsed: false, technicalChecksRecomputed: true },
    checks, issues, revisionFeedback, evidenceAgentEligible: status === 'VERIFIED',
    evidenceAgentHandoff: handoff,
  });
}
