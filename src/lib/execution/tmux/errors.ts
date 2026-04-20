/**
 * tmux adapter error codes.
 * These map tmux CLI failures to domain-level codes consumed by action / UI / audit layers.
 */

export const TMUX_ERROR_CODES = {
  TMUX_NOT_AVAILABLE: "TMUX_NOT_AVAILABLE",
  TMUX_SESSION_CREATE_FAILED: "TMUX_SESSION_CREATE_FAILED",
  TMUX_SESSION_ALREADY_EXISTS: "TMUX_SESSION_ALREADY_EXISTS",
  TMUX_SESSION_NOT_FOUND: "TMUX_SESSION_NOT_FOUND",
  TMUX_PID_RESOLVE_FAILED: "TMUX_PID_RESOLVE_FAILED",
  TMUX_SESSION_CLEANUP_FAILED: "TMUX_SESSION_CLEANUP_FAILED",
} as const;

export type TmuxErrorCode = (typeof TMUX_ERROR_CODES)[keyof typeof TMUX_ERROR_CODES];

export class TmuxAdapterError extends Error {
  code: TmuxErrorCode;

  constructor(code: TmuxErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "TmuxAdapterError";
  }
}

/**
 * Map a tmux CLI exit code or error condition to a domain error.
 * The `stderr` field is never exposed to the UI — callers receive only
 * sanitized, Chinese-language messages via sanitizeError().
 */
export function mapTmuxError(
  code: TmuxErrorCode,
  context?: { sessionName?: string; stderr?: string },
): TmuxAdapterError {
  const detail = context?.sessionName ? ` (session: ${context.sessionName})` : "";
  const messages: Record<TmuxErrorCode, string> = {
    [TMUX_ERROR_CODES.TMUX_NOT_AVAILABLE]:
      "tmux 不可用，请确认系统已安装 tmux。",
    [TMUX_ERROR_CODES.TMUX_SESSION_CREATE_FAILED]:
      `创建 tmux 会话失败${detail}。`,
    [TMUX_ERROR_CODES.TMUX_SESSION_ALREADY_EXISTS]:
      `tmux 会话已存在${detail}。`,
    [TMUX_ERROR_CODES.TMUX_SESSION_NOT_FOUND]:
      `找不到 tmux 会话${detail}。`,
    [TMUX_ERROR_CODES.TMUX_PID_RESOLVE_FAILED]:
      `无法解析 tmux 会话中的进程 PID${detail}。`,
    [TMUX_ERROR_CODES.TMUX_SESSION_CLEANUP_FAILED]:
      `清理 tmux 会话失败${detail}。`,
  };

  return new TmuxAdapterError(code, messages[code]);
}
