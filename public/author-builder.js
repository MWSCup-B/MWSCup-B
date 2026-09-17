export const WIZARD_STEPS = Object.freeze([
  { id: 'step-input', shortLabel: '入力' },
  { id: 'step-scenario-generation', shortLabel: 'Scenario生成' },
  { id: 'step-scenario-import', shortLabel: 'Scenario取込' },
  { id: 'step-verification', shortLabel: 'Verification' },
  { id: 'step-evidence-generation', shortLabel: 'Evidence生成' },
  { id: 'step-evidence-import', shortLabel: 'Evidence取込' },
  { id: 'step-progression', shortLabel: 'Game設定' },
  { id: 'step-build', shortLabel: 'Build / Play' },
]);

const clone = value => structuredClone(value);

export function wizardCompletion(author, { upstreamDirty = false,
  progressionValid = false } = {}) {
  return [
    Boolean(author?.scenarioOptions?.length) && !upstreamDirty,
    Boolean(author?.scenarioOptions?.length) && !upstreamDirty,
    author?.scenarioImportResult?.status === 'VALID',
    author?.verificationResult?.status === 'VERIFIED'
      && author?.evidenceGenerationInput?.status === 'READY',
    author?.evidenceGenerationInput?.status === 'READY',
    author?.evidenceImportResult?.status === 'VALID',
    progressionValid,
    author?.currentState === 'ACCEPTED',
  ];
}

export function maxReachableStep(completion) {
  const firstIncomplete = completion.findIndex(value => !value);
  return firstIncomplete < 0 ? WIZARD_STEPS.length - 1
    : Math.min(firstIncomplete, WIZARD_STEPS.length - 1);
}

export function moveWizard(current, direction, completion) {
  if (direction === 'back') return Math.max(0, current - 1);
  if (direction === 'next') {
    if (!completion[current]) return current;
    return Math.min(current + 1, WIZARD_STEPS.length - 1);
  }
  if (Number.isSafeInteger(direction) && direction >= 0
    && direction <= maxReachableStep(completion)) return direction;
  return current;
}

export function createProgressionBuilder(template) {
  if (!template) return null;
  return clone({
    schemaVersion: template.schemaVersion,
    scenarioId: template.scenarioId,
    evidenceSetId: template.evidenceSetId,
    attackGraphRef: template.attackGraphRef,
    initialCourtEvidenceIds: template.initialCourtEvidenceIds ?? [],
    initialCourtStatementIds: template.initialCourtStatementIds ?? [],
    investigationEvidenceIds: template.investigationEvidenceIds ?? [],
    investigationActions: template.investigationActions,
    investigationTargets: template.investigationTargets ?? [],
    evidenceDiscoveryRules: template.evidenceDiscoveryRules ?? [],
    initialAvailableTargetIds: template.initialAvailableTargetIds ?? [],
    retrialStatementIds: template.retrialStatementIds ?? [],
    returnToCourtCondition: template.returnToCourtCondition
      ?? 'AT_LEAST_ONE_EVIDENCE_COLLECTED',
    objectionRules: template.objectionRules ?? [],
    retryPolicy: { maxCourtAttempts: template.retryPolicy?.maxCourtAttempts ?? 3,
      onFailure: 'RETURN_TO_INVESTIGATION', onLimitReached: 'BLOCKED' },
    publicMessages: { initialRuling: template.publicMessages?.initialRuling ?? '',
      acquittalRuling: template.publicMessages?.acquittalRuling ?? '',
      acquittalExplanation: template.publicMessages?.acquittalExplanation ?? '',
      failureFeedback: template.publicMessages?.failureFeedback ?? '' },
  });
}

export function progressionDraft(builder) {
  return clone(builder);
}

export function upsertTarget(builder, target, previousId = null) {
  const next = progressionDraft(builder);
  const index = previousId == null ? -1
    : next.investigationTargets.findIndex(item => item.targetId === previousId);
  if (index < 0) next.investigationTargets.push(clone(target));
  else next.investigationTargets[index] = clone(target);
  if (previousId && previousId !== target.targetId) {
    next.initialAvailableTargetIds = next.initialAvailableTargetIds
      .map(id => id === previousId ? target.targetId : id);
    for (const rule of next.evidenceDiscoveryRules) {
      if (rule.targetId === previousId) rule.targetId = target.targetId;
      rule.discoveryResult.unlockedTargetIds = rule.discoveryResult.unlockedTargetIds
        .map(id => id === previousId ? target.targetId : id);
      rule.prerequisites.requiredCompletedActionIds = rule.prerequisites.requiredCompletedActionIds
        .map(id => id.startsWith(`completed_${previousId}__`)
          ? `completed_${target.targetId}__${id.slice(`completed_${previousId}__`.length)}` : id);
    }
  }
  next.initialAvailableTargetIds = next.initialAvailableTargetIds
    .filter(id => id !== target.targetId);
  if (target.initiallyAvailable) next.initialAvailableTargetIds.push(target.targetId);
  return next;
}

