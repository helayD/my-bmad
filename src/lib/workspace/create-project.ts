import { prisma } from "@/lib/db/client";
import type { WorkspaceType } from "@/generated/prisma/client";
import { generateSlug, randomHex, isPrismaUniqueConstraintError } from "@/lib/workspace/slug-utils";
import { TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT } from "@/lib/workspace/project-limit";
import { ProjectLimitExceededError } from "@/lib/workspace/types";

interface CreateProjectParams {
  workspaceId: string;
  name: string;
  workspaceType: WorkspaceType;
  slug?: string;
  repoId?: string;
}

/**
 * Create a project within a workspace.
 * For TEAM workspaces, uses a transaction with row-level locking (SELECT FOR UPDATE)
 * to atomically check the active project limit and create the project,
 * eliminating the TOCTOU race condition.
 * Pure domain function — no "use server".
 */
export async function createProject(params: CreateProjectParams) {
  const { workspaceId, name, workspaceType, repoId } = params;
  const slug = params.slug || generateSlug(name);

  if (workspaceType === "TEAM") {
    return createProjectWithLimitCheck(workspaceId, name, slug, repoId);
  }

  return createProjectDirect(workspaceId, name, slug, repoId);
}

/**
 * TEAM workspace path: transaction with row lock to enforce limit atomically.
 */
async function createProjectWithLimitCheck(
  workspaceId: string,
  name: string,
  slug: string,
  repoId?: string,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      // Lock the workspace row to serialize concurrent project creations
      await tx.$queryRaw`SELECT id FROM "workspaces" WHERE id = ${workspaceId} FOR UPDATE`;

      const currentCount = await tx.project.count({
        where: { workspaceId, status: "active" },
      });
      const limit = TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT;
      if (currentCount >= limit) {
        throw new ProjectLimitExceededError(currentCount, limit);
      }

      return tx.project.create({
        data: { name, slug, workspaceId, repoId: repoId ?? null, status: "active" },
      });
    });
  } catch (error: unknown) {
    if (error instanceof ProjectLimitExceededError) throw error;
    if (isPrismaUniqueConstraintError(error)) {
      const suffixedSlug = `${slug.substring(0, 39)}-${randomHex(4)}`;
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "workspaces" WHERE id = ${workspaceId} FOR UPDATE`;

        const currentCount = await tx.project.count({
          where: { workspaceId, status: "active" },
        });
        const limit = TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT;
        if (currentCount >= limit) {
          throw new ProjectLimitExceededError(currentCount, limit);
        }

        return tx.project.create({
          data: { name, slug: suffixedSlug, workspaceId, repoId: repoId ?? null, status: "active" },
        });
      });
    }
    throw error;
  }
}

/**
 * Non-TEAM workspace path: no limit check needed.
 */
async function createProjectDirect(
  workspaceId: string,
  name: string,
  slug: string,
  repoId?: string,
) {
  try {
    return await prisma.project.create({
      data: { name, slug, workspaceId, repoId: repoId ?? null, status: "active" },
    });
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error)) {
      const suffixedSlug = `${slug.substring(0, 39)}-${randomHex(4)}`;
      return prisma.project.create({
        data: { name, slug: suffixedSlug, workspaceId, repoId: repoId ?? null, status: "active" },
      });
    }
    throw error;
  }
}
