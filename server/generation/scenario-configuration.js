import { randomBytes } from 'node:crypto';
import { validateDocument, ValidationError } from './schema.js';
import { buildAttackGraphs } from './attack-graph.js';
import { buildScenarioGenerationInputs } from './scenario-interface.js';

export const INVESTIGATION_TYPES = Object.freeze({
  WEB_LOG: { label: 'Webアクセスログ', actionId: 'action_audit_log' },
  PROXY_LOG: { label: 'Proxyログ', actionId: 'action_analyze_network_log' },
  AUTH_LOG: { label: '認証ログ', actionId: 'action_review_auth_log' },
  APPLICATION_LOG: { label: 'Applicationログ', actionId: 'action_audit_log' },
  NETWORK_LOG: { label: 'Networkログ', actionId: 'action_analyze_network_log' },
  EMAIL: { label: 'メール', actionId: 'action_inspect_file' },
  BROWSER_HISTORY: { label: 'ブラウザ履歴', actionId: 'action_inspect_device' },
  DEVICE: { label: '端末', actionId: 'action_inspect_device' },
  FILE: { label: 'ファイル', actionId: 'action_inspect_file' },
  CONFIGURATION: { label: '設定', actionId: 'action_check_configuration' },
});

export const DEFAULT_DESIGN_NETWORK = Object.freeze({
  subnets: [
    { subnetId: 'external-net', label: '外部ネットワーク', cidr: '203.0.113.0/24', trustBoundaryId: 'external' },
    { subnetId: 'internal-net', label: '社内ネットワーク', cidr: '10.10.0.0/24', trustBoundaryId: 'internal' },
  ],
  nodes: [
    { nodeId: 'sender-host', label: '外部送信元', nodeType: 'EXTERNAL', os: 'linux', ip: '203.0.113.10', subnetId: 'external-net', trustBoundaryId: 'external', roles: ['sender'], logSources: ['NETWORK_LOG'] },
    { nodeId: 'client-host', label: '利用者端末', nodeType: 'CLIENT', os: 'windows', ip: '10.10.0.20', subnetId: 'internal-net', trustBoundaryId: 'internal', roles: ['workstation'], logSources: ['BROWSER_HISTORY', 'DEVICE', 'FILE'] },
    { nodeId: 'mail-host', label: 'メールサーバー', nodeType: 'MAIL_SERVER', os: 'linux', ip: '10.10.0.30', subnetId: 'internal-net', trustBoundaryId: 'internal', roles: ['mail_server'], logSources: ['EMAIL', 'AUTH_LOG'] },
    { nodeId: 'web-host', label: 'Webサーバー', nodeType: 'WEB_SERVER', os: 'linux', ip: '10.10.0.40', subnetId: 'internal-net', trustBoundaryId: 'internal', roles: ['web_server'], logSources: ['WEB_LOG', 'APPLICATION_LOG', 'CONFIGURATION'] },
    { nodeId: 'db-host', label: 'Databaseサーバー', nodeType: 'DATABASE', os: 'linux', ip: '10.10.0.50', subnetId: 'internal-net', trustBoundaryId: 'internal', roles: ['database_server'], logSources: ['APPLICATION_LOG', 'CONFIGURATION'] },
  ],
  services: [
    { serviceId: 'browser-service', nodeId: 'client-host', label: 'Web Browser', serviceType: 'web_browser', platform: 'browser' },
    { serviceId: 'email-service', nodeId: 'mail-host', label: 'Mail', serviceType: 'email', platform: 'email' },
    { serviceId: 'web-service', nodeId: 'web-host', label: 'Web Application', serviceType: 'web_application', platform: 'web' },
    { serviceId: 'db-service', nodeId: 'db-host', label: 'SQL Database', serviceType: 'sql_database', platform: 'sql' },
  ],
  connections: [
    { fromNodeId: 'sender-host', toNodeId: 'mail-host' },
    { fromNodeId: 'sender-host', toNodeId: 'web-host' },
    { fromNodeId: 'client-host', toNodeId: 'mail-host' },
    { fromNodeId: 'client-host', toNodeId: 'web-host' },
    { fromNodeId: 'web-host', toNodeId: 'db-host' },
  ],
});

