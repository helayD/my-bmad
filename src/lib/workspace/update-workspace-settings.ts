import { prisma } from "@/lib/db/client";
import type { Workspace } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { WorkspaceGovernanceSettingsInput } from "@/lib/workspace/types";

export const DEFAULT_GOVERNANCE_SETTINGS: WorkspaceGovernanceSettingsInput = {
  agentRoutingPreference: "auto",
  maxConcurrentTasks: 5,
  autoRecoveryEnabled: true,
  requireApprovalBeforeExecution: false,
};

export async function getGovernanceSettings(
  workspaceId: string
): Promise<WorkspaceGovernanceSettingsInput> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true },
  });

  const rawSettings = (workspace?.settings ?? null) as Partial<WorkspaceGovernanceSettingsInput> | null;
  return {
    ...DEFAULT_GOVERNANCE_SETTINGS,
    ...(rawSettings ?? {}),
  };
}

export async function updateWorkspaceSettings(params: {
  workspaceId: string;
  settings: WorkspaceGovernanceSettingsInput;
  actorUserId: string;
}): Promise<Workspace> {
  const { workspaceId, settings, actorUserId } = params;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
  });

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  if (workspace.type !== "TEAM") {
    throw new Error("TEAM_WORKSPACE_REQUIRED");
  }

  const previousSettings = (workspace.settings ?? null) as Partial<WorkspaceGovernanceSettingsInput> | null;

  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { settings: settings as unknown as Prisma.InputJsonValue },
  });

  console.info("[AUDIT]", JSON.stringify({
    event: "workspace.settings.updated",
    workspaceId,
    actorUserId,
    previousSettings,
    newSettings: settings,
    timestamp: new Date().toISOString(),
  }));

  return updated;
}
