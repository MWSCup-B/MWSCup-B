import { buildEvidenceGenerationInput, importEvidencePackage }
  from '../../server/generation/evidence-interface.js';
import { contentDigest } from '../../server/generation/evidence-validator.js';
import { verifiedScenarioFixture } from './verified-scenario.js';

function artifact(input, values) {
  const publicContent = values.publicContent;
  return { schemaVersion: '1.0', evidenceId: values.evidenceId, type: values.type,
    title: values.title, publicContent, sourceRefs: structuredClone(values.sourceRefs),
    requirementIds: [...values.requirementIds], purpose: [...values.purpose],
    provenance: { origin: 'EXTERNAL_USER_CODEX',
      verificationId: input.evidenceAgentInput.verificationResult.verificationId,
      scenarioId: input.evidenceAgentInput.scenarioImportPackage.scenarioDraft.scenarioId,
      attackGraphRef: structuredClone(input.evidenceAgentInput.scenarioImportPackage.scenarioDraft.attackGraphRef) },
    visibility: 'PLAYER_OBTAINABLE',
    integrity: { algorithm: 'SHA-256', publicContentDigest: contentDigest(publicContent) },
    testimony: values.testimony ?? null };
}

export function phase7Fixture(phase6 = verifiedScenarioFixture()) {
  const evidenceGenerationInput = buildEvidenceGenerationInput({
    scenarioVerificationInput: phase6.verificationInput,
    verificationResult: phase6.verificationResult,
  });
  const agent = evidenceGenerationInput.evidenceAgentInput;
  const requirements = Object.fromEntries(agent.evidenceRequirements.requirements
    .map(item => [item.requirementId, item]));
  const attackGround = requirements.requirement_attack.grounds[0];
  const timelineGround = requirements.requirement_timeline.grounds[0];
  const contradictionGround = requirements.requirement_contradiction.grounds[0];
  const exonerationGround = requirements.requirement_exoneration.grounds[0];
  const evidenceArtifacts = [
    artifact(evidenceGenerationInput, { evidenceId: 'evidence_technical_a', type: 'APPLICATION_LOG',
      title: 'アプリケーションログ', publicContent: '隔離環境の要求処理記録が操作時刻を示している。',
      sourceRefs: [attackGround, contradictionGround, exonerationGround],
      requirementIds: ['requirement_attack', 'requirement_contradiction', 'requirement_exoneration'],
      purpose: ['ATTACK_TRACE', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF'] }),
    artifact(evidenceGenerationInput, { evidenceId: 'evidence_technical_b', type: 'NETWORK_LOG',
      title: '通信記録', publicContent: '隔離環境の通信記録がイベントの順序を示している。',
      sourceRefs: [timelineGround, exonerationGround],
      requirementIds: ['requirement_timeline', 'requirement_exoneration'],
      purpose: ['TIMELINE_PROOF', 'EXONERATION_PROOF'] }),
    artifact(evidenceGenerationInput, { evidenceId: 'evidence_testimony', type: 'TESTIMONY',
      title: '証言者の供述',
      publicContent: '架空の証言者は「その操作を直接見た」「記録の時刻も確認した」と発言した。',
      sourceRefs: [contradictionGround], requirementIds: ['requirement_contradiction'],
      purpose: ['CONTRADICTION_PROOF'], testimony: { witnessCharacterId: 'character_witness',
        statements: [{ statementId: 'statement_seen_operation', spokenContent: 'その操作を直接見た',
          technicalAssessment: 'CONTRADICTED', groundTruthRefs: [contradictionGround.sourceId],
          contradictionCandidate: true },
        { statementId: 'statement_checked_time', spokenContent: '記録の時刻も確認した',
          technicalAssessment: 'CONSISTENT', groundTruthRefs: [contradictionGround.sourceId],
          contradictionCandidate: false }] } }),
  ];
  const contradictions = [{ schemaVersion: '1.0', contradictionId: 'contradiction_seen_operation',
    testimonyEvidenceId: 'evidence_testimony', statementRef: 'statement_seen_operation',
    conflictingEvidenceIds: ['evidence_technical_a'], groundTruthRefs: [contradictionGround.sourceId],
    reason: '証言の人物断定は技術記録から支持されない。' }];
  const exonerations = [{ schemaVersion: '1.0', exonerationId: 'exoneration_defendant',
    defendantCharacterId: 'character_defendant',
    supportingEvidenceIds: ['evidence_technical_a', 'evidence_technical_b'],
    groundTruthRefs: [contradictionGround.sourceId],
    reason: '複数の記録を合わせても被告人が実行者とは断定できない。' }];
  const evidencePackage = { schemaVersion: '1.0', generationInputRef: {
    evidenceGenerationInputId: evidenceGenerationInput.evidenceGenerationInputId,
    inputFingerprint: agent.inputFingerprint,
    verificationId: agent.verificationResult.verificationId,
  }, scenarioId: phase6.scenarioPackage.scenarioDraft.scenarioId,
  attackGraphRef: structuredClone(phase6.scenarioPackage.scenarioDraft.attackGraphRef),
  evidenceArtifacts, contradictions, exonerations };
  const evidenceImportResult = importEvidencePackage({ generationInput: evidenceGenerationInput,
    evidencePackage });
  return structuredClone({ ...phase6, evidenceGenerationInput, evidencePackage,
    evidenceImportResult, evidenceSet: evidenceImportResult.evidenceSet,
    gameCaseHandoff: evidenceImportResult.gameCaseHandoff, contradictions, exonerations });
}
