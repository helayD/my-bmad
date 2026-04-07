"use server";

import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession } from "@/lib/db/helpers";
import { sanitizeError } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import type { ProjectListItem } from "@/lib/workspace/types";

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
