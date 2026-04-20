import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db/helpers", () => ({
  getAuthenticatedSession: vi.fn(),
}));

vi.mock("@/lib/workspace/permissions", () => ({
  requireProjectAccess: vi.fn(),
}));

vi.mock("@/lib/errors", () => ({
  sanitizeError: vi.fn((_error: unknown, code: string) => `sanitized:${code}`),
}));

vi.mock("@/lib/execution/dispatch", () => ({
  dispatchTask: vi.fn(),
  DispatchServiceError: class DispatchServiceError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
      this.name = "DispatchServiceError";
    }
  },
}));

vi.mock("@/lib/execution/redispatch", () => ({
  redispatchTask: vi.fn(),
  RedispatchServiceError: class RedispatchServiceError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
      this.name = "RedispatchServiceError";
    }
  },
}));

const { revalidatePath } = await import("next/cache");
const { getAuthenticatedSession } = await import("@/lib/db/helpers");
const { requireProjectAccess } = await import("@/lib/workspace/permissions");
const { dispatchTask, DispatchServiceError } = await import("@/lib/execution/dispatch");
const { redispatchTask, RedispatchServiceError } = await import("@/lib/execution/redispatch");
const { dispatchTaskAction, redispatchTaskAction } = await import("./execution-actions");

const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;
const mockGetAuthenticatedSession = getAuthenticatedSession as ReturnType<typeof vi.fn>;
const mockRequireProjectAccess = requireProjectAccess as ReturnType<typeof vi.fn>;
const mockDispatchTask = dispatchTask as ReturnType<typeof vi.fn>;
const mockRedispatchTask = redispatchTask as ReturnType<typeof vi.fn>;

const validIds = {
  workspaceId: "cworkspaceid0000000000001",
  projectId: "cprojectid0000000000000001",
  taskId: "ctaskid00000000000000001",
  agentRunId: "cagentrunid0000000000001",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedSession.mockResolvedValue({
    userId: "user-1",
    role: "user",
    email: "demo@example.com",
    name: "Demo",
  });
  mockRequireProjectAccess.mockResolvedValue({
    success: true,
    data: {
      project: {
        id: validIds.projectId,
        workspaceId: validIds.workspaceId,
        name: "Demo Project",
        slug: "demo-project",
        status: "active",
      },
    },
  });
});

