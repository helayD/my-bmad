import type { Prisma } from "@/generated/prisma/client";
import type { TaskArtifactReference, WritebackOutcome, WritebackStatus } from "@/lib/tasks/types";
import type {
  PlanningHandoffDispatchMode,
  PlanningHandoffReadyState,
} from "@/lib/planning/types";

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
  confirmed: "planningRequest.confirmed",
  executionTasksCreated: "planningRequest.executionTasksCreated",
  executionTasksDeferred: "planningRequest.executionTasksDeferred",
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

export interface PlanningHandoffQueueAuditItem {
  taskId: string;
  sourceArtifactId: string;
  queuePosition: number;
  priority: string;
  readyState: PlanningHandoffReadyState;
}

export interface PlanningRequestHandoffAuditPayload {
  planningRequestId: string;
  confirmedArtifactIds: string[];
  deferredArtifactIds: string[];
  dispatchMode: PlanningHandoffDispatchMode;
  approvalRequired: boolean;
  createdTaskIds: string[];
  dispatchQueue: PlanningHandoffQueueAuditItem[];
}

export type PlanningAuditPayload =
  | PlanningIntentResolvedAuditPayload
  | PlanningExecutionAuditPayload
  | PlanningRequestHandoffAuditPayload;

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

export const TASK_AUDIT_EVENT_NAMES = {
  created: "task.created",
  routed: "task.routed",
  redispatched: "task.redispatched",
  agentRunSuperseded: "agentRun.superseded",
} as const;

export type TaskAuditEventName =
  (typeof TASK_AUDIT_EVENT_NAMES)[keyof typeof TASK_AUDIT_EVENT_NAMES];

export interface TaskRoutedAuditPayload {
  taskId: string;
  previousStatus: string;
  nextStatus: string;
  agentRunId: string;
  selectedAgentType: string;
  decisionSource: string;
  selectionReasonCode: string;
  selectionReasonSummary: string;
  matchedSignals: string[];
  requestedByUserId: string;
}

export interface TaskCreatedAuditPayload {
  taskId: string;
  workspaceId: string;
  projectId: string;
  sourceArtifactId: string | null;
  priority: string;
  intent: string;
  intentDetail: string | null;
  preferredAgentType: string | null;
  createdByUserId: string;
}

export interface TaskRedispatchedAuditPayload extends TaskRoutedAuditPayload {
  replacedAgentRunId: string;
  reasonSummary: string;
  terminatedActiveSession: boolean;
}

export interface AgentRunSupersededAuditPayload {
  taskId: string;
  previousAgentRunId: string;
  replacementAgentRunId: string;
  previousAgentType: string;
  replacementAgentType: string;
  reasonSummary: string;
  terminationReasonCode: string | null;
  terminationReasonSummary: string | null;
  terminatedActiveSession: boolean;
  requestedByUserId: string;
}

export type TaskAuditPayload =
  | TaskCreatedAuditPayload
  | TaskRoutedAuditPayload
  | TaskRedispatchedAuditPayload
  | AgentRunSupersededAuditPayload;

interface BuildTaskAuditEventInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  artifactId?: string | null;
  eventName: TaskAuditEventName;
  occurredAt: Date;
  payload: TaskAuditPayload;
}

export function buildTaskAuditEventData(
  input: BuildTaskAuditEventInput,
): Prisma.AuditEventUncheckedCreateInput {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    artifactId: input.artifactId ?? null,
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    payload: toAuditPayloadJson(input.payload),
  };
}

export const EXECUTION_SESSION_AUDIT_EVENT_NAMES = {
  started: "executionSession.started",
  startFailed: "executionSession.startFailed",
  completed: "executionSession.completed",
  terminated: "executionSession.terminated",
} as const;

export type ExecutionSessionAuditEventName =
  (typeof EXECUTION_SESSION_AUDIT_EVENT_NAMES)[keyof typeof EXECUTION_SESSION_AUDIT_EVENT_NAMES];

export interface ExecutionSessionStartedAuditPayload {
  executionSessionId: string;
  taskId: string;
  agentRunId: string;
  sessionName: string;
  processPid: number | null;
  transport: string;
  projectRoot: string | null;
}

export interface ExecutionSessionStartFailedAuditPayload {
  executionSessionId: string | null;
  taskId: string;
  agentRunId: string;
  errorCode: string;
  errorSummary: string;
  attemptedSessionName: string | null;
}

export interface ExecutionSessionCompletedAuditPayload {
  executionSessionId: string;
  taskId: string;
  agentRunId: string;
  sessionName: string;
  terminationReasonCode: null;
  terminationReasonSummary: null;
}

export interface ExecutionSessionTerminatedAuditPayload {
  executionSessionId: string;
  taskId: string;
  agentRunId: string;
  sessionName: string;
  terminationReasonCode: string;
  terminationReasonSummary: string;
}

export type ExecutionSessionAuditPayload =
  | ExecutionSessionStartedAuditPayload
  | ExecutionSessionStartFailedAuditPayload
  | ExecutionSessionCompletedAuditPayload
  | ExecutionSessionTerminatedAuditPayload;

