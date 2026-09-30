import { ValidationError } from './schema.js';
import { validateGeneratedLogFormats, validateExplorableWebLogs } from './evidence-log-format.js';
import { validateLearningObservations } from './learning-observations.js';
import { validatePhishingObservations } from './phishing-evidence.js';
import { validateRansomwareObservations } from './ransomware-observations.js';
import { validateMaterialPlans } from './investigation-procedures.js';
import { courtQuestionSourceErrors } from './court-questions.js';

const questionHint = '各4択を取得可能な資料に基づく問いにし、supportingQuotesには対応する公開原文を正確に引用してください。解説は引用が示す内容と記録の限界に合わせ、存在しない対応や相違を前提にしないでください。';
function issue(error, field = error.field) {
  return { code: error.code, field, reason: error.message, correctionHint: error.correctionHint
    ?? (error.code.startsWith('EVIDENCE_LEARNING_') && field.startsWith('courtQuestions') ? questionHint
      : error.code.startsWith('EVIDENCE_QUESTION_') ? questionHint + '引用・参照の不一致も同時に修正してください。'
        : error.code === 'EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE'
          ? 'learningObservationFieldsの必須項目を省略せず、JSON Linesの各対象行に値を記載してください。Webはtimestampとrequest_targetが必須です。合成値は取得定義・Requirementの範囲内とし、本文・引用・調査手順・解説の対応も直してください。'
          : '指摘された取得条件・形式・調査手順を修正し、元のRequirement・ground・証言と複数資料の対応を維持してください。') };
}

// Called only after schema/shape validation. Independent failures go to the same
// bounded repair instead of revealing the next defect only on the last attempt.
export function evidenceDraftProblems(draft, evidencePackage, agentInput, observationArtifacts = evidencePackage.evidenceArtifacts) {
  const issues = [];
  const inspect = (operation, index = null) => {
    try { operation(); }
    catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(issue(error, index === null ? error.field : error.field.replace(/^evidenceArtifacts\[0\]/, `evidenceArtifacts[${index}]`)));
    }
  };
  // Generated labels/instructions are editorial text, separate from immutable
  // quoted evidence. Return wording defects to the author rather than rewriting it.
  const displayText = [
    ...evidencePackage.evidenceArtifacts.map(item => item.title),
    ...(draft.courtQuestions ?? []).flatMap(item => [item.prompt, item.explanation, ...item.choices]),
    ...(draft.materialInvestigations ?? []).flatMap(item => item.steps.flatMap(step =>
      [step.prompt, step.explanation, ...step.choices.map(choice => choice.description)])),
  ];
  if (displayText.some(text => /ブラウザ(?:実行)?(?:記録|\u8a08\u6e2c)/.test(text))) issues.push({
    code: 'EVIDENCE_PRESENTATION_TERMINOLOGY', field: 'evidence-generation-draft',
    reason: 'ブラウザ実行記録・ブラウザ記録という表示用語は使用しません。',
    correctionHint: '表示名・問題文・解説では「ブラウザのスクリプト実行記録」または「ブラウザの動作記録」を使ってください。原文・引用・参照・観測値は変更しません。',
  });
  evidencePackage.evidenceArtifacts.forEach((artifact, index) => {
    inspect(() => validateGeneratedLogFormats([artifact], evidencePackage.evidenceArtifacts), index);
    inspect(() => validateExplorableWebLogs([artifact], evidencePackage.evidenceArtifacts), index);
    inspect(() => validateLearningObservations([observationArtifacts[index]]), index);
  });
  // Correlations use original authored incident rows. Repeated ordinary samples
  // must never fill a missing causal link or a required observation field.
  if (!issues.some(item => item.code.startsWith('EVIDENCE_LEARNING_')))
    inspect(() => validateLearningObservations(observationArtifacts));
  inspect(() => validatePhishingObservations(evidencePackage.evidenceArtifacts, agentInput.attackGraph));
  inspect(() => validateRansomwareObservations(observationArtifacts, agentInput.attackGraph));
  inspect(() => validateMaterialPlans(draft.materialInvestigations, evidencePackage.evidenceArtifacts));
  issues.push(...courtQuestionSourceErrors(draft.courtQuestions, evidencePackage, agentInput).map(error => issue(error)));
  return issues;
}
