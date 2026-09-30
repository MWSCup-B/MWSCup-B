import { fail } from './schema.js';
import { phishingMailLinks } from './phishing-evidence.js';
import { validateLearningObservations } from './learning-observations.js';
import { validateRansomwareObservations } from './ransomware-observations.js';

// Case observations are authored BEFORE review, separately from technical facts.
// They describe a witness's direct observation, never an inference from an IP.
export function buildCaseFacts(configuration, generationInput) {
  if (configuration.incidentDesign !== 'ATTACK_CAUSED_HARM_V1') return [];
  const order = new Map(configuration.attacks.map(attack => [attack.attackId, attack.order]));
  return [...generationInput.technicalInput.attackGraph.nodes].sort((left, right) =>
    (order.get(left.attackDefinitionId) ?? Infinity) - (order.get(right.attackDefinitionId) ?? Infinity)
      || left.nodeId.localeCompare(right.nodeId)).map(node => {
    const profile = generationInput.technicalInput.attackDefinitions
      .find(item => item.id === node.attackDefinitionId)?.incidentNarrative;
    if (!profile?.attributionObservation) fail('EXONERATION_ATTRIBUTION_EVIDENCE_MISSING',
      `attacks.${node.attackDefinitionId}.incidentNarrative`,
      '人物の関与を独立に裏付ける取得可能な事件資料が定義されていません。技術ログの人物不明だけで無罪にしません。');
    return { schemaVersion: '1.0', factId: `case_observation_${node.nodeId}`,
      attackNodeId: node.nodeId, witnessCharacterId: 'character_observer',
      subjectCharacterId: 'character_attacker', excludedCharacterId: 'character_defendant',
      observation: profile.attributionObservation, relatedArtifactIds: [...profile.requiredArtifactIds] };
  });
}

export function caseReportDescription(fact) {
  return `第三者の直接観察を記載した調査報告。ログではなく事件内の供述資料である。観察内容は「${fact.observation}」。`
    + '観察者が何を直接見たか、被告人と面識があるという識別根拠、観察の対象を特定する保全内容を区別して記す。'
    + 'caseSupport.supportingQuotesの各引用原記録に含まれるイベントIDまたは対象値のキーと完全な値を、報告本文にも一字一句そのまま記載する。'
    + '各値がどの記録・対象を指し、どの値同士を対応させたかを説明する。時刻・資料名・アカウント・IP・種別だけで代用しない。'
    + 'caseSupport.observationQuoteへ観察内容をそのまま、supportingQuotesへ関連する各技術資料の原文を引用する。'
    + '供述だけで処理の成功や被害を確定しない。技術資料だけで人物を特定しない。判決文・正解・内部IDは記載しない。';
}

// A separate authoring manifest: these are obtainable witness reports, not
// machine observations. All content and routes come from the verified inputs.
export function buildCaseReportCatalog(stages, scenarioPackage) {
  const requirements = scenarioPackage.evidenceRequirements.requirements;
  const entries = (scenarioPackage.groundTruth.caseFacts ?? []).map(fact => {
    const index = stages.findIndex(stage => stage.routes.some(route => route.ground.sourceType === 'CASE_FACT'
      && route.ground.sourceId === fact.factId && route.ground.attackNodeId === fact.attackNodeId));
    if (index < 0) fail('EXONERATION_ATTRIBUTION_EVIDENCE_MISSING', `caseFacts.${fact.factId}`,
      '調査報告の取得先・取得順序が定義されていません。');
    const stage = stages[index];
    const route = stage.routes.find(item => item.ground.sourceType === 'CASE_FACT' && item.ground.sourceId === fact.factId);
    return { factId: fact.factId, ground: structuredClone(route.ground), targetId: stage.targetId, order: index + 1,
      sourceNodeId: route.sourceNodeId, actionId: route.actionId, logSource: route.logSource,
      evidenceType: 'DOCUMENT', observationQuote: fact.observation,
      requirementIds: requirements.filter(requirement => requirement.grounds.some(ground =>
        ground.sourceType === 'CASE_FACT' && ground.sourceId === fact.factId && ground.attackNodeId === fact.attackNodeId))
        .map(requirement => requirement.requirementId),
      requiredTechnicalGrounds: fact.relatedArtifactIds.map(sourceId => ({ sourceType: 'ATTACK_GRAPH_ARTIFACT',
        attackNodeId: fact.attackNodeId, sourceId })) };
  });
  return { schemaVersion: '1.0', entries };
}

