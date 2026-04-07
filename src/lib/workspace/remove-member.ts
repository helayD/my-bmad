import { prisma } from "@/lib/db/client";
import { CannotRemoveSoleOwnerError, SelfRemoveNotAllowedError } from "@/lib/workspace/types";

export async function removeMember(params: {
  workspaceId: string;
  membershipId: string;
  actorUserId: string;
}): Promise<void> {
  const { workspaceId, membershipId, actorUserId } = params;

  const membership = await prisma.workspaceMembership.findFirst({
    where: { id: membershipId, workspaceId },
  });

  if (!membership) {
    throw new Error("Membership not found");
  }

  if (membership.userId === actorUserId) {
    throw new SelfRemoveNotAllowedError();
  }

  await prisma.$transaction(async (tx) => {
    if (membership.role === "OWNER") {
      const ownerCount = await tx.workspaceMembership.count({
        where: { workspaceId, role: "OWNER" },
      });
      if (ownerCount <= 1) {
        throw new CannotRemoveSoleOwnerError();
      }
    }

    await tx.workspaceMembership.delete({
      where: { id: membershipId },
    });
  });
}
