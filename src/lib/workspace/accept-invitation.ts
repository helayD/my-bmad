import { prisma } from "@/lib/db/client";
import type { Workspace, WorkspaceMembership } from "@/generated/prisma/client";
import { isPrismaUniqueConstraintError } from "@/lib/workspace/slug-utils";
import { InvitationExpiredError, InvitationInvalidError } from "@/lib/workspace/types";

export async function acceptInvitation(params: {
  token: string;
  userId: string;
}): Promise<{ workspace: Workspace; membership: WorkspaceMembership }> {
  const { token, userId } = params;

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    include: { workspace: true },
  });

  if (!invitation || invitation.status !== "PENDING") {
    throw new InvitationInvalidError();
  }

  const now = new Date();
  if (invitation.expiresAt < now) {
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    throw new InvitationExpiredError();
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user || user.email.toLowerCase() !== invitation.email) {
    throw new InvitationInvalidError();
  }

  const existingMembership = await prisma.workspaceMembership.findFirst({
    where: { workspaceId: invitation.workspaceId, userId },
  });

  if (existingMembership) {
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED" },
    });
    return { workspace: invitation.workspace, membership: existingMembership };
  }

  try {
    const membership = await prisma.workspaceMembership.create({
      data: {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
      },
    });
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED" },
    });
    return { workspace: invitation.workspace, membership };
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error)) {
      const existing = await prisma.workspaceMembership.findFirst({
        where: { workspaceId: invitation.workspaceId, userId },
      });
      if (existing) {
        await prisma.workspaceInvitation.update({
          where: { id: invitation.id },
          data: { status: "ACCEPTED" },
        });
        return { workspace: invitation.workspace, membership: existing };
      }
    }
    throw error;
  }
}
