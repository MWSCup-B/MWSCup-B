import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { createGeneratedGame, actGenerated, generatedPlayerView } from '../server/generated-game.js';
import { validateRansomwareObservations, observedFileComparisons } from '../server/generation/ransomware-observations.js';
import { executeMaterialCommand, materialCapabilities } from '../server/generation/investigation-workspace.js';
import { currentCorrectPair } from './helpers/court-issues.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { ransomwareEvidence } from './helpers/ransomware-evidence.js';
import { renderInvestigationWorkspace } from '../public/investigation-workspace.js';
import { Element } from './helpers/author-dom.js';
import { isRansomwareLog } from '../server/generation/evidence-log-format.js';

const graph = { nodes: [{ nodeId: 'attack_ransom', attackDefinitionId: 'ransomware',
  artifactEvaluations: [{ artifactId: 'file_operation_record' }] }] };
const artifacts = () => Object.entries(ransomwareEvidence()).map(([sourceId, [type, title, publicContent]]) => ({
  evidenceId: sourceId, type, title, publicContent,
  sourceRefs: [{ sourceType: 'ATTACK_GRAPH_ARTIFACT', attackNodeId: 'attack_ransom', sourceId }],
}));
const editRows = (items, id, fn) => {
  const item = items.find(item => item.evidenceId === id);
  item.publicContent = fn(item.publicContent.split('\n').map(JSON.parse)).map(JSON.stringify).join('\n');
};

test('five independently sourced materials retain coherent file, process, parent and note observations', () => {
  const items = artifacts(), before = structuredClone(items);
  validateRansomwareObservations(items, graph);
  assert.deepEqual(items, before);
  assert.equal(materialCapabilities(items[0]).console, true);
  assert.equal(materialCapabilities(items.find(item => item.type === 'FILE_METADATA')).console, false);
});

for (const [name, mutation] of [
  ['missing backup', items => items.splice(items.findIndex(item => item.evidenceId === 'original_file_record'), 1)],
  ['wrong backup identity', items => editRows(items, 'original_file_record', rows => rows.map(row => ({ ...row, file_ref: 'unrelated' })))],
  ['wrong device', items => editRows(items, 'process_execution_record', rows => rows.map(row => ({ ...row, device_id: 'another-device' })))],
  ['wrong parent PID', items => editRows(items, 'process_execution_record', rows => rows.map(row => ({ ...row, parent_pid: 9999 })))],
  ['missing parent', items => editRows(items, 'process_execution_record', rows => rows.slice(0, 1))],
  ['wrong renamed path', items => editRows(items, 'file_operation_record', rows => rows.map(row => row.operation === 'rename' ? { ...row, new_path: 'unrelated' } : row))],
  ['note without creation', items => editRows(items, 'file_operation_record', rows => rows.filter(row => row.operation !== 'create'))],
  ['backup after write', items => editRows(items, 'original_file_record', rows => rows.map(row => ({ ...row, timestamp: '2026-10-01T00:00:00Z' })))],
  ['different attack node', items => { items.find(item => item.evidenceId === 'original_file_record').sourceRefs[0].attackNodeId = 'other_attack'; }],
]) test(`inconsistent ransomware observations are rejected: ${name}`, () => {
  const items = artifacts(); mutation(items);
  assert.throws(() => validateRansomwareObservations(items, graph), { code: 'EVIDENCE_RANSOMWARE_OBSERVATION_INVALID' });
});

test('period aggregation and PID chronology are literal, read-only and do not save aggregate evidence', () => {
  const item = artifacts()[0];
  const query = `jq -c 'select(.timestamp >= "2026-09-18T00:10:00.000Z" and .timestamp <= "2026-09-18T00:10:20.000Z") | [.pid, .executable, .operation]' material.txt | sort | uniq -c`;
  const result = executeMaterialCommand(item, query);
  assert.equal(result.valid, true);
  assert.equal(result.matchedRecords, 14);
  assert.match(result.output, /6 \[4242,"C:\/training\/sample.exe","write"\]/);
  assert.match(result.output, /6 \[4242,"C:\/training\/sample.exe","rename"\]/);
  assert.match(result.output, /2 \[4242,"C:\/training\/sample.exe","create"\]/);
  assert.deepEqual(result.lines, []);
  const timeline = executeMaterialCommand(item, `jq -sc 'map(select(.pid == 4242)) | sort_by(.timestamp)[]' material.txt`);
  assert.equal(timeline.matchedRecords, 14);
  const times = timeline.output.split('\n').map(line => JSON.parse(line).timestamp);
  assert.deepEqual(times, [...times].sort());
  assert.ok(timeline.observations.some(row => row.field === 'pid' && row.value === '4242'));
  for (const command of [query + '; touch /tmp/no', query.replace('material.txt', '/etc/passwd'),
    `jq -sc 'map(select(.pid == 4242)) | system("bad")' material.txt`]) assert.equal(executeMaterialCommand(item, command).valid, false);
});

