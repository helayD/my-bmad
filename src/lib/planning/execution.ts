import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { sanitizeError } from "@/lib/errors";
import {
  createProjectContentProvider,
  type ProjectRepoProviderConfig,
} from "@/lib/content-provider/project-provider";
import { scanProjectArtifacts } from "@/lib/artifacts/scanner";
import { syncArtifacts } from "@/lib/artifacts/sync";
import {
  buildPlanningAuditEventData,
  PLANNING_AUDIT_EVENT_NAMES,
} from "@/lib/audit/events";
import {
  createPlanningArtifactWriter,
  type PlanningArtifactWriteResult,
  PlanningArtifactWriteError,
} from "@/lib/planning/artifact-writer";
import {
  getPlanningSkillExecutionConfig,
  SUPPORTED_PLANNING_EXECUTION_SKILL_KEYS,
  type PlanningSkillCatalogKey,
} from "@/lib/planning/catalog";
import { executePlanningSkill } from "@/lib/planning/skill-executors";
import {
  DEFAULT_PLANNING_CONFIRMATION_NEXT_STEP,
  DEFAULT_PLANNING_EXECUTION_NEXT_STEP,
  getPlanningExecutionProgress,
  parsePlanningArtifactSummary,
  type PlanningArtifactSummaryItem,
  type PlanningExecutionStepStatus,
} from "@/lib/planning/types";

type PlanningExecutionStepRecord = Prisma.PlanningExecutionStepGetPayload<{
  select: {
    id: true;
    stepKey: true;
    skillKey: true;
    sequence: true;
    status: true;
    title: true;
    retryCount: true;
    details: true;
  };
}>;

export interface ExecutePlanningRequestInput {
  workspaceId: string;
  projectId: string;
  planningRequestId: string;
  projectName: string;
  userId: string;
  rawGoal: string;
  selectedSkillKeys: string[];
  repo: ProjectRepoProviderConfig;
  executionStartedAt: Date | null;
  artifactSummary: unknown;
}

export interface ExecutePlanningRequestResult {
  didExecute: boolean;
}

