import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  getArtifactsByProjectIdAndFilePaths,
  getArtifactsByProjectIdAndIds,
  getTasksByPlanningRequestIds,
} from "@/lib/db/helpers";
import {
  parsePlanningArtifactSummary,
  parsePlanningExecutionHandoffDraft,
  parsePlanningExecutionSteps,
  parsePlanningTaskHandoffSummary,
  planningHandoffReadyStateSchema,
  resolvePlanningRequestProblemSummary,
  type PlanningRequestDetailView,
  type PlanningRequestListItem,
  type PlanningRequestRoute,
  type PlanningRequestStatus,
  type PlanningSelectionReasonCode,
  type PlanningStatusFilter,
} from "@/lib/planning/types";

export const planningRequestListItemSelect = {
  id: true,
  rawGoal: true,
  status: true,
  progressPercent: true,
  nextStep: true,
  routeType: true,
  selectionReasonCode: true,
  selectionReasonSummary: true,
  selectedAgentKeys: true,
  selectedSkillKeys: true,
  analyzedAt: true,
  executionHandoffDraft: true,
  executionStartedAt: true,
  executionCompletedAt: true,
  executionFailedAt: true,
  confirmedAt: true,
  artifactSummary: true,
  taskHandoffSummary: true,
  generatedArtifactCount: true,
  derivedTaskCount: true,
  deferredArtifactCount: true,
  lastExecutionErrorCode: true,
  executionSteps: {
    orderBy: [{ sequence: "asc" }],
    select: {
      id: true,
      skillKey: true,
      stepKey: true,
      sequence: true,
      status: true,
      title: true,
      startedAt: true,
      completedAt: true,
      failedAt: true,
      errorCode: true,
      errorMessage: true,
      outputSummary: true,
      artifactPaths: true,
      retryCount: true,
    },
  },
  createdAt: true,
  updatedAt: true,
  createdByUser: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} satisfies Prisma.PlanningRequestSelect;

type PlanningRequestListItemRecord = Prisma.PlanningRequestGetPayload<{
  select: typeof planningRequestListItemSelect;
}>;

type PlanningRequestTaskRecord = Awaited<
  ReturnType<typeof getTasksByPlanningRequestIds>
>[number];

export function mapPlanningRequestListItem(
  record: PlanningRequestListItemRecord,
): PlanningRequestListItem {
  return {
    id: record.id,
    rawGoal: record.rawGoal,
    status: record.status as PlanningRequestStatus,
    progressPercent: record.progressPercent,
    nextStep: record.nextStep,
    routeType: (record.routeType as PlanningRequestRoute | null) ?? null,
    selectionReasonCode:
      (record.selectionReasonCode as PlanningSelectionReasonCode | null) ?? null,
    selectionReasonSummary: record.selectionReasonSummary,
    selectedAgentKeys: [...record.selectedAgentKeys],
    selectedSkillKeys: [...record.selectedSkillKeys],
    analyzedAt: record.analyzedAt?.toISOString() ?? null,
    executionStartedAt: record.executionStartedAt?.toISOString() ?? null,
    executionCompletedAt: record.executionCompletedAt?.toISOString() ?? null,
    executionFailedAt: record.executionFailedAt?.toISOString() ?? null,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    lastExecutionErrorCode: record.lastExecutionErrorCode,
    generatedArtifactCount: record.generatedArtifactCount ?? 0,
    derivedTaskCount: record.derivedTaskCount ?? 0,
    deferredArtifactCount: record.deferredArtifactCount ?? 0,
    artifactSummary: parsePlanningArtifactSummary(record.artifactSummary),
    executionSteps: parsePlanningExecutionSteps(
      record.executionSteps.map((step) => ({
        ...step,
        status: step.status,
        startedAt: step.startedAt?.toISOString() ?? null,
        completedAt: step.completedAt?.toISOString() ?? null,
        failedAt: step.failedAt?.toISOString() ?? null,
      })),
    ),
    executionHandoffDraft: parsePlanningExecutionHandoffDraft(record.executionHandoffDraft),
    taskHandoffSummary: parsePlanningTaskHandoffSummary(record.taskHandoffSummary),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    createdByUser: {
      id: record.createdByUser.id,
      name: record.createdByUser.name,
      email: record.createdByUser.email,
    },
  };
}

export const getPlanningRequestsByProjectId = cache(
  async (
    projectId: string,
    filter: PlanningStatusFilter = "all",
  ): Promise<PlanningRequestListItem[]> => {
    const rows = await prisma.planningRequest.findMany({
      where: {
        projectId,
        ...(filter === "all" ? {} : { status: filter }),
      },
      orderBy: [{ createdAt: "desc" }],
      select: planningRequestListItemSelect,
    });

    return enrichPlanningRequestsWithTaskTruth(
      projectId,
      rows.map(mapPlanningRequestListItem),
    );
  },
);

