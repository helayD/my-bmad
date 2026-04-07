import { cache } from "react";
import { auth } from "@/lib/auth/auth";

import { headers } from "next/headers";
import { prisma } from "@/lib/db/client";
import type { RepoConfig, ActionResult, UserRole } from "@/lib/types";

/**
 * Get the authenticated session with userId and role. Cached per request via React cache().
 * Returns null if not authenticated.
 */
export const getAuthenticatedSession = cache(
  async (): Promise<{ userId: string; role: UserRole; email: string; name: string | null } | null> => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) return null;
    const role = (session.user.role === "admin" ? "admin" : "user") satisfies UserRole;
    return { userId: session.user.id, role, email: session.user.email, name: session.user.name ?? null };
  }
);

/**
 * Require admin role. Returns ActionResult with error if not admin.
 */
export async function requireAdmin(): Promise<ActionResult<{ userId: string }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }
  if (session.role !== "admin") {
    return { success: false, error: "Access denied", code: "FORBIDDEN" };
  }
  return { success: true, data: { userId: session.userId } };
}

/**
 * Get the authenticated user's ID. Cached per request via React cache().
 * Delegates to getAuthenticatedSession to avoid duplicate auth.api.getSession calls.
 */
export const getAuthenticatedUserId = cache(
  async (): Promise<string | null> => {
    const session = await getAuthenticatedSession();
    return session?.userId ?? null;
  }
);

/**
 * Get all repos for the authenticated user. Cached per request via React cache().
 * Deduplicates across layout.tsx and page.tsx within the same render.
 */
export const getAuthenticatedRepos = cache(
  async (userId: string): Promise<RepoConfig[]> => {
    const rows = await prisma.repo.findMany({
      where: { userId },
      select: { owner: true, name: true, branch: true, displayName: true, description: true, sourceType: true, localPath: true, lastSyncedAt: true },
      orderBy: { createdAt: "desc" },
    });
    return rows as RepoConfig[];
  }
);

/**
 * Get a single repo config for the authenticated user. Cached per request.
 * Returns null if not found (user doesn't own this repo).
 */
export const getAuthenticatedRepoConfig = cache(
  async (
    userId: string,
    owner: string,
    name: string
  ): Promise<RepoConfig | null> => {
    const row = await prisma.repo.findFirst({
      where: { userId, owner, name },
      select: { owner: true, name: true, branch: true, displayName: true, description: true, sourceType: true, localPath: true, lastSyncedAt: true },
    });
    return row as RepoConfig | null;
  }
);

/**
 * Get the personal workspace for a user. Cached per request via React cache().
 * Returns workspace with its membership record, or null if not found.
 */
export const getPersonalWorkspace = cache(
  async (userId: string) => {
    return prisma.workspace.findFirst({
      where: { ownerId: userId, type: "PERSONAL" },
      include: { memberships: { where: { userId }, take: 1 } },
    });
  }
);

/**
 * Get a workspace by slug with its projects. Cached per request via React cache().
 */
export const getWorkspaceBySlug = cache(
  async (slug: string) => {
    return prisma.workspace.findUnique({
      where: { slug },
      include: { projects: { orderBy: { updatedAt: "desc" } } },
    });
  }
);

/**
 * Get a workspace membership for permission verification. Cached per request via React cache().
 */
export const getWorkspaceMembership = cache(
  async (workspaceId: string, userId: string) => {
    return prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId },
    });
  }
);

/**
 * Get all workspaces a user is a member of. Cached per request via React cache().
 * Used by sidebar to display workspace list.
 */
export const getWorkspacesForUser = cache(
  async (userId: string) => {
    return prisma.workspaceMembership.findMany({
      where: { userId },
      include: {
        workspace: {
          select: { id: true, name: true, slug: true, type: true },
        },
      },
      orderBy: { workspace: { updatedAt: "desc" } },
    });
  }
);

/**
 * Get count of active projects in a workspace. Cached per request via React cache().
 */
export const getActiveProjectCount = cache(
  async (workspaceId: string) => {
    return prisma.project.count({
      where: { workspaceId, status: "active" },
    });
  }
);

/**
 * Get a workspace by its ID. Cached per request via React cache().
 */
export const getWorkspaceById = cache(
  async (workspaceId: string) => {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
  }
);

/**
 * Get all members of a workspace with user info. Cached per request via React cache().
 * Returns members sorted by createdAt ascending.
 */
export const getWorkspaceMembers = cache(
  async (workspaceId: string) => {
    return prisma.workspaceMembership.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }
);

/**
 * Get all PENDING invitations for a workspace. Cached per request via React cache().
 * Returns invitations sorted by createdAt descending.
 */
export const getWorkspaceInvitations = cache(
  async (workspaceId: string) => {
    return prisma.workspaceInvitation.findMany({
      where: { workspaceId, status: "PENDING" },
      include: {
        invitedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
);
