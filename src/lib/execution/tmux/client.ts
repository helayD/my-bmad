/**
 * Low-level tmux client adapter.
 *
 * Responsibilities (§3.1–3.7):
 * - Encapsulate all tmux CLI invocations behind typed functions.
 * - Use spawn/execFile with argument arrays (NOT exec with shell strings).
 * - Return typed results; map errors to domain TmuxAdapterError codes.
 * - Never expose raw stderr to callers.
 *
 * The client is intentionally stateless — each method opens a fresh tmux
 * invocation for the specific operation needed. Long-running sessions
 * are managed by tmux itself, not by this adapter.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildSessionName } from "./naming";
import {
  mapTmuxError,
  TMUX_ERROR_CODES,
  type TmuxAdapterError,
} from "./errors";

const execFileAsync = promisify(execFile);

export interface TmuxCreateResult {
  sessionName: string;
  panePid: number;
}

export interface TmuxSessionInfo {
  sessionName: string;
  panePid: number;
  exists: boolean;
}

/**
 * Check if the tmux binary is available on the current host.
 */
export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["-V"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a session name against the format produced by buildSessionName().
 * tmux session names are alphanumeric + underscore + hyphen; reject anything else.
 */
export function isValidSessionName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Create a new detached tmux session.
 *
 * Steps:
 * 1. Validate inputs (sessionName format, cwd, agentCommand).
 * 2. Create the session in detached mode with the working directory.
 *    tmux's own "already exists" error is caught and mapped to the domain code.
 * 3. Resolve the pane PID so the caller can track the actual agent process.
 *
 * @param sessionName  Must follow buildSessionName() format and pass isValidSessionName().
 * @param cwd          Working directory for the new session. Must be non-empty.
 * @param agentCommand Command to run inside the session. Must be non-empty.
 * @returns            The created session name and the pane PID of the shell process.
 * @throws TmuxAdapterError on failure.
 */
export async function createSession(
  sessionName: string,
  cwd: string,
  agentCommand: string,
  agentArgs: string[],
): Promise<TmuxCreateResult> {
  // Step 1: validate inputs before touching tmux.
  validateCreateSessionInputs(sessionName, cwd, agentCommand, agentArgs);

  // Step 2: create session — rely on tmux's own error for "already exists".
  const fullArgs = buildNewSessionArgs(sessionName, cwd, agentCommand, agentArgs);

  try {
    await execFileAsync("tmux", fullArgs, { timeout: 10_000 });
  } catch (error) {
    // tmux exits 1 when the session already exists; map it to a specific code.
    if (isAlreadyExistsError(error)) {
      throw mapTmuxError(TMUX_ERROR_CODES.TMUX_SESSION_ALREADY_EXISTS, { sessionName });
    }
    throw mapTmuxError(TMUX_ERROR_CODES.TMUX_SESSION_CREATE_FAILED, {
      sessionName,
      stderr: error instanceof Error ? error.message : undefined,
    });
  }

  // Step 3: resolve the pane PID.
  const panePid = await resolvePanePid(sessionName);
  if (panePid === null) {
    await killSession(sessionName).catch(() => { /* best-effort */ });
    throw mapTmuxError(TMUX_ERROR_CODES.TMUX_PID_RESOLVE_FAILED, { sessionName });
  }

  return { sessionName, panePid };
}

/** Throw on invalid createSession inputs. */
function validateCreateSessionInputs(
  sessionName: string,
  cwd: string,
  agentCommand: string,
  agentArgs: string[],
): void {
  if (!isValidSessionName(sessionName)) {
    throw new Error(
      `Invalid session name "${sessionName}": must match /^[a-zA-Z0-9_-]+$/`,
    );
  }
  if (!cwd || typeof cwd !== "string" || cwd.trim().length === 0) {
    throw new Error("createSession: cwd must be a non-empty string.");
  }
  if (!agentCommand || typeof agentCommand !== "string" || agentCommand.trim().length === 0) {
    throw new Error("createSession: agentCommand must be a non-empty string.");
  }
}

/** Detect tmux's "session already exists" error from stderr text. */
function isAlreadyExistsError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("no such session")
      || msg.includes("duplicate session")
    );
  }
  return false;
}

/**
 * Kill (destroy) a tmux session by name.
 * Idempotent: if the session does not exist, returns without error.
 */
