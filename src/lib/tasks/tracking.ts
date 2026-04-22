import type { ArtifactTypeString } from "@/lib/artifacts/types";
import {
  EXECUTION_SESSION_STATUS_LABELS,
  TASK_AGENT_RUN_STATUS_LABELS,
  TASK_AGENT_TYPE_LABELS,
  WRITEBACK_OUTCOME_LABELS,
  WRITEBACK_STATUS_LABELS,
  type ExecutionQueueSnapshot,
  type ExecutionSessionStatus,
  type ExecutionSessionView,
  type ExecutionSessionSummary,
  type TaskAgentRunStatus,
  type TaskAgentType,
  type TaskRoutingDecisionSummary,
  type TaskSourceReference,
  type TaskStatus,
  type TaskWritebackView,
  type WritebackOutcome,
  type WritebackStatus,
} from "./types";
import {
  EXECUTION_BOUNDARY_VIOLATION_LABELS,
  EXECUTION_BOUNDARY_VIOLATION_SUMMARIES,
  parseBoundaryProfile,
  parseExecutionQueueSnapshot,
  type ExecutionBoundaryViolationCode,
} from "@/lib/execution/supervisor/boundary";

export const TASK_ACTIVITY_FALLBACK = "暂无最近活动";
export const TASK_AGENT_TYPE_FALLBACK = "待分配";
export const TASK_RESULT_SUMMARY_FALLBACK = "暂无结果摘要";
export const TASK_SOURCE_NAME_FALLBACK = "项目上下文任务";
export const TASK_SOURCE_PATH_FALLBACK = "当前任务未关联来源工件。";
export const TASK_EXECUTION_TIME_FALLBACK = "尚未开始执行";
export const TASK_ARTIFACT_SUMMARY_FALLBACK = "暂无关键产物";
export const TASK_ARTIFACT_PATH_FALLBACK = "文件路径待记录";
export const TASK_ARTIFACT_GENERATED_AT_FALLBACK = "生成时间待记录";
export const TASK_AGENT_RUN_EMPTY_STATE = "暂无 Agent Run 记录。";
export const TASK_ARTIFACTS_EMPTY_STATE = "暂无产物记录。当前任务尚未记录文件产出，可先前往任务详情查看最新状态。";
export const TASK_WRITEBACK_EMPTY_STATE = "该任务尚未生成回写记录。任务结束后，系统会把最新结果同步回来源工件。";
export const TASK_WRITEBACK_CONFLICT_STATE = "任务已结束，但回写尚未成功，请优先处理回写异常。";

export const ARTIFACT_EXECUTION_STATUS_LABELS = {
  completed: "已完成",
  "in-progress": "执行中",
  dispatched: "已派发",
  pending: "待执行",
  failed: "失败",
} as const;

export type ArtifactExecutionStatus = keyof typeof ARTIFACT_EXECUTION_STATUS_LABELS;
export type ArtifactTaskHistoryViewType = "story" | "epic" | "unsupported";

export interface TaskSourceHierarchyItem {
  id: string;
  type: ArtifactTypeString;
  name: string;
}

interface TaskSourceArtifactNodeLike {
  id: string;
  type: string;
  name: string;
  filePath?: string | null;
  metadata?: unknown;
  parent?: TaskSourceArtifactNodeLike | null;
}

interface TaskHistoryRecord {
  id: string;
  sourceArtifactId?: string | null;
  intentDetail?: string | null;
  preferredAgentType?: string | null;
  title: string;
  status: string;
  currentStage: string;
  nextStep: string;
  currentAgentRunId?: string | null;
  createdAt: Date;
  metadata: unknown;
  sourceArtifact?: TaskSourceArtifactNodeLike | null;
  currentAgentRun?: TaskHistoryAgentRunRecord | null;
  agentRuns?: TaskHistoryAgentRunRecord[] | null;
  writebacks?: TaskHistoryWritebackRecord[] | null;
  executionSessions?: TaskHistoryExecutionSessionRecord[] | null;
}

interface TaskHistoryAgentRunRecord {
  id: string;
  agentType: string;
  status: string;
  decisionSource: string;
  selectionReasonCode: string;
  selectionReasonSummary: string;
  matchedSignals: string[];
  requestedByUserId?: string | null;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  terminatedAt?: Date | null;
  supersededAt?: Date | null;
  terminationReasonCode?: string | null;
  terminationReasonSummary?: string | null;
  replacesRunId?: string | null;
  replacementRun?: { id: string } | null;
  metadata?: unknown;
}

interface TaskHistoryWritebackRecord {
  id: string;
  taskId: string;
  artifactId: string;
  outcome: string;
  writebackStatus: string;
  summary: string;
  errorSummary?: string | null;
  occurredAt: Date;
  payload: unknown;
}

export interface TaskHistoryExecutionSessionRecord {
  id: string;
  taskId: string;
  agentRunId: string;
  transport: string;
  sessionName: string;
  processPid: number | null;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  terminatedAt: Date | null;
  terminationReasonCode: string | null;
  terminationReasonSummary: string | null;
  createdAt: Date;
  metadata?: unknown;
}

export interface ArtifactTaskHistoryArtifactRecord {
  id: string;
  type: ArtifactTypeString;
  name: string;
  filePath: string;
  parentId?: string | null;
  metadata?: unknown;
}

export interface ArtifactTaskHistoryAgentRun {
  id: string | null;
  agentType?: TaskAgentType | null;
  agentTypeLabel: string;
  status?: TaskAgentRunStatus | null;
  statusLabel: string;
  createdAt?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  terminatedAt?: string | null;
  supersededAt?: string | null;
  selectionReasonSummary?: string | null;
  decisionSource?: string | null;
  replacesRunId?: string | null;
  replacementRunId?: string | null;
  terminationReasonSummary?: string | null;
  isCurrent?: boolean;
  summary: string;
}

export interface ArtifactTaskHistoryArtifact {
  type: string;
  filePath: string;
  generatedAt: string | null;
  summary: string;
}

export interface ArtifactTaskHistoryEntry {
  taskId: string;
  title: string;
  status: string;
  executionStartedAt: string | null;
  currentStage: string;
  currentActivity: string;
  agentTypeLabel: string;
  artifactSummary: string;
  resultSummary: string;
  sourceArtifactName: string;
  taskDetailHref: string;
  agentRuns: ArtifactTaskHistoryAgentRun[];
  artifacts: ArtifactTaskHistoryArtifact[];
  writeback: TaskWritebackView | null;
  writebackStatusLabel: string | null;
  writebackOutcomeLabel: string | null;
  writebackOccurredAt: string | null;
  writebackErrorSummary: string | null;
  writebackRecoveryHint: string | null;
  hasWritebackConflict: boolean;
}

