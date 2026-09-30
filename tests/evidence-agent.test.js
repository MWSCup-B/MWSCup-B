import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  EVIDENCE_PROMPT_TEMPLATE,
  buildEvidenceGenerationInput,
  buildEvidenceGenerationDraftInput,
  importEvidencePackage,
  materializeEvidenceGenerationDraft,
  validateEvidenceGenerationInput,
} from '../server/generation/evidence-interface.js';
import {
  contentDigest,
  validateEvidenceAgentInput,
  validateEvidenceFeedback,
  validateEvidenceImportResult,
  validateEvidenceSet,
  validateEvidenceConsistency,
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
      publicContent: '検察側調査官は「その操作を直接見た」と発言した。', sourceRefs: [contradictionGround],
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

function generationDraft(input = generationInput()) {
  const draft = evidencePackage(input);
  for (const item of draft.evidenceArtifacts) delete item.integrity;
  return draft;
}

function caseReportFixture() {
  const input = generationInput();
  const agent = input.evidenceAgentInput;
  const evidence = evidencePackage(input);
  const technical = evidence.evidenceArtifacts[0];
  technical.type = 'EMAIL';
  technical.publicContent = 'Subject: 保全対象のお知らせ\n<a href="https://training.example.invalid/account-review">アカウント確認</a>';
  updateDigest(technical);
  const technicalGround = agent.evidenceRequirements.requirements.find(item => item.requirementId === 'requirement_attack').grounds[0];
  const fact = { schemaVersion: '1.0', factId: 'case_fact_observation', attackNodeId: technicalGround.attackNodeId,
    witnessCharacterId: 'character_witness', subjectCharacterId: 'character_attacker',
    excludedCharacterId: 'character_defendant', observation: '同席者は保全対象のメールの作成を直接見た。',
    relatedArtifactIds: [technicalGround.sourceId] };
  const ground = { sourceType: 'CASE_FACT', sourceId: fact.factId, attackNodeId: fact.attackNodeId };
  agent.groundTruth.caseFacts = [fact];
  agent.evidenceRequirements.requirements.push({ requirementId: 'requirement_observation', purpose: 'IDENTITY_PROOF',
    description: '直接観察の報告と技術記録を照合する。', grounds: [ground], learningObjectiveIds: [] });
  agent.evidenceRequirements.requirements.find(item => item.requirementId === 'requirement_exoneration').grounds.push(ground);
  const report = artifact(input, { evidenceId: 'evidence_observation_report', type: 'DOCUMENT', title: '直接観察者の調査報告',
    publicContent: `${fact.observation}\n保全したメール：\n${technical.publicContent}`,
    sourceRefs: [ground], requirementIds: ['requirement_observation', 'requirement_exoneration'],
    purpose: ['IDENTITY_PROOF', 'EXONERATION_PROOF'] });
  report.caseSupport = { observationQuote: fact.observation,
    supportingQuotes: [{ evidenceId: evidence.evidenceArtifacts[0].evidenceId, quote: evidence.evidenceArtifacts[0].publicContent }] };
  evidence.evidenceArtifacts.push(report);
  evidence.exonerations[0].supportingEvidenceIds.push(report.evidenceId);
  evidence.exonerations[0].groundTruthRefs.push(fact.factId);
  return { input, evidence, report };
}

test('direct-observation reports cannot be generated or imported as player evidence', () => {
  const { input, evidence } = caseReportFixture();
  const result = validateEvidenceConsistency(evidence, input.evidenceAgentInput);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(item => ['UNSUPPORTED_VALUE', 'UNKNOWN_FIELD',
    'INTERNAL_CASE_FACT_EXPOSED', 'INTERNAL_CASE_REPORT_EXPOSED'].includes(item.code)), JSON.stringify(result.issues));
});

test('Evidence契約から直接観察の証拠種別・目的・caseSupportを排除する', () => {
  const input = generationInput();
  const artifactSchema = input.outputContract.schemas.find(item => item.name === 'evidence-artifact').jsonSchema;
  const requirementSchema = input.evidenceAgentInput.evidenceRequirements.requirements[0];
  assert.ok(!artifactSchema.properties.sourceRefs.items.properties.sourceType.enum.includes('CASE_FACT'));
  assert.ok(!artifactSchema.properties.purpose.items.enum.includes('IDENTITY_PROOF'));
  assert.ok(!Object.hasOwn(artifactSchema.properties, 'caseSupport'));
  assert.notEqual(requirementSchema.purpose, 'IDENTITY_PROOF');
});

