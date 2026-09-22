import { createHash } from 'node:crypto';
import { validateDocument, fail } from './schema.js';
import {
  validateEvidenceAgentHandoff,
  validateScenarioVerificationInput,
  validateScenarioVerificationResult,
} from './scenario-verifier.js';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function contentDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sameValues(left, right) {
  return canonical(left) === canonical(right);
}

function unique(items, key, field) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) fail('DUPLICATE_ID', field, '識別子または参照が重複しています。');
    seen.add(value);
  }
}

function evidenceAgentCore(input) {
  return {
    scenarioVerificationInput: input.scenarioVerificationInput,
    verificationResult: input.verificationResult,
    evidenceAgentHandoff: input.evidenceAgentHandoff,
    scenarioImportPackage: input.scenarioImportPackage,
    groundTruth: input.groundTruth,
    timeline: input.timeline,
    characters: input.characters,
    learningObjectives: input.learningObjectives,
    evidenceRequirements: input.evidenceRequirements,
    attackGraph: input.attackGraph,
    network: input.network,
    scenarioContext: input.scenarioContext,
    attackDefinitions: input.attackDefinitions,
  };
}

export function evidenceAgentFingerprint(input) {
  return digest(evidenceAgentCore(input));
}

export function validateEvidenceAgentInput(input) {
  validateDocument('evidence-agent-input', input);
  validateScenarioVerificationInput(input.scenarioVerificationInput);
  validateScenarioVerificationResult(input.verificationResult);
  validateEvidenceAgentHandoff(input.evidenceAgentHandoff);
  const verification = input.verificationResult;
  const verificationInput = input.scenarioVerificationInput;
  const handoff = input.evidenceAgentHandoff;
  const scenarioPackage = verificationInput.scenarioPackage;
  const technical = verificationInput.generationInput.technicalInput;
  if (verification.status !== 'VERIFIED' || verification.issues.length
    || !verification.evidenceAgentEligible || !verification.evidenceAgentHandoff) {
    fail('SCENARIO_NOT_VERIFIED', 'evidence-agent-input.verificationResult.status',
      '未解決issueのないVERIFIED ScenarioだけがEvidence生成へ進めます。');
  }
  if (!sameValues(handoff, verification.evidenceAgentHandoff)) {
    fail('EVIDENCE_HANDOFF_MISMATCH', 'evidence-agent-input.evidenceAgentHandoff',
      'Evidence Agent HandoffがVerification ResultのHandoffと一致しません。');
  }
  if (verification.inputFingerprint !== verificationInput.inputFingerprint
    || handoff.verificationInputFingerprint !== verificationInput.inputFingerprint) {
    fail('VERIFICATION_FINGERPRINT_MISMATCH', 'evidence-agent-input.scenarioVerificationInput.inputFingerprint',
      'Verification Input fingerprintがVerification ResultまたはHandoffと一致しません。');
  }
  if (handoff.scenarioPackageFingerprint !== digest(scenarioPackage)) {
    fail('SCENARIO_PACKAGE_MODIFIED', 'evidence-agent-input.scenarioImportPackage',
      'VERIFIED後にScenario Import Packageが変更されています。');
  }
  const expected = {
    scenarioImportPackage: scenarioPackage,
    groundTruth: scenarioPackage.groundTruth,
    timeline: scenarioPackage.timeline,
    characters: scenarioPackage.characters,
    learningObjectives: scenarioPackage.learningObjectives,
    evidenceRequirements: scenarioPackage.evidenceRequirements,
    attackGraph: technical.attackGraph,
    network: technical.network,
    scenarioContext: technical.scenarioContext,
    attackDefinitions: technical.attackDefinitions,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (!sameValues(input[field], value)) fail('EVIDENCE_INPUT_SOURCE_MISMATCH',
      `evidence-agent-input.${field}`, `${field}がVERIFIED Scenarioの正本と一致しません。`);
  }
  const draft = scenarioPackage.scenarioDraft;
  if (handoff.verificationId !== verification.verificationId
    || handoff.scenarioId !== draft.scenarioId
    || !sameValues(handoff.attackGraphRef, draft.attackGraphRef)
    || handoff.groundTruthId !== draft.groundTruthId
    || handoff.timelineId !== draft.timelineId
    || handoff.learningObjectiveSetId !== draft.learningObjectiveSetId
    || handoff.evidenceRequirementSetId !== draft.evidenceRequirementSetId) {
    fail('EVIDENCE_HANDOFF_MISMATCH', 'evidence-agent-input.evidenceAgentHandoff',
      'HandoffのScenario、graph、または成果物IDがVERIFIED Packageと一致しません。');
  }
  if (input.inputFingerprint !== evidenceAgentFingerprint(input)
    || input.evidenceAgentInputId !== `evidence_agent_input_${input.inputFingerprint.slice(0, 20)}`) {
    fail('EVIDENCE_INPUT_FINGERPRINT_MISMATCH', 'evidence-agent-input.inputFingerprint',
      'Evidence Agent Inputの内容とfingerprintが一致しません。');
  }
  return input;
}

