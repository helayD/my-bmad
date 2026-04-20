import {
  TASK_STATUS_VALUES,
  STATUS_LABELS,
  VALID_TRANSITIONS,
  type TaskStatus,
} from "./types";

const LEGACY_STATUS_MAP: Record<string, TaskStatus> = {
  "in-progress": "running",
  "done": "completed",
  "blocked": "failed",
};

function resolveStatus(status: string): TaskStatus {
  return LEGACY_STATUS_MAP[status] ?? (status as TaskStatus);
}

export function isValidTransition(fromStatus: string, toStatus: string): boolean {
  const from = resolveStatus(fromStatus);
  const to = resolveStatus(toStatus);
  const transitions = VALID_TRANSITIONS[from];
  if (!transitions) return false;
  return transitions.includes(to);
}

export function getTransitionError(fromStatus: string, toStatus: string): string {
  const from = resolveStatus(fromStatus);
  const to = resolveStatus(toStatus);
  if (!TASK_STATUS_VALUES.includes(from)) {
    return `未知的状态：${fromStatus}`;
  }
  if (!TASK_STATUS_VALUES.includes(to)) {
    return `未知的目标状态：${toStatus}`;
  }
  if (!isValidTransition(fromStatus, toStatus)) {
    const fromLabel = STATUS_LABELS[from]?.zh ?? fromStatus;
    const toLabel = STATUS_LABELS[to]?.zh ?? toStatus;
    return `状态机拒绝非法转换：从「${fromLabel}」不能直接转换到「${toLabel}」`;
  }
  return "";
}

export function getAllowedTransitions(fromStatus: string): TaskStatus[] {
  return VALID_TRANSITIONS[fromStatus as TaskStatus] ?? [];
}

export function isTerminalStatus(status: string): boolean {
  const terminalStatuses: TaskStatus[] = ["completed", "failed", "terminated", "writeback_done"];
  return terminalStatuses.includes(status as TaskStatus);
}

export function isRecoveryStatus(status: string): boolean {
  const recoveryStatuses: TaskStatus[] = ["recovering", "awaiting_takeover"];
  return recoveryStatuses.includes(status as TaskStatus);
}

export function isActiveStatus(status: string): boolean {
  const activeStatuses: TaskStatus[] = [
    "planned",
    "pending",
    "dispatched",
    "starting",
    "running",
    "waiting_for_input",
  ];
  return activeStatuses.includes(status as TaskStatus);
}

export function needsWriteback(status: string): boolean {
  const writebackTriggers: TaskStatus[] = ["completed", "failed", "terminated"];
  return writebackTriggers.includes(status as TaskStatus);
}