const labels = Object.freeze({
  phishing: 'フィッシング', reflected_xss: '反射型XSS', sql_injection: 'SQLインジェクション',
});

export function scenarioCreationBootstrap(catalog) {
  return {
    modes: [
      { id: 'MANUAL', label: '詳細設定', description: '攻撃手法、Network、発生時間、調査方法などを自分で設定します。' },
      { id: 'MAKOTOMARU', label: '真実丸', description: 'AIがScenario条件を自動的に選びます。' },
    ],
    attacks: catalog.map(item => ({ id: item.id, label: item.label, category: item.category,
      supportedInvestigationTypes: [...item.supportedInvestigationTypes] })),
    investigationTypes: Object.entries(INVESTIGATION_TYPES).map(([id, item]) => ({ id, label: item.label })),
    difficulties: [1, 2, 3].map(difficulty => ({ difficulty, label: '★'.repeat(difficulty), requiredEvidenceCount: difficulty })),
    nodeTypes: ['CLIENT', 'SERVER', 'PROXY', 'WEB_SERVER', 'DATABASE', 'AD', 'FILE_SERVER', 'LOG_SERVER', 'MAIL_SERVER', 'EXTERNAL'],
    defaultNetwork: structuredClone(DEFAULT_DESIGN_NETWORK),
  };
}

export function createDefaultConfiguration({ mode = 'MANUAL', difficulty = 1,
  attackIds = ['reflected_xss'], incidentDate = '2026-01-15' } = {}) {
  const specs = {
    phishing: { sourceNodeId: 'sender-host', investigationSourceNodeId: 'mail-host', investigations: ['EMAIL'], effect: '利用者が誘導リンクを開き、Webリクエストを送信する。' },
    reflected_xss: { sourceNodeId: 'client-host', investigationSourceNodeId: 'web-host', investigations: ['WEB_LOG'], effect: '対象オリジンで反射入力がスクリプトとして実行される。' },
    sql_injection: { sourceNodeId: 'sender-host', investigationSourceNodeId: 'web-host', investigations: ['WEB_LOG'], effect: 'WebアプリのDB権限範囲でSQL構造が変更される。' },
  };
  return {
    schemaVersion: '1.0', configurationId: `configuration_${randomBytes(8).toString('hex')}`,
    mode, difficulty, evidenceCount: difficulty,
    network: structuredClone(DEFAULT_DESIGN_NETWORK),
    attacks: attackIds.map((attackId, index) => ({ attackId, order: index + 1,
      occurrenceTime: `${incidentDate}T09:${String(10 + index * 8).padStart(2, '0')}:00+09:00`,
      sourceNodeId: specs[attackId].sourceNodeId, targetNodeId: 'web-host',
      targetServiceId: 'web-service', investigationTypes: specs[attackId].investigations,
      investigationSourceNodeId: specs[attackId].investigationSourceNodeId,
      expectedEffect: specs[attackId].effect, notes: '' })),
    incidentContext: { incidentDate, organizationName: '青葉ソリューションズ',
      victimSystem: '社内ポータル', accusedRole: 'システム利用者',
      initialSuspicionReason: '被告人の利用端末に割り当てられたIPアドレスが記録に含まれていたため。' },
  };
}

function issue(code, field, reason, correctionHint) {
  return { code, field, reason, correctionHint };
}

