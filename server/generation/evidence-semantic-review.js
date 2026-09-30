import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateDocument, fail } from './schema.js';

export const EVIDENCE_REVIEW_PROMPT = await readFile(new URL('../../prompts/evidence-verification-v1.md', import.meta.url), 'utf8');
export const EVIDENCE_REVIEW_CHECKS = Object.freeze([
  'OBSERVATION_GROUNDING', 'ATTRIBUTION_GROUNDING', 'CLAIM_REFUTATION_ALIGNMENT', 'EXPLANATION_GROUNDING',
]);
const issueCode = Object.freeze({ OBSERVATION_GROUNDING: 'EVIDENCE_OBSERVATION_UNSUPPORTED',
  ATTRIBUTION_GROUNDING: 'EVIDENCE_ATTRIBUTION_UNSUPPORTED',
  CLAIM_REFUTATION_ALIGNMENT: 'EVIDENCE_CLAIM_REFUTATION_CONFLICT',
  EXPLANATION_GROUNDING: 'EVIDENCE_EXPLANATION_CONFLICT' });

export function buildEvidenceSemanticReviewInput(agent, draft) {
  // Review the authored incident rows before deterministic ordinary-log
  // expansion, not invented summaries or answers supplied by the author.
  const { technicalInput } = agent.scenarioVerificationInput.generationInput;
  return structuredClone({ contextFormat: 'EVIDENCE_SEMANTIC_REVIEW_V1',
    technicalInput: { network: technicalInput.network, scenarioContext: technicalInput.scenarioContext,
      attackGraph: agent.attackGraph,
      attackDefinitions: technicalInput.attackDefinitions.filter(definition =>
        agent.attackGraph.nodes.some(node => node.attackDefinitionId === definition.id)) },
    scenarioPackage: agent.scenarioImportPackage,
    evidenceDraft: draft });
}

export function validateEvidenceSemanticReview(review, input) {
  validateDocument('evidence-semantic-review', review);
  const checkIds = review.checks.map(check => check.checkId);
  const invalid = reason => fail('EVIDENCE_REVIEW_INVALID', 'evidenceSemanticReview', reason);
  if (checkIds.length !== EVIDENCE_REVIEW_CHECKS.length || new Set(checkIds).size !== checkIds.length
    || EVIDENCE_REVIEW_CHECKS.some(id => !checkIds.includes(id)))
    invalid('証拠・人物断定の根拠と限界・反駁・解説の全4観点を独立に審査してください。');
  const passed = review.checks.every(check => check.status === 'PASS');
  if ((review.status === 'VERIFIED') !== (passed && review.issues.length === 0)
    || (review.status !== 'VERIFIED' && (passed || !review.issues.length)))
    invalid('審査状態、観点別の合否、指摘事項が矛盾しています。');
  if (review.checks.some(check => (check.status === 'FAIL') !== review.issues.some(issue => issue.code === issueCode[check.checkId])))
    invalid('各不合格の観点に対応する指摘事項が必要です。合格の観点へ不備を割り当てないでください。');
  // Kept internally with the exact reviewed input. No result from a previous
  // evidence attempt is carried over to a new draft.
  return { inputDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    review: structuredClone(review) };
}