export function validateEvidenceArtifact(artifact) {
  validateDocument('evidence-artifact', artifact);
  unique(artifact.sourceRefs, item => canonical(item), `evidence-artifact.${artifact.evidenceId}.sourceRefs`);
  unique(artifact.requirementIds, item => item, `evidence-artifact.${artifact.evidenceId}.requirementIds`);
  unique(artifact.purpose, item => item, `evidence-artifact.${artifact.evidenceId}.purpose`);
  if (artifact.integrity.publicContentDigest !== contentDigest(artifact.publicContent)) {
    fail('EVIDENCE_INTEGRITY_MISMATCH', `evidence-artifact.${artifact.evidenceId}.integrity`,
      'publicContentのSHA-256がintegrity metadataと一致しません。');
  }
  if (artifact.type === 'TESTIMONY') {
    if (!artifact.testimony) fail('TESTIMONY_DETAILS_REQUIRED',
      `evidence-artifact.${artifact.evidenceId}.testimony`, 'TESTIMONYには構造化された証言情報が必要です。');
    unique(artifact.testimony.statements, item => item.statementId,
      `evidence-artifact.${artifact.evidenceId}.testimony.statements`);
    for (const statement of artifact.testimony.statements) unique(statement.groundTruthRefs, item => item,
      `evidence-artifact.${artifact.evidenceId}.testimony.${statement.statementId}.groundTruthRefs`);
  } else if (artifact.testimony !== null) {
    fail('TESTIMONY_TYPE_MISMATCH', `evidence-artifact.${artifact.evidenceId}.testimony`,
      '技術証拠には証言情報を設定できません。');
  }
  return artifact;
}

function refExists(ref, input) {
  if (ref.sourceType === 'GROUND_TRUTH_FACT') {
    return ref.attackNodeId === null && input.groundTruth.technicalFacts.some(item => item.factId === ref.sourceId);
  }
  if (ref.sourceType === 'TIMELINE_EVENT') {
    return ref.attackNodeId === null && input.timeline.events.some(item => item.eventId === ref.sourceId);
  }
  if (ref.sourceType === 'CHARACTER') {
    return ref.attackNodeId === null && input.characters.characters.some(item => item.characterId === ref.sourceId);
  }
  const node = input.attackGraph.nodes.find(item => item.nodeId === ref.attackNodeId);
  const artifact = node?.artifactEvaluations.find(item => item.artifactId === ref.sourceId);
  return Boolean(artifact && artifact.state === 'SATISFIED'
    && artifact.evaluations.every(item => item.state === 'SATISFIED'));
}

function issue(code, field, reason, correctionHint, sourceRefs, evidenceId = null, requirementId = null) {
  return { code, field, evidenceId, requirementId, reason, correctionHint, sourceRefs };
}

function add(issues, condition, ...details) {
  if (condition) issues.push(issue(...details));
}

export function leakedInternalValue(content, input) {
  if (/ground[\s_-]*truth|正解|事件の真相/iu.test(content)) return true;
  const internalIds = [input.groundTruth.groundTruthId, input.verificationResult.verificationId,
    input.evidenceAgentHandoff.handoffId, input.attackGraph.graphId,
    ...input.groundTruth.technicalFacts.flatMap(item => [item.factId, item.sourceId]),
    ...input.evidenceRequirements.requirements.map(item => item.requirementId)];
  return internalIds.some(value => value && content.includes(value));
}