export const getRecentPlanningRequestsByProjectId = cache(
  async (
    projectId: string,
    limit = 5,
    filter: PlanningStatusFilter = "all",
  ): Promise<PlanningRequestListItem[]> => {
    const take = Math.min(Math.max(limit, 1), 10);
    const rows = await prisma.planningRequest.findMany({
      where: {
        projectId,
        ...(filter === "all" ? {} : { status: filter }),
      },
      orderBy: [{ createdAt: "desc" }],
      take,
      select: planningRequestListItemSelect,
    });

    return enrichPlanningRequestsWithTaskTruth(
      projectId,
      rows.map(mapPlanningRequestListItem),
    );
  },
);

export const getPlanningRequestDetailById = cache(
  async (
    projectId: string,
    planningRequestId: string,
  ): Promise<PlanningRequestDetailView | null> => {
    const record = await prisma.planningRequest.findFirst({
      where: {
        id: planningRequestId,
        projectId,
      },
      select: planningRequestListItemSelect,
    });

    if (!record) {
      return null;
    }

    const request = mapPlanningRequestListItem(record);
    const detailViews = await buildPlanningRequestDetailViews(projectId, [request]);
    return detailViews.get(planningRequestId) ?? null;
  },
);

async function buildPlanningRequestDetailViews(
  projectId: string,
  requests: PlanningRequestListItem[],
): Promise<Map<string, PlanningRequestDetailView>> {
  if (requests.length === 0) {
    return new Map();
  }

  const requestIds = requests.map((request) => request.id);
  const artifactPaths = unique(
    requests.flatMap((request) =>
      request.artifactSummary.map((artifact) => stripFileFragment(artifact.path)),
    ),
  );
  const deferredArtifactIds = unique(
    requests.flatMap(
      (request) =>
        request.taskHandoffSummary?.deferredArtifacts.map((artifact) => artifact.artifactId) ?? [],
    ),
  );

  const [taskRecords, artifactRecordsByPath, artifactRecordsById] = await Promise.all([
    getTasksByPlanningRequestIds(projectId, requestIds),
    getArtifactsByProjectIdAndFilePaths(projectId, artifactPaths),
    getArtifactsByProjectIdAndIds(projectId, deferredArtifactIds),
  ]);

  const tasksByRequestId = groupTasksByPlanningRequestId(taskRecords);
  const artifactsByPath = new Map(
    artifactRecordsByPath.map((artifact) => [artifact.filePath, artifact] as const),
  );
  const artifactsById = new Map(
    artifactRecordsById.map((artifact) => [artifact.id, artifact] as const),
  );

  return new Map(
    requests.map((request) => {
      const createdTaskMap = new Map(
        request.taskHandoffSummary?.createdTasks.map((task) => [task.taskId, task]) ?? [],
      );
      const derivedTasks = (tasksByRequestId.get(request.id) ?? [])
        .map((task) => mapPlanningDerivedTask(task, createdTaskMap))
        .sort((left, right) => compareDerivedTasks(left, right));
      const enrichedRequest = reconcilePlanningRequestWithTaskTruth(
        request,
        derivedTasks.length,
      );

      const deferredArtifacts = request.taskHandoffSummary?.deferredArtifacts.map((artifact) => {
        const resolvedArtifact = artifactsById.get(artifact.artifactId) ?? null;

        return {
          artifactId: artifact.artifactId,
          artifactName: artifact.artifactName,
          filePath: artifact.filePath,
          storyTitle: artifact.storyTitle,
          deferredBy: artifact.deferredBy,
          sourceArtifactId: resolvedArtifact?.id ?? null,
        };
      }) ?? [];

      const artifacts = request.artifactSummary.map((artifact) => {
        const resolvedArtifact = artifactsByPath.get(stripFileFragment(artifact.path)) ?? null;

        return {
          ...artifact,
          artifactId: resolvedArtifact?.id ?? null,
          artifactName: resolvedArtifact?.name ?? null,
        };
      });

      return [
        request.id,
        {
          request: enrichedRequest,
          problem: resolvePlanningRequestProblemSummary(enrichedRequest),
          artifacts,
          derivedTasks,
          deferredArtifacts,
        },
      ] as const;
    }),
  );
}

async function enrichPlanningRequestsWithTaskTruth(
  projectId: string,
  requests: PlanningRequestListItem[],
): Promise<PlanningRequestListItem[]> {
  const reconcilableRequests = requests.filter(shouldReconcilePlanningTaskTruth);
  if (reconcilableRequests.length === 0) {
    return requests;
  }

  const taskRecords = await getTasksByPlanningRequestIds(
    projectId,
    reconcilableRequests.map((request) => request.id),
  );
  const taskCountByRequestId = buildPlanningTaskCountByRequestId(taskRecords);

  return requests.map((request) =>
    reconcilePlanningRequestWithTaskTruth(
      request,
      taskCountByRequestId.get(request.id) ?? 0,
    ),
  );
}

