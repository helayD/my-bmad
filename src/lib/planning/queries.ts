import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  parsePlanningArtifactSummary,
  parsePlanningExecutionHandoffDraft,
  parsePlanningExecutionSteps,
  type PlanningRequestListItem,
  type PlanningRequestRoute,
  type PlanningRequestStatus,
  type PlanningSelectionReasonCode,
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
  artifactSummary: true,
  generatedArtifactCount: true,
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

export function mapPlanningRequestListItem(record: PlanningRequestListItemRecord): PlanningRequestListItem {
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
    lastExecutionErrorCode: record.lastExecutionErrorCode,
    generatedArtifactCount: record.generatedArtifactCount ?? 0,
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
    createdAt: record.createdAt.toISOString(),
    createdByUser: {
      id: record.createdByUser.id,
      name: record.createdByUser.name,
      email: record.createdByUser.email,
    },
  };
}

export const getRecentPlanningRequestsByProjectId = cache(
  async (projectId: string, limit = 5): Promise<PlanningRequestListItem[]> => {
    const take = Math.min(Math.max(limit, 1), 10);
    const rows = await prisma.planningRequest.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }],
      take,
      select: planningRequestListItemSelect,
    });

    return rows.map(mapPlanningRequestListItem);
  },
);
