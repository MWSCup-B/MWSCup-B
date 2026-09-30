import { readFile } from 'node:fs/promises';
import { validateAttackGraphResult, buildAttackGraphs } from './attack-graph.js';
import { validateEnvironment } from './evaluator.js';
import { validateScenarioContract } from './scenario-validator.js';
import { fail, validateDocument, ValidationError } from './schema.js';

export const SCENARIO_PROMPT_TEMPLATE_VERSION = '1.0';
// 2026-09-20 修正前: 保存用コメントの旧指示をAIに送らない
// export const SCENARIO_PROMPT_TEMPLATE = await readFile(
//   new URL('../../prompts/scenario-generation-v1.md', import.meta.url), 'utf8');
// 2026-09-20 修正後: 有効な指示だけを生成に使用する
export const SCENARIO_PROMPT_TEMPLATE = (await readFile(
  new URL('../../prompts/scenario-generation-v1.md', import.meta.url), 'utf8'))
  .replace(/<!--[\s\S]*?-->/g, '');

const REQUIRED_ARTIFACTS = ['groundTruth', 'timeline', 'characters', 'learningObjectives',
  'evidenceRequirements', 'scenarioDraft'];
const DOCUMENTS = [
  ['scenarioDraft', 'scenario-draft'],
  ['groundTruth', 'ground-truth'],
  ['characters', 'character'],
  ['timeline', 'timeline'],
  ['learningObjectives', 'learning-objective'],
  ['evidenceRequirements', 'evidence-requirement'],
];
const OUTPUT_SCHEMAS = new Map(await Promise.all(DOCUMENTS.map(async ([artifact, schema]) => [artifact,
  JSON.parse(await readFile(new URL(`../../schemas/${schema}.schema.json`, import.meta.url), 'utf8')),
])));
const IMPORT_PACKAGE_SCHEMA = JSON.parse(await readFile(
  new URL('../../schemas/scenario-import-package.schema.json', import.meta.url), 'utf8'));

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sameValues(left, right) {
  return canonical(left) === canonical(right);
}

function generationInputRef(input) {
  return {
    generationInputId: input.generationInputId,
    inputDigest: input.attackGraphRef.inputDigest,
    graphId: input.attackGraphRef.graphId,
  };
}

function singleGraphResult(input) {
  return {
    schemaVersion: '1.0', status: 'CREATED', evaluationState: 'SATISFIED',
    scope: 'CANDIDATE_FEASIBILITY_ONLY', inputDigest: input.attackGraphRef.inputDigest,
    graphs: [structuredClone(input.technicalInput.attackGraph)], issues: [],
  };
}

export function validateScenarioGenerationInput(input) {
  validateDocument('scenario-generation-input', input);
  const { network, scenarioContext: context, candidate, attackDefinitions: definitions,
    attackGraph: graph } = input.technicalInput;
  validateEnvironment(network, context, definitions);
  const rebuilt = buildAttackGraphs({ network, context, candidate, definitions });
  if (rebuilt.status !== 'CREATED' || rebuilt.inputDigest !== input.attackGraphRef.inputDigest) {
    fail('GENERATION_SOURCE_MISMATCH', 'scenario-generation-input.technicalInput',
      '技術入力からAttack Graph ResultのinputDigestを再現できません。');
  }
  const rebuiltGraph = rebuilt.graphs.find(item => item.graphId === input.attackGraphRef.graphId);
  if (!rebuiltGraph || !sameValues(rebuiltGraph, graph)) {
    fail('GENERATION_SOURCE_MISMATCH', 'scenario-generation-input.technicalInput.attackGraph',
      '技術入力から同一のAttack Graphを再構築できません。');
  }
  if (!sameValues([...input.selectedAttackIds].sort(), [...graph.selectedAttackIds].sort())
    || !sameValues([...candidate.selectedAttackIds].sort(), [...graph.selectedAttackIds].sort())) {
    fail('SELECTION_MISMATCH', 'scenario-generation-input.selectedAttackIds',
      '選択攻撃とAttack Graphまたはcandidateが一致しません。');
  }
  if (!sameValues(input.outputContract.requiredArtifacts, REQUIRED_ARTIFACTS)) {
    fail('INVALID_OUTPUT_CONTRACT', 'scenario-generation-input.outputContract.requiredArtifacts',
      'Phase 5Aの必須成果物一覧が一致しません。');
  }
  const expectedSchemas = REQUIRED_ARTIFACTS.map(artifact => ({ artifact, schemaVersion: '1.0',
    jsonSchema: OUTPUT_SCHEMAS.get(artifact) }));
  if (!sameValues(input.outputContract.packageSchema, IMPORT_PACKAGE_SCHEMA)
    || !sameValues(input.outputContract.artifactSchemas, expectedSchemas)) {
    fail('INVALID_OUTPUT_CONTRACT', 'scenario-generation-input.outputContract',
      '同梱されたImport PackageまたはPhase 5A SchemaがBackendの正本と一致しません。');
  }
  return input;
}

