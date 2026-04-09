import { parseEpicFile } from "@/lib/bmad/parse-epic-file";
import { parseEpics } from "@/lib/bmad/parse-epics";
import { parseStory } from "@/lib/bmad/parse-story";
import { parsePrdArtifactContent } from "@/lib/artifacts/prd";
import type { ArtifactTypeString } from "@/lib/artifacts/types";
import type { ContentProvider } from "@/lib/content-provider";
import { DEFAULT_TASK_INTENT, DEFAULT_TASK_PRIORITY } from "./defaults";
import type { TaskCreationContext, TaskIntent, TaskPriority, TaskSourceReference } from "./types";

interface ArtifactContextNode {
  id: string;
  type: string;
  name: string;
  filePath: string;
  metadata: unknown;
  parent?: ArtifactContextNode | null;
}

interface NormalizedArtifactContextNode {
  id: string;
  type: ArtifactTypeString;
  name: string;
  filePath: string;
  metadata: Record<string, unknown>;
  parent: NormalizedArtifactContextNode | null;
}

export class TaskContextError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "TaskContextError";
  }
}

export async function buildTaskCreationContext(
  sourceArtifact: ArtifactContextNode,
  provider?: ContentProvider,
): Promise<TaskCreationContext> {
  const artifact = normalizeArtifactNode(sourceArtifact);
  const sourceReference = buildTaskSourceReference(artifact);

  switch (artifact.type) {
    case "PRD":
      return buildPrdContext(artifact, sourceReference, provider);
    case "EPIC":
      return buildEpicContext(artifact, sourceReference, provider);
    case "STORY":
      return buildStoryContext(artifact, sourceReference, provider);
    case "TASK":
      return buildTaskContext(artifact, sourceReference, provider);
    default:
      throw new TaskContextError("ARTIFACT_CONTEXT_ERROR");
  }
}

function normalizeArtifactNode(node: ArtifactContextNode): NormalizedArtifactContextNode {
  return {
    id: node.id,
    type: normalizeArtifactType(node.type),
    name: node.name,
    filePath: node.filePath,
    metadata: toRecord(node.metadata),
    parent: node.parent ? normalizeArtifactNode(node.parent) : null,
  };
}