export interface ArtifactTaskHistoryStorySummary {
  storyArtifactId: string;
  storyName: string;
  aggregateStatus: ArtifactExecutionStatus;
  latestActivity: string;
  taskCount: number;
  latestTaskDetailHref: string | null;
  items: ArtifactTaskHistoryEntry[];
}

export interface ArtifactTaskHistoryStatusDistribution {
  completed: number;
  inProgress: number;
  dispatched: number;
  pending: number;
  failed: number;
}

export interface ArtifactTaskHistoryPayload {
  artifact: {
    id: string;
    type: ArtifactTypeString;
    name: string;
  };
  latestWriteback: TaskWritebackView | null;
  latestWritebackTaskDetailHref: string | null;
  viewType: ArtifactTaskHistoryViewType;
  supportsDirectHistory: boolean;
  supportsExecutionHistory: boolean;
  items: ArtifactTaskHistoryEntry[];
  storySummaries: ArtifactTaskHistoryStorySummary[];
  statusDistribution: ArtifactTaskHistoryStatusDistribution;
}

export interface ArtifactTaskHistoryQueryInput {
  workspaceId: string;
  projectId: string;
  artifactId: string;
  status?: TaskStatus;
}

export type ArtifactTaskHistoryFilter = TaskStatus | "all";

export interface ResolvedTaskSourceArtifact {
  id: string | null;
  type: ArtifactTypeString;
  name: string;
  filePath: string;
}

export interface TaskSourceContextSnapshot {
  artifactId: string;
  artifactType: ArtifactTypeString;
  artifactName: string;
  filePath: string;
  hierarchy: TaskSourceHierarchyItem[];
  acceptanceCriteria: string[];
  relatedStoryIds: string[];
}