// 各graphを独立した外部生成入力にし、候補の選択・統合・削除は行わない。
export function buildScenarioGenerationInputs({ attackGraphResult, definitions, network, context, candidate }) {
  validateAttackGraphResult(attackGraphResult);
  if (attackGraphResult.status !== 'CREATED') {
    fail('ATTACK_GRAPH_NOT_READY', 'attackGraphResult.status',
      '成立済みAttack GraphがないためScenario Generation Inputを作成できません。');
  }
  validateEnvironment(network, context, definitions);
  const source = buildAttackGraphs({ definitions, network, context, candidate });
  if (source.status !== 'CREATED' || source.inputDigest !== attackGraphResult.inputDigest
    || !sameValues(source.graphs, attackGraphResult.graphs)) {
    fail('GENERATION_SOURCE_MISMATCH', 'attackGraphResult',
      'Attack Graph Resultと元のNetwork、Scenario Context、candidate、Attack Definitionが一致しません。');
  }
  return attackGraphResult.graphs.map(graph => validateScenarioGenerationInput({
    schemaVersion: '1.0', generationInputId: `scenario_generation_${graph.graphId}`,
    generatorMode: 'EXTERNAL_USER_CODEX', promptTemplateVersion: SCENARIO_PROMPT_TEMPLATE_VERSION,
    attackGraphRef: { inputDigest: attackGraphResult.inputDigest, graphId: graph.graphId },
    selectedAttackIds: [...graph.selectedAttackIds],
    technicalInput: {
      network: structuredClone(network), scenarioContext: structuredClone(context),
      candidate: structuredClone(candidate), attackDefinitions: structuredClone(definitions),
      attackGraph: structuredClone(graph),
    },
    outputContract: {
      schemaVersion: '1.0', requiredArtifacts: [...REQUIRED_ARTIFACTS],
      packageSchema: structuredClone(IMPORT_PACKAGE_SCHEMA),
      artifactSchemas: REQUIRED_ARTIFACTS.map(artifact => ({ artifact, schemaVersion: '1.0',
        jsonSchema: structuredClone(OUTPUT_SCHEMAS.get(artifact)) })),
    },
  }));
}

function externalError(error, correctionHint) {
  return {
    code: error.code ?? 'INVALID_SCENARIO_PACKAGE', field: error.field ?? 'scenario-import-package',
    reason: error.message, correctionHint,
  };
}

export function validateScenarioFeedback(feedback) {
  validateDocument('scenario-validation-feedback', feedback);
  return feedback;
}

export function validateScenarioImportResult(result) {
  validateDocument('scenario-import-result', result);
  const valid = result.status === 'VALID';
  if (valid !== result.valid || (valid && (result.errors.length || result.feedback
    || result.validationStages.schema !== 'PASSED' || result.validationStages.consistency !== 'PASSED'))
    || (!valid && (!result.errors.length || !result.feedback))) {
    fail('INVALID_IMPORT_RESULT', 'scenario-import-result.status',
      'Import結果のstatus、検証段階、error、feedbackが矛盾しています。');
  }
  if (result.feedback) {
    validateScenarioFeedback(result.feedback);
    const expectedStage = result.validationStages.schema === 'FAILED'
      ? 'SCHEMA_VALIDATION' : 'CONSISTENCY_VALIDATION';
    if (!sameValues(result.errors, result.feedback.errors)
      || !sameValues(result.generationInputRef, result.feedback.generationInputRef)
      || result.feedback.validationStage !== expectedStage) {
      fail('INVALID_IMPORT_RESULT', 'scenario-import-result.feedback',
        'Import結果とValidation Feedbackの参照、検証段階、またはerrorが一致しません。');
    }
  }
  if (!valid && !((result.validationStages.schema === 'FAILED'
    && result.validationStages.consistency === 'NOT_RUN')
    || (result.validationStages.schema === 'PASSED'
      && result.validationStages.consistency === 'FAILED'))) {
    fail('INVALID_IMPORT_RESULT', 'scenario-import-result.validationStages',
      'INVALID結果のSchemaとConsistencyの検証状態が矛盾しています。');
  }
  return result;
}