function canonicalNetwork(network) {
  const services = network.services.map(item => ({ id: item.serviceId, nodeId: item.nodeId,
    type: item.serviceType, platform: item.platform }));
  const nodes = network.nodes.map(item => ({ id: item.nodeId, type: 'host',
    roles: [...item.roles], os: item.os === 'other' || item.os === 'network' ? null : item.os,
    trustZone: item.trustBoundaryId }));
  const adjacency = new Map(nodes.map(item => [item.id, []]));
  for (const connection of network.connections) adjacency.get(connection.fromNodeId)?.push(connection.toNodeId);
  const reachable = (from, to) => {
    const seen = new Set([from]); const queue = [from];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]; if (current === to) return true;
      for (const next of adjacency.get(current) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    return false;
  };
  return { schemaVersion: '1.0', nodes, services,
    trustZones: [...new Map(network.subnets.map(item => [item.trustBoundaryId,
      { id: item.trustBoundaryId, label: item.label }])).values()],
    connections: network.connections.map(item => ({ from: item.fromNodeId, to: item.toNodeId })),
    reachability: nodes.flatMap(node => services.filter(service => reachable(node.id, service.nodeId))
      .map(service => ({ from: node.id, toService: service.id, value: true }))),
  };
}

function findByRole(network, role) { return network.nodes.find(item => item.roles.includes(role))?.nodeId; }
function findService(network, type) { return network.services.find(item => item.serviceType === type); }

function resolvedBindings(configuration, attack, chainRequestId) {
  const network = configuration.network;
  const entities = { attacker: 'actor-a', victim: 'user-a', db_principal: 'db-account', request: chainRequestId };
  if (attack.attackId === 'phishing') {
    const browser = findService(network, 'web_browser'); const mail = findService(network, 'email');
    return { ...entities, sender: attack.sourceNodeId, client: browser?.nodeId,
      browser: browser?.serviceId, mail_host: mail?.nodeId, mail: mail?.serviceId,
      web_host: attack.targetNodeId, web: attack.targetServiceId };
  }
  if (attack.attackId === 'reflected_xss') {
    const browser = network.services.find(item => item.nodeId === attack.sourceNodeId
      && item.serviceType === 'web_browser') ?? findService(network, 'web_browser');
    return { ...entities, client: attack.sourceNodeId, browser: browser?.serviceId,
      web_host: attack.targetNodeId, web: attack.targetServiceId };
  }
  const database = findService(network, 'sql_database');
  return { ...entities, source: attack.sourceNodeId, web_host: attack.targetNodeId,
    web: attack.targetServiceId, db_host: database?.nodeId, database: database?.serviceId };
}

function buildTechnicalContracts(configuration, catalog) {
  const definitions = new Map(catalog.map(item => [item.id, item]));
  const sorted = [...configuration.attacks].sort((a, b) => a.order - b.order);
  const chained = sorted.some((attack, index) => attack.attackId === 'reflected_xss'
    && sorted[index - 1]?.attackId === 'phishing');
  const bindings = new Map(sorted.map((attack, index) => [attack.attackId,
    resolvedBindings(configuration, attack, chained && ['phishing', 'reflected_xss'].includes(attack.attackId)
      ? 'chain-request' : `request-${index + 1}`)]));
  const candidate = { schemaVersion: '1.0', selectedAttackIds: sorted.map(item => item.attackId),
    assignments: sorted.map(attack => ({ attackId: attack.attackId,
      bindings: definitions.get(attack.attackId).bindings.map(binding => ({ name: binding.id,
        entityId: bindings.get(attack.attackId)[binding.id] ?? 'missing-binding' })) })) };
  const scenarioContext = { schemaVersion: '1.0', entities: [
    { id: 'actor-a', type: 'actor' }, { id: 'user-a', type: 'user' },
    { id: 'db-account', type: 'database_principal' },
    ...[...new Set([...bindings.values()].map(item => item.request))].map(id => ({ id, type: 'web_request' })),
  ], vulnerabilities: [], attackerInitialPrivileges: [], requiredUserActions: [],
  loggingConfiguration: [], authenticationConditions: [], otherConditions: [] };
  const produced = new Set();
  for (const definition of sorted.map(item => definitions.get(item.attackId))) {
    const map = bindings.get(definition.id);
    for (const effect of definition.effects) produced.add(JSON.stringify([effect.source,
      effect.predicate, effect.args.map(arg => map[arg.slice(1)]), effect.value]));
  }
  const seen = new Set();
  for (const definition of sorted.map(item => definitions.get(item.attackId))) {
    const map = bindings.get(definition.id);
    for (const condition of [...definition.prerequisites, ...definition.requiredPrivileges,
      ...definition.observableArtifacts.flatMap(item => item.conditions)]) {
      const fact = { predicate: condition.predicate, args: condition.args.map(arg => map[arg.slice(1)]), value: condition.value };
      const key = JSON.stringify([condition.source, fact.predicate, fact.args, fact.value]);
      if (produced.has(key) || seen.has(key)) continue;
      seen.add(key); scenarioContext[condition.source].push(fact);
    }
  }
  const network = canonicalNetwork(configuration.network);
  const graphResult = buildAttackGraphs({ definitions: catalog, network, context: scenarioContext, candidate });
  const connected = graphResult.status === 'CREATED'
    ? graphResult.graphs.find(item => item.components.length === 1) : null;
  if (!connected) return { errors: [issue('INVALID_ATTACK_COMBINATION', 'attacks',
    'この攻撃手法の組合せでは有効な攻撃経路を作成できません。',
    'Attack Graph上で前段の効果が後段の前提条件を満たす組合せを選択してください。')] };
  const selected = { ...graphResult, graphs: [connected] };
  const inputs = buildScenarioGenerationInputs({ attackGraphResult: selected,
    definitions: catalog, network, context: scenarioContext, candidate });
  if (!inputs.length) return { errors: [issue('SCENARIO_INPUT_UNAVAILABLE', 'attacks',
    'Scenario生成用の技術入力を構築できません。', 'NetworkとAttack Detailを確認してください。')] };
  return { network, scenarioContext, candidate, attackGraphResult: selected,
    generationInput: inputs[0], errors: [] };
}

