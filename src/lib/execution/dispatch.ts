import { Prisma } from "@/generated/prisma/client";
import { buildTaskAuditEventData, TASK_AUDIT_EVENT_NAMES } from "@/lib/audit/events";
import { prisma } from "@/lib/db/client";
import { buildTaskRoutingDecisionSummary, resolveTaskRoutingDecision } from "@/lib/execution/routing";
import {
  isTaskApprovalRequiredForDispatch,
  TASK_AGENT_TYPE_LABELS,
  type TaskAgentRunView,
  type TaskAgentType,
  type TaskRoutingDecisionSummary,
} from "@/lib/tasks";
import { resolveTaskCurrentActivity } from "@/lib/tasks/tracking";
import { getProjectExecutionSettings } from "@/lib/projects/settings";
import { resolveWorkspaceGovernanceSettings } from "@/lib/workspace/settings";

const TASK_FOR_DISPATCH_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  planningRequestId: true,
  sourceArtifactId: true,
  title: true,
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
      replacementRun: {
        select: {
          id: true,
        },
      },
      metadata: true,
    },
  },
} satisfies Prisma.TaskSelect;

type TaskForDispatch = Prisma.TaskGetPayload<{ select: typeof TASK_FOR_DISPATCH_SELECT }>;

export interface DispatchTaskInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  actorUserId: string;
  agentType?: TaskAgentType;
}

export interface DispatchTaskResult {
  taskId: string;
  status: string;
  currentStage: string;
  currentActivity: string;
  nextStep: string;
  routingDecision: TaskRoutingDecisionSummary | null;
  currentAgentRun: TaskAgentRunView | null;
  selectionRequirement: {
    recommendedAgentType: TaskAgentType;
    recommendedAgentLabel: string;
    selectionReasonCode: string;
    selectionReasonSummary: string;
    matchedSignals: string[];
  } | null;
  selectionRequired: boolean;
  didDispatch: boolean;
  planningRequestId: string | null;
  workspaceSlug: string;
  projectSlug: string;
}

export class DispatchServiceError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "DispatchServiceError";
  }
}