export function formatArtifactTypeLabel(type: string | undefined): string {
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

export function buildTaskSourceHierarchyFromArtifact(
  artifact: TaskSourceArtifactNodeLike | null | undefined,
): TaskSourceHierarchyItem[] {
  const hierarchy: TaskSourceHierarchyItem[] = [];
  let current = artifact ?? null;

  while (current) {
    hierarchy.unshift({
      id: current.id,
      type: normalizeArtifactType(current.type),
      name: current.name,
    });
    current = current.parent ?? null;
  }

  return hierarchy;
}

export function buildTaskSourceHierarchyFromMetadata(metadata: unknown): TaskSourceHierarchyItem[] {
  const sourceContext = toRecord(toRecord(metadata).sourceContext);
  const rawHierarchy = sourceContext.hierarchy;
  if (!Array.isArray(rawHierarchy)) {
    return [];
  }

  return rawHierarchy.flatMap((item) => {
    const record = toRecord(item);
    const id = asNonEmptyString(record.id);
    const name = asNonEmptyString(record.name);
    if (!id || !name) {
      return [];
    }

    return [{
      id,
      name,
      type: normalizeArtifactType(asNonEmptyString(record.type) ?? "TASK"),
    }];
  });
}

export function resolveTaskSourceHierarchy(input: {
  sourceArtifact?: TaskSourceArtifactNodeLike | null;
  metadata?: unknown;
}): TaskSourceHierarchyItem[] {
  const relationHierarchy = buildTaskSourceHierarchyFromArtifact(input.sourceArtifact);
  if (relationHierarchy.length > 0) {
    return relationHierarchy;
  }

  return buildTaskSourceHierarchyFromMetadata(input.metadata);
}

export function buildTaskSourcePathText(hierarchy: TaskSourceHierarchyItem[]): string {
  return hierarchy.map((item) => item.name).join(" > ");
}

export function buildTaskDetailHref(workspaceSlug: string, projectSlug: string, taskId: string): string {
  return `/workspace/${workspaceSlug}/project/${projectSlug}/tasks/${taskId}`;
}

export function buildSourceArtifactHref(workspaceSlug: string, projectSlug: string, artifactId: string): string {
  return `/workspace/${workspaceSlug}/project/${projectSlug}?artifactId=${artifactId}#artifact-tree`;
}

export function buildTaskSourceContextSnapshot(
  sourceArtifact: TaskSourceReference,
  options?: {
    acceptanceCriteria?: string[];
    relatedStoryIds?: string[];
  },
): TaskSourceContextSnapshot {
  return {
    artifactId: sourceArtifact.artifactId,
    artifactType: sourceArtifact.artifactType,
    artifactName: sourceArtifact.artifactName,
    filePath: sourceArtifact.filePath,
    hierarchy: sourceArtifact.hierarchy,
    acceptanceCriteria: options?.acceptanceCriteria ?? [],
    relatedStoryIds: options?.relatedStoryIds ?? [],
  };
}

export function resolveTaskCurrentActivity(input: {
  metadata?: unknown;
  currentStage?: string | null;
  nextStep?: string | null;
}): string {
  const metadata = toRecord(input.metadata);

  return (
    asNonEmptyString(metadata.currentActivity)
    ?? asNonEmptyString(input.currentStage)
    ?? asNonEmptyString(input.nextStep)
    ?? TASK_ACTIVITY_FALLBACK
  );
}

export function isTaskApprovalRequiredForDispatch(metadata: unknown): boolean {
  const planningHandoff = toRecord(toRecord(metadata).planningHandoff);
  return planningHandoff.readyState === "approval-required";
}

export function resolveTaskAgentTypeLabel(
  metadata: unknown,
  agentRuns: ArtifactTaskHistoryAgentRun[] = resolveTaskAgentRuns(metadata),
): string {
  const record = toRecord(metadata);

  return (
    agentRuns[0]?.agentTypeLabel
    ?? asNonEmptyString(record.agentTypeLabel)
    ?? asNonEmptyString(record.agentType)
    ?? TASK_AGENT_TYPE_FALLBACK
  );
}

export function resolveTaskResultSummary(metadata: unknown): string {
  const record = toRecord(metadata);

  return (
    asNonEmptyString(record.resultSummary)
    ?? asNonEmptyString(record.executionResultSummary)
    ?? TASK_RESULT_SUMMARY_FALLBACK
  );
}

export function resolveTaskSourceArtifactName(
  sourceArtifact: { name?: string | null } | null | undefined,
  metadata: unknown,
): string {
  return asNonEmptyString(sourceArtifact?.name) ?? resolveTaskSourceHierarchy({ metadata }).at(-1)?.name ?? TASK_SOURCE_NAME_FALLBACK;
}

export function resolveTaskSourceArtifact(input: {
  sourceArtifact?: { id?: string | null; type?: string | null; name?: string | null; filePath?: string | null } | null;
  metadata?: unknown;
}): ResolvedTaskSourceArtifact {
  const metadataSourceContext = toRecord(toRecord(input.metadata).sourceContext);
  const fallbackHierarchyItem = resolveTaskSourceHierarchy({ metadata: input.metadata }).at(-1);

  return {
    id: asNonEmptyString(input.sourceArtifact?.id) ?? asNonEmptyString(metadataSourceContext.artifactId),
    type: normalizeArtifactType(
      asNonEmptyString(input.sourceArtifact?.type)
      ?? asNonEmptyString(metadataSourceContext.artifactType)
      ?? fallbackHierarchyItem?.type
      ?? "TASK",
    ),
    name:
      asNonEmptyString(input.sourceArtifact?.name)
      ?? asNonEmptyString(metadataSourceContext.artifactName)
      ?? fallbackHierarchyItem?.name
      ?? TASK_SOURCE_NAME_FALLBACK,
    filePath:
      asNonEmptyString(input.sourceArtifact?.filePath)
      ?? asNonEmptyString(metadataSourceContext.filePath)
      ?? TASK_SOURCE_PATH_FALLBACK,
  };
}

export function resolveTaskRoutingDecision(metadata: unknown): TaskRoutingDecisionSummary | null {
  const routingDecision = toRecord(toRecord(metadata).routingDecision);
  const selectedAgentType = normalizeTaskAgentType(asNonEmptyString(routingDecision.selectedAgentType));
  if (!selectedAgentType) {
    return null;
  }

  return {
    selectedAgentType,
    decisionSource: normalizeTaskDecisionSource(asNonEmptyString(routingDecision.decisionSource)),
    selectionReasonCode: asNonEmptyString(routingDecision.selectionReasonCode) ?? "unknown",
    selectionReasonSummary: asNonEmptyString(routingDecision.selectionReasonSummary) ?? "系统已完成 Agent 路由。",
    matchedSignals: asStringArray(routingDecision.matchedSignals),
    agentRunId: asNonEmptyString(routingDecision.agentRunId),
    replacedAgentRunId: asNonEmptyString(routingDecision.replacedAgentRunId),
    routedAt: asDateString(routingDecision.routedAt),
    reroutedAt: asDateString(routingDecision.reroutedAt),
  };
}

export function resolveTaskAgentRuns(
  metadata: unknown,
  relationRuns: TaskHistoryAgentRunRecord[] = [],
  currentAgentRunId: string | null = null,
): ArtifactTaskHistoryAgentRun[] {
  if (relationRuns.length > 0) {
    return relationRuns
      .map((run) => {
        const agentType = normalizeTaskAgentType(run.agentType);
        const createdAt = run.createdAt.toISOString();
        const startedAt = run.startedAt?.toISOString() ?? null;
        const completedAt = run.completedAt?.toISOString() ?? null;
        const terminatedAt = run.terminatedAt?.toISOString() ?? null;
        const supersededAt = run.supersededAt?.toISOString() ?? null;
        const runMetadata = toRecord(run.metadata);
        const summary = asNonEmptyString(runMetadata.currentActivity)
          ?? asNonEmptyString(runMetadata.summary)
          ?? run.selectionReasonSummary
          ?? "暂无执行摘要";

        return {
          id: run.id,
          agentType,
          agentTypeLabel: agentType ? TASK_AGENT_TYPE_LABELS[agentType] : TASK_AGENT_TYPE_FALLBACK,
          status: normalizeTaskAgentRunStatus(run.status),
          statusLabel: resolveRunStatusLabel(run.status),
          createdAt,
          startedAt,
          completedAt,
          terminatedAt,
          supersededAt,
          selectionReasonSummary: run.selectionReasonSummary,
          decisionSource: normalizeTaskDecisionSource(run.decisionSource),
          replacesRunId: run.replacesRunId ?? null,
          replacementRunId: run.replacementRun?.id ?? null,
          terminationReasonSummary: run.terminationReasonSummary ?? null,
          isCurrent: currentAgentRunId === run.id,
          summary,
        } satisfies ArtifactTaskHistoryAgentRun;
      })
      .sort((left, right) => compareAgentRuns(left, right));
  }

  const record = toRecord(metadata);
  const rawRuns = [
    ...toArray(record.agentRuns),
    ...toArray(record.runs),
    ...toArray(record.executionRuns),
  ];

  return rawRuns
    .flatMap((item) => {
      const run = toRecord(item);
      const rawAgentTypeLabel = asNonEmptyString(run.agentTypeLabel) ?? asNonEmptyString(run.agentType);
      const statusValue = asNonEmptyString(run.status);
      const rawSummary = asNonEmptyString(run.summary) ?? asNonEmptyString(run.currentActivity);
      const agentType = normalizeTaskAgentType(asNonEmptyString(run.agentType));
      const createdAt = asDateString(run.createdAt);
      const startedAt = asDateString(run.startedAt) ?? asDateString(run.startedAtSnapshot);
      const completedAt = asDateString(run.completedAt) ?? asDateString(run.finishedAt);
      const terminatedAt = asDateString(run.terminatedAt);
      const supersededAt = asDateString(run.supersededAt);

      if (!createdAt && !startedAt && !completedAt && !asNonEmptyString(run.id) && !statusValue && !rawSummary && !rawAgentTypeLabel) {
        return [];
      }

      return [{
        id: asNonEmptyString(run.id),
        agentType,
        agentTypeLabel: rawAgentTypeLabel ?? TASK_AGENT_TYPE_FALLBACK,
        status: normalizeTaskAgentRunStatus(statusValue),
        statusLabel: asNonEmptyString(run.statusLabel) ?? resolveRunStatusLabel(statusValue),
        createdAt,
        startedAt,
        completedAt,
        terminatedAt,
        supersededAt,
        selectionReasonSummary: asNonEmptyString(run.selectionReasonSummary),
        decisionSource: normalizeTaskDecisionSource(asNonEmptyString(run.decisionSource)),
        replacesRunId: asNonEmptyString(run.replacesRunId),
        replacementRunId: asNonEmptyString(run.replacedByRunId),
        terminationReasonSummary: asNonEmptyString(run.terminationReasonSummary),
        isCurrent: currentAgentRunId !== null && currentAgentRunId === asNonEmptyString(run.id),
        summary: rawSummary ?? "暂无执行摘要",
      }];
    })
    .sort((left, right) => compareAgentRuns(left, right));
}

export function resolveTaskArtifacts(metadata: unknown): ArtifactTaskHistoryArtifact[] {
  const record = toRecord(metadata);
  const rawArtifacts = [
    ...toArray(record.artifacts),
    ...toArray(record.outputArtifacts),
    ...toArray(record.generatedArtifacts),
    ...toArray(record.artifactRefs),
  ];

  return rawArtifacts.flatMap((item) => {
    const artifact = toRecord(item);
    const type = asNonEmptyString(artifact.type) ?? asNonEmptyString(artifact.artifactType) ?? asNonEmptyString(artifact.kind);
    const filePath = asNonEmptyString(artifact.filePath) ?? asNonEmptyString(artifact.path);
    const generatedAt = asDateString(artifact.generatedAt) ?? asDateString(artifact.createdAt) ?? asDateString(artifact.updatedAt);
    const rawSummary = asNonEmptyString(artifact.summary) ?? asNonEmptyString(artifact.label);

    if (!type && !filePath && !generatedAt && !rawSummary) {
      return [];
    }

    return [{
      type: type ?? "产物",
      filePath: filePath ?? TASK_ARTIFACT_PATH_FALLBACK,
      generatedAt,
      summary: rawSummary ?? "暂无产物说明",
    }];
  });
}

export function resolveTaskExecutionStartedAt(
  metadata: unknown,
  agentRuns: ArtifactTaskHistoryAgentRun[] = resolveTaskAgentRuns(metadata),
): string | null {
  const record = toRecord(metadata);

  return (
    agentRuns[0]?.startedAt
    ?? agentRuns[0]?.completedAt
    ?? asDateString(record.executionStartedAt)
    ?? asDateString(record.startedAt)
    ?? asDateString(record.executionAt)
    ?? asDateString(record.lastExecutionStartedAt)
    ?? null
  );
}

export function resolveTaskArtifactSummary(
  metadata: unknown,
  artifacts: ArtifactTaskHistoryArtifact[] = resolveTaskArtifacts(metadata),
): string {
  if (artifacts.length > 0) {
    const firstKnownPath = artifacts.find((artifact) => artifact.filePath !== TASK_ARTIFACT_PATH_FALLBACK)?.filePath;
    return firstKnownPath
      ? `已记录 ${artifacts.length} 个产物 · ${firstKnownPath}`
      : `已记录 ${artifacts.length} 个产物`;
  }

  const record = toRecord(metadata);
  return (
    asNonEmptyString(record.artifactSummary)
    ?? asNonEmptyString(record.generatedArtifactsSummary)
    ?? asNonEmptyString(record.outputSummary)
    ?? TASK_ARTIFACT_SUMMARY_FALLBACK
  );
}

export function buildArtifactTaskHistoryEntries(
  tasks: TaskHistoryRecord[],
  options: { workspaceSlug: string; projectSlug: string },
): ArtifactTaskHistoryEntry[] {
  const preparedEntries = tasks.map((task) => {
    const agentRuns = resolveTaskAgentRuns(
      task.metadata,
      task.agentRuns ?? [],
      task.currentAgentRunId ?? null,
    );
    const artifacts = resolveTaskArtifacts(task.metadata);
    const executionStartedAt = resolveTaskExecutionStartedAt(task.metadata, agentRuns);
    const writeback = resolveTaskLatestWriteback(task.writebacks);
    const hasWritebackConflict = (task.status === "done" || task.status === "blocked")
      && (!writeback || writeback.writebackStatus !== "succeeded");

    return {
      sortTimestamp: resolveTaskSortTimestamp(task, executionStartedAt, artifacts, agentRuns, writeback),
      entry: {
        taskId: task.id,
        title: task.title,
        status: task.status,
        executionStartedAt,
        currentStage: asNonEmptyString(task.currentStage) ?? "阶段待更新",
        currentActivity: resolveTaskCurrentActivity(task),
        agentTypeLabel: resolveTaskAgentTypeLabel(task.metadata, agentRuns),
        artifactSummary: resolveTaskArtifactSummary(task.metadata, artifacts),
        resultSummary: writeback?.summary ?? resolveTaskResultSummary(task.metadata),
        sourceArtifactName: resolveTaskSourceArtifactName(task.sourceArtifact, task.metadata),
        taskDetailHref: buildTaskDetailHref(options.workspaceSlug, options.projectSlug, task.id),
        agentRuns,
        artifacts,
        writeback,
        writebackStatusLabel: writeback ? resolveWritebackStatusLabel(writeback.writebackStatus) : null,
        writebackOutcomeLabel: writeback ? resolveWritebackOutcomeLabel(writeback.outcome) : null,
        writebackOccurredAt: writeback?.occurredAt ?? null,
        writebackErrorSummary: writeback?.errorSummary ?? null,
        writebackRecoveryHint: writeback?.recoveryHint ?? null,
        hasWritebackConflict,
      } satisfies ArtifactTaskHistoryEntry,
    };
  });

  return preparedEntries
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp)
    .map((item) => item.entry);
}