// 外部生成物を補完・修正せず、参照とcoverageを独立に検証する。
export function validateEvidenceConsistency(evidencePackage, input) {
  const issues = [];
  const requirements = new Map(input.evidenceRequirements.requirements.map(item => [item.requirementId, item]));
  const facts = new Set(input.groundTruth.technicalFacts.map(item => item.factId));
  const characters = new Map(input.characters.characters.map(item => [item.characterId, item]));
  const artifacts = new Map();
  for (const artifact of evidencePackage.evidenceArtifacts) {
    try { validateEvidenceArtifact(artifact); } catch (error) {
      issues.push(issue(error.code ?? 'INVALID_EVIDENCE_ARTIFACT', error.field ?? 'evidenceArtifacts',
        error.message, 'Evidence Artifact Schemaとintegrity metadataを修正してください。',
        [`evidence:${artifact.evidenceId ?? 'unknown'}`], artifact.evidenceId ?? null));
      continue;
    }
    if (artifacts.has(artifact.evidenceId)) {
      issues.push(issue('DUPLICATE_EVIDENCE_ID', 'evidenceArtifacts.evidenceId',
        'evidenceIdが重複しています。', 'evidenceIdをEvidence Set内で一意にしてください。',
        [`evidence:${artifact.evidenceId}`], artifact.evidenceId));
      continue;
    }
    artifacts.set(artifact.evidenceId, artifact);
    add(issues, artifact.provenance.verificationId !== input.verificationResult.verificationId
      || artifact.provenance.scenarioId !== input.scenarioImportPackage.scenarioDraft.scenarioId
      || !sameValues(artifact.provenance.attackGraphRef, input.attackGraph.graphId
        ? input.scenarioImportPackage.scenarioDraft.attackGraphRef : null),
    'EVIDENCE_PROVENANCE_MISMATCH', `evidenceArtifacts.${artifact.evidenceId}.provenance`,
    'Evidence Artifactが別Scenario、Verification、またはAttack Graphを参照しています。',
    'Evidence Agent InputのverificationId、scenarioId、attackGraphRefを変更せず使用してください。',
    [`evidence:${artifact.evidenceId}`], artifact.evidenceId);
    add(issues, leakedInternalValue(artifact.publicContent, input), 'GROUND_TRUTH_PUBLIC_LEAK',
      `evidenceArtifacts.${artifact.evidenceId}.publicContent`,
      'publicContentにGround Truthの内部識別子または正解を直接示す表現が含まれています。',
      'プレイヤーが推論に使う観測内容だけを記載し、内部IDや正解表現を削除してください。',
      [`evidence:${artifact.evidenceId}`], artifact.evidenceId);
    for (const requirementId of artifact.requirementIds) {
      const requirement = requirements.get(requirementId);
      add(issues, !requirement, 'BROKEN_EVIDENCE_REQUIREMENT_REFERENCE',
        `evidenceArtifacts.${artifact.evidenceId}.requirementIds`, '存在しないEvidence Requirementを参照しています。',
        'VERIFIED Evidence Requirementに存在するrequirementIdだけを指定してください。',
        [`evidence:${artifact.evidenceId}`], artifact.evidenceId, requirementId);
      if (requirement) add(issues, !artifact.sourceRefs.some(ref => requirement.grounds.some(ground => sameValues(ref, ground))),
        'EVIDENCE_GROUND_MISMATCH', `evidenceArtifacts.${artifact.evidenceId}.sourceRefs`,
        `ArtifactをRequirement「${requirementId}」のgroundへ追跡できません。`,
        `sourceRefsには当該Requirementに登録された根拠が必要です。許可されたgrounds: ${JSON.stringify(requirement.grounds)}。TESTIMONYでも人物参照だけでは技術資料のRequirementを満たしません。本文に対応する既存根拠だけを指定してください。`,
        [`evidenceRequirement:${requirementId}`], artifact.evidenceId, requirementId);
    }
    const expectedPurposes = [...new Set(artifact.requirementIds.map(id => requirements.get(id)?.purpose)
      .filter(Boolean))].sort();
    add(issues, !sameValues([...artifact.purpose].sort(), expectedPurposes), 'EVIDENCE_PURPOSE_MISMATCH',
      `evidenceArtifacts.${artifact.evidenceId}.purpose`,
      'Evidence purposeが参照するVERIFIED Evidence Requirementのpurposeと一致しません。',
      'requirementIdsに対応するpurposeだけを重複なく指定してください。',
      artifact.requirementIds.map(id => `evidenceRequirement:${id}`), artifact.evidenceId);
    for (const ref of artifact.sourceRefs) add(issues, !refExists(ref, input),
      ref.sourceType === 'ATTACK_GRAPH_ARTIFACT' ? 'UNAVAILABLE_OBSERVABLE_ARTIFACT' : 'BROKEN_SOURCE_REFERENCE',
      `evidenceArtifacts.${artifact.evidenceId}.sourceRefs`,
      'sourceRefが存在しないか、UNKNOWN/UNSATISFIEDの技術artifactを確定証拠として参照しています。',
      'VERIFIED入力に存在し、SATISFIEDと確認された根拠だけを参照してください。',
      [`${ref.sourceType}:${ref.sourceId}`], artifact.evidenceId);
    if (artifact.type === 'TESTIMONY' && artifact.testimony) {
      add(issues, !characters.has(artifact.testimony.witnessCharacterId), 'BROKEN_CHARACTER_REFERENCE',
        `evidenceArtifacts.${artifact.evidenceId}.testimony.witnessCharacterId`,
        '証言者がCharactersに存在しません。', 'VERIFIED CharactersのcharacterIdを使用してください。',
        [`evidence:${artifact.evidenceId}`], artifact.evidenceId);
      for (const statement of artifact.testimony.statements) {
        add(issues, !artifact.publicContent.includes(statement.spokenContent), 'TESTIMONY_CONTENT_MISMATCH',
          `evidenceArtifacts.${artifact.evidenceId}.testimony.statements.${statement.statementId}`,
          '実際に発言した内容がpublicContentと分離・対応していません。',
          'spokenContentをプレイヤー向け証言本文に含めてください。',
          [`evidence:${artifact.evidenceId}`], artifact.evidenceId);
        for (const ref of statement.groundTruthRefs) add(issues, !facts.has(ref), 'BROKEN_GROUND_TRUTH_REFERENCE',
          `evidenceArtifacts.${artifact.evidenceId}.testimony.statements.${statement.statementId}.groundTruthRefs`,
          '証言評価が存在しないGround Truth factを参照しています。',
          'VERIFIED Ground TruthのfactIdだけを参照してください。', [`groundTruth.fact:${ref}`], artifact.evidenceId);
        add(issues, (statement.technicalAssessment === 'CONTRADICTED') !== statement.contradictionCandidate,
          'TESTIMONY_ASSESSMENT_MISMATCH',
          `evidenceArtifacts.${artifact.evidenceId}.testimony.statements.${statement.statementId}`,
          '技術評価とContradiction候補フラグが一致しません。',
          'CONTRADICTEDだけをcontradictionCandidate=trueにしてください。',
          [`evidence:${artifact.evidenceId}`], artifact.evidenceId);
      }
    }
  }

  const contradictionIds = new Set();
  for (const contradiction of evidencePackage.contradictions) {
    try { validateDocument('contradiction', contradiction); } catch (error) {
      issues.push(issue(error.code ?? 'INVALID_CONTRADICTION', error.field ?? 'contradictions', error.message,
        'Contradiction Schema v1.0に適合させてください。', ['contradiction:unknown'])); continue;
    }
    add(issues, contradictionIds.has(contradiction.contradictionId), 'DUPLICATE_CONTRADICTION_ID',
      'contradictions.contradictionId', 'contradictionIdが重複しています。', '一意なIDにしてください。',
      [`contradiction:${contradiction.contradictionId}`]);
    contradictionIds.add(contradiction.contradictionId);
    add(issues, new Set(contradiction.conflictingEvidenceIds).size !== contradiction.conflictingEvidenceIds.length,
      'DUPLICATE_CONFLICTING_EVIDENCE',
      `contradictions.${contradiction.contradictionId}.conflictingEvidenceIds`,
      '同じ競合Evidenceが重複しています。', '一意なEvidence IDだけを指定してください。',
      [`contradiction:${contradiction.contradictionId}`]);
    add(issues, new Set(contradiction.groundTruthRefs).size !== contradiction.groundTruthRefs.length,
      'DUPLICATE_GROUND_TRUTH_REFERENCE', `contradictions.${contradiction.contradictionId}.groundTruthRefs`,
      '同じGround Truth参照が重複しています。', '一意なfactIdだけを指定してください。',
      [`contradiction:${contradiction.contradictionId}`]);
    const testimony = artifacts.get(contradiction.testimonyEvidenceId);
    const statement = testimony?.testimony?.statements.find(item => item.statementId === contradiction.statementRef);
    add(issues, testimony?.type !== 'TESTIMONY' || !statement || statement.technicalAssessment !== 'CONTRADICTED'
      || !statement.contradictionCandidate, 'INVALID_CONTRADICTION_TESTIMONY_REFERENCE',
    `contradictions.${contradiction.contradictionId}.statementRef`,
    'ContradictionがCONTRADICTEDと評価されたTESTIMONY statementを参照していません。',
    '有効なtestimonyEvidenceIdとstatementRefを指定してください。',
    [`contradiction:${contradiction.contradictionId}`], contradiction.testimonyEvidenceId);
    for (const id of contradiction.conflictingEvidenceIds) add(issues,
      !artifacts.has(id) || artifacts.get(id).type === 'TESTIMONY' || id === contradiction.testimonyEvidenceId,
      'BROKEN_CONFLICTING_EVIDENCE_REFERENCE', `contradictions.${contradiction.contradictionId}.conflictingEvidenceIds`,
      '矛盾を示す技術Evidence Artifact参照が不正です。',
      '同じEvidence Setに存在する非TESTIMONY artifactを参照してください。',
      [`evidence:${id}`], id);
    for (const ref of contradiction.groundTruthRefs) add(issues, !facts.has(ref),
      'BROKEN_GROUND_TRUTH_REFERENCE', `contradictions.${contradiction.contradictionId}.groundTruthRefs`,
      'Contradictionが存在しないGround Truth factを参照しています。',
      'VERIFIED Ground TruthのfactIdだけを参照してください。', [`groundTruth.fact:${ref}`]);
    add(issues, Boolean(statement) && contradiction.groundTruthRefs.some(ref => !statement.groundTruthRefs.includes(ref)),
      'CONTRADICTION_GROUND_MISMATCH', `contradictions.${contradiction.contradictionId}.groundTruthRefs`,
      'ContradictionのGround Truth根拠が対象statementの技術評価根拠と一致しません。',
      'statementで評価したGround Truth factだけをContradictionへ指定してください。',
      [`contradiction:${contradiction.contradictionId}`], contradiction.testimonyEvidenceId);
    const involved = [testimony, ...contradiction.conflictingEvidenceIds.map(id => artifacts.get(id))]
      .filter(Boolean);
    const sharedRequirement = [...requirements.values()].some(requirement =>
      requirement.purpose === 'CONTRADICTION_PROOF'
      && involved.length === contradiction.conflictingEvidenceIds.length + 1
      && involved.every(item => item.requirementIds.includes(requirement.requirementId)));
    add(issues, !sharedRequirement, 'CONTRADICTION_REQUIREMENT_MISMATCH',
      `contradictions.${contradiction.contradictionId}`,
      '証言と競合技術Evidenceを同じCONTRADICTION_PROOF要件へ追跡できません。',
      '関係する全Artifactを同じVERIFIED CONTRADICTION_PROOF Requirementへ関連付けてください。',
      [`contradiction:${contradiction.contradictionId}`], contradiction.testimonyEvidenceId);
  }

  const exonerationIds = new Set();
  for (const exoneration of evidencePackage.exonerations) {
    try { validateDocument('exoneration', exoneration); } catch (error) {
      issues.push(issue(error.code ?? 'INVALID_EXONERATION', error.field ?? 'exonerations', error.message,
        'Exoneration Schema v1.0に適合させ、複数証拠を指定してください。', ['exoneration:unknown'])); continue;
    }
    add(issues, exonerationIds.has(exoneration.exonerationId), 'DUPLICATE_EXONERATION_ID',
      'exonerations.exonerationId', 'exonerationIdが重複しています。', '一意なIDにしてください。',
      [`exoneration:${exoneration.exonerationId}`]);
    exonerationIds.add(exoneration.exonerationId);
    add(issues, new Set(exoneration.supportingEvidenceIds).size < 2,
      'INSUFFICIENT_EXONERATION_SUPPORT', `exonerations.${exoneration.exonerationId}.supportingEvidenceIds`,
      'Exonerationには異なるEvidence Artifactが2件以上必要です。',
      '同一IDを重複させず、独立した根拠を2件以上指定してください。',
      [`exoneration:${exoneration.exonerationId}`]);
    add(issues, new Set(exoneration.groundTruthRefs).size !== exoneration.groundTruthRefs.length,
      'DUPLICATE_GROUND_TRUTH_REFERENCE', `exonerations.${exoneration.exonerationId}.groundTruthRefs`,
      '同じGround Truth参照が重複しています。', '一意なfactIdだけを指定してください。',
      [`exoneration:${exoneration.exonerationId}`]);
    const defendant = characters.get(exoneration.defendantCharacterId);
    add(issues, !defendant?.roles.includes('defendant'), 'INVALID_DEFENDANT_REFERENCE',
      `exonerations.${exoneration.exonerationId}.defendantCharacterId`,
      'Exoneration対象がdefendant役のCharacterではありません。',
      'VERIFIED Charactersのdefendantを参照してください。', [`character:${exoneration.defendantCharacterId}`]);
    for (const id of exoneration.supportingEvidenceIds) add(issues,
      !artifacts.has(id) || !artifacts.get(id).purpose.includes('EXONERATION_PROOF'),
      'INSUFFICIENT_EXONERATION_SUPPORT', `exonerations.${exoneration.exonerationId}.supportingEvidenceIds`,
      'Exonerationが複数のEXONERATION_PROOF Evidenceへ追跡できません。',
      '同じScenarioのEXONERATION_PROOF artifactを2件以上参照してください。', [`evidence:${id}`], id);
    for (const ref of exoneration.groundTruthRefs) add(issues, !facts.has(ref),
      'BROKEN_GROUND_TRUTH_REFERENCE', `exonerations.${exoneration.exonerationId}.groundTruthRefs`,
      'Exonerationが存在しないGround Truth factを参照しています。',
      'VERIFIED Ground TruthのfactIdだけを参照してください。', [`groundTruth.fact:${ref}`]);
  }

  const coverage = [...requirements.values()].map(requirement => ({
    requirementId: requirement.requirementId,
    evidenceIds: [...artifacts.values()].filter(item => item.requirementIds.includes(requirement.requirementId))
      .map(item => item.evidenceId).sort(),
  }));
  for (const row of coverage) add(issues, row.evidenceIds.length === 0, 'EVIDENCE_REQUIREMENT_NOT_COVERED',
    'evidenceArtifacts.requirementIds', 'Evidence Requirementを満たすArtifactがありません。',
    '当該Requirementへ追跡可能なArtifactを1件以上生成してください。',
    [`evidenceRequirement:${row.requirementId}`], null, row.requirementId);
  for (const requirement of requirements.values()) {
    for (const ground of requirement.grounds.filter(item => item.sourceType === 'ATTACK_GRAPH_ARTIFACT')) {
      add(issues, ![...artifacts.values()].some(artifact => artifact.type !== 'TESTIMONY'
        && artifact.requirementIds.includes(requirement.requirementId)
        && artifact.sourceRefs.some(ref => sameValues(ref, ground))),
      'OBSERVABLE_EVIDENCE_NOT_COVERED', 'evidenceArtifacts.sourceRefs',
      'Evidence Requirementが依存する観測資料が取得可能な技術Evidenceに含まれていません。',
      'groundsの各ATTACK_GRAPH_ARTIFACTを実際の技術資料へ対応付けてください。証言や人物参照では代用できません。',
      [`attackGraph.artifact:${ground.attackNodeId}:${ground.sourceId}`], null, requirement.requirementId);
    }
    if (requirement.purpose === 'CONTRADICTION_PROOF') add(issues,
      !evidencePackage.contradictions.some(item => {
        const ids = [item.testimonyEvidenceId, ...item.conflictingEvidenceIds];
        return ids.some(id => artifacts.get(id)?.requirementIds.includes(requirement.requirementId));
      }), 'CONTRADICTION_REQUIRED', 'contradictions',
    'CONTRADICTION_PROOF要件に対応する構造化Contradictionがありません。',
    '証言statement、競合する技術証拠、Ground Truth参照を関連付けてください。',
    [`evidenceRequirement:${requirement.requirementId}`], null, requirement.requirementId);
    if (requirement.purpose === 'EXONERATION_PROOF') add(issues,
      !evidencePackage.exonerations.some(item => new Set(item.supportingEvidenceIds).size >= 2
        && item.supportingEvidenceIds.every(id => artifacts.get(id)?.requirementIds.includes(requirement.requirementId))),
    'EXONERATION_REQUIRED', 'exonerations',
    'EXONERATION_PROOF要件がGround Truthと複数Evidenceへ追跡できません。',
    '単一のアカウント・端末・IPだけに依存せず、2件以上のArtifactとGround Truth factを指定してください。',
    [`evidenceRequirement:${requirement.requirementId}`], null, requirement.requirementId);
  }
  return { valid: issues.length === 0, issues, requirementCoverage: coverage,
    contradictionRefs: [...contradictionIds].sort(), exonerationRefs: [...exonerationIds].sort() };
}

