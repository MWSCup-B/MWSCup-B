import { dummyCase, groundTruth } from './dummy-case.js';

export class GameError extends Error {
  constructor(code, field, message, status = 400) {
    super(message);
    Object.assign(this, { code, field, status });
  }
}

export function createGame() {
  return { phase: 'detective', inventory: [], result: null };
}

// 公開フィールドを明示する。内部状態やGround Truthを応答へ展開しない。
export function playerView(game) {
  return {
    phase: game.phase,
    title: dummyCase.title,
    notice: dummyCase.notice,
    instruction: dummyCase.instruction,
    candidates: game.phase === 'detective'
      ? dummyCase.evidence.map(({ id, title }) => ({ id, title })) : [],
    inventory: dummyCase.evidence.filter(item => game.inventory.includes(item.id))
      .map(({ id, title, kind, text }) => ({ id, title, kind, text })),
    testimony: game.phase === 'courtroom' ? { ...dummyCase.testimony } : null,
    result: game.result === null ? null : { success: game.result },
  };
}

export function act(game, action, evidenceId) {
  if (action === 'collect') {
    requirePhase(game, 'detective');
    requireEvidence(evidenceId);
    if (!game.inventory.includes(evidenceId)) game.inventory.push(evidenceId);
  } else if (action === 'courtroom') {
    requirePhase(game, 'detective');
    if (!game.inventory.length) {
      throw new GameError('EVIDENCE_REQUIRED', 'inventory', '提示する証拠を1件以上取得してください。');
    }
    game.phase = 'courtroom';
  } else if (action === 'present') {
    requirePhase(game, 'courtroom');
    requireEvidence(evidenceId);
    if (!game.inventory.includes(evidenceId)) {
      throw new GameError('EVIDENCE_NOT_OWNED', 'evidenceId', '所持している証拠を選んでください。');
    }
    game.result = evidenceId === groundTruth.correctEvidenceId;
    game.phase = 'result';
  } else {
    throw new GameError('UNKNOWN_ACTION', 'action', '未登録の操作です。');
  }
  return playerView(game);
}

function requirePhase(game, phase) {
  if (game.phase !== phase) {
    throw new GameError('INVALID_PHASE', 'action', '現在のパートでは実行できない操作です。', 409);
  }
}

function requireEvidence(id) {
  if (typeof id !== 'string' || !dummyCase.evidence.some(item => item.id === id)) {
    throw new GameError('UNKNOWN_EVIDENCE', 'evidenceId', '登録されている証拠を選んでください。');
  }
}
