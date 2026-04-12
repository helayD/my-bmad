import { z } from "zod";

export const PLANNING_REQUEST_ROUTE_VALUES = ["planning", "direct-execution"] as const;
export const planningRequestRouteSchema = z.enum(PLANNING_REQUEST_ROUTE_VALUES);
export type PlanningRequestRoute = z.infer<typeof planningRequestRouteSchema>;

export const PLANNING_SELECTION_REASON_CODE_VALUES = [
  "new-feature-or-product-scope",
  "architecture-or-integration-design",
  "repo-missing-for-direct-execution",
  "goal-is-ambiguous",
  "small-scoped-repo-change",
] as const;

export const planningSelectionReasonCodeSchema = z.enum(
  PLANNING_SELECTION_REASON_CODE_VALUES,
);

export type PlanningSelectionReasonCode = z.infer<typeof planningSelectionReasonCodeSchema>;

export const PLANNING_REQUEST_STATUS_VALUES = [
  "analyzing",
  "planning",
  "execution-ready",
  "awaiting-confirmation",
  "completed",
  "failed",
] as const;

export const PLANNING_REQUEST_STAGE_ORDER = [...PLANNING_REQUEST_STATUS_VALUES];

export const planningRequestStatusSchema = z.enum(PLANNING_REQUEST_STATUS_VALUES);
export type PlanningRequestStatus = z.infer<typeof planningRequestStatusSchema>;

export const PLANNING_EXECUTION_STEP_STATUS_VALUES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export const planningExecutionStepStatusSchema = z.enum(
  PLANNING_EXECUTION_STEP_STATUS_VALUES,
);

export type PlanningExecutionStepStatus = z.infer<typeof planningExecutionStepStatusSchema>;

export const PLANNING_ARTIFACT_KIND_VALUES = [
  "prd",
  "architecture",
  "epics",
  "story-stub",
  "other",
] as const;

export const planningArtifactKindSchema = z.enum(PLANNING_ARTIFACT_KIND_VALUES);
export type PlanningArtifactKind = z.infer<typeof planningArtifactKindSchema>;

export const PLANNING_ARTIFACT_SYNC_STATUS_VALUES = [
  "created",
  "updated",
  "unchanged",
  "skipped",
  "conflict",
] as const;

export const planningArtifactSyncStatusSchema = z.enum(
  PLANNING_ARTIFACT_SYNC_STATUS_VALUES,
);

export type PlanningArtifactSyncStatus = z.infer<typeof planningArtifactSyncStatusSchema>;

export const PLANNING_REQUEST_MIN_GOAL_LENGTH = 6;
export const PLANNING_REQUEST_MAX_GOAL_LENGTH = 500;
export const DEFAULT_PLANNING_REQUEST_NEXT_STEP = "等待系统识别规划意图并选择 PM Agent 与 Skills";
export const DEFAULT_DIRECT_EXECUTION_NEXT_STEP = "将跳过 BMAD 规划，进入执行任务定义与派发准备阶段。";
export const DEFAULT_PLANNING_ROUTE_NEXT_STEP = "已进入规划链路，下一步将整理 PRD、拆分 Stories，并按需补充技术方案。";
export const DEFAULT_PLANNING_EXECUTION_NEXT_STEP = "可以开始执行规划，系统将按选定的 Skills 依次生成 BMAD 工件。";
export const DEFAULT_PLANNING_CONFIRMATION_NEXT_STEP = "规划产出已生成，可查看摘要、编辑工件并确认后进入后续执行链路。";
export const DEFAULT_PLANNING_REQUEST_LIMIT = 5;

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

interface PlanningRequestStatusMeta {
  label: string;
  defaultProgressPercent: number;
  badgeVariant: BadgeVariant;
}

interface PlanningExecutionStepStatusMeta {
  label: string;
  badgeVariant: BadgeVariant;
}

export const PLANNING_REQUEST_STATUS_META: Record<
  PlanningRequestStatus,
  PlanningRequestStatusMeta
