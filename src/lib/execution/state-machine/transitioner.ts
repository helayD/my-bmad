import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  TransitionInputSchema,
  type TransitionInput,
  type TransitionResult,
  type TransitionOutcome,
  type TaskStatus,
  type StateTransitionTrigger,
  type TransitionActorType,
} from "./types";
import { isValidTransition, getTransitionError } from "./validator";
import { deriveStageContext } from "./context";
import { recordTaskStateEvent } from "./event-recorder";
import { triggerStateTransitionSideEffects } from "./side-effects";

export async function transitionTask(input: TransitionInput): Promise<TransitionResult> {
  const parsed = TransitionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "输入参数无效",
      code: "TRANSITION_FAILED",
    };
  }

  const { taskId, toStatus, trigger, reason, actorType, actorId } = parsed.data;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      status: true,
      workspaceId: true,
      projectId: true,
      currentAgentRunId: true,
    },
  });

  if (!task) {
    return {
      success: false,
      error: "任务不存在",
      code: "TASK_NOT_FOUND",
    };
  }

  const fromStatus = task.status;

  if (!isValidTransition(fromStatus, toStatus)) {
    const errorMessage = getTransitionError(fromStatus, toStatus);

    recordTaskStateEvent({
      taskId,
      agentRunId: task.currentAgentRunId,
      fromStatus: fromStatus as TaskStatus,
      toStatus: toStatus as TaskStatus,
      trigger: trigger as StateTransitionTrigger,
      reason: errorMessage,
      actorType: actorType as TransitionActorType,
      actorId: actorId ?? null,
      rejected: true,
    }).catch((err) => {
      console.error("[StateMachine] Failed to record rejection event:", err);
    });

    return {
      success: false,
      error: errorMessage,
      code: "INVALID_TRANSITION",
    };
  }

  const stageContext = deriveStageContext(toStatus, trigger);

  const [updatedTask, event] = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        status: toStatus,
        currentStage: stageContext.currentStage,
        currentActivity: stageContext.currentActivity,
        nextStep: stageContext.nextStep,
        updatedAt: new Date(),
      },
    });

    const stateEvent = await tx.taskStateEvent.create({
      data: {
        taskId,
        agentRunId: task.currentAgentRunId ?? null,
        fromStatus,
        toStatus,
        trigger,
        reason: reason ?? null,
        actorType,
        actorId: actorId ?? null,
        rejected: false,
      },
    });

    return [updated, stateEvent];
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  triggerStateTransitionSideEffects({
    taskId,
    agentRunId: task.currentAgentRunId ?? undefined,
    fromStatus: fromStatus as TaskStatus,
    toStatus: toStatus as TaskStatus,
    trigger: trigger as StateTransitionTrigger,
  }).catch((err) => {
    console.error("[StateMachine] Side effect error:", err);
  });

  return {
    success: true,
    data: {
      taskId,
      fromStatus: fromStatus as TaskStatus,
      toStatus: toStatus as TaskStatus,
      eventId: event.id,
    },
  };
}

export function canTransition(fromStatus: string, toStatus: string): TransitionOutcome {
  const allowed = isValidTransition(fromStatus, toStatus);
  return {
    allowed,
    fromStatus: fromStatus as TaskStatus,
    toStatus: toStatus as TaskStatus,
    errorMessage: allowed ? undefined : getTransitionError(fromStatus, toStatus),
  };
}