export function buildExecutionSessionAuditEventData(
  input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    artifactId?: string | null;
    eventName: ExecutionSessionAuditEventName;
    occurredAt: Date;
    payload: ExecutionSessionAuditPayload;
  },
): Prisma.AuditEventUncheckedCreateInput {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    artifactId: input.artifactId ?? null,
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    payload: toAuditPayloadJson(input.payload),
  };
}

// ── Execution Queue ─────────────────────────────────────────────────────────────

export const EXECUTION_QUEUE_AUDIT_EVENT_NAMES = {
  enqueued: "executionQueue.enqueued",
  dequeued: "executionQueue.dequeued",
  estimateRefreshed: "executionQueue.estimateRefreshed",
  sessionFailed: "executionSession.failed",
} as const;

export type ExecutionQueueAuditEventName =
  (typeof EXECUTION_QUEUE_AUDIT_EVENT_NAMES)[keyof typeof EXECUTION_QUEUE_AUDIT_EVENT_NAMES];

export interface ExecutionQueueEnqueuedAuditPayload {
  taskId: string;
  queuePosition: number;
  workspaceActiveConcurrentTasks: number;
  projectActiveConcurrentTasks: number;
  maxConcurrentTasks: number;
  queueReasonCode: string;
  estimatedWaitSeconds: number | null;
}

export interface ExecutionQueueDequeuedAuditPayload {
  taskId: string;
  executionSessionId: string;
  queuePosition: number | null;
  workspaceActiveConcurrentTasks: number;
  projectActiveConcurrentTasks: number;
  maxConcurrentTasks: number;
  queueReasonCode: string | null;
  estimatedWaitSeconds: number | null;
}

export interface ExecutionQueueEstimateRefreshedPayload {
  taskId: string;
  previousQueuePosition: number;
  newQueuePosition: number;
  estimatedWaitSeconds: number | null;
}

export interface ExecutionSessionFailedAuditPayload {
  executionSessionId: string;
  taskId: string;
  agentRunId: string;
  sessionName: string;
  terminationReasonCode: string;
  terminationReasonSummary: string;
  lastActivityAt: string | null;
  lastActivitySummary: string | null;
  contextSnapshotRef: string | null;
}

export type ExecutionQueueAuditPayload =
  | ExecutionQueueEnqueuedAuditPayload
  | ExecutionQueueDequeuedAuditPayload
  | ExecutionQueueEstimateRefreshedPayload
  | ExecutionSessionFailedAuditPayload;

export function buildExecutionQueueAuditEventData(
  input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    artifactId?: string | null;
    eventName: ExecutionQueueAuditEventName;
    occurredAt: Date;
    payload: ExecutionQueueAuditPayload;
  },
): Prisma.AuditEventUncheckedCreateInput {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    artifactId: input.artifactId ?? null,
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    payload: toAuditPayloadJson(input.payload),
  };
}

// ── Execution Boundary ─────────────────────────────────────────────────────────────────

export const EXECUTION_BOUNDARY_AUDIT_EVENT_NAMES = {
  prepared: "executionContext.prepared",
  preparationFailed: "executionContext.preparationFailed",
  violationDetected: "executionBoundary.violationDetected",
  sensitivePathBlocked: "executionBoundary.sensitivePathBlocked",
  scopeRejected: "executionBoundary.scopeRejected",
} as const;

export type ExecutionBoundaryAuditEventName =
  (typeof EXECUTION_BOUNDARY_AUDIT_EVENT_NAMES)[keyof typeof EXECUTION_BOUNDARY_AUDIT_EVENT_NAMES];

export interface ExecutionContextPreparedAuditPayload {
  executionSessionId: string;
  taskId: string;
  agentRunId: string;
  projectRoot: string;
  canonicalProjectRoot: string;
  injectedFileCount: number;
  injectedFilePaths: string[];
  sensitivePathCount: number;
  sensitivePathSamples: string[];
  skippedOversizedCount: number;
  contextFileCountLimit: number;
  contextMaxDepth: number;
  contextMaxFileSizeBytes: number;
  preparationSucceeded: boolean;
  boundaryCurrentStage: string;
}

export interface ExecutionBoundaryViolationAuditPayload {
  executionSessionId: string | null;
  taskId: string;
  agentRunId: string;
  projectRoot: string;
  requestedPath: string;
  resolvedPath: string;
  violationCode: string;
  violationSummary: string;
  isFatal: boolean;
}

export type ExecutionBoundaryAuditPayload =
  | ExecutionContextPreparedAuditPayload
  | ExecutionBoundaryViolationAuditPayload;

export function buildExecutionBoundaryAuditEventData(
  input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    artifactId?: string | null;
    eventName: ExecutionBoundaryAuditEventName;
    occurredAt: Date;
    payload: ExecutionBoundaryAuditPayload;
  },
): Prisma.AuditEventUncheckedCreateInput {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    artifactId: input.artifactId ?? null,
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    payload: toAuditPayloadJson(input.payload),
  };
}
