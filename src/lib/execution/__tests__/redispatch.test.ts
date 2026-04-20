import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTaskFindFirst = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockPrismaTransaction = vi.fn();

const mockTxTaskUpdateMany = vi.fn();
const mockTxTaskUpdate = vi.fn();
const mockTxAgentRunFindUnique = vi.fn();
const mockTxAgentRunUpdate = vi.fn();
const mockTxAgentRunCreate = vi.fn();
const mockTxAuditEventCreate = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    task: {
      findFirst: (...args: unknown[]) => mockTaskFindFirst(...args),
      updateMany: (...args: unknown[]) => mockTaskUpdateMany(...args),
    },
    $transaction: (...args: unknown[]) => mockPrismaTransaction(...args),
  },
}));

vi.mock("@/lib/execution/supervisor/termination", () => ({
  resolveActiveExecutionSessionHandle: vi.fn(),
  terminateActiveAgentRun: vi.fn(),
}));

const {
  resolveActiveExecutionSessionHandle,
  terminateActiveAgentRun,
} = await import("@/lib/execution/supervisor/termination");
const {
  redispatchTask,
} = await import("../redispatch");

const mockResolveActiveExecutionSessionHandle = resolveActiveExecutionSessionHandle as ReturnType<typeof vi.fn>;
const mockTerminateActiveAgentRun = terminateActiveAgentRun as ReturnType<typeof vi.fn>;

function createTx() {
  return {
    task: {
      updateMany: mockTxTaskUpdateMany,
      update: mockTxTaskUpdate,
    },
    agentRun: {
      findUnique: mockTxAgentRunFindUnique,
      update: mockTxAgentRunUpdate,
      create: mockTxAgentRunCreate,
    },
    auditEvent: {
      create: mockTxAuditEventCreate,
    },
  };
}

function createRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-current",
    agentType: "codex",
    status: "dispatched",
    decisionSource: "intent-heuristic",
    selectionReasonCode: "heuristic-codex",
    selectionReasonSummary: "系统判断该任务适合直接编码落地。",
    matchedSignals: ["codex:intent-implement"],
    requestedByUserId: "user-0",
    createdAt: new Date("2026-04-14T01:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    terminatedAt: null,
    supersededAt: null,
    terminationReasonCode: null,
    terminationReasonSummary: null,
    replacesRunId: null,
    metadata: {
      currentActivity: "等待新会话启动。",
    },
    replacementRun: null,
    ...overrides,
  };
}

function createTask(overrides: Record<string, unknown> = {}) {
  const currentRun = (overrides.currentAgentRun as ReturnType<typeof createRun> | undefined) ?? createRun();

  return {
    id: "task-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    planningRequestId: null,
    sourceArtifactId: "artifact-1",
    goal: "补齐 reroute 能力",
    summary: "范围明确，适合直接编码",
    intent: "implement",
    intentDetail: null,
    preferredAgentType: null,
    status: "dispatched",
    currentStage: "已派发",
    nextStep: "等待新会话启动。",
    currentAgentRunId: currentRun.id,
    metadata: {
      currentActivity: "等待新会话启动。",
      activeExecutionSession: {
        transport: "supervisor",
        sessionRef: "session-1",
      },
    },
    workspace: {
      id: "workspace-1",
      slug: "demo-workspace",
      settings: {
        agentRoutingPreference: "auto",
        maxConcurrentTasks: 5,
        autoRecoveryEnabled: true,
        requireApprovalBeforeExecution: false,
        autoDispatchAfterPlanning: false,
      },
    },
    project: {
      id: "project-1",
      slug: "demo-project",
      settings: {},
    },
    currentAgentRun: currentRun,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTaskFindFirst.mockResolvedValue(createTask());
  mockTaskUpdateMany.mockResolvedValue({ count: 1 });
  mockTxTaskUpdateMany.mockResolvedValue({ count: 1 });
  mockTxTaskUpdate.mockResolvedValue(undefined);
  mockTxAgentRunFindUnique.mockResolvedValue(null);
  mockTxAgentRunUpdate.mockResolvedValue(undefined);
  mockTxAgentRunCreate.mockResolvedValue(createRun({
    id: "run-next",
    agentType: "claude-code",
    decisionSource: "manual-reroute",
    selectionReasonCode: "manual-reroute",
    selectionReasonSummary: "当前任务更适合分析与方案整理。",
    matchedSignals: ["explicit:claude-code"],
    replacesRunId: "run-current",
    metadata: {
      currentActivity: "已重新派发，等待新会话启动。",
    },
  }));
  mockPrismaTransaction.mockImplementation(async (handler: (tx: ReturnType<typeof createTx>) => Promise<unknown>) => (
    handler(createTx())
  ));
  mockResolveActiveExecutionSessionHandle.mockReturnValue({
    transport: "supervisor",
    sessionRef: "session-1",
    lastActivityAt: "2026-04-14T02:00:00.000Z",
    lastActivitySummary: "正在分析路由",
    contextSnapshot: { branch: "main" },
  });
  mockTerminateActiveAgentRun.mockResolvedValue({
    transport: "supervisor",
    sessionRef: "session-1",
    terminatedAt: "2026-04-14T02:08:00.000Z",
    lastActivityAt: "2026-04-14T02:07:00.000Z",
    lastActivitySummary: "已输出最近结论",
    contextSnapshot: { branch: "main" },
  });
});