export function removeTarget(builder, targetId) {
  const next = progressionDraft(builder);
  next.investigationTargets = next.investigationTargets.filter(item => item.targetId !== targetId);
  next.initialAvailableTargetIds = next.initialAvailableTargetIds.filter(id => id !== targetId);
  next.evidenceDiscoveryRules = next.evidenceDiscoveryRules.filter(rule => rule.targetId !== targetId);
  for (const rule of next.evidenceDiscoveryRules) {
    rule.discoveryResult.unlockedTargetIds = rule.discoveryResult.unlockedTargetIds
      .filter(id => id !== targetId);
    rule.prerequisites.requiredCompletedActionIds = rule.prerequisites.requiredCompletedActionIds
      .filter(id => !id.startsWith(`completed_${targetId}__`));
  }
  return next;
}

export function upsertRule(builder, rule, previousId = null) {
  const next = progressionDraft(builder);
  const index = previousId == null ? -1
    : next.evidenceDiscoveryRules.findIndex(item => item.ruleId === previousId);
  if (index < 0) next.evidenceDiscoveryRules.push(clone(rule));
  else next.evidenceDiscoveryRules[index] = clone(rule);
  return next;
}

export function removeRule(builder, ruleId) {
  const next = progressionDraft(builder);
  next.evidenceDiscoveryRules = next.evidenceDiscoveryRules
    .filter(item => item.ruleId !== ruleId);
  return next;
}

export function investigationCompletionId(targetId, actionId) {
  return `completed_${targetId}__${actionId}`;
}

function safePart(value) {
  const normalized = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[^a-z]+/, '').replace(/_+/g, '_').replace(/_+$/g, '');
  return normalized || 'item';
}

export function nextTargetId(targetType, existingIds) {
  const prefix = `target_${safePart(targetType)}`;
  const used = new Set(existingIds);
  for (let index = 1; index <= 9999; index += 1) {
    const id = `${prefix}_${String(index).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
  throw new Error('Target IDを生成できません。');
}

export function nextRuleId(existingIds) {
  const used = new Set(existingIds);
  for (let index = 1; index <= 9999; index += 1) {
    const id = `discovery_rule_${String(index).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
  throw new Error('Discovery Rule IDを生成できません。');
}

export function objectionCandidates(references) {
  const candidates = [];
  const evidenceById = new Map((references?.evidence ?? [])
    .map(item => [item.evidenceId, item]));
  for (const contradiction of references?.contradictions ?? []) {
    if (contradiction.conflictingEvidenceIds.some(id => {
      const evidence = evidenceById.get(id);
      return !evidence || evidence.type === 'TESTIMONY'
        || evidence.visibility !== 'PLAYER_OBTAINABLE'
        || !evidence.purpose?.includes('CONTRADICTION_PROOF');
    })) continue;
    for (const exoneration of references?.exonerations ?? []) {
      if (!contradiction.conflictingEvidenceIds.every(id =>
        exoneration.supportingEvidenceIds.includes(id))) continue;
      const index = candidates.length + 1;
      candidates.push({ candidateId: `objection_candidate_${String(index).padStart(3, '0')}`,
        objectionRuleId: `objection_rule_${String(index).padStart(3, '0')}`,
        targetStatementId: contradiction.statementRef,
        acceptedEvidenceIds: [...contradiction.conflictingEvidenceIds],
        contradictionRef: contradiction.contradictionId,
        exonerationRef: exoneration.exonerationId,
        matchMode: 'ANY_PRESENTED' });
    }
  }
  return candidates;
}

function unique(values) { return new Set(values).size === values.length; }

function reachability(builder) {
  const targetById = new Map(builder.investigationTargets.map(item => [item.targetId, item]));
  const availableTargets = new Set(builder.initialAvailableTargetIds);
  const completedActions = new Set();
  const reachableEvidence = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const targetId of [...availableTargets]) {
      for (const actionId of targetById.get(targetId)?.availableActionIds ?? []) {
        const id = investigationCompletionId(targetId, actionId);
        if (!completedActions.has(id)) { completedActions.add(id); changed = true; }
      }
    }
    for (const rule of builder.evidenceDiscoveryRules) {
      if (!availableTargets.has(rule.targetId)
        || !rule.prerequisites.requiredEvidenceIds.every(id => reachableEvidence.has(id))
        || !rule.prerequisites.requiredCompletedActionIds.every(id => completedActions.has(id))) continue;
      if (!reachableEvidence.has(rule.evidenceId)) {
        reachableEvidence.add(rule.evidenceId); changed = true;
      }
      for (const targetId of rule.discoveryResult.unlockedTargetIds) {
        if (!availableTargets.has(targetId)) { availableTargets.add(targetId); changed = true; }
      }
    }
  }
  return { availableTargets, completedActions, reachableEvidence };
}

