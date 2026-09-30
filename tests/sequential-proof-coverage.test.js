import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSequentialPlan } from '../server/generation/sequential-investigation.js';

function fixture() {
  const evidenceSet = { evidenceArtifacts: ['first', 'second', 'unsubmitted'].map(evidenceId => ({
    evidenceId, sourceRefs: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT' }] })),
  exonerations: [{ exonerationId: 'exoneration', supportingEvidenceIds: ['first', 'second'] }] };
  const plan = { investigationMode: 'OPEN_MATERIALS',
    retrialStatementIds: ['claim_first', 'claim_second'],
    investigationTargets: ['target_first', 'target_second'].map(targetId => ({ targetId, availableActionIds: ['inspect'] })),
    initialAvailableTargetIds: ['target_first', 'target_second'], initialCourtEvidenceIds: [],
    evidenceDiscoveryRules: ['first', 'second', 'unsubmitted'].map(evidenceId => ({ evidenceId, actionId: 'inspect',
      targetId: evidenceId === 'second' ? 'target_second' : 'target_first',
      prerequisites: { requiredEvidenceIds: [], requiredCompletedActionIds: [] } })),
    objectionRules: ['first', 'second'].map(id => ({ targetStatementId: `claim_${id}`,
      acceptedEvidenceIds: [id], exonerationRef: 'exoneration' })),
    courtQuestions: ['first', 'second'].map(id => ({ statementId: `claim_${id}`,
      supportingQuotes: [{ evidenceId: id, quote: 'verified original' }] })),
  };
  return { plan, evidenceSet };
}

test('ordered local proofs cover exoneration without resubmitting the first attack at the final issue', () => {
  const { plan, evidenceSet } = fixture();
  const before = structuredClone(plan);
  assert.doesNotThrow(() => validateSequentialPlan(plan, evidenceSet));
  assert.deepEqual(plan, before);
  assert.deepEqual(plan.objectionRules[1].acceptedEvidenceIds, ['second']);
});

test('a missing part of the overall exoneration cannot disappear between local issues', () => {
  const { plan, evidenceSet } = fixture();
  evidenceSet.exonerations[0].supportingEvidenceIds.push('unsubmitted');
  assert.throws(() => validateSequentialPlan(plan, evidenceSet), { code: 'EXONERATION_STAGE_COVERAGE_MISSING' });
});

test('a quotation cannot introduce future evidence outside the current issue support', () => {
  const { plan, evidenceSet } = fixture();
  plan.courtQuestions[0].supportingQuotes.push({ evidenceId: 'second', quote: 'future original' });
  assert.throws(() => validateSequentialPlan(plan, evidenceSet), { code: 'SEQUENTIAL_INVESTIGATION_UNSOLVABLE' });
});
