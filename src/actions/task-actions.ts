"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession, getTasksBySourceArtifactId } from "@/lib/db/helpers";
import { sanitizeError } from "@/lib/errors";
import {
  createProjectContentProvider,
  ProjectProviderError,
  toProjectRepoProviderConfig,
} from "@/lib/content-provider/project-provider";
import { buildTaskCreationContext, TaskContextError } from "@/lib/tasks/context";
import { getInitialTaskLifecycle } from "@/lib/tasks/defaults";
import { buildArtifactTaskHistoryEntries, type ArtifactTaskHistoryPayload } from "@/lib/tasks/tracking";
import { TASK_INTENT_VALUES, TASK_PRIORITY_VALUES, TASK_STATUS_VALUES, type CreatedTaskPayload, type TaskCreateInput, type TaskCreationContext } from "@/lib/tasks/types";
import { requireProjectAccess } from "@/lib/workspace/permissions";
import type { ActionResult } from "@/lib/types";

const taskContextParamsSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  artifactId: z.string().cuid2(),
});

const createTaskFromArtifactSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  artifactId: z.string().cuid2(),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(500),
  priority: z.enum(TASK_PRIORITY_VALUES),
  intent: z.enum(TASK_INTENT_VALUES),
});

const artifactTaskHistorySchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  artifactId: z.string().cuid2(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
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
      },
    });

    if (!artifact) {
      return { success: false, error: sanitizeError(null, "ARTIFACT_NOT_FOUND"), code: "ARTIFACT_NOT_FOUND" };
    }

    if (artifact.type !== "STORY") {
      return {
        success: true,
        data: {
          artifact,
          supportsDirectHistory: false,
          items: [],
        },
      };
    }

    const tasks = await getTasksBySourceArtifactId(parsed.data.projectId, parsed.data.artifactId, parsed.data.status);

    return {
      success: true,
      data: {
        artifact,
        supportsDirectHistory: true,
        items: buildArtifactTaskHistoryEntries(tasks),
      },
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

export async function createTaskFromArtifactAction(
  input: TaskCreateInput,
): Promise<ActionResult<CreatedTaskPayload>> {
  const parsed = createTaskFromArtifactSchema.safeParse(input);
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
    const lifecycle = getInitialTaskLifecycle();

    const task = await prisma.task.create({
      data: {
        workspaceId: parsed.data.workspaceId,
        projectId: parsed.data.projectId,
        sourceArtifactId: artifact.id,
        title: parsed.data.title,
        goal: parsed.data.goal,
        summary: context.summary,
        priority: parsed.data.priority,
        intent: parsed.data.intent,
        status: lifecycle.status,
        currentStage: lifecycle.currentStage,
        nextStep: lifecycle.nextStep,
        metadata: {
          currentActivity: lifecycle.currentActivity,
          sourceContext: {
            acceptanceCriteria: context.acceptanceCriteria,
            relatedStoryIds: context.relatedStoryIds,
            hierarchy: context.sourceArtifact.hierarchy,
          },
        },
        createdByUserId: session.userId,
      },
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
        sourceArtifact: context.sourceArtifact,
      },
    };
  } catch (error) {
    if (error instanceof TaskContextError || error instanceof ProjectProviderError) {
      return { success: false, error: sanitizeError(null, error.code), code: error.code };
    }

    return { success: false, error: sanitizeError(error, "TASK_CREATION_ERROR"), code: "TASK_CREATION_ERROR" };
  }
}
