import { INVESTIGATION_TYPES } from './scenario-configuration.js';
import { fail } from './schema.js';
import { ATTACK_LEARNING, investigationSourceLabel } from './attack-learning.js';

// Artifactの取得条件はAttack Graphで確認し、取得操作は既存Networkの取得元へ割り当てる。
// ブラウザ履歴をスクリプト実行の証明へ置き換えない。実行計測は端末資料として扱う。
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
      const source = artifactSources[artifact.artifactId];
      const serviceId = node.bindings.find(item => item.name === source?.binding)?.entityId;
      const service = technical.network.services.find(item => item.id === serviceId);
      const host = configuration.network.nodes.find(item => item.nodeId === service?.nodeId);
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

// The ordered sources are fixed before writing questions. A stage never needs a future source.
export function buildInvestigationStages(configuration, generationInput) {
  const stages = [];
  // Graph nodes are identifier-ordered, which can put ClickFix before its email
  // entry. Follow the selected sequence and each attack's teaching source order.
  // Grouping, hosts, actions and obtainable observations remain unchanged.
  const ranks = new Map(generationInput.technicalInput.attackGraph.nodes.map(node => [node.nodeId, {
    attack: configuration.attacks.find(attack => attack.attackId === node.attackDefinitionId)?.order ?? Infinity,
    sources: ATTACK_LEARNING[node.attackDefinitionId]?.sources ?? [],
  }]));
  const routes = buildEvidenceInvestigationPlan(configuration, generationInput).sort((a, b) => {
    const left = ranks.get(a.ground.attackNodeId); const right = ranks.get(b.ground.attackNodeId);
    return left.attack - right.attack || left.sources.indexOf(a.ground.sourceId) - right.sources.indexOf(b.ground.sourceId);
  });
  for (const route of routes) {
    let stage = stages.find(item => item.sourceNodeId === route.sourceNodeId
      && item.targetType === route.targetType);
    if (!stage) {
      stage = { targetId: `target_auto_${stages.length + 1}`, sourceNodeId: route.sourceNodeId,
        displayName: route.sourceLabel, targetType: route.targetType, routes: [] };
      stages.push(stage);
    }
    stage.routes.push(route);
  }
  return stages.map(stage => ({ ...stage,
    displayName: `${stage.displayName}：${investigationSourceLabel(stage.routes)}` }));
}

const builders = Object.freeze({
  ...Object.fromEntries(['clickfix', 'password_spray', 'ransomware', 'unrestricted_file_upload']
    .map(id => [id, attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
      syntheticDataKind: 'SYNTHETIC_INCIDENT_RECORD' })])),
  phishing: attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
    syntheticDataKind: attack.investigationTypes.includes('EMAIL') ? 'SYNTHETIC_EMAIL' : 'SYNTHETIC_LOG' }),
  reflected_xss: attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
    syntheticDataKind: 'SYNTHETIC_WEB_LOG' }),
  sql_injection: attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
    syntheticDataKind: 'SYNTHETIC_APPLICATION_LOG' }),
  credential_phishing: attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
    syntheticDataKind: 'SYNTHETIC_EMAIL' }),
  stored_xss: attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
    syntheticDataKind: 'SYNTHETIC_APPLICATION_LOG' }),
  unauthorized_login: attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
    syntheticDataKind: 'SYNTHETIC_AUTH_LOG' }),
});

export function buildInvestigationAssignments(configuration) {
  return [...configuration.attacks].sort((a, b) => a.order - b.order).map(attack => {
    const builder = builders[attack.attackId];
    if (!builder) throw new Error(`Investigation Builder is not registered: ${attack.attackId}`);
    const result = builder(attack);
    return { ...result, sourceNodeId: attack.investigationSourceNodeId,
      actions: attack.investigationTypes.map(type => ({ type,
        actionId: INVESTIGATION_TYPES[type].actionId })) };
  });
}

export const INVESTIGATION_BUILDERS = builders;
