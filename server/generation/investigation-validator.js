import { fail, validateDocument } from './schema.js';

export const INVESTIGATION_ACTION_TYPES = Object.freeze([
  'AUDIT_LOG', 'INSPECT_DEVICE', 'CHECK_EMAIL', 'CHECK_BROWSER_HISTORY',
  'INSPECT_FILE', 'ANALYZE_NETWORK_LOG', 'REVIEW_AUTH_LOG', 'CHECK_CONFIGURATION',
]);

export const DEFAULT_INVESTIGATION_ACTIONS = Object.freeze([
  { schemaVersion: '1.0', actionId: 'action_audit_log', actionType: 'AUDIT_LOG',
    displayName: '監査ログを確認', description: '対象が保持する監査ログをゲーム内で確認します。',
    allowedTargetTypes: ['SERVER', 'LOG_SOURCE', 'APPLICATION'] },
  { schemaVersion: '1.0', actionId: 'action_inspect_device', actionType: 'INSPECT_DEVICE',
    displayName: '端末を調査', description: '対象端末の合成された状態情報を確認します。',
    allowedTargetTypes: ['ENDPOINT', 'SERVER', 'NETWORK_DEVICE'] },
  { schemaVersion: '1.0', actionId: 'action_check_email', actionType: 'CHECK_EMAIL',
    displayName: 'メールを確認', description: 'メールボックス内の合成メール記録を確認します。',
    allowedTargetTypes: ['MAILBOX'] },
  { schemaVersion: '1.0', actionId: 'action_check_browser_history', actionType: 'CHECK_BROWSER_HISTORY',
    displayName: 'ブラウザ履歴を確認', description: 'ブラウザの合成閲覧履歴を確認します。',
    allowedTargetTypes: ['BROWSER', 'ENDPOINT'] },
  { schemaVersion: '1.0', actionId: 'action_inspect_file', actionType: 'INSPECT_FILE',
    displayName: 'ファイルを調査', description: 'ファイルシステム上の合成メタデータを確認します。',
    allowedTargetTypes: ['FILE_SYSTEM', 'ENDPOINT', 'SERVER'] },
  { schemaVersion: '1.0', actionId: 'action_analyze_network_log', actionType: 'ANALYZE_NETWORK_LOG',
    displayName: '通信ログを分析', description: '対象に関連する合成通信ログを分析します。',
    allowedTargetTypes: ['NETWORK_DEVICE', 'LOG_SOURCE', 'SERVER'] },
  { schemaVersion: '1.0', actionId: 'action_review_auth_log', actionType: 'REVIEW_AUTH_LOG',
    displayName: '認証ログを確認', description: '対象の合成認証ログを確認します。',
    allowedTargetTypes: ['SERVER', 'LOG_SOURCE', 'APPLICATION'] },
  { schemaVersion: '1.0', actionId: 'action_check_configuration', actionType: 'CHECK_CONFIGURATION',
    displayName: '設定を確認', description: '対象の合成設定情報を確認します。',
    allowedTargetTypes: ['SERVER', 'NETWORK_DEVICE', 'APPLICATION', 'ENDPOINT'] },
]);

function unique(items, key, field) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) fail('DUPLICATE_ID', field, '識別子または参照が重複しています。');
    seen.add(value);
  }
}

export function investigationCompletionId(targetId, actionId) {
  return `completed_${targetId}__${actionId}`;
}

export function publicInvestigationAction(action) {
  return { actionId: action.actionId, actionType: action.actionType,
    displayName: action.displayName, description: action.description };
}

export function publicInvestigationTarget(target) {
  return { targetId: target.targetId, targetType: target.targetType,
    displayName: target.displayName, description: target.description,
    availableActionIds: [...target.availableActionIds] };
}