function shouldReconcilePlanningTaskTruth(
  request: Pick<PlanningRequestListItem, "status" | "taskHandoffSummary">,
) {
  return (
    request.status === "execution-ready"
    || request.status === "completed"
    || request.taskHandoffSummary !== null
  );
}

function reconcilePlanningRequestWithTaskTruth(
  request: PlanningRequestListItem,
  actualTaskCount: number,
): PlanningRequestListItem {
  if (!shouldReconcilePlanningTaskTruth(request)) {
    return request;
  }

  const didDerivedTaskCountChange = request.derivedTaskCount !== actualTaskCount;
  const didHandoffCountChange =
    request.taskHandoffSummary?.createdTaskCount !== undefined
    && request.taskHandoffSummary.createdTaskCount !== actualTaskCount;

  if (!didDerivedTaskCountChange && !didHandoffCountChange) {
    return request;
  }

  const nextTaskHandoffSummary = request.taskHandoffSummary
    ? {
        ...request.taskHandoffSummary,
        createdTaskCount: actualTaskCount,
      }
    : null;

  return {
    ...request,
    derivedTaskCount: actualTaskCount,
    taskHandoffSummary: nextTaskHandoffSummary,
  };
}

function groupTasksByPlanningRequestId(tasks: PlanningRequestTaskRecord[]) {
  const grouped = new Map<string, PlanningRequestTaskRecord[]>();

  for (const task of tasks) {
    if (!task.planningRequestId) {
      continue;
    }

    const current = grouped.get(task.planningRequestId) ?? [];
    current.push(task);
    grouped.set(task.planningRequestId, current);
  }

  return grouped;
}

function buildPlanningTaskCountByRequestId(tasks: PlanningRequestTaskRecord[]) {
  const taskCountByRequestId = new Map<string, number>();

  for (const task of tasks) {
    if (!task.planningRequestId) {
      continue;
    }

    taskCountByRequestId.set(
      task.planningRequestId,
      (taskCountByRequestId.get(task.planningRequestId) ?? 0) + 1,
    );
  }

  return taskCountByRequestId;
}

function mapPlanningDerivedTask(
  task: PlanningRequestTaskRecord,
  createdTaskMap: Map<
    string,
    NonNullable<PlanningRequestListItem["taskHandoffSummary"]>["createdTasks"][number]
  >,
) {
  const handoffTask = createdTaskMap.get(task.id) ?? null;
  const metadata = toRecord(task.metadata);
  const planningHandoff = toRecord(metadata.planningHandoff);
  const readyState = planningHandoffReadyStateSchema.safeParse(
    handoffTask?.readyState ?? planningHandoff.readyState,
  );
  const storyArtifactId = handoffTask?.storyArtifactId ?? task.sourceArtifact?.parent?.id ?? null;
  const storyTitle = handoffTask?.storyTitle ?? task.sourceArtifact?.parent?.name ?? null;
  const sourceArtifactId = task.sourceArtifact?.id ?? handoffTask?.sourceArtifactId ?? null;
  const sourceArtifactName =
    task.sourceArtifact?.name
    ?? handoffTask?.sourceArtifactName
    ?? "来源工件待补齐";
  const sourceArtifactPath =
    task.sourceArtifact?.filePath
    ?? handoffTask?.sourceArtifactPath
    ?? "";

  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    currentStage: task.currentStage,
    nextStep: task.nextStep,
    queuePosition:
      handoffTask?.queuePosition ?? asPositiveInt(planningHandoff.queuePosition),
    readyState: readyState.success ? readyState.data : null,
    sourceArtifactId,
    sourceArtifactName,
    sourceArtifactPath,
    storyArtifactId,
    storyTitle,
    isLegacyPending: task.status === "pending",
    createdAt: task.createdAt.toISOString(),
  };
}

function compareDerivedTasks(
  left: ReturnType<typeof mapPlanningDerivedTask>,
  right: ReturnType<typeof mapPlanningDerivedTask>,
) {
  if (left.queuePosition !== null && right.queuePosition !== null) {
    return left.queuePosition - right.queuePosition;
  }

  if (left.queuePosition !== null) {
    return -1;
  }

  if (right.queuePosition !== null) {
    return 1;
  }

  return right.createdAt.localeCompare(left.createdAt);
}

function stripFileFragment(filePath: string): string {
  return filePath.split("#")[0] ?? filePath;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  }

  return null;
}
