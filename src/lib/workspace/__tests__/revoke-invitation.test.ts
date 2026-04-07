import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { revokeInvitation } from "@/lib/workspace/revoke-invitation";

const prisma = new PrismaClient();
const TEST_MARKER = "test-revoke-inv";

function getTestEmail(suffix: string) {
  return `${TEST_MARKER}-${suffix}@example.com`;
}

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for revoke-invitation tests.");
  }
  if (!/(^|[_/.-])test([_/.-]|$)/i.test(databaseUrl)) {
    throw new Error(
      "revoke-invitation.test.ts requires DATABASE_URL to point to a test database."
    );
  }
}

async function cleanupTestData() {
  await prisma.workspaceInvitation.deleteMany({
    where: { workspace: { is: { slug: { contains: TEST_MARKER } } } },
  });
  await prisma.workspaceMembership.deleteMany({
    where: { workspace: { is: { slug: { contains: TEST_MARKER } } } },
  });
  await prisma.workspace.deleteMany({
    where: { slug: { contains: TEST_MARKER } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: TEST_MARKER } },
  });
}

async function createPendingInvitation(workspaceId: string, invitedByUserId: string, email: string) {
  return prisma.workspaceInvitation.create({
    data: {
      workspaceId,
      email: email.toLowerCase(),
      role: "MEMBER",
      token: crypto.randomUUID(),
      invitedByUserId,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}

describe("revokeInvitation (integration)", () => {
  let ownerUser: { id: string };
  let workspace: { id: string };

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    ownerUser = await prisma.user.create({
      data: { email: getTestEmail("owner"), name: "Revoke Owner" },
    });
    workspace = await prisma.workspace.create({
      data: {
        name: "Revoke Test WS",
        slug: `${TEST_MARKER}-ws`,
        type: "TEAM",
        ownerId: ownerUser.id,
      },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: ownerUser.id, role: "OWNER" },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should update status to REVOKED for a PENDING invitation", async () => {
    const inv = await createPendingInvitation(workspace.id, ownerUser.id, getTestEmail("revoke-ok"));

    await revokeInvitation({ workspaceId: workspace.id, invitationId: inv.id });

    const updated = await prisma.workspaceInvitation.findUnique({ where: { id: inv.id } });
    expect(updated?.status).toBe("REVOKED");
  });

  it("should throw when trying to revoke a non-PENDING invitation", async () => {
    const inv = await prisma.workspaceInvitation.create({
      data: {
        workspaceId: workspace.id,
        email: getTestEmail("already-accepted"),
        role: "MEMBER",
        token: crypto.randomUUID(),
        invitedByUserId: ownerUser.id,
        status: "ACCEPTED",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await expect(
      revokeInvitation({ workspaceId: workspace.id, invitationId: inv.id })
    ).rejects.toThrow();
  });

  it("should throw when invitationId belongs to a different workspace", async () => {
    const otherOwner = await prisma.user.create({
      data: { email: getTestEmail("other-owner"), name: "Other Owner" },
    });
    const otherWs = await prisma.workspace.create({
      data: {
        name: "Other WS",
        slug: `${TEST_MARKER}-other`,
        type: "TEAM",
        ownerId: otherOwner.id,
      },
    });
    const inv = await createPendingInvitation(otherWs.id, otherOwner.id, getTestEmail("cross-ws"));

    await expect(
      revokeInvitation({ workspaceId: workspace.id, invitationId: inv.id })
    ).rejects.toThrow();
  });
});