export function validateInvestigationDefinitions(plan) {
  const actions = plan.investigationActions;
  const targets = plan.investigationTargets;
  const rules = plan.evidenceDiscoveryRules;
  if (!Array.isArray(actions) || !actions.length || actions.length > 64
    || !Array.isArray(targets) || !targets.length || targets.length > 128
    || !Array.isArray(rules) || !rules.length || rules.length > 512
    || !Array.isArray(plan.initialAvailableTargetIds) || !plan.initialAvailableTargetIds.length) {
    fail('INVALID_INVESTIGATION_DESIGN', 'game-progression-plan.investigation',
      'Action、Target、Discovery Rule、初期Targetを明示してください。');
  }
  actions.forEach(item => validateDocument('investigation-action', item));
  targets.forEach(item => validateDocument('investigation-target', item));
  rules.forEach(item => validateDocument('evidence-discovery-rule', item));
  unique(actions, item => item.actionId, 'investigationActions.actionId');
  unique(actions, item => item.actionType, 'investigationActions.actionType');
  unique(targets, item => item.targetId, 'investigationTargets.targetId');
  unique(rules, item => item.ruleId, 'evidenceDiscoveryRules.ruleId');
  unique(plan.initialAvailableTargetIds, item => item, 'initialAvailableTargetIds');
  const actionById = new Map(actions.map(item => [item.actionId, item]));
  const targetById = new Map(targets.map(item => [item.targetId, item]));
  const actionTypes = new Set(actions.map(item => item.actionType));
  if (INVESTIGATION_ACTION_TYPES.some(type => !actionTypes.has(type))) {
    fail('MISSING_INVESTIGATION_ACTION_TYPE', 'game-progression-plan.investigationActions',
      'MVPで必須のInvestigation Action Typeが不足しています。');
  }
  for (const target of targets) {
    unique(target.availableActionIds, item => item,
      `investigationTargets.${target.targetId}.availableActionIds`);
    for (const actionId of target.availableActionIds) {
      const action = actionById.get(actionId);
      if (!action) fail('BROKEN_INVESTIGATION_ACTION_REFERENCE',
        `investigationTargets.${target.targetId}.availableActionIds`,
        'Targetが存在しないInvestigation Actionを参照しています。');
      if (!action.allowedTargetTypes.includes(target.targetType)) {
        fail('INVESTIGATION_ACTION_TARGET_MISMATCH',
          `investigationTargets.${target.targetId}.availableActionIds`,
          'Action TypeがこのTarget Typeで利用可能ではありません。');
      }
    }
  }
  const initial = new Set(plan.initialAvailableTargetIds);
  if ([...initial].some(id => !targetById.has(id))) fail('BROKEN_INVESTIGATION_TARGET_REFERENCE',
    'game-progression-plan.initialAvailableTargetIds', '存在しない初期Targetが指定されています。');
  for (const target of targets) {
    if (target.initiallyAvailable !== initial.has(target.targetId)) {
      fail('INITIAL_TARGET_STATE_MISMATCH', `investigationTargets.${target.targetId}.initiallyAvailable`,
        'TargetのinitiallyAvailableとinitialAvailableTargetIdsが一致しません。');
    }
  }
  const completions = new Set(targets.flatMap(target => target.availableActionIds
    .map(actionId => investigationCompletionId(target.targetId, actionId))));
  const completionCount = targets.reduce((count, target) => count + target.availableActionIds.length, 0);
  if (completions.size !== completionCount) fail('DUPLICATE_COMPLETED_ACTION_ID',
    'game-progression-plan.investigationTargets',
    'Target IDとAction IDから生成される完了IDが重複しています。');
  for (const rule of rules) {
    const target = targetById.get(rule.targetId);
    if (!target) fail('BROKEN_INVESTIGATION_TARGET_REFERENCE',
      `evidenceDiscoveryRules.${rule.ruleId}.targetId`, 'Discovery RuleのTargetが存在しません。');
    if (!actionById.has(rule.actionId) || !target.availableActionIds.includes(rule.actionId)) {
      fail('BROKEN_INVESTIGATION_ACTION_REFERENCE',
        `evidenceDiscoveryRules.${rule.ruleId}.actionId`,
        'Discovery RuleのActionがTargetで利用できません。');
    }
    unique(rule.prerequisites.requiredEvidenceIds, item => item,
      `evidenceDiscoveryRules.${rule.ruleId}.prerequisites.requiredEvidenceIds`);
    unique(rule.prerequisites.requiredCompletedActionIds, item => item,
      `evidenceDiscoveryRules.${rule.ruleId}.prerequisites.requiredCompletedActionIds`);
    unique(rule.discoveryResult.unlockedTargetIds, item => item,
      `evidenceDiscoveryRules.${rule.ruleId}.discoveryResult.unlockedTargetIds`);
    if (rule.prerequisites.requiredCompletedActionIds.some(id => !completions.has(id))) {
      fail('BROKEN_COMPLETED_ACTION_REFERENCE',
        `evidenceDiscoveryRules.${rule.ruleId}.prerequisites.requiredCompletedActionIds`,
        'Discovery Ruleが存在しないTarget + Action完了IDを参照しています。');
    }
    if (rule.discoveryResult.unlockedTargetIds.some(id => !targetById.has(id))) {
      fail('BROKEN_UNLOCK_TARGET_REFERENCE',
        `evidenceDiscoveryRules.${rule.ruleId}.discoveryResult.unlockedTargetIds`,
        'Discovery Ruleが存在しないTargetを解放しようとしています。');
    }
  }
  return { actionById, targetById, completions };
}

