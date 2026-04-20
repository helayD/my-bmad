import { z } from "zod";
import {
  TASK_INTENT_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  type TaskAgentType,
} from "@/lib/tasks/types";

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

export const PLANNING_STATUS_FILTER_VALUES = [
  "all",
  ...PLANNING_REQUEST_STATUS_VALUES,
] as const;

export const planningStatusFilterSchema = z.enum(PLANNING_STATUS_FILTER_VALUES);
export type PlanningStatusFilter = z.infer<typeof planningStatusFilterSchema>;

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
const PLANNING_ANALYSIS_STALL_THRESHOLD_MS = 5 * 60 * 1000;

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

export const PLANNING_STATUS_FILTER_LABELS: Record<PlanningStatusFilter, string> = {
  all: "全部",
  analyzing: "分析中",
  planning: "规划中",
  "execution-ready": "待进入执行",
  "awaiting-confirmation": "待确认",
  completed: "已完成",
  failed: "已失败",
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

export const PLANNING_HANDOFF_DISPATCH_MODE_VALUES = ["manual", "auto"] as const;
export const planningHandoffDispatchModeSchema = z.enum(
  PLANNING_HANDOFF_DISPATCH_MODE_VALUES,
);
export type PlanningHandoffDispatchMode = z.infer<typeof planningHandoffDispatchModeSchema>;

export const PLANNING_HANDOFF_READY_STATE_VALUES = [
  "manual",
  "auto-ready",
  "approval-required",
] as const;
export const planningHandoffReadyStateSchema = z.enum(
  PLANNING_HANDOFF_READY_STATE_VALUES,
);
export type PlanningHandoffReadyState = z.infer<typeof planningHandoffReadyStateSchema>;

export const planningHandoffCandidateTaskSchema = z.object({
  artifactId: z.string().min(1),
  artifactName: z.string().min(1),
  filePath: z.string().min(1),
  storyArtifactId: z.string().min(1),
  storyTitle: z.string().min(1),
  storyFilePath: z.string().min(1),
  order: z.number().int().min(1),
});

export type PlanningHandoffCandidateTask = z.infer<typeof planningHandoffCandidateTaskSchema>;

export const planningHandoffStoryGroupSchema = z.object({
  storyArtifactId: z.string().min(1),
  storyTitle: z.string().min(1),
  storyFilePath: z.string().min(1),
  storyId: z.string().nullable(),
  tasks: z.array(planningHandoffCandidateTaskSchema),
});

export type PlanningHandoffStoryGroup = z.infer<typeof planningHandoffStoryGroupSchema>;

export const planningHandoffPreviewSchema = z.object({
  planningRequestId: z.string().min(1),
  dispatchMode: planningHandoffDispatchModeSchema,
  approvalRequired: z.boolean(),
  candidateTaskCount: z.number().int().min(0),
  storyCount: z.number().int().min(0),
  groups: z.array(planningHandoffStoryGroupSchema),
});

export type PlanningHandoffPreview = z.infer<typeof planningHandoffPreviewSchema>;

export const planningHandoffCreatedTaskSchema = z.object({
  taskId: z.string().min(1),
  taskTitle: z.string().min(1),
  sourceArtifactId: z.string().min(1),
  sourceArtifactName: z.string().min(1),
  sourceArtifactPath: z.string().min(1),
  storyArtifactId: z.string().min(1),
  storyTitle: z.string().min(1),
  priority: z.enum(TASK_PRIORITY_VALUES),
  intent: z.enum(TASK_INTENT_VALUES),
  status: z.enum(TASK_STATUS_VALUES),
  currentStage: z.string().min(1),
  nextStep: z.string().min(1),
  queuePosition: z.number().int().min(1),
  readyState: planningHandoffReadyStateSchema,
});

export type PlanningHandoffCreatedTask = z.infer<typeof planningHandoffCreatedTaskSchema>;

export const planningHandoffDeferredArtifactSchema = z.object({
  artifactId: z.string().min(1),
  artifactType: z.enum(["STORY", "TASK"]),
  artifactName: z.string().min(1),
  filePath: z.string().min(1),
  storyArtifactId: z.string().min(1),
  storyTitle: z.string().min(1),
  deferredBy: z.enum(["story", "task"]),
});

export type PlanningHandoffDeferredArtifact = z.infer<
  typeof planningHandoffDeferredArtifactSchema
>;

export const planningTaskHandoffSummarySchema = z.object({
  source: z.literal("planning-request-handoff"),
  confirmedAt: z.string().datetime(),
  dispatchMode: planningHandoffDispatchModeSchema,
  approvalRequired: z.boolean(),
  candidateTaskCount: z.number().int().min(0),
  createdTaskCount: z.number().int().min(0),
  deferredArtifactCount: z.number().int().min(0),
  deduplicatedTaskCount: z.number().int().min(0),
  createdTasks: z.array(planningHandoffCreatedTaskSchema),
  deferredArtifacts: z.array(planningHandoffDeferredArtifactSchema),
});

export type PlanningTaskHandoffSummary = z.infer<typeof planningTaskHandoffSummarySchema>;

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
  confirmedAt: string | null;
  lastExecutionErrorCode: string | null;
  generatedArtifactCount: number;
  derivedTaskCount: number;
  deferredArtifactCount: number;
  artifactSummary: PlanningArtifactSummaryItem[];
  executionSteps: PlanningExecutionStepListItem[];
  executionHandoffDraft: PlanningExecutionHandoffDraft | null;
  taskHandoffSummary: PlanningTaskHandoffSummary | null;
  createdAt: string;
  updatedAt?: string;
  createdByUser: PlanningRequestActor;
}