> = {
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
  "execution-ready": {
    label: "待进入执行",
    defaultProgressPercent: 40,
    badgeVariant: "default",
  },
  "awaiting-confirmation": {
    label: "待确认",
    defaultProgressPercent: 90,
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

export const PLANNING_EXECUTION_STEP_STATUS_META: Record<
  PlanningExecutionStepStatus,
  PlanningExecutionStepStatusMeta
> = {
  pending: {
    label: "等待执行",
    badgeVariant: "outline",
  },
  running: {
    label: "执行中",
    badgeVariant: "secondary",
  },
  completed: {
    label: "已完成",
    badgeVariant: "default",
  },
  failed: {
    label: "失败",
    badgeVariant: "destructive",
  },
};

export const PLANNING_REQUEST_ROUTE_LABELS: Record<PlanningRequestRoute, string> = {
  planning: "需要先规划",
  "direct-execution": "直接进入执行",
};

export const PLANNING_ARTIFACT_SYNC_STATUS_LABELS: Record<
  PlanningArtifactSyncStatus,
  string
> = {
  created: "新建",
  updated: "更新",
  unchanged: "未变更",
  skipped: "已跳过",
  conflict: "冲突",
};

export const PLANNING_SELECTION_REASON_LABELS: Record<
  PlanningSelectionReasonCode,
  string
> = {
  "new-feature-or-product-scope": "新功能或产品范围扩展",
  "architecture-or-integration-design": "涉及架构、集成或关键技术方案",
  "repo-missing-for-direct-execution": "缺少仓库上下文，不能直接执行",
  "goal-is-ambiguous": "目标范围模糊，需要先澄清",
  "small-scoped-repo-change": "范围明确且仓库已就绪，可直接执行",
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

export const planningExecutionIntentSchema = z.enum(["implement", "fix"]);
export type PlanningExecutionIntent = z.infer<typeof planningExecutionIntentSchema>;

export const planningExecutionHandoffDraftSchema = z.object({
  source: z.literal("planning-request"),
  suggestedGoal: z.string(),
  suggestedSummary: z.string(),
  suggestedIntent: planningExecutionIntentSchema,
  requiresRepo: z.boolean(),
});

export type PlanningExecutionHandoffDraft = z.infer<
  typeof planningExecutionHandoffDraftSchema
>;

export const planningArtifactSummaryItemSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  kind: planningArtifactKindSchema,
  summary: z.string().min(1),
  sourceSkillKey: z.string().min(1),
  status: planningArtifactSyncStatusSchema,
  storyId: z.string().min(1).optional(),
  epicId: z.string().min(1).optional(),
});

export type PlanningArtifactSummaryItem = z.infer<typeof planningArtifactSummaryItemSchema>;

export const planningExecutionStepSchema = z.object({
  id: z.string().min(1),
  skillKey: z.string().min(1),
  stepKey: z.string().min(1),
  sequence: z.number().int().min(1),
  status: planningExecutionStepStatusSchema,
  title: z.string().min(1),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  outputSummary: z.string().nullable(),
  artifactPaths: z.array(z.string()),
  retryCount: z.number().int().min(0),
});

export type PlanningExecutionStepListItem = z.infer<typeof planningExecutionStepSchema>;

export interface PlanningRequestListItem {
  id: string;
  rawGoal: string;
  status: PlanningRequestStatus;
  progressPercent: number;
  nextStep: string;
  routeType: PlanningRequestRoute | null;
  selectionReasonCode: PlanningSelectionReasonCode | null;
  selectionReasonSummary: string | null;
  selectedAgentKeys: string[];
  selectedSkillKeys: string[];
  analyzedAt: string | null;
  executionStartedAt: string | null;
  executionCompletedAt: string | null;
  executionFailedAt: string | null;
  lastExecutionErrorCode: string | null;
  generatedArtifactCount: number;
  artifactSummary: PlanningArtifactSummaryItem[];
  executionSteps: PlanningExecutionStepListItem[];
  executionHandoffDraft: PlanningExecutionHandoffDraft | null;
  createdAt: string;
  createdByUser: PlanningRequestActor;
}

export interface PlanningIntentAnalysisInput {
  rawGoal: string;
  hasRepo: boolean;
  projectSummary?: string | null;
}

export interface PlanningIntentAnalysisResult {
  routeType: PlanningRequestRoute;
  status: PlanningRequestStatus;
  progressPercent: number;
  nextStep: string;
  selectionReasonCode: PlanningSelectionReasonCode;
  selectionReasonSummary: string;
  selectedAgentKeys: string[];
  selectedSkillKeys: string[];
  executionHandoffDraft: PlanningExecutionHandoffDraft | null;
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

export function getPlanningRequestStatusLabel(status: PlanningRequestStatus): string {
  return PLANNING_REQUEST_STATUS_META[status].label;
}

export function getPlanningRequestDefaultProgress(status: PlanningRequestStatus): number {
  return PLANNING_REQUEST_STATUS_META[status].defaultProgressPercent;
}

export function getPlanningRequestBadgeVariant(status: PlanningRequestStatus): BadgeVariant {
  return PLANNING_REQUEST_STATUS_META[status].badgeVariant;
}

export function getPlanningExecutionStepStatusLabel(
  status: PlanningExecutionStepStatus,
): string {
  return PLANNING_EXECUTION_STEP_STATUS_META[status].label;
}

export function getPlanningExecutionStepBadgeVariant(
  status: PlanningExecutionStepStatus,
): BadgeVariant {
  return PLANNING_EXECUTION_STEP_STATUS_META[status].badgeVariant;
}

export function getPlanningRequestRouteLabel(route: PlanningRequestRoute): string {
  return PLANNING_REQUEST_ROUTE_LABELS[route];
}

export function getPlanningArtifactSyncStatusLabel(
  status: PlanningArtifactSyncStatus,
): string {
  return PLANNING_ARTIFACT_SYNC_STATUS_LABELS[status];
}

export function normalizePlanningGoal(input: string): string {
  return input.trim();
}

export function getMeaningfulGoalLength(input: string): number {
  return normalizePlanningGoal(input).replace(/[\p{White_Space}\p{P}\p{S}]+/gu, "").length;
}

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

export function parsePlanningExecutionHandoffDraft(
  value: unknown,
): PlanningExecutionHandoffDraft | null {
  const parsed = planningExecutionHandoffDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parsePlanningArtifactSummary(
  value: unknown,
): PlanningArtifactSummaryItem[] {
  const parsed = z.array(planningArtifactSummaryItemSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parsePlanningExecutionSteps(
  value: unknown,
): PlanningExecutionStepListItem[] {
  const parsed = z.array(planningExecutionStepSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function canRetryPlanningExecution(
  request: Pick<PlanningRequestListItem, "status" | "routeType" | "executionSteps">,
): boolean {
  return (
    request.routeType === "planning" &&
    request.status === "failed" &&
    request.executionSteps.some((step) => step.status === "failed")
  );
}

export function canExecutePlanningRequest(
  request: Pick<
    PlanningRequestListItem,
    "status" | "routeType" | "selectedSkillKeys" | "executionSteps"
  >,
): boolean {
  if (request.routeType !== "planning") {
    return false;
  }

  if (request.selectedSkillKeys.length === 0) {
    return false;
  }

  if (request.status === "analyzing" || request.status === "awaiting-confirmation") {
    return false;
  }

  if (request.executionSteps.some((step) => step.status === "running")) {
    return false;
  }

  return request.status === "planning" || canRetryPlanningExecution(request);
}

export function getPlanningExecutionProgress(
  steps: readonly Pick<PlanningExecutionStepListItem, "status">[],
): number {
  const start = getPlanningRequestDefaultProgress("planning");
  const end = getPlanningRequestDefaultProgress("awaiting-confirmation");

  if (steps.length === 0) {
    return start;
  }

  const completedSteps = steps.filter((step) => step.status === "completed").length;
  const hasRunningStep = steps.some((step) => step.status === "running");
  const progressRange = end - start;
  const completedProgress = Math.round((completedSteps / steps.length) * progressRange);
  const runningBonus =
    hasRunningStep && completedSteps < steps.length
      ? Math.max(1, Math.floor(progressRange / (steps.length * 2)))
      : 0;

  return Math.min(end, start + completedProgress + runningBonus);
}