function sourceIds(input) {
  const technical = input.scenarioGenerationInput.technicalInput;
  const graph = technical.attackGraph;
  return {
    NETWORK_NODE: new Set(technical.network.nodes.map(item => item.id)),
    NETWORK_SERVICE: new Set(technical.network.services.map(item => item.id)),
    ATTACK_GRAPH_NODE: new Set(graph.nodes.map(item => item.nodeId)),
    ATTACK_GRAPH_ARTIFACT: new Set(graph.nodes.flatMap(node =>
      node.artifactEvaluations.map(item => item.artifactId))),
    TIMELINE_EVENT: new Set(input.timeline.events.map(item => item.eventId)),
    EVIDENCE_ARTIFACT: new Set(input.evidenceSet.evidenceArtifacts.map(item => item.evidenceId)),
  };
}

function hasDependencyCycle(plan, unresolvedEvidence, unresolvedTargets) {
  const dependencies = new Map();
  const add = (node, dependency) => {
    if (!dependencies.has(node)) dependencies.set(node, new Set());
    dependencies.get(node).add(dependency);
  };
  const completionTarget = new Map();
  for (const target of plan.investigationTargets) for (const actionId of target.availableActionIds) {
    completionTarget.set(investigationCompletionId(target.targetId, actionId), target.targetId);
  }
  for (const rule of plan.evidenceDiscoveryRules) {
    if (!unresolvedEvidence.has(rule.evidenceId)) continue;
    const evidenceNode = `e:${rule.evidenceId}`;
    for (const id of rule.prerequisites.requiredEvidenceIds) {
      if (unresolvedEvidence.has(id)) add(evidenceNode, `e:${id}`);
    }
    if (unresolvedTargets.has(rule.targetId)) add(evidenceNode, `t:${rule.targetId}`);
    for (const id of rule.prerequisites.requiredCompletedActionIds) {
      const targetId = completionTarget.get(id);
      if (unresolvedTargets.has(targetId)) add(evidenceNode, `t:${targetId}`);
    }
    for (const targetId of rule.discoveryResult.unlockedTargetIds) {
      if (unresolvedTargets.has(targetId)) add(`t:${targetId}`, evidenceNode);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = node => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const dependency of dependencies.get(node) ?? []) if (visit(dependency)) return true;
    visiting.delete(node); visited.add(node); return false;
  };
  return [...dependencies.keys()].some(visit);
}

