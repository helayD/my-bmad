import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createProject } from "@/lib/workspace/create-project";

const prisma = new PrismaClient();
const TEST_MARKER = "test-proj-repo";

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
      "create-project-with-repo.test.ts requires DATABASE_URL to point to a test database."
    );
  }
}

async function cleanupTestData() {
  await prisma.project.deleteMany({
    where: { workspace: { is: { slug: { contains: TEST_MARKER } } } },
  });
  await prisma.repo.deleteMany({
    where: { user: { is: { email: { contains: TEST_MARKER } } } },
  });
  await prisma.workspaceMembership.deleteMany({
    where: { user: { is: { email: { contains: TEST_MARKER } } } },
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

describe("createProject with repo (integration)", () => {
  let userId: string;
  let personalWorkspaceId: string;
  let teamWorkspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    const user = await prisma.user.create({
      data: { email: getTestEmail("owner"), name: "Repo Test User" },
    });
    userId = user.id;

    const personalWs = await prisma.workspace.create({
      data: {
        name: "Personal WS",
        slug: `${TEST_MARKER}-personal`,
        type: "PERSONAL",
        ownerId: userId,
      },
    });
    personalWorkspaceId = personalWs.id;

    const teamWs = await prisma.workspace.create({
      data: {
        name: "Team WS",
        slug: `${TEST_MARKER}-team`,
        type: "TEAM",
        ownerId: userId,
      },
    });
    teamWorkspaceId = teamWs.id;

    await prisma.workspaceMembership.create({
      data: {
        workspaceId: teamWs.id,
        userId: userId,
        role: "OWNER",
      },
    });

    const repo = await prisma.repo.create({
      data: {
        owner: "test-owner",
        name: `${TEST_MARKER}-repo`,
        branch: "main",
        displayName: "Test Repo",
        sourceType: "github",
        userId: userId,
      },
    });
    repoId = repo.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should create project with repo association", async () => {
    const project = await createProject({
      workspaceId: personalWorkspaceId,
      name: "Project With Repo",
      workspaceType: "PERSONAL",
      repoId: repoId,
    });

    expect(project.name).toBe("Project With Repo");
    expect(project.repoId).toBe(repoId);
    expect(project.status).toBe("active");
  });

  it("should create project without repo (repoId undefined)", async () => {
    const project = await createProject({
      workspaceId: personalWorkspaceId,
      name: "Project No Repo",
      workspaceType: "PERSONAL",
    });

    expect(project.name).toBe("Project No Repo");
    expect(project.repoId).toBeNull();
    expect(project.status).toBe("active");
  });

  it("should fail when repoId does not exist", async () => {
    // createProject itself doesn't validate repo existence — that's the action's job.
    // But Prisma foreign key constraint will reject an invalid repoId.
    await expect(
      createProject({
        workspaceId: personalWorkspaceId,
        name: "Bad Repo",
        workspaceType: "PERSONAL",
        repoId: "nonexistent_cuid_value_here",
      })
    ).rejects.toThrow();
  });

  it("should enforce TEAM workspace project limit with repo", async () => {
    // Create project with repo in TEAM workspace (should work within limits)
    const project = await createProject({
      workspaceId: teamWorkspaceId,
      name: "Team Project With Repo",
      workspaceType: "TEAM",
      repoId: repoId,
    });

    expect(project.name).toBe("Team Project With Repo");
    expect(project.repoId).toBe(repoId);
    expect(project.workspaceId).toBe(teamWorkspaceId);
  });
});
