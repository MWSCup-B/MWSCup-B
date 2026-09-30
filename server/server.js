import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, relative, resolve } from 'node:path';
import { createGame, playerView, act, GameError } from './game.js';
import { buildGeneratedGame } from './generation/game-make.js';
import { actGenerated, createGeneratedGame, generatedPlayerView } from './generated-game.js';
import { AutoGenerationManager, autoAuthorBootstrap, autoAuthorView,
  createAutoAuthorSession } from './auto-generation-service.js';
import { CodexRunner } from './codex/codex-runner.js';
import { CodexJsonRunner } from './codex/codex-json-runner.js';
import { actXssPrototype, createXssPrototypeGame, xssPrototypePlayerView }
  from './xss-prototype.js';
import { SavedGameStore } from './saved-game-store.js';
import { AUDIO_CATALOG } from '../public/audio-catalog.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/generated-view.js', ['generated-view.js', 'text/javascript; charset=utf-8']],
  ['/investigation-workspace.js', ['investigation-workspace.js', 'text/javascript; charset=utf-8']],
  ['/generated-game.css', ['generated-game.css', 'text/css; charset=utf-8']],
  ['/author', ['author.html', 'text/html; charset=utf-8']],
  ['/author.js', ['author.js', 'text/javascript; charset=utf-8']],
  ['/network-diagram.js', ['network-diagram.js', 'text/javascript; charset=utf-8']],
  ['/author.css', ['author.css', 'text/css; charset=utf-8']],
  ['/visual-assets.js', ['visual-assets.js', 'text/javascript; charset=utf-8']],
  ['/audio-catalog.js', ['audio-catalog.js', 'text/javascript; charset=utf-8']],
  ['/game-audio.js', ['game-audio.js', 'text/javascript; charset=utf-8']],
  ['/game-audio.css', ['game-audio.css', 'text/css; charset=utf-8']],
  ['/audio-credits.html', ['audio-credits.html', 'text/html; charset=utf-8']],
  ['/assets/audio/manifest.json', ['assets/audio/manifest.json', 'application/json; charset=utf-8']],
]);
for (const id of Object.keys(AUDIO_CATALOG)) {
  assets.set(`/assets/audio/${id}.bin`, [`assets/audio/${id}.bin`, 'application/octet-stream']);
}
for (const path of [
  'backgrounds/intro.svg', 'backgrounds/courtroom.svg', 'backgrounds/investigation.svg',
  'characters/defense-neutral.svg', 'characters/defense-thinking.svg',
  'characters/defense-confident.svg', 'characters/prosecutor-neutral.svg',
  'characters/prosecutor-confident.svg', 'characters/prosecutor-surprised.svg',
  'characters/judge-neutral.svg', 'effects/objection.svg',
  'networks/network-a.svg', 'networks/network-b.svg', 'networks/network-c.svg',
  'networks/network-d.svg',
  'characters/witness-neutral.svg', 'characters/defendant-neutral.svg',
]) assets.set(`/assets/${path}`, [`assets/${path}`, 'image/svg+xml; charset=utf-8']);
for (const path of ['backgrounds/courtroom-v2.png', 'backgrounds/investigation-v2.png',
  'characters/judge-penguin-v1.png', 'characters/prosecutor-penguin-v1.png',
  'characters/defense-penguin-v1.png', 'characters/assistant-penguin-v1.png',
  'characters/defense-portrait-v2.png', 'characters/prosecutor-portrait-v2.png',
  'characters/assistant-portrait-v1.png', 'title/title.png']) {
  assets.set(`/assets/${path}`, [`assets/${path}`, 'image/png']);
}
const generatedActionFields = new Map([
  ['begin', ['action']], ['continue', ['action']],
  ['investigate', ['action', 'targetId', 'investigationActionId']],
  ['inspect-material', ['action', 'materialId', 'methodId']],
  ['workspace-command', ['action', 'materialId', 'command']],
  ['workspace-read', ['action', 'materialId']],
  ['save-observation', ['action', 'materialId', 'field', 'value']],
  ['save-fact', ['action', 'materialId', 'line']],
  ['remove-fact', ['action', 'materialId', 'line']],
  ['collect', ['action', 'evidenceId']], ['retrial', ['action', 'interpretationChoiceId', 'evidenceId']], ['investigation', ['action']],
  ['objection', ['action', 'statementId', 'evidenceId', 'interpretationChoiceId']], ['retry', ['action']],
]);
const xssActionFields = new Map([
  ['begin', ['action']], ['next-dialogue', ['action']],
  ['investigate', ['action', 'choiceId']], ['court', ['action']],
  ['present-evidence', ['action', 'evidenceId']], ['next-round', ['action']], ['finish', ['action']],
]);

