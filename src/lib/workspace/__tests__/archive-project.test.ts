import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { archiveProject } from "@/lib/workspace/archive-project";

const prisma = new PrismaClient();
const TEST_MARKER = "test-archive-proj";

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
      "archive-project.test.ts requires DATABASE_URL to point to a test database."
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

describe("archiveProject (integration)", () => {
  let workspaceId: string;
  let otherWorkspaceId: string;
  let activeProjectId: string;

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    const user = await prisma.user.create({
      data: { email: getTestEmail("archive"), name: "Archive Test" },
    });
    const ws = await prisma.workspace.create({
      data: {
        name: "Archive Test Workspace",
        slug: `${TEST_MARKER}-ws`,
        type: "TEAM",
        ownerId: user.id,
      },
    });
    const otherWs = await prisma.workspace.create({
      data: {
        name: "Other Workspace",
        slug: `${TEST_MARKER}-other`,
        type: "TEAM",
        ownerId: user.id,
      },
    });
    workspaceId = ws.id;
    otherWorkspaceId = otherWs.id;

    const project = await prisma.project.create({
      data: {
        name: "Active Project",
        slug: `${TEST_MARKER}-active`,
        workspaceId,
        status: "active",
      },
    });
    activeProjectId = project.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should archive an active project", async () => {
    const result = await archiveProject(activeProjectId, workspaceId);

    expect(result.status).toBe("archived");
    expect(result.id).toBe(activeProjectId);
  });

  it("should reject archiving a project from a different workspace", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Cross WS Project",
        slug: `${TEST_MARKER}-cross`,
        workspaceId,
        status: "active",
      },
    });

    await expect(
      archiveProject(project.id, otherWorkspaceId)
    ).rejects.toThrow("Le projet est introuvable dans cet espace de travail.");
  });

  it("should reject archiving an already archived project", async () => {
    // activeProjectId was already archived in the first test
    await expect(
      archiveProject(activeProjectId, workspaceId)
    ).rejects.toThrow("Seuls les projets actifs peuvent être archivés.");
  });
});
