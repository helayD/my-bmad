import { Prisma } from "@/generated/prisma/client";
import { buildTaskAuditEventData, TASK_AUDIT_EVENT_NAMES } from "@/lib/audit/events";
import { prisma } from "@/lib/db/client";
import { buildTaskRoutingDecisionSummary, resolveTaskRoutingDecision } from "@/lib/execution/routing";
import {
  resolveActiveExecutionSessionHandle,
  terminateActiveAgentRun,
  type TerminateActiveAgentRunResult,
} from "@/lib/execution/supervisor/termination";
import {
  TASK_AGENT_TYPE_LABELS,
  type TaskAgentRunView,
  type TaskAgentType,
  type TaskRoutingDecisionSummary,
} from "@/lib/tasks";
import { resolveTaskCurrentActivity } from "@/lib/tasks/tracking";
import { getProjectExecutionSettings } from "@/lib/projects/settings";
import { resolveWorkspaceGovernanceSettings } from "@/lib/workspace/settings";

const TASK_FOR_REDISPATCH_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  planningRequestId: true,
  sourceArtifactId: true,
  goal: true,
  summary: true,
  intent: true,
  intentDetail: true,
  preferredAgentType: true,
  status: true,
  currentStage: true,
  nextStep: true,
  currentAgentRunId: true,
  metadata: true,
  workspace: {
    select: {
      id: true,
      slug: true,
      settings: true,
    },
  },
  project: {
    select: {
      id: true,
      slug: true,
      settings: true,
    },
  },
  currentAgentRun: {
    select: {
      id: true,
      agentType: true,
      status: true,
      decisionSource: true,
      selectionReasonCode: true,
      selectionReasonSummary: true,
      matchedSignals: true,
      requestedByUserId: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      terminatedAt: true,
      supersededAt: true,
      terminationReasonCode: true,
      terminationReasonSummary: true,
      replacesRunId: true,
      metadata: true,
      replacementRun: {
        select: {
          id: true,
        },
      },
    },
  },
} satisfies Prisma.TaskSelect;

type TaskForRedispatch = Prisma.TaskGetPayload<{ select: typeof TASK_FOR_REDISPATCH_SELECT }>;

export interface RedispatchTaskInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  actorUserId: string;
  targetAgentType: TaskAgentType;
  expectedAgentRunId: string;
  reasonSummary: string;
  confirmRunningRedispatch: boolean;
}

export interface RedispatchTaskResult {
  taskId: string;
  status: string;
  currentStage: string;
  currentActivity: string;
  nextStep: string;
  routingDecision: TaskRoutingDecisionSummary;
  currentAgentRun: TaskAgentRunView;
  replacedAgentRunId: string;
  didTerminateActiveSession: boolean;
  planningRequestId: string | null;
  workspaceSlug: string;
  projectSlug: string;
}

export class RedispatchServiceError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "RedispatchServiceError";
  }
}