test('comparison discloses only viewed pairs, independent of read order, and never invents a match', () => {
  const items = artifacts(), damaged = 'damaged_file_record', original = 'original_file_record';
  for (const first of [damaged, original]) {
    const seen = { [first]: [1] };
    assert.deepEqual(observedFileComparisons(items, seen), []);
    seen[first === damaged ? original : damaged] = [1];
    const result = observedFileComparisons(items, seen);
    assert.equal(result.length, 1);
    assert.equal(result[0].hashChanged, true); assert.equal(result[0].headerChanged, true);
    assert.doesNotMatch(JSON.stringify(result), /saved-file-1/);
  }
  editRows(items, original, rows => rows.map(row => ({ ...row, device_id: 'unrelated' })));
  assert.deepEqual(observedFileComparisons(items, { [damaged]: [1], [original]: [1] }), []);
});

test('the existing viewer renders file comparisons as text in a single scrollable region', () => {
  const items = artifacts(), id = 'damaged_file_record';
  const comparisons = observedFileComparisons(items, { [id]: [1, 2], original_file_record: [1, 2] });
  comparisons[0].originalPath = '<script>untrusted()</script>';
  const el = (tag, value, className) => { const node = new Element(tag); if (value !== undefined) node.textContent = value;
    if (className) node.className = className; return node; };
  const button = label => el('button', label);
  const game = { canReturnToCourt: false, workbench: { progress: { complete: false, collected: 0, required: 5 }, comparisons,
    materials: [{ materialId: id, label: '被害ファイル', capabilities: { console: false }, history: [], savedFacts: [] }] } };
  const root = renderInvestigationWorkspace(game, { mode: 'source', material: id }, () => {}, () => {}, { el, button });
  assert.equal(root.querySelectorAll('.workspace-comparisons').length, 1);
  assert.equal(root.querySelectorAll('.workspace-comparison').length, 2);
  assert.equal(root.querySelectorAll('script').length, 0);
  assert.match(root.textContent, /<script>untrusted\(\)<\/script>/);
  assert.match(root.textContent, /SHA-256/);
});

for (const attackIds of [['ransomware'], ['clickfix', 'ransomware'], ['phishing', 'clickfix', 'ransomware']]) {
  test(`${attackIds.join(' -> ')} generates, investigates in reverse order and reaches acquittal without SSH`, async () => {
    const runner = new MockCodexRunner(), manager = new AutoGenerationManager({ jsonRunner: runner });
    const author = createAutoAuthorSession();
    manager.submitSelection(author, { schemaVersion: '1.0', attackIds, settingId: 'company' });
    await manager.waitForIdle();
    assert.equal(author.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(author.auto.details));
    const originalConfiguration = structuredClone(author.configuration);
    manager.approve(author); await manager.waitForIdle();
    assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
    assert.deepEqual(author.configuration, originalConfiguration);
    assert.equal(author.evaluationResult.status, 'ACCEPTED');
    const { runtime } = author;
    const materials = runtime.gameCase.detective.evidence;
    const imported = author.evidenceImportResult.evidenceSet.evidenceArtifacts;
    const logIds = imported.filter(item => isRansomwareLog(item, imported)).map(item => item.evidenceId);
    const logs = materials.filter(item => logIds.includes(item.evidenceId));
    assert.equal(logs.length, 2);
    for (const item of logs) assert.equal(new Set(item.publicContent.trim().split('\n')).size, 100);
    assert.equal(materials.filter(item => item.title === 'ファイル操作ログ').length, 1);
    assert.ok(materials.some(item => item.title === '被害ファイル'));
    assert.ok(materials.some(item => item.title === 'バックアップから取得した元ファイル'));
    assert.equal(materials.filter(item => item.title.includes('SSH')).length, 0);
    const requirements = author.scenarioPackage.evidenceRequirements.requirements.filter(item => item.investigationStage);
    // Verify the concrete accusation, not the wording of the superseded
    // generic intentional-damage claim. Induced use of a device is not denied.
    assert.match(requirements.at(-1).investigationStage.claim, /被告人が自らランサムウェアを実行/);
    if (attackIds.includes('clickfix')) {
      const clickfix = author.generationInput.technicalInput.attackGraph.nodes.find(node => node.attackDefinitionId === 'clickfix');
      const completion = requirements.filter(requirement => requirement.grounds.some(ref => ref.attackNodeId === clickfix.nodeId)).at(-1);
      assert.match(completion.investigationStage.claim, /被告人が攻撃用処理を作成し、攻撃目的で当該処理を直接起動/);
      assert.ok(completion.grounds.some(ref => ref.sourceId === 'clickfix_page_record'));
      assert.ok(completion.grounds.every(ref => ref.sourceType === 'ATTACK_GRAPH_ARTIFACT'));
      assert.ok(requirements.at(-1).grounds.every(ref => ref.attackNodeId !== clickfix.nodeId));
    }
    const player = createGeneratedGame(runtime);
    actGenerated(player, runtime, { action: 'begin' }); actGenerated(player, runtime, { action: 'continue' });
    assert.deepEqual(generatedPlayerView(player, runtime).workbench.comparisons, []);
    const saveAllFactsInReverseOrder = () => {
      for (const item of [...materials].reverse()) {
        actGenerated(player, runtime, { action: 'workspace-read', materialId: item.evidenceId });
        for (const [index] of item.publicContent.split('\n').entries())
          actGenerated(player, runtime, { action: 'save-fact', materialId: item.evidenceId, line: index + 1 });
      }
    };
    saveAllFactsInReverseOrder();
    assert.equal(generatedPlayerView(player, runtime).workbench.comparisons.length, 6);
    for (const [index] of runtime.gameCase.progression.courtIssues.entries()) {
      // 保存状況は争点ごとにリセットされるため、次の争点では資料を改めて保存する。
      if (index > 0) saveAllFactsInReverseOrder();
      const pair = currentCorrectPair(runtime, player.currentRound);
      actGenerated(player, runtime, { action: 'retrial', ...pair });
      actGenerated(player, runtime, { action: 'objection', ...pair });
    }
    assert.equal(player.currentState, 'ACQUITTED');
  });
}

