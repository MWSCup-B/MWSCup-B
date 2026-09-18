import { INVESTIGATION_TYPES } from './scenario-configuration.js';

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
