import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexCancelledError, CodexError, CodexTimeoutError,
  CodexUnavailableError, CodexOutputError, CodexOutputSchemaError } from './codex-errors.js';
import { sanitizeDiagnostic } from './codex-output-parser.js';
import { adaptCodexOutputSchema } from './codex-schema-adapter.js';

const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

function schemaFailureDetail(stderr) {
  const safe = sanitizeDiagnostic(stderr);
  const missingType = safe.match(/([A-Za-z0-9_.\[\]$-]+) must have a ['"]type['"] key/i);
  if (missingType) return `${missingType[1]} requires explicit type`;
  return 'Codex rejected the output schema as invalid_json_schema.';
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
  return () => value;
}

export class CodexRunner {
  constructor({ command = 'codex', cwd = process.cwd(), timeoutMs = Number(
    process.env.CODEX_GENERATION_TIMEOUT_MS ?? 180000), spawnImpl = spawn } = {}) {
    this.command = command;
    this.cwd = cwd;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : 180000;
    this.spawnImpl = spawnImpl;
  }

  async #spawn(args, { input = null, signal = null, timeoutMs = this.timeoutMs,
    phase = 'CHECKING_CODEX' } = {}) {
    return await new Promise((resolve, reject) => {
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
        if (timedOut) return reject(new CodexTimeoutError(phase));
        if (outputLimit) return reject(new CodexOutputError(
          `Codexの${outputLimit}が上限を超えました。`, {
            phase, code: 'CODEX_OUTPUT_TOO_LARGE' }));
        resolve({ stdout: output(), stderr: errors(), exitCode: code, signal: closeSignal });
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
    timeoutMs = this.timeoutMs }) {
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
        });
      }
      if (result.exitCode !== 0) throw new CodexError('CODEX_EXEC_FAILED',
        'Codex CLIの実行に失敗しました。', { phase, retryable: false,
          details: sanitizeDiagnostic(result.stderr) });
      return result.stdout;
    } finally {
      await materialized?.cleanup();
    }
  }
}
