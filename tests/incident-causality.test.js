import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../server/generation/catalog.js';
import { createSelectionConfiguration } from '../server/generation/scenario-selection.js';
import { createDefaultConfiguration, validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildScenarioTemplate, validateScenarioDesignBoundary } from '../server/generation/scenario-template.js';
import { buildIncidentConclusion } from '../server/generation/incident-conclusion.js';
import { buildIncidentOverview } from '../server/generation/incident-report.js';
import { buildIncidentNarratives, groundIncidentQuestionExplanations } from '../server/generation/incident-design.js';
import { buildCaseStudy } from '../server/generation/material-investigation.js';
import { validateLearningObservations } from '../server/generation/learning-observations.js';
import { validateGeneratedLogFormats, validateExplorableWebLogs } from '../server/generation/evidence-log-format.js';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated } from '../server/generated-game.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

const catalog = await loadCatalog();
test('all registered attacks separate private incident truth from the player-facing reasonable doubt', () => {
  for (const definition of catalog) {
    const profile = definition.incidentNarrative;
    assert.ok(profile, `${definition.id}: incidentNarrative`);
    assert.match(profile.attackerAction, /別の攻撃者/, `${definition.id}: attackerAction`);
    assert.match(profile.allegation, /検察側/, `${definition.id}: allegation`);
    assert.match(profile.prosecutionKnowledge, /検察側/, `${definition.id}: prosecutionKnowledge`);
    assert.match(profile.verdictBasis, /可能性を排除できない/, `${definition.id}: verdictBasis`);
    assert.match(profile.verdictBasis, /第三者が実行したと断定.*しない/, `${definition.id}: verdictBasis`);
    assert.doesNotMatch(profile.verdictBasis, /調査報告|直接観察/, `${definition.id}: verdictBasis`);
  }
});

test('incident narratives use explicit and natural Japanese for records and identities', () => {
  const ambiguous = /利用セッションに記録|成功試行|利用アカウント|主体で記録|アプリケーション主体|セッション受入れ|識別子の下で|一続き|に連なる実行記録|共有DB接続主体|スクリプトを開始元|資格情報持出し|外部持出し/;
  for (const definition of catalog) {
    const text = Object.values(definition.incidentNarrative ?? {}).filter(value => typeof value === 'string').join('\n');
    assert.doesNotMatch(text, ambiguous, definition.id);
    assert.doesNotMatch(text, /スクリプトが被告人のセッションで実行/, `${definition.id}: browser execution and web session`);
  }
});

