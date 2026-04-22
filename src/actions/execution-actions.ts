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

// ── Supplementary Input ────────────────────────────────────────────────────────

import { prisma } from "@/lib/db/client";
import { transitionTask } from "@/lib/execution/state-machine";
import { sendKeys } from "@/lib/execution/tmux";
import { getScheduler } from "@/lib/execution/heartbeat";

const SubmitSupplementaryInputSchema = z.object({
  taskId: z.string().min(1, "任务 ID 不能为空"),
  agentRunId: z.string().min(1, "Agent Run ID 不能为空"),
  /** 用户输入的补充指令内容 */
  content: z.string()
    .min(1, "指令内容不能为空")
    .max(10_000, "指令内容不能超过 10,000 字符")
    .refine((val) => val.trim().length > 0, {
      message: "指令内容不能为纯空白",
    }),
  /** 指令类型：supplementary（补充指令）、confirmation（确认）、rejection（驳回） */
  inputType: z.enum(["supplementary", "confirmation", "rejection"]).default("supplementary"),
  /** 可选：关联的 InteractionRequest ID */
  interactionRequestId: z.string().optional(),
});

export async function submitSupplementaryInput(
  raw: z.infer<typeof SubmitSupplementaryInputSchema>,
): Promise<ActionResult<{ success: true; delivered: boolean }>> {
  const parsed = SubmitSupplementaryInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: sanitizeError(new Error(parsed.error.message), "VALIDATION_ERROR"),
      code: "VALIDATION_ERROR",
    };
  }

  const { taskId, agentRunId, content, inputType, interactionRequestId } = parsed.data;

  // 权限校验
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: sanitizeError(null, "UNAUTHORIZED"), code: "UNAUTHORIZED" };
  }

  // 1. 查询任务状态
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      currentAgentRunId: true,
      workspaceId: true,
      projectId: true,
    },
  });

  if (!task) {
    return { success: false, error: "任务不存在", code: "TASK_NOT_FOUND" };
  }

  const accessResult = await requireProjectAccess(
    task.workspaceId,
    task.projectId,
    session.userId,
    "execute",
  );
  if (!accessResult.success) {
    return accessResult;
  }

  if (task.currentAgentRunId !== agentRunId) {
    return { success: false, error: "Agent Run 与当前任务不匹配", code: "RUN_MISMATCH" };
  }

  // 2. 状态验证：RUNNING 或 WAITING_FOR_INPUT 才可发送
  const ALLOWED_STATUSES = ["running", "waiting_for_input"];
  if (!ALLOWED_STATUSES.includes(task.status)) {
    return {
      success: false,
      error: `当前任务状态「${task.status}」不支持发送指令`,
      code: "INVALID_TASK_STATUS",
    };
  }

  // 3. 查询 ExecutionSession 获取 sessionName
  const executionSession = await prisma.executionSession.findUnique({
    where: { agentRunId },
    select: { id: true, sessionName: true, status: true },
  });

  if (!executionSession) {
    return { success: false, error: "找不到执行会话记录", code: "SESSION_NOT_FOUND" };
  }

  if (executionSession.status !== "running") {
    return {
      success: false,
      error: "执行会话已结束，无法发送指令",
      code: "SESSION_ENDED",
    };
  }

  // 4. 通过 sendKeys 发送到 tmux
  let delivered = false;
  try {
    await sendKeys({
      sessionName: executionSession.sessionName,
      content,
      addNewline: true,
    });
    delivered = true;
  } catch (error) {
    console.error("[submitSupplementaryInput] sendKeys failed:", error);
    return {
      success: false,
      error: sanitizeError(
        error instanceof Error ? error : new Error(String(error)),
        "TMUX_SEND_FAILED",
      ),
      code: "TMUX_SEND_FAILED",
    };
  }

  // 5. 更新 InteractionRequest 记录（复用现有模型）
  if (interactionRequestId) {
    await prisma.interactionRequest.updateMany({
      where: { id: interactionRequestId, taskId },
      data: {
        status: "responded",
        response: content,
        respondedAt: new Date(),
      },
    }).catch(() => { /* ignore if not found */ });
  }

  // 6. 如果任务处于 WAITING_FOR_INPUT，触发状态变更为 RUNNING
  let taskStatusAfter = task.status;
  if (task.status === "waiting_for_input") {
    const transitionResult = await transitionTask({
      taskId,
      toStatus: "running",
      trigger: "user_response",
      actorType: "user",
      reason: "用户响应了 Agent 请求",
    });

    if (!transitionResult.success) {
      console.warn("[submitSupplementaryInput] 状态变更失败:", transitionResult.error);
    } else {
      taskStatusAfter = "running";
    }

    // 刷新 HeartbeatScheduler 记录
    const scheduler = getScheduler(taskId);
    if (scheduler) {
      scheduler.recordWithSnapshot({
        status: taskStatusAfter,
        currentStage: "运行中",
        currentActivity: "等待 Agent 响应补充指令……",
      });
    }
  }

  // 7. 记录审计事件
  await prisma.auditEvent.create({
    data: {
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId,
      eventName: "supplementary_input.submitted",
      occurredAt: new Date(),
      payload: {
        agentRunId,
        inputType,
        contentLength: content.length,
        interactionRequestId: interactionRequestId ?? null,
        taskStatusBefore: task.status,
        taskStatusAfter,
      },
    },
  });

  return { success: true, data: { success: true, delivered } };
}
