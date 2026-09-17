import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_PROMPT_TEMPLATE,
  buildEvidenceGenerationInput,
  importEvidencePackage,
  validateEvidenceGenerationInput,
} from '../server/generation/evidence-interface.js';
import {
  contentDigest,
  validateEvidenceAgentInput,
  validateEvidenceFeedback,
  validateEvidenceImportResult,
  validateEvidenceSet,
  validateGameCaseHandoff,
} from '../server/generation/evidence-validator.js';
import { verifiedScenarioFixture } from './helpers/verified-scenario.js';

function generationInput() {
  const fixture = verifiedScenarioFixture();
  return buildEvidenceGenerationInput({ scenarioVerificationInput: fixture.verificationInput,
    verificationResult: fixture.verificationResult });
}

function artifact(input, values) {
  const publicContent = values.publicContent;
  return {
    schemaVersion: '1.0', evidenceId: values.evidenceId, type: values.type,
    title: values.title, publicContent, sourceRefs: structuredClone(values.sourceRefs),
    requirementIds: [...values.requirementIds], purpose: [...values.purpose],
    provenance: { origin: 'EXTERNAL_USER_CODEX',
      verificationId: input.evidenceAgentInput.verificationResult.verificationId,
      scenarioId: input.evidenceAgentInput.scenarioImportPackage.scenarioDraft.scenarioId,
      attackGraphRef: structuredClone(input.evidenceAgentInput.attackGraph
        ? input.evidenceAgentInput.scenarioImportPackage.scenarioDraft.attackGraphRef : null) },
    visibility: 'PLAYER_OBTAINABLE',
    integrity: { algorithm: 'SHA-256', publicContentDigest: contentDigest(publicContent) },
    testimony: values.testimony ?? null,
  };
}