export async function executePlanningRequest(
  input: ExecutePlanningRequestInput,
): Promise<ExecutePlanningRequestResult> {
  const executionPlan = buildExecutionPlan(input.selectedSkillKeys);
  await ensureExecutionSteps(input.planningRequestId, executionPlan);

  const currentSteps = await loadPlanningExecutionSteps(input.planningRequestId);
  if (currentSteps.some((step) => step.status === "running")) {
    return { didExecute: false };
  }

  const startIndex = resolveStartIndex(currentSteps);
  if (startIndex === -1) {
    await finalizePlanningExecution(input, parsePlanningArtifactSummary(input.artifactSummary));
    return { didExecute: false };
  }

  let aggregatedArtifactSummary = mergeArtifactSummary(
    parsePlanningArtifactSummary(input.artifactSummary),
    collectCompletedArtifactSummary(currentSteps),
  );
  let writer: Awaited<ReturnType<typeof createPlanningArtifactWriter>> | null = null;
  let provider: Awaited<ReturnType<typeof createProjectContentProvider>> | null = null;
  let didExecute = false;

  for (let index = startIndex; index < executionPlan.length; index += 1) {
    const step = executionPlan[index];
    const existingStep = currentSteps.find((candidate) => candidate.stepKey === step.stepKey);
    const startedAt = new Date();

    const claimed = await markStepRunning({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      planningRequestId: input.planningRequestId,
      stepKey: step.stepKey,
      skillKey: step.skillKey,
      now: startedAt,
      retryCount: existingStep?.status === "failed"
        ? (existingStep.retryCount ?? 0) + 1
        : (existingStep?.retryCount ?? 0),
      progressPercent: getPlanningExecutionProgress(
        currentSteps.map<{ status: PlanningExecutionStepStatus }>((candidate) => ({
          status: candidate.stepKey === step.stepKey
            ? "running"
            : (candidate.status as PlanningExecutionStepStatus),
        })),
      ),
      shouldMarkExecutionStarted: input.executionStartedAt === null && index === startIndex,
    });
    if (!claimed) {
      return { didExecute };
    }

    didExecute = true;
    if (existingStep) {
      const wasFailed = existingStep.status === "failed";
      existingStep.status = "running";
      existingStep.retryCount = wasFailed
        ? (existingStep.retryCount ?? 0) + 1
        : existingStep.retryCount;
    }

    try {
      writer ??= await createPlanningArtifactWriter(input.repo, input.userId);
      provider ??= await createProjectContentProvider(input.repo, input.userId);
      const providerTree = await provider.getTree();
      const result = await executePlanningSkill({
        planningRequestId: input.planningRequestId,
        projectName: input.projectName,
        rawGoal: input.rawGoal,
        skillKey: step.skillKey,
        writer,
        existingPaths: providerTree.paths,
      });

      revalidateWriterTags(result.writeResults);

      const scanResult = await scanProjectArtifacts(provider);
      const syncReport = await syncArtifacts(input.projectId, scanResult);
      const finishedAt = new Date();

      aggregatedArtifactSummary = mergeArtifactSummary(
        aggregatedArtifactSummary,
        result.artifactSummary,
      );

      await markStepCompleted({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        planningRequestId: input.planningRequestId,
        stepKey: step.stepKey,
        skillKey: step.skillKey,
        now: finishedAt,
        outputSummary: buildStepOutputSummary(result.outputSummary, result.errors),
        artifactPaths: result.writeResults.map((write) => write.path),
        details: {
          artifactSummary: result.artifactSummary,
          conflicts: result.errors,
          syncReport,
        },
        progressPercent:
          index === executionPlan.length - 1
            ? 90
            : getPlanningExecutionProgress(
                executionPlan.map<{ status: PlanningExecutionStepStatus }>((_, planIndex) => ({
                  status:
                    planIndex <= index
                      ? "completed"
                      : "pending",
                })),
              ),
        artifactSummary: aggregatedArtifactSummary,
      });
      if (existingStep) {
        existingStep.status = "completed";
      }
    } catch (error) {
      const failedAt = new Date();
      const normalizedError = normalizePlanningExecutionError(error);

      await markStepFailed({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        planningRequestId: input.planningRequestId,
        stepKey: step.stepKey,
        skillKey: step.skillKey,
        now: failedAt,
        errorCode: normalizedError.code,
        errorMessage: normalizedError.message,
        progressPercent: getPlanningExecutionProgress(
          executionPlan.map<{ status: PlanningExecutionStepStatus }>((planStep, planIndex) => {
            if (planIndex < index) {
              return { status: "completed" };
            }

            if (planStep.stepKey === step.stepKey) {
              return { status: "failed" };
            }

            return { status: "pending" };
          }),
        ),
        artifactSummary: aggregatedArtifactSummary,
      });
      if (existingStep) {
        existingStep.status = "failed";
      }

      throw new PlanningArtifactWriteError(normalizedError.code, normalizedError.message);
    }
  }

  await finalizePlanningExecution(input, aggregatedArtifactSummary);
  return { didExecute };
}

function buildExecutionPlan(
  selectedSkillKeys: string[],
): Array<{ skillKey: PlanningSkillCatalogKey; stepKey: string; title: string; sequence: number }> {
  return selectedSkillKeys.map((skillKey, index) => {
    if (!SUPPORTED_PLANNING_EXECUTION_SKILL_KEYS.includes(skillKey as PlanningSkillCatalogKey)) {
      throw new PlanningArtifactWriteError("PLANNING_SKILL_UNSUPPORTED");
    }

    const config = getPlanningSkillExecutionConfig(skillKey);
    if (!config) {
      throw new PlanningArtifactWriteError("PLANNING_SKILL_UNSUPPORTED");
    }

    return {
      skillKey: skillKey as PlanningSkillCatalogKey,
      stepKey: config.stepKey,
      title: config.title,
      sequence: index + 1,
    };
  });
}

async function ensureExecutionSteps(
  planningRequestId: string,
  executionPlan: Array<{ skillKey: string; stepKey: string; title: string; sequence: number }>,
): Promise<void> {
  const existingSteps = await prisma.planningExecutionStep.findMany({
    where: { planningRequestId },
    select: { stepKey: true },
  });

  const existingStepKeys = new Set(existingSteps.map((step) => step.stepKey));
  const missingSteps = executionPlan.filter((step) => !existingStepKeys.has(step.stepKey));

  if (missingSteps.length === 0) {
    return;
  }

  await prisma.planningExecutionStep.createMany({
    skipDuplicates: true,
    data: missingSteps.map((step) => ({
      planningRequestId,
      skillKey: step.skillKey,
      stepKey: step.stepKey,
      sequence: step.sequence,
      status: "pending",
      title: step.title,
    })),
  });
}

