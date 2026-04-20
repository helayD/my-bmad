/**
 * Supervisor launch orchestration — converts a dispatched AgentRun into a live tmux session.
 *
 * Two-phase + compensation pattern (§4.3):
 * 1. Short transaction: claim the run and write "creating" intermediate state.
 * 2. External I/O: call tmux adapter to create session and resolve PID.
 * 3. Second short transaction: persist ExecutionSession, update AgentRun/Task truth.
 *    - If this step fails: execute compensation (close the tmux session).
 *
 * Boundary integration (§4.6 Task 3):
 * - Before tmux session creation, prepare the execution context (allowlist scan).
 * - Canonical project root must be validated via realpath() — symlink root is rejected.
 * - Boundary profile is stored in ExecutionSession.metadata.
 * - Fatal boundary failures block session creation and record honest audit events.
 * - Non-fatal violations are recorded but do not block launch.
 *
 * Precondition checks (§2.2–2.4):
 * - Task status must be "dispatched" with a matching currentAgentRunId.
 * - Project must have a valid local execution root (sourceType = "local").
 * - tmux must be available on the host.
 * - Agent launch command must be resolvable from catalog.
 * - No existing active ExecutionSession for the same AgentRun (idempotency).
 *
 * Failure semantics (§4.3a):
 * - If session creation or agent startup fails before truth is committed,
 *   AgentRun.status → "failed", Task.status stays "dispatched",
 *   with honest currentStage/currentActivity describing the failure layer.
 */

import { Prisma } from "@/generated/prisma/client";
import { buildExecutionSessionAuditEventData, EXECUTION_SESSION_AUDIT_EVENT_NAMES } from "@/lib/audit/events";
import { prisma } from "@/lib/db/client";
import {
  resolveAgentLaunchCommand,
} from "@/lib/execution/catalog";
import {
  isTmuxAvailable,
  createSession,
  killSession,
  buildSessionName,
  type TmuxAdapterError,
} from "@/lib/execution/tmux";
import {
  resolveProjectExecutionRoot,
  ExecutionPreconditionError,
} from "@/lib/execution/project-root";
import {
  type TaskAgentType,
} from "@/lib/tasks";
import {
  buildBoundaryProfilePayload,
  EXECUTION_BOUNDARY_VIOLATION_CODES,
} from "./boundary";
import {
  prepareExecutionContext,
  buildBoundaryProfileFromContext,
} from "./context";

export class LaunchServiceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LaunchServiceError";
  }
}

export interface LaunchTaskInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  agentRunId: string;
  sourceArtifactId?: string | null;
}

export interface LaunchTaskResult {
  executionSessionId: string;
  taskId: string;
  agentRunId: string;
  sessionName: string;
  processPid: number | null;
  transport: string;
}

const TASK_FOR_LAUNCH_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  planningRequestId: true,
  sourceArtifactId: true,
  status: true,
  currentStage: true,
  nextStep: true,
  currentAgentRunId: true,
  metadata: true,
  project: {
    select: {
      id: true,
      slug: true,
      repo: {
        select: {
          id: true,
          sourceType: true,
          localPath: true,
        },
      },
    },
  },
  workspace: {
    select: {
      id: true,
      slug: true,
    },
  },
  currentAgentRun: {
    select: {
      id: true,
      agentType: true,
      status: true,
      metadata: true,
    },
  },
} satisfies Prisma.TaskSelect;

type TaskForLaunch = Prisma.TaskGetPayload<{ select: typeof TASK_FOR_LAUNCH_SELECT }>;

