import { CodexOutputError } from './codex-errors.js';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export function sanitizeDiagnostic(value) {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:sk|sess|Bearer)[-_ A-Za-z0-9.]{16,}\b/gi, '[redacted-secret]')
    .replace(/(access[_ -]?token|refresh[_ -]?token|password|credential)\s*[:=]\s*\S+/gi,
      '$1=[redacted]')
    .slice(0, 4000);
}

export function parseCodexJson(stdout, phase) {
  if (Buffer.byteLength(stdout ?? '', 'utf8') > MAX_OUTPUT_BYTES) {
    throw new CodexOutputError('Codex出力が上限を超えました。', {
      phase, code: 'CODEX_OUTPUT_TOO_LARGE' });
  }
  const text = String(stdout ?? '').trim();
  if (!text) throw new CodexOutputError('CodexからJSON出力を取得できませんでした。', { phase });
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch {
    throw new CodexOutputError('Codex出力が単一のJSONオブジェクトではありません。', {
      phase, details: sanitizeDiagnostic(text) });
  }
}