async function loadPlanningExecutionSteps(
  planningRequestId: string,
): Promise<PlanningExecutionStepRecord[]> {
  return prisma.planningExecutionStep.findMany({
    where: { planningRequestId },
    orderBy: [{ sequence: "asc" }],
    select: {
      id: true,
      stepKey: true,
      skillKey: true,
      sequence: true,
      status: true,
      title: true,
      retryCount: true,
      details: true,
    },
  });
}

function resolveStartIndex(steps: PlanningExecutionStepRecord[]): number {
  const failedStepIndex = steps.findIndex((step) => step.status === "failed");
  if (failedStepIndex >= 0) {
    return failedStepIndex;
  }

  return steps.findIndex((step) => step.status !== "completed");
}

function collectCompletedArtifactSummary(
  steps: PlanningExecutionStepRecord[],
): PlanningArtifactSummaryItem[] {
  return steps.flatMap((step) => {
    if (step.status !== "completed") {
      return [];
    }

    const value = (step.details as Record<string, unknown> | null)?.artifactSummary;
    return parsePlanningArtifactSummary(value);
  });
}

function mergeArtifactSummary(
  current: PlanningArtifactSummaryItem[],
  nextItems: PlanningArtifactSummaryItem[],
): PlanningArtifactSummaryItem[] {
  const merged = new Map<string, PlanningArtifactSummaryItem>();

  for (const item of [...current, ...nextItems]) {
    merged.set(item.path, item);
  }

  return [...merged.values()];
}

function countGeneratedArtifacts(items: PlanningArtifactSummaryItem[]): number {
  return items.filter((item) => item.status === "created" || item.status === "updated").length;
}

function buildStepOutputSummary(baseSummary: string, conflicts: string[]): string {
  if (conflicts.length === 0) {
    return baseSummary;
  }

  return `${baseSummary} 已记录 ${conflicts.length} 个需人工确认的故事投影冲突。`;
}

function revalidateWriterTags(writeResults: PlanningArtifactWriteResult[]): void {
  const uniqueTags = new Set(writeResults.flatMap((write) => write.cacheTags));
  for (const tag of uniqueTags) {
    revalidateTag(tag, "default");
  }
}

