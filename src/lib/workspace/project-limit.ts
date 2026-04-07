import { prisma } from "@/lib/db/client";

export const TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT = 50;

/**
 * Check if a workspace has reached the active project limit.
 * Returns whether a new project is allowed, along with current count and limit.
 */
export async function checkProjectLimit(
  workspaceId: string
): Promise<{ allowed: boolean; currentCount: number; limit: number }> {
  const limit = TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT;
  const currentCount = await prisma.project.count({
    where: { workspaceId, status: "active" },
  });
  return { allowed: currentCount < limit, currentCount, limit };
}
