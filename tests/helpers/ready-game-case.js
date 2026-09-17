import { buildGameCaseConversionInput, buildGameProgressionPlan, convertGameCase }
  from '../../server/generation/game-case-converter.js';
import { phase7Fixture } from './phase7-evidence.js';

export function readyGameCaseFixture({ maxCourtAttempts = 3 } = {}) {
  const fixture = phase7Fixture();
  const progressionPlan = buildGameProgressionPlan({
    scenarioId: fixture.evidenceSet.scenarioId,
    evidenceSetId: fixture.evidenceSet.evidenceSetId,
    attackGraphRef: fixture.evidenceSet.attackGraphRef,
    initialCourtEvidenceIds: ['evidence_technical_b'],
    initialCourtStatementIds: ['statement_seen_operation'],
    investigationEvidenceIds: ['evidence_technical_a', 'evidence_technical_b', 'evidence_testimony'],
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
    progressionPlan, contradictions: fixture.contradictions, exonerations: fixture.exonerations });
  const gameCaseResult = convertGameCase(conversionInput);
  return { ...fixture, progressionPlan, conversionInput, gameCaseResult,
    gameCase: gameCaseResult.gameCase, publicGameCase: gameCaseResult.publicGameCase };
}
