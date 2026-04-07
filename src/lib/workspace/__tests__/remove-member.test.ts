import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { removeMember } from "@/lib/workspace/remove-member";
import { CannotRemoveSoleOwnerError, SelfRemoveNotAllowedError } from "@/lib/workspace/types";

const prisma = new PrismaClient();
const TEST_MARKER = "test-remove-mbr";

function getTestEmail(suffix: string) {
  return `${TEST_MARKER}-${suffix}@example.com`;
}

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for remove-member tests.");
  }
  if (!/(^|[_/.-])test([_/.-]|$)/i.test(databaseUrl)) {
    throw new Error(
      "remove-member.test.ts requires DATABASE_URL to point to a test database."
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

describe("removeMember (integration)", () => {
  let ownerUser: { id: string };
  let workspace: { id: string; slug: string };
  let ownerMembership: { id: string };

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    ownerUser = await prisma.user.create({
      data: { email: getTestEmail("owner"), name: "Owner" },
    });
    workspace = await prisma.workspace.create({
      data: {
        name: "Remove Test WS",
        slug: `${TEST_MARKER}-ws`,
        type: "TEAM",
        ownerId: ownerUser.id,
      },
    });
    ownerMembership = await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: ownerUser.id, role: "OWNER" },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should remove a regular member successfully", async () => {
    const member = await prisma.user.create({
      data: { email: getTestEmail("member"), name: "Regular Member" },
    });
    const membership = await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });

    await removeMember({
      workspaceId: workspace.id,
      membershipId: membership.id,
      actorUserId: ownerUser.id,
    });

    const deleted = await prisma.workspaceMembership.findUnique({ where: { id: membership.id } });
    expect(deleted).toBeNull();
  });

  it("should throw CannotRemoveSoleOwnerError when removing the only OWNER", async () => {
    await expect(
      removeMember({
        workspaceId: workspace.id,
        membershipId: ownerMembership.id,
        actorUserId: ownerUser.id,
      })
    ).rejects.toThrow(CannotRemoveSoleOwnerError);
  });

  it("should allow removing an OWNER when another OWNER exists", async () => {
    const secondOwner = await prisma.user.create({
      data: { email: getTestEmail("owner2"), name: "Second Owner" },
    });
    const secondOwnerMembership = await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: secondOwner.id, role: "OWNER" },
    });

    await expect(
      removeMember({
        workspaceId: workspace.id,
        membershipId: ownerMembership.id,
        actorUserId: secondOwner.id,
      })
    ).resolves.toBeUndefined();

    const deleted = await prisma.workspaceMembership.findUnique({ where: { id: ownerMembership.id } });
    expect(deleted).toBeNull();

    ownerMembership = await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: ownerUser.id, role: "OWNER" },
    });
    await prisma.workspaceMembership.delete({ where: { id: secondOwnerMembership.id } });
  });

  it("should throw SelfRemoveNotAllowedError when actor tries to remove themselves (with another OWNER present)", async () => {
    const anotherOwner = await prisma.user.create({
      data: { email: getTestEmail("self-remove-co-owner"), name: "Co Owner" },
    });
    const anotherOwnerMembership = await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: anotherOwner.id, role: "OWNER" },
    });

    await expect(
      removeMember({
        workspaceId: workspace.id,
        membershipId: ownerMembership.id,
        actorUserId: ownerUser.id,
      })
    ).rejects.toThrow(SelfRemoveNotAllowedError);

    await prisma.workspaceMembership.delete({ where: { id: anotherOwnerMembership.id } });
  });

  it("should throw when membership does not exist", async () => {
    await expect(
      removeMember({
        workspaceId: workspace.id,
        membershipId: "nonexistent-id-00000000",
        actorUserId: ownerUser.id,
      })
    ).rejects.toThrow();
  });

  it("should throw when membershipId belongs to a different workspace", async () => {
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
    const otherMember = await prisma.user.create({
      data: { email: getTestEmail("other-member"), name: "Other Member" },
    });
    const otherMembership = await prisma.workspaceMembership.create({
      data: { workspaceId: otherWs.id, userId: otherMember.id, role: "MEMBER" },
    });

    await expect(
      removeMember({
        workspaceId: workspace.id,
        membershipId: otherMembership.id,
        actorUserId: ownerUser.id,
      })
    ).rejects.toThrow();
  });
});
