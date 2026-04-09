import type { ArtifactTypeString } from "@/lib/artifacts/types";
import type { TaskStatus } from "./types";

export const TASK_ACTIVITY_FALLBACK = "暂无最近活动";
export const TASK_AGENT_TYPE_FALLBACK = "待分配";
export const TASK_RESULT_SUMMARY_FALLBACK = "暂无结果摘要";
export const TASK_SOURCE_NAME_FALLBACK = "来源工件";
export const TASK_SOURCE_PATH_FALLBACK = "来源工件文件路径不可用。";

export interface TaskSourceHierarchyItem {
  id: string;
  type: ArtifactTypeString;
  name: string;
}

interface TaskSourceArtifactNodeLike {
  id: string;
  type: string;
  name: string;
  parent?: TaskSourceArtifactNodeLike | null;
}

interface TaskHistoryRecord {
  id: string;
  title: string;
  status: string;
  currentStage: string;
  nextStep: string;
  createdAt: Date;
  metadata: unknown;
  sourceArtifact?: TaskSourceArtifactNodeLike | null;
}

export interface ArtifactTaskHistoryEntry {
  taskId: string;
  title: string;
  status: string;
  createdAt: string;
  currentStage: string;
  currentActivity: string;
  agentTypeLabel: string;
  resultSummary: string;
  sourceArtifactName: string;
}

export interface ArtifactTaskHistoryPayload {
  artifact: {
    id: string;
    type: ArtifactTypeString;
    name: string;
  };
  supportsDirectHistory: boolean;
  items: ArtifactTaskHistoryEntry[];
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

export function resolveTaskAgentTypeLabel(metadata: unknown): string {
  const record = toRecord(metadata);

  return asNonEmptyString(record.agentTypeLabel) ?? asNonEmptyString(record.agentType) ?? TASK_AGENT_TYPE_FALLBACK;
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

export function buildArtifactTaskHistoryEntries(tasks: TaskHistoryRecord[]): ArtifactTaskHistoryEntry[] {
  return [...tasks]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      currentStage: task.currentStage,
      currentActivity: resolveTaskCurrentActivity(task),
      agentTypeLabel: resolveTaskAgentTypeLabel(task.metadata),
      resultSummary: resolveTaskResultSummary(task.metadata),
      sourceArtifactName: resolveTaskSourceArtifactName(task.sourceArtifact, task.metadata),
    }));
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeArtifactType(value: string): ArtifactTypeString {
  if (value === "PRD" || value === "EPIC" || value === "STORY" || value === "TASK") {
    return value;
  }

  return "TASK";
}
