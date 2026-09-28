import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCatalog } from '../server/generation/catalog.js';
import { buildScenarioPreview, createDefaultConfiguration,
  normalizeScenarioConfiguration, validateScenarioConfiguration }
  from '../server/generation/scenario-configuration.js';
import { buildInvestigationAssignments, INVESTIGATION_BUILDERS }
  from '../server/generation/investigation-registry.js';
import { assignDialogueTemplate, COURT_DIALOGUE_TEMPLATE }
  from '../server/generation/dialogue-template.js';
import { AutoGenerationManager, autoAuthorBootstrap, autoAuthorView, createAutoAuthorSession }
  from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated, generatedPlayerView } from '../server/generated-game.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { currentCorrectPair, collectCurrentTarget, enterCurrentCourt, inspectMaterial } from './helpers/court-issues.js';
import { buildScenarioTemplate, validateScenarioEvidenceCoverage }
  from '../server/generation/scenario-template.js';
import { importScenarioPackage } from '../server/generation/scenario-interface.js';
import { importEvidencePackage } from '../server/generation/evidence-interface.js';
import { phase7Fixture } from './helpers/phase7-evidence.js';

const catalog = await loadCatalog();

test('詳細設定の初期プリセットは指定のフィッシング・Network・日時・証拠の答えを保持する', () => {
  const bootstrap = autoAuthorBootstrap();
  const preset = bootstrap.defaultManualConfiguration;
  assert.equal(preset.mode, 'MANUAL');
  assert.equal(preset.difficulty, 1);
  assert.equal(preset.evidenceCount, 1);
  assert.equal(preset.incidentContext.incidentDate, '2026-09-18');
  assert.deepEqual(preset.network, bootstrap.defaultNetwork);
  assert.deepEqual(['subnets', 'nodes', 'services', 'connections'].map(key => preset.network[key].length),
    [2, 5, 4, 5]);
  assert.equal(preset.attacks.length, 1);
  assert.deepEqual(preset.attacks[0], {
    attackId: 'phishing', order: 1, occurrenceTime: '2026-09-18T09:10:00+09:00',
    sourceNodeId: 'sender-host', targetNodeId: 'web-host', targetServiceId: 'web-service',
    investigationTypes: ['EMAIL'], investigationSourceNodeId: 'mail-host',
    evidenceAnswer: 'メール文のリンク先と実際に遷移するリンク先が異なること',
    expectedEffect: 'この利用者・ブラウザ・Webサービス・リクエストに限定したアクセス。認証情報取得やコード実行を意味しない。',
    notes: '',
  });
  const before = structuredClone(preset);
  const validation = validateScenarioConfiguration(preset, catalog);
  assert.equal(validation.status, 'VALID', JSON.stringify(validation.errors));
  const generationInput = validation.technical.generationInput;
  const scenarioPackage = buildScenarioTemplate({ configuration: preset, generationInput });
  assert.equal(importScenarioPackage({ generationInput, scenarioPackage }).status, 'VALID');
  assert.deepEqual(validateScenarioEvidenceCoverage({ configuration: preset, generationInput, scenarioPackage }), []);
  assert.match(scenarioPackage.evidenceRequirements.requirements
    .find(item => item.requirementId === 'requirement_attack').description, /保存メールに記載された誘導内容・リンク/);
  assert.deepEqual(preset, before);
});

test('初期プリセットの編集が他のAuthorや既存Configuration builderへ波及しない', () => {
  const first = autoAuthorBootstrap();
  first.defaultManualConfiguration.network.nodes[0].label = '利用者の変更';
  first.defaultManualConfiguration.attacks[0].evidenceAnswer = '';
  assert.equal(first.defaultNetwork.nodes[0].label, '外部送信元');
  const next = autoAuthorBootstrap().defaultManualConfiguration;
  assert.equal(next.network.nodes[0].label, '外部送信元');
  assert.equal(next.attacks[0].evidenceAnswer, 'メール文のリンク先と実際に遷移するリンク先が異なること');
  assert.equal(createDefaultConfiguration().attacks[0].attackId, 'reflected_xss');
});

