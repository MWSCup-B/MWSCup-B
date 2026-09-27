import { ValidationError, validateDocument } from './schema.js';

// Adapted from the handoff's local validator. Routes already passed the main
// registry's SATISFIED artifact, network source and investigation checks.
const groundKey = ground => `${ground.attackNodeId}/${ground.sourceId}`;
export function buildTechnicalEvidenceCatalog(stages, requirements) {
  const routes = stages.flatMap(stage => stage.routes);
  const entries = routes.map(route => ({ ground: structuredClone(route.ground),
    evidenceType: route.evidenceType, sourceNodeId: route.sourceNodeId,
    logSource: route.logSource, actionId: route.actionId,
    requirementIds: requirements.filter(requirement => requirement.grounds.some(ground =>
      ground.sourceType === 'ATTACK_GRAPH_ARTIFACT' && groundKey(ground) === groundKey(route.ground)))
      .map(requirement => requirement.requirementId) }));
  for (const requirement of requirements) for (const ground of requirement.grounds) {
    if (ground.sourceType === 'ATTACK_GRAPH_ARTIFACT' && !entries.some(entry => groundKey(entry.ground) === groundKey(ground)))
      throw new ValidationError('TECHNICAL_EVIDENCE_PREFLIGHT_FAIL', `evidenceRequirements.${requirement.requirementId}.grounds`,
        '観測資料に取得可能な技術資料の種類・取得元・操作がありません。');
  }
  const catalog = { schemaVersion: '1.0', entries };
  validateDocument('technical-evidence-catalog', catalog);
  return catalog;
}

export function technicalEvidenceCoverageIssues(catalog, artifacts) {
  return catalog.entries.flatMap(entry => entry.requirementIds.flatMap(requirementId => {
    const covered = artifacts.some(artifact => artifact.type !== 'TESTIMONY' && artifact.type === entry.evidenceType
      && artifact.requirementIds.includes(requirementId) && artifact.sourceRefs.some(ref =>
        ref.sourceType === 'ATTACK_GRAPH_ARTIFACT' && groundKey(ref) === groundKey(entry.ground)));
    return covered ? [] : [{ code: 'TECHNICAL_EVIDENCE_CATALOG_MISSING', field: `evidenceRequirements.${requirementId}.grounds`,
      reason: `取得元 ${entry.sourceNodeId} の ${entry.logSource} に対応する ${entry.evidenceType} がありません。`,
      correctionHint: '検証済みgroundのtype・sourceRefs・requirementIdsを持つ技術資料を作成してください。証言で代用しません。' }];
  }));
}