export async function killSession(sessionName: string): Promise<void> {
  try {
    await execFileAsync("tmux", ["kill-session", "-t", sessionName], { timeout: 5_000 });
  } catch (error) {
    // tmux exits with 1 when the session does not exist — treat as success.
    if (isNoSessionError(error)) {
      return;
    }
    throw mapTmuxError(TMUX_ERROR_CODES.TMUX_SESSION_CLEANUP_FAILED, {
      sessionName,
      stderr: error instanceof Error ? error.message : undefined,
    });
  }
}

/**
 * Check whether a tmux session exists.
 */
export async function hasSession(sessionName: string): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["has-session", "-t", sessionName], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the PID of the first process running inside a tmux session's pane.
 * This is the PID of the shell that tmux created (which then forks the agent).
 *
 * Uses `tmux list-panes -t <session> -F "#{pane_pid}"` which is stable
 * across tmux versions and does not require parsing free-form output.
 *
 * Note: this returns the shell PID, not the agent sub-process PID. When the
 * agent replaces the shell via exec(2), the PID remains the same. If the agent
 * is launched as a child (fork+exec), callers monitoring the pane PID should
 * be aware it tracks the shell — the agent PID is a child of this process.
 */
export async function resolvePanePid(sessionName: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      ["list-panes", "-t", sessionName, "-F", "#{pane_pid}"],
      { timeout: 3_000 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }
    const pid = parseInt(trimmed, 10);
    // Ensure the entire string was consumed — reject trailing garbage.
    if (Number.isNaN(pid) || pid <= 0 || String(pid) !== trimmed) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────────

function buildNewSessionArgs(
  sessionName: string,
  cwd: string,
  agentCommand: string,
  agentArgs: string[],
): string[] {
  const args: string[] = [
    "new-session",
    "-d",
    "-s", sessionName,
    "-c", cwd,
  ];

  // Append the agent command and its arguments as trailing positional arguments.
  // tmux treats everything after `-c <cwd>` as the command to execute.
  args.push(agentCommand, ...agentArgs);
  return args;
}

/** Detect tmux "session does not exist" errors for idempotent cleanup. */
function isNoSessionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Only match the specific tmux "no such session" message.
    // Do NOT match generic "not found" — it appears in permission errors,
    // path errors, and many other unrelated failure modes.
    return msg.includes("no such session");
  }
  return false;
}

// ── send-keys ─────────────────────────────────────────────────────────────────

export interface TmuxSendKeysConfig {
  sessionName: string;
  /** 要发送的内容（文本或特殊键如 "Enter", "C-c"） */
  content: string;
  /** 是否在末尾自动追加换行符，默认 true */
  addNewline?: boolean;
}

/**
 * 向 tmux session 发送按键。
 *
 * 职责（Story 5.4 — FR27）：
 * - 将用户输入的指令或确认信息注入到 tmux session
 * - 支持发送普通文本（模拟键盘输入）和特殊按键（如 Enter）
 * - 确保指令内容不被 shell 转义篡改
 *
 * 安全性：
 * - sessionName 必须通过 isValidSessionName() 格式验证
 * - 输入内容长度限制（单次发送不超过 10,000 字符）
 * - 禁止发送二进制或控制字符序列
 *
 * @throws TmuxAdapterError on failure.
 */
export async function sendKeys(config: TmuxSendKeysConfig): Promise<void> {
  const { sessionName, content, addNewline = true } = config;

  // 1. 验证 sessionName 格式
  if (!isValidSessionName(sessionName)) {
    throw new Error(`Invalid session name "${sessionName}": must match /^[a-zA-Z0-9_-]+$/`);
  }

  // 2. 内容长度限制
  const MAX_CONTENT_LENGTH = 10_000;
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`发送内容超过长度限制（${MAX_CONTENT_LENGTH} 字符）`);
  }

  // 3. 禁止发送控制字符（\x00–\x1f 范围内，除 \x09 tab、\x0a 换行、\x0d 回车外）
  const CONTROL_CHAR = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
  if (CONTROL_CHAR.test(content)) {
    throw new Error("发送内容包含非法控制字符");
  }

  // 4. 直接执行 send-keys，不做预检查（hasSession 预检查在竞态窗口内无效，
  //    tmux send-keys 本身会在 session 不存在时返回错误，错误会被正确映射）
  const textToSend = addNewline ? `${content}\n` : content;

  try {
    await execFileAsync("tmux", [
      "send-keys",
      "-t", sessionName,
      "--",    // 分隔符，后续参数不会被解释为选项
      textToSend,
    ], { timeout: 5_000 });
  } catch (error) {
    throw mapTmuxError(TMUX_ERROR_CODES.TMUX_SEND_KEYS_FAILED, {
      sessionName,
      stderr: error instanceof Error ? error.message : undefined,
    });
  }
}