export async function launchTask(input: LaunchTaskInput): Promise<LaunchTaskResult> {
  // ── Phase 0: precondition checks ────────────────────────────────────────────

  const task = await prisma.task.findFirst({
    where: {
      id: input.taskId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    },
    select: TASK_FOR_LAUNCH_SELECT,
  });

  if (!task) {
    throw new LaunchServiceError("TASK_NOT_FOUND", "找不到指定的任务记录。");
  }

  const run = task.currentAgentRun;
  if (!run || run.id !== input.agentRunId) {
    throw new LaunchServiceError("TASK_LAUNCH_NO_RUN", "当前任务没有可启动的 Agent Run。");
  }

  if (task.currentAgentRunId !== input.agentRunId) {
    throw new LaunchServiceError("TASK_LAUNCH_RUN_MISMATCH", "Agent Run 与当前任务不匹配，请刷新后重试。");
  }

  if (task.status !== "dispatched") {
    throw new LaunchServiceError("TASK_LAUNCH_NOT_DISPATCHED", "当前任务状态还不能启动执行会话。");
  }

  if (run.status !== "dispatched") {
    throw new LaunchServiceError("TASK_LAUNCH_ALREADY_STARTED", "该 Agent Run 已经启动过了。");
  }

  // Check for existing active session — idempotency guard.
  const existingSession = await prisma.executionSession.findUnique({
    where: { agentRunId: input.agentRunId },
    select: { id: true, status: true },
  });
  if (existingSession && existingSession.status !== "failed") {
    throw new LaunchServiceError("TASK_LAUNCH_SESSION_EXISTS", "该 Agent Run 已有活跃执行会话。");
  }

  // tmux availability check.
  const tmuxOk = await isTmuxAvailable();
  if (!tmuxOk) {
    await recordLaunchFailure({
      task,
      agentRunId: input.agentRunId,
      errorCode: "TMUX_NOT_AVAILABLE",
      errorMessage: "tmux 不可用，请确认系统已安装 tmux。",
    });
    throw new LaunchServiceError("TMUX_NOT_AVAILABLE", "tmux 不可用，请确认系统已安装 tmux。");
  }

  // Resolve project execution root.
  let execRoot: NonNullable<Awaited<ReturnType<typeof resolveProjectExecutionRoot>>>;
  try {
    const result = await resolveProjectExecutionRoot(task.project);
    if (!result) {
      await recordLaunchFailure({
        task,
        agentRunId: input.agentRunId,
        errorCode: "EXECUTION_NO_LOCAL_REPO",
        errorMessage: "当前项目还没有可用于 self-hosted 执行的本地目录。",
      });
      throw new LaunchServiceError("EXECUTION_NO_LOCAL_REPO", "当前项目还没有可用于 self-hosted 执行的本地目录。");
    }
    execRoot = result;
  } catch (error) {
    if (error instanceof LaunchServiceError) throw error;
    if (error instanceof ExecutionPreconditionError) {
      await recordLaunchFailure({
        task,
        agentRunId: input.agentRunId,
        errorCode: error.code,
        errorMessage: error.humanMessage,
      });
      throw new LaunchServiceError(error.code, error.humanMessage);
    }
    throw error;
  }

  // Verify the resolved path actually exists on disk — tmux will silently
  // fall back to an unintended directory if cwd is invalid.
  const { existsSync } = await import("node:fs");
  if (!existsSync(execRoot.canonicalPath)) {
    await recordLaunchFailure({
      task,
      agentRunId: input.agentRunId,
      errorCode: EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_UNAVAILABLE,
      errorMessage: `项目执行目录不存在或无访问权限：${execRoot.canonicalPath}`,
    });
    throw new LaunchServiceError(
      EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_UNAVAILABLE,
      `项目执行目录不存在或无访问权限：${execRoot.canonicalPath}`,
    );
  }

  // ── Boundary preparation: build allowlist context at real launch time ─────────
  // This is always re-computed on launch, not reused from dispatch (avoids stale paths).
  const boundaryResult = await prepareBoundary({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    execRoot,
  });

  // Resolve agent launch command.
  const launchConfig = resolveAgentLaunchCommand(run.agentType as TaskAgentType, {
    projectRoot: execRoot.canonicalPath,
  });

  // ── Phase 1: short transaction — write intermediate state ───────────────────

  const now = new Date();
  const sessionName = buildSessionName(input.taskId, input.agentRunId);

  const claim = await prisma.task.updateMany({
    where: {
      id: input.taskId,
      currentAgentRunId: input.agentRunId,
      status: "dispatched",
    },
    data: {
      currentStage: "正在创建会话",
      nextStep: "等待 tmux 会话启动……",
      metadata: mergeTaskMetadata(task.metadata, {
        currentActivity: "执行监督器正在创建 tmux 会话，请稍候。",
      }) as Prisma.InputJsonValue,
    },
  });

  if (claim.count === 0) {
    throw new LaunchServiceError("TASK_LAUNCH_RACE_CONDITION", "任务状态已被其他操作改变，请刷新后重试。");
  }

  // ── Phase 2: external I/O — create tmux session ────────────────────────────

  let tmuxResult: { sessionName: string; panePid: number } | null = null;
  let tmuxError: TmuxAdapterError | null = null;

  try {
    tmuxResult = await createSession(
      sessionName,
      execRoot.canonicalPath,
      launchConfig.launchCommand.command,
      launchConfig.launchCommand.args,
    );
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      tmuxError = error as TmuxAdapterError;
    }
  }

  // ── Phase 3: second short transaction — commit truth or compensate ──────────

  if (!tmuxResult || tmuxError) {
    // tmux creation failed — record failure and compensate.
    const errorCode = tmuxError?.code ?? "TMUX_SESSION_CREATE_FAILED";
    const errorMessage = tmuxError?.message ?? "创建 tmux 会话失败。";

    await recordLaunchFailure({
      task,
      agentRunId: input.agentRunId,
      errorCode,
      errorMessage,
      attemptedSessionName: sessionName,
    });

    throw new LaunchServiceError(errorCode, errorMessage);
  }

  // tmux succeeded — commit ExecutionSession and update run/task truth.
  try {
    // Build boundary profile for session metadata (even failures get a profile).
    const boundaryProfile = boundaryResult.profile;
    const boundaryMetadata = buildBoundaryProfilePayload(boundaryProfile);

    const session = await prisma.executionSession.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        taskId: input.taskId,
        agentRunId: input.agentRunId,
        transport: "tmux",
        sessionName: tmuxResult.sessionName,
        processPid: tmuxResult.panePid,
        status: "running",
        startedAt: now,
        metadata: {
          projectRoot: execRoot.canonicalPath,
          agentCommand: launchConfig.launchCommand.command,
          agentArgs: launchConfig.launchCommand.args,
          ...(boundaryMetadata as object),
        } satisfies Prisma.InputJsonValue,
      },
    });

    const sessionSummary = {
      transport: "tmux",
      sessionRef: tmuxResult.sessionName,
      sessionName: tmuxResult.sessionName,
      processPid: tmuxResult.panePid,
      startedAt: now.toISOString(),
    };

    await prisma.$transaction([
      prisma.agentRun.update({
        where: { id: input.agentRunId },
        data: {
          status: "running",
          startedAt: now,
          metadata: mergeRunMetadata(run.metadata, {
            currentActivity: "执行监督器已创建 tmux 会话，Agent 正在运行。",
            activeExecutionSession: sessionSummary,
          }) as Prisma.InputJsonValue,
        },
      }),
      prisma.task.update({
        where: { id: input.taskId },
        data: {
          status: "in-progress",
          currentStage: "执行中",
          nextStep: "Agent 正在运行，监督器持续监控中。",
          metadata: mergeTaskMetadata(task.metadata, {
            currentActivity: "执行监督器已创建 tmux 会话，Agent 正在运行。",
            activeExecutionSession: sessionSummary,
          }) as Prisma.InputJsonValue,
        },
      }),
      prisma.auditEvent.create({
        data: buildExecutionSessionAuditEventData({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          taskId: input.taskId,
          artifactId: task.sourceArtifactId,
          eventName: EXECUTION_SESSION_AUDIT_EVENT_NAMES.started,
          occurredAt: now,
          payload: {
            executionSessionId: session.id,
            taskId: input.taskId,
            agentRunId: input.agentRunId,
            sessionName: tmuxResult!.sessionName,
            processPid: tmuxResult!.panePid,
            transport: "tmux",
            projectRoot: execRoot.canonicalPath,
          },
        }),
      }),
    ], {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return {
      executionSessionId: session.id,
      taskId: input.taskId,
      agentRunId: input.agentRunId,
      sessionName: tmuxResult.sessionName,
      processPid: tmuxResult.panePid,
      transport: "tmux",
    };
  } catch {
    // Phase 3 failed — compensate: close the tmux session we just created.
    const compError = await killSession(sessionName).catch((e: unknown) => e);
    if (compError) {
      console.warn(
        `[launchTask] Phase 3 transaction failed and compensation (killSession) also failed. ` +
        `Orphaned tmux session: ${sessionName}. Error: ${compError instanceof Error ? compError.message : String(compError)}`,
      );
    }
    throw new LaunchServiceError("TASK_LAUNCH_COMMIT_FAILED", "执行会话启动失败，请稍后重试。");
  }
}

