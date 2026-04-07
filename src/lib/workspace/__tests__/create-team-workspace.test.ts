import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createTeamWorkspace } from "@/lib/workspace/create-team-workspace";

const prisma = new PrismaClient();
const TEST_MARKER = "test-create-tw";

function getTestEmail(suffix: string) {
  return `${TEST_MARKER}-${suffix}@example.com`;
}

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for workspace tests.");
  }
  if (!/(^|[_/.-])test([_/.-]|$)/i.test(databaseUrl)) {
    throw new Error(
      "create-team-workspace.test.ts requires DATABASE_URL to point to a test database."
    );
  }
}

async function cleanupTestData() {
  await prisma.workspaceMembership.deleteMany({
    where: { user: { is: { email: { contains: TEST_MARKER } } } },
  });
  await prisma.project.deleteMany({
    where: { workspace: { is: { slug: { contains: TEST_MARKER } } } },
  });
  await prisma.workspace.deleteMany({
    where: {
      OR: [
        { slug: { contains: TEST_MARKER } },
        { owner: { is: { email: { contains: TEST_MARKER } } } },
      ],
    },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: TEST_MARKER } },
  });
}

describe("createTeamWorkspace (integration)", () => {
  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should create a TEAM workspace with correct slug", async () => {
    const user = await prisma.user.create({
      data: { email: getTestEmail("slug"), name: "Slug Test" },
    });

    const result = await createTeamWorkspace(user.id, "Test Team Alpha");

    expect(result.created).toBe(true);
    expect(result.workspace.type).toBe("TEAM");
    // generateSlug("Test Team Alpha", "team") → "test-team-alpha"
    expect(result.workspace.slug).toBe("test-team-alpha");
    expect(result.workspace.name).toBe("Test Team Alpha");
  });

  it("should use teamName directly as workspace name (no suffix)", async () => {
    const user = await prisma.user.create({
      data: { email: getTestEmail("name"), name: "Name Test" },
    });

    const result = await createTeamWorkspace(user.id, "我的团队");

    expect(result.created).toBe(true);
    expect(result.workspace.name).toBe("我的团队");
    // All Chinese chars → fallback "team"
    expect(result.workspace.slug).toBe("team");
  });

  it("should create membership with OWNER role", async () => {
    const user = await prisma.user.create({
      data: { email: getTestEmail("owner"), name: "Owner Test" },
    });

    const result = await createTeamWorkspace(user.id, "Owner Team");

    expect(result.membership.role).toBe("OWNER");
    expect(result.membership.userId).toBe(user.id);
    expect(result.membership.workspaceId).toBe(result.workspace.id);
  });

  it("should handle slug collision with random suffix retry", async () => {
    const user1 = await prisma.user.create({
      data: { email: getTestEmail("dup1"), name: "Dup User 1" },
    });
    const user2 = await prisma.user.create({
      data: { email: getTestEmail("dup2"), name: "Dup User 2" },
    });

    const result1 = await createTeamWorkspace(user1.id, "Duplicate Team");
    expect(result1.created).toBe(true);

    const result2 = await createTeamWorkspace(user2.id, "Duplicate Team");
    expect(result2.created).toBe(true);
    expect(result2.workspace.slug).not.toBe(result1.workspace.slug);
    expect(result2.workspace.slug).toContain("duplicate-team");
  });

  it("should reject empty team name", async () => {
    const user = await prisma.user.create({
      data: { email: getTestEmail("empty"), name: "Empty Test" },
    });

    await expect(createTeamWorkspace(user.id, "")).rejects.toThrow();
    await expect(createTeamWorkspace(user.id, "   ")).rejects.toThrow();
  });
});
