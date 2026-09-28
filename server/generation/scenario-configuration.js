import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { validateDocument, ValidationError } from './schema.js';
import { buildAttackGraphs } from './attack-graph.js';
import { buildScenarioGenerationInputs } from './scenario-interface.js';
import { requestedCourtIssueCount } from './court-issues.js';
import { AUTHOR_ATTACK_CHOICES, SCENARIO_SETTINGS } from './author-options.js';
import { buildIncidentOverview } from './incident-report.js';
import { incidentDefinitions } from './incident-design.js';

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
      evidenceAnswer: '保存投稿と後の閲覧記録・ブラウザの動作記録を照合するとStored XSSの実行を確認できるが、閲覧端末の利用記録は投稿者の特定にはならないこと。',
      notes: `${has('unauthorized_login') ? '前段の不正ログインによる投稿権限' : '初期条件として明示した投稿権限'}を使用。投稿の保存は閲覧前に完了している条件。発生日時は閲覧時の実行時点で、投稿時刻とは別。出力エンコード・サニタイズが不足し、実効CSPは実行を阻止しない。ブラウザの動作記録を取得可能とする。資格情報窃取は効果に含めない。` },
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

// 2026-09-20 修正前: 対象OS・全Role・ローカル攻撃を識別し、カタログ位置から独立した初期値を作成
// function presetAttackConfiguration(definition, network, index = 0, incidentDate = '2026-01-15') {
//   if (!definition.authoring) return null;
//   const serviceRequirement = binding => definition.requiredServices.find(item => item.binding === binding);
//   const roleRequirement = binding => definition.requiredRoles.find(item => item.binding === binding);
//   const serviceFor = binding => {
//     const requirement = serviceRequirement(binding);
//     if (!requirement) return null;
//     const nodeRoles = roleRequirement(requirement.node)?.values ?? [];
//     const candidates = network.services.filter(service => requirement.values.includes(service.serviceType)
//       && (!nodeRoles.length || nodeRoles.some(role => network.nodes
//         .find(node => node.nodeId === service.nodeId)?.roles.includes(role))));
//     return candidates.length === 1 ? candidates[0] : null;
//   };
//   const targetService = serviceFor(definition.authoring.targetServiceBinding);
//   const investigationService = serviceFor(definition.authoring.investigationServiceBinding);
//   const sourceRoles = roleRequirement(definition.authoring.sourceNodeBinding)?.values ?? [];
//   const sourceCandidates = network.nodes.filter(node => sourceRoles.length
//     ? sourceRoles.some(role => node.roles.includes(role)) : node.nodeType === 'EXTERNAL');
//   if (!targetService || !investigationService || sourceCandidates.length !== 1) return null;
//   return { attackId: definition.id, order: index + 1,
//     occurrenceTime: `${incidentDate}T09:${String(10 + index * 8).padStart(2, '0')}:00+09:00`,
//     sourceNodeId: sourceCandidates[0].nodeId, targetNodeId: targetService.nodeId,
//     targetServiceId: targetService.serviceId,
//     investigationTypes: [definition.authoring.preferredInvestigationType],
//     investigationSourceNodeId: investigationService.nodeId,
//     evidenceAnswer: definition.authoring.evidenceAnswer,
//     expectedEffect: definition.effects[0].description, notes: '' };
// }
//
// 2026-09-20 修正後: 対象OS・全Role・ローカル攻撃を識別し、カタログ位置から独立した初期値を作成
function presetAttackConfiguration(definition, network, index = 0, incidentDate = '2026-01-15') {
  if (!definition.authoring) return null;
  const serviceFor = binding => {
    const requirement = definition.requiredServices.find(item => item.binding === binding);
    if (!requirement) return null;
    const roles = definition.requiredRoles.find(item => item.binding === requirement.node)?.values ?? [];
    const candidates = network.services.filter(service => {
      const host = network.nodes.find(node => node.nodeId === service.nodeId);
      return requirement.values.includes(service.serviceType) && host
        && roles.every(role => host.roles.includes(role))
        && definition.platforms.every(rule => rule.binding === binding ? rule.values.includes(service.platform)
          : rule.binding === requirement.node ? rule.values.includes(host.os) : true);
    });
    return candidates.length === 1 ? candidates[0] : null;
  };
  const target = serviceFor(definition.authoring.targetServiceBinding);
  const investigation = serviceFor(definition.authoring.investigationServiceBinding);
  const local = definition.requiredServices.some(item => item.binding === definition.authoring.targetServiceBinding
    && item.node === definition.authoring.sourceNodeBinding);
  const roles = definition.requiredRoles.find(item => item.binding === definition.authoring.sourceNodeBinding)?.values ?? [];
  const sources = network.nodes.filter(node => local ? node.nodeId === target?.nodeId
    : roles.length ? roles.every(role => node.roles.includes(role)) : node.nodeType === 'EXTERNAL');
  if (!target || !investigation || sources.length !== 1) return null;
  const minute = 9 * 60 + 10 + index * 8;
  const attack = { attackId: definition.id, order: index + 1,
    occurrenceTime: incidentDate + 'T' + String(Math.floor(minute / 60)).padStart(2, '0') + ':'
      + String(minute % 60).padStart(2, '0') + ':00+09:00',
    sourceNodeId: sources[0].nodeId, targetNodeId: target.nodeId, targetServiceId: target.serviceId,
    investigationTypes: [definition.authoring.preferredInvestigationType],
    investigationSourceNodeId: investigation.nodeId, evidenceAnswer: definition.authoring.evidenceAnswer,
    expectedEffect: definition.effects[0].description, notes: '' };
  // 2026-09-24: 追加攻撃の補助Serviceも解決できる構成だけを候補表示する。
  try { resolveAuthoringBindings(canonicalNetwork(network), attack, definition); }
  catch (error) { if (error instanceof ValidationError) return null; throw error; }
  return attack;
}

