import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  getGovernanceSettings,
  updateWorkspaceSettings,
  DEFAULT_GOVERNANCE_SETTINGS,
} from "@/lib/workspace/update-workspace-settings";

const prisma = new PrismaClient();
const TEST_MARKER = "test-settings";

function getTestEmail(suffix: string) {
  return `${TEST_MARKER}-${suffix}@example.com`;
}

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for update-workspace-settings tests.");
  }
  if (!/(^|[_/.-])test([_/.-]|$)/i.test(databaseUrl)) {
    throw new Error(
      "update-workspace-settings.test.ts requires DATABASE_URL to point to a test database."
    );
  }
}

async function cleanupTestData() {
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

describe("updateWorkspaceSettings (integration)", () => {
  let ownerUser: { id: string };
  let teamWorkspace: { id: string; slug: string };
  let personalWorkspace: { id: string; slug: string };

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    await cleanupTestData();

    ownerUser = await prisma.user.create({
      data: { email: getTestEmail("owner"), name: "Settings Owner" },
    });

    teamWorkspace = await prisma.workspace.create({
      data: {
        name: "Settings TEAM WS",
        slug: `${TEST_MARKER}-team`,
        type: "TEAM",
        ownerId: ownerUser.id,
        settings: Prisma.JsonNull,
      },
    });

    personalWorkspace = await prisma.workspace.create({
      data: {
        name: "Settings PERSONAL WS",
        slug: `${TEST_MARKER}-personal`,
        type: "PERSONAL",
        ownerId: ownerUser.id,
        settings: Prisma.JsonNull,
      },
    });

    await prisma.workspaceMembership.create({
      data: { workspaceId: teamWorkspace.id, userId: ownerUser.id, role: "OWNER" },
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: personalWorkspace.id, userId: ownerUser.id, role: "OWNER" },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should return DEFAULT_GOVERNANCE_SETTINGS when workspace settings is null", async () => {
    const settings = await getGovernanceSettings(teamWorkspace.id);
    expect(settings).toEqual(DEFAULT_GOVERNANCE_SETTINGS);
  });

  it("should update TEAM workspace settings and read them back", async () => {
    const newSettings = {
      agentRoutingPreference: "manual" as const,
      maxConcurrentTasks: 10,
      autoRecoveryEnabled: false,
      requireApprovalBeforeExecution: true,
    };

    const updated = await updateWorkspaceSettings({
      workspaceId: teamWorkspace.id,
      settings: newSettings,
      actorUserId: ownerUser.id,
    });

    expect(updated.id).toBe(teamWorkspace.id);

    const readBack = await getGovernanceSettings(teamWorkspace.id);
    expect(readBack).toEqual(newSettings);
  });

  it("should merge partial settings with defaults when some keys are missing", async () => {
    await prisma.workspace.update({
      where: { id: teamWorkspace.id },
      data: { settings: { agentRoutingPreference: "manual", maxConcurrentTasks: 3 } },
    });

    const settings = await getGovernanceSettings(teamWorkspace.id);
    expect(settings.agentRoutingPreference).toBe("manual");
    expect(settings.maxConcurrentTasks).toBe(3);
    expect(settings.autoRecoveryEnabled).toBe(DEFAULT_GOVERNANCE_SETTINGS.autoRecoveryEnabled);
    expect(settings.requireApprovalBeforeExecution).toBe(
      DEFAULT_GOVERNANCE_SETTINGS.requireApprovalBeforeExecution
    );
  });

  it("should throw TEAM_WORKSPACE_REQUIRED when updating a PERSONAL workspace", async () => {
    await expect(
      updateWorkspaceSettings({
        workspaceId: personalWorkspace.id,
        settings: DEFAULT_GOVERNANCE_SETTINGS,
        actorUserId: ownerUser.id,
      })
    ).rejects.toThrow("TEAM_WORKSPACE_REQUIRED");
  });
});