// Prefer event/content identities over generic accounts, IPs, MIME types or
// timestamps. Configuration records instead identify their actual policy/target.
function reportLinkValues(content) {
  const events = new Set(['request_id', 'request_ref', 'auth_event_ref', 'connection_ref',
    'session_ref', 'session_id', 'execution_id', 'instruction_ref', 'process_ref',
    'query_id', 'post_id', 'content_id', 'file_ref', 'storage_ref', 'storage_id', 'attempt_id']);
  const targets = new Set(['path', 'file', 'original_path', 'source_path', 'image_path',
    'allowed_command', 'command', 'executable', 'hash', 'sha256', 'scope', '対象範囲']);
  const ids = [], values = [];
  const add = (key, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    if (events.has(key)) ids.push({ key, value });
    else if (targets.has(key)) values.push({ key, value });
  };
  const visit = row => {
    if (Array.isArray(row)) row.forEach(visit);
    else if (row && typeof row === 'object') Object.entries(row).forEach(([key, value]) => add(key, value));
  };
  try { visit(JSON.parse(content)); }
  catch { for (const line of content.split(/\r?\n/)) {
    try { visit(JSON.parse(line)); } catch {
      const match = line.match(/^([^\s:=：]+)\s*[:=：]\s*(.+)$/);
      if (match) add(match[1], match[2]);
    }
  } }
  if (ids.length) return ids;
  if (values.length) return values;
  const links = phishingMailLinks(content);
  if (links.length) return links.map(link => ({ key: 'href', value: link.href }));
  return (content.match(/https?:\/\/[^\s<>"']+/g) ?? []).map(value => ({ key: 'url', value }));
}

// A quoted identifier must be a complete value, not the prefix of another
// event/path. Punctuation and Japanese prose may surround a preserved value.
function containsLinkValue(content, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_./:%?&=#@+~\\-])${escaped}(?![A-Za-z0-9_./:%?&=#@+~\\-])`).test(content);
}

function attributionQuestion(fact, artifacts, agent, questions) {
  const stages = (agent.evidenceRequirements?.requirements ?? []).filter(item => item.investigationStage)
    .sort((left, right) => left.investigationStage.order - right.investigationStage.order);
  const statements = artifacts.filter(item => item.type === 'TESTIMONY')
    .flatMap(item => item.testimony.statements).filter(item => item.technicalAssessment === 'CONTRADICTED');
  const stageIndex = stages.findIndex(stage => stage.grounds.some(ground => ground.sourceType === 'CASE_FACT'
    && ground.sourceId === fact.factId && ground.attackNodeId === fact.attackNodeId));
  const statement = statements[stageIndex];
  const owners = statement ? questions.filter(question => question.statementId === statement.statementId) : [];
  if (stageIndex < 0 || owners.length !== 1) fail('EXONERATION_ATTRIBUTION_EVIDENCE_MISSING',
    'evidenceArtifacts.caseSupport', '各調査報告を初めて論証に使う検証済み段階と、その段階の争点を一意に対応付けてください。');
  return { question: owners[0], stageIndex };
}

export function reviewedAttributionConclusion(artifacts, agent, questions) {
  const facts = agent.groundTruth.caseFacts ?? [];
  if (!facts.length) return null; // Preserve the previous conclusion for old cases.
  const completed = facts.map(fact => attributionQuestion(fact, artifacts, agent, questions));
  const ordered = [...new Map(completed.map(item => [item.stageIndex, item])).values()]
    .sort((left, right) => left.stageIndex - right.stageIndex);
  if (ordered.some(item => !item.question.explanation?.trim())) fail('EVIDENCE_CONCLUSION_EXPLANATION_MISSING',
    'courtQuestions.explanation', '各攻撃の論証が完結する争点に、取得資料に基づく解説が必要です。');
  const explanation = ordered.map(item => item.question.explanation).join('\n\n');
  if (explanation.length > 16000) fail('EVIDENCE_CONCLUSION_EXPLANATION_TOO_LONG',
    'courtQuestions.explanation', '各攻撃の完結争点の解説を結合すると16,000字を超えます。', {
      correctionHint: '完結争点の解説は合計16,000字以内（区切り改行を含む）に簡潔化してください。根拠引用・資料・対応関係・観察内容・判断の限界は削除せず、重複した説明や冗長な言い回しを整理してください。',
    });
  return explanation;
}

export function validateCaseAttribution(artifacts, agent, questions = []) {
  const facts = agent.groundTruth.caseFacts ?? [];
  const missingReportLinks = [];
  const reject = reason => fail('EXONERATION_ATTRIBUTION_EVIDENCE_MISSING', 'evidenceArtifacts.caseSupport', reason);
  for (const fact of facts) {
    const requiredQuotes = [];
    const reportLinks = [];
    const matches = artifacts.filter(item => item.type !== 'TESTIMONY' && item.sourceRefs.some(ref => ref.sourceType === 'CASE_FACT'
      && ref.sourceId === fact.factId && ref.attackNodeId === fact.attackNodeId));
    if (matches.length !== 1 || matches[0].type !== 'DOCUMENT') reject('各事件内観察に、通常調査で取得できる独立した調査報告を1件用意してください。');
    const report = matches[0], support = report.caseSupport;
    if (!support || support.observationQuote !== fact.observation
      || !report.publicContent.includes(support.observationQuote)) reject('調査報告の観察内容が、事前に定義・検証した直接観察と一致しません。');
    const covered = new Set();
    const proofArtifacts = new Map();
    for (const quote of support.supportingQuotes) {
      const evidence = artifacts.find(item => item.evidenceId === quote.evidenceId);
      const refs = evidence?.sourceRefs.filter(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT'
        && ref.attackNodeId === fact.attackNodeId && fact.relatedArtifactIds.includes(ref.sourceId)) ?? [];
      if (!refs.length || evidence.type === 'TESTIMONY' || !evidence.publicContent.includes(quote.quote))
        reject('調査報告は同じ攻撃の既存技術資料の原文と対応させてください。別事件や存在しない引用では裏付けられません。');
      // Names of record fields and timestamps alone are not an event/target link.
      const anchors = [...new Map(reportLinkValues(quote.quote).map(anchor =>
        [`${anchor.key}\u0000${anchor.value}`, anchor])).values()];
      const missing = anchors.filter(anchor => !containsLinkValue(report.publicContent, anchor.value));
      if (!anchors.length || missing.length) missingReportLinks.push({ reportEvidenceId: report.evidenceId,
        technicalEvidenceId: quote.evidenceId, missing: missing.map(({ key, value }) => `${key}=${value}`) });
      reportLinks.push({ evidenceId: report.evidenceId, anchors: anchors.map(anchor => anchor.value) });
      refs.forEach(ref => covered.add(ref.sourceId));
      const proof = proofArtifacts.get(evidence.evidenceId) ?? { ...evidence, publicContent: '' };
      proof.publicContent += (proof.publicContent ? '\n' : '') + quote.quote;
      proofArtifacts.set(evidence.evidenceId, proof);
      requiredQuotes.push(quote);
    }
    if (fact.relatedArtifactIds.some(id => !covered.has(id))) reject('人物に関する報告と、事件の処理・被害を示す必要技術資料との照合が不足しています。');
    // A shared host/account copied from an unrelated ordinary row is not enough.
    // The exact cited observations must themselves contain the complete chain.
    validateLearningObservations([...proofArtifacts.values()]);
    validateRansomwareObservations([...proofArtifacts.values()], { ...agent.attackGraph,
      nodes: agent.attackGraph.nodes.filter(node => node.nodeId === fact.attackNodeId) });
    requiredQuotes.push({ evidenceId: report.evidenceId, quote: support.observationQuote });
    const reportHasMissingAnchors = missingReportLinks.some(item => item.reportEvidenceId === report.evidenceId);
    if (questions.length && !reportHasMissingAnchors) {
      // The reviewed acquisition order owns this proof, not the last question
      // or whichever unrelated question happens to quote part of the report.
      const { question } = attributionQuestion(fact, artifacts, agent, questions);
      if (requiredQuotes.some(required => !question.supportingQuotes.some(quote =>
        quote.evidenceId === required.evidenceId && quote.quote.includes(required.quote))))
        reject('調査報告を扱う争点の根拠引用に、直接観察と対応する技術記録の全必要箇所を含めてください。別の争点の引用や報告の見出しだけでは足りません。');
      if (reportLinks.some(link => link.anchors.some(value => !question.supportingQuotes.some(quote =>
        quote.evidenceId === link.evidenceId && containsLinkValue(quote.quote, value)))))
        reject('調査報告を扱う争点には、観察文に加え、本件の対象を特定する報告内の照合箇所も引用してください。');
    }
  }
  if (missingReportLinks.length) {
    const instructions = missingReportLinks.map(item => `${item.reportEvidenceId} ← ${item.technicalEvidenceId}: ${item.missing.length
      ? item.missing.join('、') : '引用原文に実在するイベントIDまたは対象値'}`).join('。');
    fail('EXONERATION_ATTRIBUTION_EVIDENCE_MISSING', 'evidenceArtifacts.caseSupport',
      `調査報告本文に、引用した技術資料の具体的な照合値が不足しています。${instructions}。`, {
        retryable: true,
        correctionHint: `evidenceRepairBase内の同じ独立調査報告について、次の技術資料の引用行から識別値を一字一句そのまま報告本文へ転記してください: ${instructions}。各値がどの記録・対象を指すか、どの値同士を対応させたかを文中で説明し、引用した全資料との対応を記してください。時刻・資料名・アカウント・IP・種別だけでは代用できません。値や観察事実を創作せず、caseSupport.supportingQuotesと対象争点のsupportingQuotesを維持してください。`,
      });
  }
  if (facts.length && questions.length) reviewedAttributionConclusion(artifacts, agent, questions);
}
