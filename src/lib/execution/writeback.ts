import { Prisma } from "@/generated/prisma/client";
import { buildWritebackAuditEventData, WRITEBACK_AUDIT_EVENT_NAMES } from "@/lib/audit/events";
import { prisma } from "@/lib/db/client";
import { sanitizeError } from "@/lib/errors";
import {
  type ArtifactExecutionSnapshotStatus,
  type TaskArtifactReference,
  type TaskTerminalStateUpdateInput,
  type TaskTerminalStateUpdateResult,
  type TaskWritebackView,
  type WritebackOutcome,
  type WritebackStatus,
} from "@/lib/tasks/types";
import {
  TASK_RESULT_SUMMARY_FALLBACK,
  resolveTaskArtifacts,
  resolveTaskCurrentActivity,
  resolveTaskResultSummary,
} from "@/lib/tasks/tracking";

const TASK_FOR_WRITEBACK_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  sourceArtifactId: true,
  title: true,
  summary: true,
  status: true,
  currentStage: true,
  nextStep: true,
  metadata: true,
  sourceArtifact: {
    select: {
      id: true,
      projectId: true,
    },
  },
} satisfies Prisma.TaskSelect;

const WRITEBACK_VIEW_SELECT = {
  id: true,
  taskId: true,
  artifactId: true,
  outcome: true,
  writebackStatus: true,
  summary: true,
  errorSummary: true,
  occurredAt: true,
  payload: true,
} satisfies Prisma.WritebackSelect;

type TaskForWriteback = Prisma.TaskGetPayload<{ select: typeof TASK_FOR_WRITEBACK_SELECT }>;
type WritebackRecord = Prisma.WritebackGetPayload<{ select: typeof WRITEBACK_VIEW_SELECT }>;

export class WritebackServiceError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "WritebackServiceError";
  }
}

export function buildWritebackIdempotencyKey(taskId: string, outcome: WritebackOutcome): string {
  return `${taskId}:${outcome}`;
}

export function resolveTaskTerminalOutcome(input: {
  status: string;
  metadata: unknown;
}): WritebackOutcome | null {
  if (input.status === "done") {
    return "completed";
  }

  if (input.status !== "blocked") {
    return null;
  }

  return isInterruptedMetadata(input.metadata) ? "interrupted" : "failed";
}