test('CLI draft契約だけintegrityを除外し、外部Import契約と検証済み入力を保持する', () => {
  const input = generationInput(); const before = structuredClone(input);
  const draftInput = buildEvidenceGenerationDraftInput(input);
  assert.deepEqual(input, before);
  assert.deepEqual(draftInput.generationInputRef, evidencePackage(input).generationInputRef);
  const draftSchema = draftInput.outputContract.jsonSchema.properties.evidenceArtifacts.items;
  assert.equal(draftInput.outputContract.name, 'evidence-generation-draft');
  const draftContract = draftInput.outputContract.jsonSchema;
  assert.ok(draftContract.required.includes('courtQuestions'));
  assert.equal(draftContract.properties.courtQuestions.items.properties.choices.minItems, 4);
  assert.equal(draftContract.properties.courtQuestions.items.properties.choices.maxItems, 4);
  assert.equal(Object.hasOwn(input.outputContract.schemas.find(item => item.name === 'evidence-import-package')
    .jsonSchema.properties, 'courtQuestions'), false);
  assert.equal(draftSchema.additionalProperties, false);
  assert.ok(!Object.hasOwn(draftSchema.properties, 'integrity'));
  assert.ok(!draftSchema.required.includes('integrity'));
  const canonicalSchema = input.outputContract.schemas.find(item => item.name === 'evidence-artifact').jsonSchema;
  assert.ok(canonicalSchema.required.includes('integrity'));
  assert.deepEqual(draftSchema.properties.publicContent, canonicalSchema.properties.publicContent);
  draftInput.evidenceAgentInput.inputFingerprint = '0'.repeat(64);
  assert.deepEqual(input, before);
});

test('CLI Evidence投影は重複コピーだけを除去し、全技術情報と正本fingerprintを保持する', () => {
  const input = generationInput(); const before = structuredClone(input);
  const draft = buildEvidenceGenerationDraftInput(input);
  assert.equal(draft.contextFormat, 'DEDUPLICATED_VERIFIED_INPUT_V1');
  const agent = draft.evidenceAgentInput;
  const verificationInput = agent.scenarioVerificationInput;
  const scenarioPackage = verificationInput.scenarioPackage;
  const technical = verificationInput.generationInput.technicalInput;
  const restored = { ...agent, evidenceAgentHandoff: agent.verificationResult.evidenceAgentHandoff,
    scenarioImportPackage: scenarioPackage,
    groundTruth: scenarioPackage.groundTruth, timeline: scenarioPackage.timeline,
    characters: scenarioPackage.characters, learningObjectives: scenarioPackage.learningObjectives,
    evidenceRequirements: scenarioPackage.evidenceRequirements,
    attackGraph: technical.attackGraph, network: technical.network,
    scenarioContext: technical.scenarioContext, attackDefinitions: technical.attackDefinitions };
  assert.deepEqual(restored, input.evidenceAgentInput);
  assert.equal(validateEvidenceAgentInput(restored), restored);
  const previous = { ...draft, evidenceAgentInput: input.evidenceAgentInput };
  assert.ok(Buffer.byteLength(JSON.stringify(draft)) < Buffer.byteLength(JSON.stringify(previous)) * 0.7);
  assert.deepEqual(draft.generationInputRef, evidencePackage(input).generationInputRef);
  agent.scenarioVerificationInput.scenarioPackage.characters.characters[0].displayName = '投影だけの変更';
  assert.deepEqual(input, before, '正本は投影の参照を共有しない');
});

test('正本の重複コピーが改変されていれば投影によって隠さず拒否する', () => {
  const input = generationInput();
  input.evidenceAgentInput.network.nodes[0].label = '改変したラベル';
  assert.throws(() => buildEvidenceGenerationDraftInput(input), {
    code: 'EVIDENCE_INPUT_SOURCE_MISMATCH', field: 'evidence-agent-input.network',
  });
});

