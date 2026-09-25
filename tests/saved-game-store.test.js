import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SavedGameStore } from '../server/saved-game-store.js';
import { readyGameCaseFixture } from './helpers/ready-game-case.js';

const metadata = {
  title: '青葉ソリューションズ — 社内ポータル',
  summary: '保存と再起動後の読み込みを確認する合成事件です。',
  targetSystem: '社内ポータル',
  difficulty: 2,
  attacks: ['フィッシング', '反射型XSS'],
};

test('完成したゲームを専用フォルダへ保存し、別Storeから再読込・削除できる', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'incident-craft-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const gameCaseResult = readyGameCaseFixture().gameCaseResult;
  const first = new SavedGameStore(directory);
  const saved = await first.save(gameCaseResult, metadata);

  const restarted = new SavedGameStore(directory);
  assert.deepEqual(await restarted.list(), [saved]);
  const loaded = await restarted.load(saved.gameId);
  assert.equal(loaded.runtime.mode, 'GENERATED');
  assert.equal(loaded.runtime.gameCase.gameCaseId, gameCaseResult.gameCase.gameCaseId);
  assert.equal(saved.cleared, false);
  await assert.rejects(() => restarted.study(saved.gameId), { code: 'GAME_NOT_CLEARED' });
  await restarted.markCleared(saved.gameId);
  const persisted = new SavedGameStore(directory);
  assert.equal((await persisted.list())[0].cleared, true);
  const firstClear = (await persisted.list())[0].clearedAt;
  await persisted.markCleared(saved.gameId);
  assert.equal((await persisted.list())[0].clearedAt, firstClear);
  assert.ok((await persisted.study(saved.gameId)).materials.length > 0);

  await restarted.delete(saved.gameId);
  assert.deepEqual(await restarted.list(), []);
  await assert.rejects(() => restarted.load(saved.gameId), { code: 'SAVED_GAME_NOT_FOUND' });
  await assert.rejects(() => restarted.load('../outside'), { code: 'INVALID_SAVED_GAME_ID' });
});
