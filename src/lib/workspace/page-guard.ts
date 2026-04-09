import { notFound } from "next/navigation";
import { getAuthenticatedSession, getWorkspaceBySlug, getWorkspaceMembership } from "@/lib/db/helpers";
import type { WorkspaceRole } from "@/generated/prisma/client";

/**
 * Unified page-level guard for workspace pages.
 * Validates authentication, workspace existence, and membership.
 * Returns notFound() (404) for unauthenticated or non-member users
 * to avoid leaking workspace existence.
 */
export async function guardWorkspacePage(slug: string) {
  const session = await getAuthenticatedSession();
  if (!session) notFound();

  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) notFound();

  const membership = await getWorkspaceMembership(workspace.id, session.userId);
  if (!membership) notFound();

  const role = membership.role as WorkspaceRole;
  const isTeam = workspace.type === "TEAM";
  const canManage = role === "OWNER" || role === "ADMIN";

  return { session, workspace, membership, role, isTeam, canManage };
}
