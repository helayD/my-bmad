import type { Prisma } from "@/generated/prisma/client";
import type { TaskArtifactReference, WritebackOutcome, WritebackStatus } from "@/lib/tasks/types";

export const WRITEBACK_AUDIT_EVENT_NAMES = {
  succeeded: "writeback.succeeded",
  failed: "writeback.failed",
} as const;

export type WritebackAuditEventName =
  (typeof WRITEBACK_AUDIT_EVENT_NAMES)[keyof typeof WRITEBACK_AUDIT_EVENT_NAMES];

export interface WritebackAuditPayload {
  writebackId: string | null;
  taskId: string;
  artifactId: string | null;
  outcome: WritebackOutcome;
  writebackStatus: WritebackStatus;
  summary: string;
  errorSummary: string | null;
  recoveryHint: string | null;
  artifacts: TaskArtifactReference[];
}

function toAuditPayloadJson<T>(payload: T): Prisma.InputJsonValue {
  return payload as unknown as Prisma.InputJsonValue;
}

interface BuildWritebackAuditEventInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  artifactId: string | null;
  eventName: WritebackAuditEventName;
  occurredAt: Date;
  payload: WritebackAuditPayload;
}

export function buildWritebackAuditEventData(
  input: BuildWritebackAuditEventInput,
): Prisma.AuditEventUncheckedCreateInput {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    artifactId: input.artifactId,
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    payload: toAuditPayloadJson(input.payload),
  };
}

export const PLANNING_AUDIT_EVENT_NAMES = {
  intentResolved: "planningRequest.intentResolved",
  executionStarted: "planningRequest.executionStarted",
  stepCompleted: "planningRequest.stepCompleted",
  stepFailed: "planningRequest.stepFailed",
  executionCompleted: "planningRequest.executionCompleted",
} as const;

export type PlanningAuditEventName =
  (typeof PLANNING_AUDIT_EVENT_NAMES)[keyof typeof PLANNING_AUDIT_EVENT_NAMES];

export interface PlanningIntentResolvedAuditPayload {
  planningRequestId: string;
  routeType: string;
  selectedAgentKeys: string[];
  selectedSkillKeys: string[];
  selectionReasonCode: string;
  selectionReasonSummary: string;
  nextStep: string;
}

export interface PlanningExecutionAuditPayload {
  planningRequestId: string;
  stepKey?: string;
  skillKey?: string;
  artifactPaths?: string[];
  generatedArtifactCount?: number;
  outputSummary?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export type PlanningAuditPayload =
  | PlanningIntentResolvedAuditPayload
  | PlanningExecutionAuditPayload;

interface BuildPlanningAuditEventInput {
  workspaceId: string;
  projectId: string;
  planningRequestId: string;
  eventName: PlanningAuditEventName;
  occurredAt: Date;
  payload: PlanningAuditPayload;
}

export function buildPlanningAuditEventData(
  input: BuildPlanningAuditEventInput,
): Prisma.AuditEventUncheckedCreateInput {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    planningRequestId: input.planningRequestId,
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    payload: toAuditPayloadJson(input.payload),
  };
}
