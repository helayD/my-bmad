/**
 * Unit tests for interaction-detector.ts (Story 5.3 — FR26) and
 * timeout detection functions (Story 5.5 — AC-3).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkInteractionTimeout, checkAllPendingInteractions } from "../interaction-detector";

// Mock dependencies before any import of the module under test
vi.mock("@/lib/db/client", () => ({
  prisma: {
    interactionRequest: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/execution/state-machine", () => ({
  transitionTask: vi.fn(),
}));

vi.mock("@/lib/execution/monitor/sse-broadcaster", () => ({
  sseBroadcaster: {
    broadcast: vi.fn(),
    _resetForTesting: vi.fn(),
  },
}));

vi.mock("../timeout-scheduler", () => ({
  scheduleTimeoutCheck: vi.fn(),
  cancelTimeoutCheck: vi.fn(),
  _resetForTesting: vi.fn(),
  getActiveTimeoutCheckCount: vi.fn(),
}));

// ── Original Story 5.3 Tests ────────────────────────────────────────────────────

describe("交互请求检测", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应创建 InteractionRequest 记录并触发状态变更", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { transitionTask } = await import("@/lib/execution/state-machine");
    const { prisma } = await import("@/lib/db/client");
    const { detectAndRecordInteraction } = await import("../interaction-detector");

    sseBroadcaster._resetForTesting();
    vi.mocked(prisma.interactionRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.interactionRequest.create).mockResolvedValue({
      id: "req-123",
    } as never);
    vi.mocked(transitionTask).mockResolvedValue({ success: true } as never);

    const result = await detectAndRecordInteraction({
      taskId: "task-1",
      agentRunId: "run-1",
      rawLine: "Should I proceed?",
      summary: "Agent 请求用户输入",
      detail: "需要确认是否继续",
      confidence: "high",
    });

    expect(result.created).toBe(true);
    expect(result.requestId).toBe("req-123");
    expect(prisma.interactionRequest.create).toHaveBeenCalledWith({
      data: {
        taskId: "task-1",
        agentRunId: "run-1",
        type: "input_required",
        title: "Agent 请求用户输入",
        content: "Should I proceed?",
        context: { detail: "需要确认是否继续" },
        confidence: "high",
        status: "pending",
      },
    });
    expect(transitionTask).toHaveBeenCalledWith({
      taskId: "task-1",
      toStatus: "waiting_for_input",
      trigger: "agent_request_input",
      actorType: "agent",
      reason: "Agent 请求用户输入: Agent 请求用户输入",
    });
  });

  it("应对重复请求去重", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { transitionTask } = await import("@/lib/execution/state-machine");
    const { prisma } = await import("@/lib/db/client");
    const { detectAndRecordInteraction } = await import("../interaction-detector");

    sseBroadcaster._resetForTesting();
    vi.mocked(prisma.interactionRequest.findFirst).mockResolvedValue({
      id: "existing-req",
      content: "Should I proceed?",
    } as never);

    const result = await detectAndRecordInteraction({
      taskId: "task-1",
      agentRunId: "run-1",
      rawLine: "Should I proceed?",
      summary: "Agent 请求用户输入",
      confidence: "high",
    });

    expect(result.created).toBe(false);
    expect(result.requestId).toBeUndefined();
    expect(prisma.interactionRequest.create).not.toHaveBeenCalled();
    expect(transitionTask).not.toHaveBeenCalled();
  });

  it("检测逻辑应取 rawLine 前 100 字符用于去重匹配", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { prisma } = await import("@/lib/db/client");
    const { detectAndRecordInteraction } = await import("../interaction-detector");

    sseBroadcaster._resetForTesting();
    vi.mocked(prisma.interactionRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.interactionRequest.create).mockResolvedValue({
      id: "req-123",
    } as never);

    const longLine = "Should I proceed with this very long request? " + "x".repeat(100);
    await detectAndRecordInteraction({
      taskId: "task-1",
      agentRunId: "run-1",
      rawLine: longLine,
      summary: "Agent 请求用户输入",
      confidence: "high",
    });

    expect(prisma.interactionRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          content: { contains: longLine.substring(0, 100) },
        }),
      })
    );
  });

  it("transitionTask 失败时不应阻止函数执行（广播逻辑不受 transitionTask 结果影响）", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { transitionTask } = await import("@/lib/execution/state-machine");
    const { prisma } = await import("@/lib/db/client");
    const { detectAndRecordInteraction } = await import("../interaction-detector");

    sseBroadcaster._resetForTesting();
    vi.mocked(prisma.interactionRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.interactionRequest.create).mockResolvedValue({
      id: "req-123",
    } as never);
    vi.mocked(transitionTask).mockResolvedValue({
      success: false,
      error: "invalid transition",
    } as never);

    await expect(
      detectAndRecordInteraction({
        taskId: "task-1",
        agentRunId: "run-1",
        rawLine: "Continue?",
        summary: "Agent 请求用户输入",
        confidence: "high",
      })
    ).resolves.toMatchObject({ created: true, requestId: "req-123" });
  });

  it("应正确传递所有参数", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { prisma } = await import("@/lib/db/client");
    const { detectAndRecordInteraction } = await import("../interaction-detector");

    sseBroadcaster._resetForTesting();
    vi.mocked(prisma.interactionRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.interactionRequest.create).mockResolvedValue({
      id: "req-new",
    } as never);

    await detectAndRecordInteraction({
      taskId: "task-abc",
      agentRunId: "run-xyz",
      rawLine: "Do you want to continue?",
      summary: "确认请求",
      detail: "Agent 需要确认执行策略",
      confidence: "medium",
    });

    expect(prisma.interactionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task-abc",
        agentRunId: "run-xyz",
        type: "input_required",
        title: "确认请求",
        content: "Do you want to continue?",
        context: { detail: "Agent 需要确认执行策略" },
        confidence: "medium",
        status: "pending",
      }),
    });
  });

  it("无 detail 时 context 应为 undefined", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { prisma } = await import("@/lib/db/client");
    const { detectAndRecordInteraction } = await import("../interaction-detector");

    sseBroadcaster._resetForTesting();
    vi.mocked(prisma.interactionRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.interactionRequest.create).mockResolvedValue({
      id: "req-new",
    } as never);

    await detectAndRecordInteraction({
      taskId: "task-1",
      agentRunId: "run-1",
      rawLine: "?",
      summary: "请求输入",
      confidence: "low",
    });

    expect(prisma.interactionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        context: undefined,
      }),
    });
  });

  it("去重检查应包含 taskId 和时间窗口", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { prisma } = await import("@/lib/db/client");
    const { detectAndRecordInteraction } = await import("../interaction-detector");

    sseBroadcaster._resetForTesting();
    vi.mocked(prisma.interactionRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.interactionRequest.create).mockResolvedValue({
      id: "req-new",
    } as never);

    await detectAndRecordInteraction({
      taskId: "task-specific",
      agentRunId: "run-1",
      rawLine: "Confirm?",
      summary: "确认",
      confidence: "high",
    });

    expect(prisma.interactionRequest.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        taskId: "task-specific",
        createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        content: { contains: "Confirm?" },
      }),
    });
  });
});

// ── Timeout Detection Tests (Story 5.5 — AC-3) ────────────────────────────────────

describe("交互请求超时检测", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  it("应标记超时的 pending 请求为 expired", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { prisma } = await import("@/lib/db/client");
    const { transitionTask } = await import("@/lib/execution/state-machine");

    sseBroadcaster._resetForTesting();

    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    vi.mocked(prisma.interactionRequest.findUnique).mockResolvedValue({
      id: "req-expired",
      taskId: "task-1",
      status: "pending",
      createdAt: oldDate,
      title: "超时请求",
    } as never);
    vi.mocked(prisma.interactionRequest.update).mockResolvedValue({ id: "req-expired" } as never);
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
    } as never);
    vi.mocked(transitionTask).mockResolvedValue({ success: true } as never);

    const result = await checkInteractionTimeout("req-expired", { timeoutMs: 5 * 60 * 1000 });

    expect(result.expired).toBe(true);
    expect(result.wasExpired).toBe(true);
    expect(prisma.interactionRequest.update).toHaveBeenCalledWith({
      where: { id: "req-expired" },
      data: { status: "expired" },
    });
    expect(transitionTask).toHaveBeenCalledWith({
      taskId: "task-1",
      toStatus: "running",
      trigger: "user_response",
      actorType: "system",
      reason: expect.stringContaining("超时"),
    });
    expect(sseBroadcaster.broadcast).toHaveBeenCalledWith("task-1", {
      type: "interaction_timeout",
      data: expect.objectContaining({
        requestId: "req-expired",
        taskId: "task-1",
      }),
    });
  });

  it("不应标记未超时的 pending 请求", async () => {
    const { prisma } = await import("@/lib/db/client");

    const recentDate = new Date(Date.now() - 60_000);
    vi.mocked(prisma.interactionRequest.findUnique).mockResolvedValue({
      id: "req-recent",
      taskId: "task-1",
      status: "pending",
      createdAt: recentDate,
      title: "最近请求",
    } as never);

    const result = await checkInteractionTimeout("req-recent", { timeoutMs: 5 * 60 * 1000 });

    expect(result.expired).toBe(false);
    expect(result.wasExpired).toBe(false);
    expect(prisma.interactionRequest.update).not.toHaveBeenCalled();
  });

  it("不应重复标记已 expired 的请求", async () => {
    const { prisma } = await import("@/lib/db/client");

    vi.mocked(prisma.interactionRequest.findUnique).mockResolvedValue({
      id: "req-already-expired",
      taskId: "task-1",
      status: "expired",
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      title: "已过期",
    } as never);

    const result = await checkInteractionTimeout("req-already-expired", { timeoutMs: 5 * 60 * 1000 });

    expect(result.expired).toBe(false);
    expect(result.wasExpired).toBe(false);
    expect(prisma.interactionRequest.update).not.toHaveBeenCalled();
  });

  it("超时后应触发任务状态回转", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { prisma } = await import("@/lib/db/client");
    const { transitionTask } = await import("@/lib/execution/state-machine");

    sseBroadcaster._resetForTesting();

    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    vi.mocked(prisma.interactionRequest.findUnique).mockResolvedValue({
      id: "req-timeout",
      taskId: "task-1",
      status: "pending",
      createdAt: oldDate,
      title: "超时确认",
    } as never);
    vi.mocked(prisma.interactionRequest.update).mockResolvedValue({ id: "req-timeout" } as never);
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
    } as never);
    vi.mocked(transitionTask).mockResolvedValue({ success: true } as never);

    await checkInteractionTimeout("req-timeout", { timeoutMs: 5 * 60 * 1000 });

    expect(transitionTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        toStatus: "running",
        trigger: "user_response",
        actorType: "system",
      }),
    );
  });

  it("checkAllPendingInteractions 应批量检测超时", async () => {
    const { prisma } = await import("@/lib/db/client");
    const { transitionTask } = await import("@/lib/execution/state-machine");

    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    vi.mocked(prisma.interactionRequest.findMany).mockResolvedValue([
      { id: "req-old-1" },
      { id: "req-old-2" },
    ] as never);

    // 第一个超时检查：req-old-1 超时
    vi.mocked(prisma.interactionRequest.findUnique)
      .mockResolvedValueOnce({
        id: "req-old-1",
        taskId: "task-1",
        status: "pending",
        createdAt: oldDate,
        title: "超时1",
      } as never)
      .mockResolvedValueOnce({
        id: "req-old-1",
        taskId: "task-1",
        status: "pending",
        createdAt: oldDate,
        title: "超时1",
      } as never);
    vi.mocked(prisma.interactionRequest.update).mockResolvedValueOnce({ id: "req-old-1" } as never);
    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
    } as never);
    vi.mocked(transitionTask).mockResolvedValue({ success: true } as never);

    // 第二个超时检查：req-old-2 超时
    vi.mocked(prisma.interactionRequest.findUnique)
      .mockResolvedValueOnce({
        id: "req-old-2",
        taskId: "task-2",
        status: "pending",
        createdAt: oldDate,
        title: "超时2",
      } as never)
      .mockResolvedValueOnce({
        id: "req-old-2",
        taskId: "task-2",
        status: "pending",
        createdAt: oldDate,
        title: "超时2",
      } as never);
    vi.mocked(prisma.interactionRequest.update).mockResolvedValueOnce({ id: "req-old-2" } as never);
    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce({
      id: "task-2",
      status: "waiting_for_input",
      currentAgentRunId: "run-2",
    } as never);

    const expiredCount = await checkAllPendingInteractions({ timeoutMs: 5 * 60 * 1000 });

    expect(expiredCount).toBeGreaterThanOrEqual(1);
  });

  it("checkInteractionTimeout 不应处理已响应的请求", async () => {
    const { sseBroadcaster } = await import("@/lib/execution/monitor/sse-broadcaster");
    const { prisma } = await import("@/lib/db/client");

    sseBroadcaster._resetForTesting();

    vi.mocked(prisma.interactionRequest.findUnique).mockResolvedValue({
      id: "req-responded",
      taskId: "task-1",
      status: "responded",
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      title: "已响应",
    } as never);

    const result = await checkInteractionTimeout("req-responded", { timeoutMs: 5 * 60 * 1000 });

    expect(result.expired).toBe(false);
    expect(result.wasExpired).toBe(false);
    expect(sseBroadcaster.broadcast).not.toHaveBeenCalled();
  });

  it("不存在的请求应返回未过期", async () => {
    const { prisma } = await import("@/lib/db/client");

    vi.mocked(prisma.interactionRequest.findUnique).mockResolvedValue(null);

    const result = await checkInteractionTimeout("req-nonexistent");

    expect(result.expired).toBe(false);
    expect(result.wasExpired).toBe(false);
  });
});
