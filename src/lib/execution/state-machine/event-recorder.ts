/**
 * TaskStateEvent recorder.
 *
 * Requires TaskStateEvent model to be added to prisma/schema.prisma first.
 * Run `pnpm prisma migrate dev --name add_task_state_event` after the schema update.
 */
import { prisma } from "@/lib/db/client";
import type {
  TaskStatus,
  StateTransitionTrigger,
  TransitionActorType,
} from "./types";

export interface RecordEventParams {
  taskId: string;
  agentRunId: string | null;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  trigger: StateTransitionTrigger;
  reason: string | null;
  actorType: TransitionActorType;
  actorId: string | null;
  rejected?: boolean;
}

export async function recordTaskStateEvent(
  params: RecordEventParams,
): Promise<{ id: string }> {
  const event = await prisma.taskStateEvent.create({
    data: {
      taskId: params.taskId,
      agentRunId: params.agentRunId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      trigger: params.trigger,
      reason: params.reason,
      actorType: params.actorType,
      actorId: params.actorId,
      rejected: params.rejected ?? false,
    },
  });

  return { id: event.id };
}