export function createAppServer({ mode, gameCaseResult = null, codexRunner = null,
  savedGamesDirectory = resolve(process.cwd(), 'data', 'saved-games') } = {}) {
  if (!['FIXTURE', 'GENERATED', 'AUTHOR'].includes(mode)) {
    throw new GameError('GAME_MODE_REQUIRED', 'mode',
      'AUTHOR、FIXTURE、GENERATEDのいずれかを明示してください。', 500);
  }
  const build = mode === 'GENERATED' ? buildGeneratedGame(gameCaseResult) : null;
  const runtime = build?.runtime ?? null;
  const sessions = new Map();
  const authorSessions = new Map();
  const playableGames = new Map();
  const savedGames = mode === 'AUTHOR' ? new SavedGameStore(savedGamesDirectory) : null;
  async function saveCompletedGame(session) {
    try {
      const game = await savedGames.save(session.gameCaseResult, savedGameMetadata(session));
      session.savedGameId = game.gameId;
      session.savedAt = game.savedAt;
      const playId = randomBytes(24).toString('hex');
      session.playId = playId;
      playableGames.set(playId, { runtime: session.runtime, savedGameId: game.gameId });
    } catch {
      throw new GameError('GAME_SAVE_FAILED', 'savedGamesDirectory',
        '完成したゲームをローカルへ保存できませんでした。', 500);
    }
  }
  const autoManager = new AutoGenerationManager({ jsonRunner: codexRunner
    ?? new CodexJsonRunner(new CodexRunner({ cwd: process.cwd() })),
  onReady: mode === 'AUTHOR' ? saveCompletedGame : null });
  const appServer = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) {
        throw new GameError('INVALID_HOST', 'host', 'ローカルホストから接続してください。', 403);
      }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        throw new GameError('INVALID_ORIGIN', 'origin', '同じオリジンから操作してください。', 403);
      }
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const pathname = requestUrl.pathname;
      if (req.method === 'GET' && mode === 'AUTHOR' && pathname === '/'
        && !requestUrl.searchParams.has('game') && !requestUrl.searchParams.has('saved')) {
        res.writeHead(302, { Location: '/author' }); res.end(); return;
      }
      const asset = assets.get(pathname);
      if (req.method === 'GET' && asset) {
        if ((pathname === '/author' || pathname === '/author.js') && mode !== 'AUTHOR') {
          throw new GameError('NOT_FOUND', 'path', '対象が見つかりません。', 404);
        }
        const data = await readFile(new URL(`../public/${asset[0]}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': asset[1] });
        res.end(data);
        return;
      }
      const now = Date.now();
      cleanupSessions(sessions, now);
      cleanupAuthorSessions(authorSessions, playableGames, now);
      if (mode === 'AUTHOR' && pathname === '/api/author/games' && req.method === 'GET') {
        requireAuthorSession(req, authorSessions);
        sendJson(res, 200, { games: await savedGames.list() });
        return;
      }
      const savedGameRoute = mode === 'AUTHOR'
        ? /^\/api\/author\/games\/(saved_[a-f0-9]{32})$/.exec(pathname) : null;
      const studyRoute = mode === 'AUTHOR'
        ? /^\/api\/author\/games\/(saved_[a-f0-9]{32})\/study$/.exec(pathname) : null;
      if (studyRoute && req.method === 'GET') {
        requireAuthorSession(req, authorSessions);
        sendJson(res, 200, { study: await savedGames.study(studyRoute[1]) });
        return;
      }
      if (savedGameRoute && req.method === 'DELETE') {
        requireAuthorSession(req, authorSessions);
        await savedGames.delete(savedGameRoute[1]);
        sendJson(res, 200, { deleted: true });
        return;
      }
      if (mode === 'AUTHOR' && pathname.startsWith('/api/author/')) {
        if (pathname === '/api/author/status' && req.method === 'GET') {
          const { session } = requireAuthorSession(req, authorSessions);
          sendJson(res, 200, { author: autoAuthorView(session) });
          return;
        }
        if (req.method !== 'POST') throw new GameError('NOT_FOUND', 'path',
          '対象が見つかりません。', 404);
        const body = await readJson(req, 2 * 1024 * 1024);
        if (pathname === '/api/author/start') {
          validateFields(body, []);
          if (authorSessions.size >= 100) throw new GameError('AUTHOR_SESSION_LIMIT',
            'session', '制作セッション数が上限に達しました。', 503);
          const token = randomBytes(32).toString('hex');
          const session = createAutoAuthorSession();
          authorSessions.set(token, { session, updatedAt: now });
          sendJson(res, 200, { token, bootstrap: autoAuthorBootstrap(),
            author: autoAuthorView(session) });
          return;
        }
        const { token, record } = requireAuthorSession(req, authorSessions);
        let author;
        if (pathname === '/api/author/select-mode') {
          validateFields(body, ['mode']);
          author = autoManager.selectMode(record.session, body.mode);
        } else if (pathname === '/api/author/selection') {
          validateFields(body, ['request', 'generationSettings']);
          const previousPlayId = record.session.playId;
          author = autoManager.submitSelection(record.session, body.request, body.generationSettings);
          if (previousPlayId) playableGames.delete(previousPlayId);
        } else if (pathname === '/api/author/manual') {
          validateFields(body, ['configuration', 'generationSettings']);
          if (record.session.playId) playableGames.delete(record.session.playId);
          author = autoManager.submitManual(record.session, body.configuration, body.generationSettings);
        } else if (pathname === '/api/author/makotomaru') {
          validateFields(body, ['request', 'generationSettings']);
          if (record.session.playId) playableGames.delete(record.session.playId);
          author = autoManager.startMakotomaru(record.session, body.request, body.generationSettings);
        } else if (pathname === '/api/author/approve') {
          validateFields(body, []); author = autoManager.approve(record.session);
        } else if (pathname === '/api/author/reject') {
          validateFields(body, []); author = autoManager.reject(record.session);
        } else if (pathname === '/api/author/regenerate') {
          validateFields(body, []); author = autoManager.regenerate(record.session);
        } else if (pathname === '/api/author/cancel') {
          validateFields(body, []); author = autoManager.cancel(record.session);
        } else if (pathname === '/api/author/menu') {
          validateFields(body, []);
          if (record.session.playId) playableGames.delete(record.session.playId);
          author = autoManager.returnToMenu(record.session);
        } else if (pathname === '/api/author/shutdown') {
          validateFields(body, ['saveData']);
          if (typeof body.saveData !== 'boolean') throw new GameError(
            'INVALID_SAVE_CHOICE', 'saveData', '保存するかどうかを指定してください。');
          const savedGameCount = (await savedGames.list()).length;
          sendJson(res, 200, { shuttingDown: true, saveData: body.saveData, savedGameCount });
          setTimeout(() => {
            appServer.close();
            appServer.closeAllConnections();
          }, 100);
          return;
        } else throw new GameError('NOT_FOUND', 'path', '対象が見つかりません。', 404);
        record.updatedAt = now;
        sendJson(res, 200, { author });
        return;
      }
      if (req.method !== 'POST' || !['/api/start', '/api/action'].includes(pathname)) {
        throw new GameError('NOT_FOUND', 'path', '対象が見つかりません。', 404);
      }
      const body = await readJson(req);
      if (pathname === '/api/start') {
        validateFields(body, mode === 'AUTHOR' ? ['playId', 'gameId'] : []);
        if (sessions.size >= 1000) {
          throw new GameError('SESSION_LIMIT', 'session', '起動中のゲーム数が上限に達しました。', 503);
        }
        const token = randomBytes(32).toString('hex');
        if (mode === 'GENERATED' && !runtime) throw new GameError('GAME_BUILD_BLOCKED',
          'game', 'Generated Game Caseの検証に失敗したため開始できません。', 503);
        let sessionRuntime = runtime;
        let sessionMode = mode;
        let savedGameId = null;
        if (mode === 'AUTHOR') {
          if (typeof body.gameId === 'string') {
            sessionRuntime = (await savedGames.load(body.gameId)).runtime;
            savedGameId = body.gameId;
          } else if (typeof body.playId === 'string' && playableGames.has(body.playId)) {
            sessionRuntime = playableGames.get(body.playId).runtime;
            savedGameId = playableGames.get(body.playId).savedGameId;
          } else {
            throw new GameError('ACCEPTED_GAME_REQUIRED', 'playId',
              '保存済みゲーム、またはACCEPTEDになった制作セッションを指定してください。', 409);
          }
          sessionMode = sessionRuntime.mode === 'XSS_PROTOTYPE' ? 'XSS_PROTOTYPE' : 'GENERATED';
        }
        const game = sessionMode === 'GENERATED' ? createGeneratedGame(sessionRuntime)
          : sessionMode === 'XSS_PROTOTYPE' ? createXssPrototypeGame(sessionRuntime) : createGame();
        sessions.set(token, { game, runtime: sessionRuntime, mode: sessionMode, savedGameId, updatedAt: now });
        sendJson(res, 200, { token, game: sessionMode === 'GENERATED'
          ? generatedPlayerView(game, sessionRuntime)
          : sessionMode === 'XSS_PROTOTYPE' ? xssPrototypePlayerView(game, sessionRuntime)
            : playerView(game) });
        return;
      }
      const authorization = req.headers.authorization || '';
      const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1];
      const session = sessions.get(token);
      if (!session) throw new GameError('SESSION_REQUIRED', 'session', 'ページを再読み込みしてゲームを開始してください。', 401);
      validateFields(body, session.mode === 'GENERATED'
        ? (generatedActionFields.get(body.action) ?? ['action'])
        : session.mode === 'XSS_PROTOTYPE'
          ? (xssActionFields.get(body.action) ?? ['action']) : ['action', 'evidenceId']);
      if (typeof body.action !== 'string') {
        throw new GameError('INVALID_ACTION', 'action', '操作を指定してください。');
      }
      // Commit the session only after its clear record is durably saved, so a failed
      // write can be retried with the same action without losing the verdict.
      const draft = structuredClone(session.game);
      const game = session.mode === 'GENERATED'
        ? actGenerated(draft, session.runtime, body)
        : session.mode === 'XSS_PROTOTYPE'
          ? actXssPrototype(session.game, session.runtime, body)
          : act(session.game, body.action, body.evidenceId);
      if (session.mode === 'GENERATED') {
        if (game.currentState === 'ACQUITTED' && session.savedGameId) await savedGames.markCleared(session.savedGameId);
        Object.assign(session.game, draft);
      }
      session.updatedAt = now;
      sendJson(res, 200, { game });
    } catch (error) {
      const known = error instanceof GameError;
      sendJson(res, known ? error.status : 500, {
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          field: known ? error.field : 'server',
          message: known ? error.message : '処理に失敗しました。',
        },
      });
    }
  });
  return appServer;
}

function savedGameMetadata(session) {
  const context = session.configuration?.incidentContext ?? {};
  const preview = session.scenarioPreview ?? {};
  const organization = context.organizationName || '作成した事件';
  const targetSystem = context.victimSystem || preview.targetSystem || '対象システム';
  return {
    title: `${organization} — ${targetSystem}`,
    summary: preview.incidentSummary || `${organization}で発生したセキュリティ事件を調査します。`,
    targetSystem,
    difficulty: session.configuration?.difficulty ?? preview.difficulty,
    attacks: (preview.attacks ?? []).map(attack => attack.label),
  };
}

function cleanupSessions(sessions, now) {
  for (const [token, session] of sessions) {
    if (now - session.updatedAt > 60 * 60 * 1000) sessions.delete(token);
  }
}

function cleanupAuthorSessions(authorSessions, playableGames, now) {
  for (const [token, record] of authorSessions) {
    if (now - record.updatedAt <= 4 * 60 * 60 * 1000) continue;
    if (record.session.playId) playableGames.delete(record.session.playId);
    authorSessions.delete(token);
  }
}

function requireAuthorSession(req, sessions) {
  const authorization = req.headers.authorization || '';
  const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1];
  const record = sessions.get(token);
  if (!record) throw new GameError('AUTHOR_SESSION_REQUIRED', 'session',
    '制作画面を再読み込みして開始してください。', 401);
  return { token, record, session: record.session };
}

export async function loadGameCaseResult(pathname, root = process.cwd()) {
  if (typeof pathname !== 'string' || !pathname || extname(pathname) !== '.json') {
    throw new GameError('INVALID_GAME_CASE_PATH', 'GAME_CASE_PATH',
      'workspace内のJSONファイルを指定してください。', 500);
  }
  const rootPath = resolve(root);
  const target = resolve(rootPath, pathname);
  const rel = relative(rootPath, target);
  if (rel.startsWith('..') || rel === '' || rel.split('/').includes('public')) {
    throw new GameError('INVALID_GAME_CASE_PATH', 'GAME_CASE_PATH',
      '公開ディレクトリ外のworkspace内JSONを指定してください。', 500);
  }
  const data = await readFile(target);
  if (data.length > 10 * 1024 * 1024) throw new GameError('GAME_CASE_TOO_LARGE',
    'GAME_CASE_PATH', 'Game Caseファイルが大きすぎます。', 500);
  try { return JSON.parse(data.toString('utf8')); }
  catch { throw new GameError('INVALID_GAME_CASE_JSON', 'GAME_CASE_PATH',
    'Game Case JSONが不正です。', 500); }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function validateFields(body, allowed) {
  if (Object.keys(body).some(key => !allowed.includes(key))) {
    throw new GameError('UNKNOWN_FIELD', 'body', '未定義のフィールドが含まれています。');
  }
}

function rejectDangerousKeys(value, path = 'body') {
  if (Array.isArray(value)) value.forEach((item, index) => rejectDangerousKeys(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new GameError('DANGEROUS_KEY', path, '危険なオブジェクトキーを使用できません。');
    }
    rejectDangerousKeys(item, `${path}.${key}`);
  }
}

async function readJson(req, maxBytes = 4096) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new GameError('INVALID_CONTENT_TYPE', 'body', 'JSON形式で送信してください。', 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new GameError('BODY_TOO_LARGE', 'body', '入力が長すぎます。', 413);
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new GameError('INVALID_JSON', 'body', 'JSON形式が不正です。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new GameError('INVALID_BODY', 'body', 'JSONオブジェクトを指定してください。');
  }
  rejectDangerousKeys(body);
  return body;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.env.GAME_MODE?.toUpperCase() || 'AUTHOR';
  let gameCaseResult = null;
  if (mode === 'GENERATED') gameCaseResult = await loadGameCaseResult(process.env.GAME_CASE_PATH);
  const server = createAppServer({ mode, gameCaseResult });
  server.on('error', () => {
    console.error('サーバーを起動できません。ポート3000の使用状況を確認してください。');
    process.exitCode = 1;
  });
  server.listen(3000, '127.0.0.1', () => console.log('http://localhost:3000'));
}
