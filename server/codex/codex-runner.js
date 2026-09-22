import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexCancelledError, CodexError, CodexTimeoutError,
  CodexUnavailableError, CodexOutputError, CodexOutputSchemaError } from './codex-errors.js';
import { sanitizeDiagnostic } from './codex-output-parser.js';
import { adaptCodexOutputSchema } from './codex-schema-adapter.js';

const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_EVIDENCE_TIMEOUT_MS = 600000;
const DEFAULT_SCENARIO_REVISION_TIMEOUT_MS = 600000;
const MAX_TIMER_MS = 2147483647;

function configuredTimeout(value) {
  const milliseconds = Number(value);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 1000
    && milliseconds <= MAX_TIMER_MS ? milliseconds : null;
}

function schemaFailureDetail(stderr) {
  const safe = sanitizeDiagnostic(stderr);
  const missingType = safe.match(/([A-Za-z0-9_.\[\]$-]+) must have a ['"]type['"] key/i);
  if (missingType) return `${missingType[1]} requires explicit type`;
  return 'Codex rejected the output schema as invalid_json_schema.';
}

function httpStatusFrom(stderr) {
  const text = String(stderr ?? '');
  const match = text.match(/\bHTTP(?:\s+status)?\s*[:=]?\s*(\d{3})\b/i)
    ?? text.match(/["']status["']\s*:\s*(\d{3})\b/i)
    ?? text.match(/\bstatus(?:\s+code)?\s*[:=]\s*(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

export function classifyCodexExecFailure(stderr, exitCode, phase) {
  const safe = sanitizeDiagnostic(stderr);
  const httpStatus = httpStatusFrom(safe);
  const common = { phase, exitCode, httpStatus, details: safe || null };
  if (httpStatus === 429 || /\b(?:usage limit|usage_limit|quota|insufficient_quota|rate[ _-]?limit(?:ed|_exceeded)?)\b/i.test(safe)) {
    return new CodexError('CODEX_USAGE_LIMIT_REACHED',
      'Codexの利用上限に達しています。', {
        ...common, retryable: true, cliErrorClass: 'usage_limit',
        details: 'Codex usage or rate limit was reached.',
      });
  }
  if (/\b(?:model_not_found|unknown model|model .* not (?:available|supported)|unsupported model)\b/i.test(safe)) {
    return new CodexError('CODEX_MODEL_UNAVAILABLE', 'Codexモデルを利用できません。', {
      ...common, retryable: false, cliErrorClass: 'model_unavailable',
    });
  }
  if (/\b(?:context length|context_length_exceeded|input too (?:large|long)|maximum context|max(?:imum)? input tokens)\b/i.test(safe)) {
    return new CodexError('CODEX_INPUT_TOO_LARGE', 'Codexへの入力が上限を超えました。', {
      ...common, retryable: false, cliErrorClass: 'input_too_large',
    });
  }
  if (httpStatus !== null || /\b(?:HTTP error|connection error|request failed)\b/i.test(safe)) {
    return new CodexError('CODEX_HTTP_ERROR', 'Codexサービスとの通信に失敗しました。', {
      ...common, retryable: httpStatus === null || httpStatus === 408 || httpStatus >= 500,
      cliErrorClass: 'http_error',
    });
  }
  return new CodexError('CODEX_EXEC_FAILED', 'Codex CLIの実行に失敗しました.', {
    ...common, retryable: false, cliErrorClass: 'cli_error',
  });
}

function collect(stream, onLimit) {
  let value = '';
  let bytes = 0;
  let limited = false;
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    bytes += Buffer.byteLength(chunk, 'utf8');
    if (bytes <= MAX_CAPTURE_BYTES) value += chunk;
    else if (!limited) { limited = true; onLimit(); }
  });
  return { text: () => value, bytes: () => bytes };
}

export class CodexRunner {
  constructor({ command = 'codex', cwd = process.cwd(),
    timeoutMs = process.env.CODEX_GENERATION_TIMEOUT_MS,
    evidenceTimeoutMs = process.env.CODEX_EVIDENCE_TIMEOUT_MS,
    scenarioRevisionTimeoutMs = process.env.CODEX_SCENARIO_REVISION_TIMEOUT_MS, spawnImpl = spawn } = {}) {
    this.command = command;
    this.cwd = cwd;
    const explicitTimeout = configuredTimeout(timeoutMs);
    this.timeoutMs = explicitTimeout ?? DEFAULT_TIMEOUT_MS;
    // Explicit global limits retain their previous meaning unless Evidence is overridden.
    this.evidenceTimeoutMs = configuredTimeout(evidenceTimeoutMs)
      ?? explicitTimeout ?? DEFAULT_EVIDENCE_TIMEOUT_MS;
    this.scenarioRevisionTimeoutMs = configuredTimeout(scenarioRevisionTimeoutMs)
      ?? explicitTimeout ?? DEFAULT_SCENARIO_REVISION_TIMEOUT_MS;
    this.spawnImpl = spawnImpl;
  }

  async #spawn(args, { input = null, signal = null, timeoutMs = this.timeoutMs,
    phase = 'CHECKING_CODEX' } = {}) {
    return await new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let outputLimit = null;
      let killTimer = null;
      let child;
      try {
        child = this.spawnImpl(this.command, args, {
          cwd: this.cwd, shell: false, windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        if (error?.code === 'ENOENT') reject(new CodexUnavailableError(
          'Codex CLIが見つかりません。'));
        else reject(new CodexError('CODEX_START_FAILED', 'Codex CLIを起動できませんでした。',
          { phase, details: sanitizeDiagnostic(error?.message), cause: error }));
        return;
      }
      const stop = () => {
        if (!killTimer) {
          killTimer = setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1000);
          killTimer.unref?.();
        }
        if (!settled) child.kill('SIGTERM');
      };
      const limit = streamName => {
        if (!outputLimit) outputLimit = streamName;
        stop();
      };
      const output = collect(child.stdout, () => limit('stdout'));
      const errors = collect(child.stderr, () => limit('stderr'));
      const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
      timer.unref?.();
      const onAbort = () => { cancelled = true; stop(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdin.on('error', () => {
        // The close/error handler below classifies a child that exits before consuming stdin.
      });
      child.on('error', error => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener('abort', onAbort);
        if (error.code === 'ENOENT') reject(new CodexUnavailableError('Codex CLIが見つかりません。'));
        else reject(new CodexError('CODEX_START_FAILED', 'Codex CLIを起動できませんでした。',
          { phase, details: sanitizeDiagnostic(error.message), cause: error }));
      });
      child.on('close', (code, closeSignal) => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener('abort', onAbort);
        if (cancelled || signal?.aborted) return reject(new CodexCancelledError(phase));
        if (timedOut) return reject(new CodexTimeoutError(phase, {
          timeoutMs, elapsedMs: Math.ceil(performance.now() - startedAt),
          promptBytes: input == null ? 0 : Buffer.byteLength(input, 'utf8'),
          stdoutBytes: output.bytes(), stderrBytes: errors.bytes(),
          exitCode: code, terminationSignal: closeSignal,
        }));
        if (outputLimit) return reject(new CodexOutputError(
          `Codexの${outputLimit}が上限を超えました。`, {
            phase, code: 'CODEX_OUTPUT_TOO_LARGE' }));
        resolve({ stdout: output.text(), stderr: errors.text(), exitCode: code, signal: closeSignal });
      });
      if (signal?.aborted) onAbort();
      if (input == null) child.stdin.end();
      else child.stdin.end(input, 'utf8');
    });
  }

  async checkAvailability({ signal } = {}) {
    const version = await this.#spawn(['--version'], { signal, timeoutMs: 10000 });
    if (version.exitCode !== 0) throw new CodexUnavailableError();
    const auth = await this.#spawn(['login', 'status'], { signal, timeoutMs: 10000 });
    // Current Codex releases write login status to stderr when stdout is not a TTY.
    // Inspect only the fixed status phrase and never retain or return the diagnostic text.
    if (auth.exitCode !== 0 || !/logged in/i.test(`${auth.stdout}\n${auth.stderr}`)) {
      throw new CodexUnavailableError(
        'Codex CLIでChatGPTアカウントへログインしてください。');
    }
    return { available: true, version: sanitizeDiagnostic(version.stdout).trim() };
  }

  async #materializeOutputSchema({ outputSchemaPath, outputSchema, outputSchemaName, phase }) {
    if (!outputSchemaPath && outputSchema === undefined) return null;
    const schemaName = outputSchemaName ?? (outputSchemaPath
      ? outputSchemaPath.split(/[\\/]/).at(-1)?.replace(/\.schema\.json$/, '')
      : 'codex-output');
    let canonicalSchema = outputSchema;
    if (canonicalSchema === undefined) {
      try { canonicalSchema = JSON.parse(await readFile(outputSchemaPath, 'utf8')); }
      catch (error) {
        throw new CodexOutputSchemaError('出力Schemaを読み込めませんでした。', {
          phase, schemaName, cliErrorCode: 'schema_read_failed',
          details: 'Output schema could not be loaded.', cause: error,
        });
      }
    }
    const adapted = adaptCodexOutputSchema(canonicalSchema, { schemaName, phase });
    const directory = await mkdtemp(join(tmpdir(), 'mwscup-codex-schema-'));
    const path = join(directory, 'output-schema.json');
    try { await writeFile(path, `${JSON.stringify(adapted)}\n`, { encoding: 'utf8', mode: 0o600 }); }
    catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw new CodexOutputSchemaError('出力Schemaの一時ファイルを作成できませんでした。', {
        phase, schemaName, cliErrorCode: 'schema_write_failed',
        details: 'Output schema could not be materialized.', cause: error,
      });
    }
    return { path, schemaName, cleanup: () => rm(directory, { recursive: true, force: true }) };
  }

  async run({ prompt, outputSchemaPath, outputSchema, outputSchemaName, phase, signal,
    timeoutMs = phase === 'GENERATING_EVIDENCE' ? this.evidenceTimeoutMs
      : phase === 'REVISING_SCENARIO' ? this.scenarioRevisionTimeoutMs : this.timeoutMs }) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_MS) {
      throw new RangeError('timeoutMs must be a positive integer within the Node.js timer range.');
    }
    // --ask-for-approval is a root option in current Codex CLI releases and must precede `exec`.
    // Ignoring user config/rules keeps the invocation contract stable while preserving CODEX_HOME
    // authentication, as documented by the CLI itself.
    const materialized = await this.#materializeOutputSchema({ outputSchemaPath, outputSchema,
      outputSchemaName, phase });
    try {
      const args = ['--ask-for-approval', 'never', 'exec', '--ephemeral',
        '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--color', 'never'];
      if (materialized) args.push('--output-schema', materialized.path);
      args.push('-');
      const result = await this.#spawn(args, { input: prompt, signal, timeoutMs, phase });
      if (result.exitCode !== 0 && /invalid_json_schema/i.test(result.stderr)) {
        throw new CodexOutputSchemaError('Codexが生成用出力Schemaを受理しませんでした。', {
          phase, schemaName: materialized?.schemaName ?? outputSchemaName ?? 'unknown',
          cliErrorCode: 'invalid_json_schema', details: schemaFailureDetail(result.stderr),
          exitCode: result.exitCode, httpStatus: httpStatusFrom(result.stderr),
        });
      }
      if (result.exitCode !== 0) throw classifyCodexExecFailure(
        result.stderr, result.exitCode, phase);
      return result.stdout;
    } finally {
      await materialized?.cleanup();
    }
  }
}