function normalizeArtifactType(type: string): ArtifactTypeString {
  if (type === "PRD" || type === "EPIC" || type === "STORY" || type === "TASK") {
    return type;
  }

  return "TASK";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function buildTaskSourceReference(node: NormalizedArtifactContextNode): TaskSourceReference {
  const hierarchy: TaskSourceReference["hierarchy"] = [];
  let current: NormalizedArtifactContextNode | null = node;

  while (current) {
    hierarchy.unshift({
      id: current.id,
      type: current.type,
      name: current.name,
    });
    current = current.parent;
  }

  return {
    artifactId: node.id,
    artifactType: node.type,
    artifactName: node.name,
    filePath: node.filePath,
    hierarchy,
  };
}

async function buildPrdContext(
  artifact: NormalizedArtifactContextNode,
  sourceArtifact: TaskSourceReference,
  provider?: ContentProvider,
): Promise<TaskCreationContext> {
  const rawContent = await readArtifactContent(artifact.filePath, provider);
  const parsed = parsePrdArtifactContent(rawContent);

  return {
    sourceArtifact,
    title: artifact.name,
    goal: `围绕 PRD《${artifact.name}》发起执行任务。`,
    summary: parsed.summary,
    detailMarkdown: parsed.body.trim() || parsed.summary,
    acceptanceCriteria: [],
    relatedStoryIds: [],
    suggestedPriority: suggestPriority(artifact.type),
    suggestedIntent: suggestIntent(artifact.type),
  };
}

async function buildEpicContext(
  artifact: NormalizedArtifactContextNode,
  sourceArtifact: TaskSourceReference,
  provider?: ContentProvider,
): Promise<TaskCreationContext> {
  const epicId = asOptionalString(artifact.metadata.epicId);
  const relatedStoryIds = asStringArray(artifact.metadata.stories);
  const metadataDescription = asOptionalString(artifact.metadata.description);

  let detailMarkdown = metadataDescription ?? "";
  let summary = metadataDescription ?? fallbackEpicSummary(artifact.name, relatedStoryIds.length);

  if (!metadataDescription && provider) {
    const rawContent = await readArtifactContent(artifact.filePath, provider);
    const parsed = parseEpicArtifactContent(rawContent, artifact.filePath, epicId);
    if (parsed) {
      detailMarkdown = parsed.detailMarkdown;
      summary = parsed.summary;
    }
  }

  return {
    sourceArtifact,
    title: artifact.name,
    goal: `围绕 Epic《${artifact.name}》发起执行任务。`,
    summary,
    detailMarkdown: detailMarkdown || summary,
    acceptanceCriteria: [],
    relatedStoryIds,
    suggestedPriority: suggestPriority(artifact.type),
    suggestedIntent: suggestIntent(artifact.type),
  };
}

async function buildStoryContext(
  artifact: NormalizedArtifactContextNode,
  sourceArtifact: TaskSourceReference,
  provider?: ContentProvider,
): Promise<TaskCreationContext> {
  const rawContent = await readArtifactContent(artifact.filePath, provider);
  const filename = getFilenameWithoutFragment(artifact.filePath);
  const parsed = parseStory(rawContent, filename);

  if (!parsed) {
    throw new TaskContextError("ARTIFACT_CONTEXT_ERROR");
  }

  return {
    sourceArtifact,
    title: parsed.title,
    goal: `围绕 Story《${parsed.title}》发起执行任务。`,
    summary: buildStorySummary(parsed.description, parsed.acceptanceCriteria.length),
    detailMarkdown: rawContent,
    acceptanceCriteria: parsed.acceptanceCriteria,
    relatedStoryIds: [parsed.id],
    suggestedPriority: suggestPriority(artifact.type),
    suggestedIntent: suggestIntent(artifact.type),
  };
}

async function buildTaskContext(
  artifact: NormalizedArtifactContextNode,
  sourceArtifact: TaskSourceReference,
  provider?: ContentProvider,
): Promise<TaskCreationContext> {
  const rawContent = await readArtifactContent(artifact.filePath, provider);
  const filename = getFilenameWithoutFragment(artifact.filePath);
  const parsed = parseStory(rawContent, filename);

  if (!parsed) {
    throw new TaskContextError("ARTIFACT_CONTEXT_ERROR");
  }

  const taskOrder = getTaskOrderFromPath(artifact.filePath) ?? toNumber(artifact.metadata.order) ?? 1;
  const taskItem = parsed.tasks[taskOrder - 1];
  if (!taskItem) {
    throw new TaskContextError("ARTIFACT_CONTEXT_ERROR");
  }

  const detailMarkdown = [
    `# ${artifact.name}`,
    "",
    `来源 Story：${parsed.title}`,
    "",
    "## 任务说明",
    taskItem.description,
    "",
    ...(parsed.acceptanceCriteria.length > 0
      ? [
          "## 相关验收标准",
          ...parsed.acceptanceCriteria.map((criterion) => `- ${criterion}`),
        ]
      : []),
  ].join("\n");

  return {
    sourceArtifact,
    title: artifact.name,
    goal: `围绕 Task《${artifact.name}》发起执行任务。`,
    summary: taskItem.description,
    detailMarkdown,
    acceptanceCriteria: parsed.acceptanceCriteria,
    relatedStoryIds: [parsed.id],
    suggestedPriority: suggestPriority(artifact.type),
    suggestedIntent: suggestIntent(artifact.type),
  };
}

async function readArtifactContent(filePath: string, provider?: ContentProvider): Promise<string> {
  if (!provider) {
    throw new TaskContextError("ARTIFACT_SOURCE_UNREADABLE");
  }

  try {
    return await provider.getFileContent(stripFileFragment(filePath));
  } catch {
    throw new TaskContextError("ARTIFACT_SOURCE_UNREADABLE");
  }
}

function parseEpicArtifactContent(content: string, filePath: string, epicId?: string | null) {
  if (filePath.includes("#epic-")) {
    const parsed = parseEpics(content);
    const targetEpic = parsed.epics.find((epic) => epic.id === epicId);
    if (!targetEpic) {
      return null;
    }

    return {
      detailMarkdown: [
        `# ${targetEpic.title}`,
        "",
        targetEpic.description,
        "",
        ...(targetEpic.stories.length > 0
          ? [
              "## 关联 Story",
              ...targetEpic.stories.map((storyId) => `- Story ${storyId}`),
            ]
          : []),
      ].join("\n"),
      summary: targetEpic.description || fallbackEpicSummary(targetEpic.title, targetEpic.stories.length),
    };
  }

  const filename = getFilenameWithoutFragment(filePath);
  const epic = parseEpicFile(content, filename);
  if (!epic) {
    return null;
  }

  return {
    detailMarkdown: content,
    summary: epic.description || fallbackEpicSummary(epic.title, epic.stories.length),
  };
}

function fallbackEpicSummary(title: string, storyCount: number): string {
  if (storyCount > 0) {
    return `Epic《${title}》当前包含 ${storyCount} 个相关 Story，可作为执行任务的上层上下文。`;
  }

  return `Epic《${title}》可作为任务的范围与目标来源。`;
}

function buildStorySummary(description: string, acceptanceCriteriaCount: number): string {
  const trimmed = description.trim();
  if (trimmed) {
    return trimmed.length > 280 ? `${trimmed.slice(0, 280).trim()}…` : trimmed;
  }

  if (acceptanceCriteriaCount > 0) {
    return `该 Story 包含 ${acceptanceCriteriaCount} 条验收标准，可直接作为执行任务上下文。`;
  }

  return "该 Story 暂无额外摘要内容。";
}

function suggestIntent(type: ArtifactTypeString): TaskIntent {
  if (type === "PRD" || type === "EPIC") {
    return "research";
  }

  return DEFAULT_TASK_INTENT;
}

function suggestPriority(type: ArtifactTypeString): TaskPriority {
  if (type === "TASK" || type === "STORY") {
    return "high";
  }

  return DEFAULT_TASK_PRIORITY;
}

function stripFileFragment(filePath: string): string {
  return filePath.split("#")[0] ?? filePath;
}

function getFilenameWithoutFragment(filePath: string): string {
  return stripFileFragment(filePath).split("/").pop() ?? stripFileFragment(filePath);
}

function getTaskOrderFromPath(filePath: string): number | null {
  const match = filePath.match(/#task-(\d+)$/);
  return match?.[1] ? Number(match[1]) : null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
