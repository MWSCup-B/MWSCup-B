import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Element } from './helpers/author-dom.js';
import { assetPath } from '../public/visual-assets.js';

const source = await readFile(new URL('../public/generated-view.js', import.meta.url), 'utf8');
function ui(initial) {
  const screen = new Element('section'); const calls = [];
  const document = { createElement: tag => new Element(tag), body: { classList: { add() {} } } };
  const render = runInNewContext(`${source.replace(/^import[^\n]+\n/, '').replace('export function', 'function')}\nrenderGeneratedGame;`,
    { document, assetPath, setTimeout() {} });
  let game = initial;
  const draw = () => render({ screen, game, action: (action, fields = {}) => calls.push({ action, ...fields }) });
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

test('generated court uses original portraits, paged dialogue and explicit statement/evidence presentation', async () => {
  const page = ui({ ...base, currentState: 'RETRIAL_COURT', canInvestigate: true,
    testimonies: [{ speaker: { displayName: '架空の証言者' }, statements: [
      { statementId: 'claim', spokenContent: '表示と指定先は同じです。' },
      { statementId: 'observation', spokenContent: '記録を確認しました。' }] }], presentableEvidence: [email] });
  assert.match(page.screen.className, /case-court/);
  assert.equal(page.screen.querySelectorAll('img').length, 3);
  assert.match(page.screen.querySelector('.case-dialogue').textContent, /表示と指定先/);
  assert.doesNotMatch(page.screen.querySelector('.case-dialogue').textContent, /記録を確認/);
  await page.click('この証拠で主張を検証'); assert.equal(page.calls.length, 0);
  await page.click('次の証言');
  assert.match(page.screen.querySelector('.case-dialogue').textContent, /記録を確認/);
  await page.click('前の証言'); await page.click('この発言を指摘する');
  await page.click('この証拠で主張を検証');
  assert.deepEqual(page.calls, [{ action: 'objection', statementId: 'claim', evidenceId: 'mail' }]);
  await page.click('提示せず追加調査へ'); assert.equal(page.calls.at(-1).action, 'investigation');
  assert.equal(page.screen.querySelectorAll('a').length, 0);
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

test('generated renderer remains text-only for evidence and offers responsive reduced-motion styles', async () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|eval\(/);
  const css = await readFile(new URL('../public/generated-game.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /max-width: 720px/);
  assert.match(css, /backgrounds\/courtroom.svg/); assert.match(css, /backgrounds\/investigation.svg/);
});
