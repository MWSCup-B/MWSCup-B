import { INVESTIGATION_TYPES } from './scenario-configuration.js';
import { fail } from './schema.js';

// Artifactの取得条件はAttack Graphで確認し、取得操作は既存Networkの取得元へ割り当てる。
// ブラウザ履歴をスクリプト実行の証明へ置き換えない。実行計測は端末資料として扱う。
const artifactSources = Object.freeze({
  email_record: { binding: 'mail', logSource: 'EMAIL', type: 'EMAIL',
    actionId: 'action_inspect_file', targetType: 'SERVER' },
  web_access_record: { binding: 'web', logSource: 'WEB_LOG', type: 'WEB_ACCESS_LOG',
    actionId: 'action_audit_log', targetType: 'LOG_SOURCE' },
  browser_execution_record: { binding: 'browser', logSource: 'DEVICE', type: 'DEVICE_INFORMATION',
    actionId: 'action_inspect_device', targetType: 'ENDPOINT' },
  database_statement_record: { binding: 'database', logSource: 'APPLICATION_LOG', type: 'DATABASE_LOG',
    actionId: 'action_audit_log', targetType: 'LOG_SOURCE' },
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

const builders = Object.freeze({
  phishing: attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
    syntheticDataKind: attack.investigationTypes.includes('EMAIL') ? 'SYNTHETIC_EMAIL' : 'SYNTHETIC_LOG' }),
  reflected_xss: attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
    syntheticDataKind: 'SYNTHETIC_WEB_LOG' }),
  sql_injection: attack => ({ attackId: attack.attackId, investigationTypes: attack.investigationTypes,
    syntheticDataKind: 'SYNTHETIC_APPLICATION_LOG' }),
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
