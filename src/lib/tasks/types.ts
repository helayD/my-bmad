import { z } from "zod";
import type { ArtifactTypeString } from "@/lib/artifacts/types";

export const TASK_STATUS_VALUES = [
  "planned",
  "pending",
  "dispatched",
  "in-progress",
  "review",
  "done",
  "blocked",
] as const;
export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];
export const TASK_TERMINAL_STATUS_VALUES = ["done", "blocked"] as const;
export type TaskTerminalStatus = (typeof TASK_TERMINAL_STATUS_VALUES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  planned: "已计划",
  pending: "待处理",
  dispatched: "已派发",
  "in-progress": "进行中",
  review: "待评审",
  done: "已完成",
  blocked: "已阻塞",
};

export const TASK_AGENT_TYPE_VALUES = ["codex", "claude-code"] as const;
export type TaskAgentType = (typeof TASK_AGENT_TYPE_VALUES)[number];

export const TASK_AGENT_TYPE_LABELS: Record<TaskAgentType, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

export const TASK_PREFERRED_AGENT_TYPE_VALUES = [
  "auto",
  ...TASK_AGENT_TYPE_VALUES,
] as const;
export type TaskPreferredAgentType = (typeof TASK_PREFERRED_AGENT_TYPE_VALUES)[number];

export const TASK_PREFERRED_AGENT_TYPE_LABELS: Record<TaskPreferredAgentType, string> = {
  auto: "自动选择",
  codex: "优先 Codex",
  "claude-code": "优先 Claude Code",
};

export const TASK_AGENT_RUN_STATUS_VALUES = [
  "dispatched",
  "running",
  "completed",
  "failed",
  "terminated",
  "superseded",
] as const;
export type TaskAgentRunStatus = (typeof TASK_AGENT_RUN_STATUS_VALUES)[number];

export const TASK_AGENT_RUN_STATUS_LABELS: Record<TaskAgentRunStatus, string> = {
  dispatched: "已派发",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  terminated: "已终止",
  superseded: "已替代",
};

// ── ExecutionSession ────────────────────────────────────────────────────────────

export const EXECUTION_SESSION_STATUS_VALUES = [
  "starting",
  "running",
  "completed",
  "terminated",
  "failed",
] as const;
export type ExecutionSessionStatus = (typeof EXECUTION_SESSION_STATUS_VALUES)[number];

export const EXECUTION_SESSION_STATUS_LABELS: Record<ExecutionSessionStatus, string> = {
  starting: "启动中",
  running: "运行中",
  completed: "已完成",
  terminated: "已终止",
  failed: "失败",
};

/** Maps AC-visible completion code to internal status value */
export function resolveExecutionSessionCompletedStatus(): ExecutionSessionStatus {
  return "completed";
}

/** Maps AC-visible termination code to internal status value */
export function resolveExecutionSessionTerminatedStatus(): ExecutionSessionStatus {
  return "terminated";
}

export interface ExecutionSessionView {
  id: string;
  taskId: string;
  agentRunId: string;
  transport: string;
  sessionName: string;
  processPid: number | null;
  status: ExecutionSessionStatus;
  statusLabel: string;
  startedAt: string | null;
  completedAt: string | null;
  terminatedAt: string | null;
  terminationReasonCode: string | null;
  terminationReasonSummary: string | null;
  createdAt: string;
}

export interface ExecutionSessionSummary {
  sessionName: string;
  transport: string;
  processPid: number | null;
  startedAt: string | null;
  status: ExecutionSessionStatus;
  statusLabel: string;
}

export const TASK_ROUTING_DECISION_SOURCE_VALUES = [
  "manual-selection",
  "task-preference",
  "project-default",
  "intent-heuristic",
  "manual-reroute",
] as const;
export type TaskRoutingDecisionSource = (typeof TASK_ROUTING_DECISION_SOURCE_VALUES)[number];

export interface TaskRoutingDecisionSummary {
  selectedAgentType: TaskAgentType;
  decisionSource: TaskRoutingDecisionSource;
  selectionReasonCode: string;
  selectionReasonSummary: string;
  matchedSignals: string[];
  agentRunId: string | null;
  replacedAgentRunId?: string | null;
  routedAt?: string | null;
  reroutedAt?: string | null;
}

export interface TaskAgentRunView {
  id: string;
  agentType: TaskAgentType;
  agentTypeLabel: string;
  status: TaskAgentRunStatus;
  statusLabel: string;
  decisionSource: TaskRoutingDecisionSource;
  selectionReasonCode: string;
  selectionReasonSummary: string;
  matchedSignals: string[];
  requestedByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  terminatedAt: string | null;
  supersededAt: string | null;
  terminationReasonCode: string | null;
  terminationReasonSummary: string | null;
  replacesRunId: string | null;
  replacementRunId: string | null;
  isCurrent: boolean;
  summary: string;
}

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

export const TASK_TITLE_MAX_LENGTH = 120;
export const TASK_GOAL_MAX_LENGTH = 500;
export const TASK_INTENT_DETAIL_MAX_LENGTH = 500;

