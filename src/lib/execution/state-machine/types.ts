import { z } from "zod";

// ── Task Status ────────────────────────────────────────────────────────────────

export const TASK_STATUS_VALUES = [
  "planned",
  "pending",
  "dispatched",
  "starting",
  "running",
  "waiting_for_input",
  "recovering",
  "awaiting_takeover",
  "completed",
  "failed",
  "terminated",
  "writeback_pending",
  "writeback_done",
] as const;

export type TaskStatus = typeof TASK_STATUS_VALUES[number];

export type TaskStatusString = string & { __brand: "TaskStatus" };

// ── Status Category ────────────────────────────────────────────────────────────

export type TaskStatusCategory = "active" | "terminal" | "recovery" | "writeback";

export const STATUS_CATEGORY: Record<TaskStatus, TaskStatusCategory> = {
  planned: "active",
  pending: "active",
  dispatched: "active",
  starting: "active",
  running: "active",
  waiting_for_input: "active",
  recovering: "recovery",
  awaiting_takeover: "recovery",
  completed: "terminal",
  failed: "terminal",
  terminated: "terminal",
  writeback_pending: "writeback",
  writeback_done: "terminal",
} as const;

export const STATUS_CATEGORY_LABELS: Record<TaskStatusCategory, { zh: string; en: string }> = {
  active: { zh: "进行中", en: "Active" },
  terminal: { zh: "终态", en: "Terminal" },
  recovery: { zh: "恢复中", en: "Recovering" },
  writeback: { zh: "回写中", en: "Writeback" },
};

// ── Valid Transitions ────────────────────────────────────────────────────────

export const VALID_TRANSITIONS: { [K in TaskStatus]: TaskStatus[] } = {
  planned: ["pending", "dispatched", "planned"],
  pending: ["dispatched", "failed", "terminated"],
  dispatched: ["starting", "pending", "failed", "terminated"],
  starting: ["running", "failed", "terminated"],
  running: [
    "waiting_for_input",
    "recovering",
    "awaiting_takeover",
    "completed",
    "failed",
    "terminated",
  ],
  waiting_for_input: ["running", "recovering", "awaiting_takeover", "failed", "terminated"],
  recovering: ["running", "awaiting_takeover", "failed", "terminated"],
  awaiting_takeover: ["running", "completed", "failed", "terminated"],
  completed: ["writeback_pending", "planned"],
  failed: ["writeback_pending", "planned"],
  terminated: ["writeback_pending", "planned"],
  writeback_pending: ["writeback_done"],
  writeback_done: [],
};

// ── Status Labels ─────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<TaskStatus, { zh: string; en: string; description: string }> = {
  planned: {
    zh: "已计划",
    en: "Planned",
    description: "任务已计划，等待派发",
  },
  pending: {
    zh: "排队中",
    en: "Pending",
    description: "任务在队列中等待执行槽位",
  },
  dispatched: {
    zh: "已派发",
    en: "Dispatched",
    description: "任务已派发，等待执行监督器启动",
  },
  starting: {
    zh: "启动中",
    en: "Starting",
    description: "执行监督器正在创建会话",
  },
  running: {
    zh: "运行中",
    en: "Running",
    description: "任务正在执行中",
  },
  waiting_for_input: {
    zh: "等待输入",
    en: "Waiting for Input",
    description: "Agent 等待人工输入或确认",
  },
  recovering: {
    zh: "恢复中",
    en: "Recovering",
    description: "任务正在自动恢复",
  },
  awaiting_takeover: {
    zh: "等待接管",
    en: "Awaiting Takeover",
    description: "任务等待人工接管",
  },
  completed: {
    zh: "已完成",
    en: "Completed",
    description: "任务执行成功完成",
  },
  failed: {
    zh: "执行失败",
    en: "Failed",
    description: "任务执行失败",
  },
  terminated: {
    zh: "已终止",
    en: "Terminated",
    description: "任务被人工或系统终止",
  },
  writeback_pending: {
    zh: "回写中",
    en: "Writeback Pending",
    description: "正在将结果回写到工件链路",
  },
  writeback_done: {
    zh: "已回写",
    en: "Writeback Done",
    description: "结果已回写，任务完全结束",
  },
};

// ── Status Semantics (UI color & icon mapping) ────────────────────────────────

export const STATUS_SEMANTICS: Record<TaskStatus, {
  color: "primary" | "success" | "warning" | "danger" | "muted";
  icon: string;
  ariaLabel: string;
}> = {
  planned: { color: "muted", icon: "FileText", ariaLabel: "已计划" },
  pending: { color: "warning", icon: "Clock", ariaLabel: "排队中" },
  dispatched: { color: "primary", icon: "Send", ariaLabel: "已派发" },
  starting: { color: "primary", icon: "Loader", ariaLabel: "启动中" },
  running: { color: "primary", icon: "Play", ariaLabel: "运行中" },
  waiting_for_input: { color: "warning", icon: "MessageCircle", ariaLabel: "等待输入" },
  recovering: { color: "warning", icon: "RotateCw", ariaLabel: "恢复中" },
  awaiting_takeover: { color: "danger", icon: "AlertTriangle", ariaLabel: "等待接管" },
  completed: { color: "success", icon: "CheckCircle", ariaLabel: "已完成" },
  failed: { color: "danger", icon: "XCircle", ariaLabel: "执行失败" },
  terminated: { color: "muted", icon: "Square", ariaLabel: "已终止" },
  writeback_pending: { color: "primary", icon: "Database", ariaLabel: "回写中" },
  writeback_done: { color: "success", icon: "CheckCheck", ariaLabel: "已回写" },
};

