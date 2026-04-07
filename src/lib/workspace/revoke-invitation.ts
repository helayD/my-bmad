import { prisma } from "@/lib/db/client";

export async function revokeInvitation(params: {
  workspaceId: string;
  invitationId: string;
}): Promise<void> {
  const { workspaceId, invitationId } = params;

  const invitation = await prisma.workspaceInvitation.findFirst({
    where: { id: invitationId, workspaceId, status: "PENDING" },
  });

  if (!invitation) {
    throw new Error("Invitation not found or not in PENDING status");
  }

  await prisma.workspaceInvitation.update({
    where: { id: invitationId },
    data: { status: "REVOKED" },
  });
}
