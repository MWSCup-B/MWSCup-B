import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Element } from './helpers/author-dom.js';
import { assetPath } from '../public/visual-assets.js';
import { AutoGenerationManager, autoAuthorBootstrap, createAutoAuthorSession } from '../server/auto-generation-service.js';
import { actGenerated, createGeneratedGame, generatedPlayerView } from '../server/generated-game.js';
import { MockCodexRunner } from './helpers/mock-codex.js';
import { procedureMethods } from '../server/generation/investigation-procedures.js';
import { currentCorrectPair } from './helpers/court-issues.js';

const source = await readFile(new URL('../public/generated-view.js', import.meta.url), 'utf8');
import { renderInvestigationWorkspace } from '../public/investigation-workspace.js';
function ui(initial, onAction) {
  const screen = new Element('section'); const calls = [];
  const document = { createElement: tag => new Element(tag), body: { classList: { add() {} } } };
  const render = runInNewContext(`${source.replace(/^import[^\n]+\n/gm, '').replaceAll('export function', 'function')}\nrenderGeneratedGame;`,
    { document, assetPath, renderInvestigationWorkspace, setTimeout() {} });
  let game = initial;
  const draw = () => render({ screen, game, action: (action, fields = {}) => {
    calls.push({ action, ...fields });
    if (onAction) { game = onAction(action, fields); draw(); }
  } });
  draw();
  return { screen, calls, change(value) { game = value; draw(); },
    click: async text => {
      const node = screen.querySelectorAll('button').find(item => item.textContent === text);
      assert.ok(node, text); await node.dispatch('click');
    } };
}
const base = { mode: 'GENERATED', gameCaseId: 'case_ui', currentRound: 1, totalRounds: 2,
  remainingAttempts: 3, title: '合成記録の審理', synopsis: '記録と主張を区別する教材。' };
const email = { evidenceId: 'mail', title: '保存メール', type: 'EMAIL',
  publicContent: '<a href="https://example.invalid/actual">https://example.invalid/display</a>' };

test('調査は全文を開いて複数候補へ絞り込み、資料を替えても検察側の主張は固定される', async () => {
  const records = ['09:00 /home', '09:01 /records request=a', '09:02 /records request=b',
    '09:03 /help', '09:04 /home', '09:05 <script>unsafe()</script>'];
  const log = { evidenceId: 'log', title: 'Web記録', type: 'WEB_ACCESS_LOG', publicContent: records.join('\n') };
  const game = { ...base, currentState: 'INVESTIGATION', investigationMode: 'OPEN_MATERIALS',
    investigationClaim: { spokenContent: '対象の要求は一度しかありません。' },
    collectedEvidence: [log, email], workbench: { materials: [log, email].map(item => ({
      materialId: item.evidenceId, label: item.title, collected: true,
      step: { prompt: '表示してはいけない解法' }, methods: [{ description: 'これが正解' }],
    })) } };
  const page = ui(game);
  assert.doesNotMatch(page.screen.textContent, /表示してはいけない|これが正解/);
  assert.match(page.screen.querySelector('.case-filtered-source').textContent, /09:00[\s\S]*09:05/);
  const input = page.screen.querySelector('input'); input.value = '/records'; await input.dispatch('input');
  assert.match(page.screen.textContent, /2 \/ 6 行/);
  assert.equal(page.screen.querySelector('.case-filtered-source').textContent, '2  ' + records[1] + '\n3  ' + records[2]);
  await page.click('全文に戻す');
  assert.match(page.screen.querySelector('.case-filtered-source').textContent, /<script>unsafe/);
  assert.equal(page.screen.querySelector('script'), null);
  await page.screen.querySelector('[data-material-id="mail"]').dispatch('click');
  assert.match(page.screen.querySelector('.case-reference').textContent, /対象の要求は一度しかありません/);
  assert.equal(page.calls.length, 0);
});

test('the case file omits the incident-summary item and keeps entry to the report', async () => {
  const page = ui({ ...base, currentState: 'TITLE' });
  assert.doesNotMatch(page.screen.textContent, /事件のあらまし/);
  assert.ok(!page.screen.textContent.includes(base.synopsis));
  await page.click('事件ファイルを開く');
  assert.deepEqual(page.calls, [{ action: 'begin' }]);
});

test('the assistant portrait remains without exposing a pre-question reading guide', () => {
  const description = '保存IDと内容検査を照合しましょう。<script>not executed</script>';
  const page = ui({ ...base, currentState: 'INVESTIGATION', investigationMode: 'SEQUENTIAL_TARGETS',
    investigationTargets: [{ displayName: '保存ファイル検査', description }],
    currentEvidenceIds: ['mail'], collectedEvidence: [email], discoveredEvidence: [email] });
  assert.ok(page.screen.querySelector('.case-assistant-guide'));
  assert.equal(page.screen.querySelector('.case-assistant-guide').textContent.includes(description), false);
  assert.equal(page.screen.querySelectorAll('script').length, 0);
});

