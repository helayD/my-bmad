/**
 * Supervisor termination boundary — converts a running AgentRun session termination request
 * into a tmux kill command.
 *
 * Upgraded in Story 4.4 to be relation-first:
 * - First reads ExecutionSession relation to get the session handle.
 * - Falls back to metadata for legacy data / transition-state records.
 *
 * The actual session cleanup is delegated to lifecycle.ts.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { killSession, hasSession } from "@/lib/execution/tmux";

export interface ActiveExecutionSessionHandle {
  transport: string;
  sessionRef: string;
  lastActivityAt: string | null;
  lastActivitySummary: string | null;
  contextSnapshot: Record<string, unknown> | null;
}

export interface TerminateActiveAgentRunInput {
  taskId: string;
  agentRunId: string;
  reasonCode: string;
  reasonSummary: string;
  session: ActiveExecutionSessionHandle;
}

export interface TerminateActiveAgentRunResult {
  transport: string;
  sessionRef: string;
  terminatedAt: string;
  lastActivityAt: string | null;
  lastActivitySummary: string | null;
  contextSnapshot: Record<string, unknown> | null;
}

type ExecutionSupervisorTerminator = (
  input: TerminateActiveAgentRunInput,
) => Promise<TerminateActiveAgentRunResult>;

const executionSupervisorTerminators = new Map<string, ExecutionSupervisorTerminator>();

export class SupervisorTerminationError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "SupervisorTerminationError";
  }
}

export function registerExecutionSupervisorTerminator(
  transport: string,
  terminator: ExecutionSupervisorTerminator,
) {
  executionSupervisorTerminators.set(transport, terminator);
}

export function resetExecutionSupervisorTerminators() {
  executionSupervisorTerminators.clear();
}

export async function terminateActiveAgentRun(
  input: TerminateActiveAgentRunInput,
): Promise<TerminateActiveAgentRunResult> {
  const terminator = executionSupervisorTerminators.get(input.session.transport);
  if (!terminator) {
    throw new SupervisorTerminationError("EXECUTION_SESSION_TERMINATION_UNAVAILABLE");
  }

  return terminator(input);
}

/**
 * Resolve the active session handle for a task + agent run.
 *
 * Relation-first strategy (§4.7):
 * 1. Query ExecutionSession by agentRunId — if found and active, use it.
 * 2. Fall back to metadata parsing for legacy records / pre-4.4 data.
 */
export async function resolveActiveExecutionSessionHandle(
  taskId: string,
  agentRunId: string,
): Promise<ActiveExecutionSessionHandle | null> {
  // Step 1: relation-first lookup.
  const session = await prisma.executionSession.findUnique({
    where: { agentRunId },
    select: {
      id: true,
      transport: true,
      sessionName: true,
      status: true,
      metadata: true,
    },
  });

  if (session) {
    const isActive = session.status === "starting" || session.status === "running";
    if (isActive) {
      return {
        transport: session.transport,
        sessionRef: session.sessionName,
        lastActivityAt: null,
        lastActivitySummary: null,
        contextSnapshot: (session.metadata as Record<string, unknown>) ?? null,
      };
    }
  }

  // Step 2: fall back to metadata for transition-state or legacy records.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { metadata: true },
  });
  const run = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
    select: { metadata: true },
  });

  return resolveHandleFromMetadata(task?.metadata ?? null, run?.metadata ?? null);
}

/**
 * Legacy metadata-only resolution (kept for backward compatibility during transition).
 */
export function resolveHandleFromMetadata(
  taskMetadata: unknown,
  runMetadata: unknown,
): ActiveExecutionSessionHandle | null {
  const handle = parseExecutionSessionHandle(runMetadata)
    ?? parseExecutionSessionHandle(taskMetadata);

  if (!handle?.sessionRef || !handle.transport) {
    return null;
  }

  return handle;
}

function parseExecutionSessionHandle(value: unknown): ActiveExecutionSessionHandle | null {
  const record = toRecord(value);
  const candidate = toRecord(record.activeExecutionSession);
  const fallback = toRecord(record.executionSession);
  const metadata = Object.keys(candidate).length > 0 ? candidate : fallback;
  const sessionRef = asNonEmptyString(metadata.sessionRef)
    ?? asNonEmptyString(metadata.supervisorSessionRef)
    ?? asNonEmptyString(metadata.tmuxSessionName);
  const transport = asNonEmptyString(metadata.transport) ?? "supervisor";

  if (!sessionRef) {
    return null;
  }

  return {
    transport,
    sessionRef,
    lastActivityAt: asDateString(metadata.lastActivityAt),
    lastActivitySummary: asNonEmptyString(metadata.lastActivitySummary),
    contextSnapshot: toRecordOrNull(metadata.contextSnapshot),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  const record = toRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asDateString(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ── Built-in tmux terminator ──────────────────────────────────────────────────

registerExecutionSupervisorTerminator("tmux", async (input) => {
  const { sessionRef } = input.session;

  // Idempotent: if session already gone, return success.
  const exists = await hasSession(sessionRef);
  if (!exists) {
    return {
      transport: input.session.transport,
      sessionRef,
      terminatedAt: new Date().toISOString(),
      lastActivityAt: input.session.lastActivityAt,
      lastActivitySummary: input.session.lastActivitySummary,
      contextSnapshot: input.session.contextSnapshot,
    };
  }

  // Best-effort kill: if tmux is gone by now, treat as success.
  // External termination between hasSession and killSession is rare and benign.
  try {
    await killSession(sessionRef);
  } catch {
    // Session may have been externally cleaned up — this is acceptable.
  }

  return {
    transport: input.session.transport,
    sessionRef,
    terminatedAt: new Date().toISOString(),
    lastActivityAt: input.session.lastActivityAt,
    lastActivitySummary: input.session.lastActivitySummary,
    contextSnapshot: input.session.contextSnapshot,
  };
});
