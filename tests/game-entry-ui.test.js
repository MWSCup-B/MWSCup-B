import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Element } from './helpers/author-dom.js';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import[^\n]+\n/gm, '');
function start(search, fetch) {
  const screen = new Element('section'); screen.style = {};
  const error = new Element('p');
  const document = { querySelector: selector => selector === '#screen' ? screen : error,
    createElement: tag => new Element(tag), body: { classList: { add() {}, remove() {} } } };
  const context = { document, fetch, location: { search }, URLSearchParams,
    gameAudio: { mount() {}, forGame() {}, attach() {}, effect() {} } };
  runInNewContext(source, context);
  return { screen, error };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

// 2026-09-24: 生成直後と保存一覧の両方のURLを同じ開始・再試行経路で確認。
for (const [search, body] of [['?game=abc', { playId: 'abc' }], ['?saved=saved_abc', { gameId: 'saved_abc' }]]) {
test(`a completed game link ${search} starts loading exactly once without an intermediate game-start page`, async () => {
  const calls = [];
  const page = start(search, async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) });
    return new Promise(() => {});
  });
  await settle();
  assert.deepEqual(calls, [{ path: '/api/start', body }]);
  assert.match(page.screen.textContent, /事件ファイルを開いています/);
  assert.doesNotMatch(page.screen.textContent, /インシデント調査ゲーム|ゲーム開始/);
  assert.equal(page.screen.querySelectorAll('button').length, 0);
});

test(`a failed direct entry ${search} displays its error and allows an explicit retry`, async () => {
  let count = 0;
  const page = start(search, async (_path, options) => {
    assert.deepEqual(JSON.parse(options.body), body);
    count += 1;
    return { ok: false, json: async () => ({ error: { message: '公開ゲームが見つかりません。' } }) };
  });
  await settle();
  assert.equal(count, 1);
  assert.match(page.error.textContent, /公開ゲームが見つかりません/);
  assert.match(page.screen.textContent, /もう一度開く/);
  await page.screen.querySelector('button').dispatch('click');
  assert.equal(count, 2);
});
}

test('legacy entry without a generated game link still waits for its start action', async () => {
  let count = 0;
  const page = start('', async () => { count += 1; return new Promise(() => {}); });
  await settle();
  assert.equal(count, 0);
  assert.match(page.screen.textContent, /ゲーム開始/);
});