describe("dispatchTaskAction", () => {
  it("returns validation error for invalid input", async () => {
    const result = await dispatchTaskAction({
      workspaceId: "bad-id",
      projectId: validIds.projectId,
      taskId: validIds.taskId,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(result.error).toBe("sanitized:VALIDATION_ERROR");
    }
  });

  it("returns unauthorized when session is missing", async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const result = await dispatchTaskAction(validIds);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns selection-required payload without revalidating paths", async () => {
    mockDispatchTask.mockResolvedValue({
      taskId: validIds.taskId,
      status: "planned",
      currentStage: "等待选择",
      currentActivity: "当前工作空间要求人工指定 Agent。",
      nextStep: "请先选择 Agent。",
      routingDecision: null,
      currentAgentRun: null,
      selectionRequirement: {
        recommendedAgentType: "claude-code",
        recommendedAgentLabel: "Claude Code",
        selectionReasonCode: "manual-selection-required",
        selectionReasonSummary: "当前工作空间要求人工指定 Agent。系统已给出推荐，但不会自动派发。",
        matchedSignals: ["claude:keyword:分析"],
      },
      selectionRequired: true,
      didDispatch: false,
      planningRequestId: null,
      workspaceSlug: "demo-workspace",
      projectSlug: "demo-project",
    });

    const result = await dispatchTaskAction(validIds);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        taskId: validIds.taskId,
        status: "planned",
        currentStage: "等待选择",
        currentActivity: "当前工作空间要求人工指定 Agent。",
        nextStep: "请先选择 Agent。",
        currentAgentRunId: null,
        selectedAgentType: null,
        selectedAgentLabel: null,
        selectionReasonSummary: "当前工作空间要求人工指定 Agent。系统已给出推荐，但不会自动派发。",
        didDispatch: false,
        selectionRequired: true,
        recommendedAgentType: "claude-code",
        recommendedAgentLabel: "Claude Code",
      });
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("returns mapped payload and revalidates execution paths on success", async () => {
    mockDispatchTask.mockResolvedValue({
      taskId: validIds.taskId,
      status: "dispatched",
      currentStage: "已派发",
      currentActivity: "已完成 Agent 路由，等待执行监督器创建会话并启动。",
      nextStep: "等待执行监督器创建会话并启动。",
      routingDecision: {
        selectedAgentType: "codex",
        decisionSource: "manual-selection",
        selectionReasonCode: "manual-selection",
        selectionReasonSummary: "已按你的显式选择派发到 Codex。",
        matchedSignals: ["explicit:codex"],
        agentRunId: validIds.agentRunId,
        replacedAgentRunId: null,
        routedAt: "2026-04-14T02:00:00.000Z",
        reroutedAt: null,
      },
      currentAgentRun: {
        id: validIds.agentRunId,
        agentType: "codex",
        agentTypeLabel: "Codex",
        status: "dispatched",
        statusLabel: "已派发",
        decisionSource: "manual-selection",
        selectionReasonCode: "manual-selection",
        selectionReasonSummary: "已按你的显式选择派发到 Codex。",
        matchedSignals: ["explicit:codex"],
        requestedByUserId: "user-1",
        createdAt: "2026-04-14T02:00:00.000Z",
        startedAt: null,
        completedAt: null,
        terminatedAt: null,
        supersededAt: null,
        terminationReasonCode: null,
        terminationReasonSummary: null,
        replacesRunId: null,
        replacementRunId: null,
        isCurrent: true,
        summary: "已完成 Agent 路由，等待执行监督器创建会话并启动。",
      },
      selectionRequirement: null,
      selectionRequired: false,
      didDispatch: true,
      planningRequestId: null,
      workspaceSlug: "demo-workspace",
      projectSlug: "demo-project",
    });

    const result = await dispatchTaskAction(validIds);

    expect(result).toEqual({
      success: true,
      data: {
        taskId: validIds.taskId,
        status: "dispatched",
        currentStage: "已派发",
        currentActivity: "已完成 Agent 路由，等待执行监督器创建会话并启动。",
        nextStep: "等待执行监督器创建会话并启动。",
        currentAgentRunId: validIds.agentRunId,
        selectedAgentType: "codex",
        selectedAgentLabel: "Codex",
        selectionReasonSummary: "已按你的显式选择派发到 Codex。",
        didDispatch: true,
        selectionRequired: false,
        recommendedAgentType: null,
        recommendedAgentLabel: null,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledTimes(3);
    expect(mockRevalidatePath).toHaveBeenNthCalledWith(1, "/workspace/demo-workspace");
    expect(mockRevalidatePath).toHaveBeenNthCalledWith(2, "/workspace/demo-workspace/project/demo-project");
    expect(mockRevalidatePath).toHaveBeenNthCalledWith(3, `/workspace/demo-workspace/project/demo-project/tasks/${validIds.taskId}`);
  });

  it("maps known dispatch service errors to sanitized action errors", async () => {
    mockDispatchTask.mockRejectedValue(new DispatchServiceError("TASK_ALREADY_DISPATCHED"));

    const result = await dispatchTaskAction(validIds);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("TASK_ALREADY_DISPATCHED");
      expect(result.error).toBe("sanitized:TASK_ALREADY_DISPATCHED");
    }
  });
});

describe("redispatchTaskAction", () => {
  it("returns permission error from project guard", async () => {
    mockRequireProjectAccess.mockResolvedValue({
      success: false,
      error: "权限不足",
      code: "FORBIDDEN",
    });

    const result = await redispatchTaskAction({
      ...validIds,
      targetAgentType: "claude-code",
      expectedAgentRunId: validIds.agentRunId,
      reasonSummary: "改派到更适合分析的 Agent。",
      confirmRunningRedispatch: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
      expect(result.error).toBe("权限不足");
    }
  });

  it("returns mapped payload and revalidates on redispatch success", async () => {
    mockRedispatchTask.mockResolvedValue({
      taskId: validIds.taskId,
      status: "dispatched",
      currentStage: "已重新派发",
      currentActivity: "已重新派发，等待新会话启动。",
      nextStep: "等待新会话启动。",
      routingDecision: {
        selectedAgentType: "claude-code",
        decisionSource: "manual-reroute",
        selectionReasonCode: "manual-reroute",
        selectionReasonSummary: "当前任务更适合先做方案分析。",
        matchedSignals: ["explicit:claude-code"],
        agentRunId: "cagentrunid0000000000002",
        replacedAgentRunId: validIds.agentRunId,
        routedAt: null,
        reroutedAt: "2026-04-14T03:00:00.000Z",
      },
      currentAgentRun: {
        id: "cagentrunid0000000000002",
        agentType: "claude-code",
        agentTypeLabel: "Claude Code",
        status: "dispatched",
        statusLabel: "已派发",
        decisionSource: "manual-reroute",
        selectionReasonCode: "manual-reroute",
        selectionReasonSummary: "当前任务更适合先做方案分析。",
        matchedSignals: ["explicit:claude-code"],
        requestedByUserId: "user-1",
        createdAt: "2026-04-14T03:00:00.000Z",
        startedAt: null,
        completedAt: null,
        terminatedAt: null,
        supersededAt: null,
        terminationReasonCode: null,
        terminationReasonSummary: null,
        replacesRunId: validIds.agentRunId,
        replacementRunId: null,
        isCurrent: true,
        summary: "已重新派发，等待新会话启动。",
      },
      replacedAgentRunId: validIds.agentRunId,
      didTerminateActiveSession: true,
      planningRequestId: null,
      workspaceSlug: "demo-workspace",
      projectSlug: "demo-project",
    });

    const result = await redispatchTaskAction({
      ...validIds,
      targetAgentType: "claude-code",
      expectedAgentRunId: validIds.agentRunId,
      reasonSummary: "改派到更适合分析的 Agent。",
      confirmRunningRedispatch: true,
    });

    expect(result).toEqual({
      success: true,
      data: {
        taskId: validIds.taskId,
        status: "dispatched",
        currentStage: "已重新派发",
        currentActivity: "已重新派发，等待新会话启动。",
        nextStep: "等待新会话启动。",
        currentAgentRunId: "cagentrunid0000000000002",
        selectedAgentType: "claude-code",
        selectedAgentLabel: "Claude Code",
        selectionReasonSummary: "当前任务更适合先做方案分析。",
        didDispatch: true,
        selectionRequired: false,
        recommendedAgentType: null,
        recommendedAgentLabel: null,
        replacedAgentRunId: validIds.agentRunId,
        didTerminateActiveSession: true,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledTimes(3);
  });

  it("maps known redispatch service errors to sanitized action errors", async () => {
    mockRedispatchTask.mockRejectedValue(new RedispatchServiceError("TASK_REDISPATCH_CONFLICT"));

    const result = await redispatchTaskAction({
      ...validIds,
      targetAgentType: "claude-code",
      expectedAgentRunId: validIds.agentRunId,
      reasonSummary: "改派到更适合分析的 Agent。",
      confirmRunningRedispatch: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("TASK_REDISPATCH_CONFLICT");
      expect(result.error).toBe("sanitized:TASK_REDISPATCH_CONFLICT");
    }
  });
});
