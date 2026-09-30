import { CodexUnavailableError, CodexCancelledError, CodexOutputError, CodexTimeoutError }
  from '../../server/codex/codex-errors.js';
import { verifiedScenarioFixture, semanticReview } from './verified-scenario.js';
import { phase7Fixture } from './phase7-evidence.js';
import { createDefaultConfiguration } from '../../server/generation/scenario-configuration.js';
import { addCourtQuestions, addDistinctClaims, assignStageSupports } from './court-issues.js';
import { observationAnchors } from '../../server/generation/court-questions.js';
import { ransomwareLogSamples } from './ransomware-evidence.js';

export class MockCodexRunner {
  constructor({ unavailable = false, reviewOutcomes = ['VERIFIED'], malformedScenario = false,
    reviewerSchemaFailure = false, reviewerGroundFailure = false,
    evidenceInvalid = false, waitForCancel = false,
    malformedScenarioOutput = 0, malformedEvidenceOutput = 0, timeout = false,
    invalidMakotomaruOutput = 0, changeScenarioSummaryOnRevision = false } = {}) {
    Object.assign(this, { unavailable, reviewOutcomes, malformedScenario,
      reviewerSchemaFailure, reviewerGroundFailure, evidenceInvalid, waitForCancel,
      malformedScenarioOutput,
      malformedEvidenceOutput, timeout, invalidMakotomaruOutput,
      changeScenarioSummaryOnRevision });
    this.calls = []; this.scenarioCalls = 0; this.reviewCalls = 0; this.evidenceCalls = 0;
    this.evidenceReviewCalls = 0;
    this.makotomaruCalls = 0;
  }

  async checkAvailability() {
    this.calls.push({ kind: 'availability' });
    if (this.unavailable) throw new CodexUnavailableError(
      'Codex CLIでChatGPTアカウントへログインしてください。');
    return { available: true, version: 'codex-cli test' };
  }

