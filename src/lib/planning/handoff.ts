import { Prisma } from "@/generated/prisma/client";
import {
  createProjectContentProvider,
  ProjectProviderError,
  type ProjectRepoProviderConfig,
} from "@/lib/content-provider/project-provider";
import { prisma } from "@/lib/db/client";
import {
  buildTaskCreationContext,
  TaskContextError,
} from "@/lib/tasks/context";
import { getPlannedTaskLifecycle } from "@/lib/tasks/defaults";
import { buildTaskSourceContextSnapshot } from "@/lib/tasks/tracking";
import type { TaskCreationContext, TaskPriority } from "@/lib/tasks/types";
import type { WorkspaceGovernanceSettingsInput } from "@/lib/workspace/types";
import type {
  PlanningHandoffDeferredArtifact,
  PlanningHandoffDispatchMode,
  PlanningHandoffPreview,
  PlanningHandoffReadyState,
  PlanningTaskHandoffSummary,
} from "@/lib/planning/types";
import { parsePlanningArtifactSummary } from "@/lib/planning/types";

const handoffArtifactInclude = {
  parent: {
    include: {
      parent: {
        include: {
          parent: true,
        },
      },
    },
  },
} satisfies Prisma.BmadArtifactInclude;

type HandoffArtifactRecord = Prisma.BmadArtifactGetPayload<{
  include: typeof handoffArtifactInclude;
}>;

interface PlanningRequestHandoffRecord {
  id: string;
  artifactSummary: unknown;
}

interface ResolvedPlanningTaskCandidate {
  taskArtifact: HandoffArtifactRecord;
  storyArtifact: HandoffArtifactRecord;
  taskOrder: number;
  storySortValue: StorySortValue;
}

interface ConfirmedPlanningTaskCandidate extends ResolvedPlanningTaskCandidate {
  creationContext: TaskCreationContext;
}

interface StorySortValue {
  epicNumber: number;
  storyNumber: number;
  fallback: string;
}

interface ResolvedPlanningHandoffSelection {
  confirmedCandidates: ResolvedPlanningTaskCandidate[];
  confirmedArtifactIds: string[];
  deferredArtifacts: PlanningHandoffDeferredArtifact[];
  deferredArtifactIds: string[];
}

interface ConfirmPlanningRequestHandoffInput {
  workspaceId: string;
  projectId: string;
  planningRequestId: string;
  actorUserId: string;
  planningRequest: PlanningRequestHandoffRecord;
  repo: ProjectRepoProviderConfig;
  settings: WorkspaceGovernanceSettingsInput;
  deferredArtifactIds?: string[];
}

interface ConfirmPlanningRequestHandoffResult {
  didConfirm: boolean;
  createdTaskIds: string[];
  summary: PlanningTaskHandoffSummary | null;
}

export class PlanningHandoffServiceError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "PlanningHandoffServiceError";
  }
}

export async function getPlanningRequestHandoffPreview(input: {
  projectId: string;
  planningRequest: PlanningRequestHandoffRecord;
  settings: WorkspaceGovernanceSettingsInput;
}): Promise<PlanningHandoffPreview> {
  const candidates = await loadPlanningTaskCandidates(
    input.projectId,
    input.planningRequest.artifactSummary,
  );
  const groups = buildPlanningHandoffGroups(candidates);
  const dispatchMode = resolvePlanningHandoffDispatchMode(input.settings);

  return {
    planningRequestId: input.planningRequest.id,
    dispatchMode,
    approvalRequired: input.settings.requireApprovalBeforeExecution,
    candidateTaskCount: candidates.length,
    storyCount: groups.length,
    groups,
  };
}

