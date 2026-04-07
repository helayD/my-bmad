import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { inviteMember } from "@/lib/workspace/invite-member";
import { MemberAlreadyExistsError } from "@/lib/workspace/types";

const prisma = new PrismaClient();
const TEST_MARKER = "test-invite";

function getTestEmail(suffix: string) {
  return `${TEST_MARKER}-${suffix}@example.com`;
}

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for invite-member tests.");
  }
  if (!/(^|[_/.-])test([_/.-]|$)/i.test(databaseUrl)) {
    throw new Error(
      "invite-member.test.ts requires DATABASE_URL to point to a test database."
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

describe("inviteMember (integration)", () => {
  let inviterUser: { id: string; email: string };
  let workspace: { id: string; slug: string };

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    inviterUser = await prisma.user.create({
      data: { email: getTestEmail("inviter"), name: "Inviter User" },
    });
    workspace = await prisma.workspace.create({
      data: {
        name: "Invite Test WS",
        slug: `${TEST_MARKER}-ws`,
        type: "TEAM",
        ownerId: inviterUser.id,
      },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: inviterUser.id, role: "OWNER" },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should create invitation with correct fields", async () => {
    const inv = await inviteMember({
      workspaceId: workspace.id,
      email: getTestEmail("new1"),
      invitedByUserId: inviterUser.id,
    });

    expect(inv.workspaceId).toBe(workspace.id);
    expect(inv.email).toBe(getTestEmail("new1"));
    expect(inv.status).toBe("PENDING");
    expect(inv.role).toBe("MEMBER");
    expect(inv.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(inv.expiresAt.getTime()).toBeGreaterThan(now + sevenDaysMs - 5000);
    expect(inv.expiresAt.getTime()).toBeLessThan(now + sevenDaysMs + 5000);
  });

  it("should normalise email to lowercase", async () => {
    const inv = await inviteMember({
      workspaceId: workspace.id,
      email: getTestEmail("UPPER").toUpperCase(),
      invitedByUserId: inviterUser.id,
    });
    expect(inv.email).toBe(getTestEmail("UPPER").toUpperCase().toLowerCase());
  });

  it("should throw MemberAlreadyExistsError when invitee is already a member", async () => {
    const existingMember = await prisma.user.create({
      data: { email: getTestEmail("existing"), name: "Existing Member" },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: existingMember.id, role: "MEMBER" },
    });

    await expect(
      inviteMember({
        workspaceId: workspace.id,
        email: existingMember.email,
        invitedByUserId: inviterUser.id,
      })
    ).rejects.toThrow(MemberAlreadyExistsError);
  });

  it("should revoke old PENDING invitation and create new one when re-inviting same email", async () => {
    const reinviteEmail = getTestEmail("reinvite");

    const first = await inviteMember({
      workspaceId: workspace.id,
      email: reinviteEmail,
      invitedByUserId: inviterUser.id,
    });
    expect(first.status).toBe("PENDING");

    const second = await inviteMember({
      workspaceId: workspace.id,
      email: reinviteEmail,
      invitedByUserId: inviterUser.id,
    });
    expect(second.status).toBe("PENDING");
    expect(second.id).not.toBe(first.id);

    const revokedFirst = await prisma.workspaceInvitation.findUnique({
      where: { id: first.id },
    });
    expect(revokedFirst?.status).toBe("REVOKED");
  });

  it("should create invitation with specified role", async () => {
    const inv = await inviteMember({
      workspaceId: workspace.id,
      email: getTestEmail("admin-role"),
      invitedByUserId: inviterUser.id,
      role: "ADMIN",
    });
    expect(inv.role).toBe("ADMIN");
  });
});
