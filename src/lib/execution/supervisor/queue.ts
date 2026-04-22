/**
 * Execution queue management — persistent snapshots, ordering, and wait estimation.
 *
 * Key principles (§4.5 Task 1 & 2):
 * - Queue truth is stored in Task.metadata.executionQueue, not in-memory.
 * - Ordering is workspace-level stable FIFO by AgentRun.createdAt.
 * - A supervisor restart can reconstruct the queue from the DB.
 * - Wait estimates use historical ExecutionSession duration medians.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type {
  ConcurrencySnapshot,
  ExecutionQueueSnapshot,
} from "@/lib/tasks/types";
import { parseExecutionQueueSnapshot } from "./boundary";

// Re-export so consumers can import from either location.
export { parseExecutionQueueSnapshot };

/** Minimum completed sessions needed before we trust the median estimate */
const MEDIAN_SAMPLE_MIN = 3;

/** Default wait label when we don't have enough data */
const FALLBACK_WAIT_LABEL = "等待时间暂无法精确估算，系统会在空闲后自动启动。";

/**
 * Resolve a full concurrency snapshot for a given workspace + project.
 *
 * Active sessions are counted from ExecutionSession relations with status
 * "starting" or "running" — not from task status or in-memory counters.
 */
export async function resolveConcurrencySnapshot(
  workspaceId: string,
  projectId: string,
): Promise<ConcurrencySnapshot> {
  const [workspaceSettings, activeSessions] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    }),
    prisma.executionSession.findMany({
      where: {
        workspaceId,
        status: { in: ["starting", "running"] },
      },
      select: { id: true, projectId: true },
    }),
  ]);

  const maxConcurrentTasks = resolveMaxConcurrentTasks(workspaceSettings?.settings);
  const workspaceActive = activeSessions.length;
  const projectActive = activeSessions.filter((s) => s.projectId === projectId).length;
  const hasCapacity = workspaceActive < maxConcurrentTasks;

  // Count how many tasks are queued ahead of this project in the workspace FIFO.
  // "Queued" = dispatched task with executionQueue metadata, sorted by queuedAt.
  const queuedTasks = await prisma.task.findMany({
    where: {
      workspaceId,
      status: "dispatched",
    },
    select: {
      id: true,
      projectId: true,
      metadata: true,
    },
  });

  const queueAhead = queuedTasks
    .filter((t) => {
      if (t.projectId === projectId) return false;
      const snap = parseExecutionQueueSnapshot(t.metadata);
      return snap.queuePosition !== null;
    })
    .length;

  return {
    workspaceId,
    projectId,
    maxConcurrentTasks,
    workspaceActiveConcurrentTasks: workspaceActive,
    projectActiveConcurrentTasks: projectActive,
    hasCapacity,
    queueAhead,
  };
}

/**
 * Persist an executionQueue snapshot to Task.metadata.
 * Called during admission when a task is queued.
 */