test('court pages retain all untrusted source text, selection and presentation without grading page turns', async () => {
  const content = '<script>not executed</script>\r\n' + '日本語の長い記録😀\t'.repeat(80) + '\n'.repeat(14) + '末尾';
  const records = Array.from({ length: 7 }, (_, index) => ({ ...email, evidenceId: `mail_${index}`, title: `資料${index}`, publicContent: content }));
  const page = ui({ ...base, currentState: 'RETRIAL_COURT', presentableEvidence: records,
    pendingInterpretation: { statementId: 'claim', choiceId: 'hypothesis', text: '操作した人物は確定できない。' } });
  await page.screen.querySelector('[data-evidence-id="mail_0"]').dispatch('click');
  let restored = '';
  for (let guard = 0; guard < 100; guard += 1) {
    restored += page.screen.querySelector('.case-court-source').textContent;
    const next = page.screen.querySelectorAll('button').find(node => node.textContent === '次のページ');
    if (next.disabled) break;
    await next.dispatch('click');
  }
  assert.equal(restored, content);
  assert.equal(page.calls.length, 0);
  assert.equal(page.screen.querySelectorAll('script').length, 0);
  await page.click('次の資料一覧');
  assert.equal(page.screen.querySelectorAll('.case-file').length, 3);
  await page.screen.querySelector('[data-evidence-id="mail_6"]').dispatch('click');
  assert.ok(content.startsWith(page.screen.querySelector('.case-court-source').textContent));
  await page.click('この証拠を提示する');
  assert.deepEqual(page.calls, [{ action: 'objection', statementId: 'claim', interpretationChoiceId: 'hypothesis', evidenceId: 'mail_6' }]);
});

test('quoted testimony is a separate reference while preserving its attribution', () => {
  const page = ui({ ...base, currentState: 'RETRIAL_COURT',
    dialogue: [{ role: 'prosecutor', speaker: '検察官', badge: '証言の引用 · 発言者の主張',
      text: '記録担当者は、こう述べています。\n「本人が操作しました。」' }] });
  assert.match(page.screen.querySelector('.case-reference').textContent, /記録担当者.*こう述べています/s);
  assert.equal(page.screen.querySelector('.case-dialogue'), null);
});

test('investigation switches one evidence viewer while keeping its four choices directly below and ungraded', async () => {
  const web = { evidenceId: 'web', title: 'アクセス記録', type: 'WEB_ACCESS_LOG',
    publicContent: '{"request_target":"/notice","timestamp":"2026-09-18T09:10:00+09:00"}' };
  const auth = { evidenceId: 'auth', title: '認証記録', type: 'AUTHENTICATION_LOG',
    publicContent: '{"account":"<script>not executed</script>","result":"success"}' };
  const choices = ['記録の対象を確認する。', '同じ人物だと断定する。', 'すべて成功したと考える。', '被告人は無関係だと断定する。']
    .map((text, index) => ({ choiceId: `hypothesis_${index}`, text }));
  const game = { ...base, investigationMode: 'SEQUENTIAL_TARGETS', currentState: 'INVESTIGATION',
    investigationTargets: [{ displayName: '今回の記録保管先' }], currentEvidenceIds: ['web', 'auth'],
    discoveredEvidence: [email, web, auth], collectedEvidence: [email, web, auth], canReturnToCourt: true,
    courtQuestion: { prompt: 'この記録から何が言える？', choices } };
  const page = ui(game);
  assert.equal(page.screen.querySelectorAll('.case-document').length, 1);
  assert.match(page.screen.querySelector('.case-document').textContent, /request_target.*timestamp.*\/notice.*2026-09-18T09:10:00\+09:00/s);
  assert.equal(page.screen.querySelectorAll('.case-evidence-card').length, 3);
  const reading = page.screen.querySelector('.case-evidence-reading');
  assert.equal(reading.children[0].className, 'case-active-evidence');
  assert.equal(reading.children[1].className, 'case-evidence-reasoning');
  assert.equal(reading.children[1].querySelectorAll('.case-interpretation').length, 4);
  await page.screen.querySelector('[data-choice-id="hypothesis_0"]').dispatch('click');
  for (const item of [auth, email, web]) {
    await page.screen.querySelector(`[data-viewer-evidence-id="${item.evidenceId}"]`).dispatch('click');
    assert.equal(page.screen.querySelectorAll('.case-document').length, 1);
    assert.ok(page.screen.querySelector('.case-document').textContent.includes(
      item === email ? email.publicContent : item === auth ? '<script>not executed</script>' : '/notice'));
    assert.doesNotMatch(page.screen.textContent, /原文を開く/);
    assert.equal(page.screen.querySelector('[data-choice-id="hypothesis_0"]').getAttribute('aria-pressed'), 'true');
    assert.equal(page.screen.querySelector(`[data-viewer-evidence-id="${item.evidenceId}"]`).focused, true);
    assert.equal(page.screen.querySelectorAll('script').length, 0);
    assert.equal(page.calls.length, 0, '閲覧や推理選択ではサーバー判定しない');
  }
  await page.click('この推理で法廷へ');
  assert.deepEqual(page.calls, [{ action: 'retrial', interpretationChoiceId: 'hypothesis_0' }]);
  page.change({ ...game, currentRound: 2, currentEvidenceIds: ['auth'] });
  assert.match(page.screen.querySelector('.case-document').textContent, /account.*result.*<script>not executed<\/script>.*success/s);
  assert.equal(page.screen.querySelector('[data-choice-id="hypothesis_0"]').getAttribute('aria-pressed'), 'false');
});

