import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { updateMemberRole } from "@/lib/workspace/update-member-role";
import {
  CannotAssignOwnerRoleError,
  CannotChangeOwnRoleError,
  CannotRemoveSoleOwnerError,
} from "@/lib/workspace/types";

const prisma = new PrismaClient();
const TEST_MARKER = "test-role";

function getTestEmail(suffix: string) {
  return `${TEST_MARKER}-${suffix}@example.com`;
}

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for update-member-role tests.");
  }
  if (!/(^|[_/.-])test([_/.-]|$)/i.test(databaseUrl)) {
    throw new Error(
      "update-member-role.test.ts requires DATABASE_URL to point to a test database."
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

describe("updateMemberRole (integration)", () => {
  let ownerUser: { id: string };
  let adminUser: { id: string };
  let memberUser: { id: string };
  let workspace: { id: string; slug: string };
  let ownerMembership: { id: string };
  let memberMembership: { id: string };

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    ownerUser = await prisma.user.create({
      data: { email: getTestEmail("owner"), name: "Owner" },
    });
    adminUser = await prisma.user.create({
      data: { email: getTestEmail("admin"), name: "Admin" },
    });
    memberUser = await prisma.user.create({
      data: { email: getTestEmail("member"), name: "Member" },
    });

    workspace = await prisma.workspace.create({
      data: {
        name: "Role Test WS",
        slug: `${TEST_MARKER}-ws`,
        type: "TEAM",
        ownerId: ownerUser.id,
      },
    });

    ownerMembership = await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: ownerUser.id, role: "OWNER" },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: adminUser.id, role: "ADMIN" },
    });
    memberMembership = await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: memberUser.id, role: "MEMBER" },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("OWNER should upgrade MEMBER to ADMIN successfully", async () => {
    const result = await updateMemberRole({
      workspaceId: workspace.id,
      membershipId: memberMembership.id,
      newRole: "ADMIN",
      actorUserId: ownerUser.id,
      actorRole: "OWNER",
    });

    expect(result.role).toBe("ADMIN");

    await prisma.workspaceMembership.update({
      where: { id: memberMembership.id },
      data: { role: "MEMBER" },
    });
  });

  it("ADMIN should change MEMBER to VIEWER successfully", async () => {
    const result = await updateMemberRole({
      workspaceId: workspace.id,
      membershipId: memberMembership.id,
      newRole: "VIEWER",
      actorUserId: adminUser.id,
      actorRole: "ADMIN",
    });

    expect(result.role).toBe("VIEWER");

    await prisma.workspaceMembership.update({
      where: { id: memberMembership.id },
      data: { role: "MEMBER" },
    });
  });

  it("ADMIN should NOT be able to assign OWNER role", async () => {
    await expect(
      updateMemberRole({
        workspaceId: workspace.id,
        membershipId: memberMembership.id,
        newRole: "OWNER",
        actorUserId: adminUser.id,
        actorRole: "ADMIN",
      })
    ).rejects.toThrow(CannotAssignOwnerRoleError);
  });

  it("should throw CannotChangeOwnRoleError when actor changes own role", async () => {
    await expect(
      updateMemberRole({
        workspaceId: workspace.id,
        membershipId: ownerMembership.id,
        newRole: "ADMIN",
        actorUserId: ownerUser.id,
        actorRole: "OWNER",
      })
    ).rejects.toThrow(CannotChangeOwnRoleError);
  });

  it("should throw CannotRemoveSoleOwnerError when downgrading sole OWNER", async () => {
    await expect(
      updateMemberRole({
        workspaceId: workspace.id,
        membershipId: ownerMembership.id,
        newRole: "ADMIN",
        actorUserId: adminUser.id,
        actorRole: "OWNER",
      })
    ).rejects.toThrow(CannotRemoveSoleOwnerError);
  });

  it("should throw CannotRemoveSoleOwnerError when sole OWNER is downgraded by another actor", async () => {
    const secondOwner = await prisma.user.create({
      data: { email: getTestEmail("owner2"), name: "Second Owner" },
    });
    const secondOwnerMembership = await prisma.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: secondOwner.id, role: "OWNER" },
    });

    await prisma.workspaceMembership.delete({ where: { id: secondOwnerMembership.id } });

    await expect(
      updateMemberRole({
        workspaceId: workspace.id,
        membershipId: ownerMembership.id,
        newRole: "ADMIN",
        actorUserId: secondOwner.id,
        actorRole: "OWNER",
      })
    ).rejects.toThrow(CannotRemoveSoleOwnerError);
  });

  it("ADMIN should NOT be able to downgrade OWNER", async () => {
    await expect(
      updateMemberRole({
        workspaceId: workspace.id,
        membershipId: ownerMembership.id,
        newRole: "MEMBER",
        actorUserId: adminUser.id,
        actorRole: "ADMIN",
      })
    ).rejects.toThrow(CannotAssignOwnerRoleError);
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
      updateMemberRole({
        workspaceId: workspace.id,
        membershipId: otherMembership.id,
        newRole: "ADMIN",
        actorUserId: ownerUser.id,
        actorRole: "OWNER",
      })
    ).rejects.toThrow("Membership not found");
  });
});