export async function confirmPlanningRequestHandoff(
  input: ConfirmPlanningRequestHandoffInput,
): Promise<ConfirmPlanningRequestHandoffResult> {
  const candidates = await loadPlanningTaskCandidates(
    input.projectId,
    input.planningRequest.artifactSummary,
  );
  if (candidates.length === 0) {
    throw new PlanningHandoffServiceError("PLANNING_REQUEST_NO_EXECUTABLE_TASKS");
  }

  const selection = resolvePlanningHandoffSelection(
    candidates,
    input.deferredArtifactIds ?? [],
  );

  const dispatchMode = resolvePlanningHandoffDispatchMode(input.settings);
  const readyState = resolvePlanningHandoffReadyState({
    dispatchMode,
    requireApprovalBeforeExecution: input.settings.requireApprovalBeforeExecution,
  });
  const lifecycle = getPlannedTaskLifecycle({
    autoDispatchAfterPlanning: input.settings.autoDispatchAfterPlanning,
    requireApprovalBeforeExecution: input.settings.requireApprovalBeforeExecution,
  });

  const provider = await createProjectContentProvider(input.repo, input.actorUserId);
  const confirmedCandidates = await Promise.all(
    selection.confirmedCandidates.map(async (candidate) => ({
      ...candidate,
      creationContext: await buildTaskCreationContext(candidate.taskArtifact, provider),
    })),
  );

  confirmedCandidates.sort((left, right) =>
    compareCandidatesByDispatchPriority(left, right),
  );

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const claim = await tx.planningRequest.updateMany({
      where: {
        id: input.planningRequestId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        routeType: "planning",
        status: "awaiting-confirmation",
      },
      data: {
        status: "execution-ready",
        progressPercent: 100,
        nextStep: "正在确认规划结果并生成执行任务。",
        confirmedAt: now,
        derivedTaskCount: 0,
        deferredArtifactCount: selection.deferredArtifacts.length,
        taskHandoffSummary: Prisma.JsonNull,
      },
    });

    if (claim.count === 0) {
      return {
        didConfirm: false,
        createdTaskIds: [],
        summary: null,
      };
    }

    const createdTasks: PlanningTaskHandoffSummary["createdTasks"] = [];
    for (const [index, candidate] of confirmedCandidates.entries()) {
      const sourceContext = buildTaskSourceContextSnapshot(
        candidate.creationContext.sourceArtifact,
        {
          acceptanceCriteria: candidate.creationContext.acceptanceCriteria,
          relatedStoryIds: candidate.creationContext.relatedStoryIds,
        },
      );

      const task = await tx.task.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          planningRequestId: input.planningRequestId,
          sourceArtifactId: candidate.taskArtifact.id,
          title: candidate.creationContext.title,
          goal: candidate.creationContext.goal,
          summary: candidate.creationContext.summary,
          priority: candidate.creationContext.suggestedPriority,
          intent: candidate.creationContext.suggestedIntent,
          status: lifecycle.status,
          currentStage: lifecycle.currentStage,
          nextStep: lifecycle.nextStep,
          metadata: {
            currentActivity: lifecycle.currentActivity,
            sourceContext,
            planningHandoff: {
              source: "planning-request",
              planningRequestId: input.planningRequestId,
              dispatchMode,
              readyState,
              queuePosition: index + 1,
              approvalRequired: input.settings.requireApprovalBeforeExecution,
            },
          } as unknown as Prisma.InputJsonValue,
          createdByUserId: input.actorUserId,
        },
      });

      createdTasks.push({
        taskId: task.id,
        taskTitle: task.title,
        sourceArtifactId: candidate.taskArtifact.id,
        sourceArtifactName: candidate.taskArtifact.name,
        sourceArtifactPath: candidate.taskArtifact.filePath,
        storyArtifactId: candidate.storyArtifact.id,
        storyTitle: candidate.storyArtifact.name,
        priority: task.priority as TaskPriority,
        intent: task.intent as TaskCreationContext["suggestedIntent"],
        status: task.status as typeof lifecycle.status,
        currentStage: task.currentStage,
        nextStep: task.nextStep,
        queuePosition: index + 1,
        readyState,
      });
    }

    const summary = buildPlanningTaskHandoffSummary({
      confirmedAt: now,
      dispatchMode,
      readyState,
      candidateTaskCount: candidates.length,
      createdTasks,
      deferredArtifacts: selection.deferredArtifacts,
    });

    await tx.planningRequest.update({
      where: { id: input.planningRequestId },
      data: {
        status: "execution-ready",
        progressPercent: 100,
        nextStep: buildPlanningExecutionReadyNextStep({
          dispatchMode,
          approvalRequired: input.settings.requireApprovalBeforeExecution,
          createdTaskCount: createdTasks.length,
          deferredArtifactCount: selection.deferredArtifacts.length,
        }),
        confirmedAt: now,
        taskHandoffSummary: summary as unknown as Prisma.InputJsonValue,
        derivedTaskCount: createdTasks.length,
        deferredArtifactCount: selection.deferredArtifacts.length,
      },
    });

    const dispatchQueue = createdTasks.map((task) => ({
      taskId: task.taskId,
      sourceArtifactId: task.sourceArtifactId,
      queuePosition: task.queuePosition,
      priority: task.priority,
      readyState,
    }));

    await tx.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        planningRequestId: input.planningRequestId,
        eventName: "planningRequest.confirmed",
        occurredAt: now,
        payload: {
          planningRequestId: input.planningRequestId,
          confirmedArtifactIds: selection.confirmedArtifactIds,
          deferredArtifactIds: selection.deferredArtifactIds,
          dispatchMode,
          approvalRequired: input.settings.requireApprovalBeforeExecution,
          createdTaskIds: createdTasks.map((task) => task.taskId),
          dispatchQueue,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (createdTasks.length > 0) {
      await tx.auditEvent.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          planningRequestId: input.planningRequestId,
          eventName: "planningRequest.executionTasksCreated",
          occurredAt: now,
          payload: {
            planningRequestId: input.planningRequestId,
            confirmedArtifactIds: selection.confirmedArtifactIds,
            deferredArtifactIds: selection.deferredArtifactIds,
            dispatchMode,
            approvalRequired: input.settings.requireApprovalBeforeExecution,
            createdTaskIds: createdTasks.map((task) => task.taskId),
            dispatchQueue,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    if (selection.deferredArtifacts.length > 0) {
      await tx.auditEvent.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          planningRequestId: input.planningRequestId,
          eventName: "planningRequest.executionTasksDeferred",
          occurredAt: now,
          payload: {
            planningRequestId: input.planningRequestId,
            confirmedArtifactIds: selection.confirmedArtifactIds,
            deferredArtifactIds: selection.deferredArtifactIds,
            dispatchMode,
            approvalRequired: input.settings.requireApprovalBeforeExecution,
            createdTaskIds: createdTasks.map((task) => task.taskId),
            dispatchQueue,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return {
      didConfirm: true,
      createdTaskIds: createdTasks.map((task) => task.taskId),
      summary,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export function isPlanningHandoffRecoverableError(
  error: unknown,
): error is PlanningHandoffServiceError | TaskContextError | ProjectProviderError {
  return (
    error instanceof PlanningHandoffServiceError
    || error instanceof TaskContextError
    || error instanceof ProjectProviderError
  );
}

async function loadPlanningTaskCandidates(
  projectId: string,
  artifactSummary: unknown,
): Promise<ResolvedPlanningTaskCandidate[]> {
  const storyPaths = extractPlanningStoryPaths(artifactSummary);
  if (storyPaths.length === 0) {
    return [];
  }

  const taskPathFilters = storyPaths.map((storyPath) => ({
    filePath: {
      startsWith: `${storyPath}#task-`,
    },
  }));

  const artifacts = await prisma.bmadArtifact.findMany({
    where: {
      projectId,
      status: "active",
      OR: [
        {
          type: "STORY",
          filePath: {
            in: storyPaths,
          },
        },
        {
          type: "TASK",
          OR: taskPathFilters,
        },
      ],
    },
    include: handoffArtifactInclude,
  });

  const storyById = new Map(
    artifacts
      .filter((artifact) => artifact.type === "STORY")
      .map((artifact) => [artifact.id, artifact] as const),
  );
  const storyByPath = new Map(
    artifacts
      .filter((artifact) => artifact.type === "STORY")
      .map((artifact) => [artifact.filePath, artifact] as const),
  );

  const candidates = artifacts
    .filter((artifact) => artifact.type === "TASK")
    .flatMap((taskArtifact) => {
      const storyArtifact = resolveTaskStoryArtifact(taskArtifact, storyById, storyByPath);
      if (!storyArtifact) {
        return [];
      }

      return [{
        taskArtifact,
        storyArtifact,
        taskOrder: resolveTaskOrder(taskArtifact),
        storySortValue: resolveStorySortValue(storyArtifact),
      }];
    });

  return candidates.sort(compareCandidatesByStoryOrder);
}

function extractPlanningStoryPaths(artifactSummary: unknown): string[] {
  const summary = parsePlanningArtifactSummary(artifactSummary);

  return [...new Set(
    summary
      .filter((item) => item.kind === "story-stub")
      .map((item) => item.path),
  )];
}

function resolveTaskStoryArtifact(
  taskArtifact: HandoffArtifactRecord,
  storyById: Map<string, HandoffArtifactRecord>,
  storyByPath: Map<string, HandoffArtifactRecord>,
): HandoffArtifactRecord | null {
  if (taskArtifact.parentId) {
    const storyByParent = storyById.get(taskArtifact.parentId);
    if (storyByParent) {
      return storyByParent;
    }
  }

  return storyByPath.get(stripFileFragment(taskArtifact.filePath)) ?? null;
}

function buildPlanningHandoffGroups(
  candidates: ResolvedPlanningTaskCandidate[],
): PlanningHandoffPreview["groups"] {
  const groups = new Map<string, PlanningHandoffPreview["groups"][number]>();

  for (const candidate of candidates) {
    const existing = groups.get(candidate.storyArtifact.id);
    const nextTask = {
      artifactId: candidate.taskArtifact.id,
      artifactName: candidate.taskArtifact.name,
      filePath: candidate.taskArtifact.filePath,
      storyArtifactId: candidate.storyArtifact.id,
      storyTitle: candidate.storyArtifact.name,
      storyFilePath: candidate.storyArtifact.filePath,
      order: candidate.taskOrder,
    };

    if (existing) {
      existing.tasks.push(nextTask);
      continue;
    }

    groups.set(candidate.storyArtifact.id, {
      storyArtifactId: candidate.storyArtifact.id,
      storyTitle: candidate.storyArtifact.name,
      storyFilePath: candidate.storyArtifact.filePath,
      storyId: resolveStoryId(candidate.storyArtifact),
      tasks: [nextTask],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      tasks: [...group.tasks].sort((left, right) => left.order - right.order),
    }))
    .sort((left, right) => compareStoryGroups(left, right));
}

function resolvePlanningHandoffSelection(
  candidates: ResolvedPlanningTaskCandidate[],
  deferredArtifactIds: string[],
): ResolvedPlanningHandoffSelection {
  const validStoryIds = new Set(candidates.map((candidate) => candidate.storyArtifact.id));
  const validTaskIds = new Set(candidates.map((candidate) => candidate.taskArtifact.id));
  const deferredStoryIds = new Set<string>();
  const deferredTaskIds = new Set<string>();

  for (const artifactId of deferredArtifactIds) {
    if (validStoryIds.has(artifactId)) {
      deferredStoryIds.add(artifactId);
      continue;
    }

    if (validTaskIds.has(artifactId)) {
      deferredTaskIds.add(artifactId);
      continue;
    }

    throw new PlanningHandoffServiceError(
      "PLANNING_REQUEST_CONFIRMATION_INVALID_SELECTION",
    );
  }

  const confirmedCandidates: ResolvedPlanningTaskCandidate[] = [];
  const deferredArtifacts: PlanningHandoffDeferredArtifact[] = [];

  for (const candidate of candidates) {
    const deferredBy = deferredStoryIds.has(candidate.storyArtifact.id)
      ? "story"
      : deferredTaskIds.has(candidate.taskArtifact.id)
        ? "task"
        : null;

    if (!deferredBy) {
      confirmedCandidates.push(candidate);
      continue;
    }

    deferredArtifacts.push({
      artifactId: candidate.taskArtifact.id,
      artifactType: "TASK",
      artifactName: candidate.taskArtifact.name,
      filePath: candidate.taskArtifact.filePath,
      storyArtifactId: candidate.storyArtifact.id,
      storyTitle: candidate.storyArtifact.name,
      deferredBy,
    });
  }

  return {
    confirmedCandidates,
    confirmedArtifactIds: confirmedCandidates.map((candidate) => candidate.taskArtifact.id),
    deferredArtifacts,
    deferredArtifactIds: deferredArtifacts.map((artifact) => artifact.artifactId),
  };
}

function resolvePlanningHandoffDispatchMode(
  settings: WorkspaceGovernanceSettingsInput,
): PlanningHandoffDispatchMode {
  return settings.autoDispatchAfterPlanning ? "auto" : "manual";
}

function resolvePlanningHandoffReadyState(input: {
  dispatchMode: PlanningHandoffDispatchMode;
  requireApprovalBeforeExecution: boolean;
}): PlanningHandoffReadyState {
  if (input.requireApprovalBeforeExecution) {
    return "approval-required";
  }

  return input.dispatchMode === "auto" ? "auto-ready" : "manual";
}

function compareCandidatesByStoryOrder(
  left: ResolvedPlanningTaskCandidate,
  right: ResolvedPlanningTaskCandidate,
): number {
  const storyCompare = compareStorySortValue(left.storySortValue, right.storySortValue);
  if (storyCompare !== 0) {
    return storyCompare;
  }

  if (left.taskOrder !== right.taskOrder) {
    return left.taskOrder - right.taskOrder;
  }

  return left.taskArtifact.name.localeCompare(right.taskArtifact.name, "zh-CN");
}

function compareCandidatesByDispatchPriority(
  left: ConfirmedPlanningTaskCandidate,
  right: ConfirmedPlanningTaskCandidate,
): number {
  const priorityCompare = priorityRank(left.creationContext.suggestedPriority)
    - priorityRank(right.creationContext.suggestedPriority);
  if (priorityCompare !== 0) {
    return priorityCompare;
  }

  return compareCandidatesByStoryOrder(left, right);
}

function priorityRank(priority: TaskPriority): number {
  switch (priority) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    default:
      return 99;
  }
}

function buildPlanningTaskHandoffSummary(input: {
  confirmedAt: Date;
  dispatchMode: PlanningHandoffDispatchMode;
  readyState: PlanningHandoffReadyState;
  candidateTaskCount: number;
  createdTasks: PlanningTaskHandoffSummary["createdTasks"];
  deferredArtifacts: PlanningHandoffDeferredArtifact[];
}): PlanningTaskHandoffSummary {
  return {
    source: "planning-request-handoff",
    confirmedAt: input.confirmedAt.toISOString(),
    dispatchMode: input.dispatchMode,
    approvalRequired: input.readyState === "approval-required",
    candidateTaskCount: input.candidateTaskCount,
    createdTaskCount: input.createdTasks.length,
    deferredArtifactCount: input.deferredArtifacts.length,
    deduplicatedTaskCount: 0,
    createdTasks: input.createdTasks,
    deferredArtifacts: input.deferredArtifacts,
  };
}

function buildPlanningExecutionReadyNextStep(input: {
  dispatchMode: PlanningHandoffDispatchMode;
  approvalRequired: boolean;
  createdTaskCount: number;
  deferredArtifactCount: number;
}): string {
  if (input.createdTaskCount === 0 && input.deferredArtifactCount > 0) {
    return "已确认规划结果，当前可执行项均被标记为暂不执行，尚未开始编码。";
  }

  if (input.approvalRequired) {
    return input.dispatchMode === "auto"
      ? "已确认规划结果并生成执行任务，等待审批通过后进入自动派发，尚未开始编码。"
      : "已确认规划结果并生成执行任务，等待审批通过后再派发，尚未开始编码。";
  }

  return input.dispatchMode === "auto"
    ? "已确认规划结果并生成执行任务，任务已进入自动派发准备顺序，尚未开始编码。"
    : "已确认规划结果并生成执行任务，当前等待手动派发，尚未开始编码。";
}

function compareStoryGroups(
  left: PlanningHandoffPreview["groups"][number],
  right: PlanningHandoffPreview["groups"][number],
): number {
  return compareStorySortValue(
    resolveStorySortValue({
      filePath: left.storyFilePath,
      metadata: left.storyId ? { storyId: left.storyId } : null,
    }),
    resolveStorySortValue({
      filePath: right.storyFilePath,
      metadata: right.storyId ? { storyId: right.storyId } : null,
    }),
  );
}

function resolveStorySortValue(artifact: Pick<HandoffArtifactRecord, "filePath" | "metadata">): StorySortValue {
  const metadata = toRecord(artifact.metadata);
  const storyId = asNonEmptyString(metadata.storyId) ?? resolveStoryIdFromPath(artifact.filePath);
  if (!storyId) {
    return {
      epicNumber: Number.MAX_SAFE_INTEGER,
      storyNumber: Number.MAX_SAFE_INTEGER,
      fallback: artifact.filePath,
    };
  }

  const [epicPart, storyPart] = storyId.split(".");

  return {
    epicNumber: toSafeInt(epicPart),
    storyNumber: toSafeInt(storyPart),
    fallback: storyId,
  };
}

function compareStorySortValue(left: StorySortValue, right: StorySortValue): number {
  if (left.epicNumber !== right.epicNumber) {
    return left.epicNumber - right.epicNumber;
  }

  if (left.storyNumber !== right.storyNumber) {
    return left.storyNumber - right.storyNumber;
  }

  return left.fallback.localeCompare(right.fallback, "zh-CN");
}

function resolveTaskOrder(artifact: Pick<HandoffArtifactRecord, "filePath" | "metadata">): number {
  const metadata = toRecord(artifact.metadata);
  const metadataOrder = metadata.order;
  if (typeof metadataOrder === "number" && Number.isFinite(metadataOrder) && metadataOrder > 0) {
    return metadataOrder;
  }

  const match = artifact.filePath.match(/#task-(\d+)$/);
  return match?.[1] ? Number(match[1]) : 1;
}

function resolveStoryId(
  artifact: Pick<HandoffArtifactRecord, "filePath" | "metadata">,
): string | null {
  const metadata = toRecord(artifact.metadata);
  return asNonEmptyString(metadata.storyId) ?? resolveStoryIdFromPath(artifact.filePath);
}

function resolveStoryIdFromPath(filePath: string): string | null {
  const match = stripFileFragment(filePath).match(/\/(\d+)-(\d+)-[^/]+\.md$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return `${match[1]}.${match[2]}`;
}

function stripFileFragment(filePath: string): string {
  return filePath.split("#")[0] ?? filePath;
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

function toSafeInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return Number.MAX_SAFE_INTEGER;
}
