"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { buildTaskAuditEventData, TASK_AUDIT_EVENT_NAMES } from "@/lib/audit/events";
import {
  getAuthenticatedSession,
  getProjectArtifacts,
  getTaskHistoryCandidatesByProjectId,
  getWorkspaceById,
} from "@/lib/db/helpers";
import { sanitizeError } from "@/lib/errors";
import {
  createProjectContentProvider,
  ProjectProviderError,
  toProjectRepoProviderConfig,
} from "@/lib/content-provider/project-provider";
import { buildTaskCreationContext, TaskContextError } from "@/lib/tasks/context";
import { buildTaskTitleFromGoal, getManualTaskLifecycle } from "@/lib/tasks/defaults";
import {
  buildTaskSourceContextSnapshot,
  buildArtifactTaskHistoryPayload,
  filterArtifactTaskHistoryTasks,
  type ArtifactTaskHistoryPayload,
} from "@/lib/tasks/tracking";
import { applyTaskTerminalStateWriteback, WritebackServiceError } from "@/lib/execution/writeback";
import {
  TASK_STATUS_VALUES,
  TASK_TERMINAL_STATUS_VALUES,
  taskCreateInputSchema,
  type CreatedTaskPayload,
  type TaskCreateInput,
  type TaskCreationContext,
  type TaskTerminalStateUpdateInput,
  type TaskTerminalStateUpdateResult,
} from "@/lib/tasks/types";
import { requireProjectAccess } from "@/lib/workspace/permissions";
import { resolveWorkspaceGovernanceSettings } from "@/lib/workspace/settings";
import type { ActionResult } from "@/lib/types";

const taskContextParamsSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  artifactId: z.string().cuid2(),
});

const artifactTaskHistorySchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  artifactId: z.string().cuid2(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
});

const updateTaskTerminalStateSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  taskId: z.string().cuid2(),
  status: z.enum(TASK_TERMINAL_STATUS_VALUES),
  currentStage: z.string().trim().min(1).max(120),
  nextStep: z.string().trim().min(1).max(240),
  currentActivity: z.string().trim().min(1).max(240).optional(),
  resultSummary: z.string().trim().min(1).max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function getArtifactTaskHistoryAction(
  input: { workspaceId: string; projectId: string; artifactId: string; status?: string },
): Promise<ActionResult<ArtifactTaskHistoryPayload>> {
  const parsed = artifactTaskHistorySchema.safeParse(input);
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
    const artifact = await prisma.bmadArtifact.findFirst({
      where: {
        id: parsed.data.artifactId,
        projectId: parsed.data.projectId,
      },
      select: {
        id: true,
        type: true,
        name: true,
        filePath: true,
        parentId: true,
        metadata: true,
      },
    });

    if (!artifact) {
      return { success: false, error: sanitizeError(null, "ARTIFACT_NOT_FOUND"), code: "ARTIFACT_NOT_FOUND" };
    }

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (!workspace) {
      return { success: false, error: sanitizeError(null, "WORKSPACE_ACCESS_DENIED"), code: "WORKSPACE_ACCESS_DENIED" };
    }

    if (artifact.type !== "STORY" && artifact.type !== "EPIC") {
      return {
        success: true,
        data: buildArtifactTaskHistoryPayload({
          artifact,
          tasks: [],
          workspaceSlug: workspace.slug,
          projectSlug: accessResult.data.project.slug,
        }),
      };
    }

    const allArtifacts = artifact.type === "EPIC"
      ? await getProjectArtifacts(parsed.data.projectId)
      : [artifact];
    const taskCandidates = await getTaskHistoryCandidatesByProjectId(
      parsed.data.projectId,
      artifact.type === "STORY" ? parsed.data.status : undefined,
    );
    const tasks = filterArtifactTaskHistoryTasks({
      artifact,
      allArtifacts,
      tasks: taskCandidates,
    });

    return {
      success: true,
      data: buildArtifactTaskHistoryPayload({
        artifact,
        allArtifacts,
        tasks,
        workspaceSlug: workspace.slug,
        projectSlug: accessResult.data.project.slug,
      }),
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}

export async function getTaskCreationContextAction(
  workspaceId: string,
  projectId: string,
  artifactId: string,
): Promise<ActionResult<TaskCreationContext>> {
  const parsed = taskContextParamsSchema.safeParse({ workspaceId, projectId, artifactId });
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
    const artifact = await prisma.bmadArtifact.findFirst({
      where: { id: parsed.data.artifactId, projectId: parsed.data.projectId, status: "active" },
      include: {
        parent: {
          include: {
            parent: {
              include: {
                parent: true,
              },
            },
          },
        },
      },
    });

    if (!artifact) {
      return { success: false, error: sanitizeError(null, "ARTIFACT_SOURCE_NOT_FOUND"), code: "ARTIFACT_SOURCE_NOT_FOUND" };
    }

    const project = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, workspaceId: parsed.data.workspaceId },
      include: {
        repo: true,
        workspace: {
          select: { slug: true },
        },
      },
    });

    if (!project) {
      return { success: false, error: sanitizeError(null, "PROJECT_ACCESS_DENIED"), code: "PROJECT_ACCESS_DENIED" };
    }

    const provider = project.repo
      ? await createProjectContentProvider(toProjectRepoProviderConfig(project.repo), session.userId)
      : undefined;

    const context = await buildTaskCreationContext(artifact, provider);
    return { success: true, data: context };
  } catch (error) {
    if (error instanceof TaskContextError || error instanceof ProjectProviderError) {
      return { success: false, error: sanitizeError(null, error.code), code: error.code };
    }

    return { success: false, error: sanitizeError(error, "ARTIFACT_CONTEXT_ERROR"), code: "ARTIFACT_CONTEXT_ERROR" };
  }
}

