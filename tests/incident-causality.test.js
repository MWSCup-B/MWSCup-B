import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { createSelectionConfiguration } from '../server/generation/scenario-selection.js';
import { createDefaultConfiguration, validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildScenarioTemplate, validateScenarioDesignBoundary } from '../server/generation/scenario-template.js';
import { buildIncidentConclusion } from '../server/generation/incident-conclusion.js';
import { buildIncidentOverview } from '../server/generation/incident-report.js';
import { validateLearningObservations } from '../server/generation/learning-observations.js';
import { validateGeneratedLogFormats, validateExplorableWebLogs } from '../server/generation/evidence-log-format.js';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated } from '../server/generated-game.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

const catalog = await loadCatalog();
for (const attackIds of [['stored_xss'], ['sql_injection'], ['phishing', 'unauthorized_login', 'stored_xss']]) {
  test(`new ${attackIds.join('/')} games ground concrete harm, acquire all causal records and keep answers private`, async () => {
    const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
    const session = createAutoAuthorSession();
    manager.submitSelection(session, { schemaVersion: '1.0', attackIds, settingId: 'company' });
    await manager.waitForIdle();
    assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(session.auto.details));
    const pkg = session.scenarioPackage;
    assert.ok(pkg.groundTruth.incidentNarratives.length);
    const narrative = pkg.groundTruth.incidentNarratives[0];
    assert.notEqual(narrative.attackerCharacterId, narrative.defendantCharacterId);
    const final = pkg.evidenceRequirements.requirements.filter(item => item.investigationStage).at(-1);
    assert.match(final.investigationStage.claim, /被告人.*手動|被告人.*直接/);
    for (const id of narrative.requiredArtifactIds) assert.ok(final.grounds.some(ref => ref.sourceId === id), id);
    assert.doesNotMatch(buildIncidentOverview(session.configuration), /SQL|XSS|スクリプト|具体的な手口|これから/);
    const conclusion = buildIncidentConclusion(session.configuration, session.generationInput);
    assert.match(conclusion, /別の攻撃主体|別の攻撃者/);
    assert.ok(conclusion.includes(narrative.impact));
    manager.approve(session); await manager.waitForIdle();
    assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
    const artifacts = session.evidenceImportResult.evidenceSet.evidenceArtifacts;
    validateGeneratedLogFormats(artifacts); validateExplorableWebLogs(artifacts); validateLearningObservations(artifacts);
    if (attackIds.length === 1 && attackIds[0] === 'stored_xss') {
      const accepted = structuredClone(artifacts);
      for (const [id, key, value] of [['browser_execution_record', 'execution_result', 'script_executed'],
        ['announcement_audit_record', 'result', 'accepted']]) {
        const item = accepted.find(item => item.sourceRefs.some(ref => ref.sourceId === id));
        item.publicContent = item.publicContent.split('\n').map(line => {
          const row = JSON.parse(line); row[key] = value; return JSON.stringify(row);
        }).join('\n');
      }
      assert.doesNotThrow(() => validateLearningObservations(accepted));
      const post = accepted.find(item => item.sourceRefs.some(ref => ref.sourceId === 'announcement_audit_record'));
      post.publicContent = post.publicContent.replaceAll('"accepted"', '"failed"');
      assert.throws(() => validateLearningObservations(accepted), { code: 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING' });
    }
    const opening = actGenerated(createGeneratedGame(session.runtime), session.runtime, { action: 'begin' });
    assert.equal(opening.currentState, 'INITIAL_COURT');
    assert.doesNotMatch(JSON.stringify(opening), /incidentNarratives|causalRefutation|character_attacker|correctOptionIndex|groundTruthRefs/);
    assert.ok(!JSON.stringify(opening).includes(narrative.causalRefutation));
    const broken = structuredClone(artifacts);
    const sourceId = attackIds.includes('sql_injection') ? 'application_response_record' : 'browser_request_initiator_record';
    const victim = broken.find(item => item.sourceRefs.some(ref => ref.sourceId === sourceId));
    victim.publicContent = victim.publicContent.split('\n').map(line => {
      const row = JSON.parse(line); row.request_id = 'unrelated-request'; return JSON.stringify(row);
    }).join('\n');
    assert.throws(() => validateLearningObservations(broken), { code: 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING' });
  });
}

test('legacy SQL scenarios do not require a search range or harm that the attack graph never guaranteed', () => {
  const configuration = createDefaultConfiguration({ attackIds: ['sql_injection'] });
  const { technical, errors } = validateScenarioConfiguration(configuration, catalog);
  assert.deepEqual(errors, []);
  const pkg = buildScenarioTemplate({ configuration, generationInput: technical.generationInput });
  assert.equal(pkg.groundTruth.incidentNarratives, undefined);
  const cli = structuredClone(pkg); cli.groundTruth.incidentNarratives = null;
  assert.doesNotThrow(() => validateScenarioDesignBoundary(pkg, cli));
  const stage = pkg.evidenceRequirements.requirements.filter(item => item.investigationStage).at(-1).investigationStage;
  assert.match(stage.claim, /入力は値としてだけ|SQL.*構造/);
  assert.doesNotMatch(stage.claim, /指定された一つ|非公開レコード|漏えい/);
  assert.match(stage.expectedInference, /構造/);
});

test('obsolete browser wording is repaired without rewriting evidence records', async () => {
  class WordingRunner extends MockCodexRunner {
    attempts = 0;
    async runJson(args) {
      const draft = await super.runJson(args);
      if (args.phase === 'GENERATING_EVIDENCE' && ++this.attempts === 1)
        draft.evidenceArtifacts.find(item => item.type !== 'TESTIMONY').title = 'ブラウザ実行計測';
      return draft;
    }
  }
  const runner = new WordingRunner(), manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['stored_xss'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
  assert.equal(runner.attempts, 2);
  assert.ok(session.auto.details.some(item => item.code === 'EVIDENCE_PRESENTATION_TERMINOLOGY'));
});

test('SQL request and query IDs must match the same pair, not unrelated rows', () => {
  const artifact = (sourceId, rows) => ({ type: 'APPLICATION_LOG', publicContent: rows.map(JSON.stringify).join('\n'),
    sourceRefs: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT', sourceId, attackNodeId: 'sql' }] });
  const artifacts = [
    artifact('web_access_record', [{ timestamp: '2026-09-18T09:10:00Z', request_target: '/search', request_id: 'r1' }]),
    artifact('database_statement_record', [{ request_id: 'r1', query_id: 'q2', statement: 'SELECT title FROM reports' },
      { request_id: 'r2', query_id: 'q1', statement: 'SELECT title FROM reports' }]),
    artifact('application_response_record', [{ timestamp: '2026-09-18T09:10:00Z', request_id: 'r1', query_id: 'q1', record_refs: ['row1'], status: 200 }]),
  ];
  assert.throws(() => validateLearningObservations(artifacts), { code: 'EVIDENCE_LEARNING_CAUSAL_CHAIN_MISSING' });
});
