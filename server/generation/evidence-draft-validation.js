import { ValidationError } from './schema.js';
import { validateGeneratedLogFormats } from './evidence-log-format.js';
import { validateLearningObservations } from './learning-observations.js';
import { validatePhishingObservations } from './phishing-evidence.js';
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
export function evidenceDraftProblems(draft, evidencePackage, agentInput) {
  const issues = [];
  const inspect = (operation, index = null) => {
    try { operation(); }
    catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(issue(error, index === null ? error.field : error.field.replace(/^evidenceArtifacts\[0\]/, `evidenceArtifacts[${index}]`)));
    }
  };
  evidencePackage.evidenceArtifacts.forEach((artifact, index) => {
    inspect(() => validateGeneratedLogFormats([artifact]), index);
    inspect(() => validateLearningObservations([artifact]), index);
  });
  // Cross-source correlations need the full set; only run after field validation.
  if (!issues.some(item => item.code.startsWith('EVIDENCE_LEARNING_')))
    inspect(() => validateLearningObservations(evidencePackage.evidenceArtifacts));
  inspect(() => validatePhishingObservations(evidencePackage.evidenceArtifacts, agentInput.attackGraph));
  inspect(() => validateMaterialPlans(draft.materialInvestigations, evidencePackage.evidenceArtifacts));
  issues.push(...courtQuestionSourceErrors(draft.courtQuestions, evidencePackage, agentInput).map(error => issue(error)));
  return issues;
}