export function evidenceSetCore(set) {
  return { scenarioId: set.scenarioId, verificationId: set.verificationId,
    attackGraphRef: set.attackGraphRef, evidenceArtifacts: set.evidenceArtifacts,
    requirementCoverage: set.requirementCoverage, contradictionRefs: set.contradictionRefs,
    contradictions: set.contradictions, exonerationRefs: set.exonerationRefs,
    exonerations: set.exonerations };
}

export function validateEvidenceSet(set) {
  validateDocument('evidence-set', set);
  unique(set.evidenceArtifacts, item => item.evidenceId, 'evidence-set.evidenceArtifacts.evidenceId');
  unique(set.requirementCoverage, item => item.requirementId, 'evidence-set.requirementCoverage.requirementId');
  unique(set.contradictionRefs, item => item, 'evidence-set.contradictionRefs');
  unique(set.exonerationRefs, item => item, 'evidence-set.exonerationRefs');
  set.contradictions.forEach(item => validateDocument('contradiction', item));
  set.exonerations.forEach(item => validateDocument('exoneration', item));
  unique(set.contradictions, item => item.contradictionId, 'evidence-set.contradictions.contradictionId');
  unique(set.exonerations, item => item.exonerationId, 'evidence-set.exonerations.exonerationId');
  if (!sameValues(set.contradictions.map(item => item.contradictionId).sort(),
    [...set.contradictionRefs].sort())) fail('BROKEN_CONTRADICTION_SET', 'evidence-set.contradictions',
    'Evidence SetのContradiction本体と参照一覧が一致しません。');
  if (!sameValues(set.exonerations.map(item => item.exonerationId).sort(),
    [...set.exonerationRefs].sort())) fail('BROKEN_EXONERATION_SET', 'evidence-set.exonerations',
    'Evidence SetのExoneration本体と参照一覧が一致しません。');
  set.evidenceArtifacts.forEach(validateEvidenceArtifact);
  const evidenceIds = new Set(set.evidenceArtifacts.map(item => item.evidenceId));
  for (const row of set.requirementCoverage) {
    unique(row.evidenceIds, item => item, `evidence-set.requirementCoverage.${row.requirementId}.evidenceIds`);
    if (row.evidenceIds.some(id => !evidenceIds.has(id))) fail('BROKEN_EVIDENCE_SET_COVERAGE',
      `evidence-set.requirementCoverage.${row.requirementId}.evidenceIds`,
      'Requirement coverageがEvidence SetにないArtifactを参照しています。');
  }
  const expectedCoverage = [...new Set(set.evidenceArtifacts.flatMap(item => item.requirementIds))]
    .sort().map(requirementId => ({ requirementId, evidenceIds: set.evidenceArtifacts
      .filter(item => item.requirementIds.includes(requirementId)).map(item => item.evidenceId).sort() }));
  const actualCoverage = set.requirementCoverage.map(item => ({ requirementId: item.requirementId,
    evidenceIds: [...item.evidenceIds].sort() })).sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  if (!sameValues(actualCoverage, expectedCoverage)) fail('BROKEN_EVIDENCE_SET_COVERAGE',
    'evidence-set.requirementCoverage', 'Evidence ArtifactとRequirement coverageが双方向に一致しません。');
  if (set.fingerprint !== digest(evidenceSetCore(set))
    || set.evidenceSetId !== `evidence_set_${set.fingerprint.slice(0, 20)}`) {
    fail('EVIDENCE_SET_FINGERPRINT_MISMATCH', 'evidence-set.fingerprint',
      'Evidence Setの内容、ID、fingerprintが一致しません。');
  }
  return set;
}

