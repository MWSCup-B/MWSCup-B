import { AUTHOR_ATTACK_CHOICES, SCENARIO_SETTINGS } from './author-options.js';
import { createDefaultConfiguration, createManualAttackPreset, validateScenarioConfiguration }
  from './scenario-configuration.js';
import { validateDocument, fail, ValidationError } from './schema.js';

// These are explicit, recorded teaching defaults, not repairs to a submitted network.
// The legacy full-configuration API continues to validate its input without filling gaps.
export const AUTOMATIC_INCIDENT_DATE = '2026-09-18';
const publicAttackId = id => id === 'credential_phishing' ? 'phishing' : id;

export function createSelectionConfiguration(request, catalog) {
  validateDocument('scenario-selection', request);
  if (new Set(request.attackIds).size !== request.attackIds.length) fail(
    'DUPLICATE_ATTACK_SELECTION', 'request.attackIds', '同じ攻撃を重複して選択できません。');
  const selected = new Set(request.attackIds);
  const legacyIds = request.attackIds.filter(id => ['phishing', 'stored_xss', 'unauthorized_login'].includes(id));
  const configuration = legacyIds.length ? createManualAttackPreset(legacyIds, catalog)
    : createDefaultConfiguration({ attackIds: [], incidentDate: AUTOMATIC_INCIDENT_DATE });
  configuration.difficulty = request.attackIds.length;
  configuration.evidenceCount = configuration.difficulty;
  const { network } = configuration;
  if (selected.has('password_spray') && !network.nodes.some(node => node.nodeId === 'auth-host')) {
    network.nodes.push({ nodeId: 'auth-host', label: '認証サーバー', nodeType: 'SERVER', os: 'linux',
      ip: '10.10.0.60', subnetId: 'internal-net', trustBoundaryId: 'internal',
      roles: ['authentication_server'], logSources: ['AUTH_LOG', 'APPLICATION_LOG', 'CONFIGURATION'] });
    network.services.push({ serviceId: 'auth-service', nodeId: 'auth-host', label: '認証サービス',
      serviceType: 'authentication', platform: 'auth' });
    network.connections.push({ fromNodeId: 'sender-host', toNodeId: 'auth-host' },
      { fromNodeId: 'web-host', toNodeId: 'auth-host' });
  }
  if (selected.has('clickfix') || selected.has('ransomware')) {
    network.services.push({ serviceId: 'endpoint-telemetry', nodeId: 'client-host',
      label: '端末計測（教材）', serviceType: 'logging', platform: 'logging' });
  }
  if (selected.has('ransomware')) network.services.push({ serviceId: 'endpoint-files',
    nodeId: 'client-host', label: '端末内の教材ファイル', serviceType: 'file', platform: 'file' });
  if (selected.has('unrestricted_file_upload')) {
    network.services.push({ serviceId: 'upload-files', nodeId: 'web-host',
      label: '非実行のアップロード保存領域', serviceType: 'file', platform: 'file' });
    network.nodes.find(node => node.nodeId === 'web-host').logSources.push('FILE');
  }
  const specs = {
    clickfix: { investigationTypes: ['WEB_LOG'], investigationSourceNodeId: 'web-host',
      evidenceAnswer: '偽の修復案内と端末の実行計測を区別する。案内の表示だけでは端末上の実行や操作者の意図を特定できない。',
      notes: '偽案内の制御、利用者による端末操作、一般利用者権限での実行許可を明示する。メール誘導が選択されている場合だけ、その到達を使う。実行可能なコマンド・窃取・権限昇格は含めない。' },
    sql_injection: { investigationTypes: ['WEB_LOG'], investigationSourceNodeId: 'web-host',
      evidenceAnswer: 'Web要求とDB監査を照合し、要求の到達とSQLの実行を区別する。実行されたSQLもアプリケーションのDB権限内であり、操作者の特定やOS実行の証明ではない。',
      notes: '入力が安全にパラメータ化されていない処理、WebからDBへの到達、当該DB主体の接続・クエリ実行権限、DB監査の保持を明示する。データ流出やOS実行は追加しない。' },
    password_spray: { targetNodeId: 'auth-host', targetServiceId: 'auth-service',
      investigationTypes: ['AUTH_LOG'], investigationSourceNodeId: 'auth-host',
      evidenceAnswer: '複数アカウントへの試行と成否を読む。秘密値を記録しない認証ログだけで同一パスワードの使用や実際の人物を断定できない。認証設定と試行の結果を分けて確かめる。',
      notes: '少数候補を多数アカウントへ試行する。対象の一つで候補が一致し、パスワードのみの認証で当該試行が制限に遮断されない限定条件。秘密値は保存しない。後続のサービス利用は別の処理。' },
    ransomware: { sourceNodeId: 'client-host', targetNodeId: 'client-host', targetServiceId: 'endpoint-files',
      investigationTypes: ['DEVICE'], investigationSourceNodeId: 'client-host',
      evidenceAnswer: 'プロセス起動とファイル暗号化の確認結果を照合する。起動・拡張子変更だけで暗号化完了とはせず、影響範囲や実際の操作者を過大に断定しない。',
      notes: `${selected.has('clickfix') ? '選択したClickFixによる実行' : '初期条件として取得済みの一般利用者権限の実行環境'}を使用。端末内で読み書き可能な教材ファイルに限定。暗号化確認計測と合成の身代金要求文を保持する。横展開・情報窃取・バックアップ破壊は含めない。` },
    unrestricted_file_upload: { investigationTypes: ['APPLICATION_LOG'], investigationSourceNodeId: 'web-host',
      evidenceAnswer: '申告された拡張子・Content-Typeと保存ファイルの内容検査を照合する。許可外ファイルの保存とサーバーでのコード実行は別である。',
      notes: '機能利用権限と書込み可能な保存先を初期条件として明示。内容検証が不足し許可外ファイルが保存される。保存領域は非実行。Webシェル・OS実行・追加のXSSは生成しない。' },
  };
  for (const attackId of request.attackIds.filter(id => !legacyIds.includes(id))) {
    const definition = catalog.find(item => item.id === attackId);
    if (!definition) fail('UNREGISTERED_ATTACK', 'request.attackIds', `攻撃定義${attackId}がありません。`);
    configuration.attacks.push({ attackId, sourceNodeId: 'sender-host', targetNodeId: 'web-host',
      targetServiceId: 'web-service', expectedEffect: definition.effects.at(-1).description, ...specs[attackId] });
  }
  if (selected.has('password_spray') && selected.has('unauthorized_login')) {
    const login = configuration.attacks.find(item => item.attackId === 'unauthorized_login');
    login.notes = '選択した資格情報取得の前段と対応する有効なアカウントで、認証とWeb側の投稿権限受入れを確認する。認証はパスワードのみ。MFA突破や管理者権限は含めない。';
  }
  // The user chooses a causal sequence, not an unordered set. Never reorder a
  // reversed request to make it pass. Keep the existing phishing variant explicit.
  configuration.attacks.sort((a, b) => request.attackIds.indexOf(publicAttackId(a.attackId))
    - request.attackIds.indexOf(publicAttackId(b.attackId)))
    .forEach((attack, index) => {
      attack.order = index + 1;
      attack.occurrenceTime = `${AUTOMATIC_INCIDENT_DATE}T09:${10 + index * 8}:00+09:00`;
    });
  const setting = SCENARIO_SETTINGS.find(item => item.id === request.settingId);
  Object.assign(configuration.incidentContext, { organizationName: setting.organizationName,
    victimSystem: setting.victimSystem, accusedRole: setting.accusedRole,
    initialSuspicionReason: '調査担当者は記録に現れた端末やアカウントを被告人の操作と結び付けています。これは疑う側の主張であり、実際の操作者との対応はまだ確かめられていません。' });
  network.subnets.find(subnet => subnet.subnetId === 'internal-net').label = setting.networkLabel;
  validateSelectionChain(configuration, catalog);
  return configuration;
}