export async function createTaskAction(
  input: TaskCreateInput,
): Promise<ActionResult<CreatedTaskPayload>> {
  const parsed = taskCreateInputSchema.safeParse(input);
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

  try {
    const project = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, workspaceId: parsed.data.workspaceId },
      include: {
        repo: true,
        workspace: {
          select: { slug: true, settings: true },
        },
      },
    });

    if (!project) {
      return { success: false, error: sanitizeError(null, "PROJECT_ACCESS_DENIED"), code: "PROJECT_ACCESS_DENIED" };
    }

    let artifact: Awaited<ReturnType<typeof prisma.bmadArtifact.findFirst>> = null;
    if (parsed.data.artifactId) {
      artifact = await prisma.bmadArtifact.findFirst({
        where: { id: parsed.data.artifactId, projectId: parsed.data.projectId, status: "active" },
        include: {
          parent: {
            include: {
              parent: {
                include: {
                  parent: true,
                },
              },
            },
          },
        },
      });
    }

    if (parsed.data.artifactId && !artifact) {
      return { success: false, error: sanitizeError(null, "ARTIFACT_SOURCE_NOT_FOUND"), code: "ARTIFACT_SOURCE_NOT_FOUND" };
    }

    const provider = project.repo && artifact
      ? await createProjectContentProvider(toProjectRepoProviderConfig(project.repo), session.userId)
      : undefined;

    const context = artifact ? await buildTaskCreationContext(artifact, provider) : null;
    const workspaceSettings = resolveWorkspaceGovernanceSettings(project.workspace.settings);
    const lifecycle = getManualTaskLifecycle({
      requireApprovalBeforeExecution: workspaceSettings.requireApprovalBeforeExecution,
    });
    const sourceContext = context
      ? buildTaskSourceContextSnapshot(context.sourceArtifact, {
          acceptanceCriteria: context.acceptanceCriteria,
          relatedStoryIds: context.relatedStoryIds,
        })
      : null;
    const metadata = {
      currentActivity: lifecycle.currentActivity,
      ...(sourceContext ? { sourceContext } : { creationMode: "manual-project" }),
    } satisfies Record<string, unknown>;
    const title = parsed.data.title ?? buildTaskTitleFromGoal({
      goal: parsed.data.goal,
      sourceArtifactName: context?.sourceArtifact.artifactName ?? null,
    });
    const summary = context?.summary ?? "该任务由用户在项目上下文中手动创建，当前尚未关联来源工件。";
    const occurredAt = new Date();

    const task = await prisma.$transaction(async (tx) => {
      const createdTask = await tx.task.create({
        data: {
          workspaceId: parsed.data.workspaceId,
          projectId: parsed.data.projectId,
          sourceArtifactId: artifact?.id ?? null,
          title,
          goal: parsed.data.goal,
          summary,
          priority: parsed.data.priority,
          intent: parsed.data.intent,
          intentDetail: parsed.data.intentDetail ?? null,
          preferredAgentType: parsed.data.preferredAgentType ?? null,
          status: lifecycle.status,
          currentStage: lifecycle.currentStage,
          nextStep: lifecycle.nextStep,
          metadata: metadata as Prisma.InputJsonValue,
          createdByUserId: session.userId,
        },
      });

      await tx.auditEvent.create({
        data: buildTaskAuditEventData({
          workspaceId: parsed.data.workspaceId,
          projectId: parsed.data.projectId,
          taskId: createdTask.id,
          artifactId: artifact?.id ?? null,
          eventName: TASK_AUDIT_EVENT_NAMES.created,
          occurredAt,
          payload: {
            taskId: createdTask.id,
            workspaceId: parsed.data.workspaceId,
            projectId: parsed.data.projectId,
            sourceArtifactId: artifact?.id ?? null,
            priority: parsed.data.priority,
            intent: parsed.data.intent,
            intentDetail: parsed.data.intentDetail ?? null,
            preferredAgentType: parsed.data.preferredAgentType ?? null,
            createdByUserId: session.userId,
          },
        }),
      });

      return createdTask;
    });

    revalidatePath(`/workspace/${project.workspace.slug}`);
    revalidatePath(`/workspace/${project.workspace.slug}/project/${project.slug}`);
    revalidatePath(`/workspace/${project.workspace.slug}/project/${project.slug}/tasks/${task.id}`);

    return {
      success: true,
      data: {
        taskId: task.id,
        status: lifecycle.status,
        currentStage: lifecycle.currentStage,
        currentActivity: lifecycle.currentActivity,
        nextStep: lifecycle.nextStep,
        sourceArtifact: context?.sourceArtifact ?? null,
      },
    };
  } catch (error) {
    if (error instanceof TaskContextError || error instanceof ProjectProviderError) {
      return { success: false, error: sanitizeError(null, error.code), code: error.code };
    }

    return { success: false, error: sanitizeError(error, "TASK_CREATION_ERROR"), code: "TASK_CREATION_ERROR" };
  }
}

export async function createTaskFromArtifactAction(
  input: TaskCreateInput,
): Promise<ActionResult<CreatedTaskPayload>> {
  return createTaskAction(input);
}

export async function updateTaskTerminalStateAction(
  input: TaskTerminalStateUpdateInput,
): Promise<ActionResult<TaskTerminalStateUpdateResult>> {
  const parsed = updateTaskTerminalStateSchema.safeParse(input);
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

  try {
    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (!workspace) {
      return { success: false, error: sanitizeError(null, "WORKSPACE_ACCESS_DENIED"), code: "WORKSPACE_ACCESS_DENIED" };
    }

    const result = await applyTaskTerminalStateWriteback(parsed.data);

    revalidatePath(`/workspace/${workspace.slug}`);
    revalidatePath(`/workspace/${workspace.slug}/project/${accessResult.data.project.slug}`);
    revalidatePath(`/workspace/${workspace.slug}/project/${accessResult.data.project.slug}/tasks/${result.taskId}`);

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof WritebackServiceError) {
      return { success: false, error: sanitizeError(null, error.code), code: error.code };
    }

    return { success: false, error: sanitizeError(error, "WRITEBACK_ERROR"), code: "WRITEBACK_ERROR" };
  }
}
