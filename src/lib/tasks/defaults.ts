import type {
  TaskCreateFields,
  TaskCreationContext,
  TaskIntent,
  TaskLifecycleSnapshot,
  TaskPriority,
  TaskPreferredAgentType,
} from "./types";

export const DEFAULT_TASK_PRIORITY: TaskPriority = "medium";
export const DEFAULT_TASK_INTENT: TaskIntent = "implement";
export const DEFAULT_TASK_STATUS = "pending" as const;
export const DEFAULT_PLANNED_TASK_STATUS = "planned" as const;
export const DEFAULT_TASK_PREFERRED_AGENT_TYPE: TaskPreferredAgentType = "auto";

export function getInitialTaskLifecycle(): TaskLifecycleSnapshot {
  return {
    status: DEFAULT_TASK_STATUS,
    currentStage: "任务已创建",
    currentActivity: "系统已接收任务，正在整理来源工件上下文并准备进入执行派发。",
    nextStep: "下一步将进入执行派发阶段，并基于来源工件上下文生成执行计划。",
  };
}

interface ManualTaskLifecycleOptions {
  requireApprovalBeforeExecution: boolean;
}

export function getManualTaskLifecycle(
  options: ManualTaskLifecycleOptions,
): TaskLifecycleSnapshot {
  if (options.requireApprovalBeforeExecution) {
    return {
      status: DEFAULT_PLANNED_TASK_STATUS,
      currentStage: "已计划",
      currentActivity: "任务已计划完成，正在等待审批后再进入执行派发。",
      nextStep: "等待审批通过后进入派发阶段。",
    };
  }

  return {
    status: DEFAULT_PLANNED_TASK_STATUS,
    currentStage: "已计划",
    currentActivity: "任务已计划完成，当前尚未开始编码或启动执行。",
    nextStep: "下一步可进入执行派发阶段。",
  };
}

interface PlannedTaskLifecycleOptions {
  autoDispatchAfterPlanning: boolean;
  requireApprovalBeforeExecution: boolean;
}

export function getPlannedTaskLifecycle(
  options: PlannedTaskLifecycleOptions,
): TaskLifecycleSnapshot {
  if (options.requireApprovalBeforeExecution) {
    return {
      status: DEFAULT_PLANNED_TASK_STATUS,
      currentStage: "已计划",
      currentActivity: options.autoDispatchAfterPlanning
        ? "任务已进入自动派发候选顺序，但在审批通过前不会开始编码。"
        : "任务已计划完成，但在审批通过前不会开始编码。",
      nextStep: options.autoDispatchAfterPlanning
        ? "等待审批通过后进入自动派发阶段。"
        : "等待审批通过后再进入手动派发阶段。",
    };
  }

  if (options.autoDispatchAfterPlanning) {
    return {
      status: DEFAULT_PLANNED_TASK_STATUS,
      currentStage: "已计划",
      currentActivity: "任务已进入自动派发准备顺序，当前尚未开始编码。",
      nextStep: "下一步将按优先级进入自动派发阶段。",
    };
  }

  return {
    status: DEFAULT_PLANNED_TASK_STATUS,
    currentStage: "已计划",
    currentActivity: "任务已生成并进入执行准备阶段，等待手动派发。",
    nextStep: "下一步可由用户手动派发进入执行。",
  };
}

export function buildDefaultTaskDraft(context: TaskCreationContext) {
  return {
    title: `围绕《${context.sourceArtifact.artifactName}》发起执行`,
    goal: `基于${formatArtifactLabel(context.sourceArtifact.artifactType)}《${context.sourceArtifact.artifactName}》推进实现。`,
    priority: context.suggestedPriority,
    intent: context.suggestedIntent,
    intentDetail: "",
    preferredAgentType: DEFAULT_TASK_PREFERRED_AGENT_TYPE,
  };
}

export function buildEmptyTaskDraft(): TaskCreateFields {
  return {
    title: undefined,
    goal: "",
    priority: DEFAULT_TASK_PRIORITY,
    intent: DEFAULT_TASK_INTENT,
    intentDetail: undefined,
    preferredAgentType: DEFAULT_TASK_PREFERRED_AGENT_TYPE,
  };
}

interface BuildTaskTitleFromGoalInput {
  goal: string;
  sourceArtifactName?: string | null;
}

export function buildTaskTitleFromGoal(input: BuildTaskTitleFromGoalInput): string {
  const normalizedGoal = normalizeTaskTitleFragment(input.goal);
  const prefix = input.sourceArtifactName
    ? `围绕《${input.sourceArtifactName}》执行`
    : "项目任务";

  return normalizedGoal ? `${prefix}：${normalizedGoal}` : prefix;
}

function formatArtifactLabel(type: TaskCreationContext["sourceArtifact"]["artifactType"]) {
  switch (type) {
    case "PRD":
      return "PRD";
    case "EPIC":
      return "Epic";
    case "STORY":
      return "Story";
    case "TASK":
      return "Task";
    default:
      return "工件";
  }
}

function normalizeTaskTitleFragment(goal: string) {
  const normalized = goal
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[。！？；，、]+$/u, "");

  if (normalized.length <= 0) {
    return "";
  }

  return normalized.length > 60 ? `${normalized.slice(0, 60).trim()}…` : normalized;
}

// ── Execution Queue lifecycle helpers (§4.5 Task 2.5) ───────────────────────────────

interface QueuedTaskLifecycleOptions {
  queuePosition: number;
  estimatedWaitLabel: string | null;
  queueReasonSummary: string;
  workspaceActiveConcurrentTasks: number;
  maxConcurrentTasks: number;
}

export function getQueuedTaskLifecycle(options: QueuedTaskLifecycleOptions): TaskLifecycleSnapshot {
  return {
    status: "dispatched",
    currentStage: "等待执行槽位",
    currentActivity: `任务已排入等待队列（顺位：${options.queuePosition}）。${options.queueReasonSummary}`,
    nextStep: options.estimatedWaitLabel ?? "系统会在执行槽位空闲后自动启动此任务。",
  };
}

interface AutoPromotedTaskLifecycleOptions {
  queuePosition: number;
  estimatedWaitLabel: string | null;
}

export function getAutoPromotedTaskLifecycle(options: AutoPromotedTaskLifecycleOptions): TaskLifecycleSnapshot {
  return {
    status: "dispatched",
    currentStage: "等待执行槽位确认",
    currentActivity: options.estimatedWaitLabel
      ?? "前序任务已结束，执行监督器正在为您争取执行槽位……",
    nextStep: "系统会在获取启动资格后立即开始执行。",
  };
}

interface CapacityEstimateLabelOptions {
  queuePosition: number;
  workspaceActiveConcurrentTasks: number;
  maxConcurrentTasks: number;
  estimatedWaitLabel: string | null;
}

export function getCapacityEstimateLabel(options: CapacityEstimateLabelOptions): string {
  const { workspaceActiveConcurrentTasks, maxConcurrentTasks, queuePosition, estimatedWaitLabel } = options;
  if (queuePosition <= 0) {
    return `工作空间并发：${workspaceActiveConcurrentTasks}/${maxConcurrentTasks}，执行槽位可用。`;
  }
  return `工作空间并发：${workspaceActiveConcurrentTasks}/${maxConcurrentTasks}，等待顺位：${queuePosition}。${estimatedWaitLabel ?? ""}`;
}
