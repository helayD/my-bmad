"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import {
  buildPlanningAuditEventData,
  PLANNING_AUDIT_EVENT_NAMES,
} from "@/lib/audit/events";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession, getWorkspaceById } from "@/lib/db/helpers";
import { sanitizeError } from "@/lib/errors";
import { executePlanningRequest } from "@/lib/planning/execution";
import {
  confirmPlanningRequestHandoff,
  getPlanningRequestHandoffPreview,
  PlanningHandoffServiceError,
} from "@/lib/planning/handoff";
import { analyzePlanningIntent } from "@/lib/planning/intent";
import {
  getPlanningRequestDetailById,
  getRecentPlanningRequestsByProjectId,
  mapPlanningRequestListItem,
  planningRequestListItemSelect,
} from "@/lib/planning/queries";
import {
  INITIAL_PLANNING_REQUEST_STATE,
  type PlanningRequestDetailView,
  type PlanningRequestListItem,
  DEFAULT_PLANNING_REQUEST_LIMIT,
  type PlanningHandoffPreview,
  validatePlanningGoal,
} from "@/lib/planning/types";
import type { ActionResult } from "@/lib/types";
import { requireProjectAccess } from "@/lib/workspace/permissions";
import { getGovernanceSettings } from "@/lib/workspace/update-workspace-settings";
import { toProjectRepoProviderConfig } from "@/lib/content-provider/project-provider";
import {
  PlanningArtifactWriteError,
} from "@/lib/planning/artifact-writer";
import { ProjectProviderError } from "@/lib/content-provider/project-provider";
import { TaskContextError } from "@/lib/tasks/context";

const planningRequestInputSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  rawGoal: z.string(),
});

const planningRequestListInputSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
});

const planningRequestAnalysisInputSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  planningRequestId: z.string().min(1),
});

const planningRequestExecuteInputSchema = planningRequestAnalysisInputSchema;
const planningRequestConfirmInputSchema = planningRequestAnalysisInputSchema.extend({
  deferredArtifactIds: z.array(z.string().min(1)).optional(),
});

interface PlanningRequestCreatePayload {
  request: PlanningRequestListItem;
}

interface PlanningRequestListPayload {
  requests: PlanningRequestListItem[];
}

interface PlanningRequestAnalyzePayload {
  request: PlanningRequestListItem;
  didAnalyze: boolean;
}

interface PlanningRequestDetailPayload {
  detail: PlanningRequestDetailView;
}

interface PlanningRequestExecutePayload {
  request: PlanningRequestListItem;
  didExecute: boolean;
}

interface PlanningRequestHandoffPreviewPayload {
  request: PlanningRequestListItem;
  preview: PlanningHandoffPreview;
}

interface PlanningRequestConfirmPayload {
  request: PlanningRequestListItem;
  didConfirm: boolean;
}

type PlanningRequestAnalysisInput = z.infer<typeof planningRequestAnalysisInputSchema>;

interface PlanningActionContext {
  workspaceSlug: string;
  projectSlug: string;
  projectName: string;
  hasRepo: boolean;
  repo: ReturnType<typeof toProjectRepoProviderConfig> | null;
}

type PlanningRequestRecord = Prisma.PlanningRequestGetPayload<{
  select: typeof planningRequestListItemSelect;
}>;

function toIsoDateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function havePlanningExecutionStepsChanged(
  previous: PlanningRequestRecord["executionSteps"],
  next: PlanningRequestRecord["executionSteps"],
): boolean {
  if (previous.length !== next.length) {
    return true;
  }

  return previous.some((step, index) => {
    const nextStep = next[index];
    if (!nextStep) {
      return true;
    }

    return (
      step.id !== nextStep.id
      || step.status !== nextStep.status
      || step.retryCount !== nextStep.retryCount
      || step.errorCode !== nextStep.errorCode
      || step.errorMessage !== nextStep.errorMessage
      || step.outputSummary !== nextStep.outputSummary
      || toIsoDateString(step.startedAt) !== toIsoDateString(nextStep.startedAt)
      || toIsoDateString(step.completedAt) !== toIsoDateString(nextStep.completedAt)
      || toIsoDateString(step.failedAt) !== toIsoDateString(nextStep.failedAt)
      || step.artifactPaths.join("\u0000") !== nextStep.artifactPaths.join("\u0000")
    );
  });
}