test('未初期化UI相当のnetwork:nullを補完せずfieldとreceived type付きで拒否する', () => {
  const configuration = autoAuthorBootstrap().defaultManualConfiguration;
  configuration.network = null;
  const result = validateScenarioConfiguration(normalizeScenarioConfiguration(configuration, catalog), catalog);
  assert.equal(result.status, 'INVALID');
  assert.equal(result.errors[0].code, 'INVALID_TYPE');
  assert.equal(result.errors[0].field, 'scenario-configuration.network');
  assert.equal(result.errors[0].receivedType, 'null');
  assert.equal(configuration.network, null);
});

test('Phishing ★1でもメールとWeb記録を全論証の根拠とし、取得経路と主張の対象を明示する', () => {
  const configuration = createDefaultConfiguration({ difficulty: 1, attackIds: ['phishing'] });
  const before = structuredClone(configuration);
  const validation = validateScenarioConfiguration(configuration, catalog);
  assert.equal(validation.status, 'VALID');
  const generationInput = validation.technical.generationInput;
  const scenarioPackage = buildScenarioTemplate({ configuration, generationInput });
  assert.equal(importScenarioPackage({ generationInput, scenarioPackage }).status, 'VALID');
  for (const purpose of ['ATTACK_TRACE', 'TIMELINE_PROOF', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF']) {
    const grounds = scenarioPackage.evidenceRequirements.requirements
      .filter(item => item.purpose === purpose).flatMap(item => item.grounds);
    for (const sourceId of ['email_record', 'web_access_record']) assert.ok(grounds.some(ground =>
      ground.sourceType === 'ATTACK_GRAPH_ARTIFACT' && ground.sourceId === sourceId), purpose);
  }
  const requirements = scenarioPackage.evidenceRequirements.requirements;
  assert.match(requirements.find(item => item.requirementId === 'requirement_timeline').description,
    /narrativeTimestampsは架空の表示時刻/);
  assert.match(requirements.find(item => item.requirementId === 'requirement_contradiction').description,
    /character_witnessによる資料の解釈を基に、character_defendantを対象/);
  const observations = requirements.filter(item => item.requirementId.startsWith('requirement_observation_'));
  assert.equal(observations.length, 2);
  assert.match(observations.find(item => item.grounds[0].sourceId === 'email_record').description,
    /mail-host.*EMAIL.*action_check_email/);
  assert.match(observations.find(item => item.grounds[0].sourceId === 'web_access_record').description,
    /web-host.*WEB_LOG.*action_audit_log/);
  assert.ok(scenarioPackage.characters.characters.every(item => item.bindingRefs.length === 0));
  assert.deepEqual(configuration, before);
});

test('RevisionがWeb記録の根拠を削除した場合はReview前に不足として差し戻す', () => {
  const configuration = createDefaultConfiguration({ attackIds: ['phishing'] });
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  const scenarioPackage = buildScenarioTemplate({ configuration, generationInput });
  for (const requirement of scenarioPackage.evidenceRequirements.requirements) {
// 2026-09-20 修正前: 回帰テストで全Web根拠を削除した状況を正しく作る
//     if (requirement.requirementId.startsWith('requirement_observation_')) continue;
// 2026-09-20 修正後: 回帰テストで全Web根拠を削除した状況を正しく作る
    // 個別の観測要件も含めて削除し、全4目的で不足するケースを再現する。
    requirement.grounds = requirement.grounds.filter(item => item.sourceId !== 'web_access_record');
  }
  const issues = validateScenarioEvidenceCoverage({ configuration, generationInput, scenarioPackage });
  // ATTACK_TRACE remains covered by the untouched observation requirement.
  assert.deepEqual(issues.filter(item => item.code === 'INVESTIGATION_COVERAGE_INCOMPLETE')
    .map(item => item.reason.split('に')[0]),
// 2026-09-24 修正前: 統合前の契約。
//     ['TIMELINE_PROOF', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF']);
// 2026-09-24 修正後: main制作画面・初回設計とkawata-workのゲーム生成を統合。
    ['ATTACK_TRACE', 'TIMELINE_PROOF', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF']);
  assert.ok(issues.some(item => item.code === 'INVESTIGATION_STAGE_PLAN_INVALID'));
});

test('Web記録の取得元Log Sourceがない場合は補完せず停止する', () => {
  const configuration = createDefaultConfiguration({ attackIds: ['phishing'] });
  configuration.network.nodes.find(item => item.nodeId === 'web-host').logSources = [];
  const generationInput = validateScenarioConfiguration(configuration, catalog).technical.generationInput;
  assert.throws(() => buildScenarioTemplate({ configuration, generationInput }),
    { code: 'EVIDENCE_SOURCE_UNAVAILABLE' });
});

test('Scenario ConfigurationはAttack 1個と因果関係のある2個を受理する', () => {
  const single = validateScenarioConfiguration(createDefaultConfiguration(), catalog);
  assert.equal(single.status, 'VALID'); assert.equal(single.technical.attackGraphResult.graphs[0].structure, 'SINGLE');
  const chain = validateScenarioConfiguration(createDefaultConfiguration({ difficulty: 2,
    attackIds: ['phishing', 'reflected_xss'] }), catalog);
  assert.equal(chain.status, 'VALID'); assert.equal(chain.technical.attackGraphResult.graphs[0].structure, 'LINEAR');
});

test('Manual raw inputを一箇所でcanonical IDとdate-timeへ正規化する', () => {
  const raw = createDefaultConfiguration();
  raw.network.nodes.find(item => item.nodeId === 'web-host').label = 'Web Server';
  const attack = raw.attacks[0];
  attack.attackId = '反射型XSS';
  attack.occurrenceTime = '2026-01-15T10:30';
  attack.sourceNodeId = '利用者端末';
  attack.targetNodeId = 'Web Server';
  attack.targetServiceId = 'Web Application';
  attack.investigationTypes = ['Webアクセスログ'];
  attack.investigationSourceNodeId = 'Web Server';
  const normalized = normalizeScenarioConfiguration(raw, catalog);
  assert.equal(normalized.attacks[0].attackId, 'reflected_xss');
  assert.equal(normalized.attacks[0].occurrenceTime, '2026-01-15T10:30:00+09:00');
  assert.equal(normalized.attacks[0].sourceNodeId, 'client-host');
  assert.equal(normalized.attacks[0].targetNodeId, 'web-host');
  assert.equal(normalized.attacks[0].targetServiceId, 'web-service');
  assert.deepEqual(normalized.attacks[0].investigationTypes, ['WEB_LOG']);
  assert.equal(normalized.attacks[0].investigationSourceNodeId, 'web-host');
  assert.equal(validateScenarioConfiguration(normalized, catalog).status, 'VALID');
});

test('Manual INVALID_STRINGは値を漏らさずfieldとSchema制約を報告する', () => {
  const configuration = createDefaultConfiguration();
  configuration.attacks[0].evidenceAnswer = '';
  const result = validateScenarioConfiguration(configuration, catalog);
  assert.equal(result.status, 'INVALID');
  assert.deepEqual(result.errors[0], {
    code: 'INVALID_STRING', field: 'scenario-configuration.attacks[0].evidenceAnswer',
    reason: '文字列の長さまたは形式が不正です。',
    correctionHint: '入力欄を確認し、定義済みの値を選択してください。',
    receivedType: 'string', length: 0, expectedMinLength: 1,
    expectedMaxLength: 1000, expectedPattern: null, expectedFormat: null,
  });
  assert.ok(!Object.hasOwn(result.errors[0], 'receivedValue'));
});

test('Manualはtimezoneなしの不正なoccurrenceTimeと未知IDを拒否する', () => {
  let configuration = createDefaultConfiguration();
  configuration.attacks[0].occurrenceTime = '2026-01-15T10:30';
  let result = validateScenarioConfiguration(configuration, catalog);
  assert.equal(result.errors[0].field, 'scenario-configuration.attacks[0].occurrenceTime');
  assert.equal(result.errors[0].expectedFormat, 'date-time');
  configuration = createDefaultConfiguration();
  configuration.attacks[0].targetNodeId = 'missing-node';
  result = validateScenarioConfiguration(configuration, catalog);
  assert.ok(result.errors.some(item => item.code === 'TARGET_SERVICE_MISMATCH'
    || item.code === 'BROKEN_REFERENCE'));
});

// 2026-09-20 修正前: 許可された独立攻撃と不正な重複を分けて検証
// test('Attack 3個の無関係な並置と4個目を拒否する', () => {
//   const three = createDefaultConfiguration({ difficulty: 3,
//     attackIds: ['phishing', 'reflected_xss', 'sql_injection'] });
//   let result = validateScenarioConfiguration(three, catalog);
//   assert.equal(result.status, 'INVALID'); assert.equal(result.errors[0].code, 'INVALID_ATTACK_COMBINATION');
//   const four = structuredClone(three); four.attacks.push({ ...four.attacks[2], attackId: 'reflected_xss', order: 3 });
//   result = validateScenarioConfiguration(four, catalog);
//   assert.equal(result.status, 'INVALID'); assert.ok(result.errors.some(item => item.code === 'INVALID_COUNT'));
// });
//
// 2026-09-20 修正後: 許可された独立攻撃と不正な重複を分けて検証
test('独立成分を含む3攻撃を受理し、重複した攻撃は拒否する', () => {
  const three = createDefaultConfiguration({ difficulty: 3,
    attackIds: ['phishing', 'reflected_xss', 'sql_injection'] });
  let result = validateScenarioConfiguration(three, catalog);
  assert.equal(result.status, 'VALID');
  assert.equal(result.technical.generationInput.technicalInput.attackGraph.components.length, 2);
  const duplicate = structuredClone(three); duplicate.attacks.push({ ...duplicate.attacks[2], order: 4 });
  result = validateScenarioConfiguration(duplicate, catalog);
  assert.equal(result.status, 'INVALID'); assert.ok(result.errors.some(item => item.code === 'DUPLICATE_VALUE'));
});

test('Occurrence Time、Investigation support、Log Sourceを決定論的に検証する', () => {
  const configuration = createDefaultConfiguration({ difficulty: 2,
    attackIds: ['phishing', 'reflected_xss'] });
  configuration.attacks[1].occurrenceTime = configuration.attacks[0].occurrenceTime;
  let result = validateScenarioConfiguration(configuration, catalog);
  assert.ok(result.errors.some(item => item.code === 'INVALID_TIME_ORDER'));
  configuration.attacks[1].occurrenceTime = '2026-01-15T09:30:00+09:00';
  configuration.attacks[1].investigationTypes = ['EMAIL'];
  result = validateScenarioConfiguration(configuration, catalog);
  assert.ok(result.errors.some(item => item.code === 'UNSUPPORTED_INVESTIGATION'));
  configuration.attacks[1].investigationTypes = ['WEB_LOG'];
  configuration.attacks[1].investigationSourceNodeId = 'client-host';
  result = validateScenarioConfiguration(configuration, catalog);
  assert.ok(result.errors.some(item => item.code === 'INVESTIGATION_SOURCE_UNAVAILABLE'));
  configuration.attacks[1].investigationSourceNodeId = 'web-host';
  configuration.attacks[1].expectedEffect = '定義にない権限昇格が起きる。';
  result = validateScenarioConfiguration(configuration, catalog);
  assert.ok(result.errors.some(item => item.code === 'UNSUPPORTED_EXPECTED_EFFECT'));
  configuration.attacks[1].expectedEffect = createDefaultConfiguration({ difficulty: 2,
    attackIds: ['phishing', 'reflected_xss'] }).attacks[1].expectedEffect;
  configuration.attacks[1].evidenceAnswer = '答え：';
  result = validateScenarioConfiguration(configuration, catalog);
  assert.ok(result.errors.some(item => item.code === 'EMPTY_EVIDENCE_ANSWER'));
});

test('NetworkのCIDR、IP、Trust Boundary、Connection参照を決定論的に検証する', () => {
  const configuration = createDefaultConfiguration();
  configuration.network.subnets[0].cidr = 'not-a-cidr';
  configuration.network.nodes[0].ip = '999.1.1.1';
  configuration.network.nodes[1].trustBoundaryId = 'external';
  configuration.network.connections.push({ fromNodeId: 'missing-node', toNodeId: 'web-host' });
  const result = validateScenarioConfiguration(configuration, catalog);
  for (const code of ['INVALID_CIDR', 'INVALID_IP_ADDRESS', 'TRUST_BOUNDARY_MISMATCH',
    'BROKEN_REFERENCE']) assert.ok(result.errors.some(item => item.code === code), code);
});

// 2026-09-24 修正前: 統合前の契約。
// test('互換ConfigurationのNetworkを維持し、新UIはPreviewの構成図だけ表示する', async () => {
//   const configuration = createDefaultConfiguration();
//   const preview = buildScenarioPreview(configuration);
//   assert.equal(preview.network.subnets.length, 2); assert.equal(preview.network.nodes[0].ip, '203.0.113.10');
//   const html = await readFile(new URL('../public/author.html', import.meta.url), 'utf8');
//   const source = await readFile(new URL('../public/author.js', import.meta.url), 'utf8');
//   assert.doesNotMatch(html, /Subnet追加|Node追加|Service追加/);
//   assert.match(html, /教材の前提条件を確認/);
//   assert.match(html, /detail-list/); assert.match(source, /Expected minLength/);
//   assert.match(html, /preview-network-diagram/); assert.match(source, /createElementNS/);
//   assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
// });
// 2026-09-24 修正後: main制作画面・初回設計とkawata-workのゲーム生成を統合。
// 2026-09-24 修正前: 自由入力UI。
// test('Network manual configurationとPreview用SVG UIを提供する', async () => {
//   const configuration = createDefaultConfiguration();
//   const preview = buildScenarioPreview(configuration);
//   assert.equal(preview.network.subnets.length, 2); assert.equal(preview.network.nodes[0].ip, '203.0.113.10');
//   const html = await readFile(new URL('../public/author.html', import.meta.url), 'utf8');
//   const source = await readFile(new URL('../public/author.js', import.meta.url), 'utf8');
//   assert.match(html, /Subnet追加/); assert.match(html, /Node追加/); assert.match(html, /Service追加/);
//   assert.match(source, /証拠から導く答え/);
//   assert.match(html, /manual-detail-list/); assert.match(source, /Expected minLength/);
//   assert.match(html, /manual-network-diagram/); assert.match(source, /createElementNS/);
//   assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
// });
//
// 2026-09-24 修正後: 攻撃と舞台のみ入力。
test('Networkは自動構成しPreviewにmainのSVGを表示する', async () => {
  const configuration = createDefaultConfiguration();
  assert.deepEqual(buildScenarioPreview(configuration).network, configuration.network);
  const html = await readFile(new URL('../public/author.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/author.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /Subnet追加|Node追加|Service追加/);
  assert.match(html, /preview-network-diagram/); assert.match(source, /renderNetworkDiagram/);
  const diagram = await readFile(new URL('../public/network-diagram.js', import.meta.url), 'utf8');
  assert.match(diagram, /createElementNS/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
});

test('攻撃別Investigation RegistryはAttack Definition外を生成しない', () => {
  assert.deepEqual(Object.keys(INVESTIGATION_BUILDERS).sort(),
    ['phishing', 'reflected_xss', 'sql_injection']);
  const configuration = createDefaultConfiguration({ difficulty: 2,
    attackIds: ['phishing', 'reflected_xss'] });
  const assignments = buildInvestigationAssignments(configuration);
  assert.deepEqual(assignments.map(item => item.attackId), ['phishing', 'reflected_xss']);
  assert.deepEqual(assignments[0].investigationTypes, ['EMAIL']);
});

test('Manualは独立検証後のPreviewで停止しUser Approval前にEvidenceへ進まない', async () => {
  const runner = new MockCodexRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession(); manager.submitManual(session,
    createDefaultConfiguration({ difficulty: 2, attackIds: ['phishing', 'reflected_xss'] }));
  await manager.waitForIdle(); let view = autoAuthorView(session);
  assert.equal(view.currentState, 'SCENARIO_PREVIEW'); assert.equal(runner.reviewCalls, 1);
  assert.equal(session.verificationResult.status, 'VERIFIED');
  assert.equal(view.scenarioPreview.verification.status, 'VERIFIED');
  assert.equal(runner.evidenceCalls, 0); assert.equal(view.playUrl, null); assert.equal(view.canApprove, true);
  manager.approve(session); await manager.waitForIdle(); view = autoAuthorView(session);
  assert.equal(view.currentState, 'READY'); assert.equal(session.verificationResult.status, 'VERIFIED');
});

test('User Rejectは設定へ戻り、真実丸はinvalid outputを最大3回内で自動修正する', async () => {
  let runner = new MockCodexRunner(); let manager = new AutoGenerationManager({ jsonRunner: runner });
  let session = createAutoAuthorSession(); manager.submitManual(session, createDefaultConfiguration());
  await manager.waitForIdle(); manager.reject(session); assert.equal(session.auto.state, 'MANUAL_CONFIGURATION');
  runner = new MockCodexRunner({ invalidMakotomaruOutput: 2 });
  manager = new AutoGenerationManager({ jsonRunner: runner }); session = createAutoAuthorSession();
  manager.startMakotomaru(session, { schemaVersion: '1.0', difficulty: 3,
    attackCategory: 'ANY', complexity: 'COMPLEX' }); await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW'); assert.equal(runner.makotomaruCalls, 3);
  assert.equal(session.configuration.mode, 'MAKOTOMARU'); assert.ok(session.configuration.attacks.length <= 3);
});

test('Review不合格は承認前にScenarioを修正・再検証し、合格後だけPreviewへ進む', async () => {
  const runner = new MockCodexRunner({
    reviewOutcomes: ['NEEDS_REVISION', 'VERIFIED'] });
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession(); manager.submitManual(session, createDefaultConfiguration());
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW'); assert.equal(session.userApproval, null);
// 2026-09-20 修正前: 初回Scenario設計を含む呼出回数・失敗工程を検証する
//   assert.equal(runner.reviewCalls, 2); assert.equal(runner.scenarioCalls, 1);
// 2026-09-20 修正後: 初回Scenario設計を含む呼出回数・失敗工程を検証する
  assert.equal(runner.reviewCalls, 2); assert.equal(runner.scenarioCalls, 2);
  assert.equal(session.verificationResult.status, 'VERIFIED');
  manager.approve(session); await manager.waitForIdle(); assert.equal(session.auto.state, 'READY');
});

test('Configurationの証拠種別と証拠の答えをScenario基盤へ保持する', async () => {
  const runner = new MockCodexRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession(); const configuration = createDefaultConfiguration();
  configuration.attacks[0].evidenceAnswer = 'Webログの時刻と要求値が同じリクエストを示す。';
  manager.submitManual(session, configuration); await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  assert.match(session.scenarioPackage.evidenceRequirements.requirements
    .find(item => item.requirementId === 'requirement_attack').description,
  /Webログの時刻と要求値/);
  assert.equal(autoAuthorView(session).configuration.attacks[0].evidenceAnswer,
    configuration.attacks[0].evidenceAnswer);
});

function playToAcquittal(runtime) {
  const game = createGeneratedGame(runtime); actGenerated(game, runtime, { action: 'begin' });
  actGenerated(game, runtime, { action: 'continue' });
  for (let round = 1; round <= runtime.gameCase.progression.courtRoundCount; round += 1) {
    collectCurrentTarget(game, runtime);
    enterCurrentCourt(game, runtime);
    actGenerated(game, runtime, { action: 'objection', ...currentCorrectPair(runtime, round) });
  }
  return game;
}

test('Phishing ★1: 表示URLとhrefが異なるメールとWeb記録を取得し限定的な反駁を行う', async () => {
  const runner = new MockCodexRunner();
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  const configuration = autoAuthorBootstrap().defaultManualConfiguration;
  const originalConfiguration = structuredClone(configuration);
  manager.submitManual(session, configuration); await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  const requirement = session.scenarioPackage.evidenceRequirements.requirements
    .find(item => item.requirementId === 'requirement_attack');
  assert.match(requirement.description, /保存メールに記載された誘導内容・リンク/);
  assert.match(requirement.description, /不一致.*必須にしない/);
  assert.equal(runner.evidenceCalls, 0);
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(autoAuthorView(session).developerDetails));
  assert.equal(session.evaluationResult.status, 'ACCEPTED');
  assert.equal(session.evaluationResult.checks.length, 10);
  assert.ok(session.evaluationResult.checks.every(item => item.status === 'PASS'));
  assert.equal(session.configuration.evidenceCount, 1);
  assert.deepEqual(session.configuration, originalConfiguration);
  const artifacts = session.evidenceImportResult.evidenceSet.evidenceArtifacts;
  const email = artifacts.find(item => item.type === 'EMAIL');
  const web = artifacts.find(item => item.type === 'WEB_ACCESS_LOG');
  const [, href, display] = email.publicContent.match(/<a href="([^"]+)">([^<]+)<\/a>/);
  assert.notEqual(href, display);
  const request = web.publicContent.split('\n').filter(Boolean).map(line => JSON.parse(line))
    .find(row => row.request_target === new URL(href).pathname + new URL(href).search);
  assert.ok(request, 'リンク先に対応する要求と正常なアクセスを同じ資料に含める');
  assert.equal(request.request_target, new URL(href).pathname + new URL(href).search);
  assert.ok(!web.publicContent.includes(display));
  assert.doesNotMatch(email.publicContent + web.publicContent, /302|Location:|正解/);
  const evidenceCall = runner.calls.find(item => item.phase === 'GENERATING_EVIDENCE');
  assert.equal(evidenceCall.outputSchemaName, 'evidence-generation-draft');
  assert.equal(evidenceCall.data.evidenceDraftInput.outputContract.name, 'evidence-generation-draft');
  for (const item of [email, web]) {
    assert.equal(item.integrity.algorithm, 'SHA-256');
    assert.match(item.integrity.publicContentDigest, /^[0-9a-f]{64}$/);
  }
  const exoneration = session.evidenceImportResult.evidenceSet.exonerations[0];
  assert.ok(exoneration.supportingEvidenceIds.includes(email.evidenceId));
  assert.ok(exoneration.supportingEvidenceIds.includes(web.evidenceId));
  for (const [type, sourceId, actionId] of [['EMAIL', 'mail-host', 'action_check_email'],
    ['WEB_ACCESS_LOG', 'web-host', 'action_audit_log']]) {
    const evidence = artifacts.find(item => item.type === type);
    assert.ok(evidence, type);
    const rule = session.progressionPlan.evidenceDiscoveryRules
      .find(item => item.evidenceId === evidence.evidenceId);
    const target = session.progressionPlan.investigationTargets.find(item => item.targetId === rule.targetId);
    assert.equal(target.sourceNodeRef.sourceId, sourceId);
    assert.equal(rule.actionId, actionId);
  }
  // 調査先の表示名に証言のタイトルを流用すると、ここで未発見資料が漏れる。
  const investigation = createGeneratedGame(session.runtime);
  actGenerated(investigation, session.runtime, { action: 'begin' });
  const initial = actGenerated(investigation, session.runtime, { action: 'continue' });
  assert.deepEqual(initial.discoveredEvidence, []);
  assert.deepEqual(initial.collectedEvidence, []);
  assert.deepEqual(initial.workbench.materials.map(item => item.materialId),
    artifacts.filter(item => item.type !== 'TESTIMONY').map(item => item.evidenceId));
  const initialText = JSON.stringify(initial);
  for (const artifact of artifacts.filter(item => item.type !== 'TESTIMONY')) {
    assert.ok(!initialText.includes(artifact.publicContent), `未調査の${artifact.evidenceId}の本文が公開されています。`);
    assert.throws(() => actGenerated(investigation, session.runtime,
      { action: 'collect', evidenceId: artifact.evidenceId }), { code: 'EVIDENCE_NOT_DISCOVERED' });
  }
  for (const artifact of artifacts.filter(item => item.type !== 'TESTIMONY'))
    inspectMaterial(investigation, session.runtime, artifact.evidenceId);
  const discovered = generatedPlayerView(investigation, session.runtime).discoveredEvidence;
  for (const artifact of [email]) {
    const visible = discovered.find(item => item.evidenceId === artifact.evidenceId);
    assert.ok(visible);
    assert.equal(visible.title, artifact.title);
    assert.equal(visible.publicContent, artifact.publicContent);
  }
  const game = playToAcquittal(session.runtime);
  assert.equal(game.currentState, 'ACQUITTED');
  assert.equal(game.currentRound, 2);
  assert.ok(artifacts.filter(item => item.type !== 'TESTIMONY').every(item => game.collectedEvidenceIds.includes(item.evidenceId)));
});

test('全要件IDを列挙してもWeb観測資料をメールで代用したEvidenceは拒否する', async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const session = createAutoAuthorSession();
  manager.submitManual(session, createDefaultConfiguration({ attackIds: ['phishing'] }));
  await manager.waitForIdle(); assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  const fixture = phase7Fixture({ verificationInput: session.verificationInput,
    verificationResult: session.verificationResult, scenarioPackage: session.scenarioPackage });
  assert.equal(fixture.evidenceImportResult.status, 'VALID');
  const web = fixture.evidencePackage.evidenceArtifacts.find(item => item.type === 'WEB_ACCESS_LOG');
  const email = fixture.evidencePackage.evidenceArtifacts.find(item => item.type === 'EMAIL');
  web.sourceRefs = structuredClone(email.sourceRefs);
  const result = importEvidencePackage({ generationInput: fixture.evidenceGenerationInput,
    evidencePackage: fixture.evidencePackage });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'OBSERVABLE_EVIDENCE_NOT_COVERED'));
});

test('E2E A: MANUAL 2 Attack / ★★ は調査チェーン2・異なる3争点・ACQUITTEDへ到達する', async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const session = createAutoAuthorSession(); manager.submitManual(session,
    createDefaultConfiguration({ difficulty: 2, attackIds: ['phishing', 'reflected_xss'] }));
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY'); assert.equal(session.evidenceChain.length, 2);
  assert.equal(session.dialoguePlan.rounds.length, 3);
  assert.equal(session.runtime.gameCase.progression.courtRoundCount, 3);
  const game = playToAcquittal(session.runtime); assert.equal(game.currentState, 'ACQUITTED');
  assert.equal(game.currentRound, 3);
});

