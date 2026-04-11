import { z } from "zod";

export const PLANNING_REQUEST_STATUS_VALUES = [
  "analyzing",
  "planning",
  "awaiting-confirmation",
  "completed",
  "failed",
] as const;

export const PLANNING_REQUEST_STAGE_ORDER = [...PLANNING_REQUEST_STATUS_VALUES];

export const planningRequestStatusSchema = z.enum(PLANNING_REQUEST_STATUS_VALUES);

export type PlanningRequestStatus = z.infer<typeof planningRequestStatusSchema>;

export const PLANNING_REQUEST_MIN_GOAL_LENGTH = 6;
export const PLANNING_REQUEST_MAX_GOAL_LENGTH = 500;
export const DEFAULT_PLANNING_REQUEST_NEXT_STEP = "等待系统识别规划意图并选择 PM Agent 与 Skills";
export const DEFAULT_PLANNING_REQUEST_LIMIT = 5;

interface PlanningRequestStatusMeta {
  label: string;
  defaultProgressPercent: number;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
}

export const PLANNING_REQUEST_STATUS_META: Record<PlanningRequestStatus, PlanningRequestStatusMeta> = {
  analyzing: {
    label: "分析中",
    defaultProgressPercent: 10,
    badgeVariant: "outline",
  },
  planning: {
    label: "规划中",
    defaultProgressPercent: 45,
    badgeVariant: "secondary",
  },
  "awaiting-confirmation": {
    label: "待确认",
    defaultProgressPercent: 80,
    badgeVariant: "default",
  },
  completed: {
    label: "已完成",
    defaultProgressPercent: 100,
    badgeVariant: "default",
  },
  failed: {
    label: "已失败",
    defaultProgressPercent: 100,
    badgeVariant: "destructive",
  },
};

export const INITIAL_PLANNING_REQUEST_STATE = {
  status: "analyzing" as PlanningRequestStatus,
  progressPercent: PLANNING_REQUEST_STATUS_META.analyzing.defaultProgressPercent,
  nextStep: DEFAULT_PLANNING_REQUEST_NEXT_STEP,
};

export type PlanningGoalValidationCode =
  | "PLANNING_REQUEST_GOAL_REQUIRED"
  | "PLANNING_REQUEST_GOAL_TOO_SHORT"
  | "PLANNING_REQUEST_GOAL_TOO_LONG";

const GOAL_VALIDATION_MESSAGES: Record<PlanningGoalValidationCode, string> = {
  PLANNING_REQUEST_GOAL_REQUIRED: "请输入明确的目标描述，不能只包含空格或标点。",
  PLANNING_REQUEST_GOAL_TOO_SHORT: "请至少输入 6 个字符，说明希望系统规划的目标。",
  PLANNING_REQUEST_GOAL_TOO_LONG: "目标描述请控制在 500 个字符以内。",
};

export interface PlanningRequestActor {
  id: string;
  name: string | null;
  email: string;
}

export interface PlanningRequestListItem {
  id: string;
  rawGoal: string;
  status: PlanningRequestStatus;
  progressPercent: number;
  nextStep: string;
  createdAt: string;
  createdByUser: PlanningRequestActor;
}

export function getPlanningRequestStatusLabel(status: PlanningRequestStatus): string {
  return PLANNING_REQUEST_STATUS_META[status].label;
}

export function getPlanningRequestDefaultProgress(status: PlanningRequestStatus): number {
  return PLANNING_REQUEST_STATUS_META[status].defaultProgressPercent;
}

export function getPlanningRequestBadgeVariant(status: PlanningRequestStatus) {
  return PLANNING_REQUEST_STATUS_META[status].badgeVariant;
}

export function normalizePlanningGoal(input: string): string {
  return input.trim();
}

export function getMeaningfulGoalLength(input: string): number {
  return normalizePlanningGoal(input).replace(/[\p{White_Space}\p{P}\p{S}]+/gu, "").length;
}

export type PlanningGoalValidationResult =
  | {
      valid: true;
      rawGoal: string;
      meaningfulLength: number;
    }
  | {
      valid: false;
      rawGoal: string;
      meaningfulLength: number;
      code: PlanningGoalValidationCode;
      message: string;
    };

export function validatePlanningGoal(input: string): PlanningGoalValidationResult {
  const rawGoal = normalizePlanningGoal(input);
  const meaningfulLength = getMeaningfulGoalLength(rawGoal);

  if (meaningfulLength === 0) {
    return {
      valid: false,
      rawGoal,
      meaningfulLength,
      code: "PLANNING_REQUEST_GOAL_REQUIRED",
      message: GOAL_VALIDATION_MESSAGES.PLANNING_REQUEST_GOAL_REQUIRED,
    };
  }

  if (rawGoal.length > PLANNING_REQUEST_MAX_GOAL_LENGTH) {
    return {
      valid: false,
      rawGoal,
      meaningfulLength,
      code: "PLANNING_REQUEST_GOAL_TOO_LONG",
      message: GOAL_VALIDATION_MESSAGES.PLANNING_REQUEST_GOAL_TOO_LONG,
    };
  }

  if (meaningfulLength < PLANNING_REQUEST_MIN_GOAL_LENGTH) {
    return {
      valid: false,
      rawGoal,
      meaningfulLength,
      code: "PLANNING_REQUEST_GOAL_TOO_SHORT",
      message: GOAL_VALIDATION_MESSAGES.PLANNING_REQUEST_GOAL_TOO_SHORT,
    };
  }

  return {
    valid: true,
    rawGoal,
    meaningfulLength,
  };
}

export function getPlanningRequestCreatorLabel(actor: PlanningRequestActor): string {
  return actor.name?.trim() || actor.email;
}