export type PlanningRequestProblemStage =
  | "analysis-stalled"
  | "analysis-failed"
  | "execution-failed"
  | "awaiting-confirmation"
  | "execution-ready";

export type PlanningRequestProblemSeverity = "info" | "warning" | "critical";

export interface PlanningRequestProblemSummary {
  stage: PlanningRequestProblemStage;
  severity: PlanningRequestProblemSeverity;
  title: string;
  reason: string;
  nextAction: string;
}

export interface PlanningArtifactLinkView extends PlanningArtifactSummaryItem {
  artifactId: string | null;
  artifactName: string | null;
}

export interface PlanningDerivedTaskLinkView {
  taskId: string;
  title: string;
  status: string;
  currentStage: string;
  nextStep: string;
  queuePosition: number | null;
  readyState: PlanningHandoffReadyState | null;
  currentAgentRunId: string | null;
  selectedAgentType: TaskAgentType | null;
  selectedAgentLabel: string | null;
  selectionReasonSummary: string | null;
  agentRunCount: number;
  rerouteCount: number;
  sourceArtifactId: string | null;
  sourceArtifactName: string;
  sourceArtifactPath: string;
  storyArtifactId: string | null;
  storyTitle: string | null;
  isLegacyPending: boolean;
}

export interface PlanningDeferredArtifactView {
  artifactId: string;
  artifactName: string;
  filePath: string;
  storyTitle: string;
  deferredBy: "story" | "task";
  sourceArtifactId: string | null;
}

