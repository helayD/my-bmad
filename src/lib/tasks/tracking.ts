import type { ArtifactTypeString } from "@/lib/artifacts/types";
import {
  WRITEBACK_OUTCOME_LABELS,
  WRITEBACK_STATUS_LABELS,
  type TaskSourceReference,
  type TaskStatus,
  type TaskWritebackView,
  type WritebackOutcome,
  type WritebackStatus,
} from "./types";

export const TASK_ACTIVITY_FALLBACK = "暂无最近活动";
export const TASK_AGENT_TYPE_FALLBACK = "待分配";
export const TASK_RESULT_SUMMARY_FALLBACK = "暂无结果摘要";
export const TASK_SOURCE_NAME_FALLBACK = "来源工件";
export const TASK_SOURCE_PATH_FALLBACK = "来源工件文件路径不可用。";
export const TASK_EXECUTION_TIME_FALLBACK = "尚未开始执行";
export const TASK_ARTIFACT_SUMMARY_FALLBACK = "暂无关键产物";
export const TASK_ARTIFACT_PATH_FALLBACK = "文件路径待记录";
export const TASK_ARTIFACT_GENERATED_AT_FALLBACK = "生成时间待记录";
export const TASK_AGENT_RUN_EMPTY_STATE = "暂无 Agent Run 记录。当前仓库还没有独立 Run 数据，后续接入后会在这里显示。";
export const TASK_ARTIFACTS_EMPTY_STATE = "暂无产物记录。当前任务尚未记录文件产出，可先前往任务详情查看最新状态。";
export const TASK_WRITEBACK_EMPTY_STATE = "该任务尚未生成回写记录。任务结束后，系统会把最新结果同步回来源工件。";
export const TASK_WRITEBACK_CONFLICT_STATE = "任务已结束，但回写尚未成功，请优先处理回写异常。";

export const ARTIFACT_EXECUTION_STATUS_LABELS = {
  completed: "已完成",
  "in-progress": "执行中",
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
  title: string;
  status: string;
  currentStage: string;
  nextStep: string;
  createdAt: Date;
  metadata: unknown;
  sourceArtifact?: TaskSourceArtifactNodeLike | null;
  writebacks?: TaskHistoryWritebackRecord[] | null;
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
  agentTypeLabel: string;
  statusLabel: string;
  startedAt: string | null;
  completedAt: string | null;
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

export function resolveTaskAgentRuns(metadata: unknown): ArtifactTaskHistoryAgentRun[] {
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
      const startedAt = asDateString(run.startedAt) ?? asDateString(run.startedAtSnapshot);
      const completedAt = asDateString(run.completedAt) ?? asDateString(run.finishedAt);

      if (!startedAt && !completedAt && !asNonEmptyString(run.id) && !statusValue && !rawSummary && !rawAgentTypeLabel) {
        return [];
      }

      return [{
        id: asNonEmptyString(run.id),
        agentTypeLabel: rawAgentTypeLabel ?? TASK_AGENT_TYPE_FALLBACK,
        statusLabel: asNonEmptyString(run.statusLabel) ?? resolveRunStatusLabel(statusValue),
        startedAt,
        completedAt,
        summary: rawSummary ?? "暂无执行摘要",
      }];
    })
    .sort((left, right) => getComparableRunTimestamp(right) - getComparableRunTimestamp(left));
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
    const agentRuns = resolveTaskAgentRuns(task.metadata);
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
      resolveTaskExecutionStartedAt(task.metadata),
      resolveTaskArtifacts(task.metadata),
      resolveTaskAgentRuns(task.metadata),
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

  if (tasks.some((task) => task.status === "in-progress")) {
    return "in-progress";
  }

  const latestTask = [...tasks].sort((left, right) => {
    const leftSort = resolveTaskSortTimestamp(
      left,
      resolveTaskExecutionStartedAt(left.metadata),
      resolveTaskArtifacts(left.metadata),
      resolveTaskAgentRuns(left.metadata),
      resolveTaskLatestWriteback(left.writebacks),
    );
    const rightSort = resolveTaskSortTimestamp(
      right,
      resolveTaskExecutionStartedAt(right.metadata),
      resolveTaskArtifacts(right.metadata),
      resolveTaskAgentRuns(right.metadata),
      resolveTaskLatestWriteback(right.writebacks),
    );
    return rightSort - leftSort;
  })[0];

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
    .map((run) => asDateTimestamp(run.startedAt) ?? asDateTimestamp(run.completedAt))
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
  switch (value) {
    case "planned":
      return "已计划";
    case "pending":
      return "待处理（旧）";
    case "in-progress":
      return "进行中";
    case "review":
      return "待评审";
    case "done":
      return "已完成";
    case "blocked":
      return "已阻塞";
    default:
      return "状态待记录";
  }
}

function resolveWritebackStatusLabel(value: WritebackStatus): string {
  return WRITEBACK_STATUS_LABELS[value];
}

function resolveWritebackOutcomeLabel(value: WritebackOutcome): string {
  return WRITEBACK_OUTCOME_LABELS[value];
}

function getComparableRunTimestamp(run: ArtifactTaskHistoryAgentRun): number {
  return asDateTimestamp(run.startedAt) ?? asDateTimestamp(run.completedAt) ?? 0;
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

function normalizeWritebackStatus(value: string): WritebackStatus {
  if (value === "succeeded" || value === "failed") {
    return value;
  }

  return "failed";
}
