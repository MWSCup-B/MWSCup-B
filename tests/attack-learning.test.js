import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { createSelectionConfiguration } from '../server/generation/scenario-selection.js';
import { validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildScenarioTemplate, validateScenarioEvidenceCoverage } from '../server/generation/scenario-template.js';
import { buildInvestigationStages } from '../server/generation/investigation-registry.js';
import { ATTACK_LEARNING, learningProfile } from '../server/generation/attack-learning.js';
import { validateLearningObservations } from '../server/generation/learning-observations.js';
import { validateCourtQuestionSources } from '../server/generation/court-questions.js';
import { stageEvidenceProblems } from '../server/generation/scenario-stage-plan.js';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

const catalog = await loadCatalog();
const key = ground => `${ground.attackNodeId}/${ground.sourceId}`;

test('every selected attack has an obtainable comparison of its own distinct observation sources', () => {
  const selections = [['phishing'], ['stored_xss'], ['unauthorized_login'], ['clickfix'], ['sql_injection'],
    ['password_spray'], ['ransomware'], ['unrestricted_file_upload'],
    ['phishing', 'unauthorized_login', 'stored_xss'], ['phishing', 'clickfix', 'ransomware'],
    ['password_spray', 'unauthorized_login', 'stored_xss']];
  for (const attackIds of selections) {
    const configuration = createSelectionConfiguration({ schemaVersion: '1.0', attackIds, settingId: 'company' }, catalog);
    const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
    const original = structuredClone({ configuration, generationInput });
    const scenarioPackage = buildScenarioTemplate({ configuration, generationInput });
    const stages = buildInvestigationStages(configuration, generationInput);
    const requirements = scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage);
    for (const [index, requirement] of requirements.entries()) {
      const available = new Set(stages.slice(0, index + 1).flatMap(stage => stage.routes.map(route => key(route.ground))));
      assert.ok(requirement.grounds.every(ground => available.has(key(ground))));
    }
    for (const node of generationInput.technicalInput.attackGraph.nodes) {
      const profile = learningProfile(node, generationInput.technicalInput.attackDefinitions);
      const comparison = requirements.find(requirement => profile.sources.every(sourceId => requirement.grounds
        .some(ground => ground.attackNodeId === node.nodeId && ground.sourceId === sourceId)));
      assert.ok(comparison, node.attackDefinitionId);
      assert.ok(comparison.grounds.length >= 2);
      assert.ok(requirements.some(requirement => requirement.description.includes(profile.comparison)));
    }
    assert.deepEqual(validateScenarioEvidenceCoverage({ configuration, generationInput, scenarioPackage }), []);
    assert.deepEqual({ configuration, generationInput }, original);
    // A later scenario revision cannot quietly remove the earlier comparison record.
    requirements.at(-1).grounds = stages.at(-1).routes.map(route => route.ground);
    assert.ok(validateScenarioEvidenceCoverage({ configuration, generationInput, scenarioPackage })
      .some(issue => issue.code === 'INVESTIGATION_STAGE_PLAN_INVALID'));
  }
});

