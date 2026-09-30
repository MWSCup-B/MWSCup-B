import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoGenerationManager, createAutoAuthorSession, autoAuthorView } from '../server/auto-generation-service.js';
import { materializeEvidenceGenerationDraft } from '../server/generation/evidence-interface.js';
import { evidenceDraftProblems } from '../server/generation/evidence-draft-validation.js';
import { validatePhishingObservations, phishingMailLinks } from '../server/generation/phishing-evidence.js';
import { createGeneratedGame, actGenerated } from '../server/generated-game.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { syncQuestionQuotes, collectCurrentTarget, enterCurrentCourt, currentCorrectPair } from './helpers/court-issues.js';

const request = { schemaVersion: '1.0', attackIds: ['phishing'], settingId: 'company' };
let validDraft, agent;
test.before(async () => {
  class CaptureRunner extends MockCodexRunner {
    async runJson(args) {
      const result = await super.runJson(args);
      if (args.phase === 'GENERATING_EVIDENCE') {
        validDraft = structuredClone(result);
      }
      return result;
    }
  }
  const manager = new AutoGenerationManager({ jsonRunner: new CaptureRunner() }); const session = createAutoAuthorSession();
  manager.submitSelection(session, request);
  const originalConfiguration = structuredClone(session.configuration);
  await manager.waitForIdle();
  assert.equal(session.auto.state, 'SCENARIO_PREVIEW', JSON.stringify(autoAuthorView(session).developerDetails));
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, 'READY', JSON.stringify(autoAuthorView(session).developerDetails));
  agent = session.evidenceGenerationInput.evidenceAgentInput;
  assert.deepEqual(session.configuration, originalConfiguration);
});

function reportedDefects(draft) {
  const log = draft.evidenceArtifacts.find(item => item.type === 'WEB_ACCESS_LOG');
  log.publicContent = [1, 2, 3].map(index => JSON.stringify({ event: `synthetic-event-${index}` })).join('\n');
  syncQuestionQuotes(draft);
  for (const question of draft.courtQuestions) {
    question.supportingQuotes[0].quote = '公開原文にはない引用';
  }
  return draft;
}

test('フィッシングの目標は取得可能な観測を優先し、URL不一致と宿題の手順を必須にしない', () => {
  const requirements = agent.evidenceRequirements.requirements;
  for (const id of ['requirement_attack', 'requirement_goal_1']) {
    const description = requirements.find(item => item.requirementId === id).description;
    assert.doesNotMatch(description, /実際に遷移するリンク先|異なる表示URLとhref.*必ず/);
    assert.match(description, /不一致.*必須にしない/);
  }
  const observation = source => requirements.find(item => item.requirementId.startsWith('requirement_observation_')
    && item.grounds.some(ground => ground.sourceId === source));
  assert.match(observation('email_record').description, /リンクをpublicContent.*メールのみを取得する段階.*このメールだけ/);
  assert.match(observation('web_access_record').description, /timestampとrequest_target.*取得後にメールと要求記録/);
  assert.deepEqual(evidenceDraftProblems(validDraft, materializeEvidenceGenerationDraft(validDraft), agent), []);
});

test('プレーンテキスト・通常のラベル・同じ表示URLを認め、保存リンクの欠落や別攻撃での代用を拒否する', () => {
  const original = structuredClone(validDraft.evidenceArtifacts);
  validatePhishingObservations(original, agent.attackGraph);
  for (const content of ['確認先 https://portal.example.invalid/help',
    '<a href="https://portal.example.invalid/help">確認する</a>',
    '<a href="https://portal.example.invalid/help">https://portal.example.invalid/help</a>']) {
    const items = structuredClone(original);
    items.find(item => item.type === 'EMAIL').publicContent = content;
    items.find(item => item.type === 'WEB_ACCESS_LOG').publicContent = '{"timestamp":"2026-09-18T09:10:00+09:00","request_target":"/another"}';
    assert.doesNotThrow(() => validatePhishingObservations(items, agent.attackGraph));
  }
  for (const change of [
    items => { items.find(item => item.type === 'EMAIL').publicContent = '誘導リンクを含む保存メール。'; },
    items => { items.find(item => item.type === 'EMAIL').sourceRefs.forEach(ref => { ref.attackNodeId = 'another_attack'; }); },
  ]) {
    const bad = structuredClone(original); change(bad);
    assert.throws(() => validatePhishingObservations(bad, agent.attackGraph), { code: 'EVIDENCE_PHISHING_LINK_MISSING' });
  }
  assert.deepEqual(validDraft.evidenceArtifacts, original);
});