test('E2E B: MAKOTOMARU ★★★ はPreview・3調査対象ごとの審理を経てACQUITTEDになる', async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const session = createAutoAuthorSession(); manager.startMakotomaru(session, {
    schemaVersion: '1.0', difficulty: 3, attackCategory: 'ANY', complexity: 'COMPLEX' });
  await manager.waitForIdle(); assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  manager.approve(session); await manager.waitForIdle(); assert.equal(session.auto.state, 'READY');
  assert.equal(session.evidenceChain.length, 3); assert.equal(session.dialoguePlan.rounds.length, 3);
  assert.equal(session.runtime.gameCase.progression.courtRoundCount, 3);
  const game = playToAcquittal(session.runtime); assert.equal(game.currentState, 'ACQUITTED');
  assert.equal(game.currentRound, 3);
});

test('Dialogue Assignmentは固定Templateへslotを割り当てる', () => {
  assert.deepEqual(COURT_DIALOGUE_TEMPLATE.slice(0, 3), ['INTRO', 'INITIAL_COURT', 'INVESTIGATION']);
  const plan = assignDialogueTemplate({ configuration: createDefaultConfiguration(),
    scenarioPackage: { scenarioDraft: { title: '合成事件' } },
    evidenceSet: { evidenceArtifacts: [{ type: 'LOG', title: 'Web記録' }], exonerations: [] } });
  assert.equal(plan.slots.charge, '合成事件'); assert.equal(plan.fixedLines.objection, 'この記録から、確かめていただきたい点があります。');
  assert.deepEqual(plan.speakers, ['JUDGE', 'PROSECUTOR', 'DEFENSE']);
  assert.ok(plan.fixedDialogue.some(item => item.scene === 'COURT_EVIDENCE_ROUND'
    && item.speaker === 'DEFENSE'));
});

test('Author viewとPlayer viewにGround Truth・内部判定・credentialを漏らさない', async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const session = createAutoAuthorSession(); manager.submitManual(session, createDefaultConfiguration());
  await manager.waitForIdle(); assert.doesNotMatch(JSON.stringify(autoAuthorView(session)),
    /groundTruth|acceptedEvidenceIds|accessToken|refreshToken/);
  manager.approve(session); await manager.waitForIdle(); const game = createGeneratedGame(session.runtime);
  assert.doesNotMatch(JSON.stringify(generatedPlayerView(game, session.runtime)),
    /groundTruth|scenarioConfiguration|attackGraph|acceptedEvidenceIds|verificationResult|prompt/i);
});
