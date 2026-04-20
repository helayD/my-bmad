/**
 * Execution admission orchestration — coordinates capacity check, queue management,
 * and the actual session launch through launchTask().
 *
 * This is the single entry point for starting a task execution.
 * It handles:
 * 1. Capacity admission (can this task start now, or must it queue?)
 * 2. Queue persistence (if queuing, write the snapshot to Task.metadata)
 * 3. Session launch (if admitted, delegate to launchTask())
 * 4. Auto-promotion trigger (when a slot frees up, queue the next waiting task)
 *
 * Two-phase contract (§4.5 Task 2.4):
 * - Phase 1: admission claim + queue snapshot persistence (short serializable tx)
 * - Phase 2: tmux session creation + session truth commit (outside tx)
 * - Auto-promotion: triggered after endSession() releases a slot
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { buildExecutionSessionAuditEventData, EXECUTION_SESSION_AUDIT_EVENT_NAMES } from "@/lib/audit/events";
import { buildExecutionQueueAuditEventData, EXECUTION_QUEUE_AUDIT_EVENT_NAMES } from "@/lib/audit/events";
import {
  admitTask,
  promoteNextQueuedTask,
  type AdmissionResult,
} from "./capacity";
import {
  persistExecutionQueueSnapshot,
  clearExecutionQueueSnapshot,
  rebuildQueuePositions,
  parseExecutionQueueSnapshot,
} from "./queue";
import { launchTask, type LaunchTaskResult } from "./launch";
import type { ExecutionQueueSnapshot } from "@/lib/tasks/types";

export class AdmissionServiceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AdmissionServiceError";
  }
}

export interface StartTaskInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  sourceArtifactId?: string | null;
}

export type StartTaskResult =
  | { status: "launched"; result: LaunchTaskResult; concurrency: AdmittedConcurrencyInfo }
  | { status: "queued"; queueSnapshot: ExecutionQueueSnapshot; concurrency: QueuedConcurrencyInfo }
  | { status: "idempotent"; queueSnapshot: ExecutionQueueSnapshot; concurrency: QueuedConcurrencyInfo };

export interface AdmittedConcurrencyInfo {
  workspaceActiveConcurrentTasks: number;
  projectActiveConcurrentTasks: number;
  maxConcurrentTasks: number;
}

export interface QueuedConcurrencyInfo {
  workspaceActiveConcurrentTasks: number;
  projectActiveConcurrentTasks: number;
  maxConcurrentTasks: number;
  queuePosition: number;
  estimatedWaitLabel: string | null;
}

/**
 * Start a task: attempt admission, and if admitted, launch the session.
 *
 * This is the unified entry point called by Server Actions.
 */
export async function startTask(input: StartTaskInput): Promise<StartTaskResult> {
  const { workspaceId, projectId, taskId } = input;

  // Load task to get currentAgentRunId.
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId, projectId },
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      status: true,
      currentAgentRunId: true,
      sourceArtifactId: true,
    },
  });

  if (!task) {
    throw new AdmissionServiceError("ADMISSION_TASK_NOT_FOUND", "找不到指定的任务记录。");
  }

  if (!task.currentAgentRunId) {
    throw new AdmissionServiceError("ADMISSION_NO_RUN", "当前任务还没有可启动的 Agent Run。");
  }

  if (task.status !== "dispatched") {
    throw new AdmissionServiceError(
      "ADMISSION_NOT_DISPATCHED",
      `当前任务状态为「${task.status}」，还不能启动执行会话。`,
    );
  }

  // Phase 1: admission claim.
  const admission = await admitTask({
    workspaceId,
    projectId,
    taskId,
    agentRunId: task.currentAgentRunId,
  });

  if (admission.outcome === "idempotent") {
    return {
      status: "idempotent",
      queueSnapshot: admission.queueSnapshot,
      concurrency: buildQueuedConcurrencyInfo(admission.concurrencySnapshot, admission.queueSnapshot),
    };
  }

  if (admission.outcome === "queued") {
    // Phase 1b: persist queue snapshot and audit.
    await recordQueueEnqueue(task, admission.concurrencySnapshot, admission.queueSnapshot);
    return {
      status: "queued",
      queueSnapshot: admission.queueSnapshot,
      concurrency: buildQueuedConcurrencyInfo(admission.concurrencySnapshot, admission.queueSnapshot),
    };
  }

  // Phase 2: launch the session (outside transaction).
  let launchResult: LaunchTaskResult;
  try {
    launchResult = await launchTask({
      workspaceId,
      projectId,
      taskId,
      agentRunId: task.currentAgentRunId,
      sourceArtifactId: task.sourceArtifactId ?? undefined,
    });
  } catch (error) {
    // Launch failed — ensure queue snapshot is cleared if one was partially written.
    await clearExecutionQueueSnapshot(taskId);
    throw error;
  }

  // Record audit: task was dequeued and launched.
  await recordQueueDequeue(task, launchResult.executionSessionId);

  return {
    status: "launched",
    result: launchResult,
    concurrency: buildAdmittedConcurrencyInfo(admission.concurrencySnapshot),
  };
}