test('非実行HTMLの文字参照を文字列として読み、観測内容を変更しない', () => {
  const items = structuredClone(validDraft.evidenceArtifacts);
  items.find(item => item.type === 'EMAIL').publicContent = '<a href="https://portal.example.invalid/notice?ref=mail&amp;part=1#section">https://portal.example.invalid/help</a>';
  items.find(item => item.type === 'WEB_ACCESS_LOG').publicContent = '{"timestamp":"2026-09-18T09:10:00+09:00","request_target":"/notice?ref=mail&part=1"}';
  const before = structuredClone(items);
  assert.deepEqual(phishingMailLinks(items.find(item => item.type === 'EMAIL').publicContent), [{
    href: 'https://portal.example.invalid/notice?ref=mail&part=1#section', display: 'https://portal.example.invalid/help',
  }]);
  validatePhishingObservations(items, agent.attackGraph);
  assert.deepEqual(items, before);
});

test('ログ項目の欠落と全4択の不正な引用を最初の検査でまとめて返す', () => {
  const draft = reportedDefects(structuredClone(validDraft)); const before = structuredClone(draft);
  const issues = evidenceDraftProblems(draft, materializeEvidenceGenerationDraft(draft), agent);
  const missing = issues.find(item => item.code === 'EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE');
  assert.ok(missing); assert.match(missing.correctionHint, /timestampとrequest_target/);
  const quotes = issues.filter(item => item.code === 'EVIDENCE_QUESTION_QUOTE_MISMATCH');
  assert.equal(quotes.length, draft.courtQuestions.length);
  assert.ok(quotes.every(item => /公開原文を正確に引用/.test(item.correctionHint)));
  assert.deepEqual(draft, before);
});

for (const repair of [true, false]) test(`同じ試行でログと全引用の修正を要求し、${repair ? '2回以内で生成と無罪まで進む' : '未修正なら上限で停止する'}`, async () => {
  class RepairRunner extends MockCodexRunner {
    async runJson(args) {
      const draft = await super.runJson(args);
      if (args.phase !== 'GENERATING_EVIDENCE') return draft;
      if (this.evidenceCalls === 2) {
        assert.deepEqual(args.data.evidenceRepairBase, this.firstDraft);
        assert.ok(args.feedback.errors.some(item => item.code === 'EVIDENCE_LEARNING_OBSERVATION_INCOMPLETE'));
        assert.equal(args.feedback.errors.filter(item => item.code === 'EVIDENCE_QUESTION_QUOTE_MISMATCH').length,
          this.firstDraft.courtQuestions.length);
      }
      if (this.evidenceCalls === 1 || !repair) reportedDefects(draft);
      if (this.evidenceCalls === 1) this.firstDraft = structuredClone(draft);
      return draft;
    }
  }
  const runner = new RepairRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
  const session = createAutoAuthorSession(); manager.submitSelection(session, request); await manager.waitForIdle();
  manager.approve(session); await manager.waitForIdle();
  assert.equal(session.auto.state, repair ? 'READY' : 'FAILED', JSON.stringify(autoAuthorView(session).developerDetails));
  assert.equal(runner.evidenceCalls, 2);
  if (!repair) { assert.equal(session.runtime, null); return; }
  const game = createGeneratedGame(session.runtime);
  actGenerated(game, session.runtime, { action: 'begin' }); actGenerated(game, session.runtime, { action: 'continue' });
  for (let round = 1; round <= session.runtime.gameCase.progression.courtRoundCount; round++) {
    collectCurrentTarget(game, session.runtime); enterCurrentCourt(game, session.runtime);
    actGenerated(game, session.runtime, { action: 'objection', ...currentCorrectPair(session.runtime, round) });
  }
  assert.equal(game.currentState, 'ACQUITTED');
});

