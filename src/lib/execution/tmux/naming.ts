/**
 * Session name builder for tmux execution sessions.
 *
 * Naming requirements (§3.2):
 * - MUST contain task ID to satisfy AC #1
 * - SHOULD also contain AgentRun ID to avoid naming collisions
 *   when reroute/retry creates a new run for the same task.
 *
 * Format: `bmad-task-<taskId>-run-<agentRunId>`
 * Both IDs are cuid2, safe to use directly (alphanumeric, underscore, hyphen).
 *
 * Length constraint: tmux session names are limited to 255 bytes.
 * cuid2 IDs are ~24 chars each, so the combined name (~68 chars) is well within limits.
 * Enforced at build time to fail fast with a descriptive error.
 *
 * Input validation: taskId and agentRunId must be non-empty strings.
 * The buildSessionName format uses a delimiter that appears at most once in valid
 * cuid2 strings, but callers are expected to pass valid cuid2 values.
 */
export function buildSessionName(taskId: string, agentRunId: string): string {
  if (!taskId || !agentRunId) {
    throw new Error("buildSessionName: taskId and agentRunId must be non-empty strings.");
  }
  const name = `bmad-task-${taskId}-run-${agentRunId}`;
  if (Buffer.byteLength(name) > 255) {
    throw new Error(
      `buildSessionName: session name exceeds tmux 255-byte limit (${Buffer.byteLength(name)} bytes).`,
    );
  }
  return name;
}

/**
 * Parse components back from a session name for diagnostics.
 * Returns null when the name does not match the expected format.
 *
 * Uses lastIndexOf to handle the (unlikely) case where a cuid2 ID
 * contains the "-run-" delimiter substring.
 */
export function parseSessionName(name: string): { taskId: string; agentRunId: string } | null {
  const prefix = "bmad-task-";
  if (!name.startsWith(prefix)) {
    return null;
  }

  const remainder = name.slice(prefix.length);
  const runPrefix = "-run-";
  const runIdx = remainder.lastIndexOf(runPrefix);
  if (runIdx === -1) {
    return null;
  }

  const taskId = remainder.slice(0, runIdx);
  const agentRunId = remainder.slice(runIdx + runPrefix.length);

  if (!taskId || !agentRunId) {
    return null;
  }

  return { taskId, agentRunId };
}
