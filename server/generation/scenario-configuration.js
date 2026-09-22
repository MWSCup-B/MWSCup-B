import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { validateDocument, ValidationError } from './schema.js';
import { buildAttackGraphs } from './attack-graph.js';
import { buildScenarioGenerationInputs } from './scenario-interface.js';
import { requestedCourtIssueCount } from './court-issues.js';
import { AUTHOR_ATTACK_CHOICES, SCENARIO_SETTINGS } from './author-options.js';
import { buildIncidentOverview } from './incident-report.js';

export const INVESTIGATION_TYPES = Object.freeze({
  WEB_LOG: { label: 'Webアクセスログ', actionId: 'action_audit_log' },
  PROXY_LOG: { label: 'Proxyログ', actionId: 'action_analyze_network_log' },
  AUTH_LOG: { label: '認証ログ', actionId: 'action_review_auth_log' },
  APPLICATION_LOG: { label: 'Applicationログ', actionId: 'action_audit_log' },
  NETWORK_LOG: { label: 'Networkログ', actionId: 'action_analyze_network_log' },
  EMAIL: { label: 'メール', actionId: 'action_check_email' },
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
  credential_phishing: 'フィッシング（資格情報入力）', stored_xss: 'Stored XSS',
  unauthorized_login: '不正ログイン',
  ...Object.fromEntries(AUTHOR_ATTACK_CHOICES.map(item => [item.id, item.label])),
});

export const MANUAL_ATTACK_CHOICES = Object.freeze([
  { id: 'phishing', label: 'フィッシング' },
  { id: 'stored_xss', label: 'Stored XSS' },
  { id: 'unauthorized_login', label: '不正ログイン' },
]);

