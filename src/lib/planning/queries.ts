import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type { PlanningRequestListItem, PlanningRequestStatus } from "@/lib/planning/types";

export const planningRequestListItemSelect = {
  id: true,
  rawGoal: true,
  status: true,
  progressPercent: true,
  nextStep: true,
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