export const TASK_CREATE_FORM_DEFAULTS = {
  title: "",
  goal: "",
  priority: "medium",
  intent: "implement",
  intentDetail: "",
  preferredAgentType: "auto",
} as const satisfies {
  title: string;
  goal: string;
  priority: TaskPriority;
  intent: TaskIntent;
  intentDetail: string;
  preferredAgentType: TaskPreferredAgentType;
};

const optionalTaskTextSchema = (maxLength: number, tooLongMessage: string) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (typeof value !== "string") {
        return undefined;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .refine(
      (value) => value === undefined || value.length <= maxLength,
      tooLongMessage,
    );

export const taskCreateFieldsSchema = z.object({
  title: z
    .string()
    .optional()
    .transform((value) => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .refine(
      (value) => value === undefined || value.length <= TASK_TITLE_MAX_LENGTH,
      `任务标题不能超过 ${TASK_TITLE_MAX_LENGTH} 个字符。`,
    ),
  goal: z
    .string()
    .trim()
    .min(1, "请输入任务目标。")
    .max(TASK_GOAL_MAX_LENGTH, `任务目标不能超过 ${TASK_GOAL_MAX_LENGTH} 个字符。`),
  priority: z.enum(TASK_PRIORITY_VALUES),
  intent: z.enum(TASK_INTENT_VALUES),
  intentDetail: optionalTaskTextSchema(
    TASK_INTENT_DETAIL_MAX_LENGTH,
    `执行意图补充不能超过 ${TASK_INTENT_DETAIL_MAX_LENGTH} 个字符。`,
  ),
  preferredAgentType: z
    .enum(TASK_PREFERRED_AGENT_TYPE_VALUES)
    .optional()
    .default(TASK_CREATE_FORM_DEFAULTS.preferredAgentType),
});

export const taskCreateInputSchema = taskCreateFieldsSchema.extend({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  artifactId: z
    .union([z.string().cuid2(), z.null(), z.undefined()])
    .transform((value) => (typeof value === "string" ? value : undefined)),
});

export type TaskCreateFieldsInput = z.input<typeof taskCreateFieldsSchema>;
export type TaskCreateFields = z.output<typeof taskCreateFieldsSchema>;
export type TaskCreateInput = z.input<typeof taskCreateInputSchema>;
export type TaskCreatePayload = z.output<typeof taskCreateInputSchema>;

export function getTaskCreateFieldErrors(input: TaskCreateFieldsInput) {
  const result = taskCreateFieldsSchema.safeParse(input);
  if (result.success) {
    return {};
  }

  return result.error.flatten().fieldErrors;
}

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
  sourceArtifact: TaskSourceReference | null;
}

// ── Execution Queue ─────────────────────────────────────────────────────────────────

/** The single source of truth for an execution queue snapshot stored in Task.metadata */
export interface ExecutionQueueSnapshot {
  /** 1-based queue position within the workspace-level FIFO queue, or null if not queued */
  queuePosition: number | null;
  /** ISO timestamp when the task entered the execution wait queue */
  queuedAt: string | null;
  /** Current workspace-level active session count (starting + running) */
  workspaceActiveConcurrentTasks: number;
  /** Current project-level active session count */
  projectActiveConcurrentTasks: number;
  /** Workspace max concurrent tasks from governance settings */
  maxConcurrentTasks: number;
  /** Estimated seconds until a slot becomes available */
  estimatedWaitSeconds: number | null;
  /** Human-readable wait estimate label */
  estimatedWaitLabel: string | null;
  /** Why the task is queued */
  queueReasonCode: ExecutionQueueReasonCode;
  /** Human-readable queue reason summary */
  queueReasonSummary: string;
}

export type ExecutionQueueReasonCode =
  | "WORKSPACE_CAPACITY_FULL"
  | "PROJECT_ISOLATION"
  | "ADMISSION_IN_PROGRESS"
  | "ALREADY_QUEUED";

export const EXECUTION_QUEUE_REASON_LABELS: Record<ExecutionQueueReasonCode, string> = {
  WORKSPACE_CAPACITY_FULL: "工作空间并发上限已满",
  PROJECT_ISOLATION: "项目隔离保护",
  ADMISSION_IN_PROGRESS: "准入判定中",
  ALREADY_QUEUED: "已排队等待",
};

export interface ConcurrencySnapshot {
  workspaceId: string;
  projectId: string;
  maxConcurrentTasks: number;
  workspaceActiveConcurrentTasks: number;
  projectActiveConcurrentTasks: number;
  hasCapacity: boolean;
  queueAhead: number;
}

/** Result of attempting to admit a task into an execution slot */
export type AdmissionResult =
  | { outcome: "admitted"; executionSessionId: string }
  | { outcome: "queued"; queueSnapshot: ExecutionQueueSnapshot }
  | { outcome: "idempotent"; queueSnapshot: ExecutionQueueSnapshot }
