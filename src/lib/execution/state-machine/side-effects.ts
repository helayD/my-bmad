/**
 * Side effects triggered after a state transition.
 * Safe to call without blocking the main transition flow.
 */
import type { TaskStatus, StateTransitionTrigger } from "./types";
import { triggerStateTransitionAudit } from "@/lib/audit/events";

interface SideEffectContext {
  taskId: string;
  agentRunId?: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  trigger: StateTransitionTrigger;
}

export async function triggerStateTransitionSideEffects(
  context: SideEffectContext,
): Promise<void> {
  const { taskId, agentRunId, fromStatus, toStatus, trigger } = context;

  await Promise.all([
    triggerStateTransitionAudit({
      taskId,
      agentRunId,
      fromStatus,
      toStatus,
      trigger,
    }).catch((err) => {
      console.error("[StateMachine] Audit error:", err);
    }),

    triggerPostTransitionAction(context).catch((err) => {
      console.error("[StateMachine] Post-transition action error:", err);
    }),
  ]);
}

async function triggerPostTransitionAction(context: SideEffectContext): Promise<void> {
  const { taskId, toStatus } = context;

  switch (toStatus) {
    case "starting":
      // Handled by launch.ts — no additional action needed here.
      break;

    case "completed":
    case "failed":
    case "terminated":
      // Handled by writeback.ts — transition to writeback_pending is triggered there.
      // Record activity for monitoring.
      console.info(`[StateMachine] Task ${taskId} reached terminal state: ${toStatus}`);
      break;

    case "writeback_done":
      console.info(`[StateMachine] Task ${taskId} writeback complete.`);
      break;
  }
}