test('one investigation evidence needs no switcher and still puts inference below its original', () => {
  const page = ui({ ...base, investigationMode: 'SEQUENTIAL_TARGETS', currentState: 'INVESTIGATION',
    investigationTargets: [], currentEvidenceIds: ['mail'], discoveredEvidence: [email], collectedEvidence: [email],
    canReturnToCourt: true, courtQuestion: { prompt: 'どこまで言える？', choices: Array.from({ length: 4 }, (_, n) => ({ choiceId: `c${n}`, text: `仮説${n}` })) } });
  assert.equal(page.screen.querySelectorAll('.case-evidence-card').length, 0);
  assert.equal(page.screen.querySelector('pre').textContent, email.publicContent);
  assert.equal(page.screen.querySelectorAll('.case-interpretation').length, 4);
});

test('generated court uses original portraits, paged dialogue and explicit statement/evidence presentation', async () => {
  const page = ui({ ...base, currentState: 'RETRIAL_COURT', canInvestigate: true,
    testimonies: [{ speaker: { displayName: '架空の証言者' }, statements: [
      { statementId: 'claim', spokenContent: '表示と指定先は同じです。' },
      { statementId: 'observation', spokenContent: '記録を確認しました。' }] }], presentableEvidence: [email] });
  assert.match(page.screen.className, /case-court/);
  assert.equal(page.screen.querySelectorAll('img').length, 1);
  assert.match(page.screen.querySelector('.case-dialogue').textContent, /表示と指定先/);
  assert.doesNotMatch(page.screen.querySelector('.case-dialogue').textContent, /記録を確認/);
  await page.click('この証拠で主張を検証'); assert.equal(page.calls.length, 0);
  await page.click('次の証言');
  assert.match(page.screen.querySelector('.case-dialogue').textContent, /記録を確認/);
  await page.click('前の証言'); await page.click('この発言を指摘する');
  await page.click('この証拠で主張を検証');
  assert.deepEqual(page.calls, [{ action: 'objection', statementId: 'claim', evidenceId: 'mail' }]);
  await page.click('提示せず追加調査へ'); assert.equal(page.calls.at(-1).action, 'investigation');
  assert.equal(page.screen.querySelectorAll('a').length, 1);
  assert.equal(page.screen.querySelector('pre').textContent, email.publicContent);
});

test('investigation exposes targets, methods, discovery, registration, inventory and court navigation', async () => {
  const game = { ...base, currentState: 'INVESTIGATION', investigationTargets: [
    { targetId: 'mail_server', displayName: 'メールサーバー', targetType: 'SERVER', description: '合成メールの保管先',
      availableActions: [{ actionId: 'read_mail', displayName: 'メールを調査', completed: false }] }],
  discoveredEvidence: [{ ...email, discoveryState: 'DISCOVERED' }], collectedEvidence: [], canReturnToCourt: false };
  const page = ui(game); assert.match(page.screen.className, /case-investigation/);
  await page.click('メールを調査');
  assert.deepEqual(page.calls[0], { action: 'investigate', targetId: 'mail_server', investigationActionId: 'read_mail' });
  await page.click('この資料を証拠として登録'); assert.deepEqual(page.calls[1], { action: 'collect', evidenceId: 'mail' });
  await page.click('法廷へ移動'); assert.equal(page.calls.length, 2);
  page.change({ ...game, discoveredEvidence: [{ ...email, discoveryState: 'COLLECTED' }],
    collectedEvidence: [email], canReturnToCourt: true });
  await page.click('法廷へ移動'); assert.equal(page.calls[2].action, 'retrial');
});

test('court-to-investigation transition and unsuccessful presentation provide a visible return path', async () => {
  const page = ui({ ...base, currentState: 'TITLE' });
  page.change({ ...base, currentState: 'GUILTY_RETRY', publicFailureFeedback: '論証が成立していません。' });
  assert.ok(page.screen.querySelector('.case-transition'));
  assert.match(page.screen.textContent, /残り提示 3回/);
  await page.click('調査室へ戻って再検討'); assert.equal(page.calls[0].action, 'retry');
  page.change({ ...base, currentState: 'ACQUITTED', currentRound: 2,
    acquittal: { publicRuling: '無罪とします。', publicExplanation: '複数資料による限定的な結論です。' } });
  assert.match(page.screen.textContent, /すべての争点を解決/);
  assert.equal(page.screen.querySelectorAll('.is-solved').length, 2);
});