/**
 * Triggered after a session ends — promotes the next queued task if capacity is available.
 *
 * Call this from lifecycle.ts after endSession() completes.
 */
export async function onSessionEnded(workspaceId: string): Promise<void> {
  // Rebuild queue positions for all waiting tasks.
  await rebuildQueuePositions(workspaceId);

  // Try to promote the next task.
  const next = await promoteNextQueuedTask(workspaceId);
  if (!next) return;

  // Resolve the task's projectId from the task record.
  const promotedTask = await prisma.task.findUnique({
    where: { id: next.taskId },
    select: { projectId: true, sourceArtifactId: true },
  });
  if (!promotedTask) return;

  // Attempt to launch the promoted task.
  // Note: this recursively calls startTask() which will check capacity again.
  // The promoted task goes through the normal admission flow.
  try {
    await startTask({
      workspaceId,
      projectId: promotedTask.projectId,
      taskId: next.taskId,
      sourceArtifactId: promotedTask.sourceArtifactId,
    });
  } catch {
    // Auto-promotion failure is non-fatal — the task stays in the queue
    // and will be retried on the next slot release.
    console.warn(
      `[onSessionEnded] Auto-promotion failed for task=${next.taskId}. ` +
      "It will remain queued and retry on the next slot release.",
    );
  }
}

// ── Audit helpers ──────────────────────────────────────────────────────────────

async function recordQueueEnqueue(
  task: { id: string; workspaceId: string; projectId: string; sourceArtifactId: string | null },
  concurrency: { workspaceActiveConcurrentTasks: number; projectActiveConcurrentTasks: number; maxConcurrentTasks: number },
  snapshot: ExecutionQueueSnapshot,
): Promise<void> {
  const now = new Date();
  await prisma.auditEvent.create({
    data: buildExecutionQueueAuditEventData({
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      artifactId: task.sourceArtifactId,
      eventName: EXECUTION_QUEUE_AUDIT_EVENT_NAMES.enqueued,
      occurredAt: now,
      payload: {
        taskId: task.id,
        queuePosition: snapshot.queuePosition ?? 0,
        workspaceActiveConcurrentTasks: concurrency.workspaceActiveConcurrentTasks,
        projectActiveConcurrentTasks: concurrency.projectActiveConcurrentTasks,
        maxConcurrentTasks: concurrency.maxConcurrentTasks,
        queueReasonCode: snapshot.queueReasonCode,
        estimatedWaitSeconds: snapshot.estimatedWaitSeconds,
      },
    }),
  });
}

async function recordQueueDequeue(
  task: { id: string; workspaceId: string; projectId: string; sourceArtifactId: string | null },
  executionSessionId: string,
): Promise<void> {
  const now = new Date();
  await prisma.auditEvent.create({
    data: buildExecutionQueueAuditEventData({
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      artifactId: task.sourceArtifactId,
      eventName: EXECUTION_QUEUE_AUDIT_EVENT_NAMES.dequeued,
      occurredAt: now,
      payload: {
        taskId: task.id,
        executionSessionId,
        queuePosition: null,
        workspaceActiveConcurrentTasks: 0,
        projectActiveConcurrentTasks: 0,
        maxConcurrentTasks: 0,
        queueReasonCode: null,
        estimatedWaitSeconds: null,
      },
    }),
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildQueuedConcurrencyInfo(
  snapshot: { workspaceActiveConcurrentTasks: number; projectActiveConcurrentTasks: number; maxConcurrentTasks: number },
  queueSnapshot: ExecutionQueueSnapshot,
): QueuedConcurrencyInfo {
  return {
    workspaceActiveConcurrentTasks: snapshot.workspaceActiveConcurrentTasks,
    projectActiveConcurrentTasks: snapshot.projectActiveConcurrentTasks,
    maxConcurrentTasks: snapshot.maxConcurrentTasks,
    queuePosition: queueSnapshot.queuePosition ?? 0,
    estimatedWaitLabel: queueSnapshot.estimatedWaitLabel,
  };
}

function buildAdmittedConcurrencyInfo(
  snapshot: { workspaceActiveConcurrentTasks: number; projectActiveConcurrentTasks: number; maxConcurrentTasks: number },
): AdmittedConcurrencyInfo {
  return {
    workspaceActiveConcurrentTasks: snapshot.workspaceActiveConcurrentTasks,
    projectActiveConcurrentTasks: snapshot.projectActiveConcurrentTasks,
    maxConcurrentTasks: snapshot.maxConcurrentTasks,
  };
}
