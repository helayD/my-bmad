import type { TaskCreationContext, TaskIntent, TaskLifecycleSnapshot, TaskPriority } from "./types";

export const DEFAULT_TASK_PRIORITY: TaskPriority = "medium";
export const DEFAULT_TASK_INTENT: TaskIntent = "implement";
export const DEFAULT_TASK_STATUS = "pending" as const;

export function getInitialTaskLifecycle(): TaskLifecycleSnapshot {
  return {
    status: DEFAULT_TASK_STATUS,
    currentStage: "任务已创建",
    currentActivity: "系统已接收任务，正在整理来源工件上下文并准备进入执行派发。",
    nextStep: "下一步将进入执行派发阶段，并基于来源工件上下文生成执行计划。",
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