function artifact(sourceId, publicContent, attackNodeId = 'attack_upload') {
  return { evidenceId: sourceId, title: sourceId, type: 'APPLICATION_LOG', publicContent,
    sourceRefs: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT', attackNodeId, sourceId }] };
}
function uploadRecords() {
  return [artifact('upload_receipt_record', JSON.stringify({ timestamp: '2026-09-18T09:10:00+09:00',
    request_id: 'upload-17', filename: 'document.png', content_type: 'image/png', result: 'stored', storage_id: 'saved-42' })),
  artifact('uploaded_file_record', JSON.stringify({ storage_id: 'saved-42', stored_at: '2026-09-18T09:10:00+09:00',
    hash: 'synthetic-hash-42', detected_type: 'text/plain', content_check: 'disallowed', executable_storage: false }))];
}

test('upload comparison retains declared type, actual inspection and a shared storage ID, without inferring execution', () => {
  const artifacts = uploadRecords(); const original = structuredClone(artifacts);
  validateLearningObservations(artifacts);
  assert.deepEqual(artifacts, original);
  const incomplete = structuredClone(artifacts);
  const row = JSON.parse(incomplete[1].publicContent); delete row.detected_type;
  incomplete[1].publicContent = JSON.stringify(row);
  assert.throws(() => validateLearningObservations(incomplete), { code: 'EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE' });
  const unrelated = structuredClone(artifacts);
  unrelated[1].publicContent = unrelated[1].publicContent.replace('saved-42', 'saved-99');
  assert.throws(() => validateLearningObservations(unrelated), { code: 'EVIDENCE_LEARNING_CORRELATION_MISMATCH' });
  // Two separate attacks must never be joined solely by a shared artifact type.
  unrelated[1].sourceRefs[0].attackNodeId = 'another_attack';
  assert.doesNotThrow(() => validateLearningObservations(unrelated));
});

test('password spray requires observable account distribution, not a one-line conclusion', () => {
  const entry = (account, result, attempt_id) => ({ timestamp: '2026-09-18T09:10:00+09:00',
    account, result, attempt_id, source_ip: '203.0.113.10' });
  const rows = [entry('account-a', 'failure', 'attempt-1'), entry('account-b', 'failure', 'attempt-2'),
    entry('account-c', 'success', 'attempt-3')];
  const records = [artifact('spray_authentication_record', rows.map(row => JSON.stringify(row)).join('\n'))];
  validateLearningObservations(records);
  records[0].publicContent = JSON.stringify(rows[0]);
  assert.throws(() => validateLearningObservations(records), { code: 'EVIDENCE_LEARNING_DISTRIBUTION_MISSING' });
  assert.ok(!JSON.stringify(rows).includes('password'));
});

test('a grounded multi-source explanation may paraphrase observations without repeating every literal value', () => {
  const artifacts = uploadRecords();
  const set = { evidenceArtifacts: artifacts, contradictions: [{ statementRef: 'claim_upload',
    conflictingEvidenceIds: artifacts.map(item => item.evidenceId) }] };
  const agent = { evidenceRequirements: { requirements: [{ investigationStage: { order: 1 } }] },
    characters: { characters: [] }, groundTruth: { technicalFacts: [] }, verificationResult: {},
    evidenceAgentHandoff: {}, attackGraph: {} };
  const question = { schemaVersion: '1.0', statementId: 'claim_upload',
    prompt: 'saved-42の受付記録と内容検査を比べると、何が確認できますか。',
    choices: ['申告はimage/pngだが、同じ保存対象の検査はtext/plainで許可外。保存だけで実行は示さない。',
      '受付時にimage/pngなので、内容検査でも画像として許可されている。',
      '許可外の内容なので、受付で拒否されて保存されなかった。',
      '許可外の内容が保存されたので、コード実行まで確認された。'], correctOptionIndex: 0,
    supportingQuotes: artifacts.map(item => ({ evidenceId: item.evidenceId, quote: item.publicContent })),
    explanation: '保存ID saved-42で照合すると、受付のimage/pngと内容検査のtext/plainが異なる。申告値だけでは内容を検証できない。非実行領域への保存はコード実行を示さない。' };
  assert.doesNotThrow(() => validateCourtQuestionSources([question], set, agent));
  const paraphrased = structuredClone(question);
  paraphrased.prompt = '受付時の申告と保存後の内容検査を比べると、どの解釈が資料に一致しますか。';
  paraphrased.explanation = '同じ保存対象について、受付では画像と申告されていますが、検査は許可外のテキストを示します。申告と実際の内容は別です。非実行領域への保存はコード実行を示しません。';
  assert.doesNotThrow(() => validateCourtQuestionSources([paraphrased], set, agent));
  paraphrased.supportingQuotes[0].quote = '原文にはない内容';
  assert.throws(() => validateCourtQuestionSources([paraphrased], set, agent), { code: 'EVIDENCE_QUESTION_QUOTE_MISMATCH' });
});

for (const defect of ['missing_observations', 'fabricated_quote', 'duplicate_choices', 'single_source']) {
  test(`automatic generation blocks ${defect} after the bounded repair attempts`, async () => {
    class IncompleteRunner extends MockCodexRunner {
      async runJson(args) {
        const draft = await super.runJson(args);
        if (args.phase !== 'GENERATING_EVIDENCE') return draft;
        if (defect === 'missing_observations') {
          draft.evidenceArtifacts.find(item => item.type === 'WEB_ACCESS_LOG').publicContent = '{"event":"attack-detected"}';
        } else if (defect === 'fabricated_quote') {
          draft.courtQuestions[0].supportingQuotes[0].quote = '資料に存在しない引用';
        } else if (defect === 'duplicate_choices') {
          draft.courtQuestions[0].choices[1] = draft.courtQuestions[0].choices[0];
        } else {
          const lastClaim = draft.evidenceArtifacts.filter(item => item.type === 'TESTIMONY')
            .flatMap(item => item.testimony.statements).filter(item => item.technicalAssessment === 'CONTRADICTED').at(-1).statementId;
          const rule = draft.contradictions.find(item => item.statementRef === lastClaim);
          rule.conflictingEvidenceIds = rule.conflictingEvidenceIds.slice(0, 1);
        }
        return draft;
      }
    }
    const runner = new IncompleteRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
    const session = createAutoAuthorSession();
    manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['phishing'], settingId: 'company' });
    await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
    assert.equal(session.auto.state, 'FAILED');
    assert.equal(session.runtime, null);
    assert.equal(runner.evidenceCalls, 2);
    const code = { missing_observations: 'EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE',
      fabricated_quote: 'EVIDENCE_QUESTION_QUOTE_MISMATCH', duplicate_choices: 'EVIDENCE_QUESTION_DUPLICATE_CHOICE',
      single_source: 'INVESTIGATION_LEARNING_COMPARISON_MISSING' }[defect];
    assert.ok(session.auto.details.some(item => item.code === code), JSON.stringify(session.auto.details));
  });
}

test('the comparison gate rejects a single artifact pretending to supply every source', () => {
  const requirements = { evidenceRequirements: { requirements: [{ investigationStage: { targetId: 'target_1', order: 1 },
    grounds: ['upload_receipt_record', 'uploaded_file_record'].map(sourceId =>
      ({ sourceType: 'ATTACK_GRAPH_ARTIFACT', attackNodeId: 'attack_upload', sourceId })) }] } };
  const evidenceSet = { evidenceArtifacts: [{ ...uploadRecords()[0], sourceRefs: requirements.evidenceRequirements.requirements[0].grounds },
    { type: 'TESTIMONY', testimony: { statements: [{ statementId: 'claim_upload', technicalAssessment: 'CONTRADICTED' }] } }],
  contradictions: [{ statementRef: 'claim_upload', conflictingEvidenceIds: ['upload_receipt_record'] }] };
  assert.equal(stageEvidenceProblems(evidenceSet, requirements)[0].code, 'INVESTIGATION_LEARNING_COMPARISON_MISSING');
});
