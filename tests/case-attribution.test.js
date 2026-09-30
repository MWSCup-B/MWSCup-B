import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedAttributionConclusion, validateCaseAttribution } from '../server/generation/case-attribution.js';
import { leakedInternalValue, validateEvidenceConsistency } from '../server/generation/evidence-validator.js';
import { projectPublicGameCase, validatePublicGameCase } from '../server/generation/game-case-validator.js';
import { createGeneratedGame, generatedPlayerView } from '../server/generated-game.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';

const json = JSON.stringify;
function fixture() {
  const fact = { factId: 'case_observation_upload', attackNodeId: 'attack_upload',
    observation: '立会人は被告人と面識があり、別の人物が保全されたファイルを送信する場面を直接確認した。',
    relatedArtifactIds: ['upload_receipt_record', 'uploaded_file_record'] };
  const receipt = { timestamp: '2026-09-30T09:00:00Z', request_ref: 'request-incident',
    filename: 'notice.png', source_ref: 'external-sender', declared_type: 'image/png',
    storage_ref: 'stored-incident', result: 'stored' };
  const file = { storage_ref: 'stored-incident', stored_at: '2026-09-30T09:00:01Z',
    hash: 'content-incident', detected_type: 'application/octet-stream', content_check: 'disallowed', executable_storage: false };
  const ordinaryReceipt = { ...receipt, request_ref: 'request-normal', storage_ref: 'stored-normal' };
  const ordinaryFile = { ...file, storage_ref: 'stored-normal', detected_type: 'image/png', content_check: 'allowed' };
  const source = (id, ref, ordinary, incident) => ({ evidenceId: id, type: 'APPLICATION_LOG',
    publicContent: json(ordinary) + '\n' + json(incident), sourceRefs: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT',
      sourceId: ref, attackNodeId: fact.attackNodeId }] });
  const artifacts = [source('receipt', 'upload_receipt_record', ordinaryReceipt, receipt),
    { ...source('file', 'uploaded_file_record', ordinaryFile, file), type: 'FILE_METADATA' }];
  const supportingQuotes = artifacts.map(item => ({ evidenceId: item.evidenceId, quote: item.publicContent.split('\n')[1] }));
  const report = { evidenceId: 'report', type: 'DOCUMENT', title: '第三者の観察調査報告',
    publicContent: `第三者の観察調査報告\n${fact.observation}\n保全対象: stored-incident / request-incident / content-incident`,
    sourceRefs: [{ sourceType: 'CASE_FACT', sourceId: fact.factId, attackNodeId: fact.attackNodeId }],
    caseSupport: { observationQuote: fact.observation, supportingQuotes } };
  artifacts.push({ evidenceId: 'testimony', type: 'TESTIMONY', sourceRefs: [], testimony: { statements: [
    { statementId: 'statement_final', technicalAssessment: 'CONTRADICTED' },
  ] } }, report);
  const questions = [{ statementId: 'statement_final', explanation: '保全された対象と記録を照合した結論。', supportingQuotes: [
    ...structuredClone(supportingQuotes), { evidenceId: 'report', quote: report.publicContent }] }];
  const agent = { groundTruth: { caseFacts: [fact] }, attackGraph: { nodes: [
    { nodeId: fact.attackNodeId, attackDefinitionId: 'unrestricted_file_upload' }] },
  evidenceRequirements: { requirements: [{ investigationStage: { order: 1, targetId: 'target_upload' },
    grounds: structuredClone(report.sourceRefs) }] } };
  return { fact, agent, artifacts, report, questions };
}
const verify = value => validateCaseAttribution(value.artifacts, value.agent, value.questions);
const attributionError = { code: 'EXONERATION_ATTRIBUTION_EVIDENCE_MISSING' };

test('direct observation and the same upload tuple support attribution without publishing metadata', () => {
  const value = fixture();
  assert.doesNotThrow(() => verify(value));
  assert.ok(value.report.publicContent.includes(value.fact.observation));
  assert.ok(!value.report.publicContent.includes(value.fact.factId));
});