// 受信Configurationの補完ではなく、攻撃確定時に利用者が確認する初期値だけを作る。
// 入力後の変更・検証・真実丸には適用しない。旧リンク誘導モデルも維持する。
export function createManualAttackPreset(attackIds, catalog) {
  if (!Array.isArray(attackIds) || !attackIds.length || attackIds.length > 3
    || new Set(attackIds).size !== attackIds.length
    || attackIds.some(id => !MANUAL_ATTACK_CHOICES.some(choice => choice.id === id))) {
    throw new ValidationError('INVALID_ATTACK_SELECTION', 'attackIds', '登録済みの攻撃を重複なく1～3種類選択してください。');
  }
  const has = id => attackIds.includes(id);
  const capture = has('phishing') && has('unauthorized_login');
  const ids = [has('phishing') && (capture ? 'credential_phishing' : 'phishing'),
    has('unauthorized_login') && 'unauthorized_login', has('stored_xss') && 'stored_xss'].filter(Boolean);
  const configuration = createDefaultConfiguration({ attackIds: [], difficulty: attackIds.length,
    incidentDate: '2026-09-18' });
  if (has('unauthorized_login')) {
    configuration.incidentContext.victimSystem = '社内ポータル（認証連携・投稿機能）';
    configuration.incidentContext.initialSuspicionReason =
      '調査担当者が認証成功のアカウントを被告人の利用と結び付けたため。アカウントと人物の対応は疑う側の主張であり、技術記録からは未確認。';
  } else if (has('stored_xss')) {
    configuration.incidentContext.initialSuspicionReason =
      '調査担当者が投稿の閲覧記録を被告人による投稿と結び付けたため。閲覧者と投稿者の同一性や、被告人との対応は未確認。';
  }
  const { network } = configuration;
  if (has('unauthorized_login')) {
    network.nodes.push({ nodeId: 'auth-host', label: '認証サーバー', nodeType: 'SERVER', os: 'linux',
      ip: '10.10.0.60', subnetId: 'internal-net', trustBoundaryId: 'internal',
      roles: ['authentication_server'], logSources: ['AUTH_LOG', 'APPLICATION_LOG', 'CONFIGURATION'] });
    network.services.push({ serviceId: 'auth-service', nodeId: 'auth-host', label: 'Portal Authentication',
      serviceType: 'authentication', platform: 'auth' });
    network.connections.push({ fromNodeId: 'sender-host', toNodeId: 'auth-host' },
      { fromNodeId: 'web-host', toNodeId: 'auth-host' });
  }
  if (capture) {
    network.nodes.push({ nodeId: 'lure-host', label: '偽フォームサーバー（教材）', nodeType: 'WEB_SERVER', os: 'linux',
      ip: '203.0.113.20', subnetId: 'external-net', trustBoundaryId: 'external',
      roles: ['web_server'], logSources: ['WEB_LOG', 'APPLICATION_LOG', 'CONFIGURATION'] });
    network.services.push({ serviceId: 'lure-service', nodeId: 'lure-host', label: 'Synthetic Lure Web',
      serviceType: 'web_application', platform: 'web' });
    network.connections.push({ fromNodeId: 'client-host', toNodeId: 'lure-host' },
      { fromNodeId: 'sender-host', toNodeId: 'lure-host' });
  }
  const specs = {
    phishing: { investigationTypes: ['EMAIL'], investigationSourceNodeId: 'mail-host',
      evidenceAnswer: 'メール文のリンク先と実際に遷移するリンク先が異なること',
      notes: 'リンク誘導のみ。メール保存とクリックは区別する。資格情報窃取は含まない。' },
    credential_phishing: { targetNodeId: 'lure-host', targetServiceId: 'lure-service',
      investigationTypes: ['EMAIL'], investigationSourceNodeId: 'mail-host',
      evidenceAnswer: 'メールの表示URLと実際のhrefが異なり、偽フォームへの送信記録は正規サービスでの認証成功とは別であること。',
      notes: 'リンク誘導に加え、偽フォームへの資格情報入力・送信・受信を明示した教材。送信記録は調査可能な合成資料で秘密値を含めない。認証先はauth-service。クリックだけで窃取とはしない。' },
    unauthorized_login: { investigationTypes: ['AUTH_LOG'], investigationSourceNodeId: 'auth-host',
      evidenceAnswer: '認証ログとWeb側のセッション監査は同じアカウントの認証・投稿権限を示すが、それだけで実際の操作者を被告人と特定できないこと。',
      notes: `${capture ? '前段の偽フォームで取得した' : '初期条件として取得済みの'}有効な資格情報を悪用する。認証先auth-service、投稿先web-service。教材はパスワードのみの認証・投稿権限に限定し、MFA突破や管理者権限は仮定しない。` },
    stored_xss: { investigationTypes: ['APPLICATION_LOG', 'WEB_LOG'], investigationSourceNodeId: 'web-host',
      evidenceAnswer: '保存投稿と後の閲覧記録・ブラウザ計測を照合するとStored XSSの実行を確認できるが、閲覧端末の利用記録は投稿者の特定にはならないこと。',
      notes: `${has('unauthorized_login') ? '前段の不正ログインによる投稿権限' : '初期条件として明示した投稿権限'}を使用。投稿の保存は閲覧前に完了している条件。発生日時は閲覧時の実行時点で、投稿時刻とは別。出力エンコード・サニタイズが不足し、実効CSPは実行を阻止しない。ブラウザ計測を取得可能とする。資格情報窃取は効果に含めない。` },
  };
  configuration.attacks = ids.map((attackId, index) => {
    const definition = catalog.find(item => item.id === attackId);
    if (!definition) throw new ValidationError('UNREGISTERED_ATTACK', 'attackIds', `攻撃定義${attackId}がありません。`);
    return { attackId, order: index + 1,
      occurrenceTime: `2026-09-18T09:${10 + index * 8}:00+09:00`,
      sourceNodeId: 'sender-host', targetNodeId: 'web-host', targetServiceId: 'web-service',
      expectedEffect: definition.effects.at(-1).description, ...specs[attackId] };
  });
  return configuration;
}

