"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/db/helpers";
import { sanitizeError } from "@/lib/errors";
import { dispatchTask, DispatchServiceError } from "@/lib/execution/dispatch";
import { redispatchTask, RedispatchServiceError } from "@/lib/execution/redispatch";
import { launchTask, LaunchServiceError } from "@/lib/execution/supervisor/launch";
import { TASK_AGENT_TYPE_VALUES, type TaskAgentType } from "@/lib/tasks";
import type { ActionResult } from "@/lib/types";
import { requireProjectAccess } from "@/lib/workspace/permissions";

const dispatchTaskSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  taskId: z.string().cuid2(),
  agentType: z.enum(TASK_AGENT_TYPE_VALUES).optional(),
});

const redispatchTaskSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  taskId: z.string().cuid2(),
  targetAgentType: z.enum(TASK_AGENT_TYPE_VALUES),
  expectedAgentRunId: z.string().cuid2(),
  reasonSummary: z.string().trim().min(1).max(240),
  confirmRunningRedispatch: z.boolean(),
});

export interface DispatchTaskActionPayload {
  taskId: string;
  status: string;
  currentStage: string;
  currentActivity: string;
  nextStep: string;
  currentAgentRunId: string | null;
  selectedAgentType: TaskAgentType | null;
  selectedAgentLabel: string | null;
  selectionReasonSummary: string | null;
  didDispatch: boolean;
  selectionRequired: boolean;
  recommendedAgentType: TaskAgentType | null;
  recommendedAgentLabel: string | null;
}

export interface RedispatchTaskActionPayload extends DispatchTaskActionPayload {
  replacedAgentRunId: string;
  didTerminateActiveSession: boolean;
}

export async function dispatchTaskAction(
  input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    agentType?: string;
  },
): Promise<ActionResult<DispatchTaskActionPayload>> {
  const parsed = dispatchTaskSchema.safeParse(input);
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

  try {
    const result = await dispatchTask({
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId,
      taskId: parsed.data.taskId,
      actorUserId: session.userId,
      agentType: parsed.data.agentType,
    });

    if (result.selectionRequired) {
      return {
        success: true,
        data: {
          taskId: result.taskId,
          status: result.status,
          currentStage: result.currentStage,
          currentActivity: result.currentActivity,
          nextStep: result.nextStep,
          currentAgentRunId: null,
          selectedAgentType: null,
          selectedAgentLabel: null,
          selectionReasonSummary: result.selectionRequirement?.selectionReasonSummary ?? null,
          didDispatch: false,
          selectionRequired: true,
          recommendedAgentType: result.selectionRequirement?.recommendedAgentType ?? null,
          recommendedAgentLabel: result.selectionRequirement?.recommendedAgentLabel ?? null,
        },
      };
    }

    revalidateExecutionPaths(result.workspaceSlug, result.projectSlug, result.taskId);

    return {
      success: true,
      data: {
        taskId: result.taskId,
        status: result.status,
        currentStage: result.currentStage,
        currentActivity: result.currentActivity,
        nextStep: result.nextStep,
        currentAgentRunId: result.currentAgentRun?.id ?? null,
        selectedAgentType: result.currentAgentRun?.agentType ?? null,
        selectedAgentLabel: result.currentAgentRun?.agentTypeLabel ?? null,
        selectionReasonSummary: result.routingDecision?.selectionReasonSummary ?? null,
        didDispatch: result.didDispatch,
        selectionRequired: false,
        recommendedAgentType: null,
        recommendedAgentLabel: null,
      },
    };
  } catch (error) {
    if (error instanceof DispatchServiceError) {
      return { success: false, error: sanitizeError(null, error.code), code: error.code };
    }

    return { success: false, error: sanitizeError(error, "TASK_DISPATCH_ERROR"), code: "TASK_DISPATCH_ERROR" };
  }
}

export async function redispatchTaskAction(
  input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    targetAgentType: string;
    expectedAgentRunId: string;
    reasonSummary: string;
    confirmRunningRedispatch: boolean;
  },
): Promise<ActionResult<RedispatchTaskActionPayload>> {
  const parsed = redispatchTaskSchema.safeParse(input);
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

  try {
    const result = await redispatchTask({
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId,
      taskId: parsed.data.taskId,
      actorUserId: session.userId,
      targetAgentType: parsed.data.targetAgentType,
      expectedAgentRunId: parsed.data.expectedAgentRunId,
      reasonSummary: parsed.data.reasonSummary,
      confirmRunningRedispatch: parsed.data.confirmRunningRedispatch,
    });

    revalidateExecutionPaths(result.workspaceSlug, result.projectSlug, result.taskId);

    return {
      success: true,
      data: {
        taskId: result.taskId,
        status: result.status,
        currentStage: result.currentStage,
        currentActivity: result.currentActivity,
        nextStep: result.nextStep,
        currentAgentRunId: result.currentAgentRun.id,
        selectedAgentType: result.currentAgentRun.agentType,
        selectedAgentLabel: result.currentAgentRun.agentTypeLabel,
        selectionReasonSummary: result.routingDecision.selectionReasonSummary,
        didDispatch: true,
        selectionRequired: false,
        recommendedAgentType: null,
        recommendedAgentLabel: null,
        replacedAgentRunId: result.replacedAgentRunId,
        didTerminateActiveSession: result.didTerminateActiveSession,
      },
    };
  } catch (error) {
    if (error instanceof RedispatchServiceError) {
      return { success: false, error: sanitizeError(null, error.code), code: error.code };
    }

    return { success: false, error: sanitizeError(error, "TASK_REDISPATCH_ERROR"), code: "TASK_REDISPATCH_ERROR" };
  }
}

const startExecutionSchema = z.object({
  workspaceId: z.string().cuid2(),
  projectId: z.string().cuid2(),
  taskId: z.string().cuid2(),
  agentRunId: z.string().cuid2(),
});

export interface StartExecutionActionPayload {
  executionSessionId: string;
  taskId: string;
  agentRunId: string;
  sessionName: string;
  processPid: number | null;
  transport: string;
}

export async function startExecutionAction(
  input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    agentRunId: string;
  },
): Promise<ActionResult<StartExecutionActionPayload>> {
  const parsed = startExecutionSchema.safeParse(input);
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

  try {
    const result = await launchTask({
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId,
      taskId: parsed.data.taskId,
      agentRunId: parsed.data.agentRunId,
    });

    revalidatePath(`/workspace/${parsed.data.workspaceId}/project/${parsed.data.projectId}/tasks/${parsed.data.taskId}`);

    return {
      success: true,
      data: {
        executionSessionId: result.executionSessionId,
        taskId: result.taskId,
        agentRunId: result.agentRunId,
        sessionName: result.sessionName,
        processPid: result.processPid,
        transport: result.transport,
      },
    };
  } catch (error) {
    if (error instanceof LaunchServiceError) {
      return { success: false, error: sanitizeError(null, error.code), code: error.code };
    }

    return { success: false, error: sanitizeError(error, "EXECUTION_START_ERROR"), code: "EXECUTION_START_ERROR" };
  }
}

function revalidateExecutionPaths(
  workspaceSlug: string,
  projectSlug: string,
  taskId: string,
) {
  revalidatePath(`/workspace/${workspaceSlug}`);
  revalidatePath(`/workspace/${workspaceSlug}/project/${projectSlug}`);
  revalidatePath(`/workspace/${workspaceSlug}/project/${projectSlug}/tasks/${taskId}`);
}
