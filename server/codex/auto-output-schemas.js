import { readFile } from 'node:fs/promises';
import { EVIDENCE_GENERATION_DRAFT_SCHEMA } from '../generation/evidence-interface.js';

async function loadSchema(name) {
  const value = await readFile(new URL(`../../schemas/${name}.schema.json`, import.meta.url), 'utf8');
  return JSON.parse(value);
}

const [scenarioPackage, review, evidencePackage, scenarioDraft, groundTruth, characters,
  timeline, learningObjectives, evidenceRequirements, evidenceArtifact, contradiction,
  exoneration, makotomaruResult, scenarioConfiguration] = await Promise.all([
  'scenario-import-package', 'scenario-verification-review', 'evidence-import-package',
  'scenario-draft', 'ground-truth', 'character', 'timeline', 'learning-objective',
  'evidence-requirement', 'evidence-artifact', 'contradiction', 'exoneration',
  'makotomaru-result', 'scenario-configuration',
].map(loadSchema));

// The import-package contracts intentionally use open object placeholders because their
// component contracts are validated separately by the canonical import validators. Codex
// Structured Outputs requires closed objects, so only the CLI-facing copies are expanded.
const scenarioOutputSchema = structuredClone(scenarioPackage);
Object.assign(scenarioOutputSchema.properties, {
  scenarioDraft, groundTruth, characters, timeline, learningObjectives,
  evidenceRequirements: structuredClone(evidenceRequirements),
});
// 外部v1の省略可能フィールドはCLI用だけ必須nullableにする。
scenarioOutputSchema.properties.evidenceRequirements.properties.requirements.items.required.push('investigationStage');
scenarioOutputSchema.properties.groundTruth.required.push('incidentNarratives');

const evidenceOutputSchema = structuredClone(evidencePackage);
evidenceOutputSchema.properties.evidenceArtifacts.items = evidenceArtifact;
evidenceOutputSchema.properties.contradictions.items = contradiction;
evidenceOutputSchema.properties.exonerations.items = exoneration;

const makotomaruOutputSchema = structuredClone(makotomaruResult);
makotomaruOutputSchema.properties.configuration = scenarioConfiguration;
// This legacy configuration generator does not select the authoring incident profile.
delete makotomaruOutputSchema.properties.configuration.properties.incidentDesign;

export const AUTO_CODEX_OUTPUT_SCHEMAS = Object.freeze({
  scenarioRevision: Object.freeze({
    name: 'scenario-revision', canonicalSchema: await loadSchema('scenario-revision'),
  }),
  scenario: Object.freeze({
    name: 'scenario-import-package', canonicalSchema: scenarioOutputSchema,
  }),
  review: Object.freeze({
    name: 'scenario-verification-review', canonicalSchema: structuredClone(review),
  }),
  evidence: Object.freeze({
    name: 'evidence-import-package', canonicalSchema: evidenceOutputSchema,
  }),
  evidenceDraft: Object.freeze({
    name: 'evidence-generation-draft', canonicalSchema: structuredClone(EVIDENCE_GENERATION_DRAFT_SCHEMA),
  }),
  makotomaru: Object.freeze({
    name: 'makotomaru-result', canonicalSchema: makotomaruOutputSchema,
  }),
});