export async function applyTaskTerminalStateWriteback(
  input: TaskTerminalStateUpdateInput,
): Promise<TaskTerminalStateUpdateResult> {
  const task = await prisma.task.findFirst({
    where: {
      id: input.taskId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    },
    select: TASK_FOR_WRITEBACK_SELECT,
  });

  if (!task) {
    throw new WritebackServiceError("TASK_NOT_FOUND");
  }

  const mergedMetadata = mergeTaskMetadata(task.metadata, input);
  const outcome = resolveTaskTerminalOutcome({ status: input.status, metadata: mergedMetadata });
  if (!outcome) {
    throw new WritebackServiceError("WRITEBACK_INVALID_STATE");
  }

  mergedMetadata.terminalOutcome = outcome;
  const occurredAt = resolveOccurredAt(mergedMetadata);
  const idempotencyKey = buildWritebackIdempotencyKey(task.id, outcome);
  const currentActivity = resolveTaskCurrentActivity({
    metadata: mergedMetadata,
    currentStage: input.currentStage,
    nextStep: input.nextStep,
  });

  const existing = await prisma.writeback.findUnique({
    where: { idempotencyKey },
    select: WRITEBACK_VIEW_SELECT,
  });

  if (existing?.writebackStatus === "succeeded") {
    return {
      taskId: task.id,
      artifactId: existing.artifactId,
      status: input.status,
      currentStage: input.currentStage,
      currentActivity,
      nextStep: input.nextStep,
      writeback: mapWritebackRecord(existing),
    };
  }

  if (!task.sourceArtifactId || !task.sourceArtifact) {
    await recordFailedWriteback({
      task,
      input,
      mergedMetadata,
      outcome,
      occurredAt,
      idempotencyKey,
      failureCode: "ARTIFACT_SOURCE_NOT_FOUND",
      artifactId: null,
    });
    throw new WritebackServiceError("ARTIFACT_SOURCE_NOT_FOUND");
  }

  const sourceArtifact = task.sourceArtifact;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: input.status,
          currentStage: input.currentStage,
          nextStep: input.nextStep,
          metadata: mergedMetadata as unknown as Prisma.InputJsonValue,
        },
      });

      const payload = buildWritebackPayload({
        task,
        status: input.status,
        outcome,
        metadata: mergedMetadata,
        currentStage: input.currentStage,
        nextStep: input.nextStep,
      });

      const writeback = await tx.writeback.upsert({
        where: { idempotencyKey },
        create: {
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          artifactId: sourceArtifact.id,
          outcome,
          writebackStatus: "succeeded",
          summary: payload.summary,
          errorSummary: null,
          payload: payload.data as Prisma.InputJsonValue,
          idempotencyKey,
          occurredAt,
        },
        update: {
          outcome,
          writebackStatus: "succeeded",
          summary: payload.summary,
          errorSummary: null,
          payload: payload.data as Prisma.InputJsonValue,
          occurredAt,
        },
        select: WRITEBACK_VIEW_SELECT,
      });

      await tx.bmadArtifact.update({
        where: { id: sourceArtifact.id },
        data: {
          executionStatus: resolveArtifactExecutionStatus(outcome, payload.recoveryHint),
          latestWritebackAt: occurredAt,
          latestWritebackTaskId: task.id,
          latestWritebackOutcome: outcome,
          latestWritebackSummary: payload.summary,
          latestWritebackArtifacts: payload.artifacts as unknown as Prisma.InputJsonValue,
          latestRecoveryHint: payload.recoveryHint,
        },
      });

      await tx.auditEvent.create({
        data: buildWritebackAuditEventData({
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          artifactId: sourceArtifact.id,
          eventName: WRITEBACK_AUDIT_EVENT_NAMES.succeeded,
          occurredAt,
          payload: {
            writebackId: writeback.id,
            taskId: task.id,
            artifactId: sourceArtifact.id,
            outcome,
            writebackStatus: "succeeded",
            summary: payload.summary,
            errorSummary: null,
            recoveryHint: payload.recoveryHint,
            artifacts: payload.artifacts,
          },
        }),
      });

      return {
        artifactId: sourceArtifact.id,
        writeback: mapWritebackRecord(writeback),
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return {
      taskId: task.id,
      artifactId: result.artifactId,
      status: input.status,
      currentStage: input.currentStage,
      currentActivity,
      nextStep: input.nextStep,
      writeback: result.writeback,
    };
  } catch (error) {
    const failureCode = error instanceof WritebackServiceError ? error.code : "WRITEBACK_ERROR";
    const latest = await prisma.writeback.findUnique({
      where: { idempotencyKey },
      select: WRITEBACK_VIEW_SELECT,
    });
    if (latest?.writebackStatus === "succeeded") {
      return {
        taskId: task.id,
        artifactId: latest.artifactId,
        status: input.status,
        currentStage: input.currentStage,
        currentActivity,
        nextStep: input.nextStep,
        writeback: mapWritebackRecord(latest),
      };
    }
    await recordFailedWriteback({
      task,
      input,
      mergedMetadata,
      outcome,
      occurredAt,
      idempotencyKey,
      failureCode,
      artifactId: sourceArtifact.id,
    });
    throw new WritebackServiceError(failureCode);
  }
}

