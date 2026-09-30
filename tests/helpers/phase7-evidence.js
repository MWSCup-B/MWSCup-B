import { buildEvidenceGenerationInput, importEvidencePackage }
  from '../../server/generation/evidence-interface.js';
import { contentDigest } from '../../server/generation/evidence-validator.js';
import { verifiedScenarioFixture } from './verified-scenario.js';
import { ransomwareEvidence } from './ransomware-evidence.js';

// Preserve complete incident records inside the quote limit. Mock background
// rows are appended later and are not part of a witness's preserved material.
export function fixtureIncidentQuotes(publicContent) {
  const chunks = [];
  let chunk = '';
  for (const line of publicContent.split('\n')) {
    if (line.length > 1000) throw new Error('Fixture incident record exceeds quote limit');
    if (chunk && chunk.length + line.length + 1 > 1000) { chunks.push(chunk); chunk = ''; }
    chunk += (chunk ? '\n' : '') + line;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function artifact(input, values) {
  const publicContent = values.publicContent;
  return { schemaVersion: '1.0', evidenceId: values.evidenceId, type: values.type,
    title: values.title, publicContent, sourceRefs: structuredClone(values.sourceRefs),
    requirementIds: [...values.requirementIds], purpose: [...values.purpose],
    provenance: { origin: 'EXTERNAL_USER_CODEX',
      verificationId: input.evidenceAgentInput.verificationResult.verificationId,
      scenarioId: input.evidenceAgentInput.scenarioImportPackage.scenarioDraft.scenarioId,
      attackGraphRef: structuredClone(input.evidenceAgentInput.scenarioImportPackage.scenarioDraft.attackGraphRef) },
    visibility: 'PLAYER_OBTAINABLE',
    integrity: { algorithm: 'SHA-256', publicContentDigest: contentDigest(publicContent) },
    testimony: values.testimony ?? null };
}

export function phase7Fixture(phase6 = verifiedScenarioFixture()) {
  const evidenceGenerationInput = buildEvidenceGenerationInput({
    scenarioVerificationInput: phase6.verificationInput,
    verificationResult: phase6.verificationResult,
  });
  const agent = evidenceGenerationInput.evidenceAgentInput;
  const requirements = Object.fromEntries(agent.evidenceRequirements.requirements
    .map(item => [item.requirementId, item]));
  const attackGround = requirements.requirement_attack.grounds[0];
  const timelineGround = requirements.requirement_timeline.grounds[0];
  const contradictionGround = requirements.requirement_contradiction.grounds[0];
  const exonerationGround = requirements.requirement_exoneration.grounds[0];
  const evidenceArtifacts = [
    artifact(evidenceGenerationInput, { evidenceId: 'evidence_technical_a', type: 'APPLICATION_LOG',
      title: 'アプリケーションログ', publicContent: '隔離環境の要求処理記録が操作時刻を示している。',
      sourceRefs: [attackGround, contradictionGround, exonerationGround],
      requirementIds: ['requirement_attack', 'requirement_contradiction', 'requirement_exoneration'],
      purpose: ['ATTACK_TRACE', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF'] }),
    artifact(evidenceGenerationInput, { evidenceId: 'evidence_technical_b', type: 'NETWORK_LOG',
      title: '通信記録', publicContent: '隔離環境の通信記録がイベントの順序を示している。',
      sourceRefs: [timelineGround, contradictionGround, exonerationGround],
      requirementIds: ['requirement_timeline', 'requirement_contradiction', 'requirement_exoneration'],
      purpose: ['TIMELINE_PROOF', 'CONTRADICTION_PROOF', 'EXONERATION_PROOF'] }),
    artifact(evidenceGenerationInput, { evidenceId: 'evidence_testimony', type: 'TESTIMONY',
      title: '証言者の供述',
      publicContent: '検察側調査官は「その操作を直接見た」「記録の時刻も確認した」と発言した。',
      sourceRefs: [contradictionGround], requirementIds: ['requirement_contradiction'],
      purpose: ['CONTRADICTION_PROOF'], testimony: { witnessCharacterId: 'character_witness',
        statements: [{ statementId: 'statement_seen_operation', spokenContent: 'その操作を直接見た',
          technicalAssessment: 'CONTRADICTED', groundTruthRefs: [contradictionGround.sourceId],
          contradictionCandidate: true },
        { statementId: 'statement_checked_time', spokenContent: '記録の時刻も確認した',
          technicalAssessment: 'CONSISTENT', groundTruthRefs: [contradictionGround.sourceId],
          contradictionCandidate: false }] } }),
  ];
  // Author用の全資料要件を、別の既成Scenarioに置き換えず、そのままEvidenceへ展開する。
  const observations = agent.evidenceRequirements.requirements
    .filter(item => item.requirementId.startsWith('requirement_observation_'));
  if (observations.length) {
    const kinds = {
    clickfix_page_record: ['DOCUMENT', '修復を装う案内の保存資料',
      'request_id: training-page-01\nresponse_time: 2026-09-18T09:10:00+09:00\ninstruction_ref: training-operation-01\n案内本文: 本人確認を完了するため、端末の実行画面で確認操作を行ってください。操作識別子: training-operation-01'],
    process_execution_record: ['DEVICE_INFORMATION', 'プロセスの起動観測',
      '{"timestamp":"2026-09-18T09:10:00+09:00","device_id":"training-device-01","process_ref":"training-process-01","parent_ref":"training-parent-01","user_ref":"training-user","start_result":"started","instruction_ref":"training-operation-01"}'],
    spray_authentication_record: ['AUTHENTICATION_LOG', '複数アカウントの試行履歴',
      '{"timestamp":"2026-09-18T09:10:00+09:00","account":"training-a","source_ip":"203.0.113.10","attempt_id":"training-attempt-01","result":"failure"}\n{"timestamp":"2026-09-18T09:10:00+09:00","account":"training-b","source_ip":"203.0.113.10","attempt_id":"training-attempt-02","result":"failure"}\n{"timestamp":"2026-09-18T09:10:00+09:00","account":"training-c","source_ip":"203.0.113.10","attempt_id":"training-attempt-03","result":"success"}'],
    authentication_policy_record: ['DOCUMENT', '事件時に保存された認証方針',
      'authentication: password_only\nscope: training-accounts\nlockout_condition: 対象試行を遮断しない条件。具体的なしきい値は未入力。\nrate_limit_condition: 対象試行を遮断しない条件。具体的なしきい値は未入力。\napplied_at: 事件時の適用設定。正確な設定変更時刻は未入力。'],
    file_encryption_record: ['FILE_METADATA', '対象ファイルの変更前後検査',
      'timestamp: 2026-09-18T09:10:00+09:00\npath: training-files/report.txt\nprocess_ref: training-process-01\nhash_before: synthetic-hash-before\nhash_after: synthetic-hash-after\nencryption_check: confirmed\nransom_note: このファイルの復元と引換えに金銭を要求する。'],
    upload_receipt_record: ['APPLICATION_LOG', '添付受入れの監査資料',
      '{"timestamp":"2026-09-18T09:10:00+09:00","request_ref":"training-upload-01","source_ref":"external-sender-01","filename":"training-image.png","declared_type":"image/png","storage_ref":"training-file-02","result":"stored"}'],
    uploaded_file_record: ['FILE_METADATA', '保存済み添付の内容検査',
      'storage_ref: training-file-02\nstored_at: 2026-09-18T09:10:00+09:00\nhash: synthetic-file-hash\ndetected_type: text/plain\ncontent_check: disallowed\nexecutable_storage: false'],
    email_record: ['EMAIL', '保存メール',
      'From: notice@example.invalid\nSubject: ポータルからのお知らせ\nContent-Type: text/html; charset=UTF-8\n\n次の案内を確認してください。\n<a href="https://portal.example.invalid/notice?ref=training-01">https://portal.example.invalid/help</a>'],
    web_access_record: ['WEB_ACCESS_LOG', 'Webアクセス記録',
      '{"timestamp":"2026-09-18T09:10:00+09:00","request_id":"training-request-01","host":"portal.example.invalid","request_target":"/notice?ref=training-01"}'],
    browser_execution_record: ['DEVICE_INFORMATION', 'ブラウザのスクリプト実行記録',
      '{"timestamp":"2026-09-18T09:10:01+09:00","request_id":"training-request-01","host":"portal.example.invalid","request_target":"/notice?ref=training-01","execution_id":"training-script-01","execution_result":"observed"}'],
    database_statement_record: ['DATABASE_LOG', 'DB実行記録',
      '{"query_id":"training-query-01","statement":"SELECT title FROM training_records WHERE category = \'public\'"}'],
    stored_content_record: ['APPLICATION_LOG', '保存投稿の監査資料',
      '{"post_id":"training-post-01","stored_content":"<script>/* synthetic inert sample */</script>"}'],
    credential_submission_record: ['APPLICATION_LOG', '偽フォームの送信受信記録',
      '{"timestamp":"2026-09-18T09:10:01+09:00","request_id":"training-request-01","host":"portal.example.invalid","source_page":"/notice?ref=training-01","destination":"https://lure.example.invalid/form","correlation_id":"training-form-01","result":"received"}'],
    authentication_record: ['AUTHENTICATION_LOG', '認証監査記録',
      '{"timestamp":"2026-09-18T09:10:00+09:00","auth_event_ref":"training-auth-01","account":"training-editor","result":"success","source_ip":"203.0.113.10"}'],
    application_session_record: ['APPLICATION_LOG', 'セッション監査記録',
      '{"timestamp":"2026-09-18T09:10:01+09:00","auth_event_ref":"training-auth-01","account":"training-editor","session_accepted":true,"permission":"post"}'] };
    // 2026-09-24: mainの資料も定義済みの観測項目を持つ合成データで検証する。
    const extendedRecords = {
      announcement_audit_record: { timestamp: '2026-09-18T09:10:02+09:00', request_id: 'training-submit-01', session_id: 'training-session-01', post_id: 'training-notice-02', result: 'created' },
      browser_request_initiator_record: { timestamp: '2026-09-18T09:10:01+09:00', source_post_id: 'training-post-01', view_request_id: 'training-view-01', execution_id: 'training-script-01', request_id: 'training-submit-01', initiator_type: 'script', source_location: '/notice?ref=training-01:1:1' },
      application_response_record: { timestamp: '2026-09-18T09:10:01+09:00', request_id: 'training-request-01', query_id: 'training-query-01', record_refs: ['synthetic-record-01'], status: 200 },
      ssh_authentication_record: { timestamp: '2026-09-18T09:10:00+09:00', connection_ref: 'training-connection-01', account: 'training-user', source_ip: '203.0.113.10', result: 'success' },
      ssh_session_record: { timestamp: '2026-09-18T09:10:01+09:00', connection_ref: 'training-connection-01', session_ref: 'training-session-01', user: 'training-user', shell_result: 'started' },
      traversal_access_record: { timestamp: '2026-09-18T09:10:00+09:00', request_id: 'training-traversal-01', request_target: '/download?file=training-report.txt' },
      traversal_read_record: { timestamp: '2026-09-18T09:10:01+09:00', request_id: 'training-traversal-01', path: 'training-report.txt', read_result: 'success', response_result: 'returned' },
      sudo_policy_record: { user: 'training-user', allowed_command: '/training/maintenance-tool', run_as: 'root' },
      sudo_execution_record: { process_ref: 'training-root-process', parent_ref: 'training-user-process', command: '/training/maintenance-tool', effective_uid: 0 },
      setuid_metadata_record: { timestamp: '2026-09-18T09:10:00+09:00', path: '/training/maintenance-tool', owner: 'root', setuid: true },
      setuid_execution_record: { process_ref: 'training-root-process', parent_ref: 'training-user-process', path: '/training/maintenance-tool', effective_uid: 0 },
      service_acl_record: { path: 'C:/training/service.exe', service_account: 'LocalSystem', acl: 'training-user:write' },
      service_execution_record: { timestamp: '2026-09-18T09:10:00+09:00', path: 'C:/training/service.exe', file_change: 'observed', restart_result: 'started', effective_identity: 'LocalSystem' },
      collection_read_record: { process_ref: 'training-root-process', path: '/training/protected-report.txt', read_result: 'success' },
      collection_output_record: { path: '/training/collection/report.txt', source_path: '/training/protected-report.txt', process_ref: 'training-root-process' },
    };
    const technical = observations.map((requirement, index) => {
      const ground = requirement.grounds[0];
      const matching = agent.evidenceRequirements.requirements.filter(item => item.grounds
        .some(ref => ref.sourceType === ground.sourceType && ref.sourceId === ground.sourceId
          && ref.attackNodeId === ground.attackNodeId));
// 2026-09-20 修正前: 追加攻撃の取得定義を使ってモックの生成経路を検証
//       const [type, title, body] = kinds[ground.sourceId];
// 2026-09-20 修正後: 追加攻撃の取得定義を使ってモックの生成経路を検証
      const node = agent.attackGraph.nodes.find(item => item.nodeId === ground.attackNodeId);
      const observation = agent.attackDefinitions.find(item => item.id === node.attackDefinitionId)
        .observableArtifacts.find(item => item.id === ground.sourceId);
      const event = agent.timeline.events.find(item => item.attackNodeId === ground.attackNodeId);
      const timestamp = agent.timeline.narrativeTimestamps.find(item => item.eventId === event?.eventId);
      const ransom = node.attackDefinitionId === 'ransomware' ? ransomwareEvidence(timestamp?.displayTimestamp) : {};
      const [type, title, body] = ransom[ground.sourceId] ?? kinds[ground.sourceId] ?? [observation.acquisition.type,
        // 2026-09-24 修正前: observation.id, '教材用合成資料: ' + observation.description];
        observation.id, JSON.stringify(extendedRecords[ground.sourceId])];
      // Keep each observed chain on its own scenario time instead of moving only
      // the Web row while leaving browser/authentication events in the past.
      const baseTime = Date.parse(timestamp?.displayTimestamp ?? '2026-09-18T09:10:00+09:00');
      let publicContent = node.attackDefinitionId === 'ransomware' ? body : body.replace(
        /2026-09-18T09:10:(\d{2})\+09:00/g,
        (_match, seconds) => new Date(baseTime + Number(seconds) * 1000).toISOString());
      const impact = node.effects.some(effect => ['false_announcement_posted_by_script', 'restricted_rows_disclosed'].includes(effect.predicate));
      if (impact && ['web_access_record', 'browser_execution_record', 'database_statement_record'].includes(ground.sourceId)) {
        const row = JSON.parse(publicContent);
        row.request_id = node.attackDefinitionId === 'stored_xss' ? 'training-view-01' : 'training-request-01';
        if (ground.sourceId === 'browser_execution_record') row.post_id = 'training-post-01';
        if (ground.sourceId === 'database_statement_record') row.statement = "SELECT title FROM training_records WHERE category = 'public' OR category = 'restricted'";
        publicContent = JSON.stringify(row);
      }
      return artifact(evidenceGenerationInput, { evidenceId: index === 0 ? 'evidence_technical_a'
        : index === 1 ? 'evidence_technical_b' : `evidence_technical_${index + 1}`,
      type, title, publicContent, sourceRefs: [ground],
      requirementIds: matching.map(item => item.requirementId),
      purpose: [...new Set(matching.map(item => item.purpose))] });
    });
    const spokenContent = '提示された技術資料だけで、被告人が自分の意思で対象の操作を行ったと特定できる。';
    const testimony = evidenceArtifacts[2];
    testimony.publicContent = `検察側調査官の主張: 「${spokenContent}」`;
    testimony.testimony.statements = [{ statementId: 'statement_seen_operation', spokenContent,
      technicalAssessment: 'CONTRADICTED', groundTruthRefs: [contradictionGround.sourceId],
      contradictionCandidate: true }];
    testimony.integrity.publicContentDigest = contentDigest(testimony.publicContent);
    evidenceArtifacts.splice(0, evidenceArtifacts.length, ...technical, testimony);
  }
  const contradictions = [{ schemaVersion: '1.0', contradictionId: 'contradiction_seen_operation',
    testimonyEvidenceId: 'evidence_testimony', statementRef: 'statement_seen_operation',
    conflictingEvidenceIds: ['evidence_technical_a'], groundTruthRefs: [contradictionGround.sourceId],
    reason: '証言の人物断定は技術記録から支持されない。' }];
  const exonerations = [{ schemaVersion: '1.0', exonerationId: 'exoneration_defendant',
    defendantCharacterId: 'character_defendant',
    // The whole case is supported by the union of its separately acquired
    // materials; a final issue need not quote every earlier attack again.
    supportingEvidenceIds: observations.length ? evidenceArtifacts.filter(item => item.type !== 'TESTIMONY').map(item => item.evidenceId)
      : ['evidence_technical_a', 'evidence_technical_b'],
    groundTruthRefs: [...new Set([contradictionGround.sourceId,
      ...(observations.length ? agent.groundTruth.technicalFacts.filter(item => item.sourceType === 'ATTACK_NODE').map(item => item.factId) : []),
      ])],
    reason: '複数の技術資料に記録された対象・処理・結果を照合すると、確認できる攻撃経路は検察側の直接操作説と両立しない。アカウント・IP・端末情報だけで実際の操作者を断定しない。' }];
  const evidencePackage = { schemaVersion: '1.0', generationInputRef: {
    evidenceGenerationInputId: evidenceGenerationInput.evidenceGenerationInputId,
    inputFingerprint: agent.inputFingerprint,
    verificationId: agent.verificationResult.verificationId,
  }, scenarioId: phase6.scenarioPackage.scenarioDraft.scenarioId,
  attackGraphRef: structuredClone(phase6.scenarioPackage.scenarioDraft.attackGraphRef),
  evidenceArtifacts, contradictions, exonerations };
  const evidenceImportResult = importEvidencePackage({ generationInput: evidenceGenerationInput,
    evidencePackage });
  return structuredClone({ ...phase6, evidenceGenerationInput, evidencePackage,
    evidenceImportResult, evidenceSet: evidenceImportResult.evidenceSet,
    gameCaseHandoff: evidenceImportResult.gameCaseHandoff, contradictions, exonerations });
}
