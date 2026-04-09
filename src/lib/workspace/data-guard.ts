import { prisma } from "@/lib/db/client";

/**
 * Return a base `where` clause that scopes project queries to a workspace.
 * All project-related queries should use this to prevent cross-workspace data leaks.
 */
export function scopedProjectQuery(workspaceId: string) {
  return { workspaceId } as const;
}

/**
 * Return the list of workspace IDs a user has membership in.
 * Useful for listing workspaces or filtering across multiple workspaces.
 */
export async function getAccessibleWorkspaceIds(userId: string): Promise<string[]> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  return memberships.map((m) => m.workspaceId);
}
