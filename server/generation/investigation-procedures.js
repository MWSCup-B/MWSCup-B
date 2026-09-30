import { readFile } from 'node:fs/promises';
import { fail, validateDocument, ValidationError } from './schema.js';
import { createHash } from 'node:crypto';

export const MATERIAL_PLAN_SCHEMA = JSON.parse(await readFile(
  new URL('../../schemas/material-investigation-plan.schema.json', import.meta.url), 'utf8'));
export const INVESTIGATION_HOMEWORK = await readFile(
  new URL('../../docs/investigation-homework.txt', import.meta.url), 'utf8');

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const linesOf = content => content.replace(/\n$/, '').split('\n');

// Work exclusively on the sealed, read-only UTF-8 export. Never invoke a shell,
// SQL engine, browser, or code from a document. Command and output share one operation.
export function procedureCommand(operation) {
  if (operation.kind === 'MATCH') return `grep -nF -- ${quote(operation.needle)} material.txt`;
  if (operation.kind === 'COUNT') return 'wc -l < material.txt';
  return `sed -n '${operation.firstLine},${operation.lastLine}p' -- material.txt`;
}

export function procedureOutput(content, operation) {
  if (operation.kind === 'COUNT') return String((content.match(/\n/g) ?? []).length);
  const lines = linesOf(content);
  if (operation.kind === 'MATCH') return lines.map((line, index) => ({ line, index }))
    .filter(item => item.line.includes(operation.needle)).map(item => `${item.index + 1}:${item.line}`).join('\n');
  return lines.slice(operation.firstLine - 1, operation.lastLine).join('\n');
}

export function validateMaterialPlans(plans, artifacts) {
  const materials = artifacts.filter(item => item.type !== 'TESTIMONY');
  const reject = (message, field = 'materialInvestigations', correctionHint = undefined) =>
    fail('INVALID_MATERIAL_PROCEDURES', field, message, { correctionHint });
  if (!Array.isArray(plans) || plans.length !== materials.length
    || new Set(plans.map(plan => plan.evidenceId)).size !== plans.length) reject('全調査資料に一つずつ調査手順を用意してください。');
  for (const plan of plans) {
    validateDocument('material-investigation-plan', plan);
    const artifact = materials.find(item => item.evidenceId === plan.evidenceId);
    if (!artifact) reject('調査対象が公開資料にありません。');
    for (const [stepIndex, step] of plan.steps.entries()) {
      if (!Number.isInteger(step.correctOptionIndex) || !step.choices[step.correctOptionIndex]) reject('次の調査へ進む選択肢を指定してください。');
      if (new Set(step.choices.map(choice => choice.description)).size !== step.choices.length) reject('同じ操作を選択肢として重複させないでください。');
      for (const [choiceIndex, choice] of step.choices.entries()) {
        const op = choice.operation;
        const lineCount = linesOf(artifact.publicContent).length;
        if (!Number.isInteger(op.firstLine) || !Number.isInteger(op.lastLine)
          || op.firstLine < 1 || op.lastLine < op.firstLine || op.lastLine > lineCount
          || (op.kind === 'MATCH' && (!op.needle || /[\r\n\0]/.test(op.needle)))) reject(
          `${artifact.evidenceId}の原文は${lineCount}行です。指定範囲${op.firstLine}〜${op.lastLine}、または検索文字列が不正です。`,
          `materialInvestigations.${plan.evidenceId}.steps[${stepIndex}].choices[${choiceIndex}].operation`,
          `firstLine・lastLineは1〜${lineCount}の整数とし、firstLine <= lastLineにしてください。MATCHのneedleは改行・空文字を含まない単一行の文字列です。MATCH・COUNTでも必須の行範囲には有効な値（例: 1, 1）を指定します。本文を変更した場合は引用と調査手順も再確認してください。`);
      }
      if (!procedureOutput(artifact.publicContent, step.choices[step.correctOptionIndex].operation)) reject('次の手順に必要な観測が資料にありません。');
    }
  }
  return plans;
}

// Report defects for every material in the same bounded repair. A broken
// procedure in one report must not conceal a second report's invalid range.
export function materialPlanProblems(plans, artifacts) {
  const materials = artifacts.filter(item => item.type !== 'TESTIMONY');
  const errors = [];
  const inspect = (selectedPlans, selectedArtifacts) => {
    try { validateMaterialPlans(selectedPlans, selectedArtifacts); }
    catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      errors.push(error);
    }
  };
  if (!Array.isArray(plans) || plans.length !== materials.length
    || new Set(plans.map(plan => plan.evidenceId)).size !== plans.length
    || plans.some(plan => !materials.some(item => item.evidenceId === plan.evidenceId))) {
    inspect(plans, materials);
  } else for (const plan of plans) inspect([plan], materials.filter(item => item.evidenceId === plan.evidenceId));
  return errors;
}

export function procedureMethods(plan, stepIndex) {
  const step = plan.steps[stepIndex];
  if (!step) return [];
  // IDs do not reveal the authored answer position. The order is stable for replay.
  return step.choices.map((choice, index) => ({
    methodId: createHash('sha256').update(`${plan.evidenceId}:${stepIndex}:${index}:${choice.description}`).digest('hex').slice(0, 16),
    description: choice.description, label: procedureCommand(choice.operation),
    index, operation: choice.operation,
  })).sort((a, b) => a.methodId.localeCompare(b.methodId));
}