test('opening report shows overview, allegations and documents on one page before investigation', async () => {
  const page = ui({ ...base, currentState: 'INITIAL_COURT', initialCourt: {
    incidentOverview: '社内ポータルの利用を巡る架空の事件です。',
    prosecutionOpening: '検察側はメールを根拠に関与を主張しています。',
    presentedEvidence: [email], prosecutionStatements: [{ spokenContent: '表示と指定先は同じです。' }],
    publicRuling: 'ほかの記録を調べてください。',
  } });
  const report = page.screen.querySelector('.case-incident-report');
  assert.match(report.textContent, /社内ポータル/);
  assert.match(report.textContent, /検察側はメールを根拠/);
  assert.match(report.textContent, /表示と指定先は同じ/);
  assert.equal(page.screen.querySelectorAll('button').some(item => item.textContent === '次の発言'), false);
  assert.equal(page.screen.querySelector('pre').textContent, email.publicContent);
  assert.equal(page.screen.querySelectorAll('a').length, 1);
  assert.equal(page.calls.length, 0);
  await page.click('報告書を読んで調査へ'); assert.deepEqual(page.calls, [{ action: 'continue' }]);
});

test('court requires an explicit interpretation and evidence choice, and resets them between issues', async () => {
  const choices = ['表示文字と指定先が異なる。', '指定先は同じである。', '人物まで確定できる。', 'クリックを証明できる。']
    .map((text, index) => ({ choiceId: `choice_${index}`, text }));
  const game = { ...base, answerMode: 'INTERPRETATION_AND_EVIDENCE', currentState: 'RETRIAL_COURT',
    canInvestigate: true, courtQuestion: { statementId: 'claim', prompt: 'メールから何が言えますか。', choices },
    testimonies: [{ statements: [{ statementId: 'claim', spokenContent: '表示と指定先は同じです。' }] }],
    presentableEvidence: [email] };
  const page = ui(game);
  assert.equal(page.screen.querySelectorAll('.case-interpretation').length, 4);
  assert.equal(page.screen.querySelector('.case-next-step'), null);
  assert.equal(page.screen.querySelector('pre').textContent, email.publicContent);
  assert.equal(page.screen.querySelectorAll('.case-file').length, 0);
  await page.click('解釈と証拠を提示'); assert.equal(page.calls.length, 0);
  await page.click('A. 表示文字と指定先が異なる。');
  assert.equal(page.screen.querySelector('.case-next-step'), null);
  assert.equal(page.screen.querySelectorAll('.case-file').length, 1);
  await page.click('解釈と証拠を提示'); assert.equal(page.calls.length, 0);
  await page.click('メール · 保存メール');
  await page.click('B. 指定先は同じである。');
  await page.click('解釈と証拠を提示'); assert.equal(page.calls.length, 0);
  await page.click('メール · 保存メール'); await page.click('解釈と証拠を提示');
  assert.deepEqual(page.calls, [{ action: 'objection', statementId: 'claim',
    interpretationChoiceId: 'choice_1', evidenceId: 'mail' }]);
  page.change({ ...game, currentRound: 2,
    courtQuestion: { ...game.courtQuestion, statementId: 'next_claim' } });
  await page.click('解釈と証拠を提示'); assert.equal(page.calls.length, 1);
  assert.equal(page.screen.querySelectorAll('.case-file').length, 0);
  await page.click('提示せず追加調査へ'); assert.equal(page.calls.at(-1).action, 'investigation');
});

test('investigation shows target icons, explains methods, blocks waiting actions and selects newly found documents', async () => {
  const game = { ...base, currentState: 'INVESTIGATION', investigationTargets: [
    { targetId: 'mailbox', targetType: 'MAILBOX', displayName: 'メール保管庫', description: '保存メールの保管先',
      availableActions: [{ actionId: 'mail', displayName: 'メールを調査', status: 'COMPLETE', description: '本文とヘッダーを確認します。' }] },
    { targetId: 'logs', targetType: 'LOG_SOURCE', displayName: 'アクセス記録', description: '記録の保管先',
      availableActions: [{ actionId: 'log', displayName: '記録を調査', status: 'WAITING', description: '対象と時刻を読み比べます。' }] }],
  discoveredEvidence: [{ ...email, discoveryState: 'DISCOVERED' }], collectedEvidence: [], canReturnToCourt: false };
  const page = ui(game);
  assert.ok(page.screen.querySelector('.icon-mail')); assert.ok(page.screen.querySelector('.icon-log'));
  assert.equal(page.screen.querySelector('.case-next-step'), null);
  assert.match(page.screen.querySelector('.case-method-card').textContent, /本文とヘッダー/);
  await page.screen.querySelector('[data-target-id="logs"]').dispatch('click');
  assert.match(page.screen.querySelector('.case-method-card').textContent, /先にほかの資料を/);
  await page.click('記録を調査'); assert.equal(page.calls.length, 0);
  const log = { evidenceId: 'access', type: 'WEB_ACCESS_LOG', title: 'アクセス資料',
    publicContent: '合成アクセス記録：対象と時刻', discoveryState: 'DISCOVERED' };
  page.change({ ...game, discoveredEvidence: [...game.discoveredEvidence, log],
    lastInvestigationResult: { discoveredEvidenceIds: ['access'], publicMessage: '資料を発見しました。' } });
  assert.ok(page.screen.querySelector('tbody').textContent.includes(log.publicContent));
  await page.click('この資料を証拠として登録');
  assert.deepEqual(page.calls, [{ action: 'collect', evidenceId: 'access' }]);
});

