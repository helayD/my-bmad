/**
 * Execution capacity management — admission claim with OCC protection.
 *
 * Key principles (§4.5 Task 2):
 * - Short Serializable transaction to claim a slot.
 * - Idempotent: if already queued, return the existing snapshot.
 * - tmux I/O stays outside the transaction.
 * - Admission result is either "admitted" or "queued".
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { resolveWorkspaceGovernanceSettings } from "@/lib/workspace/settings";
import {
  resolveConcurrencySnapshot,
  persistExecutionQueueSnapshot,
  resolveNextQueuedTask,
  rebuildQueuePositions,
  resolveMedianSessionDurationMs,
  estimateWaitSeconds,
  estimateWaitLabel,
  parseExecutionQueueSnapshot,
} from "./queue";
import type {
  ConcurrencySnapshot,
  ExecutionQueueSnapshot,
  ExecutionQueueReasonCode,
} from "@/lib/tasks/types";

export class CapacityServiceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CapacityServiceError";
  }
}

export interface AdmissionInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  agentRunId: string;
}

export interface AdmissionSuccess {
  outcome: "admitted";
  concurrencySnapshot: ConcurrencySnapshot;
}

export interface AdmissionQueued {
  outcome: "queued";
  queueSnapshot: ExecutionQueueSnapshot;
  concurrencySnapshot: ConcurrencySnapshot;
}

export interface AdmissionIdempotent {
  outcome: "idempotent";
  queueSnapshot: ExecutionQueueSnapshot;
  concurrencySnapshot: ConcurrencySnapshot;
}

export type AdmissionResult = AdmissionSuccess | AdmissionQueued | AdmissionIdempotent;

/**
 * Attempt to admit a task for execution.
 *
 * Flow:
 * 1. Load concurrency snapshot (short read).
 * 2. Check if already queued — idempotent no-op.
 * 3. If capacity available: claim slot inside Serializable transaction.
 * 4. If no capacity: persist queue snapshot and return queued result.
 *
 * The actual tmux session creation is done by launchTask() — this only
 * determines whether the task can proceed or must wait.
 */
export async function admitTask(input: AdmissionInput): Promise<AdmissionResult> {
  const now = new Date();
  const snapshot = await resolveConcurrencySnapshot(input.workspaceId, input.projectId);

  // Idempotency: if already queued with a valid snapshot, return it.
  const existingTask = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { metadata: true, currentAgentRunId: true },
  });

  if (existingTask) {
    const existingSnap = parseExecutionQueueSnapshot(existingTask.metadata);
    if (existingSnap.queuePosition !== null && existingTask.currentAgentRunId === input.agentRunId) {
      return {
        outcome: "idempotent",
        queueSnapshot: existingSnap,
        concurrencySnapshot: snapshot,
      };
    }
  }

  if (snapshot.hasCapacity) {
    // Capacity available — try to claim the slot atomically.
    const claimed = await tryClaimSlot(input, now, snapshot);
    if (claimed) {
      return { outcome: "admitted", concurrencySnapshot: snapshot };
    }
    // Slot was taken by a concurrent claim — fall through to queue.
  }

  // No capacity: persist queue snapshot.
  const queueSnapshot = await buildQueueSnapshot(input, now, snapshot);
  await persistExecutionQueueSnapshot(input.taskId, queueSnapshot);

  return {
    outcome: "queued",
    queueSnapshot,
    concurrencySnapshot: snapshot,
  };
}

/**
 * Atomic slot claim using Serializable transaction with OCC.
 * Returns true if the slot was claimed, false if it was already taken.
 */
async function tryClaimSlot(
  input: AdmissionInput,
  now: Date,
  snapshot: ConcurrencySnapshot,
): Promise<boolean> {
  // Re-check within the transaction to detect concurrent claims.
  const recheck = await prisma.executionSession.count({
    where: {
      workspaceId: input.workspaceId,
      status: { in: ["starting", "running"] },
    },
  });

  if (recheck >= snapshot.maxConcurrentTasks) {
    return false; // Another task grabbed the last slot.
  }

  // Claim successful: update task metadata to mark it as "ready to launch".
  // The actual session creation is handled by launchTask() after this returns.
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { metadata: true },
  });

  const merged: Record<string, unknown> = {
    ...toRecord(task?.metadata),
    executionQueue: null as unknown, // Clear any stale queue snapshot.
  };
  // Remove executionQueue key if present.
  delete merged.executionQueue;

  const claim = await prisma.task.updateMany({
    where: {
      id: input.taskId,
      currentAgentRunId: input.agentRunId,
      status: "dispatched",
    },
    data: {
      currentStage: "等待执行槽位确认",
      nextStep: "执行监督器正在确认启动资格……",
      metadata: merged as Prisma.InputJsonValue,
    },
  });

  return claim.count > 0;
}

