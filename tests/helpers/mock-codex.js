import { CodexUnavailableError, CodexCancelledError, CodexOutputError, CodexTimeoutError }
  from '../../server/codex/codex-errors.js';
import { verifiedScenarioFixture, semanticReview } from './verified-scenario.js';
import { phase7Fixture } from './phase7-evidence.js';

export class MockCodexRunner {
  constructor({ unavailable = false, reviewOutcomes = ['VERIFIED'], malformedScenario = false,
    reviewerSchemaFailure = false, evidenceInvalid = false, waitForCancel = false,
    malformedScenarioOutput = 0, malformedEvidenceOutput = 0, timeout = false } = {}) {
    Object.assign(this, { unavailable, reviewOutcomes, malformedScenario,
      reviewerSchemaFailure, evidenceInvalid, waitForCancel, malformedScenarioOutput,
      malformedEvidenceOutput, timeout });
    this.calls = []; this.scenarioCalls = 0; this.reviewCalls = 0; this.evidenceCalls = 0;
  }

  async checkAvailability() {
    this.calls.push({ kind: 'availability' });
    if (this.unavailable) throw new CodexUnavailableError(
      'Codex CLIでChatGPTアカウントへログインしてください。');
    return { available: true, version: 'codex-cli test' };
  }

  async runJson({ data, feedback, phase, signal }) {
    this.calls.push({ kind: 'invocation', phase, data: structuredClone(data),
      feedback: structuredClone(feedback) });
    if (this.waitForCancel) return await new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new CodexCancelledError(phase)); return; }
      signal.addEventListener('abort', () => reject(new CodexCancelledError(phase)), { once: true });
    });
    if (this.timeout) throw new CodexTimeoutError(phase);
    if (phase === 'GENERATING_SCENARIO' || phase === 'REVISING_SCENARIO') {
      this.scenarioCalls += 1;
      if (this.scenarioCalls <= this.malformedScenarioOutput) throw new CodexOutputError(
        'Codex出力が単一のJSONオブジェクトではありません。', { phase });
      if (this.malformedScenario) return { schemaVersion: '1.0' };
      return verifiedScenarioFixture(data.scenarioGenerationInput).scenarioPackage;
    }
    if (phase === 'REVIEWING_SCENARIO') {
      this.reviewCalls += 1;
      if (this.reviewerSchemaFailure && this.reviewCalls === 1) return {};
      const review = semanticReview(data);
      const outcome = this.reviewOutcomes[Math.min(this.reviewCalls - 1,
        this.reviewOutcomes.length - 1)];
      if (outcome !== 'VERIFIED') {
        review.checks[0].outcome = 'FAIL'; review.checks[0].reason = '修正が必要です。';
        review.checks[0].correctionHint = 'Evidence Requirementの説明を既存groundに合わせてください。';
      }
      return review;
    }
    if (phase === 'GENERATING_EVIDENCE') {
      this.evidenceCalls += 1;
      if (this.evidenceCalls <= this.malformedEvidenceOutput) throw new CodexOutputError(
        'Codex出力が単一のJSONオブジェクトではありません。', { phase });
      if (this.evidenceInvalid) return { schemaVersion: '1.0' };
      const input = data.evidenceGenerationInput;
      const agent = input.evidenceAgentInput;
      return phase7Fixture({ verificationInput: agent.scenarioVerificationInput,
        verificationResult: agent.verificationResult,
        scenarioPackage: agent.scenarioImportPackage }).evidencePackage;
    }
    throw new Error(`unexpected phase: ${phase}`);
  }
}
