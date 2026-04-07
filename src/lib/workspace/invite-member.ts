import { prisma } from "@/lib/db/client";
import type { WorkspaceRole, WorkspaceInvitation } from "@/generated/prisma/client";
import { MemberAlreadyExistsError } from "@/lib/workspace/types";
import { INVITATION_EXPIRY_DAYS } from "@/lib/workspace/types";

export async function inviteMember(params: {
  workspaceId: string;
  email: string;
  invitedByUserId: string;
  role?: WorkspaceRole;
}): Promise<WorkspaceInvitation> {
  const { workspaceId, invitedByUserId, role } = params;
  const email = params.email.toLowerCase().trim();

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    const existingMembership = await prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId: existingUser.id },
    });
    if (existingMembership) {
      throw new MemberAlreadyExistsError();
    }
  }

  await prisma.workspaceInvitation.updateMany({
    where: { workspaceId, email, status: "PENDING" },
    data: { status: "REVOKED" },
  });

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  return prisma.workspaceInvitation.create({
    data: {
      workspaceId,
      email,
      role: role ?? "MEMBER",
      token,
      invitedByUserId,
      status: "PENDING",
      expiresAt,
    },
  });
}