export async function redispatchTask(
  input: RedispatchTaskInput,
): Promise<RedispatchTaskResult> {
  const task = await prisma.task.findFirst({
    where: {
      id: input.taskId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    },
    select: TASK_FOR_REDISPATCH_SELECT,
  });

  if (!task) {
    throw new RedispatchServiceError("TASK_NOT_FOUND");
  }

  const currentRun = task.currentAgentRun;
  if (!currentRun) {
    throw new RedispatchServiceError("TASK_REDISPATCH_NOT_AVAILABLE");
  }

  if (task.currentAgentRunId !== input.expectedAgentRunId || currentRun.id !== input.expectedAgentRunId) {
    throw new RedispatchServiceError("TASK_REDISPATCH_CONFLICT");
  }

  if (currentRun.replacementRun?.id) {
    throw new RedispatchServiceError("TASK_REDISPATCH_CONFLICT");
  }

  if (normalizeTaskAgentType(currentRun.agentType) === input.targetAgentType) {
    throw new RedispatchServiceError("TASK_REDISPATCH_NOOP");
  }

  if (task.status !== "dispatched" && task.status !== "in-progress") {
    throw new RedispatchServiceError("TASK_REDISPATCH_NOT_AVAILABLE");
  }

  const workspaceSettings = resolveWorkspaceGovernanceSettings(task.workspace.settings);
  const routingDecision = resolveTaskRoutingDecision({
    task: {
      goal: task.goal,
      summary: task.summary,
      intent: task.intent,
      intentDetail: task.intentDetail,
      preferredAgentType: task.preferredAgentType,
      metadata: task.metadata,
    },
    workspaceSettings,
    projectSettings: getProjectExecutionSettings(task.project.settings),
    explicitAgentType: input.targetAgentType,
    reasonContext: "reroute",
  });

  if (routingDecision.kind !== "selected") {
    throw new RedispatchServiceError("TASK_AGENT_SELECTION_REQUIRED");
  }

  const isRunningRedispatch = task.status === "in-progress" || currentRun.status === "running";
  if (isRunningRedispatch && !input.confirmRunningRedispatch) {
    throw new RedispatchServiceError("TASK_RUNNING_REDISPATCH_CONFIRMATION_REQUIRED");
  }

  const currentActivityBefore = resolveTaskCurrentActivity(task);
  const taskMetadataBefore = toRecord(task.metadata);
  let terminationResult: TerminateActiveAgentRunResult | null = null;
  let preparedRunningRedispatch = false;

  if (isRunningRedispatch) {
    const activeExecutionSession = await resolveActiveExecutionSessionHandle(task.id, currentRun.id);
    if (!activeExecutionSession) {
      throw new RedispatchServiceError("TASK_RUNNING_REDISPATCH_PRECONDITION_MISSING");
    }

    await prisma.$transaction(async (tx) => {
      const claim = await tx.task.updateMany({
        where: {
          id: task.id,
          currentAgentRunId: input.expectedAgentRunId,
        },
        data: {
          metadata: mergeTaskMetadata(task.metadata, {
            currentActivity: "系统正在终止当前执行并准备重新派发。",
            redispatchPreparation: {
              requestedAt: new Date().toISOString(),
              requestedByUserId: input.actorUserId,
              targetAgentType: input.targetAgentType,
              expectedAgentRunId: input.expectedAgentRunId,
              reasonSummary: input.reasonSummary,
            },
          }) as Prisma.InputJsonValue,
        },
      });

      if (claim.count === 0) {
        throw new RedispatchServiceError("TASK_REDISPATCH_CONFLICT");
      }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    preparedRunningRedispatch = true;

    try {
      terminationResult = await terminateActiveAgentRun({
        taskId: task.id,
        agentRunId: currentRun.id,
        reasonCode: "manual-reroute",
        reasonSummary: input.reasonSummary,
        session: activeExecutionSession,
      });
    } catch (error) {
      await prisma.task.updateMany({
        where: {
          id: task.id,
          currentAgentRunId: input.expectedAgentRunId,
        },
        data: {
          metadata: {
            ...taskMetadataBefore,
            currentActivity: currentActivityBefore,
          } as Prisma.InputJsonValue,
        },
      });

      if (error instanceof RedispatchServiceError) {
        throw error;
      }

      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "EXECUTION_SESSION_TERMINATION_UNAVAILABLE";
      throw new RedispatchServiceError(code);
    }
  }

  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const existingReplacement = await tx.agentRun.findUnique({
        where: { replacesRunId: input.expectedAgentRunId },
        select: {
          id: true,
          agentType: true,
          status: true,
          decisionSource: true,
          selectionReasonCode: true,
          selectionReasonSummary: true,
          matchedSignals: true,
          requestedByUserId: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          terminatedAt: true,
          supersededAt: true,
          terminationReasonCode: true,
          terminationReasonSummary: true,
          replacesRunId: true,
          metadata: true,
          replacementRun: {
            select: { id: true },
          },
        },
      });

      if (existingReplacement) {
        return {
          taskId: task.id,
          status: "dispatched",
          currentStage: "已重新派发",
          currentActivity: "已重新派发，等待新会话启动。",
          nextStep: "等待新会话启动。",
          routingDecision: buildTaskRoutingDecisionSummary(routingDecision, {
            agentRunId: existingReplacement.id,
            replacedAgentRunId: currentRun.id,
            reroutedAt: now.toISOString(),
          }),
          currentAgentRun: mapAgentRunView(existingReplacement, existingReplacement.id),
          replacedAgentRunId: currentRun.id,
          didTerminateActiveSession: Boolean(terminationResult),
          planningRequestId: task.planningRequestId,
          workspaceSlug: task.workspace.slug,
          projectSlug: task.project.slug,
        };
      }

      const claim = await tx.task.updateMany({
        where: {
          id: task.id,
          currentAgentRunId: input.expectedAgentRunId,
        },
        data: {
          currentStage: task.currentStage,
        },
      });

      if (claim.count === 0) {
        throw new RedispatchServiceError("TASK_REDISPATCH_CONFLICT");
      }

      await tx.agentRun.update({
        where: { id: currentRun.id },
        data: {
          status: "superseded",
          supersededAt: now,
          terminatedAt: terminationResult ? new Date(terminationResult.terminatedAt) : undefined,
          terminationReasonCode: terminationResult ? "manual-reroute" : undefined,
          terminationReasonSummary: terminationResult
            ? input.reasonSummary
            : undefined,
          metadata: mergeRunMetadata(currentRun.metadata, {
            terminatedSession: terminationResult
              ? {
                  transport: terminationResult.transport,
                  sessionRef: terminationResult.sessionRef,
                  terminatedAt: terminationResult.terminatedAt,
                  lastActivityAt: terminationResult.lastActivityAt,
                  lastActivitySummary: terminationResult.lastActivitySummary,
                  contextSnapshot: terminationResult.contextSnapshot,
                }
              : null,
          }) as Prisma.InputJsonValue,
        },
      });

      const replacementRun = await tx.agentRun.create({
        data: {
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          agentType: routingDecision.selectedAgentType,
          status: "dispatched",
          decisionSource: routingDecision.decisionSource,
          selectionReasonCode: "manual-reroute",
          selectionReasonSummary: input.reasonSummary,
          matchedSignals: routingDecision.matchedSignals,
          requestedByUserId: input.actorUserId,
          replacesRunId: currentRun.id,
          metadata: {
            currentActivity: "已重新派发，等待新会话启动。",
            replacedAgentRunId: currentRun.id,
            reroutedFromAgentType: currentRun.agentType,
            lastTerminatedSession: terminationResult
              ? {
                  transport: terminationResult.transport,
                  sessionRef: terminationResult.sessionRef,
                  terminatedAt: terminationResult.terminatedAt,
                  lastActivityAt: terminationResult.lastActivityAt,
                  lastActivitySummary: terminationResult.lastActivitySummary,
                  contextSnapshot: terminationResult.contextSnapshot,
                }
              : null,
          } as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          agentType: true,
          status: true,
          decisionSource: true,
          selectionReasonCode: true,
          selectionReasonSummary: true,
          matchedSignals: true,
          requestedByUserId: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          terminatedAt: true,
          supersededAt: true,
          terminationReasonCode: true,
          terminationReasonSummary: true,
          replacesRunId: true,
          metadata: true,
          replacementRun: {
            select: { id: true },
          },
        },
      });

      const routingSummary = buildTaskRoutingDecisionSummary(routingDecision, {
        agentRunId: replacementRun.id,
        replacedAgentRunId: currentRun.id,
        reroutedAt: now.toISOString(),
      });

      await tx.task.update({
        where: { id: task.id },
        data: {
          status: "dispatched",
          currentStage: "已重新派发",
          nextStep: "等待新会话启动。",
          currentAgentRunId: replacementRun.id,
          metadata: mergeTaskMetadata(task.metadata, {
            currentActivity: "已重新派发，等待新会话启动。",
            agentType: routingDecision.selectedAgentType,
            agentTypeLabel: TASK_AGENT_TYPE_LABELS[routingDecision.selectedAgentType],
            routingDecision: routingSummary,
            activeExecutionSession: Prisma.JsonNull,
            lastRedispatch: {
              reroutedAt: now.toISOString(),
              replacedAgentRunId: currentRun.id,
              targetAgentType: routingDecision.selectedAgentType,
              reasonSummary: input.reasonSummary,
              terminatedActiveSession: Boolean(terminationResult),
            },
            redispatchPreparation: Prisma.JsonNull,
          }) as Prisma.InputJsonValue,
        },
      });

      await tx.auditEvent.create({
        data: buildTaskAuditEventData({
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          artifactId: task.sourceArtifactId,
          eventName: TASK_AUDIT_EVENT_NAMES.redispatched,
          occurredAt: now,
          payload: {
            taskId: task.id,
            previousStatus: task.status,
            nextStatus: "dispatched",
            agentRunId: replacementRun.id,
            replacedAgentRunId: currentRun.id,
            selectedAgentType: routingDecision.selectedAgentType,
            decisionSource: routingDecision.decisionSource,
            selectionReasonCode: "manual-reroute",
            selectionReasonSummary: input.reasonSummary,
            matchedSignals: routingDecision.matchedSignals,
            requestedByUserId: input.actorUserId,
            reasonSummary: input.reasonSummary,
            terminatedActiveSession: Boolean(terminationResult),
          },
        }),
      });

      await tx.auditEvent.create({
        data: buildTaskAuditEventData({
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          artifactId: task.sourceArtifactId,
          eventName: TASK_AUDIT_EVENT_NAMES.agentRunSuperseded,
          occurredAt: now,
          payload: {
            taskId: task.id,
            previousAgentRunId: currentRun.id,
            replacementAgentRunId: replacementRun.id,
            previousAgentType: currentRun.agentType,
            replacementAgentType: replacementRun.agentType,
            reasonSummary: input.reasonSummary,
            terminationReasonCode: terminationResult ? "manual-reroute" : null,
            terminationReasonSummary: terminationResult ? input.reasonSummary : null,
            terminatedActiveSession: Boolean(terminationResult),
            requestedByUserId: input.actorUserId,
          },
        }),
      });

      return {
        taskId: task.id,
        status: "dispatched",
        currentStage: "已重新派发",
        currentActivity: "已重新派发，等待新会话启动。",
        nextStep: "等待新会话启动。",
        routingDecision: routingSummary,
        currentAgentRun: mapAgentRunView(replacementRun, replacementRun.id),
        replacedAgentRunId: currentRun.id,
        didTerminateActiveSession: Boolean(terminationResult),
        planningRequestId: task.planningRequestId,
        workspaceSlug: task.workspace.slug,
        projectSlug: task.project.slug,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (error instanceof RedispatchServiceError) {
      throw error;
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
      && Array.isArray(error.meta?.target)
      && error.meta?.target.includes("replacesRunId")
    ) {
      throw new RedispatchServiceError("TASK_REDISPATCH_CONFLICT");
    }

    throw new RedispatchServiceError("TASK_REDISPATCH_ERROR");
  } finally {
    if (preparedRunningRedispatch && !terminationResult) {
      await prisma.task.updateMany({
        where: {
          id: task.id,
          currentAgentRunId: input.expectedAgentRunId,
        },
        data: {
          metadata: {
            ...taskMetadataBefore,
            currentActivity: currentActivityBefore,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
}

function mapAgentRunView(
  run: NonNullable<TaskForRedispatch["currentAgentRun"]>,
  currentAgentRunId: string | null,
): TaskAgentRunView {
  const agentType = normalizeTaskAgentType(run.agentType);

  return {
    id: run.id,
    agentType,
    agentTypeLabel: TASK_AGENT_TYPE_LABELS[agentType],
    status: normalizeTaskAgentRunStatus(run.status),
    statusLabel: normalizeTaskAgentRunStatusLabel(run.status),
    decisionSource: normalizeDecisionSource(run.decisionSource),
    selectionReasonCode: run.selectionReasonCode,
    selectionReasonSummary: run.selectionReasonSummary,
    matchedSignals: run.matchedSignals,
    requestedByUserId: run.requestedByUserId ?? null,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    terminatedAt: run.terminatedAt?.toISOString() ?? null,
    supersededAt: run.supersededAt?.toISOString() ?? null,
    terminationReasonCode: run.terminationReasonCode ?? null,
    terminationReasonSummary: run.terminationReasonSummary ?? null,
    replacesRunId: run.replacesRunId ?? null,
    replacementRunId: run.replacementRun?.id ?? null,
    isCurrent: currentAgentRunId === run.id,
    summary: resolveTaskCurrentActivity({ metadata: run.metadata }),
  };
}

function mergeTaskMetadata(
  currentMetadata: unknown,
  updates: Record<string, unknown>,
): Prisma.JsonObject {
  const base = toRecord(currentMetadata);
  const next = {
    ...base,
    ...updates,
  };

  if (next.activeExecutionSession === Prisma.JsonNull) {
    delete next.activeExecutionSession;
  }

  if (next.redispatchPreparation === Prisma.JsonNull) {
    delete next.redispatchPreparation;
  }

  return next as unknown as Prisma.JsonObject;
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

function normalizeTaskAgentType(value: string): TaskAgentType {
  return value === "claude-code" ? "claude-code" : "codex";
}

function normalizeTaskAgentRunStatus(value: string) {
  switch (value) {
    case "running":
    case "completed":
    case "failed":
    case "terminated":
    case "superseded":
      return value;
    default:
      return "dispatched";
  }
}

function normalizeTaskAgentRunStatusLabel(value: string): string {
  switch (value) {
    case "running":
      return "执行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "terminated":
      return "已终止";
    case "superseded":
      return "已替代";
    default:
      return "已派发";
  }
}

function normalizeDecisionSource(value: unknown) {
  switch (value) {
    case "manual-selection":
    case "task-preference":
    case "project-default":
    case "manual-reroute":
      return value;
    default:
      return "intent-heuristic";
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