test('missing or duplicate reports and another attack node cannot supply attribution', () => {
  for (const change of [
    value => { value.artifacts.pop(); },
    value => { value.artifacts.push({ ...structuredClone(value.report), evidenceId: 'duplicate' }); },
    value => { value.artifacts[0].sourceRefs[0].attackNodeId = 'attack_other'; },
    value => { value.report.sourceRefs[0].attackNodeId = 'attack_other'; },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => verify(value), attributionError);
  }
});

test('testimony may cite a case fact but cannot replace or duplicate the independent report', () => {
  const value = fixture();
  value.artifacts.find(item => item.type === 'TESTIMONY').sourceRefs = structuredClone(value.report.sourceRefs);
  assert.doesNotThrow(() => verify(value));
  value.artifacts.pop();
  assert.throws(() => verify(value), attributionError);
});

test('a report cannot alter the pre-reviewed observation or cite a nonexistent original', () => {
  for (const change of [
    value => { value.report.caseSupport.observationQuote = '被告人が操作した。'; },
    value => { value.report.publicContent = '保全対象: stored-incident'; },
    value => { value.report.caseSupport.supportingQuotes[0].quote = '存在しない記録'; },
    value => { value.report.caseSupport.supportingQuotes.pop(); },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => verify(value), attributionError);
  }
});

test('ordinary rows cannot borrow the unquoted incident rows to establish the attack', () => {
  const value = fixture();
  value.report.caseSupport.supportingQuotes = value.artifacts.slice(0, 2).map(item => ({
    evidenceId: item.evidenceId, quote: item.publicContent.split('\n')[0] }));
  value.report.publicContent += '\n通常処理の比較値: stored-normal / request-normal';
  value.questions[0].supportingQuotes = [...structuredClone(value.report.caseSupport.supportingQuotes),
    { evidenceId: 'report', quote: value.fact.observation }];
  assert.throws(() => verify(value), error => error.code === 'EVIDENCE_LEARNING_CORRELATION_MISMATCH');
});

test('complete records with different stored objects are not the same causal tuple', () => {
  const value = fixture();
  value.artifacts[1].publicContent = value.artifacts[1].publicContent.replaceAll('stored-incident', 'stored-other');
  value.report.caseSupport.supportingQuotes[1].quote = value.artifacts[1].publicContent.split('\n')[1];
  value.report.publicContent += '\n他の対象: stored-other';
  value.questions[0].supportingQuotes[1].quote = value.report.caseSupport.supportingQuotes[1].quote;
  assert.throws(() => verify(value), error => error.code === 'EVIDENCE_LEARNING_CORRELATION_MISMATCH');
});

test('generic sender and MIME values cannot link a witness observation to the particular incident', () => {
  const value = fixture();
  value.report.publicContent = `第三者の観察調査報告\n${value.fact.observation}\n送信元: external-sender\n種類: application/octet-stream`;
  // The technical quotes still form a valid attack, but the report has no
  // request/storage/content identifier that identifies the observed operation.
  assert.throws(() => verify(value), attributionError);
});

test('a different identifier with the same prefix cannot link the report to the incident', () => {
  const value = fixture();
  value.report.publicContent = value.report.publicContent.replaceAll('stored-incident', 'stored-incident-other')
    .replaceAll('request-incident', 'request-incident-other').replaceAll('content-incident', 'content-incident-other');
  value.questions[0].supportingQuotes.at(-1).quote = value.report.publicContent;
  assert.throws(() => verify(value), attributionError);
});