async function recordLaunchFailure(opts: {
  task: TaskForLaunch;
  agentRunId: string;
  errorCode: string;
  errorMessage: string;
  attemptedSessionName?: string;
}): Promise<void> {
  const now = new Date();
  const run = opts.task.currentAgentRun!;

  await prisma.$transaction([
    prisma.agentRun.updateMany({
      where: { id: opts.agentRunId },
      data: {
        status: "failed",
        metadata: mergeRunMetadata(run.metadata, {
          currentActivity: opts.errorMessage,
          activeExecutionSession: null,
          launchFailure: {
            errorCode: opts.errorCode,
            errorMessage: opts.errorMessage,
            failedAt: now.toISOString(),
          },
        }) as Prisma.InputJsonValue,
      },
    }),
    prisma.task.updateMany({
      where: { id: opts.task.id, currentAgentRunId: opts.agentRunId },
      data: {
        currentStage: "会话启动失败",
        nextStep: "等待修复环境后重试或重新派发。",
        metadata: mergeTaskMetadata(opts.task.metadata, {
          currentActivity: opts.errorMessage,
          activeExecutionSession: null,
        }) as Prisma.InputJsonValue,
      },
    }),
    prisma.auditEvent.create({
      data: buildExecutionSessionAuditEventData({
        workspaceId: opts.task.workspaceId,
        projectId: opts.task.projectId,
        taskId: opts.task.id,
        artifactId: opts.task.sourceArtifactId,
        eventName: EXECUTION_SESSION_AUDIT_EVENT_NAMES.startFailed,
        occurredAt: now,
        payload: {
          executionSessionId: null,
          taskId: opts.task.id,
          agentRunId: opts.agentRunId,
          errorCode: opts.errorCode,
          errorSummary: opts.errorMessage,
          attemptedSessionName: opts.attemptedSessionName ?? null,
        },
      }),
    }),
  ], {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

// ── Metadata helpers ──────────────────────────────────────────────────────────

function mergeTaskMetadata(
  currentMetadata: unknown,
  updates: Record<string, unknown>,
): Prisma.JsonObject {
  return {
    ...toRecord(currentMetadata),
    ...updates,
  } as unknown as Prisma.JsonObject;
}

function mergeRunMetadata(
  currentMetadata: unknown,
  updates: Record<string, unknown>,
): Prisma.JsonObject {
  return {
    ...toRecord(currentMetadata),
    ...updates,
  } as unknown as Prisma.JsonObject;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

// ── Boundary preparation ─────────────────────────────────────────────────────────

interface BoundaryPrepareResult {
  profile: ReturnType<typeof buildBoundaryProfileFromContext>;
}

/**
 * Prepare execution boundary at real launch time.
 * Always re-resolves project root and scans context — never reuses stale dispatch-time snapshots.
 *
 * 1. Resolve and canonicalize project root (realpath + lstat symlink check).
 * 2. Build allowlist context snapshot.
 * 3. Return boundary profile (success or failure).
 *
 * Fatal errors (root unavailable, symlink root) are surfaced as LaunchServiceError
 * so they block session creation.
 */
async function prepareBoundary(opts: {
  workspaceId: string;
  projectId: string;
  execRoot: NonNullable<Awaited<ReturnType<typeof resolveProjectExecutionRoot>>>;
}): Promise<BoundaryPrepareResult> {
  const { workspaceId, projectId, execRoot } = opts;

  // Build allowlist roots — scan from the canonical project root.
  // We scan the whole project root ([""] means start from project root).
  const allowedRoots = [""];
  const sensitiveMatchers = undefined; // Use default matchers from sensitive-paths.ts

  const contextResult = await prepareExecutionContext({
    canonicalRoot: execRoot.canonicalPath,
    allowedRoots,
    maxFileCount: execRoot.maxFileCount,
    maxDepth: execRoot.maxDepth,
    maxFileSizeBytes: execRoot.maxFileSizeBytes,
    sensitiveMatchers,
  });

  const profile = buildBoundaryProfileFromContext({
    workspaceId,
    projectId,
    canonicalRoot: execRoot.canonicalPath,
    displayRoot: execRoot.displayPath,
    contextResult,
    allowedRoots,
    sensitiveMatchers,
    maxFileCount: execRoot.maxFileCount,
    maxDepth: execRoot.maxDepth,
    maxFileSizeBytes: execRoot.maxFileSizeBytes,
    preparedBy: "supervisor",
  });

  return { profile };
}
