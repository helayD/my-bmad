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