export async function persistExecutionQueueSnapshot(
  taskId: string,
  snapshot: ExecutionQueueSnapshot,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { metadata: true },
  });
  if (!task) return;

  const current = toRecord(task.metadata);
  await prisma.task.update({
    where: { id: taskId },
    data: {
      metadata: {
        ...current,
        executionQueue: snapshot,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Clear the executionQueue snapshot from Task.metadata.
 * Called when a queued task is promoted or the queue entry becomes stale.
 */
export async function clearExecutionQueueSnapshot(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { metadata: true },
  });
  if (!task) return;

  const current = toRecord(task.metadata);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { executionQueue: _, ...rest } = current;
  await prisma.task.update({
    where: { id: taskId },
    data: {
      metadata: Object.keys(rest).length > 0 ? (rest as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

/**
 * Find the next task to promote in a given workspace's queue.
 * Returns the task with the earliest queuedAt (FIFO ordering), or null if the queue is empty.
 */
export async function resolveNextQueuedTask(workspaceId: string): Promise<{
  taskId: string;
  agentRunId: string;
  queuePosition: number;
} | null> {
  // Find all dispatched tasks in this workspace that have executionQueue metadata.
  const queuedTasks = await prisma.task.findMany({
    where: {
      workspaceId,
      status: "dispatched",
    },
    select: {
      id: true,
      currentAgentRunId: true,
      metadata: true,
    },
  });

  const withQueue = queuedTasks
    .map((t) => ({ task: t, snap: parseExecutionQueueSnapshot(t.metadata) }))
    .filter((r) => r.snap.queuePosition !== null && r.task.currentAgentRunId !== null)
    .sort((a, b) => {
      // FIFO: earlier queuedAt first
      const aTime = a.snap.queuedAt ?? "";
      const bTime = b.snap.queuedAt ?? "";
      if (aTime !== bTime) return aTime.localeCompare(bTime);
      // Tie-break: lower queuePosition first
      return (a.snap.queuePosition ?? 0) - (b.snap.queuePosition ?? 0);
    });

  if (withQueue.length === 0) return null;

  const next = withQueue[0];
  return {
    taskId: next.task.id,
    agentRunId: next.task.currentAgentRunId!,
    queuePosition: next.snap.queuePosition ?? 1,
  };
}

/**
 * Rebuild queue position for all queued tasks in a workspace after a slot is released.
 * This ensures positions are contiguous starting from 1.
 */
export async function rebuildQueuePositions(workspaceId: string): Promise<void> {
  const queuedTasks = await prisma.task.findMany({
    where: {
      workspaceId,
      status: "dispatched",
    },
    select: {
      id: true,
      metadata: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const withQueue = queuedTasks
    .map((t) => ({ id: t.id, snap: parseExecutionQueueSnapshot(t.metadata) }))
    .filter((r) => r.snap.queuePosition !== null);

  // Use a transaction to update all positions atomically.
  await prisma.$transaction(
    withQueue.map((item, index) => {
      const newPosition = index + 1;
      const updatedSnap: ExecutionQueueSnapshot = {
        ...item.snap,
        queuePosition: newPosition,
        estimatedWaitSeconds: estimateWaitSeconds(
          newPosition,
          item.snap.workspaceActiveConcurrentTasks,
          item.snap.maxConcurrentTasks,
          null,
        ),
        estimatedWaitLabel: estimateWaitLabel(
          newPosition,
          item.snap.workspaceActiveConcurrentTasks,
          item.snap.maxConcurrentTasks,
          null,
        ),
      };
      return prisma.task.update({
        where: { id: item.id },
        data: {
          metadata: {
            ...toRecord(
              queuedTasks.find((t) => t.id === item.id)?.metadata ?? null,
            ),
            executionQueue: updatedSnap,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Estimate wait time in seconds for a task at a given queue position.
 * Uses the median duration of recently completed sessions as a baseline,
 * or null if insufficient data AND the task cannot start immediately.
 */
export function estimateWaitSeconds(
  queuePosition: number,
  activeConcurrent: number,
  maxConcurrent: number,
  medianSessionDurationMs: number | null,
): number | null {
  if (queuePosition <= 0) return null;

  const slotsFree = Math.max(0, maxConcurrent - activeConcurrent);
  if (slotsFree >= queuePosition) return 0;

  // No median data and task must wait → cannot estimate
  if (medianSessionDurationMs === null) return null;

  // Each completed slot frees one slot; each active session holds one slot.
  // Estimate: each remaining slot (including active) takes medianSessionDurationMs.
  const remainingSlots = queuePosition - slotsFree;
  return Math.round((remainingSlots * medianSessionDurationMs) / 1000);
}

/**
 * Human-readable wait label based on queue position and active sessions.
 */
export function estimateWaitLabel(
  queuePosition: number,
  activeConcurrent: number,
  maxConcurrent: number,
  medianSessionDurationMs: number | null,
): string | null {
  const seconds = estimateWaitSeconds(queuePosition, activeConcurrent, maxConcurrent, medianSessionDurationMs);

  // Slot is immediately available — can start right away
  if (seconds === 0) {
    return "系统将在空闲后立即启动此任务。";
  }

  // No median data to estimate wait time
  if (seconds === null) {
    return FALLBACK_WAIT_LABEL;
  }

  if (seconds < 60) {
    return `预计等待约 ${seconds} 秒。`;
  }
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `预计等待约 ${minutes} 分钟。`;
  }
  const hours = Math.round(seconds / 3600);
  return `预计等待约 ${hours} 小时。`;
}

/**
 * Get median session duration from recent completed sessions for a project.
 * Returns null if fewer than MEDIAN_SAMPLE_MIN samples are available.
 */
export async function resolveMedianSessionDurationMs(
  workspaceId: string,
): Promise<number | null> {
  const sessions = await prisma.executionSession.findMany({
    where: {
      workspaceId,
      status: "completed",
      completedAt: { not: null },
      startedAt: { not: null },
    },
    select: { startedAt: true, completedAt: true },
    orderBy: { completedAt: "desc" },
    take: 50,
  });

  const durations = sessions
    .map((s) => {
      if (!s.startedAt || !s.completedAt) return null;
      return s.completedAt.getTime() - s.startedAt.getTime();
    })
    .filter((d): d is number => d !== null && d > 0);

  if (durations.length < MEDIAN_SAMPLE_MIN) return null;

  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 === 0
    ? Math.round((durations[mid - 1] + durations[mid]) / 2)
    : durations[mid];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function resolveMaxConcurrentTasks(settings: unknown): number {
  const record = toRecord(settings);
  const value = record?.maxConcurrentTasks;
  if (typeof value === "number" && value >= 1 && value <= 50) {
    return value;
  }
  return 5; // DEFAULT_WORKSPACE_GOVERNANCE_SETTINGS.maxConcurrentTasks
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
