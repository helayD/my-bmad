"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession, getWorkspaceById } from "@/lib/db/helpers";
import { sanitizeError } from "@/lib/errors";
import {
  getRecentPlanningRequestsByProjectId,
  mapPlanningRequestListItem,
  planningRequestListItemSelect,
} from "@/lib/planning/queries";
import {
  DEFAULT_PLANNING_REQUEST_LIMIT,
  INITIAL_PLANNING_REQUEST_STATE,
  type PlanningRequestListItem,
  validatePlanningGoal,
} from "@/lib/planning/types";
import type { ActionResult } from "@/lib/types";
import { requireProjectAccess } from "@/lib/workspace/permissions";

const planningRequestInputSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  rawGoal: z.string(),
});

const planningRequestListInputSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  limit: z.number().int().min(1).max(10).optional(),
});

interface PlanningRequestCreatePayload {
  request: PlanningRequestListItem;
}

interface PlanningRequestListPayload {
  requests: PlanningRequestListItem[];
}

export async function createPlanningRequestAction(
  input: { workspaceId: string; projectId: string; rawGoal: string },
): Promise<ActionResult<PlanningRequestCreatePayload>> {
  const parsed = planningRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const accessResult = await requireProjectAccess(
    parsed.data.workspaceId,
    parsed.data.projectId,
    session.userId,
    "execute",
  );
  if (!accessResult.success) {
    return accessResult;
  }

  const goalValidation = validatePlanningGoal(parsed.data.rawGoal);
  if (!goalValidation.valid) {
    return {
      success: false,
      error: sanitizeError(null, goalValidation.code),
      code: goalValidation.code,
    };
  }

  try {
    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (!workspace) {
      return {
        success: false,
        error: sanitizeError(null, "WORKSPACE_ACCESS_DENIED"),
        code: "WORKSPACE_ACCESS_DENIED",
      };
    }

    const createdRequest = await prisma.planningRequest.create({
      data: {
        workspaceId: parsed.data.workspaceId,
        projectId: parsed.data.projectId,
        createdByUserId: session.userId,
        rawGoal: goalValidation.rawGoal,
        status: INITIAL_PLANNING_REQUEST_STATE.status,
        progressPercent: INITIAL_PLANNING_REQUEST_STATE.progressPercent,
        nextStep: INITIAL_PLANNING_REQUEST_STATE.nextStep,
        metadata: {
          source: "manual-goal-input",
        } as Prisma.InputJsonValue,
      },
      select: planningRequestListItemSelect,
    });

    revalidatePath(`/workspace/${workspace.slug}/project/${accessResult.data.project.slug}`);

    return {
      success: true,
      data: {
        request: mapPlanningRequestListItem(createdRequest),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: sanitizeError(error, "PLANNING_REQUEST_CREATE_ERROR"),
      code: "PLANNING_REQUEST_CREATE_ERROR",
    };
  }
}

export async function getPlanningRequestsAction(
  input: { workspaceId: string; projectId: string; limit?: number },
): Promise<ActionResult<PlanningRequestListPayload>> {
  const parsed = planningRequestListInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: sanitizeError(null, "VALIDATION_ERROR"), code: "VALIDATION_ERROR" };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  const accessResult = await requireProjectAccess(
    parsed.data.workspaceId,
    parsed.data.projectId,
    session.userId,
    "read",
  );
  if (!accessResult.success) {
    return accessResult;
  }

  try {
    const requests = await getRecentPlanningRequestsByProjectId(
      parsed.data.projectId,
      parsed.data.limit ?? DEFAULT_PLANNING_REQUEST_LIMIT,
    );

    return {
      success: true,
      data: {
        requests,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: sanitizeError(error, "PLANNING_REQUEST_LIST_ERROR"),
      code: "PLANNING_REQUEST_LIST_ERROR",
    };
  }
}