function didPlanningExecutionPersistState(
  previous: PlanningRequestRecord,
  next: PlanningRequestRecord,
): boolean {
  return (
    previous.status !== next.status
    || previous.generatedArtifactCount !== next.generatedArtifactCount
    || previous.lastExecutionErrorCode !== next.lastExecutionErrorCode
    || toIsoDateString(previous.executionStartedAt) !== toIsoDateString(next.executionStartedAt)
    || toIsoDateString(previous.executionCompletedAt) !== toIsoDateString(next.executionCompletedAt)
    || toIsoDateString(previous.executionFailedAt) !== toIsoDateString(next.executionFailedAt)
    || havePlanningExecutionStepsChanged(previous.executionSteps, next.executionSteps)
  );
}

async function loadPlanningActionContext(
  input: PlanningRequestAnalysisInput,
  userId: string,
): Promise<ActionResult<PlanningActionContext>> {
  const accessResult = await requireProjectAccess(
    input.workspaceId,
    input.projectId,
    userId,
    "execute",
  );
  if (!accessResult.success) {
    return accessResult;
  }

  const workspace = await getWorkspaceById(input.workspaceId);
  if (!workspace) {
    return {
      success: false,
      error: sanitizeError(null, "WORKSPACE_ACCESS_DENIED"),
      code: "WORKSPACE_ACCESS_DENIED",
    };
  }

  const project = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      workspaceId: input.workspaceId,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      repoId: true,
      repo: {
        select: {
          id: true,
          owner: true,
          name: true,
          branch: true,
          displayName: true,
          description: true,
          sourceType: true,
          localPath: true,
          lastSyncedAt: true,
        },
      },
    },
  });

  if (!project) {
    return {
      success: false,
      error: sanitizeError(null, "PROJECT_ACCESS_DENIED"),
      code: "PROJECT_ACCESS_DENIED",
    };
  }

  return {
    success: true,
    data: {
      workspaceSlug: workspace.slug,
      projectSlug: project.slug,
      projectName: project.name,
      hasRepo: Boolean(project.repoId),
      repo: project.repo ? toProjectRepoProviderConfig(project.repo) : null,
    },
  };
}

async function getPlanningRequestRecord(
  input: PlanningRequestAnalysisInput,
): Promise<PlanningRequestRecord | null> {
  return prisma.planningRequest.findFirst({
    where: {
      id: input.planningRequestId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    },
    select: planningRequestListItemSelect,
  });
}

function getProjectPath(context: PlanningActionContext): string {
  return `/workspace/${context.workspaceSlug}/project/${context.projectSlug}`;
}

async function markPlanningRequestAnalysisFailed(
  input: PlanningRequestAnalysisInput,
): Promise<void> {
  try {
    await prisma.planningRequest.updateMany({
      where: {
        id: input.planningRequestId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "analyzing",
      },
      data: {
        status: "failed",
        progressPercent: 100,
        nextStep: "分析失败，请重试；如果问题持续存在，请检查项目权限或数据库连接。",
        selectionReasonSummary: "分析失败：保存识别结果时出现问题。",
        analyzedAt: new Date(),
      },
    });
  } catch {
    // Best effort only: if this also fails, keep the original error surface.
  }
}