export function buildArtifactTaskHistoryPayload(input: {
  artifact: ArtifactTaskHistoryArtifactRecord;
  allArtifacts?: ArtifactTaskHistoryArtifactRecord[];
  tasks: TaskHistoryRecord[];
  workspaceSlug: string;
  projectSlug: string;
}): ArtifactTaskHistoryPayload {
  const artifact = {
    id: input.artifact.id,
    type: input.artifact.type,
    name: input.artifact.name,
  };

  if (input.artifact.type === "STORY") {
    const items = buildArtifactTaskHistoryEntries(input.tasks, {
      workspaceSlug: input.workspaceSlug,
      projectSlug: input.projectSlug,
    });
    const latestWritebackEntry = items.find((item) => item.writeback !== null) ?? null;

    return {
      artifact,
      latestWriteback: latestWritebackEntry?.writeback ?? null,
      latestWritebackTaskDetailHref: latestWritebackEntry?.taskDetailHref ?? null,
      viewType: "story",
      supportsDirectHistory: true,
      supportsExecutionHistory: true,
      items,
      storySummaries: [],
      statusDistribution: createEmptyStatusDistribution(),
    };
  }

  if (input.artifact.type === "EPIC") {
    const storyArtifacts = collectDescendantStoryArtifacts(input.artifact, input.allArtifacts ?? []);
    const storySummaries = storyArtifacts
      .map((storyArtifact) => buildStorySummary(storyArtifact, input.tasks, {
        workspaceSlug: input.workspaceSlug,
        projectSlug: input.projectSlug,
      }))
      .sort((left, right) => {
        if (left.sortTimestamp !== right.sortTimestamp) {
          return right.sortTimestamp - left.sortTimestamp;
        }
        return left.storyName.localeCompare(right.storyName, "zh-CN");
      })
      .map((summary) => toPublicStorySummary(summary));
    const latestWritebackEntry = storySummaries
      .flatMap((summary) => summary.items)
      .find((item) => item.writeback !== null) ?? null;

    return {
      artifact,
      latestWriteback: latestWritebackEntry?.writeback ?? null,
      latestWritebackTaskDetailHref: latestWritebackEntry?.taskDetailHref ?? null,
      viewType: "epic",
      supportsDirectHistory: false,
      supportsExecutionHistory: true,
      items: [],
      storySummaries,
      statusDistribution: buildStatusDistribution(storySummaries),
    };
  }

  return {
    artifact,
    latestWriteback: null,
    latestWritebackTaskDetailHref: null,
    viewType: "unsupported",
    supportsDirectHistory: false,
    supportsExecutionHistory: false,
    items: [],
    storySummaries: [],
    statusDistribution: createEmptyStatusDistribution(),
  };
}