test('generated renderer remains text-only for evidence and offers responsive reduced-motion styles', async () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|eval\(/);
  const css = await readFile(new URL('../public/generated-game.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /max-width: 720px/);
  assert.match(css, /backgrounds\/courtroom-v2.png/); assert.match(css, /backgrounds\/investigation-v2.png/);
  assert.match(css, /case-cinematic/); assert.match(css, /case-evidence-workbench/);
});

test('each speaker cut shows exactly one portrait and always identifies the defense as the player', async () => {
  const page = ui({ ...base, investigationMode: 'SEQUENTIAL_TARGETS', currentState: 'RETRIAL_COURT',
    pendingInterpretation: { statementId: 'claim', choiceId: 'choice', text: '記録だけでは人物は分からない。' },
    presentableEvidence: [email], participants: [{ publicRole: 'DEFENDANT', displayName: '被告人' }],
    dialogue: [{ role: 'prosecutor', speaker: '検察官', text: 'その根拠を示してください。' },
      { role: 'defense', speaker: '弁護士（あなた）', text: 'こちらの記録を確認してください。' }] });
  assert.equal(page.screen.querySelectorAll('img').length, 1);
  assert.equal(page.screen.querySelector('img').src, assetPath('prosecutor_penguin_v1'));
  assert.ok(page.screen.querySelector('.case-cinematic'));
  assert.match(page.screen.querySelector('.case-player-role').textContent, /主人公.*あなた/);
  await page.click('次の台詞');
  assert.equal(page.screen.querySelectorAll('img').length, 1);
  assert.equal(page.screen.querySelector('img').src, assetPath('defense_penguin_v1'));
  assert.equal(page.screen.querySelector('.case-stage').dataset.speakerRole, 'defense');
  await page.click('証拠を選ぶ');
  assert.equal(page.screen.querySelectorAll('img').length, 1);
  assert.match(page.screen.querySelector('.case-dialogue').textContent, /弁護士（あなた）/);
});

test('judgment states expose a creation link even before the result dialogue is finished', () => {
  for (const currentState of ['ACQUITTED', 'BLOCKED', 'GUILTY_RETRY', 'INVESTIGATION']) {
    const page = ui({ ...base, currentState, result: { outcome: currentState === 'ACQUITTED' ? 'SUCCESS' : 'FAILURE' },
      dialogue: [{ role: 'defense', speaker: '弁護士（あなた）', text: '記録を確かめよう。' }],
      investigationTargets: [], discoveredEvidence: [], collectedEvidence: [],
      acquittal: { publicRuling: '被告人を無罪とします。' } });
    const link = page.screen.querySelector('.case-return-link');
    assert.equal(link.href, '/author#mode'); assert.equal(link.textContent, 'ゲーム制作へ戻る');
    assert.equal(page.calls.length, 0, '画面表示だけで審理をリセットしない');
  }
  assert.ok(ui({ ...base, currentState: 'TITLE' }).screen.querySelector('.case-return-link'));
});

test('mail viewer formats recorded headers without inventing fields or interpreting untrusted HTML', () => {
  const original = '教材用合成メール\r\nFrom: notice@example.invalid\r\nSubject: お知らせ\r\n\r\nDate: これは本文\r\n<script>throw 1</script>\r\n<a href="javascript:alert(1)">案内</a>';
  const page = ui({ ...base, currentState: 'INITIAL_COURT', initialCourt: {
    presentedEvidence: [{ ...email, publicContent: original }], prosecutionStatements: [], publicRuling: '調べてください。' } });
  assert.ok(page.screen.querySelector('.case-mail-viewer'));
  const headers = page.screen.querySelector('.case-mail-fields');
  assert.match(headers.textContent, /差出人notice@example.invalid件名お知らせ/);
  assert.doesNotMatch(headers.textContent, /日時|宛先/);
  assert.match(page.screen.querySelector('.case-mail-body').textContent, /Date: これは本文/);
  assert.equal(page.screen.querySelector('.case-mail-text').textContent,
    '教材用合成メール\n\nDate: これは本文\n<script>throw 1</script>\n<a href="javascript:alert(1)">案内</a>');
  assert.equal(page.screen.querySelector('.case-original-source'), null);
  assert.equal(page.screen.querySelectorAll('script').length, 0);
  assert.equal(page.screen.querySelectorAll('a').length, 1);
});

test('all log and document types display every source line directly on a read-only surface', () => {
  for (const type of ['WEB_ACCESS_LOG', 'NETWORK_LOG', 'APPLICATION_LOG', 'AUTHENTICATION_LOG',
    'DATABASE_LOG', 'DEVICE_INFORMATION', 'TESTIMONY', 'OTHER']) {
    const original = '教材用合成資料\n対象: <img src=x onerror=alert(1)>\n時刻: 未記録\n\t範囲: 本文のまま\n';
    const page = ui({ ...base, currentState: 'INITIAL_COURT', initialCourt: {
      presentedEvidence: [{ ...email, type, publicContent: original }], prosecutionStatements: [], publicRuling: '調べてください。' } });
    const displayed = type.endsWith('_LOG')
      ? page.screen.querySelector('tbody').children.map(row => row.children[1].textContent).join('\n') + '\n'
      : page.screen.querySelector('pre').textContent;
    assert.equal(displayed, original, type);
    assert.doesNotMatch(page.screen.textContent, /原文を開く/);
    assert.match(page.screen.querySelector('.case-document-toolbar').textContent, /読み取り専用/);
    assert.equal(page.screen.querySelectorAll('img').length, 0);
    assert.equal(page.screen.querySelectorAll('a').length, 1);
    assert.ok(page.screen.querySelector(type.endsWith('_LOG') ? '.case-log-table' : '.case-record-sheet'), type);
  }
});

test('long logs display all records directly without a secondary original-source action', () => {
  const original = Array.from({ length: 205 }, (_, index) => `record ${index}`).join('\n');
  const page = ui({ ...base, currentState: 'INITIAL_COURT', initialCourt: {
    presentedEvidence: [{ ...email, type: 'NETWORK_LOG', publicContent: original }], prosecutionStatements: [], publicRuling: '調べてください。' } });
  const rows = page.screen.querySelector('tbody').children;
  assert.equal(rows.length, 205);
  assert.equal(rows.map(row => row.children[1].textContent).join('\n'), original);
  assert.doesNotMatch(page.screen.textContent, /原文を開く|先頭200行/);
});

test('structured log viewer uses only recorded fields, preserves missing values and never executes text', () => {
  const original = '{"account":"staff-a","result":"failure","source_ip":"192.0.2.10"}\n'
    + '{"account":"<script>throw 1</script>","result":"success"}\n';
  const page = ui({ ...base, currentState: 'INITIAL_COURT', initialCourt: {
    presentedEvidence: [{ ...email, type: 'AUTHENTICATION_LOG', publicContent: original }],
    prosecutionStatements: [], publicRuling: '記録を確かめよう。' } });
  assert.deepEqual(page.screen.querySelectorAll('th').map(item => item.textContent), ['行', 'account', 'result', 'source_ip']);
  const rows = page.screen.querySelector('tbody').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].children[3].textContent, '');
  assert.equal(rows[1].children[1].textContent, '"<script>throw 1</script>"');
  assert.equal(rows[1].children[2].textContent, '"success"');
  assert.equal(page.screen.querySelector('.case-original-source'), null);
  assert.equal(page.screen.querySelectorAll('script').length, 0);
  assert.doesNotMatch(page.screen.querySelector('thead').textContent, /timestamp|event_id|status/);
});

