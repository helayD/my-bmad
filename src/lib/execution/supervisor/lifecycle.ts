/**
 * Session lifecycle management — cleanup and status transitions.
 *
 * Responsibilities (§4.6):
 * - Normal completion: ExecutionSession.status → "completed", AgentRun.status → "completed".
 * - Termination (manual/system): ExecutionSession.status → "terminated", AgentRun.status → "terminated".
 * - Idempotent: if the session is already gone, record the transition gracefully without error.
 * - Clear activeExecutionSession summary from Task/AgentRun metadata.
 * - Trigger queue auto-promotion after slot release (§4.5 Task 2.6).
 *
 * This module is called by the executor-supervisor entrypoint when a session ends.
 * It does NOT implement automatic detection of session death — that is Epic 5's responsibility.
 */

import { Prisma } from "@/generated/prisma/client";
import { buildExecutionSessionAuditEventData, EXECUTION_SESSION_AUDIT_EVENT_NAMES } from "@/lib/audit/events";
import { prisma } from "@/lib/db/client";
import { killSession } from "@/lib/execution/tmux";
import { onSessionEnded } from "./admission";
import { isValidTransition } from "@/lib/execution/state-machine/validator";
import {
  getScheduler,
  unregisterScheduler,
  recordHeartbeat,
} from "@/lib/execution/heartbeat";
import { stopMonitor } from "@/lib/execution/monitor";

export class LifecycleServiceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LifecycleServiceError";
  }
}

export type SessionEndReason = "completed" | "terminated";

export interface EndSessionInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  agentRunId: string;
  reason: SessionEndReason;
  reasonCode?: string;
  reasonSummary?: string;
  sourceArtifactId?: string | null;
}

export interface EndSessionResult {
  executionSessionId: string;
  taskId: string;
  agentRunId: string;
  sessionName: string;
  reason: SessionEndReason;
  endedAt: string;
}

/**
 * End a session and update database truth.
 *
 * Idempotent: if the session no longer exists in tmux, we record the transition
 * and return success rather than leaving the DB stuck in "running".
 */
