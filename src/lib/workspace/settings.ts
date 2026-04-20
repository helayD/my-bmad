import { workspaceGovernanceSettingsSchema, type WorkspaceGovernanceSettingsInput } from "@/lib/workspace/types";

export const DEFAULT_WORKSPACE_GOVERNANCE_SETTINGS: WorkspaceGovernanceSettingsInput = {
  agentRoutingPreference: "auto",
  maxConcurrentTasks: 5,
  autoRecoveryEnabled: true,
  requireApprovalBeforeExecution: false,
  autoDispatchAfterPlanning: false,
};

export function resolveWorkspaceGovernanceSettings(
  settings: unknown,
): WorkspaceGovernanceSettingsInput {
  const parsed = workspaceGovernanceSettingsSchema.safeParse(settings);
  if (parsed.success) {
    return parsed.data;
  }

  const baseRecord = toRecord(settings);

  return {
    ...DEFAULT_WORKSPACE_GOVERNANCE_SETTINGS,
    ...(baseRecord.agentRoutingPreference === "auto" || baseRecord.agentRoutingPreference === "manual"
      ? { agentRoutingPreference: baseRecord.agentRoutingPreference }
      : {}),
    ...(typeof baseRecord.maxConcurrentTasks === "number" ? { maxConcurrentTasks: baseRecord.maxConcurrentTasks } : {}),
    ...(typeof baseRecord.autoRecoveryEnabled === "boolean" ? { autoRecoveryEnabled: baseRecord.autoRecoveryEnabled } : {}),
    ...(typeof baseRecord.requireApprovalBeforeExecution === "boolean" ? { requireApprovalBeforeExecution: baseRecord.requireApprovalBeforeExecution } : {}),
    ...(typeof baseRecord.autoDispatchAfterPlanning === "boolean" ? { autoDispatchAfterPlanning: baseRecord.autoDispatchAfterPlanning } : {}),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
