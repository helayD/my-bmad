import type { ArtifactTypeString } from "@/lib/artifacts/types";

export const TASK_STATUS_VALUES = ["pending", "in-progress", "review", "done", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "待处理",
  "in-progress": "进行中",
  review: "待评审",
  done: "已完成",
  blocked: "已阻塞",
};

export const TASK_PRIORITY_VALUES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

export const TASK_INTENT_VALUES = ["implement", "fix", "research"] as const;
export type TaskIntent = (typeof TASK_INTENT_VALUES)[number];

export const TASK_INTENT_LABELS: Record<TaskIntent, string> = {
  implement: "实现",
  fix: "修复",
  research: "调研",
};

export interface TaskSourceReference {
  artifactId: string;
  artifactType: ArtifactTypeString;
  artifactName: string;
  filePath: string;
  hierarchy: Array<{
    id: string;
    type: ArtifactTypeString;
    name: string;
  }>;
}

export interface TaskCreationContext {
  sourceArtifact: TaskSourceReference;
  title: string;
  goal: string;
  summary: string;
  detailMarkdown: string;
  acceptanceCriteria: string[];
  relatedStoryIds: string[];
  suggestedPriority: TaskPriority;
  suggestedIntent: TaskIntent;
}

export interface TaskCreateInput {
  workspaceId: string;
  projectId: string;
  artifactId: string;
  title: string;
  goal: string;
  priority: TaskPriority;
  intent: TaskIntent;
}

export interface TaskLifecycleSnapshot {
  status: TaskStatus;
  currentStage: string;
  currentActivity: string;
  nextStep: string;
}

export interface CreatedTaskPayload extends TaskLifecycleSnapshot {
  taskId: string;
  sourceArtifact: TaskSourceReference;
}
