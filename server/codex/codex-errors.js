export class CodexError extends Error {
  constructor(code, message, { phase = 'CHECKING_CODEX', retryable = false,
    details = null, cause = null, exitCode = null, httpStatus = null,
    cliErrorClass = null } = {}) {
    super(message, { cause });
    this.name = 'CodexError';
    this.code = code;
    this.phase = phase;
    this.retryable = retryable;
    this.details = details;
    this.exitCode = exitCode;
    this.httpStatus = httpStatus;
    this.cliErrorClass = cliErrorClass;
  }
}

export class CodexUnavailableError extends CodexError {
  constructor(message = 'Codex CLIを利用できません。') {
    super('CODEX_UNAVAILABLE', message, { phase: 'CHECKING_CODEX' });
  }
}

export class CodexTimeoutError extends CodexError {
  constructor(phase, { timeoutMs = null, elapsedMs = null, promptBytes = null,
    stdoutBytes = null, stderrBytes = null, exitCode = null, terminationSignal = null } = {}) {
    super('CODEX_TIMEOUT', 'Codex CLIの実行がアプリ側の制限時間を超えました。', {
      phase, retryable: false, exitCode, cliErrorClass: 'execution_timeout',
    });
    // No prompt, generated evidence, or stderr text is retained in timeout diagnostics.
    for (const [key, value] of Object.entries({ timeoutMs, elapsedMs, promptBytes,
      stdoutBytes, stderrBytes })) {
      this[key] = Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    this.terminationSignal = ['SIGTERM', 'SIGKILL'].includes(terminationSignal) ? terminationSignal : null;
    const setting = phase === 'GENERATING_EVIDENCE'
      ? 'CODEX_EVIDENCE_TIMEOUT_MS' : phase === 'REVISING_SCENARIO'
        ? 'CODEX_SCENARIO_REVISION_TIMEOUT_MS' : 'CODEX_GENERATION_TIMEOUT_MS';
    this.correctionHint = `Developer Detailの制限時間・経過時間・入出力サイズを確認してください。`
      + `必要ならサーバ起動時の${setting}（ミリ秒）を調整し、再起動後に同じ入力条件で実行してください。`
      + 'タイムアウト時の出力は採用せず、自動再試行は行いません。';
  }
}

export class CodexCancelledError extends CodexError {
  constructor(phase) {
    super('GENERATION_CANCELLED', 'ゲーム生成を中止しました。', { phase });
  }
}

export class CodexOutputError extends CodexError {
  constructor(message, { phase, code = 'MALFORMED_CODEX_JSON', details = null } = {}) {
    super(code, message, { phase, retryable: true, details });
  }
}

export class CodexOutputSchemaError extends CodexError {
  constructor(message = '生成用出力SchemaがCodexと互換ではありません。', {
    phase = 'GENERATING_SCENARIO', schemaName = 'unknown', schemaPath = '$',
    cliErrorCode = 'invalid_json_schema', details = null, cause = null,
    exitCode = null, httpStatus = null,
  } = {}) {
    super('CODEX_OUTPUT_SCHEMA_INVALID', message, {
      phase, retryable: false, details, cause, exitCode, httpStatus,
      cliErrorClass: 'output_schema',
    });
    this.schemaName = schemaName;
    this.schemaPath = schemaPath;
    this.cliErrorCode = cliErrorCode;
  }
}