async function persistPlanningRequestAnalysis(
  input: PlanningRequestAnalysisInput,
  context: PlanningActionContext,
  request: PlanningRequestRecord,
): Promise<ActionResult<PlanningRequestAnalyzePayload>> {
  const occurredAt = new Date();
  const analysis = analyzePlanningIntent({
    rawGoal: request.rawGoal,
    hasRepo: context.hasRepo,
    projectSummary: context.projectName,
  });

  try {
    const updatedRecord = await prisma.$transaction(
      async (tx) => {
        const updateResult = await tx.planningRequest.updateMany({
          where: {
            id: input.planningRequestId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            status: "analyzing",
          },
          data: {
            status: analysis.status,
            progressPercent: analysis.progressPercent,
            nextStep: analysis.nextStep,
            routeType: analysis.routeType,
            selectionReasonCode: analysis.selectionReasonCode,
            selectionReasonSummary: analysis.selectionReasonSummary,
            selectedAgentKeys: analysis.selectedAgentKeys,
            selectedSkillKeys: analysis.selectedSkillKeys,
            analyzedAt: occurredAt,
            executionHandoffDraft: analysis.executionHandoffDraft
              ? (analysis.executionHandoffDraft as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
        });

        if (updateResult.count === 0) {
          return null;
        }

        await tx.auditEvent.create({
          data: buildPlanningAuditEventData({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            planningRequestId: input.planningRequestId,
            eventName: PLANNING_AUDIT_EVENT_NAMES.intentResolved,
            occurredAt,
            payload: {
              planningRequestId: input.planningRequestId,
              routeType: analysis.routeType,
              selectedAgentKeys: analysis.selectedAgentKeys,
              selectedSkillKeys: analysis.selectedSkillKeys,
              selectionReasonCode: analysis.selectionReasonCode,
              selectionReasonSummary: analysis.selectionReasonSummary,
              nextStep: analysis.nextStep,
            },
          }),
        });

        return tx.planningRequest.findUnique({
          where: { id: input.planningRequestId },
          select: planningRequestListItemSelect,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    if (!updatedRecord) {
      const latestRecord = await getPlanningRequestRecord(input);
      if (!latestRecord) {
        return {
          success: false,
          error: sanitizeError(null, "PLANNING_REQUEST_NOT_FOUND"),
          code: "PLANNING_REQUEST_NOT_FOUND",
        };
      }

      return {
        success: true,
        data: {
          request: mapPlanningRequestListItem(latestRecord),
          didAnalyze: false,
        },
      };
    }

    revalidatePath(getProjectPath(context));

    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(updatedRecord),
        didAnalyze: true,
      },
    };
  } catch (error) {
    await markPlanningRequestAnalysisFailed(input);
    revalidatePath(getProjectPath(context));

    return {
      success: false,
      error: sanitizeError(error, "PLANNING_REQUEST_ANALYZE_ERROR"),
      code: "PLANNING_REQUEST_ANALYZE_ERROR",
    };
  }
}

export async function createPlanningRequestAction(
  input: { workspaceId: string; projectId: string; rawGoal: string },
): Promise<ActionResult<PlanningRequestCreatePayload>> {
  const parsed = planningRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const accessResult = await requireProjectAccess(
    parsed.data.workspaceId,
    parsed.data.projectId,
    session.userId,
    "execute",
  );
  if (!accessResult.success) {
    return accessResult;
  }

  const goalValidation = validatePlanningGoal(parsed.data.rawGoal);
  if (!goalValidation.valid) {
    return {
      success: false,
      error: sanitizeError(null, goalValidation.code),
      code: goalValidation.code,
    };
  }

  try {
    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (!workspace) {
      return {
        success: false,
        error: sanitizeError(null, "WORKSPACE_ACCESS_DENIED"),
        code: "WORKSPACE_ACCESS_DENIED",
      };
    }

    const createdRequest = await prisma.planningRequest.create({
      data: {
        workspaceId: parsed.data.workspaceId,
        projectId: parsed.data.projectId,
        createdByUserId: session.userId,
        rawGoal: goalValidation.rawGoal,
        status: INITIAL_PLANNING_REQUEST_STATE.status,
        progressPercent: INITIAL_PLANNING_REQUEST_STATE.progressPercent,
        nextStep: INITIAL_PLANNING_REQUEST_STATE.nextStep,
        metadata: {
          source: "manual-goal-input",
        } as Prisma.InputJsonValue,
      },
      select: planningRequestListItemSelect,
    });

    revalidatePath(`/workspace/${workspace.slug}/project/${accessResult.data.project.slug}`);

    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(createdRequest),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: sanitizeError(error, "PLANNING_REQUEST_CREATE_ERROR"),
      code: "PLANNING_REQUEST_CREATE_ERROR",
    };
  }
}

export async function analyzePlanningRequestAction(
  input: { workspaceId: string; projectId: string; planningRequestId: string },
): Promise<ActionResult<PlanningRequestAnalyzePayload>> {
  const parsed = planningRequestAnalysisInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const contextResult = await loadPlanningActionContext(parsed.data, session.userId);
  if (!contextResult.success) {
    return contextResult;
  }

  const request = await getPlanningRequestRecord(parsed.data);
  if (!request) {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_NOT_FOUND"),
      code: "PLANNING_REQUEST_NOT_FOUND",
    };
  }

  if (request.status !== "analyzing") {
    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(request),
        didAnalyze: false,
      },
    };
  }

  return persistPlanningRequestAnalysis(parsed.data, contextResult.data, request);
}