export function filterArtifactTaskHistoryTasks(input: {
  artifact: ArtifactTaskHistoryArtifactRecord;
  allArtifacts?: ArtifactTaskHistoryArtifactRecord[];
  tasks: TaskHistoryRecord[];
}): TaskHistoryRecord[] {
  if (input.artifact.type === "STORY") {
    return input.tasks.filter((task) => matchesStoryArtifactHistory(task, input.artifact));
  }

  if (input.artifact.type === "EPIC") {
    const storyArtifacts = collectDescendantStoryArtifacts(input.artifact, input.allArtifacts ?? []);
    return input.tasks.filter((task) =>
      storyArtifacts.some((storyArtifact) => matchesStoryArtifactHistory(task, storyArtifact))
    );
  }

  return [];
}

export function resolveArtifactTaskHistorySourceArtifactIds(
  artifact: ArtifactTaskHistoryArtifactRecord,
  allArtifacts: ArtifactTaskHistoryArtifactRecord[] = [],
): string[] {
  if (artifact.type === "STORY") {
    return [artifact.id];
  }

  if (artifact.type === "EPIC") {
    return collectDescendantStoryArtifacts(artifact, allArtifacts).map((item) => item.id);
  }

  return [];
}

function buildStorySummary(
  storyArtifact: ArtifactTaskHistoryArtifactRecord,
  tasks: TaskHistoryRecord[],
  options: { workspaceSlug: string; projectSlug: string },
) {
  const storyTasks = tasks.filter((task) => matchesStoryArtifactHistory(task, storyArtifact));
  const items = buildArtifactTaskHistoryEntries(storyTasks, options);
  const aggregateStatus = deriveStoryAggregateStatus(storyTasks);
  const latestActivity = items[0]?.currentActivity ?? "暂未发起执行";
  const latestTaskDetailHref = items[0]?.taskDetailHref ?? null;
  const sortTimestamp = storyTasks.length === 0
    ? 0
    : Math.max(...storyTasks.map((task) => resolveTaskSortTimestamp(
      task,
      resolveTaskExecutionStartedAt(
        task.metadata,
        resolveTaskAgentRuns(task.metadata, task.agentRuns ?? [], task.currentAgentRunId ?? null),
      ),
      resolveTaskArtifacts(task.metadata),
      resolveTaskAgentRuns(task.metadata, task.agentRuns ?? [], task.currentAgentRunId ?? null),
      resolveTaskLatestWriteback(task.writebacks),
    )));

  return {
    storyArtifactId: storyArtifact.id,
    storyName: storyArtifact.name,
    aggregateStatus,
    latestActivity,
    taskCount: storyTasks.length,
    latestTaskDetailHref,
    items,
    sortTimestamp,
  };
}

function toPublicStorySummary(
  summary: ArtifactTaskHistoryStorySummary & { sortTimestamp: number },
): ArtifactTaskHistoryStorySummary {
  return {
    storyArtifactId: summary.storyArtifactId,
    storyName: summary.storyName,
    aggregateStatus: summary.aggregateStatus,
    latestActivity: summary.latestActivity,
    taskCount: summary.taskCount,
    latestTaskDetailHref: summary.latestTaskDetailHref,
    items: summary.items,
  };
}

function buildStatusDistribution(
  storySummaries: Array<Pick<ArtifactTaskHistoryStorySummary, "aggregateStatus">>,
): ArtifactTaskHistoryStatusDistribution {
  return storySummaries.reduce<ArtifactTaskHistoryStatusDistribution>((distribution, summary) => {
    if (summary.aggregateStatus === "completed") {
      distribution.completed += 1;
    } else if (summary.aggregateStatus === "in-progress") {
      distribution.inProgress += 1;
    } else if (summary.aggregateStatus === "dispatched") {
      distribution.dispatched += 1;
    } else if (summary.aggregateStatus === "failed") {
      distribution.failed += 1;
    } else {
      distribution.pending += 1;
    }

    return distribution;
  }, createEmptyStatusDistribution());
}

function createEmptyStatusDistribution(): ArtifactTaskHistoryStatusDistribution {
  return {
    completed: 0,
    inProgress: 0,
    dispatched: 0,
    pending: 0,
    failed: 0,
  };
}

function collectDescendantStoryArtifacts(
  epicArtifact: ArtifactTaskHistoryArtifactRecord,
  allArtifacts: ArtifactTaskHistoryArtifactRecord[],
): ArtifactTaskHistoryArtifactRecord[] {
  const storyMap = new Map<string, ArtifactTaskHistoryArtifactRecord>();
  const childrenByParentId = new Map<string, ArtifactTaskHistoryArtifactRecord[]>();

  for (const artifact of allArtifacts) {
    if (!artifact.parentId) {
      continue;
    }

    const siblings = childrenByParentId.get(artifact.parentId) ?? [];
    siblings.push(artifact);
    childrenByParentId.set(artifact.parentId, siblings);
  }

  const queue = [...(childrenByParentId.get(epicArtifact.id) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current.type === "STORY") {
      storyMap.set(current.id, current);
    }

    const children = childrenByParentId.get(current.id) ?? [];
    queue.push(...children);
  }

  for (const artifact of allArtifacts) {
    if (artifact.type !== "STORY") {
      continue;
    }

    if (matchesEpicMetadataFallback(epicArtifact, artifact)) {
      storyMap.set(artifact.id, artifact);
    }
  }

  return Array.from(storyMap.values());
}

function matchesEpicMetadataFallback(
  epicArtifact: ArtifactTaskHistoryArtifactRecord,
  storyArtifact: ArtifactTaskHistoryArtifactRecord,
): boolean {
  const epicMetadata = toRecord(epicArtifact.metadata);
  const storyMetadata = toRecord(storyArtifact.metadata);

  const epicId = asNonEmptyString(epicMetadata.epicId);
  if (epicId && asNonEmptyString(storyMetadata.epicId) === epicId) {
    return true;
  }

  const storyIds = asStringArray(epicMetadata.stories);
  const storyId = asNonEmptyString(storyMetadata.storyId);
  return Boolean(storyId && storyIds.includes(storyId));
}

