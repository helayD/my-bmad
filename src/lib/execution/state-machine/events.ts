import type {
  TaskStatus,
  StateTransitionTrigger,
  TransitionActorType,
} from "./types";

export interface TaskStateTransitionEvent {
  eventId: string;
  eventType: "task.state.transition";
  occurredAt: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  agentRunId?: string;
  executionSessionId?: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  trigger: StateTransitionTrigger;
  reason?: string;
  actorType: TransitionActorType;
  actorId?: string;
}

export function toAuditEventFormat(data: TaskStateTransitionEvent): Record<string, unknown> {
  return {
    eventType: "task.state.transition",
    subjectType: "task",
    subjectId: data.taskId,
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    actorType: data.actorType,
    actorId: data.actorId,
    payload: {
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      trigger: data.trigger,
      reason: data.reason,
      agentRunId: data.agentRunId,
      executionSessionId: data.executionSessionId,
    },
    occurredAt: data.occurredAt,
  };
}
