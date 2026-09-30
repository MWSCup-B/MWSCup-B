import { INVESTIGATION_TYPES } from './scenario-configuration.js';
import { fail } from './schema.js';
import { learningProfile, investigationSourceLabel } from './attack-learning.js';

// Artifactの取得条件はAttack Graphで確認し、取得操作は既存Networkの取得元へ割り当てる。
// ブラウザ履歴をスクリプト実行の証明へ置き換えない。実行記録は端末資料として扱う。
const artifactSources = Object.freeze({
  email_record: { binding: 'mail', logSource: 'EMAIL', type: 'EMAIL',
    actionId: 'action_check_email', targetType: 'MAILBOX' },
  web_access_record: { binding: 'web', logSource: 'WEB_LOG', type: 'WEB_ACCESS_LOG',
    actionId: 'action_audit_log', targetType: 'LOG_SOURCE' },
  browser_execution_record: { binding: 'browser', logSource: 'DEVICE', type: 'DEVICE_INFORMATION',
    actionId: 'action_inspect_device', targetType: 'ENDPOINT' },
  database_statement_record: { binding: 'database', logSource: 'APPLICATION_LOG', type: 'DATABASE_LOG',
    actionId: 'action_audit_log', targetType: 'LOG_SOURCE' },
  stored_content_record: { binding: 'web', logSource: 'APPLICATION_LOG', type: 'APPLICATION_LOG',
    actionId: 'action_audit_log', targetType: 'LOG_SOURCE' },
  credential_submission_record: { binding: 'web', logSource: 'APPLICATION_LOG', type: 'APPLICATION_LOG',
    actionId: 'action_audit_log', targetType: 'LOG_SOURCE' },
  authentication_record: { binding: 'auth', logSource: 'AUTH_LOG', type: 'AUTHENTICATION_LOG',
    actionId: 'action_review_auth_log', targetType: 'LOG_SOURCE' },
  application_session_record: { binding: 'web', logSource: 'APPLICATION_LOG', type: 'APPLICATION_LOG',
    actionId: 'action_audit_log', targetType: 'LOG_SOURCE' },
  clickfix_page_record: { binding: 'web', logSource: 'WEB_LOG', type: 'DOCUMENT',
    actionId: 'action_audit_log', targetType: 'LOG_SOURCE' },
  process_execution_record: { binding: 'endpoint', logSource: 'DEVICE', type: 'DEVICE_INFORMATION',
    actionId: 'action_inspect_device', targetType: 'ENDPOINT' },
  spray_authentication_record: { binding: 'auth', logSource: 'AUTH_LOG', type: 'AUTHENTICATION_LOG',
    actionId: 'action_review_auth_log', targetType: 'LOG_SOURCE' },
  authentication_policy_record: { binding: 'auth', logSource: 'CONFIGURATION', type: 'DOCUMENT',
    actionId: 'action_check_configuration', targetType: 'SERVER' },
  file_encryption_record: { binding: 'files', logSource: 'FILE', type: 'FILE_METADATA',
    actionId: 'action_inspect_file', targetType: 'FILE_SYSTEM' },
  upload_receipt_record: { binding: 'web', logSource: 'APPLICATION_LOG', type: 'APPLICATION_LOG',
    actionId: 'action_audit_log', targetType: 'LOG_SOURCE' },
  uploaded_file_record: { binding: 'files', logSource: 'FILE', type: 'FILE_METADATA',
    actionId: 'action_inspect_file', targetType: 'FILE_SYSTEM' },
});

export function buildEvidenceInvestigationPlan(configuration, generationInput) {
  const technical = generationInput.technicalInput;
  return technical.attackGraph.nodes.flatMap(node => node.artifactEvaluations
    .filter(artifact => artifact.state === 'SATISFIED'
      && artifact.evaluations.every(item => item.state === 'SATISFIED'))
    .map(artifact => {
// 2026-09-20 修正前: 証拠取得元を攻撃定義から解決し、固定4種類以外の記録にも対応
//       const source = artifactSources[artifact.artifactId];
//       const serviceId = node.bindings.find(item => item.name === source?.binding)?.entityId;
//       const service = technical.network.services.find(item => item.id === serviceId);
//       const host = configuration.network.nodes.find(item => item.nodeId === service?.nodeId);
// 2026-09-20 修正後: 証拠取得元を攻撃定義から解決し、固定4種類以外の記録にも対応
      const definition = technical.attackDefinitions.find(item => item.id === node.attackDefinitionId);
      const acquisition = definition?.observableArtifacts.find(item => item.id === artifact.artifactId)?.acquisition;
      const source = acquisition ? { ...acquisition, actionId: INVESTIGATION_TYPES[acquisition.logSource].actionId }
        : artifactSources[artifact.artifactId];
      const entityId = node.bindings.find(item => item.name === source?.binding)?.entityId;
      const service = technical.network.services.find(item => item.id === entityId);
      const host = configuration.network.nodes.find(item => item.nodeId === (service?.nodeId ?? entityId));
      if (!source || !host?.logSources.includes(source.logSource)) fail(
        'EVIDENCE_SOURCE_UNAVAILABLE', `attacks.${node.attackDefinitionId}.investigationTypes`,
        `${artifact.artifactId}を取得する既存Node・Log Source・調査操作が揃っていません。`,
        { correctionHint: '不足する取得元を確認してください。取得条件を補完して生成は継続しません。' });
      return { ground: { sourceType: 'ATTACK_GRAPH_ARTIFACT',
        attackNodeId: node.nodeId, sourceId: artifact.artifactId },
      sourceNodeId: host.nodeId, sourceLabel: host.label, actionId: source.actionId,
      targetType: source.targetType, logSource: source.logSource,
      evidenceType: source.type, description: artifact.description };
    }));
}