async function markStepRunning(input: {
  workspaceId: string;
  projectId: string;
  planningRequestId: string;
  stepKey: string;
  skillKey: string;
  now: Date;
  retryCount: number;
  progressPercent: number;
  shouldMarkExecutionStarted: boolean;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimedStep = await tx.planningExecutionStep.updateMany({
      where: {
        planningRequestId: input.planningRequestId,
        stepKey: input.stepKey,
        status: {
          in: ["pending", "failed"],
        },
      },
      data: {
        status: "running",
        startedAt: input.now,
        completedAt: null,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        outputSummary: null,
        artifactPaths: [],
        retryCount: input.retryCount,
        details: Prisma.JsonNull,
      },
    });

    if (claimedStep.count === 0) {
      return false;
    }

    await tx.planningRequest.update({
      where: { id: input.planningRequestId },
      data: {
        status: "planning",
        progressPercent: input.progressPercent,
        nextStep: "正在按规划链路生成 BMAD 工件。",
        executionStartedAt: input.shouldMarkExecutionStarted ? input.now : undefined,
        executionCompletedAt: null,
        executionFailedAt: null,
        lastExecutionErrorCode: null,
      },
    });

    if (input.shouldMarkExecutionStarted) {
      await tx.auditEvent.create({
        data: buildPlanningAuditEventData({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          planningRequestId: input.planningRequestId,
          eventName: PLANNING_AUDIT_EVENT_NAMES.executionStarted,
          occurredAt: input.now,
          payload: {
            planningRequestId: input.planningRequestId,
            stepKey: input.stepKey,
            skillKey: input.skillKey,
          },
        }),
      });
    }

    return true;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

async function markStepCompleted(input: {
  workspaceId: string;
  projectId: string;
  planningRequestId: string;
  stepKey: string;
  skillKey: string;
  now: Date;
  outputSummary: string;
  artifactPaths: string[];
  details: Record<string, unknown>;
  progressPercent: number;
  artifactSummary: PlanningArtifactSummaryItem[];
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.planningExecutionStep.update({
      where: {
        planningRequestId_stepKey: {
          planningRequestId: input.planningRequestId,
          stepKey: input.stepKey,
        },
      },
      data: {
        status: "completed",
        completedAt: input.now,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        outputSummary: input.outputSummary,
        artifactPaths: input.artifactPaths,
        details: input.details as Prisma.InputJsonValue,
      },
    });

    await tx.planningRequest.update({
      where: { id: input.planningRequestId },
      data: {
        status: "planning",
        progressPercent: input.progressPercent,
        nextStep: DEFAULT_PLANNING_EXECUTION_NEXT_STEP,
        artifactSummary: input.artifactSummary as Prisma.InputJsonValue,
        generatedArtifactCount: countGeneratedArtifacts(input.artifactSummary),
        lastExecutionErrorCode: null,
      },
    });

    await tx.auditEvent.create({
      data: buildPlanningAuditEventData({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        planningRequestId: input.planningRequestId,
        eventName: PLANNING_AUDIT_EVENT_NAMES.stepCompleted,
        occurredAt: input.now,
        payload: {
          planningRequestId: input.planningRequestId,
          stepKey: input.stepKey,
          skillKey: input.skillKey,
          artifactPaths: input.artifactPaths,
          outputSummary: input.outputSummary,
        },
      }),
    });
  });
}

async function markStepFailed(input: {
  workspaceId: string;
  projectId: string;
  planningRequestId: string;
  stepKey: string;
  skillKey: string;
  now: Date;
  errorCode: string;
  errorMessage: string;
  progressPercent: number;
  artifactSummary: PlanningArtifactSummaryItem[];
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.planningExecutionStep.update({
      where: {
        planningRequestId_stepKey: {
          planningRequestId: input.planningRequestId,
          stepKey: input.stepKey,
        },
      },
      data: {
        status: "failed",
        failedAt: input.now,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });

    await tx.planningRequest.update({
      where: { id: input.planningRequestId },
      data: {
        status: "failed",
        progressPercent: input.progressPercent,
        nextStep: "规划执行在某一步失败。你可以重试失败步骤，或调整目标后重新规划。",
        executionFailedAt: input.now,
        lastExecutionErrorCode: input.errorCode,
        artifactSummary: input.artifactSummary as Prisma.InputJsonValue,
        generatedArtifactCount: countGeneratedArtifacts(input.artifactSummary),
      },
    });

    await tx.auditEvent.create({
      data: buildPlanningAuditEventData({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        planningRequestId: input.planningRequestId,
        eventName: PLANNING_AUDIT_EVENT_NAMES.stepFailed,
        occurredAt: input.now,
        payload: {
          planningRequestId: input.planningRequestId,
          stepKey: input.stepKey,
          skillKey: input.skillKey,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          artifactPaths: input.artifactSummary.map((item) => item.path),
        },
      }),
    });
  });
}

async function finalizePlanningExecution(
  input: ExecutePlanningRequestInput,
  artifactSummary: PlanningArtifactSummaryItem[],
): Promise<void> {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.planningRequest.update({
      where: { id: input.planningRequestId },
      data: {
        status: "awaiting-confirmation",
        progressPercent: 90,
        nextStep: DEFAULT_PLANNING_CONFIRMATION_NEXT_STEP,
        executionCompletedAt: now,
        executionFailedAt: null,
        artifactSummary: artifactSummary as Prisma.InputJsonValue,
        generatedArtifactCount: countGeneratedArtifacts(artifactSummary),
        lastExecutionErrorCode: null,
      },
    });

    await tx.auditEvent.create({
      data: buildPlanningAuditEventData({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        planningRequestId: input.planningRequestId,
        eventName: PLANNING_AUDIT_EVENT_NAMES.executionCompleted,
        occurredAt: now,
        payload: {
          planningRequestId: input.planningRequestId,
          generatedArtifactCount: countGeneratedArtifacts(artifactSummary),
          artifactPaths: artifactSummary.map((item) => item.path),
        },
      }),
    });
  });
}

function normalizePlanningExecutionError(error: unknown): { code: string; message: string } {
  if (error instanceof PlanningArtifactWriteError) {
    return {
      code: error.code,
      message: sanitizeError(error, error.code),
    };
  }

  if (error instanceof Error && error.message === "PLANNING_SKILL_UNSUPPORTED") {
    return {
      code: "PLANNING_SKILL_UNSUPPORTED",
      message: sanitizeError(error, "PLANNING_SKILL_UNSUPPORTED"),
    };
  }

  return {
    code: "PLANNING_REQUEST_EXECUTE_ERROR",
    message: sanitizeError(error, "PLANNING_REQUEST_EXECUTE_ERROR"),
  };
}
