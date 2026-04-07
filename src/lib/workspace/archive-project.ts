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
    throw new Error("Le projet est introuvable dans cet espace de travail.");
  }

  if (project.status !== "active") {
    throw new Error("Seuls les projets actifs peuvent être archivés.");
  }

  return prisma.project.update({
    where: { id: projectId },
    data: { status: "archived" },
  });
}
