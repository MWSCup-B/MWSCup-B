import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoGenerationManager, createAutoAuthorSession, autoAuthorView } from '../server/auto-generation-service.js';
import { EVIDENCE_REVIEW_CHECKS, validateEvidenceSemanticReview } from '../server/generation/evidence-semantic-review.js';
import { CodexTimeoutError } from '../server/codex/codex-errors.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

const maliciousExplanation = 'The witness report is false. The defendant personally authored and executed the attack. The evidence establishes the guilt of the defendant.';
const verified = () => ({ schemaVersion: '1.0', status: 'VERIFIED',
  checks: EVIDENCE_REVIEW_CHECKS.map(checkId => ({ checkId, status: 'PASS', reason: '取得可能な資料と記述の対応を確認。' })), issues: [] });
const rejection = status => ({ ...verified(), status,
  checks: verified().checks.map(check => check.checkId === 'EXPLANATION_GROUNDING' ? { ...check, status: 'FAIL', reason: '解説が直接観察と反駁に反する。' } : check),
  issues: [{ code: 'EVIDENCE_EXPLANATION_CONFLICT', field: 'courtQuestions[1].explanation',
    reason: '第三者の観察と技術資料は別人の操作を裏付けるが、解説は被告人が行ったとしている。',
    correctionHint: '原資料・観察・引用を変えず、その照合から導ける反駁に説明を合わせる。' }] });

test('every semantic review check is mandatory and a contradictory success is invalid', () => {
  const input = { evidenceDraft: { courtQuestions: [] } };
  const result = validateEvidenceSemanticReview(verified(), input);
  assert.match(result.inputDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(result.inputDigest, validateEvidenceSemanticReview(verified(), {}).inputDigest);
  for (const mutate of [
    value => value.checks.pop(),
    value => { value.checks[1].checkId = value.checks[0].checkId; },
    value => { value.checks[0].status = 'FAIL'; },
    value => { value.issues = rejection('NEEDS_REVISION').issues; },
    value => { value.status = 'NEEDS_REVISION'; },
  ]) {
    const value = verified(); mutate(value);
    assert.throws(() => validateEvidenceSemanticReview(value, input));
  }
  const mismatched = rejection('NEEDS_REVISION');
  mismatched.issues[0].code = 'EVIDENCE_ATTRIBUTION_UNSUPPORTED';
  assert.throws(() => validateEvidenceSemanticReview(mismatched, input), { code: 'EVIDENCE_REVIEW_INVALID' });
});

for (const repair of [true, false]) test(`independent review ${repair ? 'repairs' : 'blocks'} a contradictory explanation despite valid source quotes`, async () => {
  class ReviewedRunner extends MockCodexRunner {
    async runJson(args) {
      const output = await super.runJson(args);
      if (args.phase === 'GENERATING_EVIDENCE' && (!repair || this.evidenceCalls === 1))
        output.courtQuestions.at(-1).explanation = maliciousExplanation;
      if (args.phase === 'REVIEWING_EVIDENCE') {
        assert.equal(args.data.scenarioPackage.groundTruth.caseFacts?.length ?? 0, 0);
        assert.ok(args.data.evidenceDraft.evidenceArtifacts.every(item => !Object.hasOwn(item, 'caseSupport')));
        assert.ok(args.instruction.includes('独立'));
        if (args.data.evidenceDraft.courtQuestions.at(-1).explanation === maliciousExplanation)
          return rejection('NEEDS_REVISION');
      }
      if (args.phase === 'GENERATING_EVIDENCE' && this.evidenceCalls === 2)
        assert.ok(args.feedback.errors.some(item => item.code === 'EVIDENCE_EXPLANATION_CONFLICT'));
      return output;
    }
  }
  const runner = new ReviewedRunner(), manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['clickfix'], settingId: 'company' });
  await manager.waitForIdle();
  const configuration = structuredClone(session.configuration);
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, repair ? 'READY' : 'FAILED', JSON.stringify(session.auto.details));
  assert.equal(runner.evidenceCalls, 2); assert.equal(runner.evidenceReviewCalls, 2);
  assert.deepEqual(session.configuration, configuration);
  assert.match(session.evidenceSemanticReview.inputDigest, /^[a-f0-9]{64}$/);
  assert.ok(session.auto.details.some(item => item.phase === 'REVIEWING_EVIDENCE'
    && item.code === 'EVIDENCE_EXPLANATION_CONFLICT'));
  if (repair) assert.ok(!session.runtime.gameCase.progression.outcomes.acquitted.publicExplanation.includes(maliciousExplanation));
  else assert.equal(session.runtime, null);
  assert.ok(!Object.hasOwn(autoAuthorView(session), 'evidenceSemanticReview'));
});

for (const defect of ['BLOCKED', 'missing_check', 'timeout']) test(`semantic review ${defect} cannot reach game build or bypass review`, async () => {
  class FailedReviewer extends MockCodexRunner {
    async runJson(args) {
      const value = await super.runJson(args);
      if (args.phase !== 'REVIEWING_EVIDENCE') return value;
      if (defect === 'BLOCKED') return rejection('BLOCKED');
      if (defect === 'timeout') throw new CodexTimeoutError(args.phase);
      value.checks.pop(); return value;
    }
  }
  const runner = new FailedReviewer(), manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['clickfix'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'FAILED', JSON.stringify(session.auto.details));
  assert.equal(session.runtime, null);
  assert.equal(runner.evidenceCalls, 1); assert.equal(runner.evidenceReviewCalls, 1);
  assert.ok(session.auto.details.some(item => item.phase === 'REVIEWING_EVIDENCE'));
});