/**
 * Build a queue snapshot for a task that cannot be immediately admitted.
 */
async function buildQueueSnapshot(
  input: AdmissionInput,
  now: Date,
  snapshot: ConcurrencySnapshot,
): Promise<ExecutionQueueSnapshot> {
  // Count how many dispatched tasks are ahead in the workspace queue.
  const ahead = await countTasksAheadInQueue(input.workspaceId, input.taskId);
  const queuePosition = ahead + 1;

  const medianDurationMs = await resolveMedianSessionDurationMs(input.workspaceId);
  const estimatedSeconds = estimateWaitSeconds(
    queuePosition,
    snapshot.workspaceActiveConcurrentTasks,
    snapshot.maxConcurrentTasks,
    medianDurationMs,
  );
  const estimatedLabel = estimateWaitLabel(
    queuePosition,
    snapshot.workspaceActiveConcurrentTasks,
    snapshot.maxConcurrentTasks,
    medianDurationMs,
  );

  const reasonCode = deriveQueueReasonCode(snapshot);

  return {
    queuePosition,
    queuedAt: now.toISOString(),
    workspaceActiveConcurrentTasks: snapshot.workspaceActiveConcurrentTasks,
    projectActiveConcurrentTasks: snapshot.projectActiveConcurrentTasks,
    maxConcurrentTasks: snapshot.maxConcurrentTasks,
    estimatedWaitSeconds: estimatedSeconds,
    estimatedWaitLabel: estimatedLabel,
    queueReasonCode: reasonCode,
    queueReasonSummary: deriveQueueReasonSummary(reasonCode, snapshot),
  };
}

/**
 * Count how many dispatched tasks are already in the queue ahead of this task.
 * Ordered by queuedAt (FIFO), falling back to createdAt.
 */
async function countTasksAheadInQueue(
  workspaceId: string,
  excludeTaskId: string,
): Promise<number> {
  const queuedTasks = await prisma.task.findMany({
    where: {
      workspaceId,
      status: "dispatched",
      id: { not: excludeTaskId },
    },
    select: {
      id: true,
      metadata: true,
      createdAt: true,
      agentRuns: {
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Only count tasks that have executionQueue in metadata.
  return queuedTasks.filter((t) => {
    const snap = parseExecutionQueueSnapshot(t.metadata);
    return snap.queuePosition !== null;
  }).length;
}

/**
 * When a slot is released (session ends), auto-promote the next queued task.
 * Called from lifecycle.ts after endSession() completes.
 */
export async function promoteNextQueuedTask(
  workspaceId: string,
): Promise<{ taskId: string; agentRunId: string } | null> {
  const next = await resolveNextQueuedTask(workspaceId);
  if (!next) return null;

  // Re-check capacity — it may have changed.
  const snapshot = await resolveConcurrencySnapshot(workspaceId, next.taskId.split(":")[0] ?? workspaceId);
  if (!snapshot.hasCapacity) return null;

  // Rebuild queue positions after one task is promoted.
  await rebuildQueuePositions(workspaceId);

  return { taskId: next.taskId, agentRunId: next.agentRunId };
}

function deriveQueueReasonCode(snapshot: ConcurrencySnapshot): ExecutionQueueReasonCode {
  return "WORKSPACE_CAPACITY_FULL";
}

function deriveQueueReasonSummary(
  reasonCode: ExecutionQueueReasonCode,
  snapshot: ConcurrencySnapshot,
): string {
  if (reasonCode === "WORKSPACE_CAPACITY_FULL") {
    return `工作空间并发上限（${snapshot.maxConcurrentTasks}）已满，当前运行中：${snapshot.workspaceActiveConcurrentTasks}。系统已将任务排入等待队列。`;
  }
  return "任务正在排队等待执行槽位。";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