function evidencePackage(input = generationInput()) {
  const agent = input.evidenceAgentInput;
  const requirements = Object.fromEntries(agent.evidenceRequirements.requirements
    .map(item => [item.requirementId, item]));
  const attackGround = requirements.requirement_attack.grounds[0];
  const timelineGround = requirements.requirement_timeline.grounds[0];
  const contradictionGround = requirements.requirement_contradiction.grounds[0];
  const exonerationGround = requirements.requirement_exoneration.grounds[0];
  const artifacts = [
    artifact(input, { evidenceId: 'evidence_technical_a', type: 'APPLICATION_LOG', title: 'アプリケーションログ',
      publicContent: '隔離環境のアプリケーションに要求処理の記録が残っている。',
      sourceRefs: [attackGround, contradictionGround, exonerationGround],
      requirementIds: ['requirement_attack', 'requirement_contradiction', 'requirement_exoneration'],
      purpose: ['ATTACK_TRACE', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF'] }),
    artifact(input, { evidenceId: 'evidence_technical_b', type: 'NETWORK_LOG', title: '通信記録',
      publicContent: '隔離環境の通信記録はイベントの順序と利用状況を示している。',
      sourceRefs: [timelineGround, exonerationGround],
      requirementIds: ['requirement_timeline', 'requirement_exoneration'],
      purpose: ['TIMELINE_PROOF', 'EXONERATION_PROOF'] }),
    artifact(input, { evidenceId: 'evidence_testimony', type: 'TESTIMONY', title: '証言者の供述',
      publicContent: '架空の証言者は「その操作を直接見た」と発言した。', sourceRefs: [contradictionGround],
      requirementIds: ['requirement_contradiction'], purpose: ['CONTRADICTION_PROOF'],
      testimony: { witnessCharacterId: 'character_witness', statements: [{
        statementId: 'statement_seen_operation', spokenContent: 'その操作を直接見た',
        technicalAssessment: 'CONTRADICTED', groundTruthRefs: [contradictionGround.sourceId],
        contradictionCandidate: true,
      }] } }),
  ];
  return { schemaVersion: '1.0', generationInputRef: {
    evidenceGenerationInputId: input.evidenceGenerationInputId,
    inputFingerprint: agent.inputFingerprint,
    verificationId: agent.verificationResult.verificationId,
  }, scenarioId: agent.scenarioImportPackage.scenarioDraft.scenarioId,
  attackGraphRef: structuredClone(agent.scenarioImportPackage.scenarioDraft.attackGraphRef),
  evidenceArtifacts: artifacts,
  contradictions: [{ schemaVersion: '1.0', contradictionId: 'contradiction_seen_operation',
    testimonyEvidenceId: 'evidence_testimony', statementRef: 'statement_seen_operation',
    conflictingEvidenceIds: ['evidence_technical_a'], groundTruthRefs: [contradictionGround.sourceId],
    reason: '証言の人物断定は技術記録から支持されない。' }],
  exonerations: [{ schemaVersion: '1.0', exonerationId: 'exoneration_defendant',
    defendantCharacterId: 'character_defendant',
    supportingEvidenceIds: ['evidence_technical_a', 'evidence_technical_b'],
    groundTruthRefs: [contradictionGround.sourceId],
    reason: '複数の独立した記録を合わせても被告人が実行者とは断定できない。' }] };
}

function updateDigest(item) {
  item.integrity.publicContentDigest = contentDigest(item.publicContent);
}

test('VERIFIED ScenarioからProvider非依存のEvidence Generation Inputを構築する', () => {
  const input = generationInput();
  assert.equal(input.status, 'READY');
  assert.equal(input.generatorMode, 'EXTERNAL_USER_CODEX');
  assert.equal(input.issues.length, 0);
  assert.equal(validateEvidenceGenerationInput(input), input);
  assert.equal(validateEvidenceAgentInput(input.evidenceAgentInput), input.evidenceAgentInput);
  assert.doesNotMatch(JSON.stringify(input), /apiKey|modelId|providerName/);
});

test('正常なEvidence ImportをVALIDにしEvidence SetとPhase 8 Handoffを生成する', () => {
  const input = generationInput();
  const result = importEvidencePackage({ generationInput: input, evidencePackage: evidencePackage(input) });
  assert.equal(result.status, 'VALID');
  assert.equal(result.valid, true);
  assert.equal(validateEvidenceImportResult(result), result);
  assert.equal(validateEvidenceSet(result.evidenceSet), result.evidenceSet);
  assert.equal(validateGameCaseHandoff(result.gameCaseHandoff, result.evidenceSet), result.gameCaseHandoff);
  assert.equal(result.gameCaseHandoff.state, 'EVIDENCE_READY');
});

test('Evidence RequirementとArtifactのmany-to-many coverageを保持する', () => {
  const input = generationInput();
  const result = importEvidencePackage({ generationInput: input, evidencePackage: evidencePackage(input) });
  const exon = result.evidenceSet.requirementCoverage.find(item => item.requirementId === 'requirement_exoneration');
  assert.deepEqual(exon.evidenceIds, ['evidence_technical_a', 'evidence_technical_b']);
  assert.equal(result.evidenceSet.evidenceArtifacts[0].requirementIds.length, 3);
});

test('VERIFIED以外または未解決issueのあるResultをBLOCKEDにする', () => {
  const fixture = verifiedScenarioFixture();
  fixture.verificationResult.status = 'NEEDS_REVISION';
  const input = buildEvidenceGenerationInput({ scenarioVerificationInput: fixture.verificationInput,
    verificationResult: fixture.verificationResult });
  assert.equal(input.status, 'BLOCKED');
  const result = importEvidencePackage({ generationInput: input, evidencePackage: {} });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.gameCaseHandoff, null);
});

test('Phase 6 Handoffの改変をBLOCKEDにする', () => {
  const fixture = verifiedScenarioFixture();
  fixture.verificationResult.evidenceAgentHandoff.scenarioPackageFingerprint = '0'.repeat(64);
  const input = buildEvidenceGenerationInput({ scenarioVerificationInput: fixture.verificationInput,
    verificationResult: fixture.verificationResult });
  assert.equal(input.status, 'BLOCKED');
  assert.equal(input.issues[0].code, 'SCENARIO_PACKAGE_MODIFIED');
});

test('Evidence Agent Input fingerprint不一致をImport開始前にBLOCKEDにする', () => {
  const input = generationInput();
  input.evidenceAgentInput.inputFingerprint = '0'.repeat(64);
  const result = importEvidencePackage({ generationInput: input, evidencePackage: evidencePackage(generationInput()) });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.validationStages.schema, 'NOT_RUN');
});

test('VERIFIED後のScenario Package改変をBLOCKEDにする', () => {
  const input = generationInput();
  input.evidenceAgentInput.scenarioImportPackage.characters.characters[0].displayName = '改変された名前';
  const result = importEvidencePackage({ generationInput: input, evidencePackage: evidencePackage(generationInput()) });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.gameCaseHandoff, null);
});

test('存在しないEvidence Requirement参照をINVALIDにする', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.evidenceArtifacts[0].requirementIds.push('requirement_missing');
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'BROKEN_EVIDENCE_REQUIREMENT_REFERENCE'));
});

test('存在しないGround Truth参照をINVALIDにする', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.contradictions[0].groundTruthRefs = ['fact_missing'];
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'BROKEN_GROUND_TRUTH_REFERENCE'));
});

