import { STATUS_LABELS, type TaskStatus, type StateTransitionTrigger } from "./types";

export interface StageContext {
  currentStage: string;
  currentActivity: string;
  nextStep: string;
}

export function deriveStageContext(
  newStatus: TaskStatus,
  trigger: StateTransitionTrigger,
): StageContext {
  const baseContext: Record<TaskStatus, StageContext> = {
    planned: {
      currentStage: "已计划",
      currentActivity: "任务已创建，等待派发",
      nextStep: "点击「派发」启动任务执行",
    },
    pending: {
      currentStage: "排队中",
      currentActivity: "正在等待执行槽位",
      nextStep: "等待系统分配执行资源",
    },
    dispatched: {
      currentStage: "已派发",
      currentActivity: "任务已派发，等待执行监督器启动",
      nextStep: "执行监督器正在准备启动",
    },
    starting: {
      currentStage: "启动中",
      currentActivity: "执行监督器正在创建会话",
      nextStep: "正在启动 tmux 会话和 Agent",
    },
    running: {
      currentStage: "运行中",
      currentActivity: "Agent 正在执行任务",
      nextStep: "持续监控执行进度",
    },
    waiting_for_input: {
      currentStage: "等待输入",
      currentActivity: "Agent 请求人工输入或确认",
      nextStep: "查看请求并提供响应",
    },
    recovering: {
      currentStage: "恢复中",
      currentActivity: "检测到异常，系统正在尝试自动恢复",
      nextStep: "等待恢复结果",
    },
    awaiting_takeover: {
      currentStage: "等待接管",
      currentActivity: "自动恢复失败，需要人工接管",
      nextStep: "查看详情并决定处置方式",
    },
    completed: {
      currentStage: "已完成",
      currentActivity: "Agent 执行成功完成",
      nextStep: "正在回写执行结果",
    },
    failed: {
      currentStage: "执行失败",
      currentActivity: "Agent 执行过程中发生错误",
      nextStep: "查看错误详情或重新派发",
    },
    terminated: {
      currentStage: "已终止",
      currentActivity: "任务被人工或系统终止",
      nextStep: "查看终止原因",
    },
    writeback_pending: {
      currentStage: "回写中",
      currentActivity: "正在将结果回写到工件链路",
      nextStep: "等待回写完成",
    },
    writeback_done: {
      currentStage: "已回写",
      currentActivity: "执行结果已成功回写",
      nextStep: "可在来源工件查看执行结果",
    },
  };

  const context = baseContext[newStatus];

  if (trigger === "system_recovery" && newStatus === "running") {
    context.currentActivity = "自动恢复成功，Agent 继续执行";
    context.nextStep = "持续监控执行进度";
  }

  if (trigger === "user_takeover" && newStatus === "running") {
    context.currentActivity = "人工接管后继续执行";
    context.nextStep = "持续监控执行进度";
  }

  return context;
}