describe("redispatchTask", () => {
  it("creates a replacement run for dispatched tasks and keeps task status dispatched", async () => {
    const result = await redispatchTask({
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
      actorUserId: "user-1",
      targetAgentType: "claude-code",
      expectedAgentRunId: "run-current",
      reasonSummary: "当前任务更适合分析与方案整理。",
      confirmRunningRedispatch: false,
    });

    expect(result).toMatchObject({
      taskId: "task-1",
      status: "dispatched",
      currentStage: "已重新派发",
      replacedAgentRunId: "run-current",
      didTerminateActiveSession: false,
    });
    expect(mockTxAgentRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "superseded",
      }),
    }));
    expect(mockTxAgentRunCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agentType: "claude-code",
        replacesRunId: "run-current",
      }),
    }));
    expect(mockTxTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "dispatched",
        currentAgentRunId: "run-next",
      }),
    }));
    expect(mockTxAuditEventCreate).toHaveBeenCalledTimes(2);
  });

  it("rejects reroute when the target agent matches the current run", async () => {
    await expect(redispatchTask({
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
      actorUserId: "user-1",
      targetAgentType: "codex",
      expectedAgentRunId: "run-current",
      reasonSummary: "无变化。",
      confirmRunningRedispatch: false,
    })).rejects.toMatchObject({
      code: "TASK_REDISPATCH_NOOP",
    });

    expect(mockPrismaTransaction).not.toHaveBeenCalled();
  });

  it("rejects stale expected run ids before starting redispatch", async () => {
    mockTaskFindFirst.mockResolvedValue(createTask({
      currentAgentRunId: "run-other",
    }));

    await expect(redispatchTask({
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
      actorUserId: "user-1",
      targetAgentType: "claude-code",
      expectedAgentRunId: "run-current",
      reasonSummary: "当前任务更适合分析与方案整理。",
      confirmRunningRedispatch: false,
    })).rejects.toMatchObject({
      code: "TASK_REDISPATCH_CONFLICT",
    });
  });

  it("requires explicit confirmation before rerouting a running task", async () => {
    mockTaskFindFirst.mockResolvedValue(createTask({
      status: "in-progress",
      currentAgentRun: createRun({
        status: "running",
      }),
    }));

    await expect(redispatchTask({
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
      actorUserId: "user-1",
      targetAgentType: "claude-code",
      expectedAgentRunId: "run-current",
      reasonSummary: "当前任务更适合分析与方案整理。",
      confirmRunningRedispatch: false,
    })).rejects.toMatchObject({
      code: "TASK_RUNNING_REDISPATCH_CONFIRMATION_REQUIRED",
    });
  });

  it("honestly blocks running redispatch when no safe session handle exists", async () => {
    mockTaskFindFirst.mockResolvedValue(createTask({
      status: "in-progress",
      currentAgentRun: createRun({
        status: "running",
      }),
    }));
    mockResolveActiveExecutionSessionHandle.mockReturnValue(null);

    await expect(redispatchTask({
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
      actorUserId: "user-1",
      targetAgentType: "claude-code",
      expectedAgentRunId: "run-current",
      reasonSummary: "当前任务更适合分析与方案整理。",
      confirmRunningRedispatch: true,
    })).rejects.toMatchObject({
      code: "TASK_RUNNING_REDISPATCH_PRECONDITION_MISSING",
    });
  });

  it("restores task metadata when termination fails before replacement run creation", async () => {
    mockTaskFindFirst.mockResolvedValue(createTask({
      status: "in-progress",
      currentAgentRun: createRun({
        status: "running",
      }),
    }));
    mockTerminateActiveAgentRun.mockRejectedValue(new Error("tmux unavailable"));

    await expect(redispatchTask({
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
      actorUserId: "user-1",
      targetAgentType: "claude-code",
      expectedAgentRunId: "run-current",
      reasonSummary: "当前任务更适合分析与方案整理。",
      confirmRunningRedispatch: true,
    })).rejects.toMatchObject({
      code: "EXECUTION_SESSION_TERMINATION_UNAVAILABLE",
    });

    expect(mockTxAgentRunCreate).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          currentActivity: "等待新会话启动。",
        }),
      }),
    }));
  });

  it("returns the existing replacement run without creating a duplicate", async () => {
    mockTxAgentRunFindUnique.mockResolvedValue(createRun({
      id: "run-next",
      agentType: "claude-code",
      status: "dispatched",
      decisionSource: "manual-reroute",
      selectionReasonCode: "manual-reroute",
      selectionReasonSummary: "当前任务更适合分析与方案整理。",
      matchedSignals: ["explicit:claude-code"],
      replacesRunId: "run-current",
      metadata: {
        currentActivity: "已重新派发，等待新会话启动。",
      },
    }));

    const result = await redispatchTask({
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
      actorUserId: "user-1",
      targetAgentType: "claude-code",
      expectedAgentRunId: "run-current",
      reasonSummary: "当前任务更适合分析与方案整理。",
      confirmRunningRedispatch: false,
    });

    expect(result.currentAgentRun.id).toBe("run-next");
    expect(mockTxTaskUpdateMany).not.toHaveBeenCalled();
    expect(mockTxAgentRunCreate).not.toHaveBeenCalled();
  });
});
