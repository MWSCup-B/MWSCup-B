import { readFile } from 'node:fs/promises';
import { fail, validateDocument } from './schema.js';
import { validateScenarioGenerationInput } from './scenario-interface.js';
import { validateScenarioEvidenceCoverage } from './scenario-template.js';
import { buildInvestigationStages } from './investigation-registry.js';

export const SCENARIO_REVISION_PROMPT = await readFile(
  new URL('../../prompts/scenario-revision-v1.md', import.meta.url), 'utf8');

export function buildScenarioRevisionInput({ generationInput, configuration, scenarioPackage }) {
  validateScenarioGenerationInput(generationInput);
  const technicalInput = structuredClone(generationInput.technicalInput);
  // 未選択の定義・外部生成用schema・Configuration内の重複Networkは修正に不要。
  // 選択した定義、成立条件、評価、観測条件は省略せず、正本の検証には元の入力を使う。
  const selected = new Set(generationInput.selectedAttackIds);
  technicalInput.attackDefinitions = technicalInput.attackDefinitions.filter(item => selected.has(item.id));
  return { contextFormat: 'SCENARIO_REQUIREMENT_REVISION_V1', technicalInput,
    scenarioTemplate: structuredClone(scenarioPackage),
    authorIntent: { difficulty: configuration.difficulty, evidenceCount: configuration.evidenceCount,
      incidentContext: structuredClone(configuration.incidentContext), attacks: structuredClone(configuration.attacks) },
    investigationStages: buildInvestigationStages(configuration, generationInput) };
}

export function applyScenarioRevision({ revision, scenarioPackage, configuration, generationInput }) {
  validateDocument('scenario-revision', revision);
  const result = structuredClone(scenarioPackage);
  const seen = new Set();
  for (const update of revision.requirementUpdates) {
    const requirement = result.evidenceRequirements.requirements.find(item => item.requirementId === update.requirementId);
    if (!requirement || seen.has(update.requirementId)) fail('SCENARIO_REVISION_TARGET_INVALID',
      'scenario-revision.requirementUpdates', '修正対象は重複のない既存Requirement IDで指定してください。');
    seen.add(update.requirementId);
    if (update.description !== null) requirement.description = update.description;
    if (update.grounds !== null) requirement.grounds = structuredClone(update.grounds);
    if (update.stageText !== null) {
      if (!requirement.investigationStage) fail('SCENARIO_REVISION_TARGET_INVALID',
        'scenario-revision.requirementUpdates.stageText', '段階のない要件へ争点を追加できません。');
      Object.assign(requirement.investigationStage, structuredClone(update.stageText));
    }
  }
  validateDocument('evidence-requirement', result.evidenceRequirements);
  const errors = validateScenarioEvidenceCoverage({ generationInput, configuration, scenarioPackage: result });
  if (errors.length) fail(errors[0].code, errors[0].field, errors[0].reason,
    { correctionHint: errors[0].correctionHint });
  // Ground Truth / Timeline / Characters / 全IDと取得経路は差分の対象にしない。
  // 既存参照の妥当性と意味の検証は、この後のImportと独立Reviewで再実行する。
  return result;
}