function deriveStoryAggregateStatus(tasks: TaskHistoryRecord[]): ArtifactExecutionStatus {
  if (tasks.length === 0) {
    return "pending";
  }

  // Queued tasks (dispatched + executionQueue snapshot) are not truly in-progress.
  // Treat them as pending for aggregate status — they haven't started yet.
  if (tasks.some((task) => task.status === "in-progress")) {
    return "in-progress";
  }

  const latestTask = [...tasks].sort((left, right) => {
    const leftRuns = resolveTaskAgentRuns(left.metadata, left.agentRuns ?? [], left.currentAgentRunId ?? null);
    const leftSort = resolveTaskSortTimestamp(
      left,
      resolveTaskExecutionStartedAt(left.metadata, leftRuns),
      resolveTaskArtifacts(left.metadata),
      leftRuns,
      resolveTaskLatestWriteback(left.writebacks),
    );
    const rightRuns = resolveTaskAgentRuns(right.metadata, right.agentRuns ?? [], right.currentAgentRunId ?? null);
    const rightSort = resolveTaskSortTimestamp(
      right,
      resolveTaskExecutionStartedAt(right.metadata, rightRuns),
      resolveTaskArtifacts(right.metadata),
      rightRuns,
      resolveTaskLatestWriteback(right.writebacks),
    );
    return rightSort - leftSort;
  })[0];

  if (latestTask.status === "dispatched") {
    // Check if the latest dispatched task is actually queued (not yet started).
    // Queued tasks should not elevate the aggregate to "in-progress".
    const isQueued = resolveTaskQueueSnapshot(latestTask) !== null;
    if (isQueued) {
      // Still has tasks that are dispatched-but-queued — not yet truly running.
      // Check if there are any truly running tasks we missed.
      const hasRunning = tasks.some(
        (t) =>
          t.status === "in-progress" ||
          (t.status === "dispatched" && resolveTaskQueueSnapshot(t) === null),
      );
      if (hasRunning) return "in-progress";
      return "pending";
    }
    return "dispatched";
  }

  if (latestTask.status === "review" || latestTask.status === "done") {
    // Current Epic-level UX only has four buckets; map review into "completed" centrally.
    return "completed";
  }

  if (latestTask.status === "blocked") {
    return "failed";
  }

  return "pending";
}

function resolveTaskSourceArtifactId(task: TaskHistoryRecord): string | null {
  return task.sourceArtifactId ?? asNonEmptyString(toRecord(toRecord(task.metadata).sourceContext).artifactId);
}

function resolveTaskSourceFilePath(task: TaskHistoryRecord): string | null {
  return (
    asNonEmptyString(task.sourceArtifact?.filePath)
    ?? asNonEmptyString(toRecord(toRecord(task.metadata).sourceContext).filePath)
    ?? null
  );
}

function resolveArtifactStoryId(artifact: ArtifactTaskHistoryArtifactRecord): string | null {
  return asNonEmptyString(toRecord(artifact.metadata).storyId);
}

function resolveTaskSourceStoryIds(task: TaskHistoryRecord): string[] {
  const sourceArtifactMetadata = toRecord(task.sourceArtifact?.metadata);
  const sourceContext = toRecord(toRecord(task.metadata).sourceContext);
  const storyIds = new Set<string>();

  const directStoryId = asNonEmptyString(sourceArtifactMetadata.storyId);
  if (directStoryId) {
    storyIds.add(directStoryId);
  }

  for (const storyId of asStringArray(sourceContext.relatedStoryIds)) {
    storyIds.add(storyId);
  }

  const sourceContextStoryId = asNonEmptyString(sourceContext.storyId);
  if (sourceContextStoryId) {
    storyIds.add(sourceContextStoryId);
  }

  return [...storyIds];
}

function matchesStoryArtifactHistory(
  task: TaskHistoryRecord,
  storyArtifact: ArtifactTaskHistoryArtifactRecord,
): boolean {
  if (resolveTaskSourceArtifactId(task) === storyArtifact.id) {
    return true;
  }

  const artifactStoryId = resolveArtifactStoryId(storyArtifact);
  if (artifactStoryId && resolveTaskSourceStoryIds(task).includes(artifactStoryId)) {
    return true;
  }

  return resolveTaskSourceFilePath(task) === storyArtifact.filePath;
}

export function resolveTaskLatestWriteback(
  writebacks: TaskHistoryWritebackRecord[] | null | undefined,
): TaskWritebackView | null {
  const latest = writebacks?.[0];
  if (!latest) {
    return null;
  }

  const payload = toRecord(latest.payload);

  return {
    id: latest.id,
    taskId: latest.taskId,
    artifactId: latest.artifactId,
    outcome: normalizeWritebackOutcome(latest.outcome),
    writebackStatus: normalizeWritebackStatus(latest.writebackStatus),
    summary: latest.summary,
    errorSummary: asNonEmptyString(latest.errorSummary) ?? null,
    occurredAt: latest.occurredAt.toISOString(),
    recoveryHint: asNonEmptyString(payload.recoveryHint) ?? null,
    artifacts: toTaskArtifactReferences(payload.artifacts),
  };
}

function resolveTaskSortTimestamp(
  task: TaskHistoryRecord,
  executionStartedAt: string | null,
  artifacts: ArtifactTaskHistoryArtifact[],
  agentRuns: ArtifactTaskHistoryAgentRun[],
  writeback?: TaskWritebackView | null,
): number {
  const artifactTimestamps = artifacts
    .map((artifact) => asDateTimestamp(artifact.generatedAt))
    .filter((value): value is number => value !== null);
  const runTimestamps = agentRuns
    .map((run) => asDateTimestamp(run.createdAt ?? null)
      ?? asDateTimestamp(run.startedAt)
      ?? asDateTimestamp(run.completedAt)
      ?? asDateTimestamp(run.terminatedAt ?? null)
      ?? asDateTimestamp(run.supersededAt ?? null))
    .filter((value): value is number => value !== null);
  const candidateTimestamps = [
    task.createdAt.getTime(),
    ...artifactTimestamps,
    ...runTimestamps,
  ];
  const executionStartedAtTimestamp = asDateTimestamp(executionStartedAt);
  if (executionStartedAtTimestamp !== null) {
    candidateTimestamps.push(executionStartedAtTimestamp);
  }
  const writebackTimestamp = asDateTimestamp(writeback?.occurredAt ?? null);
  if (writebackTimestamp !== null) {
    candidateTimestamps.push(writebackTimestamp);
  }

  return Math.max(...candidateTimestamps);
}

function resolveRunStatusLabel(value: string | null): string {
  const status = normalizeTaskAgentRunStatus(value);
  return status ? TASK_AGENT_RUN_STATUS_LABELS[status] : "状态待记录";
}

function resolveWritebackStatusLabel(value: WritebackStatus): string {
  return WRITEBACK_STATUS_LABELS[value];
}

function resolveWritebackOutcomeLabel(value: WritebackOutcome): string {
  return WRITEBACK_OUTCOME_LABELS[value];
}

