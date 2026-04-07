import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { checkProjectLimit, TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT } from "@/lib/workspace/project-limit";

const prisma = new PrismaClient();
const TEST_MARKER = "test-proj-limit";

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
      "project-limit.test.ts requires DATABASE_URL to point to a test database."
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

describe("checkProjectLimit (integration)", () => {
  let workspaceId: string;

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    const user = await prisma.user.create({
      data: { email: getTestEmail("limit"), name: "Limit Test" },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: "Limit Test Workspace",
        slug: `${TEST_MARKER}-ws`,
        type: "TEAM",
        ownerId: user.id,
      },
    });
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should have TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT = 50", () => {
    expect(TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT).toBe(50);
  });

  it("should return allowed=true when 0 active projects", async () => {
    const result = await checkProjectLimit(workspaceId);
    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(0);
    expect(result.limit).toBe(50);
  });

  it("should return allowed=true when 49 active projects", async () => {
    // Create 49 projects
    const createPromises = Array.from({ length: 49 }, (_, i) =>
      prisma.project.create({
        data: {
          name: `Project ${i}`,
          slug: `${TEST_MARKER}-proj-${i}`,
          workspaceId,
          status: "active",
        },
      })
    );
    await Promise.all(createPromises);

    const result = await checkProjectLimit(workspaceId);
    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(49);
  });

  it("should return allowed=false when 50 active projects", async () => {
    // Add 1 more to reach 50
    await prisma.project.create({
      data: {
        name: "Project 49",
        slug: `${TEST_MARKER}-proj-49`,
        workspaceId,
        status: "active",
      },
    });

    const result = await checkProjectLimit(workspaceId);
    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(50);
  });
});