for (const attackIds of [['stored_xss'], ['sql_injection'], ['phishing', 'unauthorized_login', 'stored_xss']]) {
  test(`new ${attackIds.join('/')} games ground concrete harm, acquire all causal records and keep answers private`, async () => {
    const runner = new MockCodexRunner();
    const runJson = runner.runJson.bind(runner);
    let submittedQuestions;
    runner.runJson = async args => {
      const output = await runJson(args);
      if (output.courtQuestions) submittedQuestions = structuredClone(output.courtQuestions);
      return output;
    };
    const manager = new AutoGenerationManager({ jsonRunner: runner });
    const session = createAutoAuthorSession();
    manager.submitSelection(session, { schemaVersion: '1.0', attackIds, settingId: 'company' });
    await manager.waitForIdle();
    assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(session.auto.details));
    const pkg = session.scenarioPackage;
    assert.ok(pkg.groundTruth.incidentNarratives.length);
    const narrative = pkg.groundTruth.incidentNarratives[0];
    assert.notEqual(narrative.attackerCharacterId, narrative.defendantCharacterId);
    assert.match(narrative.attackerAction, /別の攻撃者/);
    assert.match(narrative.prosecutionKnowledge, /検察側/);
    assert.match(narrative.verdictBasis, /無罪/);
    const stages = pkg.evidenceRequirements.requirements.filter(item => item.investigationStage);
    for (const incident of pkg.groundTruth.incidentNarratives) {
      const completed = stages.filter(stage => stage.grounds.some(ref => ref.attackNodeId === incident.attackNodeId)).at(-1);
      assert.match(completed.investigationStage.claim, /被告人/);
      assert.ok(completed.grounds.every(ref => ref.attackNodeId === incident.attackNodeId));
      for (const id of incident.requiredArtifactIds) assert.ok(completed.grounds.some(ref => ref.sourceId === id), id);
    }
    assert.doesNotMatch(buildIncidentOverview(session.configuration), /SQL|XSS|スクリプト|具体的な手口|これから/);
    const conclusion = buildIncidentConclusion(session.configuration, session.generationInput);
    assert.match(conclusion, /第三者による操作.*可能性を排除でき/);
    assert.doesNotMatch(conclusion, /(?:第三者|別の攻撃者)が実行した(?:。|ことが確認|と認定)/);
    assert.ok(conclusion.includes(narrative.impact));
    manager.approve(session); await manager.waitForIdle();
    assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
    const study = buildCaseStudy(session.runtime);
    const finalQuestion = session.runtime.gameCase.progression.courtIssues
      .filter(issue => issue.question).at(-1).question;
    assert.equal(study.issues.at(-1).explanation,
      submittedQuestions.find(question => question.statementId === finalQuestion.statementId).explanation);
    assert.doesNotMatch(study.issues.at(-1).explanation,
      /その処理を被告人が行ったと判断できない|送信者の氏名や未記録の入力本文/);
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

test('reviewed explanations remain unchanged instead of importing private incident conclusions', () => {
  const questions = [{ statementId: 'first', explanation: '取得した資料の対象と時刻を確認する。' },
    { statementId: 'final', explanation: '要求の開始元と受理記録を照合した結果を説明する。' }];
  const before = structuredClone(questions);
  const privateNarratives = [{ attackerAction: '未提示の人物が操作したという非公開設定。',
    prosecutionKnowledge: '未提示の検察設定。', causalRefutation: '未裏付けの因果断定。',
    verdictBasis: '未裏付けの判決理由。' }];
  for (const finalStatementId of ['final', 'missing', null]) {
    const result = groundIncidentQuestionExplanations(questions, privateNarratives, finalStatementId);
    assert.deepEqual(result, before);
    assert.notEqual(result, questions);
    assert.notEqual(result[1], questions[1]);
    assert.doesNotMatch(JSON.stringify(result), /未提示|未裏付け/);
  }
  assert.deepEqual(questions, before);
  assert.deepEqual(groundIncidentQuestionExplanations([], privateNarratives), []);
});

test('incident narrative can be added through attack metadata without an attack-id branch', () => {
  const definition = { id: 'future_attack', incidentNarrative: {
    impactEffectPredicate: 'verified_harm', requiredArtifactIds: ['record_a', 'record_b'],
    attackerAction: '別の攻撃者が検証済みの操作を行った。', impact: '検証済みの被害が発生した。',
    allegation: '検察側は被告人の処理だと主張した。', prosecutionKnowledge: '検察側は被害だけを把握した。',
    causalRefutation: '二つの資料から別の攻撃経路を確認した。',
    verdictBasis: '別の攻撃者による経路は検察側の説明と両立せず、弁護側が被告人に無罪判決を求める根拠となる。' } };
  const graph = { nodes: [{ nodeId: 'attack_future', attackDefinitionId: 'future_attack', state: 'SATISFIED',
    effects: [{ effectId: 'effect_future', predicate: 'verified_harm' }], artifactEvaluations: [
      { artifactId: 'record_a', state: 'SATISFIED' }, { artifactId: 'record_b', state: 'SATISFIED' }] }] };
  const narratives = buildIncidentNarratives({ incidentDesign: 'ATTACK_CAUSED_HARM_V1' }, graph, [definition]);
  assert.equal(narratives.length, 1);
  assert.equal(narratives[0].attackerAction, definition.incidentNarrative.attackerAction);
  assert.deepEqual(narratives[0].requiredArtifactIds, ['record_a', 'record_b']);
  assert.throws(() => buildIncidentNarratives({ incidentDesign: 'ATTACK_CAUSED_HARM_V1' }, graph,
    [{ id: 'future_attack' }]), { code: 'INCIDENT_NARRATIVE_MISSING' });
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