export async function endSession(input: EndSessionInput): Promise<EndSessionResult> {
  const now = new Date();

  // Find the active session by agentRunId.
  const session = await prisma.executionSession.findUnique({
    where: { agentRunId: input.agentRunId },
    select: {
      id: true,
      taskId: true,
      agentRunId: true,
      sessionName: true,
      status: true,
      processPid: true,
    },
  });

  if (!session) {
    throw new LifecycleServiceError("EXECUTION_SESSION_NOT_FOUND", "找不到对应的执行会话记录。");
  }

  if (session.status === "completed" || session.status === "terminated") {
    // Already ended — idempotent no-op.
    return {
      executionSessionId: session.id,
      taskId: session.taskId,
      agentRunId: session.agentRunId,
      sessionName: session.sessionName,
      reason: session.status as SessionEndReason,
      endedAt: now.toISOString(),
    };
  }

  // Stop the heartbeat scheduler and record final heartbeat.
  const scheduler = getScheduler(input.taskId);
  if (scheduler) {
    try {
      scheduler.stop();
    } catch {
      console.warn(`[endSession] scheduler.stop() failed for task ${input.taskId}`);
    }
    try {
      unregisterScheduler(input.taskId);
    } catch {
      console.warn(`[endSession] unregisterScheduler() failed for task ${input.taskId}`);
    }
  }
  stopMonitor(input.taskId);
  // Record the final heartbeat with termination status.
  const finalStatus = input.reason === "completed" ? "completed" : "terminated";
  try {
    await recordHeartbeat({
      executionSessionId: session.id,
      taskId: input.taskId,
      agentRunId: input.agentRunId,
      status: finalStatus,
      currentStage: input.reason === "completed" ? "已完成" : "已终止",
      currentActivity: input.reason === "completed"
        ? "执行会话已正常结束。"
        : `执行会话已被终止：${input.reasonSummary ?? ""}`,
    });
  } catch {
    // Best-effort: final heartbeat failure should not block session cleanup.
  }

  // Attempt tmux cleanup — best-effort; don't fail the DB transition.
  await killSession(session.sessionName).catch(() => { /* best-effort */ });

  const updateData = finalStatus === "completed"
    ? { completedAt: now }
    : { terminatedAt: now, terminationReasonCode: input.reasonCode, terminationReasonSummary: input.reasonSummary };

  await prisma.executionSession.update({
    where: { id: session.id },
    data: {
      status: finalStatus,
      ...updateData,
    },
  });

  // Fetch current AgentRun and Task metadata for merge.
  const [run, task] = await Promise.all([
    prisma.agentRun.findUnique({ where: { id: input.agentRunId }, select: { metadata: true } }),
    prisma.task.findUnique({
      where: { id: input.taskId },
      select: { metadata: true, status: true },
    }),
  ]);

  const runStatus = input.reason === "completed" ? "completed" : "terminated";
  const taskTargetStatus = input.reason === "completed" ? "completed" : "terminated";
  const auditEventName = input.reason === "completed"
    ? EXECUTION_SESSION_AUDIT_EVENT_NAMES.completed
    : EXECUTION_SESSION_AUDIT_EVENT_NAMES.terminated;
  const stateTransitionTrigger = input.reason === "completed" ? "agent_complete" : "agent_error";

  // Validate state machine transition.
  if (!isValidTransition(task?.status ?? "running", taskTargetStatus)) {
    const msg = `状态机拒绝：从「${task?.status ?? "?"}」不能转换到「${taskTargetStatus}」`;
    console.warn(`[endSession] ${msg}`);
    throw new LifecycleServiceError("INVALID_STATE_TRANSITION", msg);
  }

  await prisma.$transaction([
    prisma.agentRun.update({
      where: { id: input.agentRunId },
      data: {
        status: runStatus,
        ...(input.reason === "completed" ? { completedAt: now } : { terminatedAt: now }),
        metadata: mergeRunMetadata(run?.metadata, {
          currentActivity: input.reason === "completed"
            ? "执行会话已正常结束。"
            : `执行会话已被终止：${input.reasonSummary ?? input.reasonCode ?? ""}`,
          lastExecutionSession: {
            id: session.id,
            sessionName: session.sessionName,
            endedAt: now.toISOString(),
            reason: input.reason,
            reasonCode: input.reasonCode,
          },
          activeExecutionSession: Prisma.JsonNull,
        }) as Prisma.InputJsonValue,
      },
    }),
    prisma.task.update({
      where: { id: input.taskId },
      data: {
        status: taskTargetStatus,
        currentStage: input.reason === "completed" ? "已完成" : "已终止",
        currentActivity: input.reason === "completed"
          ? "执行会话已正常结束。"
          : `执行会话已被终止：${input.reasonSummary ?? ""}`,
        nextStep: input.reason === "completed"
          ? "执行已结束，等待结果整理。"
          : "执行已被终止，等待重新派发。",
        metadata: mergeTaskMetadata(task?.metadata, {
          currentActivity: input.reason === "completed"
            ? "执行会话已正常结束。"
            : `执行会话已被终止：${input.reasonSummary ?? ""}`,
          activeExecutionSession: Prisma.JsonNull,
        }) as Prisma.InputJsonValue,
      },
    }),
    prisma.taskStateEvent.create({
      data: {
        taskId: input.taskId,
        agentRunId: input.agentRunId,
        fromStatus: task?.status ?? "running",
        toStatus: taskTargetStatus,
        trigger: stateTransitionTrigger,
        reason: input.reasonSummary ?? input.reasonCode ?? null,
        actorType: input.reason === "completed" ? "system" : "agent",
        actorId: null,
        rejected: false,
      },
    }),
    prisma.auditEvent.create({
      data: buildExecutionSessionAuditEventData({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        taskId: input.taskId,
        artifactId: input.sourceArtifactId,
        eventName: auditEventName,
        occurredAt: now,
        payload: {
          executionSessionId: session.id,
          taskId: input.taskId,
          agentRunId: input.agentRunId,
          sessionName: session.sessionName,
          ...(input.reason === "completed"
            ? { terminationReasonCode: null, terminationReasonSummary: null }
            : { terminationReasonCode: input.reasonCode ?? "unknown", terminationReasonSummary: input.reasonSummary ?? "" }),
        },
      }),
    }),
  ], {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  // Trigger queue auto-promotion: when a slot frees up, pull the next queued task.
  // This is non-blocking and safe to do after the transaction commits.
  onSessionEnded(input.workspaceId).catch((err) => {
    console.warn(`[endSession] Queue auto-promotion failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  return {
    executionSessionId: session.id,
    taskId: input.taskId,
    agentRunId: input.agentRunId,
    sessionName: session.sessionName,
    reason: input.reason,
    endedAt: now.toISOString(),
  };
}

// ── Metadata helpers ──────────────────────────────────────────────────────────

function mergeTaskMetadata(
  currentMetadata: unknown,
  updates: Record<string, unknown>,
): Prisma.JsonObject {
  return {
    ...toRecord(currentMetadata),
    ...updates,
  } as unknown as Prisma.JsonObject;
}

function mergeRunMetadata(
  currentMetadata: unknown,
  updates: Record<string, unknown>,
): Prisma.JsonObject {
  return {
    ...toRecord(currentMetadata),
    ...updates,
  } as unknown as Prisma.JsonObject;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
