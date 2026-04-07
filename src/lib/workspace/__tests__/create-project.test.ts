import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createProject } from "@/lib/workspace/create-project";
import { ProjectLimitExceededError } from "@/lib/workspace/types";

const prisma = new PrismaClient();
const TEST_MARKER = "test-create-proj";

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
      "create-project.test.ts requires DATABASE_URL to point to a test database."
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

describe("createProject (integration)", () => {
  let teamWorkspaceId: string;
  let personalWorkspaceId: string;

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    const user = await prisma.user.create({
      data: { email: getTestEmail("proj"), name: "Project Test" },
    });
    const teamWs = await prisma.workspace.create({
      data: {
        name: "Team Workspace",
        slug: `${TEST_MARKER}-team`,
        type: "TEAM",
        ownerId: user.id,
      },
    });
    const personalWs = await prisma.workspace.create({
      data: {
        name: "Personal Workspace",
        slug: `${TEST_MARKER}-personal`,
        type: "PERSONAL",
        ownerId: user.id,
      },
    });
    teamWorkspaceId = teamWs.id;
    personalWorkspaceId = personalWs.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should create a project and return Project object", async () => {
    const project = await createProject({
      workspaceId: teamWorkspaceId,
      name: "My First Project",
      workspaceType: "TEAM",
    });

    expect(project.name).toBe("My First Project");
    expect(project.slug).toBe("my-first-project");
    expect(project.status).toBe("active");
    expect(project.workspaceId).toBe(teamWorkspaceId);
  });

  it("should throw ProjectLimitExceededError when TEAM workspace exceeds limit", async () => {
    // Create 49 more projects (already have 1 from previous test = 50 total)
    const createPromises = Array.from({ length: 49 }, (_, i) =>
      prisma.project.create({
        data: {
          name: `Filler ${i}`,
          slug: `${TEST_MARKER}-filler-${i}`,
          workspaceId: teamWorkspaceId,
          status: "active",
        },
      })
    );
    await Promise.all(createPromises);

    await expect(
      createProject({
        workspaceId: teamWorkspaceId,
        name: "Over Limit",
        workspaceType: "TEAM",
      })
    ).rejects.toThrow(ProjectLimitExceededError);
  });

  it("should NOT check limit for PERSONAL workspace", async () => {
    const project = await createProject({
      workspaceId: personalWorkspaceId,
      name: "Personal Project",
      workspaceType: "PERSONAL",
    });

    expect(project.name).toBe("Personal Project");
    expect(project.status).toBe("active");
  });

  it("should handle slug collision with retry", async () => {
    const proj1 = await createProject({
      workspaceId: personalWorkspaceId,
      name: "Duplicate Name",
      workspaceType: "PERSONAL",
    });
    const proj2 = await createProject({
      workspaceId: personalWorkspaceId,
      name: "Duplicate Name",
      workspaceType: "PERSONAL",
    });

    expect(proj1.slug).toBe("duplicate-name");
    expect(proj2.slug).not.toBe(proj1.slug);
    expect(proj2.slug).toContain("duplicate-name");
  });
});
