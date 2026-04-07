import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

const prisma = new PrismaClient();
const TEST_MARKER = "test-workspace-models";
let hasSafeDatabaseUrl = false;

function getTestEmail(suffix: string) {
  return `${TEST_MARKER}-${suffix}@example.com`;
}

function getTestSlug(suffix: string) {
  return `${TEST_MARKER}-${suffix}`;
}

function getTestOwner(suffix: string) {
  return `${TEST_MARKER}-${suffix}`;
}

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  const allowNonTestDatabase = process.env.WORKSPACE_MODELS_TEST_ALLOW_NON_TEST_DB === "true";

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for workspace model tests.");
  }

  if (!allowNonTestDatabase && !/(^|[_/.-])test([_/.-]|$)/i.test(databaseUrl)) {
    throw new Error(
      "workspace-models.test.ts requires DATABASE_URL to point to a test database. Set WORKSPACE_MODELS_TEST_ALLOW_NON_TEST_DB=true only if you intentionally want to override this guard."
    );
  }
}

async function cleanupTestData() {
  if (!hasSafeDatabaseUrl) {
    return;
  }

  await prisma.workspaceMembership.deleteMany({
    where: {
      OR: [
        { user: { is: { email: { contains: TEST_MARKER } } } },
        { workspace: { is: { slug: { contains: TEST_MARKER } } } },
        { workspace: { is: { owner: { is: { email: { contains: TEST_MARKER } } } } } },
      ],
    },
  });

  await prisma.project.deleteMany({
    where: {
      OR: [
        { workspace: { is: { slug: { contains: TEST_MARKER } } } },
        { workspace: { is: { owner: { is: { email: { contains: TEST_MARKER } } } } } },
        { repo: { is: { owner: { contains: TEST_MARKER } } } },
      ],
    },
  });

  await prisma.workspace.deleteMany({
    where: {
      OR: [
        { slug: { contains: TEST_MARKER } },
        { owner: { is: { email: { contains: TEST_MARKER } } } },
      ],
    },
  });

  await prisma.repo.deleteMany({
    where: { owner: { contains: TEST_MARKER } },
  });

  await prisma.user.deleteMany({
    where: { email: { contains: TEST_MARKER } },
  });
}

async function expectPrismaErrorCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected Prisma error code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe(code);
  }
}