const syntheticKinds = Object.freeze({ EMAIL: 'SYNTHETIC_EMAIL', WEB_LOG: 'SYNTHETIC_WEB_LOG',
  APPLICATION_LOG: 'SYNTHETIC_APPLICATION_LOG', AUTH_LOG: 'SYNTHETIC_AUTH_LOG',
  PROXY_LOG: 'SYNTHETIC_PROXY_LOG', NETWORK_LOG: 'SYNTHETIC_NETWORK_LOG',
  BROWSER_HISTORY: 'SYNTHETIC_BROWSER_HISTORY', DEVICE: 'SYNTHETIC_DEVICE_RECORD',
  FILE: 'SYNTHETIC_FILE_RECORD', CONFIGURATION: 'SYNTHETIC_CONFIGURATION_RECORD' });

const genericBuilder = attack => ({ attackId: attack.attackId,
  investigationTypes: attack.investigationTypes,
  syntheticDataKind: syntheticKinds[attack.investigationTypes[0]] ?? 'SYNTHETIC_LOG' });

// 旧APIとの互換用。実際の割当ては攻撃IDに依存しないgenericBuilderを使用する。
const builders = Object.freeze({ phishing: genericBuilder, reflected_xss: genericBuilder,
  sql_injection: genericBuilder });

// The ordered sources are fixed before writing questions. A stage never needs a future source.
export function buildInvestigationStages(configuration, generationInput) {
  const stages = [];
  // Graph nodes are identifier-ordered, which can put ClickFix before its email
  // entry. Follow the selected sequence and each attack's teaching source order.
  // Each issue owns one attack. Reusing a host does not merge unrelated claims;
  // the original host, action and observable record remain unchanged.
  const ranks = new Map(generationInput.technicalInput.attackGraph.nodes.map(node => [node.nodeId, {
    attack: configuration.attacks.find(attack => attack.attackId === node.attackDefinitionId)?.order ?? Infinity,
    sources: learningProfile(node, generationInput.technicalInput.attackDefinitions)?.sources ?? [],
  }]));
  const routes = buildEvidenceInvestigationPlan(configuration, generationInput).sort((a, b) => {
    const left = ranks.get(a.ground.attackNodeId); const right = ranks.get(b.ground.attackNodeId);
    return left.attack - right.attack || left.sources.indexOf(a.ground.sourceId) - right.sources.indexOf(b.ground.sourceId);
  });
  for (const route of routes) {
    let stage = stages.find(item => item.attackNodeId === route.ground.attackNodeId
      && item.sourceNodeId === route.sourceNodeId
      && item.targetType === route.targetType);
    if (!stage) {
      stage = { targetId: `target_auto_${stages.length + 1}`, attackNodeId: route.ground.attackNodeId,
        sourceNodeId: route.sourceNodeId,
        displayName: route.sourceLabel, targetType: route.targetType, routes: [] };
      stages.push(stage);
    }
    stage.routes.push(route);
  }
  return stages.map(stage => ({ ...stage,
    displayName: `${stage.displayName}：${investigationSourceLabel(stage.routes)}` }));
}


export function buildInvestigationAssignments(configuration) {
  return [...configuration.attacks].sort((a, b) => a.order - b.order).map(attack => {
    const result = genericBuilder(attack);
    return { ...result, sourceNodeId: attack.investigationSourceNodeId,
      actions: attack.investigationTypes.map(type => ({ type,
        actionId: INVESTIGATION_TYPES[type].actionId })) };
  });
}

export const INVESTIGATION_BUILDERS = builders;