export async function retryAnalyzePlanningRequestAction(
  input: { workspaceId: string; projectId: string; planningRequestId: string },
): Promise<ActionResult<PlanningRequestAnalyzePayload>> {
  const parsed = planningRequestAnalysisInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const contextResult = await loadPlanningActionContext(parsed.data, session.userId);
  if (!contextResult.success) {
    return contextResult;
  }

  const resetResult = await prisma.planningRequest.updateMany({
    where: {
      id: parsed.data.planningRequestId,
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId,
      status: "failed",
    },
    data: {
      status: INITIAL_PLANNING_REQUEST_STATE.status,
      progressPercent: INITIAL_PLANNING_REQUEST_STATE.progressPercent,
      nextStep: INITIAL_PLANNING_REQUEST_STATE.nextStep,
      routeType: null,
      selectionReasonCode: null,
      selectionReasonSummary: null,
      selectedAgentKeys: [],
      selectedSkillKeys: [],
      analyzedAt: null,
      executionHandoffDraft: Prisma.JsonNull,
    },
  });

  const request = await getPlanningRequestRecord(parsed.data);
  if (!request) {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_NOT_FOUND"),
      code: "PLANNING_REQUEST_NOT_FOUND",
    };
  }

  if (resetResult.count === 0 && request.status !== "analyzing") {
    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(request),
        didAnalyze: false,
      },
    };
  }

  return persistPlanningRequestAnalysis(parsed.data, contextResult.data, request);
}