export function validateInvestigationDesign(input) {
  const plan = input.progressionPlan;
  const { targetById } = validateInvestigationDefinitions(plan);
  const sources = sourceIds(input);
  for (const target of plan.investigationTargets) {
    const ref = target.sourceNodeRef;
    if (!sources[ref.sourceType]?.has(ref.sourceId)) fail('BROKEN_INVESTIGATION_SOURCE_REFERENCE',
      `investigationTargets.${target.targetId}.sourceNodeRef`,
      'Investigation TargetがNetwork、Attack Graph、Scenario、Evidenceの既存IDを参照していません。');
  }
  const artifacts = new Map(input.evidenceSet.evidenceArtifacts.map(item => [item.evidenceId, item]));
  const investigable = new Set(plan.investigationEvidenceIds);
  const rulesByEvidence = new Map();
  for (const rule of plan.evidenceDiscoveryRules) {
    const artifact = artifacts.get(rule.evidenceId);
    if (!artifact || !investigable.has(rule.evidenceId)) fail('BROKEN_DISCOVERY_EVIDENCE_REFERENCE',
      `evidenceDiscoveryRules.${rule.ruleId}.evidenceId`,
      'Discovery RuleがInvestigation配置済みの既存Evidenceを参照していません。');
    if (artifact.visibility !== 'PLAYER_OBTAINABLE') fail('UNOBTAINABLE_DISCOVERY_EVIDENCE',
      `evidenceDiscoveryRules.${rule.ruleId}.evidenceId`,
      'PLAYER_OBTAINABLEでないEvidenceはDiscovery Ruleで発見できません。');
    if (rule.prerequisites.requiredEvidenceIds.some(id => !investigable.has(id))) {
      fail('BROKEN_DISCOVERY_PREREQUISITE',
        `evidenceDiscoveryRules.${rule.ruleId}.prerequisites.requiredEvidenceIds`,
        'prerequisiteがInvestigation対象外のEvidenceを参照しています。');
    }
    if (!rulesByEvidence.has(rule.evidenceId)) rulesByEvidence.set(rule.evidenceId, []);
    rulesByEvidence.get(rule.evidenceId).push(rule);
  }
  if ([...investigable].some(id => !rulesByEvidence.has(id))) fail('MISSING_EVIDENCE_DISCOVERY_RULE',
    'game-progression-plan.investigationEvidenceIds',
    'すべてのInvestigation Evidenceに明示的なDiscovery Ruleが必要です。');

  const availableTargets = new Set(plan.initialAvailableTargetIds);
  const completedActions = new Set();
  const reachableEvidence = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const targetId of [...availableTargets]) {
      for (const actionId of targetById.get(targetId).availableActionIds) {
        const completionId = investigationCompletionId(targetId, actionId);
        if (!completedActions.has(completionId)) { completedActions.add(completionId); changed = true; }
      }
    }
    for (const rule of plan.evidenceDiscoveryRules) {
      if (!availableTargets.has(rule.targetId)
        || !rule.prerequisites.requiredEvidenceIds.every(id => reachableEvidence.has(id))
        || !rule.prerequisites.requiredCompletedActionIds.every(id => completedActions.has(id))) continue;
      if (!reachableEvidence.has(rule.evidenceId)) { reachableEvidence.add(rule.evidenceId); changed = true; }
      for (const targetId of rule.discoveryResult.unlockedTargetIds) {
        if (!availableTargets.has(targetId)) { availableTargets.add(targetId); changed = true; }
      }
    }
  }
  const unresolvedEvidence = new Set([...investigable].filter(id => !reachableEvidence.has(id)));
  const unresolvedTargets = new Set([...targetById.keys()].filter(id => !availableTargets.has(id)));
  if (unresolvedEvidence.size) {
    if (hasDependencyCycle(plan, unresolvedEvidence, unresolvedTargets)) {
      fail('INVESTIGATION_PREREQUISITE_CYCLE', 'game-progression-plan.evidenceDiscoveryRules',
        'Discovery RuleのprerequisiteまたはTarget解放に循環依存があります。');
    }
    fail('UNREACHABLE_INVESTIGATION_EVIDENCE', 'game-progression-plan.evidenceDiscoveryRules',
      'Investigation開始状態から到達できないEvidenceがあります。');
  }
  return { reachableEvidenceIds: [...reachableEvidence],
    reachableTargetIds: [...availableTargets], completedActionIds: [...completedActions] };
}

export function validateInvestigationResult(result) {
  return validateDocument('investigation-result', result);
}