for (const attackIds of [['phishing'], ['stored_xss'], ['phishing', 'stored_xss'],
  ['phishing', 'unauthorized_login', 'stored_xss']]) {
  test(`${attackIds.join('+')}: 周辺Web記録を維持し、URL不一致や固定の操作回数に依存せずクリアできる`, async () => {
    class MinimalRunner extends MockCodexRunner {
      async runJson(args) {
        const draft = await super.runJson(args);
        if (args.phase !== 'GENERATING_EVIDENCE') return draft;
        for (const artifact of draft.evidenceArtifacts) {
          if (artifact.type === 'EMAIL') {
            const link = phishingMailLinks(artifact.publicContent)[0].href;
            artifact.publicContent = `Subject: 確認のお願い\n\n次のリンクを開いて確認してください。\n${link}`;
            // This fixture changes the player-visible source format before validation.
          }
        }
        syncQuestionQuotes(draft);
        const email = draft.evidenceArtifacts.find(item => item.type === 'EMAIL');
        if (email) {
          const question = draft.courtQuestions.find(item => item.supportingQuotes.length === 1
            && item.supportingQuotes[0].evidenceId === email.evidenceId);
          question.prompt = '保存メールの案内を読み、その記録だけでどの段階まで確認できるか選んでください。リンクはアクセスを促す案内です。';
          question.choices = ['リンクへの誘導は確認できるが、実際のアクセスの有無はこの保存メールからは分からない。',
            'リンクが記載されているので、実際のアクセスが完了した。',
            'メール本文に誘導先は記載されていない。', 'リンクがあるので、入力画面への送信と認証成功が確認できる。'];
          question.correctOptionIndex = 0;
          question.explanation = '本文には確認を促す案内とリンクが残っています。保存内容はアクセスした結果を記録したものではありません。';
        }
        // Authored walkthroughs may have one step; actual play opens full sources.
        draft.materialInvestigations = draft.evidenceArtifacts.filter(item => item.type !== 'TESTIMONY').map(item => ({
          schemaVersion: '1.0', evidenceId: item.evidenceId, steps: [{
            prompt: 'この資料が記録している内容を確認するには、どの操作を使いますか。',
            choices: [
              { description: '資料の内容を表示して項目と値を確認する', operation: {
                kind: 'LINES', firstLine: 1, lastLine: item.publicContent.split('\n').length, needle: '',
              } },
              { description: '資料の改行数だけを数える', operation: { kind: 'COUNT', firstLine: 1, lastLine: 1, needle: '' } },
            ], correctOptionIndex: 0,
            explanation: '内容の確認には原文を表示します。改行の数だけでは、記録された対象や結果は分かりません。',
          }],
        }));
        return draft;
      }
    }
    const runner = new MinimalRunner(); const manager = new AutoGenerationManager({ jsonRunner: runner });
    const session = createAutoAuthorSession(); manager.submitSelection(session, { ...request, attackIds });
    const original = structuredClone(session.configuration);
    await manager.waitForIdle(); manager.approve(session); await manager.waitForIdle();
    assert.equal(session.auto.state, 'READY', JSON.stringify(autoAuthorView(session).developerDetails));
    assert.equal(runner.evidenceCalls, 1);
    assert.deepEqual(session.configuration, original);
    assert.ok(session.runtime.gameCase.progression.materialInvestigations.every(item => item.steps.length === 1));
    const game = createGeneratedGame(session.runtime);
    actGenerated(game, session.runtime, { action: 'begin' }); actGenerated(game, session.runtime, { action: 'continue' });
    for (let round = 1; round <= session.runtime.gameCase.progression.courtRoundCount; round++) {
      collectCurrentTarget(game, session.runtime); enterCurrentCourt(game, session.runtime);
      actGenerated(game, session.runtime, { action: 'objection', ...currentCorrectPair(session.runtime, round) });
    }
    assert.equal(game.currentState, 'ACQUITTED');
  });
}