export function scenarioCreationBootstrap(catalog, networkPresets = []) {
  // Authorの初期入力だけに適用する。真実丸や受信済みConfigurationを上書きしない。
  const defaultManualConfiguration = createDefaultConfiguration({
    mode: 'MANUAL', difficulty: 1, attackIds: ['phishing'], incidentDate: '2026-09-18',
  });
  const defaultNetworkPreset = networkPresets.find(item => item.id === 'corporate-flat');
  const phishingDefinition = catalog.find(item => item.id === 'phishing');
  if (defaultNetworkPreset && phishingDefinition) {
    defaultManualConfiguration.network = structuredClone(defaultNetworkPreset.network);
    defaultManualConfiguration.attacks = [presetAttackConfiguration(phishingDefinition,
      defaultNetworkPreset.network, 0, '2026-09-18')];
  }
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
// 2026-09-20 修正前: 任意の段階から選び、成立に必要な開始条件を確認する
//     attacks: catalog.map(item => ({ id: item.id, label: item.label, category: item.category,
// 2026-09-20 修正後: 任意の段階から選び、成立に必要な開始条件を確認する
    attackSelectionLimit: 6,
    attackStages: [
      { id: 'DELIVERY', label: '初動・誘導' }, { id: 'INITIAL_ACCESS', label: '侵入・外部からの悪用' },
      { id: 'EXECUTION', label: '実行' }, { id: 'PRIVILEGE_ESCALATION', label: '権限昇格' },
      { id: 'COLLECTION', label: '侵入後・情報収集' },
    ],
    attacks: catalog.map(item => ({ id: item.id, label: item.label, category: item.category,
      stages: item.stages ?? ['INITIAL_ACCESS'], description: item.description,
      startingConditions: [...item.prerequisites, ...item.requiredPrivileges].map(condition => condition.description),
      supportedInvestigationTypes: [...item.supportedInvestigationTypes],
      authoring: structuredClone(item.authoring),
      expectedEffects: item.effects.map(effect => ({ id: effect.predicate,
        label: effect.description })) })),
    investigationTypes: Object.entries(INVESTIGATION_TYPES).map(([id, item]) => ({ id, label: item.label })),
    difficulties: [1, 2, 3].map(difficulty => ({ difficulty, label: '★'.repeat(difficulty), requiredEvidenceCount: difficulty })),
    nodeTypes: ['CLIENT', 'SERVER', 'PROXY', 'WEB_SERVER', 'DATABASE', 'AD', 'FILE_SERVER', 'LOG_SERVER', 'MAIL_SERVER', 'EXTERNAL'],
    defaultNetwork: structuredClone(DEFAULT_DESIGN_NETWORK),
    networkPresets: networkPresets.map(preset => ({ ...structuredClone(preset),
      attackDefaults: catalog.map((definition, index) =>
// 2026-09-20 修正前: テンプレートの攻撃順・時刻をカタログ位置に依存させない
//         presetAttackConfiguration(definition, preset.network, index, '2026-09-18')).filter(Boolean) })),
// 2026-09-20 修正後: テンプレートの攻撃順・時刻をカタログ位置に依存させない
        presetAttackConfiguration(definition, preset.network, 0, '2026-09-18')).filter(Boolean) })),
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
    sql_injection: { sourceNodeId: 'sender-host', investigationSourceNodeId: 'web-host', investigations: ['WEB_LOG'], evidenceAnswer: 'Web記録の時刻・要求対象と、対応するDB監査の実行SQLの識別情報を照合する。DB記録のSQLの条件・構造を読み、要求の到達とSQLの実行を区別する。Web入力本文の記録は前提にしない。', effect: '当該リクエストによりSQLが改変され、指定されたDB主体の権限範囲内で実行される。具体的な漏えい・改変被害は別途条件が必要。' },
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

// 2026-09-20 修正前: Role単独の先決めと共有Requestを廃止し、制約を同時に評価する
// const entityIds = Object.freeze({ actor: 'actor-a', user: 'user-a',
//   database_principal: 'db-account', web_request: 'shared-web-request' });
//
// function onlyCandidate(items, field, description) {
//   if (items.length === 1) return items[0];
//   throw new ValidationError(items.length ? 'AMBIGUOUS_BINDING' : 'MISSING_BINDING', field,
//     `${description}${items.length ? 'が複数あり一意に決まりません。' : 'が構成内にありません。'}`);
// }
//
// // Attack Definitionの制約とAuthoring hintから割当てを解決する。攻撃IDやNode IDには依存しない。
// function resolvedBindings(configuration, attack, definition) {
//   const network = configuration.network;
//   const result = {};
//   const bindingKinds = new Map(definition.bindings.map(item => [item.id, item.kind]));
//   for (const target of definition.targetTypes) {
//     const candidates = target.values.map(type => entityIds[type]).filter(Boolean);
//     result[target.binding] = onlyCandidate([...new Set(candidates)],
//       `attacks.${attack.order}.${target.binding}`, `型 ${target.values.join('/')} のEntity`);
//   }
//
//   const targetService = network.services.find(item => item.serviceId === attack.targetServiceId);
//   result[definition.authoring.sourceNodeBinding] = attack.sourceNodeId;
//   result[definition.authoring.targetServiceBinding] = attack.targetServiceId;
//   const targetRequirement = definition.requiredServices.find(item =>
//     item.binding === definition.authoring.targetServiceBinding);
//   if (!targetRequirement || !targetService || !targetRequirement.values.includes(targetService.serviceType)) {
//     throw new ValidationError('TARGET_SERVICE_REQUIREMENT_MISMATCH',
//       `attacks.${attack.order}.targetServiceId`, '対象ServiceはAttack Definitionの要件を満たしません。');
//   }
//   result[targetRequirement.node] = attack.targetNodeId;
//
//   const roleRequirements = new Map(definition.requiredRoles.map(item => [item.binding, item.values]));
//   for (const binding of definition.bindings.filter(item => item.kind === 'node')) {
//     if (result[binding.id]) continue;
//     const roles = roleRequirements.get(binding.id);
//     if (!roles) continue;
//     const candidates = network.nodes.filter(node => roles.some(role => node.roles.includes(role)));
//     result[binding.id] = onlyCandidate(candidates,
//       `attacks.${attack.order}.${binding.id}`, `Role ${roles.join('/')} を持つNode`).nodeId;
//   }
//
//   for (const requirement of definition.requiredServices) {
//     if (result[requirement.binding]) continue;
//     const nodeId = result[requirement.node];
//     const candidates = network.services.filter(service => (!nodeId || service.nodeId === nodeId)
//       && requirement.values.includes(service.serviceType));
//     const selected = onlyCandidate(candidates, `attacks.${attack.order}.${requirement.binding}`,
//       `Service Type ${requirement.values.join('/')} のService`);
//     result[requirement.binding] = selected.serviceId;
//     if (!result[requirement.node]) result[requirement.node] = selected.nodeId;
//   }
//
//   for (const binding of definition.bindings) {
//     if (result[binding.id]) continue;
//     if (binding.kind === 'node') {
//       const candidates = network.nodes.filter(node => node.nodeId === attack.sourceNodeId
//         || node.nodeId === attack.targetNodeId);
//       result[binding.id] = onlyCandidate(candidates, `attacks.${attack.order}.${binding.id}`,
//         'Source/Targetに対応するNode').nodeId;
//     } else if (binding.kind === 'service') {
//       throw new ValidationError('MISSING_BINDING', `attacks.${attack.order}.${binding.id}`,
//         'Attack DefinitionのService割当て条件が不足しています。');
//     } else {
//       throw new ValidationError('MISSING_BINDING', `attacks.${attack.order}.${binding.id}`,
//         'Attack DefinitionのEntity型条件が不足しています。');
//     }
//   }
//   for (const [name, value] of Object.entries(result)) if (!value || !bindingKinds.has(name)) {
//     throw new ValidationError('INVALID_BINDING', `attacks.${attack.order}.${name}`,
//       'Attack Definitionの割当てを解決できません。');
//   }
//   return result;
// }
//
// 2026-09-20 修正後: Role単独の先決めと共有Requestを廃止し、制約を同時に評価する
import { resolveAuthoringBindings, linkRequestBindings, entityType } from './authoring-bindings.js';
function buildTechnicalContracts(configuration, catalog) {
  const definitions = new Map(catalog.map(item => [item.id, item]));
  const sorted = [...configuration.attacks].sort((a, b) => a.order - b.order);
// 2026-09-20 修正前: 選択対象を固定した割当てと根拠のあるRequest共有
//   const bindings = new Map(sorted.map(attack => [attack.attackId,
//     resolvedBindings(configuration, attack, definitions.get(attack.attackId))]));
// 2026-09-20 修正後: 選択対象を固定した割当てと根拠のあるRequest共有
  const network = canonicalNetwork(configuration.network);
  const bindings = new Map(sorted.map(attack => [attack.attackId,
    resolveAuthoringBindings(network, attack, definitions.get(attack.attackId))]));
  linkRequestBindings(sorted, definitions, bindings);
  const candidate = { schemaVersion: '1.0', selectedAttackIds: sorted.map(item => item.attackId),
    assignments: sorted.map(attack => ({ attackId: attack.attackId,
      bindings: definitions.get(attack.attackId).bindings.map(binding => ({ name: binding.id,
        entityId: bindings.get(attack.attackId)[binding.id] ?? 'missing-binding' })) })) };
  const contextEntities = new Map();
  for (const definition of sorted.map(item => definitions.get(item.attackId))) {
    const map = bindings.get(definition.id);
// 2026-09-20 修正前: EntityだけをContextへ登録し、型の誤推測を防ぐ
//     for (const target of definition.targetTypes) {
//       const id = map[target.binding];
//       const type = target.values.find(value => entityIds[value] === id) ?? target.values[0];
//       contextEntities.set(id, { id, type });
//     }
// 2026-09-20 修正後: EntityだけをContextへ登録し、型の誤推測を防ぐ
    for (const binding of definition.bindings.filter(item => item.kind === 'entity')) {
      const id = map[binding.id];
      contextEntities.set(id, { id, type: entityType(definition, binding.id) });
    }
  }
  const scenarioContext = { schemaVersion: '1.0', entities: [...contextEntities.values()],
    vulnerabilities: [], attackerInitialPrivileges: [], requiredUserActions: [],
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
// 2026-09-20 修正前: 割当てとGraph評価で同じNetworkを使用する
//   const network = canonicalNetwork(configuration.network);
//   const graphResult = buildAttackGraphs({ definitions: catalog, network, context: scenarioContext, candidate });
// 2026-09-20 修正後: 割当てとGraph評価で同じNetworkを使用する
  const graphResult = buildAttackGraphs({ definitions: catalog, network, context: scenarioContext, candidate });
// 2026-09-20 修正前: 技術失敗の詳細を保持し、入力時刻と矛盾する実行順を拒否する
//   const connected = graphResult.status === 'CREATED'
//     ? graphResult.graphs.find(item => item.components.length === 1) : null;
// 2026-09-20 修正後: 技術失敗の詳細を保持し、入力時刻と矛盾する実行順を拒否する
  if (graphResult.status !== 'CREATED') return { errors: graphResult.issues.map(item => issue(
    item.code, item.field, item.reason, item.suggestion)) };
// 2026-09-20 修正前: カタログの連続選択や単一連結を要求せず、実際の因果関係と入力順を検証
//   const connected = graphResult.graphs.find(item => item.components.length === 1
//     && item.sourcePlanOrders.some(order => order.every((id, index) => id === sorted[index].attackId)));
//   if (!connected) return { errors: [issue('INVALID_ATTACK_COMBINATION', 'attacks',
//     'この攻撃手法の組合せでは有効な攻撃経路を作成できません。',
//     'Attack Graph上で前段の効果が後段の前提条件を満たす組合せを選択してください。')] };
//   const selected = { ...graphResult, graphs: [connected] };
//   const inputs = buildScenarioGenerationInputs({ attackGraphResult: selected,
//     definitions: catalog, network, context: scenarioContext, candidate });
// 2026-09-20 修正後: カタログの連続選択や単一連結を要求せず、実際の因果関係と入力順を検証
  const compatible = graphResult.graphs.find(item => item.sourcePlanOrders.some(order =>
    order.every((id, index) => id === sorted[index].attackId)));
  // 2026-09-24 修正前: if (!compatible) return { errors: [issue('INVALID_ATTACK_COMBINATION', 'attacks',
  // 2026-09-24 修正後: 組合せは成立するが指定順で成立しない場合を区別する。
  if (!compatible) return { errors: [issue('ATTACK_DEPENDENCY_ORDER_MISMATCH', 'attacks',
    '指定した順番では攻撃の前提条件を満たせません。',
    '必要な権限や条件を生む攻撃を先に配置し、発生日時も確認してください。')] };
  // 独立した攻撃を含めて元のGraph全体を照合し、入力順を満たす案を選ぶ。
  const selected = { ...graphResult, graphs: [compatible] };
  const inputs = buildScenarioGenerationInputs({ attackGraphResult: graphResult,
    definitions: catalog, network, context: scenarioContext, candidate })
    .filter(input => input.attackGraphRef.graphId === compatible.graphId);
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
  catalog = incidentDefinitions(catalog, configuration);
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
        `${definition.label}では${INVESTIGATION_TYPES[type]?.label ?? type}を選択できません。`,
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

export function buildScenarioPreview(configuration, scenarioPackage = null, catalog = [], generationInput = null) {
  const nodes = new Map(configuration.network.nodes.map(item => [item.nodeId, item]));
  const services = new Map(configuration.network.services.map(item => [item.serviceId, item]));
  const attackLabels = new Map(catalog.map(item => [item.id, item.label]));
  return { configurationId: configuration.configurationId, mode: configuration.mode,
    incidentSummary: scenarioPackage?.scenarioDraft?.summary
      ?? buildIncidentOverview(configuration, generationInput),
    attacks: [...configuration.attacks].sort((a, b) => a.order - b.order).map(item => ({
      order: item.order, attackId: item.attackId, label: labels[item.attackId]
        ?? attackLabels.get(item.attackId) ?? item.attackId,
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