test('a mixed quote cannot use a normal event identifier to attribute the incident', () => {
  const value = fixture();
  value.report.caseSupport.supportingQuotes = value.artifacts.slice(0, 2)
    .map(item => ({ evidenceId: item.evidenceId, quote: item.publicContent }));
  value.report.publicContent = `第三者の観察調査報告\n${value.fact.observation}\n保全対象: stored-normal / request-normal`;
  value.questions[0].supportingQuotes = [...structuredClone(value.report.caseSupport.supportingQuotes),
    { evidenceId: 'report', quote: value.report.publicContent }];
  assert.throws(() => verify(value), attributionError);
});

test('the assigned completion question must quote the actual observation and every technical basis', () => {
  for (const change of [
    value => { value.questions[0].supportingQuotes.at(-1).quote = '第三者の観察調査報告'; },
    value => { value.questions[0].supportingQuotes.at(-1).quote = value.fact.observation; },
    value => { value.questions[0].supportingQuotes[0].quote = value.artifacts[0].publicContent.split('\n')[0]; },
    value => { value.questions[0].supportingQuotes.pop(); },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => verify(value), attributionError);
  }
});

function twoAttackFixture() {
  const first = fixture();
  const replacements = new Map(['receipt', 'file', 'report', 'testimony', 'statement_final',
    'case_observation_upload', 'attack_upload', 'target_upload'].map(value => [value, `${value}_second`]));
  const second = JSON.parse(JSON.stringify(fixture(), (_key, value) => typeof value === 'string'
    ? replacements.get(value) ?? value.replaceAll('-incident', '-second') : value));
  second.agent.evidenceRequirements.requirements[0].investigationStage.order = 2;
  first.agent.groundTruth.caseFacts.push(second.fact);
  first.agent.attackGraph.nodes.push(...second.agent.attackGraph.nodes);
  first.agent.evidenceRequirements.requirements.push(...second.agent.evidenceRequirements.requirements);
  first.artifacts.push(...second.artifacts);
  first.questions.push(...second.questions);
  first.questions[0].explanation = '最初の攻撃について確認した結論。';
  first.questions[1].explanation = '次の攻撃について確認した結論。';
  return first;
}

test('each attack is proved in its own completion stage without repeating earlier evidence at the final stage', () => {
  const value = twoAttackFixture();
  assert.doesNotThrow(() => verify(value));
  assert.equal(value.questions[1].supportingQuotes.some(quote => quote.evidenceId === 'report'), false);
  // Question array order is not a substitute for the reviewed stage/statement mapping.
  value.questions.reverse();
  value.agent.evidenceRequirements.requirements.reverse();
  assert.doesNotThrow(() => verify(value));
  assert.equal(reviewedAttributionConclusion(value.artifacts, value.agent, value.questions),
    '最初の攻撃について確認した結論。\n\n次の攻撃について確認した結論。');
});

test('proof in another stage or a missing assignment cannot replace the required completion proof', () => {
  for (const change of [
    value => { value.questions[1].supportingQuotes.push(...value.questions[0].supportingQuotes);
      value.questions[0].supportingQuotes = []; },
    value => { const [first, second] = value.questions;
      [first.supportingQuotes, second.supportingQuotes] = [second.supportingQuotes, first.supportingQuotes]; },
    value => { value.agent.evidenceRequirements.requirements[0].grounds = []; },
    value => { value.questions.splice(0, 1); },
  ]) {
    const value = twoAttackFixture(); change(value);
    assert.throws(() => verify(value), attributionError);
  }
});

