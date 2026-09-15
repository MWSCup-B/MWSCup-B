import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, playerView } from '../server/game.js';

test('取得した資料Aを提示して結果に到達する', () => {
  const game = createGame();
  assert.equal(playerView(game).phase, 'detective');
  assert.deepEqual(playerView(game).inventory, []);
  act(game, 'collect', 'document-a');
  act(game, 'collect', 'document-a');
  assert.equal(game.inventory.length, 1);
  assert.equal(act(game, 'courtroom').testimony.kind, '証言者の主張');
  assert.deepEqual(act(game, 'present', 'document-a').result, { success: true });
  assert.equal(game.phase, 'result');
});

test('資料Bの提示では不成立の結果になる', () => {
  const game = createGame();
  act(game, 'collect', 'document-b');
  act(game, 'courtroom');
  assert.deepEqual(act(game, 'present', 'document-b').result, { success: false });
});

test('未取得の証拠、未知の入力、不正な順序を拒否し進行を維持する', () => {
  const game = createGame();
  assert.throws(() => act(game, 'courtroom'), { code: 'EVIDENCE_REQUIRED' });
  assert.throws(() => act(game, 'present', 'document-a'), { code: 'INVALID_PHASE' });
  assert.throws(() => act(game, 'collect', '../server/dummy-case.js'), { code: 'UNKNOWN_EVIDENCE' });
  assert.throws(() => act(game, 'collect', {}), { code: 'UNKNOWN_EVIDENCE' });
  assert.throws(() => act(game, 'unknown'), { code: 'UNKNOWN_ACTION' });
  act(game, 'collect', 'document-b');
  act(game, 'courtroom');
  assert.throws(() => act(game, 'present', 'document-a'), { code: 'EVIDENCE_NOT_OWNED' });
  assert.throws(() => act(game, 'collect', 'document-a'), { code: 'INVALID_PHASE' });
  assert.equal(game.phase, 'courtroom');
  act(game, 'present', 'document-b');
  assert.throws(() => act(game, 'present', 'document-b'), { code: 'INVALID_PHASE' });
});

test('公開状態に内部フィールドを混入させない', () => {
  const game = createGame();
  game.groundTruth = 'PRIVATE_SENTINEL';
  game.correctEvidenceId = 'PRIVATE_SENTINEL';
  assert.doesNotMatch(JSON.stringify(playerView(game)), /PRIVATE_SENTINEL|correctEvidenceId|groundTruth/);
});