test('自動Evidence本文のUTF-8を改行・日本語・HTMLを変更せずBackendでSHA-256化する', () => {
  const input = generationInput(); const draft = generationDraft(input);
  const body = '教材用合成メール\r\n表示URL: https://portal.example.invalid/help\n'
    + '<a href="https://portal.example.invalid/notice?ref=training-01">案内</a>\n';
  draft.evidenceArtifacts[0].publicContent = body;
  const before = structuredClone(draft);
  const pkg = materializeEvidenceGenerationDraft(draft);
  assert.deepEqual(draft, before);
  assert.equal(pkg.evidenceArtifacts[0].publicContent, body);
  assert.deepEqual(pkg.evidenceArtifacts[0].integrity, { algorithm: 'SHA-256',
    publicContentDigest: createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex') });
  assert.equal(importEvidencePackage({ generationInput: input, evidencePackage: pkg }).status, 'VALID');
  pkg.evidenceArtifacts[0].publicContent += '改変';
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.errors[0].code, 'EVIDENCE_INTEGRITY_MISMATCH');
});

test('draftに持ち込まれたintegrityを上書き修復せず拒否する', () => {
  const pkg = evidencePackage();
  pkg.evidenceArtifacts[0].integrity.publicContentDigest = '0'.repeat(64);
  const before = structuredClone(pkg);
  assert.throws(() => materializeEvidenceGenerationDraft(pkg), {
    code: 'UNKNOWN_FIELD', field: 'evidence-generation-draft.evidenceArtifacts[0].integrity',
  });
  assert.deepEqual(pkg, before);
});

test('draft本文の型不正・未知field・長さ違反をハッシュ生成で許容しない', () => {
  for (const [mutate, code] of [
    [item => { item.publicContent = null; }, 'INVALID_TYPE'],
    [item => { item.untrustedExtra = 'ignored'; }, 'UNKNOWN_FIELD'],
    [item => { item.publicContent = 'x'.repeat(100001); }, 'INVALID_STRING'],
  ]) {
    const draft = generationDraft(); mutate(draft.evidenceArtifacts[0]);
    assert.throws(() => materializeEvidenceGenerationDraft(draft), { code });
  }
});

test('failure noticeのハッシュが正しくても根拠・coverage・Contradiction・Exoneration不足を拒否する', () => {
  const input = generationInput(); const draft = generationDraft(input);
  const notice = draft.evidenceArtifacts[0];
  Object.assign(notice, { evidenceId: 'generation_failure_notice', type: 'DOCUMENT',
    title: '生成失敗', publicContent: '生成を完了できませんでした。',
    sourceRefs: [{ sourceType: 'CHARACTER', sourceId: 'character_defendant', attackNodeId: null }],
    requirementIds: ['requirement_attack'], purpose: ['ATTACK_TRACE'] });
  draft.evidenceArtifacts = [notice]; draft.contradictions = []; draft.exonerations = [];
  const result = importEvidencePackage({ generationInput: input,
    evidencePackage: materializeEvidenceGenerationDraft(draft) });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.evidenceSet, null);
  assert.equal(result.gameCaseHandoff, null);
  for (const code of ['EVIDENCE_GROUND_MISMATCH', 'EVIDENCE_REQUIREMENT_NOT_COVERED',
    'CONTRADICTION_REQUIRED', 'EXONERATION_REQUIRED']) {
    assert.ok(result.errors.some(item => item.code === code), code);
  }
});

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
  assert.throws(() => buildEvidenceGenerationDraftInput(input), { code: 'EVIDENCE_GENERATION_BLOCKED' });
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

test('別の技術資料に同じ表示名を付けることを拒否する', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  pkg.evidenceArtifacts[1].title = pkg.evidenceArtifacts[0].title;
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'DUPLICATE_EVIDENCE_TITLE'));
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

test('反駁対象の証言が「それだけで」で推論の弱点を自白する文体を拒否する', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  const testimony = pkg.evidenceArtifacts.find(item => item.evidenceId === 'evidence_testimony');
  const spokenContent = '投稿が保存されていました。それだけで、ブラウザで実行された証拠になります。';
  testimony.testimony.statements[0].spokenContent = spokenContent;
  testimony.publicContent = `検察側調査官は「${spokenContent}」と発言した。`;
  updateDigest(testimony);
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'TESTIMONY_CLAIM_STYLE_UNNATURAL'));
});

test('記録・セッション・人物を混同する曖昧な証言を拒否する', () => {
  const input = generationInput(); const pkg = evidencePackage(input);
  const testimony = pkg.evidenceArtifacts.find(item => item.evidenceId === 'evidence_testimony');
  const spokenContent = '虚偽の投稿が被告人の利用セッションに記録されたため、被告人が投稿したと判断しました。';
  testimony.testimony.statements[0].spokenContent = spokenContent;
  testimony.publicContent = `検察側調査官は「${spokenContent}」と発言した。`;
  updateDigest(testimony);
  const result = importEvidencePackage({ generationInput: input, evidencePackage: pkg });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'TESTIMONY_RECORD_ATTRIBUTION_AMBIGUOUS'));
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
  assert.ok(result.errors.some(item => ['EVIDENCE_PURPOSE_MISMATCH', 'UNSUPPORTED_VALUE'].includes(item.code)));
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
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /integrity.*出力しません/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /表示文字列.*href/);
  assert.match(EVIDENCE_PROMPT_TEMPLATE, /HTTPリダイレクトの証明ではありません/);
});