test('sequential investigation chooses a hypothesis before court and presents it through the script', async () => {
  const choices = ['表示と指定先は異なる。', '表示と指定先は同じ。', '操作者を特定できる。', '操作意図まで分かる。']
    .map((text, index) => ({ choiceId: `choice_${index}`, text }));
  const game = { ...base, investigationMode: 'SEQUENTIAL_TARGETS', currentState: 'INVESTIGATION',
    investigationTargets: [{ targetId: 'mailbox', targetType: 'MAILBOX', displayName: 'メール保管庫',
      availableActions: [{ actionId: 'mail', displayName: 'メールを調査', status: 'COMPLETE' }] }],
    discoveredEvidence: [{ ...email, discoveryState: 'COLLECTED' }], collectedEvidence: [email], canReturnToCourt: true,
    courtQuestion: { statementId: 'claim', prompt: 'このメールから分かることは？', choices },
    investigationClaim: { spokenContent: '表示と指定先は同じです。' } };
  const page = ui(game);
  assert.equal(page.screen.querySelectorAll('.case-target').length, 0);
  assert.equal(page.screen.querySelectorAll('.case-methods').length, 0);
  assert.ok(page.screen.querySelector('.case-reasoning-desk'));
  assert.doesNotMatch(page.screen.textContent, /1\. 今回の調査先|2\. 調査方法|証拠として登録/);
  assert.equal(page.screen.querySelectorAll('.case-interpretation').length, 4);
  await page.click('この推理で法廷へ'); assert.equal(page.calls.length, 0);
  await page.click('B. 表示と指定先は同じ。');
  await page.click('この推理で法廷へ');
  assert.deepEqual(page.calls, [{ action: 'retrial', interpretationChoiceId: 'choice_1' }]);
  page.change({ ...base, investigationMode: 'SEQUENTIAL_TARGETS', currentState: 'RETRIAL_COURT',
    pendingInterpretation: { statementId: 'claim', ...choices[1] }, presentableEvidence: [email],
    dialogue: [{ speaker: '証言者', role: 'witness', text: '表示と指定先は同じです。', badge: '証言者の主張' },
      { speaker: '弁護人', role: 'defense', text: choices[1].text, badge: 'あなたの推理 · まだ確認前' }] });
  assert.equal(page.screen.querySelectorAll('.case-interpretation').length, 0);
  assert.equal(page.screen.querySelectorAll('.case-file').length, 0);
  await page.click('次の台詞');
  assert.match(page.screen.querySelector('.case-reference').textContent, /弁護人.*表示と指定先は同じ/);
  assert.match(page.screen.querySelector('.case-reference').getAttribute('aria-label'), /まだ確認前/);
  assert.equal(page.screen.querySelector('.case-dialogue'), null, '推理の注記をキャラのセリフとして表示しない');
  await page.click('証拠を選ぶ');
  assert.equal(page.screen.querySelector('.case-reference').querySelector('.case-eyebrow'), null);
  assert.equal(page.screen.querySelector('.case-reference').querySelector('h2').textContent, '弁護士（あなた）');
  await page.click('この証拠を提示する'); assert.equal(page.calls.length, 1);
  await page.click('メール · 保存メール'); await page.click('この証拠を提示する');
  assert.deepEqual(page.calls.at(-1), { action: 'objection', statementId: 'claim', interpretationChoiceId: 'choice_1', evidenceId: 'mail' });
  page.change({ ...game, result: { outcome: 'FAILURE' }, remainingAttempts: 2 });
  await page.click('この推理で法廷へ'); assert.equal(page.calls.length, 2);
  assert.equal(page.screen.querySelectorAll('.case-target').length, 0);
  assert.equal(page.screen.querySelector('pre').textContent, email.publicContent);
});

