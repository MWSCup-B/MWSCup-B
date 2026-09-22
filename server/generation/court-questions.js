import { readFile } from 'node:fs/promises';
import { digest, leakedInternalValue } from './evidence-validator.js';
import { fail, validateDocument } from './schema.js';

export const COURT_QUESTION_SCHEMA = JSON.parse(await readFile(
  new URL('../../schemas/court-question.schema.json', import.meta.url), 'utf8'));

export function validateCourtQuestion(question) {
  validateDocument('court-question', question);
  const labels = question.choices.map(text => text.normalize('NFKC').replace(/\s/g, ''));
  if (new Set(labels).size !== 4) fail('EVIDENCE_QUESTION_DUPLICATE_CHOICE',
    'courtQuestions.choices', '解釈の選択肢は、内容の異なる4つにしてください。');
  return question;
}

// Choice IDs and display order depend on public text, never on correctness or model order.
export function courtChoiceId(question, text) {
  return `choice_${digest({ statementId: question.statementId, prompt: question.prompt, text }).slice(0, 24)}`;
}

export function publicCourtQuestion(question) {
  return { statementId: question.statementId, prompt: question.prompt,
    choices: question.choices.map(text => ({ choiceId: courtChoiceId(question, text), text }))
      .sort((a, b) => a.choiceId.localeCompare(b.choiceId)) };
}

export function correctCourtChoiceId(question) {
  return courtChoiceId(question, question.choices[question.correctOptionIndex]);
}

// A minimum specificity check, not a semantic verdict: a quoted source must be
// used in the reasoning, rather than attached to a stock "cannot identify" answer.
export function observationAnchors(content) {
  const anchors = new Set();
  const add = value => {
    if (typeof value !== 'string' || value.length < 3 || value.length > 180
      || /^\d{4}-\d{2}-\d{2}(?:T|\s|$)/.test(value)
      || /^(?:success|failure|true|false|null|started|stored|confirmed|accepted|denied)$/i.test(value)) return;
    anchors.add(value);
  };
  const values = value => {
    if (Array.isArray(value)) value.forEach(values);
    else if (value && typeof value === 'object') Object.values(value).forEach(values);
    else add(value);
  };
  // Parse complete JSON too: pretty printing, arrays and nested measurements
  // must expose their values, never field names such as "request_id".
  try { values(JSON.parse(content)); return [...anchors]; }
  catch { /* Native text and JSON Lines are handled below. */ }
  for (const line of content.split(/\r?\n/)) {
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') {
        values(row);
        continue;
      }
    } catch { /* Mail and saved documents retain their native text. */ }
    const valueText = /^https?:\/\//.test(line.trim()) ? line
      : line.replace(/^\s*[^:=\r\n]{1,60}[:=]\s*/, '');
    for (const token of valueText.match(/https?:\/\/[^\s<>"']+|[a-zA-Z0-9]+(?:[-_./:@][a-zA-Z0-9]+)+/g) ?? []) add(token);
  }
  return [...anchors];
}

function validateLearningSpecificity(question, evidence, agentInput) {
  if (!agentInput?.evidenceRequirements?.requirements.some(item => item.investigationStage)) return;
  const byEvidence = new Map();
  for (const item of question.supportingQuotes) {
    byEvidence.set(item.evidenceId, [...(byEvidence.get(item.evidenceId) ?? []), ...observationAnchors(item.quote)]);
  }
  for (const [id, anchors] of byEvidence) {
    if (!anchors.some(value => question.explanation.includes(value))) fail(
      'EVIDENCE_LEARNING_COMPARISON_REQUIRED', `courtQuestions.${question.statementId}.explanation`,
      `「${evidence.get(id)?.title ?? id}」の引用中の対象・値を明記し、その資料から何が分かるか、他の資料との対応と限界を解説してください。引用内の値の例: ${JSON.stringify(anchors.slice(0, 5))}。一般論や資料名だけでは不十分です。`);
  }
  if (![...byEvidence.values()].flat().some(value => question.prompt.includes(value))) fail(
    'EVIDENCE_LEARNING_OBSERVATION_REQUIRED', `courtQuestions.${question.statementId}.prompt`,
    `問題文に、根拠となる公開原文の具体的な対象・値と、今回の記録が事件のどの段階かを含めてください。引用内の値の例: ${JSON.stringify([...new Set([...byEvidence.values()].flat())].slice(0, 8))}。選択肢だけに値を置く設問や一般論だけで回答できる設問は使用できません。`);
}

// The quotes are private provenance, not hints. Interpretations remain hypotheses in the UI.
export function validateCourtQuestionSources(questions, evidenceSet, agentInput = null) {
  const targets = new Set(evidenceSet.contradictions.map(item => item.statementRef));
  if (!Array.isArray(questions) || questions.length !== targets.size
    || new Set(questions.map(item => item?.statementId)).size !== targets.size) {
    fail('EVIDENCE_COURT_QUESTIONS_REQUIRED', 'courtQuestions',
      '各争点に、資料から言えることを問う4択問題を1問ずつ用意してください。');
  }
  const evidence = new Map(evidenceSet.evidenceArtifacts.map(item => [item.evidenceId, item]));
  for (const question of questions) {
    validateCourtQuestion(question);
    const publicText = [question.prompt, ...question.choices, question.explanation];
    if (agentInput && publicText.some(text => leakedInternalValue(text, agentInput)
      || agentInput.characters.characters.some(person => text.includes(person.characterId)))) {
      fail('EVIDENCE_QUESTION_PRIVATE_LEAK', 'courtQuestions', '問題文・選択肢・解説に内部IDや正解ラベルを表示しないでください。');
    }
    if (!targets.has(question.statementId)) fail('EVIDENCE_QUESTION_STATEMENT_MISMATCH',
      'courtQuestions.statementId', '4択問題を既存Contradictionの対象発言へ対応付けてください。');
    const supports = new Set(evidenceSet.contradictions.filter(item => item.statementRef === question.statementId)
      .flatMap(item => item.conflictingEvidenceIds));
    if ([...supports].some(id => !question.supportingQuotes.some(item => item.evidenceId === id))) {
      fail('EVIDENCE_QUESTION_GROUND_MISMATCH', 'courtQuestions.supportingQuotes',
        '競合する各技術資料の公開原文から、解釈に必要な箇所を引用してください。');
    }
    for (const { evidenceId, quote } of question.supportingQuotes) {
      const artifact = evidence.get(evidenceId);
      if (!supports.has(evidenceId) || !artifact || artifact.type === 'TESTIMONY'
        || !artifact.publicContent.includes(quote)) fail('EVIDENCE_QUESTION_QUOTE_MISMATCH',
        'courtQuestions.supportingQuotes', '引用は対応する技術資料のpublicContentに実在する文字列にしてください。');
    }
    validateLearningSpecificity(question, evidence, agentInput);
  }
  return questions;
}