function getComparableRunTimestamp(run: ArtifactTaskHistoryAgentRun): number {
  return asDateTimestamp(run.createdAt ?? null)
    ?? asDateTimestamp(run.startedAt)
    ?? asDateTimestamp(run.completedAt)
    ?? asDateTimestamp(run.terminatedAt ?? null)
    ?? asDateTimestamp(run.supersededAt ?? null)
    ?? 0;
}

function toTaskArtifactReferences(value: unknown): ArtifactTaskHistoryArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = toRecord(item);
    const type = asNonEmptyString(record.type);
    const filePath = asNonEmptyString(record.filePath);
    const summary = asNonEmptyString(record.summary);
    const generatedAt = asDateString(record.generatedAt);

    if (!type && !filePath && !summary && !generatedAt) {
      return [];
    }

    return [{
      type: type ?? "产物",
      filePath: filePath ?? TASK_ARTIFACT_PATH_FALLBACK,
      generatedAt,
      summary: summary ?? "暂无产物说明",
    }];
  });
}

function compareAgentRuns(
  left: ArtifactTaskHistoryAgentRun,
  right: ArtifactTaskHistoryAgentRun,
): number {
  if (left.isCurrent && !right.isCurrent) {
    return -1;
  }

  if (!left.isCurrent && right.isCurrent) {
    return 1;
  }

  return getComparableRunTimestamp(right) - getComparableRunTimestamp(left);
}

function normalizeTaskAgentType(value: string | null): TaskAgentType | null {
  if (value === "codex" || value === "claude-code") {
    return value;
  }

  return null;
}

function normalizeTaskAgentRunStatus(value: string | null): TaskAgentRunStatus | null {
  switch (value) {
    case "running":
    case "completed":
    case "failed":
    case "terminated":
    case "superseded":
    case "dispatched":
      return value;
    case "planned":
    case "pending":
      return "dispatched";
    case "in-progress":
      return "running";
    case "done":
      return "completed";
    case "blocked":
      return "failed";
    default:
      return null;
  }
}

