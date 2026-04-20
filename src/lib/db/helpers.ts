import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth/auth";

import { headers } from "next/headers";
import { prisma } from "@/lib/db/client";
import type { RepoConfig, ActionResult, UserRole } from "@/lib/types";

/**
 * Get the authenticated session with userId and role. Cached per request via React cache().
 * Returns null if not authenticated.
 */
export const getAuthenticatedSession = cache(
  async (): Promise<{ userId: string; role: UserRole; email: string; name: string | null } | null> => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) return null;
    const role = (session.user.role === "admin" ? "admin" : "user") satisfies UserRole;
    return { userId: session.user.id, role, email: session.user.email, name: session.user.name ?? null };
  }
);

/**
 * Require admin role. Returns ActionResult with error if not admin.
 */
export async function requireAdmin(): Promise<ActionResult<{ userId: string }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }
  if (session.role !== "admin") {
    return { success: false, error: "Access denied", code: "FORBIDDEN" };
  }
  return { success: true, data: { userId: session.userId } };
}

/**
 * Get the authenticated user's ID. Cached per request via React cache().
 * Delegates to getAuthenticatedSession to avoid duplicate auth.api.getSession calls.
 */
export const getAuthenticatedUserId = cache(
  async (): Promise<string | null> => {
    const session = await getAuthenticatedSession();
    return session?.userId ?? null;
  }
);

/**
 * Get all repos for the authenticated user. Cached per request via React cache().
 * Deduplicates across layout.tsx and page.tsx within the same render.
 */
export const getAuthenticatedRepos = cache(
  async (userId: string): Promise<RepoConfig[]> => {
    const rows = await prisma.repo.findMany({
      where: { userId },
      select: { owner: true, name: true, branch: true, displayName: true, description: true, sourceType: true, localPath: true, lastSyncedAt: true },
      orderBy: { createdAt: "desc" },
    });
    return rows as RepoConfig[];
  }
);

/**
 * Get a single repo config for the authenticated user. Cached per request.
 * Returns null if not found (user doesn't own this repo).
 */
export const getAuthenticatedRepoConfig = cache(
  async (
    userId: string,
    owner: string,
    name: string
  ): Promise<RepoConfig | null> => {
    const row = await prisma.repo.findFirst({
      where: { userId, owner, name },
      select: { owner: true, name: true, branch: true, displayName: true, description: true, sourceType: true, localPath: true, lastSyncedAt: true },
    });
    return row as RepoConfig | null;
  }
);

/**
 * Get the personal workspace for a user. Cached per request via React cache().
 * Returns workspace with its membership record, or null if not found.
 */
export const getPersonalWorkspace = cache(
  async (userId: string) => {
    return prisma.workspace.findFirst({
      where: { ownerId: userId, type: "PERSONAL" },
      include: { memberships: { where: { userId }, take: 1 } },
    });
  }
);

/**
 * Get a workspace by slug with its projects. Cached per request via React cache().
 */
export const getWorkspaceBySlug = cache(
  async (slug: string) => {
    return prisma.workspace.findUnique({
      where: { slug },
      include: { projects: { orderBy: { updatedAt: "desc" } } },
    });
  }
);

/**
 * Get a workspace membership for permission verification. Cached per request via React cache().
 */
export const getWorkspaceMembership = cache(
  async (workspaceId: string, userId: string) => {
    return prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId },
    });
  }
);

/**
 * Get all workspaces a user is a member of. Cached per request via React cache().
 * Used by sidebar to display workspace list.
 */
export const getWorkspacesForUser = cache(
  async (userId: string) => {
    return prisma.workspaceMembership.findMany({
      where: { userId },
      include: {
        workspace: {
          select: { id: true, name: true, slug: true, type: true },
        },
      },
      orderBy: { workspace: { updatedAt: "desc" } },
    });
  }
);

/**
 * Get count of active projects in a workspace. Cached per request via React cache().
 */
export const getActiveProjectCount = cache(
  async (workspaceId: string) => {
    return prisma.project.count({
      where: { workspaceId, status: "active" },
    });
  }
);

/**
 * Get a workspace by its ID. Cached per request via React cache().
 */
export const getWorkspaceById = cache(
  async (workspaceId: string) => {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
  }
);

/**
 * Get all members of a workspace with user info. Cached per request via React cache().
 * Returns members sorted by createdAt ascending.
 */
export const getWorkspaceMembers = cache(
  async (workspaceId: string) => {
    return prisma.workspaceMembership.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }
);

