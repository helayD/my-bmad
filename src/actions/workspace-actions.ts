"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession, getWorkspaceMembership, getWorkspaceById } from "@/lib/db/helpers";
import { sanitizeError } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import {
  type ProjectListItem,
  type WorkspaceSummary,
  ProjectLimitExceededError,
  createTeamWorkspaceInputSchema,
  createProjectInputSchema,
  archiveProjectInputSchema,
} from "@/lib/workspace/types";
import { createTeamWorkspace } from "@/lib/workspace/create-team-workspace";
import { createProject } from "@/lib/workspace/create-project";
import { archiveProject } from "@/lib/workspace/archive-project";

const workspaceIdSchema = z.string().cuid2();

/**
 * Get all projects for a workspace the current user has access to.
 * Returns projects sorted by updatedAt descending.
 */
export async function getWorkspaceProjects(
  workspaceId: string
): Promise<ActionResult<ProjectListItem[]>> {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid workspace ID",
      code: "VALIDATION_ERROR",
    };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  try {
    const membership = await prisma.workspaceMembership.findFirst({
      where: { workspaceId: parsed.data, userId: session.userId },
    });

    if (!membership) {
      return {
        success: false,
        error: "Access denied",
        code: "FORBIDDEN",
      };
    }

    const projects = await prisma.project.findMany({
      where: { workspaceId: parsed.data },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return { success: true, data: projects };
  } catch (error: unknown) {
    return {
      success: false,
      error: sanitizeError(error, "WORKSPACE_ERROR"),
      code: "WORKSPACE_ERROR",
    };
  }
}

/**
 * Create a new TEAM workspace. Any authenticated user can create one (MVP).
 */
export async function createTeamWorkspaceAction(
  input: { name: string }
): Promise<ActionResult<{ workspace: WorkspaceSummary }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = createTeamWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const result = await createTeamWorkspace(session.userId, parsed.data.name);
    revalidatePath("/");
    return {
      success: true,
      data: {
        workspace: {
          id: result.workspace.id,
          name: result.workspace.name,
          slug: result.workspace.slug,
          type: result.workspace.type,
        },
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: sanitizeError(error, "WORKSPACE_ERROR"),
      code: "WORKSPACE_ERROR",
    };
  }
}

/**
 * Create a project within a workspace. Requires OWNER or ADMIN role.
 * For TEAM workspaces, enforces the active project limit.
 */
export async function createProjectAction(
  input: { workspaceId: string; name: string; repoId?: string }
): Promise<ActionResult<{ project: ProjectListItem }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = createProjectInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const membership = await getWorkspaceMembership(parsed.data.workspaceId, session.userId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (!workspace) {
      return { success: false, error: "Workspace not found", code: "NOT_FOUND" };
    }

    const project = await createProject({
      workspaceId: parsed.data.workspaceId,
      name: parsed.data.name,
      workspaceType: workspace.type,
      repoId: parsed.data.repoId,
    });

    revalidatePath(`/workspace/${workspace.slug}`);
    return {
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          status: project.status,
          updatedAt: project.updatedAt,
        },
      },
    };
  } catch (error: unknown) {
    if (error instanceof ProjectLimitExceededError) {
      return {
        success: false,
        error: sanitizeError(error, "PROJECT_LIMIT_EXCEEDED"),
        code: "PROJECT_LIMIT_EXCEEDED",
      };
    }
    return {
      success: false,
      error: sanitizeError(error, "WORKSPACE_ERROR"),
      code: "WORKSPACE_ERROR",
    };
  }
}

/**
 * Archive a project. Requires OWNER or ADMIN role in the workspace.
 */
export async function archiveProjectAction(
  input: { projectId: string; workspaceId: string }
): Promise<ActionResult<{ project: ProjectListItem }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = archiveProjectInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const membership = await getWorkspaceMembership(parsed.data.workspaceId, session.userId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    const project = await archiveProject(parsed.data.projectId, parsed.data.workspaceId);

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (workspace) {
      revalidatePath(`/workspace/${workspace.slug}`);
    }

    return {
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          status: project.status,
          updatedAt: project.updatedAt,
        },
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: sanitizeError(error, "WORKSPACE_ERROR"),
      code: "WORKSPACE_ERROR",
    };
  }
}