// ── Transition Triggers ───────────────────────────────────────────────────────

export type StateTransitionTrigger =
  | "user_dispatch"
  | "user_redispatch"
  | "user_terminate"
  | "user_takeover"
  | "user_response"
  | "system_start"
  | "system_admission"
  | "system_restart"
  | "agent_request_input"
  | "agent_complete"
  | "agent_error"
  | "system_heartbeat_timeout"
  | "system_recovery"
  | "recovery_failed"
  | "writeback_start"
  | "writeback_complete"
  | "writeback_failed"
  | "state_machine_reject"
  | "unknown";

export const TRIGGER_LABELS: Record<StateTransitionTrigger, { zh: string; en: string }> = {
  user_dispatch: { zh: "用户派发", en: "User dispatched" },
  user_redispatch: { zh: "用户重新派发", en: "User redispatched" },
  user_terminate: { zh: "用户终止", en: "User terminated" },
  user_takeover: { zh: "用户接管", en: "User took over" },
  user_response: { zh: "用户响应", en: "User responded" },
  system_start: { zh: "系统启动", en: "System started" },
  system_admission: { zh: "系统准入", en: "System admitted" },
  system_restart: { zh: "系统重启", en: "System restarted" },
  agent_request_input: { zh: "Agent 请求输入", en: "Agent requested input" },
  agent_complete: { zh: "Agent 完成", en: "Agent completed" },
  agent_error: { zh: "Agent 错误", en: "Agent error" },
  system_heartbeat_timeout: { zh: "心跳超时", en: "Heartbeat timeout" },
  system_recovery: { zh: "系统恢复", en: "System recovered" },
  recovery_failed: { zh: "恢复失败", en: "Recovery failed" },
  writeback_start: { zh: "开始回写", en: "Writeback started" },
  writeback_complete: { zh: "回写完成", en: "Writeback completed" },
  writeback_failed: { zh: "回写失败", en: "Writeback failed" },
  state_machine_reject: { zh: "状态机拒绝", en: "State machine rejected" },
  unknown: { zh: "未知", en: "Unknown" },
};

export const STATE_TRANSITION_TRIGGER_VALUES: readonly StateTransitionTrigger[] = [
  "user_dispatch",
  "user_redispatch",
  "user_terminate",
  "user_takeover",
  "user_response",
  "system_start",
  "system_admission",
  "system_restart",
  "agent_request_input",
  "agent_complete",
  "agent_error",
  "system_heartbeat_timeout",
  "system_recovery",
  "recovery_failed",
  "writeback_start",
  "writeback_complete",
  "writeback_failed",
  "state_machine_reject",
  "unknown",
] as const;

// ── Actor Type ────────────────────────────────────────────────────────────────

export type TransitionActorType = "user" | "system" | "agent";

export const ACTOR_TYPE_LABELS: Record<TransitionActorType, { zh: string; en: string }> = {
  user: { zh: "用户", en: "User" },
  system: { zh: "系统", en: "System" },
  agent: { zh: "Agent", en: "Agent" },
};

// ── Transition Result ─────────────────────────────────────────────────────────

export type TransitionResult =
  | { success: true; data: { taskId: string; fromStatus: TaskStatus; toStatus: TaskStatus; eventId: string } }
  | { success: false; error: string; code: "INVALID_TRANSITION" | "TASK_NOT_FOUND" | "TRANSITION_FAILED" };

export interface TransitionOutcome {
  allowed: boolean;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  errorMessage?: string;
}

// ── Zod Input Schema ─────────────────────────────────────────────────────────

export const TransitionInputSchema = z.object({
  taskId: z.string().min(1, "任务 ID 不能为空"),
  toStatus: z.enum(TASK_STATUS_VALUES),
  trigger: z.enum(STATE_TRANSITION_TRIGGER_VALUES),
  reason: z.string().optional(),
  actorType: z.enum(["user", "system", "agent"]).optional().default("system"),
  actorId: z.string().optional(),
});

export type TransitionInput = z.infer<typeof TransitionInputSchema>;

// ── Task / Session Status Mapping ─────────────────────────────────────────────

export const TASK_SESSION_STATUS_MAP: Record<
  TaskStatus,
  { sessionStatus: string | null; mapping: "direct" | "trigger" | "independent" }
> = {
  planned: { sessionStatus: null, mapping: "independent" },
  pending: { sessionStatus: null, mapping: "independent" },
  dispatched: { sessionStatus: null, mapping: "independent" },
  starting: { sessionStatus: "starting", mapping: "direct" },
  running: { sessionStatus: "running", mapping: "direct" },
  waiting_for_input: { sessionStatus: "running", mapping: "direct" },
  recovering: { sessionStatus: "running", mapping: "trigger" },
  awaiting_takeover: { sessionStatus: "running", mapping: "trigger" },
  completed: { sessionStatus: "completed", mapping: "direct" },
  failed: { sessionStatus: "failed", mapping: "direct" },
  terminated: { sessionStatus: "terminated", mapping: "direct" },
  writeback_pending: { sessionStatus: null, mapping: "independent" },
  writeback_done: { sessionStatus: null, mapping: "independent" },
};