export function validateProgressionBuilder(builder, references) {
  const errors = [];
  const warnings = [];
  const error = (code, path, message) => errors.push({ code, path, message });
  const warning = (code, path, message) => warnings.push({ code, path, message });
  if (!builder) return { valid: false,
    errors: [{ code: 'BUILDER_NOT_READY', path: 'builder', message: 'Evidence Importを完了してください。' }],
    warnings: [] };
  const evidenceIds = new Set((references?.evidence ?? []).map(item => item.evidenceId));
  const statementIds = new Set((references?.statements ?? []).map(item => item.statementId));
  const sourceRefs = new Set((references?.investigationSourceNodes ?? [])
    .map(item => `${item.sourceType}:${item.sourceId}`));
  const actionById = new Map(builder.investigationActions.map(item => [item.actionId, item]));
  const targetById = new Map(builder.investigationTargets.map(item => [item.targetId, item]));
  if (!builder.initialCourtEvidenceIds.length) error('INITIAL_EVIDENCE_REQUIRED',
    'initialCourtEvidenceIds', 'Initial Courtに提示するEvidenceを選択してください。');
  if (!builder.initialCourtStatementIds.length) error('INITIAL_STATEMENT_REQUIRED',
    'initialCourtStatementIds', 'Initial Courtに提示するStatementを選択してください。');
  if (builder.initialCourtEvidenceIds.some(id => !evidenceIds.has(id))) error('INVALID_EVIDENCE_ID',
    'initialCourtEvidenceIds', '存在するEvidenceだけを選択してください。');
  if (builder.initialCourtStatementIds.some(id => !statementIds.has(id))) error('INVALID_STATEMENT_ID',
    'initialCourtStatementIds', '存在するStatementだけを選択してください。');
  if (!builder.publicMessages.initialRuling.trim()) error('INITIAL_RULING_REQUIRED',
    'publicMessages.initialRuling', '公開判定文を入力してください。');
  if (!builder.investigationEvidenceIds.length) error('INVESTIGATION_EVIDENCE_REQUIRED',
    'investigationEvidenceIds', 'Investigationで発見するEvidenceを選択してください。');
  if (builder.initialCourtEvidenceIds.some(id => !builder.investigationEvidenceIds.includes(id))) {
    error('INITIAL_EVIDENCE_NOT_INVESTIGABLE', 'initialCourtEvidenceIds',
      'Initial Court EvidenceはInvestigation Evidenceにも含めてください。');
  }
  if (!builder.investigationTargets.length) error('TARGET_REQUIRED',
    'investigationTargets', 'Investigation Targetを1件以上作成してください。');
  if (!unique(builder.investigationTargets.map(item => item.targetId))) error('DUPLICATE_TARGET_ID',
    'investigationTargets', 'Target IDが重複しています。');
  if (!unique(builder.evidenceDiscoveryRules.map(item => item.ruleId))) error('DUPLICATE_RULE_ID',
    'evidenceDiscoveryRules', 'Discovery Rule IDが重複しています。');
  if (!builder.initialAvailableTargetIds.length) error('INITIAL_TARGET_REQUIRED',
    'initialAvailableTargetIds', '初期状態で利用可能なTargetを選択してください。');
  for (const target of builder.investigationTargets) {
    if (!sourceRefs.has(`${target.sourceNodeRef.sourceType}:${target.sourceNodeRef.sourceId}`)) {
      error('INVALID_TARGET_SOURCE', `target:${target.targetId}`,
        'Target sourceは表示された候補から選択してください。');
    }
    if (!target.availableActionIds.length) error('TARGET_ACTION_REQUIRED', `target:${target.targetId}`,
      'Targetで利用可能なActionを選択してください。');
    for (const actionId of target.availableActionIds) {
      const action = actionById.get(actionId);
      if (!action || !action.allowedTargetTypes.includes(target.targetType)) {
        error('INVALID_TARGET_ACTION', `target:${target.targetId}`,
          'Target Typeで利用可能なActionだけを選択してください。');
      }
    }
    if (target.initiallyAvailable !== builder.initialAvailableTargetIds.includes(target.targetId)) {
      error('INITIAL_TARGET_MISMATCH', `target:${target.targetId}`,
        'initiallyAvailableの状態が一致しません。');
    }
  }
  const completionIds = new Set(builder.investigationTargets.flatMap(target =>
    target.availableActionIds.map(actionId => investigationCompletionId(target.targetId, actionId))));
  for (const rule of builder.evidenceDiscoveryRules) {
    const target = targetById.get(rule.targetId);
    if (!target || !target.availableActionIds.includes(rule.actionId)) error('INVALID_RULE_TARGET_ACTION',
      `rule:${rule.ruleId}`, 'RuleのTargetとActionの組合せが利用できません。');
    if (!builder.investigationEvidenceIds.includes(rule.evidenceId)) error('INVALID_RULE_EVIDENCE',
      `rule:${rule.ruleId}`, 'RuleのEvidenceをInvestigation Evidenceへ追加してください。');
    if (rule.prerequisites.requiredEvidenceIds.some(id =>
      !builder.investigationEvidenceIds.includes(id))) error('INVALID_PREREQUISITE_EVIDENCE',
      `rule:${rule.ruleId}`, 'Prerequisite EvidenceがInvestigation対象外です。');
    if (rule.prerequisites.requiredCompletedActionIds.some(id => !completionIds.has(id))) {
      error('INVALID_PREREQUISITE_ACTION', `rule:${rule.ruleId}`,
        'Prerequisite Actionが存在するTarget + Actionを参照していません。');
    }
    if (rule.discoveryResult.unlockedTargetIds.some(id => !targetById.has(id))) {
      error('INVALID_UNLOCK_TARGET', `rule:${rule.ruleId}`, 'Unlock Targetが存在しません。');
    }
    if (!rule.discoveryResult.publicMessage.trim()) error('PUBLIC_RESULT_REQUIRED',
      `rule:${rule.ruleId}`, '公開調査結果を入力してください。');
  }
  for (const evidenceId of builder.investigationEvidenceIds) {
    if (!builder.evidenceDiscoveryRules.some(rule => rule.evidenceId === evidenceId)) {
      error('MISSING_DISCOVERY_RULE', `evidence:${evidenceId}`,
        `このEvidenceにはDiscovery Ruleがありません: ${evidenceId}`);
    }
  }
  if (!builder.retrialStatementIds.length) error('RETRIAL_STATEMENT_REQUIRED',
    'retrialStatementIds', 'Retrial Courtで使用するStatementを選択してください。');
  if (builder.retrialStatementIds.some(id => !statementIds.has(id))) error('INVALID_RETRIAL_STATEMENT',
    'retrialStatementIds', '存在するStatementだけを選択してください。');
  if (!builder.objectionRules.length) error('OBJECTION_REQUIRED',
    'objectionRules', '既存Contradiction／Exonerationに基づくObjectionを選択してください。');
  for (const rule of builder.objectionRules) {
    if (!builder.retrialStatementIds.includes(rule.targetStatementId)) {
      error('OBJECTION_STATEMENT_NOT_RETRIAL', `objection:${rule.objectionRuleId}`,
        'Objection対象StatementをRetrial Courtへ追加してください。');
    }
    for (const evidenceId of rule.acceptedEvidenceIds) {
      if (!builder.investigationEvidenceIds.includes(evidenceId)) error('OBJECTION_EVIDENCE_NOT_INVESTIGABLE',
        `objection:${rule.objectionRuleId}`, '正解EvidenceをInvestigationへ追加してください。');
      if (!builder.evidenceDiscoveryRules.some(item => item.evidenceId === evidenceId)) {
        error('REQUIRED_EVIDENCE_RULE_MISSING', `evidence:${evidenceId}`,
          `法廷で必要ですが、発見方法が設定されていません: ${evidenceId}`);
      }
    }
  }
  if (!Number.isSafeInteger(builder.retryPolicy.maxCourtAttempts)
    || builder.retryPolicy.maxCourtAttempts < 1) error('INVALID_RETRY_LIMIT',
    'retryPolicy.maxCourtAttempts', 'maxCourtAttemptsは1以上の安全な整数にしてください。');
  for (const [field, label] of [['acquittalRuling', '無罪判決文'],
    ['acquittalExplanation', '無罪説明'], ['failureFeedback', '失敗Feedback']]) {
    if (!builder.publicMessages[field].trim()) error('PUBLIC_MESSAGE_REQUIRED',
      `publicMessages.${field}`, `${label}を入力してください。`);
  }
  const reachable = reachability(builder);
  for (const target of builder.investigationTargets) {
    if (!reachable.availableTargets.has(target.targetId)) warning('UNREACHABLE_TARGET',
      `target:${target.targetId}`, `初期Targetから到達できません: ${target.displayName}`);
  }
  for (const evidenceId of builder.investigationEvidenceIds) {
    if (!reachable.reachableEvidence.has(evidenceId)) error('UNREACHABLE_EVIDENCE',
      `evidence:${evidenceId}`, `初期Targetから発見できません: ${evidenceId}`);
  }
  return { valid: errors.length === 0, errors, warnings,
    reachability: { targetIds: [...reachable.availableTargets],
      evidenceIds: [...reachable.reachableEvidence] } };
}
