import { readFile } from 'node:fs/promises';

async function loadSchema(name) {
  const value = await readFile(new URL(`../../schemas/${name}.schema.json`, import.meta.url), 'utf8');
  return JSON.parse(value);
}

const [scenarioPackage, review, evidencePackage, scenarioDraft, groundTruth, characters,
  timeline, learningObjectives, evidenceRequirements, evidenceArtifact, contradiction,
  exoneration] = await Promise.all([
  'scenario-import-package', 'scenario-verification-review', 'evidence-import-package',
  'scenario-draft', 'ground-truth', 'character', 'timeline', 'learning-objective',
  'evidence-requirement', 'evidence-artifact', 'contradiction', 'exoneration',
].map(loadSchema));

// The import-package contracts intentionally use open object placeholders because their
// component contracts are validated separately by the canonical import validators. Codex
// Structured Outputs requires closed objects, so only the CLI-facing copies are expanded.
const scenarioOutputSchema = structuredClone(scenarioPackage);
Object.assign(scenarioOutputSchema.properties, {
  scenarioDraft, groundTruth, characters, timeline, learningObjectives, evidenceRequirements,
});

const evidenceOutputSchema = structuredClone(evidencePackage);
evidenceOutputSchema.properties.evidenceArtifacts.items = evidenceArtifact;
evidenceOutputSchema.properties.contradictions.items = contradiction;
evidenceOutputSchema.properties.exonerations.items = exoneration;

export const AUTO_CODEX_OUTPUT_SCHEMAS = Object.freeze({
  scenario: Object.freeze({
    name: 'scenario-import-package', canonicalSchema: scenarioOutputSchema,
  }),
  review: Object.freeze({
    name: 'scenario-verification-review', canonicalSchema: structuredClone(review),
  }),
  evidence: Object.freeze({
    name: 'evidence-import-package', canonicalSchema: evidenceOutputSchema,
  }),
});