async function recordFailedWriteback(input: {
  task: TaskForWriteback;
  mergedMetadata: Prisma.JsonObject;
  outcome: WritebackOutcome;
  occurredAt: Date;
  idempotencyKey: string;
  failureCode: string;
  artifactId: string | null;
  input: TaskTerminalStateUpdateInput;
}) {
  const errorSummary = sanitizeError(null, input.failureCode);
  const payload = buildWritebackPayload({
    task: input.task,
    status: input.input.status,
    outcome: input.outcome,
    metadata: input.mergedMetadata,
    currentStage: input.input.currentStage,
    nextStep: input.input.nextStep,
  });

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: input.task.id },
      data: {
        status: input.input.status,
        currentStage: input.input.currentStage,
        nextStep: input.input.nextStep,
        metadata: input.mergedMetadata as unknown as Prisma.InputJsonValue,
      },
    });

    let writebackId: string | null = null;
    if (input.artifactId) {
      const existing = await tx.writeback.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, writebackStatus: true },
      });

      if (existing?.writebackStatus !== "succeeded") {
        const writeback = await tx.writeback.upsert({
          where: { idempotencyKey: input.idempotencyKey },
          create: {
            workspaceId: input.task.workspaceId,
            projectId: input.task.projectId,
            taskId: input.task.id,
            artifactId: input.artifactId,
            outcome: input.outcome,
            writebackStatus: "failed",
            summary: payload.summary,
            errorSummary,
            payload: payload.data as Prisma.InputJsonValue,
            idempotencyKey: input.idempotencyKey,
            occurredAt: input.occurredAt,
          },
          update: {
            outcome: input.outcome,
            writebackStatus: "failed",
            summary: payload.summary,
            errorSummary,
            payload: payload.data as Prisma.InputJsonValue,
            occurredAt: input.occurredAt,
          },
          select: { id: true },
        });
        writebackId = writeback.id;
      } else {
        writebackId = existing.id;
      }
    }

    await tx.auditEvent.create({
      data: buildWritebackAuditEventData({
        workspaceId: input.task.workspaceId,
        projectId: input.task.projectId,
        taskId: input.task.id,
        artifactId: input.artifactId,
        eventName: WRITEBACK_AUDIT_EVENT_NAMES.failed,
        occurredAt: input.occurredAt,
        payload: {
          writebackId,
          taskId: input.task.id,
          artifactId: input.artifactId,
          outcome: input.outcome,
          writebackStatus: "failed",
          summary: payload.summary,
          errorSummary,
          recoveryHint: payload.recoveryHint,
          artifacts: payload.artifacts,
        },
      }),
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

function buildWritebackPayload(input: {
  task: TaskForWriteback;
  status: string;
  outcome: WritebackOutcome;
  metadata: unknown;
  currentStage: string;
  nextStep: string;
}): {
  summary: string;
  recoveryHint: string | null;
  artifacts: TaskArtifactReference[];
  data: Prisma.JsonObject;
} {
  const artifacts = resolveTaskArtifacts(input.metadata).map((artifact) => ({
    type: artifact.type,
    filePath: artifact.filePath,
    generatedAt: artifact.generatedAt,
    summary: artifact.summary,
  }));
  const recoveryHint = resolveRecoveryHint(input.outcome, input.metadata, input.nextStep);
  const summary = buildWritebackSummary(input.outcome, input.metadata, input.nextStep);

  return {
    summary,
    recoveryHint,
    artifacts,
    data: {
      sourceTask: {
        id: input.task.id,
        title: input.task.title,
        status: input.status,
        currentStage: input.currentStage,
        nextStep: input.nextStep,
      },
      resultSummary: resolveTaskResultSummary(input.metadata),
      currentActivity: resolveTaskCurrentActivity({
        metadata: input.metadata,
        currentStage: input.currentStage,
        nextStep: input.nextStep,
      }),
      terminalReason: resolveTerminalReason(input.metadata),
      recoveryHint,
      artifacts,
      sourceContext: readRecord(input.metadata).sourceContext ?? null,
    },
  };
}

function buildWritebackSummary(
  outcome: WritebackOutcome,
  metadata: unknown,
  nextStep: string,
): string {
  const summary = resolveTaskResultSummary(metadata);
  const terminalReason = resolveTerminalReason(metadata);

  if (outcome === "completed") {
    return summary;
  }

  if (terminalReason) {
    return outcome === "interrupted"
      ? `执行已中断：${terminalReason}`
      : `执行失败：${terminalReason}`;
  }

  if (summary !== TASK_RESULT_SUMMARY_FALLBACK) {
    return summary;
  }

  return outcome === "interrupted"
    ? `执行已中断，下一步建议：${nextStep}`
    : `执行失败，下一步建议：${nextStep}`;
}

function resolveArtifactExecutionStatus(
  outcome: WritebackOutcome,
  recoveryHint: string | null,
): ArtifactExecutionSnapshotStatus {
  if (outcome === "completed") {
    return "completed";
  }

  if (outcome === "failed") {
    return "failed";
  }

  return recoveryHint?.includes("重试") ? "retry-pending" : "recovery-pending";
}

function resolveRecoveryHint(
  outcome: WritebackOutcome,
  metadata: unknown,
  nextStep: string,
): string | null {
  const metadataRecord = readRecord(metadata);
  const explicitHint = asNonEmptyString(metadataRecord.recoveryHint)
    ?? asNonEmptyString(metadataRecord.recommendedNextStep)
    ?? asNonEmptyString(metadataRecord.nextAction);

  if (explicitHint) {
    return explicitHint;
  }

  if (outcome === "completed") {
    return "可继续进入评审或查看最新工件结果。";
  }

  if (outcome === "interrupted") {
    return nextStep.includes("重试")
      ? nextStep
      : "请恢复执行上下文后继续，或在确认条件满足后重新尝试。";
  }

  return nextStep || "请检查失败原因并修复后重试。";
}

function resolveTerminalReason(metadata: unknown): string | null {
  const record = readRecord(metadata);
  return (
    asNonEmptyString(record.terminalReason)
    ?? asNonEmptyString(record.failureReason)
    ?? asNonEmptyString(record.blockedReason)
    ?? asNonEmptyString(record.interruptionReason)
    ?? null
  );
}

function isInterruptedMetadata(metadata: unknown): boolean {
  const record = readRecord(metadata);
  const terminalReason = asNonEmptyString(record.terminalReason);
  const explicitOutcome = asNonEmptyString(record.terminalOutcome);

  return record.interrupted === true
    || record.isInterrupted === true
    || terminalReason === "interrupted"
    || explicitOutcome === "interrupted";
}

function mergeTaskMetadata(
  currentMetadata: unknown,
  input: TaskTerminalStateUpdateInput,
): Prisma.JsonObject {
  const base = readRecord(currentMetadata);
  const patch = readRecord(input.metadata);
  const merged: Prisma.JsonObject = {
    ...base,
    ...patch,
  };

  if (input.currentActivity?.trim()) {
    merged.currentActivity = input.currentActivity.trim();
  }

  if (input.resultSummary?.trim()) {
    merged.resultSummary = input.resultSummary.trim();
  }

  merged.lastTerminalStatus = input.status;
  merged.lastTerminalAt = new Date().toISOString();
  return merged;
}

function resolveOccurredAt(metadata: Prisma.JsonObject): Date {
  const record = readRecord(metadata);
  const candidate = asNonEmptyString(record.terminalAt)
    ?? asNonEmptyString(record.completedAt)
    ?? asNonEmptyString(record.blockedAt)
    ?? asNonEmptyString(record.updatedAt);

  if (!candidate) {
    return new Date();
  }

  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function mapWritebackRecord(record: WritebackRecord): TaskWritebackView {
  const payload = readRecord(record.payload);
  const artifacts = toArtifactReferences(payload.artifacts);

  return {
    id: record.id,
    taskId: record.taskId,
    artifactId: record.artifactId,
    outcome: record.outcome as WritebackOutcome,
    writebackStatus: record.writebackStatus as WritebackStatus,
    summary: record.summary,
    errorSummary: record.errorSummary,
    occurredAt: record.occurredAt.toISOString(),
    recoveryHint: asNonEmptyString(payload.recoveryHint),
    artifacts,
  };
}

function toArtifactReferences(value: unknown): TaskArtifactReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = readRecord(item);
    const type = asNonEmptyString(record.type);
    const filePath = asNonEmptyString(record.filePath);
    const summary = asNonEmptyString(record.summary);
    const generatedAt = asNullableDateString(record.generatedAt);

    if (!type && !filePath && !summary && !generatedAt) {
      return [];
    }

    return [{
      type: type ?? "产物",
      filePath: filePath ?? "文件路径待记录",
      generatedAt,
      summary: summary ?? "暂无产物说明",
    }];
  });
}

function readRecord(value: unknown): Prisma.JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Prisma.JsonObject;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNullableDateString(value: unknown): string | null {
  const candidate = asNonEmptyString(value);
  if (!candidate) {
    return null;
  }

  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