export async function executePlanningRequestAction(
  input: { workspaceId: string; projectId: string; planningRequestId: string },
): Promise<ActionResult<PlanningRequestExecutePayload>> {
  const parsed = planningRequestExecuteInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const contextResult = await loadPlanningActionContext(parsed.data, session.userId);
  if (!contextResult.success) {
    return contextResult;
  }

  const request = await getPlanningRequestRecord(parsed.data);
  if (!request) {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_NOT_FOUND"),
      code: "PLANNING_REQUEST_NOT_FOUND",
    };
  }

  if (request.status === "analyzing") {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_EXECUTION_NOT_READY"),
      code: "PLANNING_REQUEST_EXECUTION_NOT_READY",
    };
  }

  if (request.routeType !== "planning" || request.selectedSkillKeys.length === 0) {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_EXECUTION_UNSUPPORTED"),
      code: "PLANNING_REQUEST_EXECUTION_UNSUPPORTED",
    };
  }

  if (!contextResult.data.repo) {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REPO_REQUIRED"),
      code: "PLANNING_REPO_REQUIRED",
    };
  }

  if (request.status === "awaiting-confirmation" || request.status === "completed") {
    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(request),
        didExecute: false,
      },
    };
  }

  if (
    request.status === "failed"
    && !request.executionSteps.some((step) => step.status === "failed")
  ) {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_RETRY_NOT_AVAILABLE"),
      code: "PLANNING_REQUEST_RETRY_NOT_AVAILABLE",
    };
  }

  try {
    const executionResult = await executePlanningRequest({
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId,
      planningRequestId: parsed.data.planningRequestId,
      projectName: contextResult.data.projectName,
      userId: session.userId,
      rawGoal: request.rawGoal,
      selectedSkillKeys: request.selectedSkillKeys,
      repo: contextResult.data.repo,
      executionStartedAt: request.executionStartedAt,
      artifactSummary: request.artifactSummary,
    });

    revalidatePath(getProjectPath(contextResult.data));
    const latestRequest = await getPlanningRequestRecord(parsed.data);

    if (!latestRequest) {
      return {
        success: false,
        error: sanitizeError(null, "PLANNING_REQUEST_NOT_FOUND"),
        code: "PLANNING_REQUEST_NOT_FOUND",
      };
    }

    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(latestRequest),
        didExecute: executionResult.didExecute,
      },
    };
  } catch (error) {
    revalidatePath(getProjectPath(contextResult.data));

    const latestRequest = await getPlanningRequestRecord(parsed.data);
    if (latestRequest && didPlanningExecutionPersistState(request, latestRequest)) {
      return {
        success: true,
        data: {
          request: mapPlanningRequestListItem(latestRequest),
          didExecute: false,
        },
      };
    }

    const code = error instanceof PlanningArtifactWriteError
      ? error.code
      : "PLANNING_REQUEST_EXECUTE_ERROR";

    return {
      success: false,
      error: sanitizeError(error, code),
      code,
    };
  }
}

export async function getPlanningRequestHandoffPreviewAction(
  input: { workspaceId: string; projectId: string; planningRequestId: string },
): Promise<ActionResult<PlanningRequestHandoffPreviewPayload>> {
  const parsed = planningRequestAnalysisInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const contextResult = await loadPlanningActionContext(parsed.data, session.userId);
  if (!contextResult.success) {
    return contextResult;
  }

  const request = await getPlanningRequestRecord(parsed.data);
  if (!request) {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_NOT_FOUND"),
      code: "PLANNING_REQUEST_NOT_FOUND",
    };
  }

  if (request.routeType !== "planning") {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_CONFIRMATION_UNSUPPORTED"),
      code: "PLANNING_REQUEST_CONFIRMATION_UNSUPPORTED",
    };
  }

  if (request.status !== "awaiting-confirmation") {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_CONFIRMATION_NOT_READY"),
      code: "PLANNING_REQUEST_CONFIRMATION_NOT_READY",
    };
  }

  try {
    const settings = await getGovernanceSettings(parsed.data.workspaceId);
    const preview = await getPlanningRequestHandoffPreview({
      projectId: parsed.data.projectId,
      planningRequest: {
        id: request.id,
        artifactSummary: request.artifactSummary,
      },
      settings,
    });

    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(request),
        preview,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: sanitizeError(error, "PLANNING_REQUEST_HANDOFF_PREVIEW_ERROR"),
      code: "PLANNING_REQUEST_HANDOFF_PREVIEW_ERROR",
    };
  }
}