function validateSelectionChain(configuration, catalog) {
  const validation = validateScenarioConfiguration(configuration, catalog);
  if (validation.status !== 'VALID') {
    const issue = validation.errors[0];
    fail(issue.code, 'request.attackIds', issue.reason, { correctionHint: issue.correctionHint });
  }
  const graph = validation.technical.generationInput.technicalInput.attackGraph;
  const nodes = configuration.attacks.map(attack => graph.nodes
    .find(node => node.attackDefinitionId === attack.attackId));
  for (let index = 1; index < nodes.length; index += 1) {
    if (!graph.edges.some(edge => edge.type === 'ENABLES'
      && edge.from === nodes[index - 1].nodeId && edge.to === nodes[index].nodeId)) {
      fail('INVALID_ATTACK_SEQUENCE', `request.attackIds[${index}]`,
        `${index + 1}件目は、直前の攻撃の結果から発生するものを選択してください。`,
        { correctionHint: '選択順に直接つながる攻撃だけを使用してください。1件目からの分岐や単なる時系列は、2件目から3件目へのつながりにはなりません。' });
    }
  }
}

// Publish only IDs of technically validated ordered prefixes. Recalculate the
// graph on submission; this list is a UI aid, never an authorization shortcut.
// Setting changes labels/roles only, not the network or causal prerequisites.
export function buildAttackSelectionPaths(catalog) {
  const paths = [];
  const visit = prefix => {
    for (const { id } of AUTHOR_ATTACK_CHOICES) {
      if (prefix.includes(id)) continue;
      const attackIds = [...prefix, id];
      try {
        createSelectionConfiguration({ schemaVersion: '1.0', attackIds, settingId: SCENARIO_SETTINGS[0].id }, catalog);
      } catch (error) {
        if (error instanceof ValidationError && ['INVALID_ATTACK_COMBINATION',
          'ATTACK_DEPENDENCY_ORDER_MISMATCH', 'INVALID_ATTACK_SEQUENCE'].includes(error.code)) continue;
        throw error;
      }
      paths.push(attackIds);
      if (attackIds.length < 3) visit(attackIds);
    }
  };
  visit([]);
  return paths;
}