export function validateScenarioConfiguration(configuration, catalog) {
  const errors = [];
  try { validateDocument('scenario-configuration', configuration); }
  catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { status: 'INVALID', errors: [issue(error.code, error.field, error.message,
      '入力欄を確認し、定義済みの値を選択してください。')], technical: null };
  }
  const attacks = [...configuration.attacks].sort((a, b) => a.order - b.order);
  const unique = (items, field) => {
    if (new Set(items).size !== items.length) errors.push(issue('DUPLICATE_VALUE', field,
      '同じ値を重複して使用できません。', '重複を削除してください。'));
  };
  unique(attacks.map(item => item.attackId), 'attacks.attackId');
  unique(attacks.map(item => item.order), 'attacks.order');
  if (attacks.some((item, index) => item.order !== index + 1)) errors.push(issue(
    'INVALID_ATTACK_ORDER', 'attacks.order', 'Attack Orderは1から連続させてください。', '順序を振り直してください。'));
  if (configuration.evidenceCount !== configuration.difficulty) errors.push(issue(
    'DIFFICULTY_EVIDENCE_MISMATCH', 'evidenceCount', 'DifficultyとEvidence数が一致していません。',
    '★1/★2/★3に対してEvidence数を1/2/3にしてください。'));
  const catalogMap = new Map(catalog.map(item => [item.id, item]));
  const nodes = new Map(configuration.network.nodes.map(item => [item.nodeId, item]));
  const services = new Map(configuration.network.services.map(item => [item.serviceId, item]));
  const subnets = new Set(configuration.network.subnets.map(item => item.subnetId));
  unique([...nodes.keys()], 'network.nodes.nodeId'); unique([...services.keys()], 'network.services.serviceId');
  for (const node of nodes.values()) if (!subnets.has(node.subnetId)) errors.push(issue(
    'BROKEN_REFERENCE', `network.nodes.${node.nodeId}.subnetId`, '存在しないSubnetを参照しています。', '既存Subnetを選択してください。'));
  for (const service of services.values()) if (!nodes.has(service.nodeId)) errors.push(issue(
    'BROKEN_REFERENCE', `network.services.${service.serviceId}.nodeId`, '存在しないNodeを参照しています。', '既存Nodeを選択してください。'));
  const parsedTimes = [];
  for (const attack of attacks) {
    const definition = catalogMap.get(attack.attackId);
    if (!definition) { errors.push(issue('UNREGISTERED_ATTACK', `attacks.${attack.order}.attackId`,
      '実装されていないAttackです。', 'Attack Definitionに登録された攻撃を選択してください。')); continue; }
    const time = Date.parse(attack.occurrenceTime); parsedTimes.push(time);
    if (!Number.isFinite(time)) errors.push(issue('INVALID_OCCURRENCE_TIME', `attacks.${attack.order}.occurrenceTime`,
      '発生日時の形式が不正です。', '日付と時刻を指定してください。'));
    if (!nodes.has(attack.sourceNodeId) || !nodes.has(attack.targetNodeId)) errors.push(issue(
      'BROKEN_REFERENCE', `attacks.${attack.order}.sourceNodeId`, 'Attackが存在しないNodeを参照しています。', '既存Nodeを選択してください。'));
    const service = services.get(attack.targetServiceId);
    if (!service || service.nodeId !== attack.targetNodeId) errors.push(issue(
      'TARGET_SERVICE_MISMATCH', `attacks.${attack.order}.targetServiceId`, '対象Serviceが対象Node上に存在しません。', '対象NodeのServiceを選択してください。'));
    const investigationNode = nodes.get(attack.investigationSourceNodeId);
    for (const type of attack.investigationTypes) {
      if (!definition.supportedInvestigationTypes.includes(type)) errors.push(issue(
        'UNSUPPORTED_INVESTIGATION', `attacks.${attack.order}.investigationTypes`,
        `${labels[attack.attackId] ?? attack.attackId}では${INVESTIGATION_TYPES[type]?.label ?? type}を選択できません。`,
        'Attack Definitionに登録された調査方法を選択してください。'));
      if (!investigationNode?.logSources.includes(type)) errors.push(issue(
        'INVESTIGATION_SOURCE_UNAVAILABLE', `attacks.${attack.order}.investigationSourceNodeId`,
        '選択した調査資料は指定Nodeに存在しません。', '該当Log Sourceを持つNodeを選択してください。'));
    }
  }
  for (let index = 1; index < parsedTimes.length; index += 1) if (parsedTimes[index] <= parsedTimes[index - 1]) {
    errors.push(issue('INVALID_TIME_ORDER', `attacks.${index + 1}.occurrenceTime`,
      'Attack発生時刻がAttack Orderと一致しません。', '後段Attackを前段より後の時刻にしてください。'));
  }
  let technical = null;
  if (!errors.length) {
    try { technical = buildTechnicalContracts(configuration, catalog); errors.push(...technical.errors); }
    catch (error) { errors.push(issue(error.code ?? 'TECHNICAL_CONTRACT_UNSATISFIABLE',
      error.field ?? 'configuration', error.message, 'NetworkとAttack Detailの成立条件を確認してください。')); }
  }
  return { status: errors.length ? 'INVALID' : 'VALID', errors,
    technical: errors.length ? null : technical };
}

export function buildScenarioPreview(configuration, scenarioPackage = null) {
  const nodes = new Map(configuration.network.nodes.map(item => [item.nodeId, item]));
  const services = new Map(configuration.network.services.map(item => [item.serviceId, item]));
  return { configurationId: configuration.configurationId, mode: configuration.mode,
    incidentSummary: scenarioPackage?.scenarioDraft?.summary
      ?? `${configuration.incidentContext.organizationName}で発生したセキュリティ事件を調査します。`,
    attacks: [...configuration.attacks].sort((a, b) => a.order - b.order).map(item => ({
      order: item.order, attackId: item.attackId, label: labels[item.attackId] ?? item.attackId,
      occurrenceTime: item.occurrenceTime, source: nodes.get(item.sourceNodeId)?.label,
      target: nodes.get(item.targetNodeId)?.label, targetService: services.get(item.targetServiceId)?.label,
      investigations: item.investigationTypes.map(type => ({ id: type, label: INVESTIGATION_TYPES[type].label })),
    })),
    targetSystem: configuration.incidentContext.victimSystem,
    difficulty: configuration.difficulty, difficultyLabel: '★'.repeat(configuration.difficulty),
    network: structuredClone(configuration.network),
  };
}
