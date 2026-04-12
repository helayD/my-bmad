import type { ArtifactTypeString } from "@/lib/artifacts/types";

export const TASK_STATUS_VALUES = ["pending", "in-progress", "review", "done", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];
export const TASK_TERMINAL_STATUS_VALUES = ["done", "blocked"] as const;
export type TaskTerminalStatus = (typeof TASK_TERMINAL_STATUS_VALUES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "待处理",
  "in-progress": "进行中",
  review: "待评审",
  done: "已完成",
  blocked: "已阻塞",
};

export const WRITEBACK_OUTCOME_VALUES = ["completed", "failed", "interrupted"] as const;
export type WritebackOutcome = (typeof WRITEBACK_OUTCOME_VALUES)[number];

export const WRITEBACK_OUTCOME_LABELS: Record<WritebackOutcome, string> = {
  completed: "已完成",
  failed: "执行失败",
  interrupted: "已中断",
};

export const WRITEBACK_STATUS_VALUES = ["succeeded", "failed"] as const;
export type WritebackStatus = (typeof WRITEBACK_STATUS_VALUES)[number];

export const WRITEBACK_STATUS_LABELS: Record<WritebackStatus, string> = {
  succeeded: "回写成功",
  failed: "回写失败",
};

export const ARTIFACT_EXECUTION_STATUS_VALUES = [
  "completed",
  "failed",
  "recovery-pending",
  "retry-pending",
] as const;
export type ArtifactExecutionSnapshotStatus = (typeof ARTIFACT_EXECUTION_STATUS_VALUES)[number];

export const ARTIFACT_EXECUTION_SNAPSHOT_STATUS_LABELS: Record<ArtifactExecutionSnapshotStatus, string> = {
  completed: "已完成",
  failed: "执行失败",
  "recovery-pending": "待恢复",
  "retry-pending": "待重试",
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

export interface TaskArtifactReference {
  type: string;
  filePath: string;
  generatedAt: string | null;
  summary: string;
}

export interface TaskWritebackView {
  id: string;
  taskId: string;
  artifactId: string;
  outcome: WritebackOutcome;
  writebackStatus: WritebackStatus;
  summary: string;
  errorSummary: string | null;
  occurredAt: string;
  recoveryHint: string | null;
  artifacts: TaskArtifactReference[];
}

export interface TaskTerminalStateUpdateInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  status: TaskTerminalStatus;
  currentStage: string;
  nextStep: string;
  currentActivity?: string;
  resultSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskTerminalStateUpdateResult extends TaskLifecycleSnapshot {
  taskId: string;
  artifactId: string | null;
  writeback: TaskWritebackView | null;
}

export interface CreatedTaskPayload extends TaskLifecycleSnapshot {
  taskId: string;
  sourceArtifact: TaskSourceReference;
}