export async function dispatchTask(
  input: DispatchTaskInput,
): Promise<DispatchTaskResult> {
  const task = await prisma.task.findFirst({
    where: {
      id: input.taskId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    },
    select: TASK_FOR_DISPATCH_SELECT,
  });

  if (!task) {
    throw new DispatchServiceError("TASK_NOT_FOUND");
  }

  if (task.currentAgentRun && task.status === "dispatched") {
    return {
      taskId: task.id,
      status: task.status,
      currentStage: task.currentStage,
      currentActivity: resolveTaskCurrentActivity(task),
      nextStep: task.nextStep,
      routingDecision: resolveRoutingDecisionFromMetadata(task.metadata),
      currentAgentRun: mapAgentRunView(task.currentAgentRun, task.currentAgentRunId),
      selectionRequirement: null,
      selectionRequired: false,
      didDispatch: false,
      planningRequestId: task.planningRequestId,
      workspaceSlug: task.workspace.slug,
      projectSlug: task.project.slug,
    };
  }

  if (task.status !== "planned") {
    throw new DispatchServiceError("TASK_DISPATCH_NOT_READY");
  }

  const workspaceSettings = resolveWorkspaceGovernanceSettings(task.workspace.settings);
  if (workspaceSettings.requireApprovalBeforeExecution || isTaskApprovalRequiredForDispatch(task.metadata)) {
    throw new DispatchServiceError("TASK_DISPATCH_NOT_READY");
  }

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
    explicitAgentType: input.agentType,
    reasonContext: "dispatch",
  });

  if (routingDecision.kind === "selection-required") {
    return {
      taskId: task.id,
      status: task.status,
      currentStage: task.currentStage,
      currentActivity: resolveTaskCurrentActivity(task),
      nextStep: task.nextStep,
      routingDecision: null,
      currentAgentRun: null,
      selectionRequirement: {
        recommendedAgentType: routingDecision.recommendedAgentType,
        recommendedAgentLabel: TASK_AGENT_TYPE_LABELS[routingDecision.recommendedAgentType],
        selectionReasonCode: routingDecision.selectionReasonCode,
        selectionReasonSummary: routingDecision.selectionReasonSummary,
        matchedSignals: routingDecision.matchedSignals,
      },
      selectionRequired: true,
      didDispatch: false,
      planningRequestId: task.planningRequestId,
      workspaceSlug: task.workspace.slug,
      projectSlug: task.project.slug,
    };
  }

  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await tx.task.updateMany({
        where: {
          id: task.id,
          status: "planned",
          currentAgentRunId: null,
        },
        data: {
          currentStage: task.currentStage,
        },
      });

      if (claim.count === 0) {
        throw new DispatchServiceError("TASK_ALREADY_DISPATCHED");
      }

      const createdRun = await tx.agentRun.create({
        data: {
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          agentType: routingDecision.selectedAgentType,
          status: "dispatched",
          decisionSource: routingDecision.decisionSource,
          selectionReasonCode: routingDecision.selectionReasonCode,
          selectionReasonSummary: routingDecision.selectionReasonSummary,
          matchedSignals: routingDecision.matchedSignals,
          requestedByUserId: input.actorUserId,
          metadata: {
            currentActivity: "已完成 Agent 路由，等待执行监督器创建会话并启动。",
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
          replacementRun: {
            select: { id: true },
          },
          metadata: true,
        },
      });

      const routingSummary = buildTaskRoutingDecisionSummary(routingDecision, {
        agentRunId: createdRun.id,
        routedAt: now.toISOString(),
      });

      const nextMetadata = mergeTaskMetadata(task.metadata, {
        currentActivity: "已完成 Agent 路由，等待执行监督器创建会话并启动。",
        agentType: routingDecision.selectedAgentType,
        agentTypeLabel: TASK_AGENT_TYPE_LABELS[routingDecision.selectedAgentType],
        routingDecision: routingSummary,
      });

      await tx.task.update({
        where: { id: task.id },
        data: {
          status: "dispatched",
          currentStage: "已派发",
          nextStep: "等待执行监督器创建会话并启动。",
          currentAgentRunId: createdRun.id,
          metadata: nextMetadata as Prisma.InputJsonValue,
        },
      });

      await tx.auditEvent.create({
        data: buildTaskAuditEventData({
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          artifactId: task.sourceArtifactId,
          eventName: TASK_AUDIT_EVENT_NAMES.routed,
          occurredAt: now,
          payload: {
            taskId: task.id,
            previousStatus: task.status,
            nextStatus: "dispatched",
            agentRunId: createdRun.id,
            selectedAgentType: routingDecision.selectedAgentType,
            decisionSource: routingDecision.decisionSource,
            selectionReasonCode: routingDecision.selectionReasonCode,
            selectionReasonSummary: routingDecision.selectionReasonSummary,
            matchedSignals: routingDecision.matchedSignals,
            requestedByUserId: input.actorUserId,
          },
        }),
      });

      return {
        taskId: task.id,
        status: "dispatched",
        currentStage: "已派发",
        currentActivity: "已完成 Agent 路由，等待执行监督器创建会话并启动。",
        nextStep: "等待执行监督器创建会话并启动。",
        routingDecision: routingSummary,
        currentAgentRun: mapAgentRunView(createdRun, createdRun.id),
        selectionRequirement: null,
        selectionRequired: false,
        didDispatch: true,
        planningRequestId: task.planningRequestId,
        workspaceSlug: task.workspace.slug,
        projectSlug: task.project.slug,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (error instanceof DispatchServiceError) {
      throw error;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new DispatchServiceError("TASK_ALREADY_DISPATCHED");
    }

    throw new DispatchServiceError("TASK_DISPATCH_ERROR");
  }
}

function mapAgentRunView(
  run: NonNullable<TaskForDispatch["currentAgentRun"]>,
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

function resolveRoutingDecisionFromMetadata(metadata: unknown): TaskRoutingDecisionSummary | null {
  const routingDecision = toRecord(toRecord(metadata).routingDecision);
  const selectedAgentType = routingDecision.selectedAgentType;
  if (selectedAgentType !== "codex" && selectedAgentType !== "claude-code") {
    return null;
  }

  return {
    selectedAgentType,
    decisionSource: normalizeDecisionSource(routingDecision.decisionSource),
    selectionReasonCode: asNonEmptyString(routingDecision.selectionReasonCode) ?? "unknown",
    selectionReasonSummary: asNonEmptyString(routingDecision.selectionReasonSummary) ?? "系统已完成 Agent 路由。",
    matchedSignals: asStringArray(routingDecision.matchedSignals),
    agentRunId: asNonEmptyString(routingDecision.agentRunId),
    replacedAgentRunId: asNonEmptyString(routingDecision.replacedAgentRunId),
    routedAt: asDateString(routingDecision.routedAt),
    reroutedAt: asDateString(routingDecision.reroutedAt),
  };
}

function mergeTaskMetadata(
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

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = asNonEmptyString(item);
        return parsed ? [parsed] : [];
      })
    : [];
}

function asDateString(value: unknown): string | null {
  const parsed = asNonEmptyString(value);
  if (!parsed) {
    return null;
  }

  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