test('generated script and UI play from the one-page report through a wrong answer, both targets and acquittal', async () => {
  const manager = new AutoGenerationManager({ jsonRunner: new MockCodexRunner() });
  const author = createAutoAuthorSession();
  manager.submitManual(author, autoAuthorBootstrap().defaultManualConfiguration);
  await manager.waitForIdle(); manager.approve(author); await manager.waitForIdle();
  assert.equal(author.auto.state, 'READY', JSON.stringify(author.auto.details));
  const { runtime } = author; const session = createGeneratedGame(runtime);
  const page = ui(generatedPlayerView(session, runtime), (action, fields) => actGenerated(session, runtime, { action, ...fields }));
  const clickThrough = async label => {
    for (let step = 0; step < 40; step += 1) {
      if (!page.screen.querySelectorAll('button').some(item => item.textContent === '次の台詞')) break;
      await page.click('次の台詞');
    }
    await page.click(label);
  };
  await page.click('事件ファイルを開く');
  assert.ok(page.screen.querySelector('.case-incident-report'));
  await page.click('報告書を読んで調査へ');
  for (let round = 1; round <= runtime.gameCase.progression.courtRoundCount; round += 1) {
    await clickThrough('調査を始める');
    assert.equal(page.screen.querySelectorAll('.case-target').length, 0);
    for (const plan of runtime.gameCase.progression.materialInvestigations) {
      if (session.collectedEvidenceIds.includes(plan.evidenceId)) continue;
      await page.screen.querySelector(`[data-material-id="${plan.evidenceId}"]`).dispatch('click');
      const input = page.screen.querySelector('.workspace-composer')?.querySelector('input');
      if (input) { input.value = 'cat material.txt'; await input.dispatch('input'); await page.click('実行'); }
      assert.ok(page.screen.querySelector('.workspace-console'));
      assert.ok(!session.collectedEvidenceIds.includes(plan.evidenceId));
      await page.click('原文の事実を証拠保存');
      await page.click('行1を証拠として保存');
      assert.ok(session.collectedEvidenceIds.includes(plan.evidenceId));
      await page.click('現場へ戻る');
    }
    const pair = currentCorrectPair(runtime, round);
    for (const wrong of round === 1 ? [true, false] : [false]) {
      await page.click('提出する証拠を決める');
      await page.screen.querySelector(`[data-material-id="${pair.evidenceId}"]`).dispatch('click');
      const question = generatedPlayerView(session, runtime).workbench.materials.find(item => item.materialId === pair.evidenceId).question;
      const choice = wrong ? question.choices.find(item => item.choiceId !== pair.interpretationChoiceId).choiceId : pair.interpretationChoiceId;
      await page.screen.querySelector(`[data-choice-id="${choice}"]`).dispatch('click');
      await page.click('この資料と主張で法廷へ');
      assert.equal(session.currentState, 'RETRIAL_COURT');
      await clickThrough('証拠を選ぶ');
      await page.screen.querySelector(`[data-evidence-id="${pair.evidenceId}"]`).dispatch('click');
      await page.click('この証拠を提示する');
      if (wrong) {
        assert.equal(session.currentState, 'INVESTIGATION'); assert.equal(session.currentRound, round);
        assert.match(page.screen.querySelector('.case-dialogue').textContent, /同じ調査先に戻って/);
        assert.equal(page.screen.className.includes('case-investigation'), false);
        await clickThrough('調査を始める');
        assert.equal(page.screen.className.includes('case-investigation'), true);
      }
    }
  }
  assert.equal(session.currentState, 'ACQUITTED');
  assert.ok(page.screen.querySelector('.case-cinematic'));
  await clickThrough('判決を確認する');
  assert.equal(page.screen.querySelector('.case-cinematic'), null);
  assert.match(page.screen.textContent, /被告人を無罪とします/);
  assert.equal(page.screen.querySelector('.case-study-reader'), null);
  await page.click('解説を開く');
  assert.ok(page.screen.querySelector('.case-study-reader'));
  await page.click('判決へ戻る');
  assert.equal(page.screen.querySelector('.case-study-reader'), null);
});

