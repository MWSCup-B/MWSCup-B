import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGame, playerView, act, GameError } from './game.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

export function createAppServer() {
  const sessions = new Map();
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
      const asset = assets.get(req.url);
      if (req.method === 'GET' && asset) {
        const data = await readFile(new URL(`../public/${asset[0]}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': asset[1] });
        res.end(data);
        return;
      }
      if (req.method !== 'POST' || !['/api/start', '/api/action'].includes(req.url)) {
        throw new GameError('NOT_FOUND', 'path', '対象が見つかりません。', 404);
      }
      const body = await readJson(req);
      const now = Date.now();
      for (const [token, session] of sessions) {
        if (now - session.updatedAt > 60 * 60 * 1000) sessions.delete(token);
      }
      if (req.url === '/api/start') {
        validateFields(body, []);
        if (sessions.size >= 1000) {
          throw new GameError('SESSION_LIMIT', 'session', '起動中のゲーム数が上限に達しました。', 503);
        }
        const token = randomBytes(32).toString('hex');
        const game = createGame();
        sessions.set(token, { game, updatedAt: now });
        sendJson(res, 200, { token, game: playerView(game) });
        return;
      }
      validateFields(body, ['action', 'evidenceId']);
      if (typeof body.action !== 'string') {
        throw new GameError('INVALID_ACTION', 'action', '操作を指定してください。');
      }
      const authorization = req.headers.authorization || '';
      const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1];
      const session = sessions.get(token);
      if (!session) throw new GameError('SESSION_REQUIRED', 'session', 'ページを再読み込みしてゲームを開始してください。', 401);
      const game = act(session.game, body.action, body.evidenceId);
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

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function validateFields(body, allowed) {
  if (Object.keys(body).some(key => !allowed.includes(key))) {
    throw new GameError('UNKNOWN_FIELD', 'body', '未定義のフィールドが含まれています。');
  }
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new GameError('INVALID_CONTENT_TYPE', 'body', 'JSON形式で送信してください。', 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new GameError('BODY_TOO_LARGE', 'body', '入力が長すぎます。', 413);
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new GameError('INVALID_JSON', 'body', 'JSON形式が不正です。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new GameError('INVALID_BODY', 'body', 'JSONオブジェクトを指定してください。');
  }
  return body;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  server.on('error', () => {
    console.error('サーバーを起動できません。ポート3000の使用状況を確認してください。');
    process.exitCode = 1;
  });
  server.listen(3000, '127.0.0.1', () => console.log('http://localhost:3000'));
}
