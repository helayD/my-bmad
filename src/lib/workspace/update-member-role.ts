import { prisma } from "@/lib/db/client";
import type { WorkspaceRole, WorkspaceMembership } from "@/generated/prisma/client";
import { CannotAssignOwnerRoleError, CannotChangeOwnRoleError, CannotRemoveSoleOwnerError } from "@/lib/workspace/types";
import { canChangeRole } from "@/lib/workspace/permissions";

export async function updateMemberRole(params: {
  workspaceId: string;
  membershipId: string;
  newRole: WorkspaceRole;
  actorUserId: string;
  actorRole: string;
}): Promise<WorkspaceMembership> {
  const { workspaceId, membershipId, newRole, actorUserId, actorRole } = params;

  const targetMembership = await prisma.workspaceMembership.findFirst({
    where: { id: membershipId, workspaceId },
  });

  if (!targetMembership) {
    throw new Error("Membership not found");
  }

  if (targetMembership.userId === actorUserId) {
    throw new CannotChangeOwnRoleError();
  }

  if (targetMembership.role === "OWNER" && actorRole !== "OWNER") {
    throw new CannotAssignOwnerRoleError();
  }

  if (!canChangeRole(actorRole, newRole)) {
    throw new CannotAssignOwnerRoleError();
  }

  if (targetMembership.role === "OWNER") {
    const ownerCount = await prisma.workspaceMembership.count({
      where: { workspaceId, role: "OWNER" },
    });
    if (ownerCount <= 1) throw new CannotRemoveSoleOwnerError();
  }

  return prisma.workspaceMembership.update({
    where: { id: membershipId },
    data: { role: newRole },
  });
}