export function scenarioCreationBootstrap(catalog) {
  // Authorの初期入力だけに適用する。真実丸や受信済みConfigurationを上書きしない。
  const defaultManualConfiguration = createDefaultConfiguration({
    mode: 'MANUAL', difficulty: 1, attackIds: ['phishing'], incidentDate: '2026-09-18',
  });
  defaultManualConfiguration.attacks[0].evidenceAnswer =
    'メール文のリンク先と実際に遷移するリンク先が異なること';
  return {
    attackChoices: structuredClone(AUTHOR_ATTACK_CHOICES),
    settings: SCENARIO_SETTINGS.map(({ id, label }) => ({ id, label })),
    selectionDefaults: { schemaVersion: '1.0', attackIds: ['phishing'], settingId: 'company' },
    maxSelectedAttacks: 3,
    modes: [
      { id: 'MANUAL', label: '詳細設定', description: '攻撃手法、Network、発生時間、調査方法などを自分で設定します。' },
      { id: 'MAKOTOMARU', label: '真実丸', description: 'AIがScenario条件を自動的に選びます。' },
    ],
    attacks: catalog.map(item => ({ id: item.id, label: item.label, category: item.category,
      supportedInvestigationTypes: [...item.supportedInvestigationTypes],
      expectedEffects: item.effects.map(effect => ({ id: effect.predicate,
        label: effect.description })) })),
    investigationTypes: Object.entries(INVESTIGATION_TYPES).map(([id, item]) => ({ id, label: item.label })),
    difficulties: [1, 2, 3].map(difficulty => ({ difficulty, label: '★'.repeat(difficulty), requiredEvidenceCount: difficulty })),
    nodeTypes: ['CLIENT', 'SERVER', 'PROXY', 'WEB_SERVER', 'DATABASE', 'AD', 'FILE_SERVER', 'LOG_SERVER', 'MAIL_SERVER', 'EXTERNAL'],
    defaultNetwork: structuredClone(DEFAULT_DESIGN_NETWORK),
    defaultManualConfiguration,
    manualAttackChoices: structuredClone(MANUAL_ATTACK_CHOICES),
    manualAttackPresets: Array.from({ length: 7 }, (_, index) => {
      const attackIds = MANUAL_ATTACK_CHOICES.filter((_, bit) => (index + 1) & (1 << bit)).map(item => item.id);
      return { attackIds, configuration: createManualAttackPreset(attackIds, catalog) };
    }),
  };
}

export function createDefaultConfiguration({ mode = 'MANUAL', difficulty = 1,
  attackIds = ['reflected_xss'], incidentDate = '2026-01-15' } = {}) {
  const specs = {
    phishing: { sourceNodeId: 'sender-host', investigationSourceNodeId: 'mail-host', investigations: ['EMAIL'], evidenceAnswer: '送信元と誘導先を示すメールヘッダーおよび本文が、後続のWebアクセスと同じ時系列にある。', effect: 'この利用者・ブラウザ・Webサービス・リクエストに限定したアクセス。認証情報取得やコード実行を意味しない。' },
    reflected_xss: { sourceNodeId: 'client-host', investigationSourceNodeId: 'web-host', investigations: ['WEB_LOG'], evidenceAnswer: '対象時刻のWebアクセスログに、反射された入力を含む同一リクエストが記録されている。', effect: 'このブラウザの対象Webオリジンでスクリプトが実行される。Webオリジンを越えた権限やDB権限を付与しない。' },
    sql_injection: { sourceNodeId: 'sender-host', investigationSourceNodeId: 'web-host', investigations: ['WEB_LOG'], evidenceAnswer: 'Webログとアプリケーション記録に、対象時刻のSQL構文を変化させた入力が対応して記録されている。', effect: '当該リクエストによりSQLが改変され、指定されたDB主体の権限範囲内で実行される。具体的な漏えい・改変被害は別途条件が必要。' },
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
      evidenceAnswer: specs[attackId].evidenceAnswer,
      expectedEffect: specs[attackId].effect, notes: '' })),
    incidentContext: { incidentDate, organizationName: '青葉ソリューションズ',
      victimSystem: '社内ポータル', accusedRole: 'システム利用者',
      initialSuspicionReason: '被告人の利用端末に割り当てられたIPアドレスが記録に含まれていたため。' },
  };
}

function issue(code, field, reason, correctionHint, details = {}) {
  return { code, field, reason, correctionHint, ...details };
}

function cloneForNormalization(value) {
  if (value === undefined) return value;
  return structuredClone(value);
}

function aliasMap(items, idKey, labelKey = 'label') {
  const result = new Map();
  for (const item of items ?? []) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item[idKey] === 'string') result.set(item[idKey], item[idKey]);
    if (typeof item[labelKey] === 'string') result.set(item[labelKey], item[idKey]);
  }
  return result;
}

function canonicalAlias(value, aliases) {
  return typeof value === 'string' ? aliases.get(value.trim()) ?? value.trim() : value;
}

function normalizeOccurrenceTime(value, offset) {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00${offset}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)) {
    return `${normalized}${offset}`;
  }
  return normalized;
}

