import type {
  TaskCreationContext,
  TaskIntent,
  TaskLifecycleSnapshot,
  TaskPriority,
} from "./types";

export const DEFAULT_TASK_PRIORITY: TaskPriority = "medium";
export const DEFAULT_TASK_INTENT: TaskIntent = "implement";
export const DEFAULT_TASK_STATUS = "pending" as const;
export const DEFAULT_PLANNED_TASK_STATUS = "planned" as const;

export function getInitialTaskLifecycle(): TaskLifecycleSnapshot {
  return {
    status: DEFAULT_TASK_STATUS,
    currentStage: "任务已创建",
    currentActivity: "系统已接收任务，正在整理来源工件上下文并准备进入执行派发。",
    nextStep: "下一步将进入执行派发阶段，并基于来源工件上下文生成执行计划。",
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
  };
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