test('the conclusion excludes intermediate lessons and returns an actionable over-length error without truncation', () => {
  const value = twoAttackFixture();
  value.agent.evidenceRequirements.requirements.forEach(requirement => { requirement.investigationStage.order += 1; });
  value.agent.evidenceRequirements.requirements.unshift({ investigationStage: { order: 1, targetId: 'target_intro' }, grounds: [] });
  value.artifacts.find(item => item.type === 'TESTIMONY').testimony.statements.unshift({
    statementId: 'statement_intro', technicalAssessment: 'CONTRADICTED' });
  value.questions.unshift({ statementId: 'statement_intro', explanation: '途中で資料を読む説明。', supportingQuotes: [] });
  assert.doesNotThrow(() => verify(value));
  assert.equal(reviewedAttributionConclusion(value.artifacts, value.agent, value.questions),
    '最初の攻撃について確認した結論。\n\n次の攻撃について確認した結論。');
  value.questions[1].explanation = '甲'.repeat(8000);
  value.questions[2].explanation = '乙'.repeat(8000);
  const before = structuredClone(value.questions);
  assert.throws(() => verify(value), error => error.code === 'EVIDENCE_CONCLUSION_EXPLANATION_TOO_LONG'
    && /削除せず/.test(error.correctionHint));
  assert.deepEqual(value.questions, before);
  assert.equal(reviewedAttributionConclusion([], { groundTruth: {} }, []), null);
});

test('case fact IDs in evidence text are private, while observation wording remains displayable', () => {
  const value = fixture();
  const input = { ...value.agent, groundTruth: { ...value.agent.groundTruth, technicalFacts: [], groundTruthId: 'truth_private' },
    verificationResult: { verificationId: 'verification_private' }, evidenceAgentHandoff: { handoffId: 'handoff_private' },
    evidenceRequirements: { requirements: [] } };
  assert.equal(leakedInternalValue(value.report.publicContent, input), false);
  assert.equal(leakedInternalValue(value.report.publicContent + value.fact.factId, input), true);
});

test('public game and earned evidence project neither caseSupport nor sourceRefs', () => {
  const value = readyGameCaseFixture();
  const internal = value.gameCase.detective.evidence[0];
  internal.caseSupport = fixture().report.caseSupport;
  internal.sourceRefs = fixture().report.sourceRefs;
  const runtime = { mode: 'GENERATED', gameCase: value.gameCase, publicGameCase: projectPublicGameCase(value.gameCase) };
  const session = createGeneratedGame(runtime);
  session.currentState = 'INVESTIGATION';
  session.roundCollectedEvidenceIds = [internal.evidenceId];
  session.wholeDocumentEvidenceIds = [internal.evidenceId];
  assert.doesNotMatch(JSON.stringify(runtime.publicGameCase), /caseSupport|sourceRefs|case_observation_upload/);
  assert.doesNotMatch(JSON.stringify(generatedPlayerView(session, runtime)), /caseSupport|sourceRefs|case_observation_upload/);
  for (const field of ['caseSupport', 'caseFacts', 'sourceRefs']) {
    const publicCase = structuredClone(runtime.publicGameCase);
    publicCase[field] = {};
    assert.throws(() => validatePublicGameCase(publicCase), { code: 'UNKNOWN_FIELD' });
  }
});

test('a case fact ID cannot leak through an existing public string field', () => {
  const value = readyGameCaseFixture();
  const fact = fixture().fact;
  value.conversionInput.scenarioPackage.groundTruth.caseFacts = [fact];
  const publicCase = structuredClone(value.publicGameCase);
  publicCase.detective.investigationActions[0].description += fact.factId;
  assert.throws(() => validatePublicGameCase(publicCase, value.conversionInput),
    { code: 'PUBLIC_GAME_CASE_INTERNAL_ID_LEAK' });
});

test('an evidence title cannot reveal a private case fact ID', () => {
  const value = readyGameCaseFixture();
  const fact = fixture().fact;
  const agent = value.evidenceGenerationInput.evidenceAgentInput;
  agent.groundTruth.caseFacts = [fact];
  value.evidencePackage.evidenceArtifacts[0].title += fact.factId;
  const { issues } = validateEvidenceConsistency(value.evidencePackage, agent);
  assert.ok(issues.some(issue => issue.code === 'GROUND_TRUTH_PUBLIC_LEAK'
    && issue.evidenceId === value.evidencePackage.evidenceArtifacts[0].evidenceId),
    JSON.stringify(issues));
});