export function validateEvidenceFeedback(feedback) {
  validateDocument('evidence-validation-feedback', feedback);
  return feedback;
}

export function validateGameCaseHandoff(handoff, set = null) {
  validateDocument('game-case-handoff', handoff);
  if (handoff.handoffId !== `game_case_handoff_${handoff.evidenceSetFingerprint.slice(0, 20)}`) {
    fail('GAME_CASE_HANDOFF_MISMATCH', 'game-case-handoff.handoffId',
      'Game Case Handoff IDがEvidence Set fingerprintと一致しません。');
  }
  if (set && (handoff.evidenceSetId !== set.evidenceSetId
    || handoff.evidenceSetFingerprint !== set.fingerprint
    || handoff.scenarioId !== set.scenarioId || handoff.verificationId !== set.verificationId
    || !sameValues(handoff.attackGraphRef, set.attackGraphRef))) {
    fail('GAME_CASE_HANDOFF_MISMATCH', 'game-case-handoff',
      'Game Case HandoffがVALID Evidence Setと一致しません。');
  }
  return handoff;
}

export function validateEvidenceImportResult(result) {
  validateDocument('evidence-import-result', result);
  const valid = result.status === 'VALID';
  if (valid !== result.valid) fail('INVALID_EVIDENCE_IMPORT_RESULT', 'evidence-import-result.valid',
    'statusとvalidが一致しません。');
  if (valid) {
    if (result.errors.length || result.feedback || !result.evidenceSet || !result.gameCaseHandoff
      || Object.values(result.validationStages).some(value => value !== 'PASSED')) {
      fail('INVALID_EVIDENCE_IMPORT_RESULT', 'evidence-import-result.status',
        'VALID結果の検証段階、error、Evidence Set、Handoffが矛盾しています。');
    }
    validateEvidenceSet(result.evidenceSet);
    validateGameCaseHandoff(result.gameCaseHandoff, result.evidenceSet);
    if (result.scenarioId !== result.evidenceSet.scenarioId
      || !sameValues(result.attackGraphRef, result.evidenceSet.attackGraphRef)) {
      fail('INVALID_EVIDENCE_IMPORT_RESULT', 'evidence-import-result.evidenceSet',
        'Import ResultとEvidence SetのScenarioまたはAttack Graphが一致しません。');
    }
  } else if (!result.errors.length || result.evidenceSet || result.gameCaseHandoff
    || (result.status === 'INVALID' && !result.feedback)
    || (result.status === 'BLOCKED' && result.feedback)) {
    fail('INVALID_EVIDENCE_IMPORT_RESULT', 'evidence-import-result.status',
      'INVALID/BLOCKED結果のerror、Feedback、またはHandoffが矛盾しています。');
  }
  if (result.feedback) {
    validateEvidenceFeedback(result.feedback);
    if (!sameValues(result.feedback.generationInputRef, result.generationInputRef)
      || !sameValues(result.feedback.errors, result.errors)) {
      fail('INVALID_EVIDENCE_IMPORT_RESULT', 'evidence-import-result.feedback',
        'Import ResultとValidation Feedbackの参照またはerrorsが一致しません。');
    }
  }
  return result;
}
