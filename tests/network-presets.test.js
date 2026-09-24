import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAuthorBootstrap } from '../server/auto-generation-service.js';
import { loadCatalog } from '../server/generation/catalog.js';
import { validateScenarioConfiguration } from '../server/generation/scenario-configuration.js';

const catalog = await loadCatalog();

function configurationFor(preset, attack) {
  const configuration = structuredClone(autoAuthorBootstrap().defaultManualConfiguration);
  configuration.network = structuredClone(preset.network);
  configuration.attacks = [{ ...structuredClone(attack), order: 1 }];
  return configuration;
}

test('全Network presetで登録済みの各Attackを固定Node IDなしに構成できる', () => {
  const bootstrap = autoAuthorBootstrap();
  assert.deepEqual(bootstrap.networkPresets.map(item => item.id).sort(),
// 2026-09-20 修正前: SSH・権限昇格対応の明示テンプレートを追加
//     ['branch-proxy', 'corporate-flat', 'dmz-web']);
// 2026-09-20 修正後: SSH・権限昇格対応の明示テンプレートを追加
    ['branch-proxy', 'corporate-flat', 'dmz-web', 'enterprise-lab', 'extended-incidents']);
  for (const preset of bootstrap.networkPresets) {
// 2026-09-20 修正前: 構成ごとに対応できる攻撃だけを初期値として提示
//     assert.equal(preset.attackDefaults.length, catalog.length, preset.id);
// 2026-09-20 修正後: 構成ごとに対応できる攻撃だけを初期値として提示
    assert.ok(preset.attackDefaults.length >= 3, preset.id);
    // 2026-09-24 修正前: enterprise-labだけで全攻撃を検証。
    // if (preset.id === 'enterprise-lab') assert.equal(preset.attackDefaults.length, catalog.length);
    // 2026-09-24 修正後: 認証・端末サービスを明示した追加構成で全16攻撃を検証。
    if (preset.id === 'extended-incidents') assert.equal(preset.attackDefaults.length, catalog.length);
    for (const attack of preset.attackDefaults) {
      const result = validateScenarioConfiguration(configurationFor(preset, attack), catalog);
      assert.equal(result.status, 'VALID', `${preset.id}/${attack.attackId}: ${JSON.stringify(result.errors)}`);
    }
  }
  const dmz = bootstrap.networkPresets.find(item => item.id === 'dmz-web');
  assert.ok(dmz.attackDefaults.every(item => !['sender-host', 'client-host', 'web-host', 'mail-host']
    .includes(item.sourceNodeId)));
});

test('Roleが曖昧なNetworkは推測で補完せずAMBIGUOUS_BINDINGとして拒否する', () => {
  const bootstrap = autoAuthorBootstrap();
  const preset = bootstrap.networkPresets.find(item => item.id === 'dmz-web');
  const configuration = configurationFor(preset,
    preset.attackDefaults.find(item => item.attackId === 'phishing'));
  configuration.network.nodes.push({ ...configuration.network.nodes.find(item =>
    item.nodeId === 'office-client'), nodeId: 'second-client', label: '別の利用者端末',
  ip: '10.20.0.21' });
  // 2026-09-20 修正後: RoleだけでなくServiceと到達性まで同じ候補を作り、真の曖昧さを検証する。
  configuration.network.services.push({ serviceId: 'second-browser', nodeId: 'second-client',
    label: '別のBrowser', serviceType: 'web_browser', platform: 'browser' });
  configuration.network.connections.push({ fromNodeId: 'second-client', toNodeId: 'mail-gateway' },
    { fromNodeId: 'second-client', toNodeId: 'public-web' });
  const result = validateScenarioConfiguration(configuration, catalog);
  assert.equal(result.status, 'INVALID');
  assert.ok(result.errors.some(item => item.code === 'AMBIGUOUS_BINDING'));
});
