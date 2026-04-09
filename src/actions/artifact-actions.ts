"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession } from "@/lib/db/helpers";
import { requireProjectAccess } from "@/lib/workspace/permissions";
import { sanitizeError } from "@/lib/errors";
import { scanProjectArtifacts } from "@/lib/artifacts/scanner";
import { syncArtifacts } from "@/lib/artifacts/sync";
import { buildArtifactTree } from "@/lib/artifacts/utils";
import {
  createProjectContentProvider,
  ProjectProviderError,
  toProjectRepoProviderConfig,
} from "@/lib/content-provider/project-provider";
import type { ActionResult } from "@/lib/types";
import type { SyncReport, ArtifactTreeNode, ArtifactTypeString } from "@/lib/artifacts/types";

const projectParamsSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
});

/**
 * Scan a project's repository for BMAD artifacts and sync them to the database.
 */
export async function scanProjectArtifactsAction(
  workspaceId: string,
  projectId: string,
): Promise<ActionResult<SyncReport>> {
  const parsed = projectParamsSchema.safeParse({ workspaceId, projectId });
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
  if (!accessResult.success) return accessResult;

  try {
    const project = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, workspaceId: parsed.data.workspaceId },
      include: { repo: true },
    });

    if (!project?.repo) {
      return { success: false, error: sanitizeError(null, "REPO_NOT_LINKED"), code: "REPO_NOT_LINKED" };
    }

    const provider = await createProjectContentProvider(
      toProjectRepoProviderConfig(project.repo),
      session.userId,
    );

    const scanResult = await scanProjectArtifacts(provider);
    const syncReport = await syncArtifacts(parsed.data.projectId, scanResult);

    revalidatePath("/(dashboard)");

    return { success: true, data: syncReport };
  } catch (error) {
    if (error instanceof ProjectProviderError) {
      return { success: false, error: sanitizeError(null, error.code), code: error.code };
    }
    return { success: false, error: sanitizeError(error, "ARTIFACT_SCAN_ERROR"), code: "ARTIFACT_SCAN_ERROR" };
  }
}

/**
 * Get the artifact tree for a project.
 */
export async function getProjectArtifactTreeAction(
  workspaceId: string,
  projectId: string,
): Promise<ActionResult<ArtifactTreeNode[]>> {
  const parsed = projectParamsSchema.safeParse({ workspaceId, projectId });
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
  if (!accessResult.success) return accessResult;

  try {
    const artifacts = await prisma.bmadArtifact.findMany({
      where: { projectId: parsed.data.projectId, status: "active" },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });

    const tree = buildArtifactTree(
      artifacts.map((a) => ({
        id: a.id,
        type: a.type as ArtifactTypeString,
        name: a.name,
        filePath: a.filePath,
        metadata: (a.metadata as Record<string, unknown>) ?? null,
        parentId: a.parentId,
      })),
    );

    return { success: true, data: tree };
  } catch (error) {
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}
