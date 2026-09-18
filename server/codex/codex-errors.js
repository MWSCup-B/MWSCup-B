export class CodexError extends Error {
  constructor(code, message, { phase = 'CHECKING_CODEX', retryable = false,
    details = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'CodexError';
    this.code = code;
    this.phase = phase;
    this.retryable = retryable;
    this.details = details;
  }
}

export class CodexUnavailableError extends CodexError {
  constructor(message = 'Codex CLIを利用できません。') {
    super('CODEX_UNAVAILABLE', message, { phase: 'CHECKING_CODEX' });
  }
}

export class CodexTimeoutError extends CodexError {
  constructor(phase) {
    super('CODEX_TIMEOUT', 'Codex CLIの実行がタイムアウトしました。', { phase, retryable: false });
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