/**
 * Get a project by its slug within a workspace. Cached per request via React cache().
 * Returns the project with its associated repo, or null if not found.
 */
export const getProjectBySlug = cache(
  async (workspaceId: string, projectSlug: string) => {
    return prisma.project.findFirst({
      where: { workspaceId, slug: projectSlug },
      include: { repo: true },
    });
  }
);

/**
 * Get all active BmadArtifacts for a project. Cached per request via React cache().
 */
export const getProjectArtifacts = cache(
  async (projectId: string) => {
    return prisma.bmadArtifact.findMany({
      where: { projectId, status: "active" },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
  }
);

export const getArtifactsByProjectIdAndFilePaths = cache(
  async (projectId: string, filePaths: string[]) => {
    if (filePaths.length === 0) {
      return [];
    }

    return prisma.bmadArtifact.findMany({
      where: {
        projectId,
        status: "active",
        filePath: { in: filePaths },
      },
      select: {
        id: true,
        type: true,
        name: true,
        filePath: true,
        parentId: true,
        metadata: true,
      },
    });
  }
);

export const getArtifactsByProjectIdAndIds = cache(
  async (projectId: string, artifactIds: string[]) => {
    if (artifactIds.length === 0) {
      return [];
    }

    return prisma.bmadArtifact.findMany({
      where: {
        projectId,
        status: "active",
        id: { in: artifactIds },
      },
      select: {
        id: true,
        type: true,
        name: true,
        filePath: true,
        parentId: true,
        metadata: true,
      },
    });
  }
);

/**
 * Get a single BmadArtifact by ID. Cached per request via React cache().
 */
export const getArtifactById = cache(
  async (artifactId: string) => {
    return prisma.bmadArtifact.findUnique({
      where: { id: artifactId },
    });
  }
);

// ── Shared Prisma selectors ─────────────────────────────────────────────────────
// Defined in dependency order: executionSession → agentRun → taskHistoryRecord

const executionSessionRecordSelect = {
  id: true,
  taskId: true,
  agentRunId: true,
  transport: true,
  sessionName: true,
  processPid: true,
  status: true,
  startedAt: true,
  completedAt: true,
  terminatedAt: true,
  terminationReasonCode: true,
  terminationReasonSummary: true,
  createdAt: true,
} satisfies Prisma.ExecutionSessionSelect;

const agentRunRecordSelect = {
  id: true,
  agentType: true,
  status: true,
  decisionSource: true,
  selectionReasonCode: true,
  selectionReasonSummary: true,
  matchedSignals: true,
  requestedByUserId: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  terminatedAt: true,
  supersededAt: true,
  terminationReasonCode: true,
  terminationReasonSummary: true,
  replacesRunId: true,
  metadata: true,
  replacementRun: {
    select: {
      id: true,
    },
  },
  executionSession: {
    select: executionSessionRecordSelect,
  },
} satisfies Prisma.AgentRunSelect;

const taskHistoryRecordSelect = {
  id: true,
  planningRequestId: true,
  sourceArtifactId: true,
  intentDetail: true,
  preferredAgentType: true,
  title: true,
  status: true,
  currentStage: true,
  nextStep: true,
  currentAgentRunId: true,
  createdAt: true,
  metadata: true,
  sourceArtifact: {
    select: {
      id: true,
      type: true,
      name: true,
      filePath: true,
      metadata: true,
      parent: {
        select: {
          id: true,
          type: true,
          name: true,
          parent: {
            select: {
              id: true,
              type: true,
              name: true,
              parent: {
                select: {
                  id: true,
                  type: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  },
  currentAgentRun: {
    select: agentRunRecordSelect,
  },
  agentRuns: {
    orderBy: [{ createdAt: "desc" }],
    select: agentRunRecordSelect,
  },
  executionSessions: {
    orderBy: [{ createdAt: "desc" }],
    select: executionSessionRecordSelect,
  },
  writebacks: {
    orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
    take: 1,
    select: {
      id: true,
      taskId: true,
      artifactId: true,
      outcome: true,
      writebackStatus: true,
      summary: true,
      errorSummary: true,
      occurredAt: true,
      payload: true,
    },
  },
} satisfies Prisma.TaskSelect;

/**
 * Get a single task by ID with related project, workspace, creator, and source artifact hierarchy.
 * Cached per request via React cache().
 */
export const getTaskById = cache(
  async (taskId: string) => {
    return prisma.task.findUnique({
      where: { id: taskId },
      include: {
        workspace: {
          select: { id: true, slug: true, name: true },
        },
        project: {
          select: { id: true, workspaceId: true, slug: true, name: true, settings: true },
        },
        createdByUser: {
          select: { id: true, name: true, email: true },
        },
        sourceArtifact: {
          include: {
            parent: {
              include: {
                parent: {
                  include: {
                    parent: true,
                  },
                },
              },
            },
          },
        },
        currentAgentRun: {
          select: agentRunRecordSelect,
        },
        agentRuns: {
          orderBy: [{ createdAt: "desc" }],
          select: agentRunRecordSelect,
        },
        executionSessions: {
          orderBy: [{ createdAt: "desc" }],
          select: executionSessionRecordSelect,
        },
        writebacks: {
          orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
          take: 1,
          select: {
            id: true,
            taskId: true,
            artifactId: true,
            outcome: true,
            writebackStatus: true,
            summary: true,
            errorSummary: true,
            occurredAt: true,
            payload: true,
          },
        },
      },
    });
  }
);

export const getTaskHistoryCandidatesByProjectId = cache(
  async (projectId: string, status?: string) => {
    return prisma.task.findMany({
      where: {
        projectId,
        ...(status ? { status } : {}),
      },
      select: taskHistoryRecordSelect,
      orderBy: { createdAt: "desc" },
    });
  }
);

export const getTasksBySourceArtifactIds = cache(
  async (projectId: string, sourceArtifactIds: string[], status?: string) => {
    if (sourceArtifactIds.length === 0) {
      return [];
    }

    return prisma.task.findMany({
      where: {
        projectId,
        sourceArtifactId: {
          in: sourceArtifactIds,
        },
        ...(status ? { status } : {}),
      },
      select: taskHistoryRecordSelect,
      orderBy: { createdAt: "desc" },
    });
  }
);

export const getTasksBySourceArtifactId = cache(
  async (projectId: string, sourceArtifactId: string, status?: string) => {
    const tasks = await getTasksBySourceArtifactIds(projectId, [sourceArtifactId], status);
    return tasks;
  }
);

export const getTasksByPlanningRequestId = cache(
  async (projectId: string, planningRequestId: string, status?: string) => {
    const tasks = await getTasksByPlanningRequestIds(projectId, [planningRequestId], status);
    return tasks.filter((task) => task.planningRequestId === planningRequestId);
  },
);

export const getTasksByPlanningRequestIds = cache(
  async (projectId: string, planningRequestIds: string[], status?: string) => {
    if (planningRequestIds.length === 0) {
      return [];
    }

    return prisma.task.findMany({
      where: {
        projectId,
        planningRequestId: {
          in: planningRequestIds,
        },
        ...(status ? { status } : {}),
      },
      select: taskHistoryRecordSelect,
      orderBy: { createdAt: "desc" },
    });
  },
);

export const getLatestWritebackByTaskId = cache(
  async (projectId: string, taskId: string) => {
    return prisma.writeback.findFirst({
      where: { projectId, taskId },
      orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        taskId: true,
        artifactId: true,
        outcome: true,
        writebackStatus: true,
        summary: true,
        errorSummary: true,
        occurredAt: true,
        payload: true,
      },
    });
  }
);

export const getLatestWritebackByArtifactId = cache(
  async (projectId: string, artifactId: string) => {
    return prisma.writeback.findFirst({
      where: { projectId, artifactId },
      orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        taskId: true,
        artifactId: true,
        outcome: true,
        writebackStatus: true,
        summary: true,
        errorSummary: true,
        occurredAt: true,
        payload: true,
      },
    });
  }
);

export const getWritebackHistoryByArtifactId = cache(
  async (projectId: string, artifactId: string) => {
    return prisma.writeback.findMany({
      where: { projectId, artifactId },
      orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        taskId: true,
        artifactId: true,
        outcome: true,
        writebackStatus: true,
        summary: true,
        errorSummary: true,
        occurredAt: true,
        payload: true,
      },
    });
  }
);

/**
 * Get all PENDING invitations for a workspace. Cached per request via React cache().
 * Returns invitations sorted by createdAt descending.
 */
export const getWorkspaceInvitations = cache(
  async (workspaceId: string) => {
    return prisma.workspaceInvitation.findMany({
      where: { workspaceId, status: "PENDING" },
      include: {
        invitedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
);

// ── Execution Queue helpers (§4.5 Task 4.1) ───────────────────────────────────────────────

/**
 * Resolve the concurrency snapshot for display in task detail UI.
 * Returns workspace-level and project-level active session counts, max capacity,
 * and queue position for the given task.
 */
export const resolveTaskConcurrencySnapshot = cache(
  async (taskId: string, workspaceId: string, projectId: string) => {
    const [task, workspaceSettings, activeSessions] = await Promise.all([
      prisma.task.findUnique({
        where: { id: taskId },
        select: { metadata: true },
      }),
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { settings: true },
      }),
      prisma.executionSession.findMany({
        where: {
          workspaceId,
          status: { in: ["starting", "running"] },
        },
        select: { id: true, projectId: true },
      }),
    ]);

    const maxConcurrentTasks = resolveMaxConcurrentTasks(workspaceSettings?.settings);
    const workspaceActive = activeSessions.length;
    const projectActive = activeSessions.filter((s) => s.projectId === projectId).length;

    const snap = parseExecutionQueueSnapshot(task?.metadata);
    const queuePosition = snap.queuePosition;

    return {
      maxConcurrentTasks,
      workspaceActiveConcurrentTasks: workspaceActive,
      projectActiveConcurrentTasks: projectActive,
      queuePosition,
    };
  }
);

function resolveMaxConcurrentTasks(settings: unknown): number {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const record = settings as Record<string, unknown>;
    const value = record?.maxConcurrentTasks;
    if (typeof value === "number" && value >= 1 && value <= 50) {
      return value;
    }
  }
  return 5;
}

function parseExecutionQueueSnapshot(
  metadata: unknown,
): { queuePosition: number | null; queuedAt: string | null; workspaceActiveConcurrentTasks: number; projectActiveConcurrentTasks: number; maxConcurrentTasks: number; estimatedWaitSeconds: number | null; estimatedWaitLabel: string | null; queueReasonCode: string; queueReasonSummary: string } {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { queuePosition: null, queuedAt: null, workspaceActiveConcurrentTasks: 0, projectActiveConcurrentTasks: 0, maxConcurrentTasks: 5, estimatedWaitSeconds: null, estimatedWaitLabel: null, queueReasonCode: "WORKSPACE_CAPACITY_FULL", queueReasonSummary: "" };
  }
  const record = metadata as Record<string, unknown>;
  const snap = (typeof record?.executionQueue === "object" && record.executionQueue !== null) ? record.executionQueue as Record<string, unknown> : {};
  const queuePosition = typeof snap?.queuePosition === "number" ? snap.queuePosition : null;
  const queuedAt = typeof snap?.queuedAt === "string" ? snap.queuedAt : null;
  const workspaceActive = typeof snap?.workspaceActiveConcurrentTasks === "number" ? snap.workspaceActiveConcurrentTasks : 0;
  const projectActive = typeof snap?.projectActiveConcurrentTasks === "number" ? snap.projectActiveConcurrentTasks : 0;
  const maxConcurrent = typeof snap?.maxConcurrentTasks === "number" ? snap.maxConcurrentTasks : 5;
  const estimatedSeconds = typeof snap?.estimatedWaitSeconds === "number" ? snap.estimatedWaitSeconds : null;
  const estimatedLabel = typeof snap?.estimatedWaitLabel === "string" ? snap.estimatedWaitLabel : null;
  const reasonCode = typeof snap?.queueReasonCode === "string" ? snap.queueReasonCode : "WORKSPACE_CAPACITY_FULL";
  const reasonSummary = typeof snap?.queueReasonSummary === "string" ? snap.queueReasonSummary : "";
  return {
    queuePosition,
    queuedAt,
    workspaceActiveConcurrentTasks: workspaceActive,
    projectActiveConcurrentTasks: projectActive,
    maxConcurrentTasks: maxConcurrent,
    estimatedWaitSeconds: estimatedSeconds,
    estimatedWaitLabel: estimatedLabel,
    queueReasonCode: reasonCode,
    queueReasonSummary: reasonSummary,
  };
}

/**
 * Resolve execution boundary summary for a task.
 * Fetches the active ExecutionSession metadata and parses the boundary profile.
 */
export const resolveTaskBoundarySnapshot = cache(
  async (taskId: string, workspaceId: string, projectId: string) => {
    const [task, latestSession] = await Promise.all([
      prisma.task.findUnique({
        where: { id: taskId },
        select: {
          currentAgentRunId: true,
          metadata: true,
        },
      }),
      prisma.executionSession.findFirst({
        where: {
          taskId,
          workspaceId,
          status: { in: ["starting", "running"] },
        },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      }),
    ]);

    const sessionMeta = latestSession?.metadata ?? null;
    return parseTaskBoundarySnapshot(sessionMeta);
  }
);

function parseTaskBoundarySnapshot(
  metadata: unknown,
): {
  hasBoundaryProfile: boolean;
  projectRootDisplayPath: string | null;
  preparationSucceeded: boolean | null;
  injectedFileCount: number;
  sensitivePathCount: number;
  lastViolationCode: string | null;
  lastViolationSummary: string | null;
  lastViolationFatal: boolean;
  boundaryCurrentStage: string | null;
  boundaryNextStep: string | null;
} {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {
      hasBoundaryProfile: false,
      projectRootDisplayPath: null,
      preparationSucceeded: null,
      injectedFileCount: 0,
      sensitivePathCount: 0,
      lastViolationCode: null,
      lastViolationSummary: null,
      lastViolationFatal: false,
      boundaryCurrentStage: null,
      boundaryNextStep: null,
    };
  }
  const record = metadata as Record<string, unknown>;
  const hasProfile = !!record?.projectRootRealPath;
  return {
    hasBoundaryProfile: hasProfile,
    projectRootDisplayPath: hasProfile ? (record.projectRootDisplayPath as string | null) ?? null : null,
    preparationSucceeded: hasProfile ? ((record.preparationSucceeded as boolean) ?? false) : null,
    injectedFileCount: hasProfile ? ((record.injectedFileCount as number) ?? 0) : 0,
    sensitivePathCount: hasProfile ? ((record.sensitivePathCount as number) ?? 0) : 0,
    lastViolationCode: hasProfile ? ((record.lastViolationCode as string | null) ?? null) : null,
    lastViolationSummary: hasProfile ? ((record.lastViolationSummary as string | null) ?? null) : null,
    lastViolationFatal: hasProfile ? ((record.lastViolationFatal as boolean) ?? false) : false,
    boundaryCurrentStage: hasProfile ? ((record.boundaryCurrentStage as string | null) ?? null) : null,
    boundaryNextStep: hasProfile ? ((record.boundaryNextStep as string | null) ?? null) : null,
  };
}

// ── Task State Events ─────────────────────────────────────────────────────────────────

export interface TaskStateEventRecord {
  id: string;
  taskId: string;
  agentRunId: string | null;
  fromStatus: string;
  toStatus: string;
  trigger: string;
  reason: string | null;
  actorType: string;
  actorId: string | null;
  rejected: boolean;
  createdAt: Date;
}

export async function getTaskStateHistory(
  taskId: string,
  options?: { limit?: number; includeRejected?: boolean },
): Promise<TaskStateEventRecord[]> {
  const where: Prisma.TaskStateEventWhereInput = { taskId };
  if (!options?.includeRejected) {
    where.rejected = false;
  }

  const records = await prisma.taskStateEvent.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: options?.limit,
  });

  return records;
}

export async function getTaskCurrentState(taskId: string): Promise<{
  status: string;
  currentStage: string;
  currentActivity: string;
  nextStep: string;
} | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      status: true,
      currentStage: true,
      currentActivity: true,
      nextStep: true,
    },
  });
  return task;
}

export async function getTaskStateTransitionSummary(taskId: string): Promise<{
  totalTransitions: number;
  rejectedTransitions: number;
  lastTransition: { fromStatus: string; toStatus: string; createdAt: Date } | null;
  currentStateAge: string;
}> {
  const [totalCount, rejectedCount, task, lastEvent] = await Promise.all([
    prisma.taskStateEvent.count({ where: { taskId } }),
    prisma.taskStateEvent.count({ where: { taskId, rejected: true } }),
    prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, updatedAt: true },
    }),
    prisma.taskStateEvent.findFirst({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      select: { fromStatus: true, toStatus: true, createdAt: true },
    }),
  ]);

  const stateAge = task?.updatedAt
    ? formatDurationFromNow(task.updatedAt)
    : "未知";

  return {
    totalTransitions: totalCount,
    rejectedTransitions: rejectedCount,
    lastTransition: lastEvent
      ? { fromStatus: lastEvent.fromStatus, toStatus: lastEvent.toStatus, createdAt: lastEvent.createdAt }
      : null,
    currentStateAge: stateAge,
  };
}

function formatDurationFromNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return "刚刚";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}天前`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}个月前`;
}
