import { prisma } from "@/lib/db/client";

/**
 * Archive a project within a workspace.
 * Validates project exists in the specified workspace and is currently active.
 * Pure domain function — no "use server".
 */
export async function archiveProject(
  projectId: string,
  workspaceId: string
) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
  });

  if (!project) {
    throw new Error("在此工作空间中找不到该项目。");
  }

  if (project.status !== "active") {
    throw new Error("只有活跃状态的项目可以被归档。");
  }

  return prisma.project.update({
    where: { id: projectId },
    data: { status: "archived" },
  });
}
