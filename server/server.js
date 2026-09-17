import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, relative, resolve } from 'node:path';
import { createGame, playerView, act, GameError } from './game.js';
import { buildGeneratedGame } from './generation/game-make.js';
import { actGenerated, createGeneratedGame, generatedPlayerView } from './generated-game.js';
import { authorBootstrap, authorView, buildAuthorGame, createAuthorSession,
  importAuthorEvidence, importAuthorReview, importAuthorScenario, prepareEvidence,
  prepareScenario } from './author-service.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/author', ['author.html', 'text/html; charset=utf-8']],
  ['/author.js', ['author.js', 'text/javascript; charset=utf-8']],
]);
const generatedActionFields = new Map([
  ['begin', ['action']], ['continue', ['action']],
  ['investigate', ['action', 'targetId', 'investigationActionId']],
  ['collect', ['action', 'evidenceId']], ['retrial', ['action']],
  ['objection', ['action', 'statementId', 'evidenceId']], ['retry', ['action']],
]);

export function createAppServer({ mode, gameCaseResult = null } = {}) {
  if (!['FIXTURE', 'GENERATED', 'AUTHOR'].includes(mode)) {
    throw new GameError('GAME_MODE_REQUIRED', 'mode',
      'AUTHOR、FIXTURE、GENERATEDのいずれかを明示してください。', 500);
  }
  const build = mode === 'GENERATED' ? buildGeneratedGame(gameCaseResult) : null;
  const runtime = build?.runtime ?? null;
  const sessions = new Map();
  const authorSessions = new Map();
  const playableGames = new Map();
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
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
        && !requestUrl.searchParams.has('game')) {
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
      if (mode === 'AUTHOR' && pathname.startsWith('/api/author/')) {
        if (pathname === '/api/author/status' && req.method === 'GET') {
          const { session } = requireAuthorSession(req, authorSessions);
          sendJson(res, 200, { author: authorView(session) });
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
          const session = createAuthorSession();
          authorSessions.set(token, { session, updatedAt: now });
          sendJson(res, 200, { token, bootstrap: authorBootstrap(), author: authorView(session) });
          return;
        }
        const { token, record } = requireAuthorSession(req, authorSessions);
        let author;
        if (pathname === '/api/author/prepare-scenario') {
          validateFields(body, ['selectedAttackIds', 'network', 'scenarioContext']);
          author = prepareScenario(record.session, body);
        } else if (pathname === '/api/author/import-scenario') {
          validateFields(body, ['optionId', 'scenarioPackage']);
          author = importAuthorScenario(record.session, body);
        } else if (pathname === '/api/author/import-review') {
          validateFields(body, ['semanticReview']);
          author = importAuthorReview(record.session, body.semanticReview);
        } else if (pathname === '/api/author/prepare-evidence') {
          validateFields(body, []); author = prepareEvidence(record.session);
        } else if (pathname === '/api/author/import-evidence') {
          validateFields(body, ['evidencePackage']);
          author = importAuthorEvidence(record.session, body.evidencePackage);
        } else if (pathname === '/api/author/build') {
          validateFields(body, ['progressionPlan']);
          if (record.session.playId) playableGames.delete(record.session.playId);
          author = buildAuthorGame(record.session, body.progressionPlan);
          if (record.session.workflow?.currentState === 'ACCEPTED' && record.session.runtime) {
            const playId = randomBytes(24).toString('hex');
            record.session.playId = playId;
            playableGames.set(playId, { runtime: record.session.runtime, ownerToken: token });
            author = authorView(record.session);
          }
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
        validateFields(body, mode === 'AUTHOR' ? ['playId'] : []);
        if (sessions.size >= 1000) {
          throw new GameError('SESSION_LIMIT', 'session', '起動中のゲーム数が上限に達しました。', 503);
        }
        const token = randomBytes(32).toString('hex');
        if (mode === 'GENERATED' && !runtime) throw new GameError('GAME_BUILD_BLOCKED',
          'game', 'Generated Game Caseの検証に失敗したため開始できません。', 503);
        let sessionRuntime = runtime;
        let sessionMode = mode;
        if (mode === 'AUTHOR') {
          if (typeof body.playId !== 'string' || !playableGames.has(body.playId)) {
            throw new GameError('ACCEPTED_GAME_REQUIRED', 'playId',
              'ACCEPTEDになった制作セッションのPlay URLを使用してください。', 409);
          }
          sessionRuntime = playableGames.get(body.playId).runtime; sessionMode = 'GENERATED';
        }
        const game = sessionMode === 'GENERATED' ? createGeneratedGame(sessionRuntime) : createGame();
        sessions.set(token, { game, runtime: sessionRuntime, mode: sessionMode, updatedAt: now });
        sendJson(res, 200, { token, game: sessionMode === 'GENERATED'
          ? generatedPlayerView(game, sessionRuntime) : playerView(game) });
        return;
      }
      const authorization = req.headers.authorization || '';
      const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1];
      const session = sessions.get(token);
      if (!session) throw new GameError('SESSION_REQUIRED', 'session', 'ページを再読み込みしてゲームを開始してください。', 401);
      validateFields(body, session.mode === 'GENERATED'
        ? (generatedActionFields.get(body.action) ?? ['action']) : ['action', 'evidenceId']);
      if (typeof body.action !== 'string') {
        throw new GameError('INVALID_ACTION', 'action', '操作を指定してください。');
      }
      const game = session.mode === 'GENERATED'
        ? actGenerated(session.game, session.runtime, body)
        : act(session.game, body.action, body.evidenceId);
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