export interface PlanningRequestDetailView {
  request: PlanningRequestListItem;
  problem: PlanningRequestProblemSummary | null;
  artifacts: PlanningArtifactLinkView[];
  derivedTasks: PlanningDerivedTaskLinkView[];
  deferredArtifacts: PlanningDeferredArtifactView[];
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

export function getPlanningStatusFilterLabel(status: PlanningStatusFilter): string {
  return PLANNING_STATUS_FILTER_LABELS[status];
}

export function parsePlanningStatusFilter(value: unknown): PlanningStatusFilter {
  const parsed = planningStatusFilterSchema.safeParse(value);
  return parsed.success ? parsed.data : "all";
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

export function doesPlanningRequestMatchStatusFilter(
  request: Pick<PlanningRequestListItem, "status">,
  filter: PlanningStatusFilter,
): boolean {
  return filter === "all" || request.status === filter;
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

export function parsePlanningHandoffPreview(
  value: unknown,
): PlanningHandoffPreview | null {
  const parsed = planningHandoffPreviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parsePlanningTaskHandoffSummary(
  value: unknown,
): PlanningTaskHandoffSummary | null {
  const parsed = planningTaskHandoffSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
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

export function canConfirmPlanningRequest(
  request: Pick<PlanningRequestListItem, "status" | "routeType">,
): boolean {
  return request.routeType === "planning" && request.status === "awaiting-confirmation";
}

export function resolvePlanningRequestProblemSummary(
  request: Pick<
    PlanningRequestListItem,
    | "status"
    | "createdAt"
    | "updatedAt"
    | "routeType"
    | "nextStep"
    | "selectionReasonSummary"
    | "executionSteps"
    | "derivedTaskCount"
    | "taskHandoffSummary"
  >,
): PlanningRequestProblemSummary | null {
  const failedStep = request.executionSteps.find((step) => step.status === "failed") ?? null;

  if (request.status === "failed" && failedStep) {
    return {
      stage: "execution-failed",
      severity: "critical",
      title: `失败步骤：${failedStep.title}`,
      reason: failedStep.errorMessage ?? request.nextStep,
      nextAction: "重试失败步骤",
    };
  }

  if (request.status === "failed") {
    return {
      stage: "analysis-failed",
      severity: "critical",
      title: "分析阶段失败",
      reason: request.selectionReasonSummary ?? request.nextStep,
      nextAction: "重新分析",
    };
  }

  if (request.status === "analyzing") {
    if (!hasPlanningAnalysisStalled(request.updatedAt ?? request.createdAt)) {
      return null;
    }

    return {
      stage: "analysis-stalled",
      severity: "warning",
      title: "分析尚未推进",
      reason: request.nextStep,
      nextAction: "继续分析",
    };
  }

  if (request.status === "awaiting-confirmation") {
    return {
      stage: "awaiting-confirmation",
      severity: "warning",
      title: "等待确认规划结果",
      reason: request.nextStep,
      nextAction: "确认规划结果",
    };
  }

  if (request.status === "execution-ready") {
    const createdTaskCount =
      request.taskHandoffSummary?.createdTaskCount ?? request.derivedTaskCount;
    const reason = request.routeType === "direct-execution"
      ? "此请求跳过了 BMAD 规划，当前仅进入执行准备态，尚未开始编码。"
      : createdTaskCount > 0
        ? `已进入执行准备态，当前可见 ${createdTaskCount} 个衍生任务，但尚未开始编码。`
        : "已进入执行准备态，但当前还没有可见的衍生任务记录，仍未开始编码。";

    return {
      stage: "execution-ready",
      severity: "info",
      title: request.routeType === "direct-execution" ? "直接进入执行准备" : "已衔接到执行准备",
      reason,
      nextAction: "查看执行准备",
    };
  }

  return null;
}

function hasPlanningAnalysisStalled(referenceTime: string): boolean {
  const parsed = Date.parse(referenceTime);
  if (Number.isNaN(parsed)) {
    return false;
  }

  return Date.now() - parsed >= PLANNING_ANALYSIS_STALL_THRESHOLD_MS;
}

export const PLANNING_HANDOFF_DISPATCH_MODE_LABELS: Record<
  PlanningHandoffDispatchMode,
  string
> = {
  manual: "手动派发",
  auto: "自动派发准备",
};

export const PLANNING_HANDOFF_READY_STATE_LABELS: Record<
  PlanningHandoffReadyState,
  string
> = {
  manual: "等待手动派发",
  "auto-ready": "已进入自动派发准备",
  "approval-required": "等待审批后派发",
};

export function getPlanningHandoffDispatchModeLabel(
  value: PlanningHandoffDispatchMode,
): string {
  return PLANNING_HANDOFF_DISPATCH_MODE_LABELS[value];
}

export function getPlanningHandoffReadyStateLabel(
  value: PlanningHandoffReadyState,
): string {
  return PLANNING_HANDOFF_READY_STATE_LABELS[value];
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