test('a missing parent is sent back once; unresolved evidence cannot reach game build', async () => {
  class BrokenRunner extends MockCodexRunner {
    async runJson(args) {
      const draft = await super.runJson(args);
      if (args.phase === 'GENERATING_EVIDENCE') {
        const item = draft.evidenceArtifacts.find(item => item.title === 'プロセス実行ログ');
        item.publicContent = item.publicContent.replaceAll('"parent_pid":4000', '"parent_pid":9999');
        for (const question of draft.courtQuestions) for (const quote of question.supportingQuotes)
          if (quote.evidenceId === item.evidenceId) quote.quote = quote.quote.replaceAll('"parent_pid":4000', '"parent_pid":9999');
      }
      return draft;
    }
  }
  const runner = new BrokenRunner(), manager = new AutoGenerationManager({ jsonRunner: runner }), author = createAutoAuthorSession();
  manager.submitSelection(author, { schemaVersion: '1.0', attackIds: ['ransomware'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(author); await manager.waitForIdle();
  assert.equal(author.auto.state, 'FAILED'); assert.equal(author.runtime, null);
  assert.equal(runner.evidenceCalls, 2);
  assert.ok(author.auto.details.some(issue => issue.code === 'EVIDENCE_RANSOMWARE_OBSERVATION_INVALID'));
});

for (const repairs of [true, false]) test(`background and snapshot defects are returned together and ${repairs ? 'repair in one retry' : 'block build'}`, async () => {
  class BackgroundRunner extends MockCodexRunner {
    async runJson(args) {
      const draft = await super.runJson(args);
      if (args.phase !== 'GENERATING_EVIDENCE') return draft;
      if (this.evidenceCalls === 2) {
        assert.ok(args.feedback.errors.some(issue => issue.code === 'EVIDENCE_LOG_BACKGROUND_INVALID'));
        assert.ok(args.feedback.errors.some(issue => issue.code === 'EVIDENCE_RANSOMWARE_OBSERVATION_INVALID' && /65桁/.test(issue.reason)));
      }
      if (repairs && this.evidenceCalls === 2) return draft;
      const upstream = draft.evidenceArtifacts.find(item => item.sourceRefs.some(ref => ref.attackNodeId === 'attack_clickfix'
        && ref.sourceId === 'process_execution_record'));
      assert.ok(upstream);
      draft.logBackgrounds.push({ evidenceId: upstream.evidenceId, samples: draft.logBackgrounds[0].samples });
      const damaged = draft.evidenceArtifacts.find(item => item.type === 'FILE_METADATA'
        && item.sourceRefs.some(ref => ref.sourceId === 'damaged_file_record'));
      const lines = damaged.publicContent.split('\n'), row = JSON.parse(lines[0]);
      row.sha256 += 'a'; lines[0] = JSON.stringify(row); damaged.publicContent = lines.join('\n');
      return draft;
    }
  }
  const runner = new BackgroundRunner(), manager = new AutoGenerationManager({ jsonRunner: runner });
  const author = createAutoAuthorSession();
  manager.submitSelection(author, { schemaVersion: '1.0', attackIds: ['clickfix', 'ransomware'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(author); await manager.waitForIdle();
  assert.equal(runner.evidenceCalls, 2);
  assert.equal(author.auto.state, repairs ? 'READY' : 'FAILED', JSON.stringify(author.auto.details));
  assert.equal(Boolean(author.runtime), repairs);
});