test('別Scenarioまたは別Attack GraphのEvidence混入をINVALIDにする', () => {
  const input = generationInput();
  for (const mutate of [
    pkg => { pkg.scenarioId = 'scenario_other'; },
    pkg => { pkg.attackGraphRef.graphId = 'graph_other'; },
  ]) {
    const pkg = evidencePackage(input); mutate(pkg);
    const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
    assert.equal(result.status, 'INVALID');
    assert.equal(result.errors[0].code, 'CROSS_SCENARIO_EVIDENCE');
  }
});

test('UNKNOWNまたは存在しないobservable artifactを確定Evidenceに使えない', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.evidenceArtifacts[0].sourceRefs[0].sourceId = 'artifact_unknown';
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'UNAVAILABLE_OBSERVABLE_ARTIFACT'));
});

test('Timeline・Character参照切れをEvidence sourceとして受理しない', () => {
  const input = generationInput();
  for (const [artifactIndex, sourceIndex] of [[1, 0], [1, 1]]) {
    const pkg = evidencePackage(input);
    pkg.evidenceArtifacts[artifactIndex].sourceRefs[sourceIndex].sourceId = 'source_missing';
    const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
    assert.equal(result.status, 'INVALID');
    assert.ok(result.errors.some(item => item.code === 'BROKEN_SOURCE_REFERENCE'));
  }
});

test('全Evidence RequirementのcoverageがなければINVALIDにする', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.evidenceArtifacts = pkg.evidenceArtifacts.filter(item => item.evidenceId !== 'evidence_technical_b');
  pkg.exonerations[0].supportingEvidenceIds = ['evidence_technical_a', 'evidence_testimony'];
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'EVIDENCE_REQUIREMENT_NOT_COVERED'
    && item.requirementId === 'requirement_timeline'));
});

test('publicContentのintegrity metadata不一致をINVALIDにする', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.evidenceArtifacts[0].integrity.publicContentDigest = '0'.repeat(64);
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.errors[0].code, 'EVIDENCE_INTEGRITY_MISMATCH');
});

test('publicContentへのGround Truth・正解の直接露出を検出する', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.evidenceArtifacts[0].publicContent = `正解は${input.evidenceAgentInput.groundTruth.technicalFacts[0].factId}である。`;
  updateDigest(pkg.evidenceArtifacts[0]);
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'GROUND_TRUTH_PUBLIC_LEAK'));
});

test('ContradictionのTESTIMONY・statement・競合Evidence参照を検証する', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.contradictions[0].conflictingEvidenceIds = ['evidence_missing'];
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'BROKEN_CONFLICTING_EVIDENCE_REFERENCE'));
});

test('ExonerationのGround Truthと複数Evidence根拠不足を拒否する', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.exonerations[0].supportingEvidenceIds = ['evidence_technical_a', 'evidence_technical_a'];
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.validationStages.consistency, 'FAILED');
  assert.ok(result.errors.some(item => item.code === 'INSUFFICIENT_EXONERATION_SUPPORT'));
  assert.equal(result.gameCaseHandoff, null);
});

test('TESTIMONYとtechnical evidenceの構造を混同できない', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.evidenceArtifacts[0].testimony = structuredClone(pkg.evidenceArtifacts[2].testimony);
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'TESTIMONY_TYPE_MISMATCH'));
});

test('Evidence purposeをRequirementにない値へ拡張できない', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.evidenceArtifacts[0].purpose = ['IDENTITY_PROOF'];
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'EVIDENCE_PURPOSE_MISMATCH'));
});

test('External Evidence GeneratorのSchema不正出力をINVALIDにする', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  delete pkg.evidenceArtifacts[0].publicContent;
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.validationStages.schema, 'FAILED');
  assert.equal(result.errors[0].field, 'evidence-artifact.publicContent');
});

test('INVALID Feedbackは外部Codexが修正に使えるmachine-readable形式を持つ', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.evidenceArtifacts[0].requirementIds = ['requirement_missing'];
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(validateEvidenceFeedback(result.feedback), result.feedback);
  for (const key of ['code', 'field', 'evidenceId', 'requirementId', 'reason', 'correctionHint', 'sourceRefs']) {
    assert.ok(Object.hasOwn(result.feedback.errors[0], key));
  }
  assert.equal(result.evidenceSet, null);
  assert.equal(result.gameCaseHandoff, null);
});

test('Evidence Promptは技術境界・公開境界・証言分離を明記する', () => {
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /Ground Truth.*変更しません/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /UNKNOWN.*UNSATISFIED/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /実在人物や実在企業/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /publicContent.*漏らしません/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /技術証拠とTESTIMONYを区別/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /JSONオブジェクトを1件だけ/);
});