  async runJson({ data, feedback, phase, signal, outputSchema, outputSchemaName, generationSettings }) {
    this.calls.push({ kind: 'invocation', phase, data: structuredClone(data),
      feedback: structuredClone(feedback), outputSchemaName, generationSettings: structuredClone(generationSettings),
      hasOutputSchema: Boolean(outputSchema) });
    if (this.waitForCancel) return await new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new CodexCancelledError(phase)); return; }
      signal.addEventListener('abort', () => reject(new CodexCancelledError(phase)), { once: true });
    });
    if (this.timeout) throw new CodexTimeoutError(phase);
    if (phase === 'MAKOTOMARU_CONFIGURATION') {
      this.makotomaruCalls += 1;
      if (this.makotomaruCalls <= this.invalidMakotomaruOutput) return {
        schemaVersion: '1.0', configuration: {}, designRationale: 'invalid fixture' };
      const difficulty = data.request.difficulty;
      const attackIds = difficulty === 1 ? ['reflected_xss'] : ['phishing', 'reflected_xss'];
      return { schemaVersion: '1.0', configuration: createDefaultConfiguration({
        mode: 'MAKOTOMARU', difficulty, attackIds }),
      designRationale: '登録済みAttackと調査資料から成立する経路を選択しました。' };
    }
    if (phase === 'GENERATING_SCENARIO' || phase === 'REVISING_SCENARIO') {
      this.scenarioCalls += 1;
      if (this.scenarioCalls <= this.malformedScenarioOutput) throw new CodexOutputError(
        'Codex出力が単一のJSONオブジェクトではありません。', { phase });
      if (this.malformedScenario) return { schemaVersion: '1.0' };
      if (outputSchemaName === 'scenario-revision') return { schemaVersion: '1.0', requirementUpdates: [] };
      const scenarioPackage = data.scenarioTemplate ? structuredClone(data.scenarioTemplate)
        : verifiedScenarioFixture(data.scenarioGenerationInput).scenarioPackage;
      if (this.changeScenarioSummaryOnRevision && this.scenarioCalls > 1) {
        scenarioPackage.scenarioDraft.summary = '事件の意味が変わるため、再承認が必要な概要です。';
      }
      return scenarioPackage;
    }
    if (phase === 'REVIEWING_SCENARIO') {
      this.reviewCalls += 1;
      if (this.reviewerSchemaFailure && this.reviewCalls === 1) return {};
      const review = semanticReview(data);
      if (this.reviewerGroundFailure && this.reviewCalls === 1) {
        const check = review.checks.find(item => item.category === 'IDENTITY_ATTRIBUTION');
        const wrongRef = data.allowedReviewRefs.find(item => item.startsWith('scenarioDraft:'));
        check.subjectRefs = [wrongRef]; check.sourceRefs = [wrongRef];
        return review;
      }
      const outcome = this.reviewOutcomes[Math.min(this.reviewCalls - 1,
        this.reviewOutcomes.length - 1)];
      if (outcome !== 'VERIFIED') {
        review.checks[0].outcome = 'FAIL'; review.checks[0].reason = '修正が必要です。';
        review.checks[0].correctionHint = 'Evidence Requirementの説明を既存groundに合わせてください。';
      }
      return review;
    }
    if (phase === 'REVIEWING_EVIDENCE') {
      this.evidenceReviewCalls += 1;
      // This is the isolated reviewer fixture, not the evidence author's
      // self-assessment. Failure paths provide their own reviewer response.
      return { schemaVersion: '1.0', status: 'VERIFIED', checks: [
        { checkId: 'OBSERVATION_GROUNDING', status: 'PASS',
          reason: '資料の記録内容と照合結果が、検証済みの取得条件で確認できる範囲に収まっています。' },
        { checkId: 'ATTRIBUTION_GROUNDING', status: 'PASS',
          reason: '攻撃経路に関する結論は提示された技術資料の照合に基づき、アカウントの一致だけには依存していません。' },
        { checkId: 'CLAIM_REFUTATION_ALIGNMENT', status: 'PASS',
          reason: '検察側の具体的な主張と、提示された証拠から反駁できる内容が対応しています。' },
        { checkId: 'EXPLANATION_GROUNDING', status: 'PASS',
          reason: '正答と解説は提示資料から確認できる内容に限定され、制作側だけが知る設定を証明に使っていません。' },
      ], issues: [] };
    }
    if (phase === 'GENERATING_EVIDENCE') {
      this.evidenceCalls += 1;
      if (this.evidenceCalls <= this.malformedEvidenceOutput) throw new CodexOutputError(
        'Codex出力が単一のJSONオブジェクトではありません。', { phase });
      if (this.evidenceInvalid) return { schemaVersion: '1.0' };
      const input = data.evidenceDraftInput;
      const agent = input.evidenceAgentInput;
      const draft = phase7Fixture({ verificationInput: agent.scenarioVerificationInput,
        verificationResult: agent.verificationResult,
        scenarioPackage: agent.scenarioVerificationInput.scenarioPackage }).evidencePackage;
      for (const artifact of draft.evidenceArtifacts) delete artifact.integrity;
      const titleCounts = new Map();
      for (const artifact of draft.evidenceArtifacts.filter(item => item.type !== 'TESTIMONY')) {
        const count = (titleCounts.get(artifact.title) ?? 0) + 1;
        titleCounts.set(artifact.title, count);
        if (count > 1) artifact.title = `${artifact.title}（取得資料${count}）`;
      }
      for (const artifact of draft.evidenceArtifacts.filter(item => item.type.endsWith('_LOG'))) {
        const example = JSON.parse(artifact.publicContent.split('\n')[0]);
        const count = artifact.publicContent.trim().split('\n').length;
        const background = Array.from({ length: Math.max(0, 100 - count) }, (_, offset) => {
          const index = offset + 1;
          const row = structuredClone(example);
          for (const [key, value] of Object.entries(row)) {
            if (typeof value !== 'string') continue;
            if (key === 'timestamp') row[key] = new Date(Date.UTC(2026, 8, 17, 23, 0, index * 30)).toISOString();
            else if (key === 'request_target') row[key] = `/help?document=guide-${index}`;
            else if (key === 'statement') row[key] = `SELECT title FROM training_records WHERE category = 'guide-${index}'`;
            else if (key === 'stored_content') row[key] = `Routine announcement ${index}`;
            else if (key === 'source_ip') row[key] = `192.0.2.${index}`;
            else if (key === 'destination') row[key] = `https://portal.example.invalid/forms/help-${index}`;
            else if (/account|user|_id$|_ref$/.test(key)) row[key] = `routine-${index}`;
          }
          return JSON.stringify(row);
        });
        artifact.publicContent += '\n' + background.join('\n');
      }
      const logBackgrounds = ransomwareLogSamples(draft.evidenceArtifacts);
      if (logBackgrounds.length) draft.logBackgrounds = logBackgrounds;
      if (data.requestedCourtIssueCount) addDistinctClaims(draft, data.requestedCourtIssueCount);
      const stageRequirements = agent.scenarioVerificationInput.scenarioPackage.evidenceRequirements.requirements
        .filter(item => item.investigationStage);
      if (data.investigationStages) assignStageSupports(draft, data.investigationStages, stageRequirements);
      addCourtQuestions(draft);
      const statements = draft.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')
        .flatMap(item => item.testimony.statements).filter(item => item.technicalAssessment === 'CONTRADICTED');
      for (const requirement of stageRequirements) {
        const plan = requirement.investigationStage;
        const statement = statements[plan.order - 1];
        const question = draft.courtQuestions.find(item => item.statementId === statement?.statementId);
        // A later attack must not inherit the first attack's technical fact
        // simply because the original testimony was used as a template.
        const attackNodes = new Set(requirement.grounds.map(ground => ground.attackNodeId));
        const truth = agent.scenarioVerificationInput.scenarioPackage.groundTruth;
        const facts = [
          ...truth.technicalFacts.filter(fact => fact.sourceType === 'ATTACK_NODE'
            && attackNodes.has(fact.attackNodeId)).map(fact => fact.factId),
        ];
        if (statement && facts.length) {
          statement.groundTruthRefs = facts;
          draft.contradictions.filter(item => item.statementRef === statement.statementId)
            .forEach(item => { item.groundTruthRefs = [...facts]; });
        }
        if (question) {
          const values = question.supportingQuotes.map(item => observationAnchors(item.quote)[0]);
          question.prompt = `${values[0]}を含む資料について、${plan.questionFocus}`;
          question.choices[0] = plan.expectedInference.split('。')[0] + '。';
          question.explanation = `${plan.expectedInference}\n照合する記録値：${values.join('、')}。`;
        }
      }
      draft.materialInvestigations = draft.evidenceArtifacts.filter(item => item.type !== 'TESTIMONY').map(item => {
        const lineCount = item.publicContent.replace(/\n$/, '').split('\n').length;
        return { schemaVersion: '1.0', evidenceId: item.evidenceId, steps: [
          { prompt: '対象の記録に含まれる項目と値を確認する', correctOptionIndex: 0,
            explanation: '原文の項目と値を読み、記録範囲を確認する。', choices: [
              { description: '記録の全文を確認する', operation: { kind: 'LINES', firstLine: 1, lastLine: lineCount, needle: '' } },
              { description: 'ファイルの改行数だけを数える', operation: { kind: 'COUNT', firstLine: 1, lastLine: 1, needle: '' } },
            ] },
          { prompt: '照合に使う対象記録の原文を確認する', correctOptionIndex: 0,
            explanation: '対象記録と、関連資料の時刻・識別子を比較する。人物の断定はできない。', choices: [
              { description: '先頭の対象記録を表示する', operation: { kind: 'LINES', firstLine: 1, lastLine: 1, needle: '' } },
              { description: '改行数だけを確認する', operation: { kind: 'COUNT', firstLine: 1, lastLine: 1, needle: '' } },
            ] },
        ] };
      });
      return draft;
    }
    throw new Error(`unexpected phase: ${phase}`);
  }
}
