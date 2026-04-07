import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { acceptInvitation } from "@/lib/workspace/accept-invitation";
import { InvitationExpiredError, InvitationInvalidError } from "@/lib/workspace/types";

const prisma = new PrismaClient();
const TEST_MARKER = "test-accept-inv";

function getTestEmail(suffix: string) {
  return `${TEST_MARKER}-${suffix}@example.com`;
}

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for accept-invitation tests.");
  }
  if (!/(^|[_/.-])test([_/.-]|$)/i.test(databaseUrl)) {
    throw new Error(
      "accept-invitation.test.ts requires DATABASE_URL to point to a test database."
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

async function createTestInvitation(
  workspaceId: string,
  invitedByUserId: string,
  inviteeEmail: string,
  opts?: { status?: string; expiresAt?: Date; role?: string }
) {
  return prisma.workspaceInvitation.create({
    data: {
      workspaceId,
      email: inviteeEmail.toLowerCase(),
      role: (opts?.role ?? "MEMBER") as never,
      token: crypto.randomUUID(),
      invitedByUserId,
      status: opts?.status ?? "PENDING",
      expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}

describe("acceptInvitation (integration)", () => {
  let inviter: { id: string };
  let workspace: { id: string; slug: string };

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    inviter = await prisma.user.create({
      data: { email: getTestEmail("inviter"), name: "Inviter" },
    });
    workspace = await prisma.workspace.create({
      data: {
        name: "Accept Test WS",
        slug: `${TEST_MARKER}-ws`,
        type: "TEAM",
        ownerId: inviter.id,
      },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: inviter.id, role: "OWNER" },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should create membership with matching role on valid acceptance", async () => {
    const invitee = await prisma.user.create({
      data: { email: getTestEmail("accept-ok"), name: "Acceptee" },
    });
    const inv = await createTestInvitation(workspace.id, inviter.id, invitee.email, { role: "ADMIN" });

    const result = await acceptInvitation({ token: inv.token, userId: invitee.id });

    expect(result.membership.role).toBe("ADMIN");
    expect(result.membership.userId).toBe(invitee.id);
    expect(result.workspace.id).toBe(workspace.id);

    const updated = await prisma.workspaceInvitation.findUnique({ where: { id: inv.id } });
    expect(updated?.status).toBe("ACCEPTED");
  });

  it("should throw InvitationExpiredError and mark EXPIRED when invitation is past expiry", async () => {
    const invitee = await prisma.user.create({
      data: { email: getTestEmail("expired"), name: "Expired User" },
    });
    const inv = await createTestInvitation(workspace.id, inviter.id, invitee.email, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      acceptInvitation({ token: inv.token, userId: invitee.id })
    ).rejects.toThrow(InvitationExpiredError);

    const updated = await prisma.workspaceInvitation.findUnique({ where: { id: inv.id } });
    expect(updated?.status).toBe("EXPIRED");
  });

  it("should throw InvitationInvalidError when token is already ACCEPTED", async () => {
    const invitee = await prisma.user.create({
      data: { email: getTestEmail("used-token"), name: "Used Token User" },
    });
    const inv = await createTestInvitation(workspace.id, inviter.id, invitee.email, {
      status: "ACCEPTED",
    });

    await expect(
      acceptInvitation({ token: inv.token, userId: invitee.id })
    ).rejects.toThrow(InvitationInvalidError);
  });

  it("should throw InvitationInvalidError when user email does not match invitation email", async () => {
    const wrongUser = await prisma.user.create({
      data: { email: getTestEmail("wrong-user"), name: "Wrong User" },
    });
    const inv = await createTestInvitation(workspace.id, inviter.id, getTestEmail("someone-else"));

    await expect(
      acceptInvitation({ token: inv.token, userId: wrongUser.id })
    ).rejects.toThrow(InvitationInvalidError);
  });

  it("should handle idempotent acceptance if user is already a member", async () => {
    const invitee = await prisma.user.create({
      data: { email: getTestEmail("idempotent"), name: "Idempotent User" },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: invitee.id, role: "MEMBER" },
    });
    const inv = await createTestInvitation(workspace.id, inviter.id, invitee.email);

    const result = await acceptInvitation({ token: inv.token, userId: invitee.id });

    expect(result.membership.userId).toBe(invitee.id);
    const updated = await prisma.workspaceInvitation.findUnique({ where: { id: inv.id } });
    expect(updated?.status).toBe("ACCEPTED");
  });
});
