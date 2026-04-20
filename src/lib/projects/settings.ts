import { z } from "zod";
import { TASK_AGENT_TYPE_VALUES, type TaskAgentType } from "@/lib/tasks";

const PROJECT_DEFAULT_AGENT_VALUES = ["inherit", ...TASK_AGENT_TYPE_VALUES] as const;

export type ProjectDefaultAgentType = (typeof PROJECT_DEFAULT_AGENT_VALUES)[number];

export interface ProjectExecutionSettings {
  defaultAgentType: ProjectDefaultAgentType;
}

export const DEFAULT_PROJECT_EXECUTION_SETTINGS: ProjectExecutionSettings = {
  defaultAgentType: "inherit",
};

const projectExecutionSettingsSchema = z.object({
  defaultAgentType: z.enum(PROJECT_DEFAULT_AGENT_VALUES).optional(),
}).passthrough();

export function getProjectExecutionSettings(settings: unknown): ProjectExecutionSettings {
  const parsed = projectExecutionSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    return DEFAULT_PROJECT_EXECUTION_SETTINGS;
  }

  return {
    defaultAgentType: parsed.data.defaultAgentType ?? DEFAULT_PROJECT_EXECUTION_SETTINGS.defaultAgentType,
  };
}

export function resolveProjectDefaultAgentType(settings: unknown): TaskAgentType | null {
  const executionSettings = getProjectExecutionSettings(settings);
  return executionSettings.defaultAgentType === "inherit"
    ? null
    : executionSettings.defaultAgentType;
}