// UI表示値を受け取れる唯一の境界。ここでcanonical ID/date-timeへ変換してからSchemaを検証する。
export function normalizeScenarioConfiguration(input, catalog, { offset = '+09:00' } = {}) {
  const configuration = cloneForNormalization(input);
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    return configuration;
  }
  const network = configuration.network;
  const attacks = configuration.attacks;
  const attackAliases = aliasMap(catalog, 'id');
  for (const [id, label] of Object.entries(labels)) attackAliases.set(label, id);
  const investigationAliases = new Map(Object.entries(INVESTIGATION_TYPES)
    .flatMap(([id, item]) => [[id, id], [item.label, id]]));
  const nodeAliases = aliasMap(network?.nodes, 'nodeId');
  const serviceAliases = aliasMap(network?.services, 'serviceId');
  const subnetAliases = aliasMap(network?.subnets, 'subnetId');

  for (const node of network?.nodes ?? []) {
    node.subnetId = canonicalAlias(node.subnetId, subnetAliases);
    if (Array.isArray(node.logSources)) node.logSources = node.logSources
      .map(value => canonicalAlias(value, investigationAliases));
  }
  for (const service of network?.services ?? []) {
    service.nodeId = canonicalAlias(service.nodeId, nodeAliases);
  }
  for (const connection of network?.connections ?? []) {
    connection.fromNodeId = canonicalAlias(connection.fromNodeId, nodeAliases);
    connection.toNodeId = canonicalAlias(connection.toNodeId, nodeAliases);
  }
  for (const attack of attacks ?? []) {
    attack.attackId = canonicalAlias(attack.attackId, attackAliases);
    attack.occurrenceTime = normalizeOccurrenceTime(attack.occurrenceTime, offset);
    attack.sourceNodeId = canonicalAlias(attack.sourceNodeId, nodeAliases);
    attack.targetNodeId = canonicalAlias(attack.targetNodeId, nodeAliases);
    attack.targetServiceId = canonicalAlias(attack.targetServiceId, serviceAliases);
    attack.investigationSourceNodeId = canonicalAlias(attack.investigationSourceNodeId,
      nodeAliases);
    if (Array.isArray(attack.investigationTypes)) attack.investigationTypes =
      attack.investigationTypes.map(value => canonicalAlias(value, investigationAliases));
  }
  return configuration;
}

