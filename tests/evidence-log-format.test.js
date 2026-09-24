import test from 'node:test';
import assert from 'node:assert/strict';
import { LOG_TYPES, validateGeneratedLogFormats } from '../server/generation/evidence-log-format.js';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

test('generated logs keep observation records without adding format fields or rewriting original bytes', () => {
  const contents = {
    WEB_ACCESS_LOG: '{"timestamp":"2026-09-18T09:10:00+09:00","request_target":"/notice"}',
    AUTHENTICATION_LOG: '{"account":"staff-a","result":"failure"}\r\n{"account":"staff-b","result":"success"}\r\n',
    APPLICATION_LOG: '{"post_id":"post-01","stored_content":"<script>not executed</script>"}',
    DATABASE_LOG: '{"statement":"SELECT title FROM records","query_id":"query-01"}',
    NETWORK_LOG: '{"source_ip":"192.0.2.10","destination_ip":"192.0.2.20"}',
  };
  const artifacts = LOG_TYPES.map(type => ({ type, publicContent: contents[type] }));
  const before = structuredClone(artifacts);
  validateGeneratedLogFormats(artifacts);
  assert.deepEqual(artifacts, before);
});

test('prose logs, commentary fields and malformed record containers are rejected for all log kinds', () => {
  for (const type of LOG_TYPES) for (const publicContent of [
    '教材用合成ログ\n{"account":"staff-a"}', '説明だけのログです。', '[]', 'null', '{}',
    '{\n"account":"staff-a"\n}', '{"account":"staff-a"}\n\n{"account":"staff-b"}',
    '{"note":"この記録では操作者は不明"}', '{"event":{"explanation":"解説"}}',
  ]) assert.throws(() => validateGeneratedLogFormats([{ type, publicContent }]),
    { code: 'EVIDENCE_LOG_FORMAT_INVALID', field: 'evidenceArtifacts[0].publicContent' });
});

test('format verification does not turn testimony, saved mail or a document into logs', () => {
  for (const type of ['EMAIL', 'TESTIMONY', 'DOCUMENT', 'FILE_METADATA']) {
    assert.doesNotThrow(() => validateGeneratedLogFormats([{ type, publicContent: '保存資料の本文。' }]));
  }
});

for (const repairs of [true, false]) test(`automatic generation ${repairs ? 'repairs' : 'blocks'} prose logs in two attempts`, async () => {
  class ProseLogRunner extends MockCodexRunner {
    async runJson(args) {
      const draft = await super.runJson(args);
      if (args.phase === 'GENERATING_EVIDENCE' && (!repairs || this.evidenceCalls === 1)) {
        const log = draft.evidenceArtifacts.find(item => item.type === 'WEB_ACCESS_LOG');
        log.publicContent = `補足説明：この記録だけでは人物不明。\n${log.publicContent}`;
      }
      return draft;
    }
  }
  const runner = new ProseLogRunner();
  const manager = new AutoGenerationManager({ jsonRunner: runner }); const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['phishing'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  assert.equal(runner.evidenceCalls, 2);
  assert.equal(session.auto.state, repairs ? 'READY' : 'FAILED', JSON.stringify(session.auto.details));
  assert.ok(session.auto.details.some(item => item.code === 'EVIDENCE_LOG_FORMAT_INVALID'));
  assert.equal(Boolean(session.runtime), repairs);
});