describe("Workspace, Project, and WorkspaceMembership models", () => {
  beforeAll(async () => {
    assertSafeDatabaseUrl();
    hasSafeDatabaseUrl = true;
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should create a PERSONAL workspace with all required fields", async () => {
    const user = await prisma.user.create({
      data: {
        email: getTestEmail("1"),
        name: "Test User 1",
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Test Personal Workspace",
        slug: getTestSlug("personal-workspace"),
        type: "PERSONAL",
        ownerId: user.id,
      },
    });

    expect(workspace.id).toBeDefined();
    expect(workspace.name).toBe("Test Personal Workspace");
    expect(workspace.slug).toBe(getTestSlug("personal-workspace"));
    expect(workspace.type).toBe("PERSONAL");
    expect(workspace.ownerId).toBe(user.id);
    expect(workspace.settings).toBeNull();
    expect(workspace.createdAt).toBeInstanceOf(Date);
    expect(workspace.updatedAt).toBeInstanceOf(Date);
  });

  it("should prevent deleting a user who still owns a workspace", async () => {
    const user = await prisma.user.create({
      data: {
        email: getTestEmail("owner-restrict"),
        name: "Owner Restrict User",
      },
    });

    await prisma.workspace.create({
      data: {
        name: "Owner Restrict Workspace",
        slug: getTestSlug("owner-restrict-workspace"),
        type: "PERSONAL",
        ownerId: user.id,
      },
    });

    await expectPrismaErrorCode(
      prisma.user.delete({
        where: { id: user.id },
      }),
      "P2003"
    );

    expect(
      await prisma.user.findUnique({
        where: { id: user.id },
      })
    ).toBeTruthy();
  });

  it("should enforce unique slug constraint within a workspace for projects", async () => {
    const user = await prisma.user.create({
      data: {
        email: getTestEmail("2"),
        name: "Test User 2",
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Test Workspace for Projects",
        slug: getTestSlug("workspace-projects"),
        type: "TEAM",
        ownerId: user.id,
      },
    });

    // First project should succeed
    const project1 = await prisma.project.create({
      data: {
        name: "Test Project 1",
        slug: "test-project",
        workspaceId: workspace.id,
      },
    });

    expect(project1.slug).toBe("test-project");

    // Second project with same slug in same workspace should fail
    await expectPrismaErrorCode(
      prisma.project.create({
        data: {
          name: "Test Project 2",
          slug: "test-project", // Same slug
          workspaceId: workspace.id,
        },
      }),
      "P2002"
    );

    // But same slug in different workspace should succeed
    const workspace2 = await prisma.workspace.create({
      data: {
        name: "Another Test Workspace",
        slug: getTestSlug("another-workspace"),
        type: "PERSONAL",
        ownerId: user.id,
      },
    });

    const project2 = await prisma.project.create({
      data: {
        name: "Test Project 2",
        slug: "test-project", // Same slug, different workspace
        workspaceId: workspace2.id,
      },
    });

    expect(project2.slug).toBe("test-project");
  });

  it("should enforce unique constraint for user+workspace membership", async () => {
    const user = await prisma.user.create({
      data: {
        email: getTestEmail("3"),
        name: "Test User 3",
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Test Workspace for Membership",
        slug: getTestSlug("workspace-membership"),
        type: "TEAM",
        ownerId: user.id,
      },
    });

    // First membership should succeed
    const membership1 = await prisma.workspaceMembership.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    expect(membership1.role).toBe("OWNER");

    // Second membership for same user+workspace should fail
    await expectPrismaErrorCode(
      prisma.workspaceMembership.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "ADMIN",
        },
      }),
      "P2002"
    );
  });

  it("should cascade delete projects and memberships when workspace is deleted", async () => {
    const user = await prisma.user.create({
      data: {
        email: getTestEmail("4"),
        name: "Test User 4",
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Test Workspace for Cascade",
        slug: getTestSlug("workspace-cascade"),
        type: "TEAM",
        ownerId: user.id,
      },
    });

    // Create projects
    const project1 = await prisma.project.create({
      data: {
        name: "Test Project 1",
        slug: "test-project-1",
        workspaceId: workspace.id,
      },
    });

    const project2 = await prisma.project.create({
      data: {
        name: "Test Project 2",
        slug: "test-project-2",
        workspaceId: workspace.id,
      },
    });

    // Create membership
    const membership = await prisma.workspaceMembership.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    // Verify they exist
    expect(await prisma.project.findUnique({ where: { id: project1.id } })).toBeTruthy();
    expect(await prisma.project.findUnique({ where: { id: project2.id } })).toBeTruthy();
    expect(await prisma.workspaceMembership.findUnique({ where: { id: membership.id } })).toBeTruthy();

    // Delete workspace
    await prisma.workspace.delete({
      where: { id: workspace.id },
    });

    // Verify cascade deletion
    expect(await prisma.project.findUnique({ where: { id: project1.id } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: project2.id } })).toBeNull();
    expect(await prisma.workspaceMembership.findUnique({ where: { id: membership.id } })).toBeNull();
  });

  it("should set repoId to null when repo is deleted (not cascade delete project)", async () => {
    const user = await prisma.user.create({
      data: {
        email: getTestEmail("5"),
        name: "Test User 5",
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Test Workspace for Repo",
        slug: getTestSlug("workspace-repo"),
        type: "PERSONAL",
        ownerId: user.id,
      },
    });

    const repo = await prisma.repo.create({
      data: {
        owner: getTestOwner("5"),
        name: "test-repo",
        displayName: "Test Repo",
        userId: user.id,
      },
    });

    // Create project linked to repo
    const project = await prisma.project.create({
      data: {
        name: "Test Project with Repo",
        slug: "test-project-repo",
        workspaceId: workspace.id,
        repoId: repo.id,
      },
    });

    // Verify project has repoId
    const projectBefore = await prisma.project.findUnique({
      where: { id: project.id },
    });
    expect(projectBefore?.repoId).toBe(repo.id);

    // Delete repo
    await prisma.repo.delete({
      where: { id: repo.id },
    });

    // Verify project still exists but repoId is null
    const projectAfter = await prisma.project.findUnique({
      where: { id: project.id },
    });
    expect(projectAfter).toBeTruthy();
    expect(projectAfter?.repoId).toBeNull();
  });
});