function validCidr(value) {
  const separator = value.lastIndexOf('/');
  if (separator <= 0) return false;
  const address = value.slice(0, separator); const prefix = Number(value.slice(separator + 1));
  const version = isIP(address);
  return version === 4 ? Number.isInteger(prefix) && prefix >= 0 && prefix <= 32
    : version === 6 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 128;
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
  const auth = findService(network, 'authentication');
  const entities = { attacker: 'actor-a', victim: 'user-a', db_principal: 'db-account', request: chainRequestId,
    account: 'account-a', auth: auth?.serviceId, auth_host: auth?.nodeId };
  if (attack.attackId === 'password_spray') return { ...entities, source: attack.sourceNodeId };
  if (['clickfix', 'ransomware'].includes(attack.attackId)) {
    const browser = findService(network, 'web_browser');
    return { ...entities, client: browser?.nodeId, browser: browser?.serviceId,
      web_host: attack.targetNodeId, web: attack.targetServiceId,
      endpoint: network.services.find(item => item.nodeId === browser?.nodeId && item.serviceType === 'logging')?.serviceId,
      files: network.services.find(item => item.nodeId === browser?.nodeId && item.serviceType === 'file')?.serviceId };
  }
  if (attack.attackId === 'unrestricted_file_upload') return { ...entities,
    source: attack.sourceNodeId, web_host: attack.targetNodeId, web: attack.targetServiceId,
    files: network.services.find(item => item.nodeId === attack.targetNodeId && item.serviceType === 'file')?.serviceId };
  if (['phishing', 'credential_phishing'].includes(attack.attackId)) {
    const browser = findService(network, 'web_browser'); const mail = findService(network, 'email');
    return { ...entities, sender: attack.sourceNodeId, client: browser?.nodeId,
      browser: browser?.serviceId, mail_host: mail?.nodeId, mail: mail?.serviceId,
      web_host: attack.targetNodeId, web: attack.targetServiceId };
  }
  if (attack.attackId === 'unauthorized_login') return { ...entities,
    source: attack.sourceNodeId, web_host: attack.targetNodeId, web: attack.targetServiceId };
  if (attack.attackId === 'stored_xss') {
    const browser = findService(network, 'web_browser');
    return { ...entities, source: attack.sourceNodeId, client: browser?.nodeId,
      browser: browser?.serviceId, web_host: attack.targetNodeId, web: attack.targetServiceId };
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
  const phishing = sorted.find(attack => attack.attackId === 'phishing');
  const chained = sorted.filter(attack => ['reflected_xss', 'stored_xss', 'clickfix'].includes(attack.attackId)
    && phishing && attack.targetServiceId === phishing.targetServiceId);
  const chainIds = new Set(chained.length ? ['phishing', ...chained.map(attack => attack.attackId)] : []);
  const bindings = new Map(sorted.map((attack, index) => [attack.attackId,
    resolvedBindings(configuration, attack, chainIds.has(attack.attackId)
      ? 'chain-request' : `request-${index + 1}`)]));
  const candidate = { schemaVersion: '1.0', selectedAttackIds: sorted.map(item => item.attackId),
    assignments: sorted.map(attack => ({ attackId: attack.attackId,
      bindings: definitions.get(attack.attackId).bindings.map(binding => ({ name: binding.id,
        entityId: bindings.get(attack.attackId)[binding.id] ?? 'missing-binding' })) })) };
  const scenarioContext = { schemaVersion: '1.0', entities: [
    { id: 'actor-a', type: 'actor' }, { id: 'user-a', type: 'user' },
    { id: 'db-account', type: 'database_principal' },
    ...(sorted.some(attack => ['credential_phishing', 'unauthorized_login', 'password_spray'].includes(attack.attackId))
      ? [{ id: 'account-a', type: 'account' }] : []),
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
  const orderByNode = new Map(connected.nodes.map(node => [node.nodeId,
    sorted.find(attack => attack.attackId === node.attackDefinitionId).order]));
  if ([...connected.edges.map(edge => ({ before: edge.from, after: edge.to })),
    ...connected.executionConstraints].some(edge => orderByNode.get(edge.before) >= orderByNode.get(edge.after))) {
    return { errors: [issue('ATTACK_DEPENDENCY_ORDER_MISMATCH', 'attacks.order',
      'Attack Orderが前段の効果を必要とする攻撃経路と一致しません。',
      '資格情報取得→不正ログイン→保存投稿のように、前提条件を作る攻撃を先にしてください。')] };
  }
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
      '入力欄を確認し、定義済みの値を選択してください。', {
        receivedType: error.receivedType ?? null, length: error.length ?? null,
        expectedMinLength: error.expectedMinLength ?? null,
        expectedMaxLength: error.expectedMaxLength ?? null,
        expectedPattern: error.expectedPattern ?? null,
        expectedFormat: error.expectedFormat ?? null,
      })], technical: null };
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
  const subnetList = configuration.network.subnets;
  const subnets = new Map(subnetList.map(item => [item.subnetId, item]));
  unique(subnetList.map(item => item.subnetId), 'network.subnets.subnetId');
  unique(configuration.network.nodes.map(item => item.nodeId), 'network.nodes.nodeId');
  unique(configuration.network.nodes.map(item => item.ip), 'network.nodes.ip');
  unique(configuration.network.services.map(item => item.serviceId), 'network.services.serviceId');
  unique(configuration.network.connections.map(item => `${item.fromNodeId}->${item.toNodeId}`),
    'network.connections');
  for (const subnet of subnetList) if (!validCidr(subnet.cidr)) errors.push(issue(
    'INVALID_CIDR', `network.subnets.${subnet.subnetId}.cidr`, 'SubnetのCIDR形式が不正です。',
    'IPv4またはIPv6のCIDR（例: 10.10.0.0/24）を指定してください。'));
  for (const node of configuration.network.nodes) {
    const subnet = subnets.get(node.subnetId);
    if (!subnet) errors.push(issue(
      'BROKEN_REFERENCE', `network.nodes.${node.nodeId}.subnetId`, '存在しないSubnetを参照しています。', '既存Subnetを選択してください。'));
    else if (node.trustBoundaryId !== subnet.trustBoundaryId) errors.push(issue(
      'TRUST_BOUNDARY_MISMATCH', `network.nodes.${node.nodeId}.trustBoundaryId`,
      'NodeのTrust Boundaryが所属Subnetと一致しません。', '所属SubnetのTrust Boundaryを選択してください。'));
    if (!isIP(node.ip)) errors.push(issue('INVALID_IP_ADDRESS', `network.nodes.${node.nodeId}.ip`,
      'NodeのIPアドレス形式が不正です。', '有効なIPv4またはIPv6アドレスを指定してください。'));
  }
  for (const service of services.values()) if (!nodes.has(service.nodeId)) errors.push(issue(
    'BROKEN_REFERENCE', `network.services.${service.serviceId}.nodeId`, '存在しないNodeを参照しています。', '既存Nodeを選択してください。'));
  for (const [index, connection] of configuration.network.connections.entries()) {
    if (!nodes.has(connection.fromNodeId) || !nodes.has(connection.toNodeId)) errors.push(issue(
      'BROKEN_REFERENCE', `network.connections.${index}`,
      'Connectionが存在しないNodeを参照しています。', '接続元と接続先に既存Nodeを選択してください。'));
  }
  const parsedTimes = [];
  for (const attack of attacks) {
    const definition = catalogMap.get(attack.attackId);
    if (!definition) { errors.push(issue('UNREGISTERED_ATTACK', `attacks.${attack.order}.attackId`,
      '実装されていないAttackです。', 'Attack Definitionに登録された攻撃を選択してください。')); continue; }
    if (!definition.effects.some(effect => effect.description === attack.expectedEffect)) {
      errors.push(issue('UNSUPPORTED_EXPECTED_EFFECT', `attacks.${attack.order}.expectedEffect`,
        'Attack Definitionに存在しない想定効果です。',
        `次の登録済みAttack Effectを完全一致で選択してください: ${definition.effects
          .map(effect => effect.description).join(' / ')}`));
    }
    const time = Date.parse(attack.occurrenceTime); parsedTimes.push(time);
    if (!Number.isFinite(time)) errors.push(issue('INVALID_OCCURRENCE_TIME', `attacks.${attack.order}.occurrenceTime`,
      '発生日時の形式が不正です。', '日付と時刻を指定してください。'));
    else if (attack.occurrenceTime.slice(0, 10) !== configuration.incidentContext.incidentDate) {
      errors.push(issue('INCIDENT_DATE_MISMATCH', `attacks.${attack.order}.occurrenceTime`,
        'Attack発生日が事件日と一致しません。', '事件日と同じ日付の発生日時を指定してください。'));
    }
    if (!nodes.has(attack.sourceNodeId) || !nodes.has(attack.targetNodeId)) errors.push(issue(
      'BROKEN_REFERENCE', `attacks.${attack.order}.sourceNodeId`, 'Attackが存在しないNodeを参照しています。', '既存Nodeを選択してください。'));
    const service = services.get(attack.targetServiceId);
    if (!service || service.nodeId !== attack.targetNodeId) errors.push(issue(
      'TARGET_SERVICE_MISMATCH', `attacks.${attack.order}.targetServiceId`, '対象Serviceが対象Node上に存在しません。', '対象NodeのServiceを選択してください。'));
    const investigationNode = nodes.get(attack.investigationSourceNodeId);
    if (/^(?:正解|答え)[:：]?\s*$/u.test(attack.evidenceAnswer)) errors.push(issue(
      'EMPTY_EVIDENCE_ANSWER', `attacks.${attack.order}.evidenceAnswer`,
      '証拠から確認できる具体的な事実がありません。',
      'ログやメール等から読み取れる時刻、送信元、要求内容などを記載してください。'));
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

export function buildScenarioPreview(configuration, scenarioPackage = null, generationInput = null) {
  const nodes = new Map(configuration.network.nodes.map(item => [item.nodeId, item]));
  const services = new Map(configuration.network.services.map(item => [item.serviceId, item]));
  return { configurationId: configuration.configurationId, mode: configuration.mode,
    incidentSummary: scenarioPackage?.scenarioDraft?.summary
      ?? buildIncidentOverview(configuration, generationInput),
    attacks: [...configuration.attacks].sort((a, b) => a.order - b.order).map(item => ({
      order: item.order, attackId: item.attackId, label: labels[item.attackId] ?? item.attackId,
      occurrenceTime: item.occurrenceTime, source: nodes.get(item.sourceNodeId)?.label,
      target: nodes.get(item.targetNodeId)?.label, targetService: services.get(item.targetServiceId)?.label,
      investigations: item.investigationTypes.map(type => ({ id: type, label: INVESTIGATION_TYPES[type].label })),
    })),
    targetSystem: configuration.incidentContext.victimSystem,
    difficulty: configuration.difficulty,
    difficultyLabel: `${'★'.repeat(configuration.difficulty)} / ${generationInput
      ? `${requestedCourtIssueCount(configuration, generationInput)}件の調査` : '調査対象ごとに審理'}`,
    network: structuredClone(configuration.network),
  };
}
