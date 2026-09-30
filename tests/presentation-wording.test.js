import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationWordingProblems } from '../server/generation/court-claim-style.js';
import { evidenceDraftProblems } from '../server/generation/evidence-draft-validation.js';
import { materializeEvidenceGenerationDraft } from '../server/generation/evidence-interface.js';
import { AutoGenerationManager, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { MockCodexRunner } from './helpers/mock-codex.js';

let validDraft, agent;
test.before(async () => {
  class CaptureRunner extends MockCodexRunner {
    async runJson(args) {
      const result = await super.runJson(args);
      if (args.phase === 'GENERATING_EVIDENCE') validDraft = structuredClone(result);
      return result;
    }
  }
  const manager = new AutoGenerationManager({ jsonRunner: new CaptureRunner() });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['stored_xss'], settingId: 'company' });
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(session.auto.details));
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
  agent = session.evidenceGenerationInput.evidenceAgentInput;
});

test('表示用語の検査は端末・実行・ブラウザの全記録に適用し、記録対象が明確な語を認める', () => {
  for (const text of ['ブラウザ計測', '端末計測', '実行計測', '処理の計測結果', '架空の調査担当者', 'ブラウザ実行記録',
    '当該記録を確認します。', '確認した事実を申し上げます。', '以上の理由から無罪です。',
    '資料を確認することができます。', '一致することが確認されました。']) {
    assert.ok(presentationWordingProblems(text).length, text);
  }
  for (const text of ['ブラウザの動作記録', 'ブラウザのスクリプト実行記録', 'プロセスの起動記録',
    'ファイルの検査結果', '応答時間の測定値', '検察側調査官', '教材用の無効な連絡先',
    'その記録を確認します。', 'ここまでに分かったことを整理します。', '資料を確認できます。']) {
    assert.deepEqual(presentationWordingProblems(text), [], text);
  }
});

test('証言・反論・解説・調査手順の用語を同じ基準で差し戻し、対象フィールドを示す', () => {
  const draft = structuredClone(validDraft);
  const technicalIndex = draft.evidenceArtifacts.findIndex(item => item.type !== 'TESTIMONY');
  const testimonyIndex = draft.evidenceArtifacts.findIndex(item => item.type === 'TESTIMONY');
  draft.evidenceArtifacts[technicalIndex].title = '端末計測';
  draft.evidenceArtifacts[testimonyIndex].publicContent = '架空の調査担当者の供述。';
  draft.evidenceArtifacts[testimonyIndex].testimony.statements[0].spokenContent = '実行計測を確認しました。';
  draft.courtQuestions[0].prompt = 'ブラウザ計測から何が言えますか。';
  draft.courtQuestions[0].choices[0] = '端末計測に対象の処理が残っています。';
  draft.courtQuestions[0].explanation = '架空の資料を照合します。';
  draft.materialInvestigations[0].steps[0].prompt = '実行計測を確認する。';
  draft.materialInvestigations[0].steps[0].explanation = 'ブラウザ記録を照合する。';
  draft.materialInvestigations[0].steps[0].choices[0].description = '架空の資料を読む。';
  draft.contradictions[0].reason = '端末計測が説明と一致しません。';
  draft.exonerations[0].reason = '架空の端末を利用していたためです。';
  const before = structuredClone(draft);
  const result = evidenceDraftProblems(draft, materializeEvidenceGenerationDraft(draft), agent)
    .filter(item => item.code === 'EVIDENCE_PRESENTATION_TERMINOLOGY');
  assert.deepEqual(new Set(result.map(item => item.field)), new Set([
    `evidenceArtifacts[${technicalIndex}].title`,
    `evidenceArtifacts[${testimonyIndex}].publicContent`,
    `evidenceArtifacts[${testimonyIndex}].testimony.statements[0].spokenContent`,
    'courtQuestions[0].prompt', 'courtQuestions[0].choices[0]', 'courtQuestions[0].explanation',
    'materialInvestigations[0].steps[0].prompt', 'materialInvestigations[0].steps[0].explanation',
    'materialInvestigations[0].steps[0].choices[0].description',
    'contradictions[0].reason', 'exonerations[0].reason',
  ]));
  assert.ok(result.every(item => item.correctionHint.includes('原文・引用・参照・観測値は変更しません')));
  assert.deepEqual(draft, before);
});

test('証拠の原文と正確な引用は表示文の言い換え対象にせず、生成済み内容を保持する', () => {
  const draft = structuredClone(validDraft);
  const technical = draft.evidenceArtifacts.find(item => item.type !== 'TESTIMONY');
  const text = '保存文面に「架空の資料」「端末計測」と記載されていた。';
  technical.publicContent = text;
  draft.courtQuestions[0].supportingQuotes = [{ evidenceId: technical.evidenceId, quote: text }];
  const before = structuredClone(draft);
  const materialized = materializeEvidenceGenerationDraft(draft);
  const sealed = structuredClone(materialized);
  const result = evidenceDraftProblems(draft, materialized, agent);
  assert.deepEqual(result.filter(item => item.code === 'EVIDENCE_PRESENTATION_TERMINOLOGY'), []);
  assert.deepEqual(draft, before);
  assert.deepEqual(materialized, sealed);
});

test('不適切な表示語は証拠生成の修正工程で直し、未修正のままゲームへ渡さない', async () => {
  class WordingRunner extends MockCodexRunner {
    async runJson(args) {
      const draft = await super.runJson(args);
      if (args.phase === 'GENERATING_EVIDENCE' && this.evidenceCalls === 1) {
        draft.evidenceArtifacts.find(item => item.type !== 'TESTIMONY').title = '端末計測';
        draft.courtQuestions[0].explanation = '架空の調査担当者による説明。';
      }
      return draft;
    }
  }
  const runner = new WordingRunner();
  const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession();
  manager.submitSelection(session, { schemaVersion: '1.0', attackIds: ['stored_xss'], settingId: 'company' });
  await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(session.auto.details));
  assert.equal(runner.evidenceCalls, 2);
  const repair = runner.calls.filter(call => call.phase === 'GENERATING_EVIDENCE')[1];
  assert.equal(repair.feedback.errors.filter(item => item.code === 'EVIDENCE_PRESENTATION_TERMINOLOGY').length, 2);
});