test('spoken lines contain only the speaker and line, without instructional badges', () => {
  for (const badge of ['あなたの視点', '会話', '根拠となる証拠を提示しよう', '提示の結果']) {
    const page = ui({ ...base, currentState: 'RETRIAL_COURT',
      dialogue: [{ role: 'defense', speaker: '弁護士', text: '記録を確かめましょう。', badge }] });
    const spoken = page.screen.querySelector('.case-dialogue');
    assert.equal(spoken.querySelector('.case-eyebrow'), null);
    assert.equal(spoken.querySelector('p').textContent, '記録を確かめましょう。');
  }
});

test('closing dialogue precedes the complete one-page verdict without consuming a presentation', async () => {
  const ruling = '被告人を無罪とします。';
  const last = '最後の資料で確認できたこと。';
  const explanation = '記録が示す範囲を区別しました。';
  const page = ui({ ...base, currentState: 'ACQUITTED',
    dialogue: [{ role: 'defense', speaker: '弁護士', text: last, badge: '確認できたこと' },
      { role: 'prosecutor', speaker: '検察官', text: '無罪との判断を受け入れます。' }],
    result: { outcome: 'SUCCESS', publicExplanation: last },
    acquittal: { publicRuling: ruling, publicExplanation: explanation } });
  assert.ok(page.screen.querySelector('.case-cinematic'));
  assert.match(page.screen.textContent, /最後の資料で確認できたこと/);
  assert.equal(page.screen.querySelector('.case-verdict-scene'), null);
  await page.click('次の台詞');
  assert.equal(page.screen.querySelector('.case-dialogue').querySelector('h2').textContent, '検察官');
  assert.match(page.screen.textContent, /無罪との判断を受け入れます/);
  await page.click('判決を確認する');
  assert.equal(page.screen.querySelector('.case-cinematic'), null);
  assert.deepEqual(page.screen.querySelector('.case-verdict-scene').querySelectorAll('p').map(p => p.textContent), [ruling, explanation]);
  assert.ok(page.screen.querySelector('.case-briefing').textContent.includes(last));
  assert.equal(page.screen.querySelector('.case-verdict-scene').querySelectorAll('button').length, 0);
  assert.equal(page.screen.querySelector('.case-verdict-scene').textContent.includes(last), false);
  assert.equal(page.calls.length, 0);
});

test('log display preserves large integers, duplicate keys, data types and fields beyond the twelfth column', () => {
  for (const original of ['{"id":9007199254740993,"result":"success"}', '{"result":"failure","result":"success"}']) {
    const page = ui({ ...base, currentState: 'INITIAL_COURT', initialCourt: {
      presentedEvidence: [{ ...email, type: 'APPLICATION_LOG', publicContent: original }], prosecutionStatements: [], publicRuling: '' } });
    assert.equal(page.screen.querySelector('tbody').children[0].children[1].textContent, original);
  }
  const record = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`field${i}`, i]));
  Object.assign(record, { empty: '', absent: null, text: 'null' });
  const page = ui({ ...base, currentState: 'INITIAL_COURT', initialCourt: {
    presentedEvidence: [{ ...email, type: 'APPLICATION_LOG', publicContent: JSON.stringify(record) }], prosecutionStatements: [], publicRuling: '' } });
  const columns = page.screen.querySelectorAll('th').map(node => node.textContent);
  const row = page.screen.querySelector('tbody').children[0];
  assert.equal(row.children[columns.indexOf('field13')].textContent, '13');
  assert.equal(row.children[columns.indexOf('empty')].textContent, '""');
  assert.equal(row.children[columns.indexOf('absent')].textContent, 'null');
  assert.equal(row.children[columns.indexOf('text')].textContent, '"null"');
});

test('every conversation cut retains one speaker name without a caption or supplemental title', async () => {
  const lines = [
    { role: 'prosecutor', speaker: '検察官', badge: '会話', text: '資料を確認しましょう。' },
    { role: 'prosecutor', speaker: '検察官', badge: '証言の引用 · 発言者の主張', text: '担当者は「本人の操作です」と述べました。' },
    { role: 'defense', speaker: '弁護士（あなた）', badge: 'あなたの推理 · まだ確認前', text: '記録だけでは人物を特定できません。' },
    { role: 'defense', speaker: '弁護士（あなた）', badge: '根拠となる証拠を提示しよう', text: '証拠を提示します。' },
  ];
  const page = ui({ ...base, currentState: 'RETRIAL_COURT', dialogue: lines });
  for (const [index, line] of lines.entries()) {
    const scene = page.screen.querySelector('.case-cinematic');
    assert.equal(scene.querySelectorAll('h2').length, 1);
    assert.equal(scene.querySelector('h2').textContent, line.speaker);
    assert.equal(scene.querySelector('p').textContent, line.text);
    assert.equal(scene.querySelectorAll('figcaption').length, 0);
    assert.equal(scene.querySelectorAll('.case-eyebrow').length, 0);
    assert.ok(!scene.textContent.includes(line.badge));
    if (index < lines.length - 1) await page.click('次の台詞');
  }
});
