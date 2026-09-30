import { ValidationError } from './schema.js';
import { validateGeneratedLogFormats, validateExplorableWebLogs } from './evidence-log-format.js';
import { validateLearningObservations } from './learning-observations.js';
import { validatePhishingObservations } from './phishing-evidence.js';
import { validateRansomwareObservations } from './ransomware-observations.js';
import { materialPlanProblems } from './investigation-procedures.js';
import { courtQuestionSourceErrors } from './court-questions.js';
import { presentationWordingProblems } from './court-claim-style.js';

const questionHint = '各4択を取得可能な資料に基づく問いにし、supportingQuotesには対応する公開原文を正確に引用してください。解説は引用が示す内容と記録の限界に合わせ、存在しない対応や相違を前提にしないでください。';
function issue(error, field = error.field) {
  return { code: error.code, field, reason: error.message, retryable: Boolean(error.retryable), correctionHint: error.correctionHint
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
  const inspectWording = (text, field) => {
    for (const problem of presentationWordingProblems(text)) issues.push({
      code: 'EVIDENCE_PRESENTATION_TERMINOLOGY', field, ...problem,
      correctionHint: `${problem.correctionHint} 原文・引用・参照・観測値は変更しません。`,
    });
  };
  evidencePackage.evidenceArtifacts.forEach((item, index) => {
    const field = `evidenceArtifacts[${index}]`;
    inspectWording(item.title, `${field}.title`);
    if (item.type === 'TESTIMONY') {
      inspectWording(item.publicContent, `${field}.publicContent`);
      item.testimony?.statements.forEach((statement, statementIndex) =>
        inspectWording(statement.spokenContent, `${field}.testimony.statements[${statementIndex}].spokenContent`));
    }
  });
  (draft.courtQuestions ?? []).forEach((item, index) => {
    const field = `courtQuestions[${index}]`;
    inspectWording(item.prompt, `${field}.prompt`);
    inspectWording(item.explanation, `${field}.explanation`);
    item.choices.forEach((text, choiceIndex) => inspectWording(text, `${field}.choices[${choiceIndex}]`));
  });
  (draft.materialInvestigations ?? []).forEach((item, index) => item.steps.forEach((step, stepIndex) => {
    const field = `materialInvestigations[${index}].steps[${stepIndex}]`;
    inspectWording(step.prompt, `${field}.prompt`);
    inspectWording(step.explanation, `${field}.explanation`);
    step.choices.forEach((choice, choiceIndex) =>
      inspectWording(choice.description, `${field}.choices[${choiceIndex}].description`));
  }));
  for (const kind of ['contradictions', 'exonerations'])
    (evidencePackage[kind] ?? []).forEach((item, index) => inspectWording(item.reason, `${kind}[${index}].reason`));
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
  issues.push(...materialPlanProblems(draft.materialInvestigations, evidencePackage.evidenceArtifacts).map(error => issue(error)));
  issues.push(...courtQuestionSourceErrors(draft.courtQuestions, evidencePackage, agentInput).map(error => issue(error)));
  return issues;
}
