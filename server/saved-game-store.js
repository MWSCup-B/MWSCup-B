import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GameError } from './game.js';
import { buildGeneratedGame } from './generation/game-make.js';

const GAME_ID = /^saved_[a-f0-9]{32}$/;
const MAX_GAME_BYTES = 10 * 1024 * 1024;
const MAX_GAMES = 500;

function requiredText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new GameError('INVALID_SAVED_GAME', field, '保存されたゲームの管理情報が不正です。', 500);
  }
  return value;
}

function validateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new GameError('INVALID_SAVED_GAME', 'metadata', '保存されたゲームの管理情報が不正です。', 500);
  }
  const difficulty = Number(metadata.difficulty);
  if (![1, 2, 3].includes(difficulty) || !Array.isArray(metadata.attacks)
    || metadata.attacks.length < 1 || metadata.attacks.length > 3) {
    throw new GameError('INVALID_SAVED_GAME', 'metadata', '保存されたゲームの管理情報が不正です。', 500);
  }
  return {
    title: requiredText(metadata.title, 'metadata.title', 240),
    summary: requiredText(metadata.summary, 'metadata.summary', 1000),
    targetSystem: requiredText(metadata.targetSystem, 'metadata.targetSystem', 240),
    difficulty,
    attacks: metadata.attacks.map((value, index) =>
      requiredText(value, `metadata.attacks.${index}`, 200)),
  };
}

function publicRecord(record) {
  return { gameId: record.gameId, savedAt: record.savedAt, ...structuredClone(record.metadata) };
}

export class SavedGameStore {
  constructor(directory) {
    if (typeof directory !== 'string' || !directory) {
      throw new GameError('SAVED_GAMES_DIRECTORY_REQUIRED', 'savedGamesDirectory',
        '保存先フォルダを指定してください。', 500);
    }
    this.directory = resolve(directory);
  }

  async #read(gameId) {
    if (!GAME_ID.test(gameId)) {
      throw new GameError('INVALID_SAVED_GAME_ID', 'gameId', '保存済みゲームIDが不正です。', 400);
    }
    const pathname = join(this.directory, `${gameId}.json`);
    let fileStat;
    try { fileStat = await stat(pathname); }
    catch (error) {
      if (error?.code === 'ENOENT') throw new GameError('SAVED_GAME_NOT_FOUND', 'gameId',
        '保存済みゲームが見つかりません。', 404);
      throw error;
    }
    if (!fileStat.isFile() || fileStat.size > MAX_GAME_BYTES) {
      throw new GameError('INVALID_SAVED_GAME', 'game', '保存されたゲームデータが不正です。', 500);
    }
    let record;
    try { record = JSON.parse(await readFile(pathname, 'utf8')); }
    catch { throw new GameError('INVALID_SAVED_GAME', 'game', '保存されたゲームデータを読み込めません。', 500); }
    if (!record || record.schemaVersion !== '1.0' || record.gameId !== gameId
      || typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) {
      throw new GameError('INVALID_SAVED_GAME', 'game', '保存されたゲームデータが不正です。', 500);
    }
    record.metadata = validateMetadata(record.metadata);
    const built = buildGeneratedGame(record.gameCaseResult);
    if (built.gameMakeResult.status !== 'BUILT' || !built.runtime) {
      throw new GameError('INVALID_SAVED_GAME', 'gameCaseResult',
        '保存されたゲームは検証に失敗したため使用できません。', 500);
    }
    return { record, runtime: built.runtime };
  }

  async save(gameCaseResult, metadata) {
    const built = buildGeneratedGame(gameCaseResult);
    if (built.gameMakeResult.status !== 'BUILT' || !built.runtime) {
      throw new GameError('GAME_NOT_READY_FOR_SAVE', 'gameCaseResult',
        '最終検証を通過したゲームだけを保存できます。', 409);
    }
    const gameId = `saved_${randomBytes(16).toString('hex')}`;
    const record = { schemaVersion: '1.0', gameId, savedAt: new Date().toISOString(),
      metadata: validateMetadata(metadata), gameCaseResult: structuredClone(gameCaseResult) };
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${gameId}.json`);
    const temporary = join(this.directory, `.${gameId}.${randomBytes(8).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    return publicRecord(record);
  }

  async list() {
    await mkdir(this.directory, { recursive: true });
    const names = (await readdir(this.directory))
      .filter(name => /^saved_[a-f0-9]{32}\.json$/.test(name)).slice(0, MAX_GAMES);
    const games = [];
    for (const name of names) {
      try { games.push(publicRecord((await this.#read(name.slice(0, -5))).record)); }
      catch (error) {
        if (error instanceof GameError && error.code === 'INVALID_SAVED_GAME') continue;
        throw error;
      }
    }
    return games.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  }

  async load(gameId) {
    const { record, runtime } = await this.#read(gameId);
    return { game: publicRecord(record), runtime };
  }

  async delete(gameId) {
    if (!GAME_ID.test(gameId)) {
      throw new GameError('INVALID_SAVED_GAME_ID', 'gameId', '保存済みゲームIDが不正です。', 400);
    }
    try { await unlink(join(this.directory, `${gameId}.json`)); }
    catch (error) {
      if (error?.code === 'ENOENT') throw new GameError('SAVED_GAME_NOT_FOUND', 'gameId',
        '保存済みゲームが見つかりません。', 404);
      throw error;
    }
  }
}