function invalidResult(ref, scenarioId, attackGraphRef, stage, stages, errors) {
  const feedback = validateScenarioFeedback({
    schemaVersion: '1.0', status: 'INVALID', generationInputRef: { ...ref },
    validationStage: stage, errors: structuredClone(errors),
  });
  return validateScenarioImportResult({
    schemaVersion: '1.0', status: 'INVALID', valid: false, scope: 'EXTERNAL_SCENARIO_IMPORT',
    generationInputRef: { ...ref }, scenarioId, attackGraphRef, validationStages: stages,
    errors, feedback,
  });
}

// 外部生成JSONを採用せずに検証する。LLM呼出し、補完、自動再生成、永続化は行わない。
export function importScenarioPackage({ generationInput, scenarioPackage }) {
  validateScenarioGenerationInput(generationInput);
  const ref = generationInputRef(generationInput);
  const expectedGraphRef = { inputDigest: ref.inputDigest, graphId: ref.graphId };
  let scenarioId = null;
  try {
    validateDocument('scenario-import-package', scenarioPackage);
    for (const [property, schema] of DOCUMENTS) validateDocument(schema, scenarioPackage[property]);
    scenarioId = scenarioPackage.scenarioDraft.scenarioId;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const issue = externalError(error,
      '該当するPhase 5A JSON Schema v1.0に合わせ、必須フィールド、型、列挙値、未知フィールドを修正してください。');
    return invalidResult(ref, scenarioId, expectedGraphRef, 'SCHEMA_VALIDATION',
      { schema: 'FAILED', consistency: 'NOT_RUN' }, [issue]);
  }

  if (!sameValues(scenarioPackage.generationInputRef, ref)) {
    const issue = {
      code: 'GENERATION_INPUT_REFERENCE_MISMATCH', field: 'scenario-import-package.generationInputRef',
      reason: 'Import Packageが検証対象とは異なるGeneration Inputを参照しています。',
      correctionHint: 'generationInputId、inputDigest、graphIdを対象Generation Inputから変更せずコピーしてください。',
    };
    return invalidResult(ref, scenarioId, expectedGraphRef, 'CONSISTENCY_VALIDATION',
      { schema: 'PASSED', consistency: 'FAILED' }, [issue]);
  }
  if (scenarioPackage.characters.characters.some(character => character.provenance !== 'AI_GENERATED_SYNTHETIC')) {
    const issue = {
      code: 'NON_SYNTHETIC_CHARACTER', field: 'character.characters.provenance',
      reason: '外部Scenario Generatorが出力した人物は、実在人物と混同しない教材内人物として明示する必要があります。',
      correctionHint: '生成した全人物のprovenanceをAI_GENERATED_SYNTHETICにし、実在人物と混同しない表示名だけを使用してください。',
    };
    return invalidResult(ref, scenarioId, expectedGraphRef, 'CONSISTENCY_VALIDATION',
      { schema: 'PASSED', consistency: 'FAILED' }, [issue]);
  }

  const validation = validateScenarioContract({
    attackGraphResult: singleGraphResult(generationInput),
    definitions: generationInput.technicalInput.attackDefinitions,
    scenarioDraft: scenarioPackage.scenarioDraft, groundTruth: scenarioPackage.groundTruth,
    characters: scenarioPackage.characters, timeline: scenarioPackage.timeline,
    learningObjectives: scenarioPackage.learningObjectives,
    evidenceRequirements: scenarioPackage.evidenceRequirements,
  });
  if (validation.status !== 'VALID') {
    const errors = validation.issues.map(issue => ({
      code: issue.code, field: issue.field, reason: issue.reason, correctionHint: issue.suggestion,
    }));
    return invalidResult(ref, scenarioId, expectedGraphRef, 'CONSISTENCY_VALIDATION',
      { schema: 'PASSED', consistency: 'FAILED' }, errors);
  }
  return validateScenarioImportResult({
    schemaVersion: '1.0', status: 'VALID', valid: true, scope: 'EXTERNAL_SCENARIO_IMPORT',
    generationInputRef: ref, scenarioId, attackGraphRef: expectedGraphRef,
    validationStages: { schema: 'PASSED', consistency: 'PASSED' }, errors: [], feedback: null,
  });
}
