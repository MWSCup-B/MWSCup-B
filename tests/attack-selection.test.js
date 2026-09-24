// 2026-09-20: カタログ位置・段階に依存しない選択と技術条件を検証する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAuthorBootstrap, AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { loadCatalog } from '../server/generation/catalog.js';
import { validateScenarioConfiguration, normalizeScenarioConfiguration } from '../server/generation/scenario-configuration.js';
import { buildEvidenceInvestigationPlan } from '../server/generation/investigation-registry.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { startAuthorDom } from './helpers/author-dom.js';
import { SCENARIO_PROMPT_TEMPLATE } from '../server/generation/scenario-interface.js';

const bootstrap = autoAuthorBootstrap(), catalog = await loadCatalog();
const preset = bootstrap.networkPresets.find(item => item.id === 'enterprise-lab');
test('コメント保存した旧生成指示をAIへ送信しない', async () => {
  class PromptRunner extends MockCodexRunner {
    async runJson(args) {
      if (args.phase === 'MAKOTOMARU_CONFIGURATION') {
        assert.match(args.instruction, /攻撃は1～6個/);
        assert.doesNotMatch(args.instruction, /攻撃は1～3個|<!--/);
      }
      return super.runJson(args);
    }
  }
  const session = createAutoAuthorSession(), manager = new AutoGenerationManager({ jsonRunner: new PromptRunner() });
  manager.startMakotomaru(session, { schemaVersion: '1.0', difficulty: 1, attackCategory: 'ANY', complexity: 'STANDARD' });
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW');
  assert.doesNotMatch(SCENARIO_PROMPT_TEMPLATE, /<!--|grounds`不足を指摘された場合/);
});
function configuration(ids) {
  const result = structuredClone(bootstrap.defaultManualConfiguration);
  result.network = structuredClone(preset.network);
  result.attacks = ids.map((id, index) => ({ ...structuredClone(preset.attackDefaults.find(a => a.attackId === id)),
    order: index + 1, occurrenceTime: '2026-09-18T09:' + String(10 + index * 8).padStart(2, '0') + ':00+09:00' }));
  return result;
}
for (const ids of [...catalog.map(a => [a.id]), ['sql_injection', 'reflected_xss'],
  ['valid_account_ssh', 'sudo_misconfiguration', 'protected_file_collection'],
  ['valid_account_ssh', 'setuid_misconfiguration', 'protected_file_collection'],
  ['phishing', 'path_traversal', 'valid_account_ssh', 'sudo_misconfiguration', 'protected_file_collection', 'windows_service_permissions']]) {
  test(`任意選択 ${ids.join(' / ')} が承認・証拠生成・評価を経てREADYになる`, async () => {
    const input = configuration(ids), manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
    const session = createAutoAuthorSession(); manager.submitManual(session, input); await manager.waitForIdle();
    assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(session.auto.details));
    manager.approve(session); await manager.waitForIdle();
    assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
    assert.equal(session.evaluationResult.status, 'ACCEPTED');
    assert.deepEqual(session.configuration, input);
  });
}
test('単独の権限昇格は初期権限を明示し、SSH連鎖なら効果を使う', () => {
  const single = validateScenarioConfiguration(configuration(['sudo_misconfiguration']), catalog).technical;
  assert.ok(single.scenarioContext.attackerInitialPrivileges.some(f => f.predicate === 'local_execution'));
  assert.deepEqual(single.candidate.selectedAttackIds, ['sudo_misconfiguration']);
  const chain = validateScenarioConfiguration(configuration(['valid_account_ssh', 'sudo_misconfiguration', 'protected_file_collection']), catalog);
  assert.equal(chain.status, 'VALID');
  assert.equal(chain.technical.scenarioContext.attackerInitialPrivileges.some(f => ['local_execution', 'privileged_execution'].includes(f.predicate)), false);
  const graph = chain.technical.generationInput.technicalInput.attackGraph;
  assert.equal(graph.components.length, 1);
  assert.equal(graph.edges.length, 2);
  const independent = validateScenarioConfiguration(configuration(['reflected_xss', 'sql_injection']), catalog);
  assert.equal(independent.technical.generationInput.technicalInput.attackGraph.components.length, 2);
});
test('逆順・異なるOS・到達不能・記録不足は自動補完しない', () => {
  const reverse = validateScenarioConfiguration(configuration(['protected_file_collection', 'sudo_misconfiguration']), catalog);
  assert.equal(reverse.status, 'INVALID');
  for (const mutate of [
    c => { c.network.nodes.find(n => n.nodeId === 'web-host').os = 'windows'; },
    c => { c.network.connections = []; },
  ]) {
    const c = configuration(['valid_account_ssh']); mutate(c);
    assert.equal(validateScenarioConfiguration(c, catalog).status, 'INVALID');
  }
  const c = configuration(['sudo_misconfiguration']);
  c.network.nodes.find(n => n.nodeId === 'web-host').logSources = ['CONFIGURATION'];
  const result = validateScenarioConfiguration(c, catalog);
  assert.throws(() => buildEvidenceInvestigationPlan(c, result.technical.generationInput), { code: 'EVIDENCE_SOURCE_UNAVAILABLE' });
});
test('0件と7件は件数検証で拒否する', () => {
  for (const ids of [[], catalog.slice(0, 7).map(a => a.id)]) {
    const result = validateScenarioConfiguration(configuration(ids), catalog);
    assert.equal(result.status, 'INVALID'); assert.equal(result.errors[0].code, 'INVALID_COUNT');
  }
});
test('UIは初期攻撃を解除しても任意の攻撃だけをorder=1で送信する', async () => {
  const page = startAuthorDom(bootstrap); await page.ready;
  await page.byId('choose-manual').dispatch('click');
  const toggle = async (id, checked) => {
    const control = page.document.querySelectorAll('input[name="attack"]').find(c => c.value === id);
    control.checked = checked; await control.dispatch('change');
  };
  await toggle('sql_injection', true); await toggle('phishing', false);
  assert.equal(page.document.querySelector('[data-attack-id="sql_injection"]').querySelector('[data-key="order"]').value, '1');
  for (let i = 0; i < 7; i++) await page.byId('manual-next').dispatch('click');
  await page.byId('manual-create').dispatch('click');
  const submitted = page.calls.find(call => call.path.endsWith('/manual')).body.configuration;
  assert.deepEqual(submitted.attacks.map(a => [a.attackId, a.order]), [['sql_injection', 1]]);
  assert.equal(validateScenarioConfiguration(normalizeScenarioConfiguration(submitted, catalog), catalog).status, 'VALID');
});
test('段階フィルターは他段階の選択を消さず、選択順をカタログ順へ戻さない', async () => {
  const page = startAuthorDom(bootstrap); await page.ready;
  for (const id of ['sql_injection', 'path_traversal']) {
    const control = page.document.querySelectorAll('input[name="attack"]').find(c => c.value === id);
    control.checked = true; await control.dispatch('change');
  }
  const filter = page.document.querySelector('[data-key="stageFilter"]');
  filter.value = 'PRIVILEGE_ESCALATION'; await filter.dispatch('change');
  const cards = page.byId('attack-details').querySelectorAll('[data-attack-id]');
  assert.deepEqual(cards.map(c => c.dataset.attackId), ['phishing', 'sql_injection', 'path_traversal']);
  assert.equal(page.document.querySelector('[data-choice-id="phishing"]').hidden, true);
  assert.equal(page.document.querySelector('[data-choice-id="sudo_misconfiguration"]').hidden, false);
  const order = cards[2].querySelector('[data-key="order"]'); order.value = '1'; await order.dispatch('change');
  assert.deepEqual(page.byId('attack-details').querySelectorAll('[data-attack-id]').map(c => c.dataset.attackId),
    ['path_traversal', 'phishing', 'sql_injection']);
});

test('途中解除して追加した攻撃には、残した攻撃より後の初期時刻を割り当てる', async () => {
  const page = startAuthorDom(bootstrap); await page.ready;
  for (const [id, checked] of [['sql_injection', true], ['phishing', false], ['path_traversal', true]]) {
    const control = page.document.querySelectorAll('input[name="attack"]').find(c => c.value === id);
    control.checked = checked; await control.dispatch('change');
  }
  const cards = page.byId('attack-details').querySelectorAll('[data-attack-id]');
  assert.deepEqual(cards.map(card => card.querySelector('[data-key="order"]').value), ['1', '2']);
  assert.ok(cards[0].querySelector('[data-key="occurrenceTime"]').value
    < cards[1].querySelector('[data-key="occurrenceTime"]').value);
});