export async function getPlanningRequestDetailAction(
  input: { workspaceId: string; projectId: string; planningRequestId: string },
): Promise<ActionResult<PlanningRequestDetailPayload>> {
  const parsed = planningRequestAnalysisInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const accessResult = await requireProjectAccess(
    parsed.data.workspaceId,
    parsed.data.projectId,
    session.userId,
    "read",
  );
  if (!accessResult.success) {
    return accessResult;
  }

  try {
    const detail = await getPlanningRequestDetailById(
      parsed.data.projectId,
      parsed.data.planningRequestId,
    );
    if (!detail) {
      return {
        success: false,
        error: sanitizeError(null, "PLANNING_REQUEST_NOT_FOUND"),
        code: "PLANNING_REQUEST_NOT_FOUND",
      };
    }

    return {
      success: true,
      data: {
        detail,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: sanitizeError(error, "PLANNING_REQUEST_DETAIL_ERROR"),
      code: "PLANNING_REQUEST_DETAIL_ERROR",
    };
  }
}

export async function confirmPlanningRequestAction(
  input: {
    workspaceId: string;
    projectId: string;
    planningRequestId: string;
    deferredArtifactIds?: string[];
  },
): Promise<ActionResult<PlanningRequestConfirmPayload>> {
  const parsed = planningRequestConfirmInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const contextResult = await loadPlanningActionContext(parsed.data, session.userId);
  if (!contextResult.success) {
    return contextResult;
  }

  const request = await getPlanningRequestRecord(parsed.data);
  if (!request) {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_NOT_FOUND"),
      code: "PLANNING_REQUEST_NOT_FOUND",
    };
  }

  if (request.routeType !== "planning") {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_CONFIRMATION_UNSUPPORTED"),
      code: "PLANNING_REQUEST_CONFIRMATION_UNSUPPORTED",
    };
  }

  if (request.status === "execution-ready" && request.taskHandoffSummary) {
    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(request),
        didConfirm: false,
      },
    };
  }

  if (request.status !== "awaiting-confirmation") {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REQUEST_CONFIRMATION_NOT_READY"),
      code: "PLANNING_REQUEST_CONFIRMATION_NOT_READY",
    };
  }

  if (!contextResult.data.repo) {
    return {
      success: false,
      error: sanitizeError(null, "PLANNING_REPO_REQUIRED"),
      code: "PLANNING_REPO_REQUIRED",
    };
  }

  try {
    const settings = await getGovernanceSettings(parsed.data.workspaceId);
    const handoffResult = await confirmPlanningRequestHandoff({
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId,
      planningRequestId: parsed.data.planningRequestId,
      actorUserId: session.userId,
      planningRequest: {
        id: request.id,
        artifactSummary: request.artifactSummary,
      },
      repo: contextResult.data.repo,
      settings,
      deferredArtifactIds: parsed.data.deferredArtifactIds ?? [],
    });

    revalidatePath(getProjectPath(contextResult.data));
    for (const taskId of handoffResult.createdTaskIds) {
      revalidatePath(
        `/workspace/${contextResult.data.workspaceSlug}/project/${contextResult.data.projectSlug}/tasks/${taskId}`,
      );
    }

    const latestRequest = await getPlanningRequestRecord(parsed.data);
    if (!latestRequest) {
      return {
        success: false,
        error: sanitizeError(null, "PLANNING_REQUEST_NOT_FOUND"),
        code: "PLANNING_REQUEST_NOT_FOUND",
      };
    }

    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(latestRequest),
        didConfirm: handoffResult.didConfirm,
      },
    };
  } catch (error) {
    if (
      error instanceof PlanningHandoffServiceError
      || error instanceof ProjectProviderError
      || error instanceof TaskContextError
    ) {
      return {
        success: false,
        error: sanitizeError(error, error.code),
        code: error.code,
      };
    }

    return {
      success: false,
      error: sanitizeError(error, "PLANNING_REQUEST_CONFIRM_ERROR"),
      code: "PLANNING_REQUEST_CONFIRM_ERROR",
    };
  }
}

export async function getPlanningRequestsAction(
  input: { workspaceId: string; projectId: string; limit?: number },
): Promise<ActionResult<PlanningRequestListPayload>> {
  const parsed = planningRequestListInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const accessResult = await requireProjectAccess(
    parsed.data.workspaceId,
    parsed.data.projectId,
    session.userId,
    "read",
  );
  if (!accessResult.success) {
    return accessResult;
  }

  try {
    const requests = await getRecentPlanningRequestsByProjectId(
      parsed.data.projectId,
      parsed.data.limit ?? DEFAULT_PLANNING_REQUEST_LIMIT,
    );

    return {
      success: true,
      data: {
        requests,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: sanitizeError(error, "PLANNING_REQUEST_LIST_ERROR"),
      code: "PLANNING_REQUEST_LIST_ERROR",
    };
  }
}
