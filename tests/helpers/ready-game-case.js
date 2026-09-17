import { buildGameCaseConversionInput, buildGameProgressionPlan, convertGameCase }
  from '../../server/generation/game-case-converter.js';
import { phase7Fixture } from './phase7-evidence.js';
import { DEFAULT_INVESTIGATION_ACTIONS } from '../../server/generation/investigation-validator.js';

export function investigationFixtureDesign() {
  return {
    investigationActions: structuredClone(DEFAULT_INVESTIGATION_ACTIONS),
    investigationTargets: [
      { schemaVersion: '1.0', targetId: 'target_web_server', targetType: 'SERVER',
        displayName: 'Webサーバ', description: '事件に関係する合成Webサーバです。',
        sourceNodeRef: { sourceType: 'NETWORK_NODE', sourceId: 'web-host' },
        availableActionIds: ['action_audit_log', 'action_analyze_network_log',
          'action_check_configuration'], initiallyAvailable: true },
      { schemaVersion: '1.0', targetId: 'target_client_endpoint', targetType: 'ENDPOINT',
        displayName: 'クライアント端末', description: '事件に関係する合成クライアント端末です。',
        sourceNodeRef: { sourceType: 'NETWORK_NODE', sourceId: 'client-host' },
        availableActionIds: ['action_inspect_device', 'action_check_browser_history',
          'action_inspect_file', 'action_check_configuration'], initiallyAvailable: true },
    ],
    initialAvailableTargetIds: ['target_web_server', 'target_client_endpoint'],
    evidenceDiscoveryRules: [
      { schemaVersion: '1.0', ruleId: 'discovery_technical_a',
        evidenceId: 'evidence_technical_a', targetId: 'target_web_server',
        actionId: 'action_audit_log',
        prerequisites: { requiredEvidenceIds: [], requiredCompletedActionIds: [] },
        discoveryResult: { publicMessage: 'Webサーバの監査ログに通常と異なる処理記録が見つかりました。',
          discovered: true, unlockedTargetIds: [], nextHints: ['関連する通信記録も確認できます。'] },
        repeatable: false },
      { schemaVersion: '1.0', ruleId: 'discovery_technical_b',
        evidenceId: 'evidence_technical_b', targetId: 'target_web_server',
        actionId: 'action_analyze_network_log',
        prerequisites: { requiredEvidenceIds: ['evidence_technical_a'],
          requiredCompletedActionIds: [] },
        discoveryResult: { publicMessage: '関連する通信ログに時系列を確認できる記録が見つかりました。',
          discovered: true, unlockedTargetIds: [], nextHints: [] }, repeatable: false },
      { schemaVersion: '1.0', ruleId: 'discovery_testimony',
        evidenceId: 'evidence_testimony', targetId: 'target_client_endpoint',
        actionId: 'action_inspect_device',
        prerequisites: { requiredEvidenceIds: [], requiredCompletedActionIds: [] },
        discoveryResult: { publicMessage: '端末の調査から関係者への確認が必要だと分かりました。',
          discovered: true, unlockedTargetIds: [], nextHints: [] }, repeatable: false },
    ],
  };
}

export function readyGameCaseFixture({ maxCourtAttempts = 3 } = {}) {
  const fixture = phase7Fixture();
  const investigation = investigationFixtureDesign();
  const progressionPlan = buildGameProgressionPlan({
    scenarioId: fixture.evidenceSet.scenarioId,
    evidenceSetId: fixture.evidenceSet.evidenceSetId,
    attackGraphRef: fixture.evidenceSet.attackGraphRef,
    initialCourtEvidenceIds: ['evidence_technical_b'],
    initialCourtStatementIds: ['statement_seen_operation'],
    investigationEvidenceIds: ['evidence_technical_a', 'evidence_technical_b', 'evidence_testimony'],
    ...investigation,
    retrialStatementIds: ['statement_seen_operation', 'statement_checked_time'],
    returnToCourtCondition: 'ALL_REQUIRED_EVIDENCE_COLLECTED',
    objectionRules: [{ objectionRuleId: 'objection_seen_operation',
      targetStatementId: 'statement_seen_operation',
      acceptedEvidenceIds: ['evidence_technical_a'],
      contradictionRef: 'contradiction_seen_operation', exonerationRef: 'exoneration_defendant' }],
    retryPolicy: { maxCourtAttempts, onFailure: 'RETURN_TO_INVESTIGATION',
      onLimitReached: 'BLOCKED' },
    publicMessages: { initialRuling: '現在の証拠だけを見ると被告人への疑いが残ります。',
      acquittalRuling: '被告人を無罪とします。',
      acquittalExplanation: '取得した記録により、人物を断定する主張は維持できません。',
      failureFeedback: 'この証拠では、この主張を崩せません。' },
  });
  const conversionInput = buildGameCaseConversionInput({
    evidenceImportResult: fixture.evidenceImportResult,
    gameCaseHandoff: fixture.gameCaseHandoff, evidenceSet: fixture.evidenceSet,
    scenarioPackage: fixture.scenarioPackage, characters: fixture.scenarioPackage.characters,
    timeline: fixture.scenarioPackage.timeline, verificationResult: fixture.verificationResult,
    progressionPlan, scenarioGenerationInput: fixture.generationInput,
    contradictions: fixture.contradictions, exonerations: fixture.exonerations });
  const gameCaseResult = convertGameCase(conversionInput);
  return { ...fixture, progressionPlan, conversionInput, gameCaseResult,
    gameCase: gameCaseResult.gameCase, publicGameCase: gameCaseResult.publicGameCase };
}