function normalizeTaskDecisionSource(value: string | null): TaskRoutingDecisionSummary["decisionSource"] {
  switch (value) {
    case "manual-selection":
    case "task-preference":
    case "project-default":
    case "manual-reroute":
      return value;
    default:
      return "intent-heuristic";
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const parsed = asNonEmptyString(item);
    return parsed ? [parsed] : [];
  });
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asDateString(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  const parsed = asNonEmptyString(value);
  if (!parsed) {
    return null;
  }

  const date = new Date(parsed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function asDateTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getTime();
}

function normalizeArtifactType(value: string): ArtifactTypeString {
  if (value === "PRD" || value === "EPIC" || value === "STORY" || value === "TASK") {
    return value;
  }

  return "TASK";
}

function normalizeWritebackOutcome(value: string): WritebackOutcome {
  if (value === "completed" || value === "failed" || value === "interrupted") {
    return value;
  }

  return "failed";
}

// ── ExecutionSession resolution ──────────────────────────────────────────────────

/**
 * Relation-first: resolve the current active ExecutionSession from a task's
 * session records, with metadata fallback for legacy records.
 */
export function resolveTaskCurrentSession(
  task: {
    executionSessions?: TaskHistoryExecutionSessionRecord[] | null;
    metadata?: unknown;
  },
  currentAgentRunId?: string | null,
): ExecutionSessionSummary | null {
  // Step 1: relation-first.
  const sessions = task.executionSessions;
  if (sessions && sessions.length > 0) {
    // Pick the most recent session for the current run.
    const currentSession = currentAgentRunId
      ? sessions.find((s) => s.agentRunId === currentAgentRunId)
      : sessions[0];
    if (currentSession) {
      const status = normalizeExecutionSessionStatus(currentSession.status);
      return {
        sessionName: currentSession.sessionName,
        transport: currentSession.transport,
        processPid: currentSession.processPid,
        startedAt: currentSession.startedAt?.toISOString() ?? null,
        status,
        statusLabel: resolveExecutionSessionStatusLabel(currentSession.status),
      };
    }
  }

  // Step 2: metadata fallback.
  return resolveSessionFromMetadata(task.metadata);
}

/**
 * Build a full ExecutionSessionView from a raw DB record.
 */
export function resolveTaskCurrentSessionView(
  task: {
    executionSessions?: TaskHistoryExecutionSessionRecord[] | null;
    metadata?: unknown;
  },
  currentAgentRunId?: string | null,
): ExecutionSessionView | null {
  const sessions = task.executionSessions;
  const currentSession = sessions && sessions.length > 0
    ? (currentAgentRunId
      ? sessions.find((s) => s.agentRunId === currentAgentRunId)
      : sessions[0])
    : null;

  if (currentSession) {
    return mapExecutionSessionView(currentSession);
  }

  const meta = resolveSessionFromMetadata(task.metadata);
  if (!meta) {
    return null;
  }

  // Reconstruct a minimal view from metadata.
  const status = normalizeExecutionSessionStatus(meta.status);
  return {
    id: "",
    taskId: "",
    agentRunId: "",
    transport: meta.transport,
    sessionName: meta.sessionName,
    processPid: meta.processPid,
    status,
    statusLabel: EXECUTION_SESSION_STATUS_LABELS[status],
    startedAt: meta.startedAt,
    completedAt: null,
    terminatedAt: null,
    terminationReasonCode: null,
    terminationReasonSummary: null,
    createdAt: "",
  };
}

function mapExecutionSessionView(
  session: TaskHistoryExecutionSessionRecord,
): ExecutionSessionView {
  const status = normalizeExecutionSessionStatus(session.status);
  return {
    id: session.id,
    taskId: session.taskId,
    agentRunId: session.agentRunId,
    transport: session.transport,
    sessionName: session.sessionName,
    processPid: session.processPid,
    status,
    statusLabel: resolveExecutionSessionStatusLabel(session.status),
    startedAt: session.startedAt?.toISOString() ?? null,
    completedAt: session.completedAt?.toISOString() ?? null,
    terminatedAt: session.terminatedAt?.toISOString() ?? null,
    terminationReasonCode: session.terminationReasonCode ?? null,
    terminationReasonSummary: session.terminationReasonSummary ?? null,
    createdAt: session.createdAt.toISOString(),
  };
}

function resolveSessionFromMetadata(
  metadata: unknown,
): ExecutionSessionSummary | null {
  const record = toRecord(metadata);
  const active = toRecord(record.activeExecutionSession);
  const sessionRef = asNonEmptyString(active.sessionRef)
    ?? asNonEmptyString(active.sessionName);
  if (!sessionRef) {
    return null;
  }

  const startedAt = asDateString(active.startedAt);
  const statusValue = asNonEmptyString(active.status);
  const status = normalizeExecutionSessionStatus(statusValue ?? "running");
  return {
    sessionName: sessionRef,
    transport: asNonEmptyString(active.transport) ?? "tmux",
    processPid: active.processPid as number | null ?? null,
    startedAt,
    status,
    statusLabel: resolveExecutionSessionStatusLabel(statusValue ?? "running"),
  };
}

function normalizeExecutionSessionStatus(value: string | null | undefined): ExecutionSessionStatus {
  switch (value) {
    case "starting":
    case "running":
    case "completed":
    case "terminated":
    case "failed":
      return value;
    default:
      return "running";
  }
}

function resolveExecutionSessionStatusLabel(value: string | null | undefined): string {
  const status = normalizeExecutionSessionStatus(value);
  return EXECUTION_SESSION_STATUS_LABELS[status] ?? "未知";
}

function normalizeWritebackStatus(value: string): WritebackStatus {
  if (value === "succeeded" || value === "failed") {
    return value;
  }

  return "failed";
}

// ── Execution Queue helpers (§4.5 Task 4) ──────────────────────────────────────────────────

/**
 * Resolve the execution queue snapshot from task metadata.
 * Returns null if the task is not in the queue.
 */
export function resolveTaskQueueSnapshot(task: {
  metadata?: unknown;
}): ExecutionQueueSnapshot | null {
  const snap = parseExecutionQueueSnapshot(task.metadata);
  return snap.queuePosition !== null ? snap : null;
}

/**
 * Build a human-readable label describing the queue position for a task.
 * Returns null if the task is not in the queue.
 */
export function resolveTaskQueueLabel(task: {
  metadata?: unknown;
}): string | null {
  const snap = parseExecutionQueueSnapshot(task.metadata);
  if (snap.queuePosition === null) return null;

  const slotsUsed = snap.workspaceActiveConcurrentTasks;
  const slotsMax = snap.maxConcurrentTasks;
  const position = snap.queuePosition;
  const waitLabel = snap.estimatedWaitLabel ?? "";

  if (slotsUsed < slotsMax) {
    return `执行槽位可用（${slotsUsed}/${slotsMax}），等待顺位：${position}。${waitLabel}`;
  }

  return `等待顺位：${position}（当前并发：${slotsUsed}/${slotsMax}）。${waitLabel}`;
}

// ── Execution Boundary helpers ────────────────────────────────────────────────────

export interface TaskBoundarySummary {
  projectRootDisplayPath: string | null;
  preparationSucceeded: boolean | null;
  injectedFileCount: number;
  sensitivePathCount: number;
  lastViolationCode: ExecutionBoundaryViolationCode | null;
  lastViolationSummary: string | null;
  lastViolationFatal: boolean;
  boundaryCurrentStage: string | null;
  boundaryNextStep: string | null;
  hasBoundaryProfile: boolean;
}

export const TASK_BOUNDARY_STAGE_NOT_PREPARED = "执行边界尚未准备";
export const TASK_BOUNDARY_STAGE_FAILED = "执行边界准备失败";
export const TASK_BOUNDARY_STAGE_SUCCESS = "已按项目边界准备执行环境";
export const TASK_BOUNDARY_STAGE_VIOLATION = "检测到边界违规";

export const TASK_BOUNDARY_NEXT_STEP_NO_SESSION = "请等待任务启动后查看边界状态。";
export const TASK_BOUNDARY_NEXT_STEP_FAILED = "请检查项目根目录配置后重试，或联系管理员排查。";
export const TASK_BOUNDARY_NEXT_STEP_SUCCESS = "若需补充更多上下文，请在项目边界内显式授权。";
export const TASK_BOUNDARY_NEXT_STEP_VIOLATION = "平台已拦截受控路径访问请求，任务继续执行。";

/**
 * Parse boundary profile from ExecutionSession metadata and build a summary for UI display.
 */
export function parseTaskBoundarySummary(sessionMetadata: unknown): TaskBoundarySummary {
  const profile = parseBoundaryProfile(sessionMetadata);
  if (!profile) {
    return {
      projectRootDisplayPath: null,
      preparationSucceeded: null,
      injectedFileCount: 0,
      sensitivePathCount: 0,
      lastViolationCode: null,
      lastViolationSummary: null,
      lastViolationFatal: false,
      boundaryCurrentStage: null,
      boundaryNextStep: null,
      hasBoundaryProfile: false,
    };
  }

  const stage = resolveBoundaryStage(profile);
  const nextStep = resolveBoundaryNextStep(profile);

  return {
    projectRootDisplayPath: profile.projectRootDisplayPath,
    preparationSucceeded: profile.preparationSucceeded,
    injectedFileCount: profile.injectedFileCount,
    sensitivePathCount: profile.sensitivePathCount,
    lastViolationCode: profile.lastViolationCode,
    lastViolationSummary: profile.lastViolationSummary,
    lastViolationFatal: profile.lastViolationFatal,
    boundaryCurrentStage: profile.boundaryCurrentStage || stage,
    boundaryNextStep: profile.boundaryNextStep || nextStep,
    hasBoundaryProfile: true,
  };
}

function resolveBoundaryStage(profile: {
  preparationSucceeded: boolean;
  lastViolationCode: ExecutionBoundaryViolationCode | null;
  lastViolationFatal: boolean;
}): string {
  if (!profile.preparationSucceeded) {
    return TASK_BOUNDARY_STAGE_FAILED;
  }
  if (profile.lastViolationCode && profile.lastViolationFatal) {
    return TASK_BOUNDARY_STAGE_FAILED;
  }
  if (profile.lastViolationCode) {
    return TASK_BOUNDARY_STAGE_VIOLATION;
  }
  return TASK_BOUNDARY_STAGE_SUCCESS;
}

function resolveBoundaryNextStep(profile: {
  preparationSucceeded: boolean;
  lastViolationCode: ExecutionBoundaryViolationCode | null;
  lastViolationFatal: boolean;
}): string {
  if (!profile.preparationSucceeded) {
    return TASK_BOUNDARY_NEXT_STEP_FAILED;
  }
  if (profile.lastViolationCode && profile.lastViolationFatal) {
    return TASK_BOUNDARY_NEXT_STEP_FAILED;
  }
  if (profile.lastViolationCode) {
    return TASK_BOUNDARY_NEXT_STEP_VIOLATION;
  }
  return TASK_BOUNDARY_NEXT_STEP_SUCCESS;
}

/**
 * Build a human-readable label for a boundary violation code.
 */
export function resolveBoundaryViolationLabel(code: string | null): string {
  if (!code) return "";
  if (code in EXECUTION_BOUNDARY_VIOLATION_LABELS) {
    return EXECUTION_BOUNDARY_VIOLATION_LABELS[code as ExecutionBoundaryViolationCode];
  }
  return code;
}

