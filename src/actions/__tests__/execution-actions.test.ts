/**
 * Unit tests for submitSupplementaryInput Server Action (Story 5.4 — FR27).
 * Unit tests for respondToInteractionRequest Server Action (Story 5.5 — FR28).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { submitSupplementaryInput, respondToInteractionRequest } from "../execution-actions";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    executionSession: { findUnique: vi.fn() },
    interactionRequest: { updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/execution/state-machine", () => ({
  transitionTask: vi.fn(),
}));

vi.mock("@/lib/execution/tmux", () => ({
  sendKeys: vi.fn(),
}));

vi.mock("@/lib/execution/heartbeat", () => ({
  getScheduler: vi.fn(() => ({
    recordWithSnapshot: vi.fn(),
  })),
}));

vi.mock("@/lib/workspace/permissions", () => ({
  requireProjectAccess: vi.fn(() => ({ success: true })),
}));

vi.mock("@/lib/db/helpers", () => ({
  getAuthenticatedSession: vi.fn(() => ({ userId: "user-1" })),
}));

vi.mock("@/lib/execution/monitor/sse-broadcaster", () => ({
  sseBroadcaster: {
    broadcast: vi.fn(),
  },
}));

import { prisma } from "@/lib/db/client";
import { sendKeys } from "@/lib/execution/tmux";
import { transitionTask } from "@/lib/execution/state-machine";
import { getScheduler } from "@/lib/execution/heartbeat";
import { requireProjectAccess } from "@/lib/workspace/permissions";
import { getAuthenticatedSession } from "@/lib/db/helpers";
import { sseBroadcaster } from "@/lib/execution/monitor/sse-broadcaster";

const mockTaskFindUnique = prisma.task.findUnique as ReturnType<typeof vi.fn>;
const mockSessionFindUnique = prisma.executionSession.findUnique as ReturnType<typeof vi.fn>;
const mockInteractionUpdateMany = prisma.interactionRequest.updateMany as ReturnType<typeof vi.fn>;
const mockInteractionUpdate = prisma.interactionRequest.update as ReturnType<typeof vi.fn>;
const mockInteractionFindUnique = prisma.interactionRequest.findUnique as ReturnType<typeof vi.fn>;
const mockAuditCreate = prisma.auditEvent.create as ReturnType<typeof vi.fn>;
const mockSendKeys = sendKeys as ReturnType<typeof vi.fn>;
const mockTransitionTask = transitionTask as ReturnType<typeof vi.fn>;
const mockGetScheduler = getScheduler as ReturnType<typeof vi.fn>;
const mockRequireProjectAccess = requireProjectAccess as ReturnType<typeof vi.fn>;
const mockGetAuthenticatedSession = getAuthenticatedSession as ReturnType<typeof vi.fn>;
const mockBroadcast = sseBroadcaster.broadcast as ReturnType<typeof vi.fn>;

describe("submitSupplementaryInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransitionTask.mockResolvedValue({ success: true });
    mockInteractionUpdateMany.mockResolvedValue({ count: 1 } as never);
    mockAuditCreate.mockResolvedValue({ id: "audit-1" } as never);
    mockBroadcast.mockClear();
  });

  it("应向 RUNNING 任务发送补充指令", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "running",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockResolvedValueOnce(undefined);

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "请继续执行下一步",
      inputType: "supplementary",
    });

    expect(result.success).toBe(true);
    expect(result.data?.delivered).toBe(true);
    expect(mockSendKeys).toHaveBeenCalledWith({
      sessionName: "bmad-task-1-run-1",
      content: "请继续执行下一步",
      addNewline: true,
    });
    expect(mockAuditCreate).toHaveBeenCalled();
    // 状态是 running，不应触发状态变更
    expect(mockTransitionTask).not.toHaveBeenCalled();
  });

  it("应向 WAITING_FOR_INPUT 任务发送并触发状态变更", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockResolvedValueOnce(undefined);
    const mockScheduler = { recordWithSnapshot: vi.fn() };
    mockGetScheduler.mockReturnValueOnce(mockScheduler);

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "确认继续",
      inputType: "confirmation",
    });

    expect(result.success).toBe(true);
    expect(mockSendKeys).toHaveBeenCalled();
    expect(mockTransitionTask).toHaveBeenCalledWith({
      taskId: "task-1",
      toStatus: "running",
      trigger: "user_response",
      actorType: "user",
      reason: "用户响应了 Agent 请求",
    });
    expect(mockScheduler.recordWithSnapshot).toHaveBeenCalledWith({
      status: "running",
      currentStage: "运行中",
      currentActivity: "等待 Agent 响应补充指令……",
    });
  });

  it("应同时更新关联的 InteractionRequest", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "running",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockResolvedValueOnce(undefined);

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "确认",
      inputType: "confirmation",
      interactionRequestId: "ir-1",
    });

    expect(result.success).toBe(true);
    expect(mockInteractionUpdateMany).toHaveBeenCalledWith({
      where: { id: "ir-1", taskId: "task-1" },
      data: {
        status: "responded",
        response: "确认",
        respondedAt: expect.any(Date),
      },
    });
  });

  it("任务不在允许状态时应拒绝", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "completed",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_TASK_STATUS");
    expect(mockSendKeys).not.toHaveBeenCalled();
  });

  it("Agent Run ID 不匹配时应拒绝", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "running",
      currentAgentRunId: "run-old",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-new",
      content: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("RUN_MISMATCH");
  });

  it("session 不存在时应返回错误", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "running",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockSessionFindUnique.mockResolvedValueOnce(null);

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("SESSION_NOT_FOUND");
  });

  it("session 已结束时应返回错误", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "running",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "completed",
    });

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("SESSION_ENDED");
  });

  it("发送失败时应返回错误", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "running",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockRejectedValueOnce(new Error("tmux error"));

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("TMUX_SEND_FAILED");
  });

  it("空内容应通过 Zod 验证拒绝", async () => {
    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "",
    } as never);

    expect(result.success).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("超长内容应通过 Zod 验证拒绝", async () => {
    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "x".repeat(10_001),
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("纯空白内容应通过 Zod 验证拒绝", async () => {
    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "   ",
    } as never);

    expect(result.success).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("纯换行内容应通过 Zod 验证拒绝", async () => {
    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "\n\n",
    } as never);

    expect(result.success).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("未登录用户应返回 UNAUTHORIZED", async () => {
    mockGetAuthenticatedSession.mockResolvedValueOnce(null);

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("UNAUTHORIZED");
    expect(mockSendKeys).not.toHaveBeenCalled();
  });

  it("无执行权限用户应被拒绝", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "running",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockRequireProjectAccess.mockResolvedValueOnce({
      success: false,
      error: "无权执行此操作",
    });

    const result = await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBeUndefined(); // requireProjectAccess 返回的 code 字段
    expect(mockSendKeys).not.toHaveBeenCalled();
  });

  it("transitionTask 失败时审计日志应记录真实状态", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockResolvedValueOnce(undefined);
    mockTransitionTask.mockResolvedValueOnce({ success: false, error: "状态冲突" });
    const mockScheduler = { recordWithSnapshot: vi.fn() };
    mockGetScheduler.mockReturnValueOnce(mockScheduler);

    await submitSupplementaryInput({
      taskId: "task-1",
      agentRunId: "run-1",
      content: "confirm",
      inputType: "confirmation",
    });

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          taskStatusBefore: "waiting_for_input",
          // 失败时保持原状态，不应变为 running
          taskStatusAfter: "waiting_for_input",
        }),
      }),
    });
    // transitionTask 失败时 scheduler 应收到原状态
    expect(mockScheduler.recordWithSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ status: "waiting_for_input" }),
    );
  });
});

// ── respondToInteractionRequest Tests (Story 5.5 — FR28) ────────────────────────

describe("respondToInteractionRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransitionTask.mockResolvedValue({ success: true });
    mockAuditCreate.mockResolvedValue({ id: "audit-1" } as never);
    mockBroadcast.mockClear();
  });

  it("应批准 pending 状态的交互请求并发送到 tmux", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce({
      id: "ir-1",
      status: "pending",
      taskId: "task-1",
      agentRunId: "run-1",
      title: "确认请求",
      content: "y",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockResolvedValueOnce(undefined);
    mockInteractionUpdate.mockResolvedValueOnce({ id: "ir-1" } as never);
    const mockScheduler = { recordWithSnapshot: vi.fn() };
    mockGetScheduler.mockReturnValueOnce(mockScheduler);

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "approve",
      responseContent: "yes",
    });

    expect(result.success).toBe(true);
    expect(result.data?.responseType).toBe("approve");
    expect(result.data?.delivered).toBe(true);
    expect(mockSendKeys).toHaveBeenCalledWith({
      sessionName: "bmad-task-1-run-1",
      content: "yes",
      addNewline: true,
    });
    expect(mockInteractionUpdate).toHaveBeenCalledWith({
      where: { id: "ir-1" },
      data: {
        status: "responded",
        response: "yes",
        respondedAt: expect.any(Date),
        respondedBy: "user-1",
      },
    });
    expect(mockTransitionTask).toHaveBeenCalledWith({
      taskId: "task-1",
      toStatus: "running",
      trigger: "user_response",
      actorType: "user",
      actorId: "user-1",
      reason: "用户批准了 Agent 请求",
    });
    expect(mockBroadcast).toHaveBeenCalledWith("task-1", {
      type: "interaction_response",
      data: expect.objectContaining({
        requestId: "ir-1",
        taskId: "task-1",
        responseType: "approve",
        delivered: true,
      }),
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventName: "interaction_response.approve",
        payload: expect.objectContaining({
          interactionRequestId: "ir-1",
          responseType: "approve",
        }),
      }),
    });
  });

  it("应驳回 pending 状态的交互请求", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce({
      id: "ir-1",
      status: "pending",
      taskId: "task-1",
      agentRunId: "run-1",
      title: "确认请求",
      content: "y",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockResolvedValueOnce(undefined);
    mockInteractionUpdate.mockResolvedValueOnce({ id: "ir-1" } as never);
    const mockScheduler = { recordWithSnapshot: vi.fn() };
    mockGetScheduler.mockReturnValueOnce(mockScheduler);

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "reject",
      rejectionReason: "不应该删除",
    });

    expect(result.success).toBe(true);
    expect(result.data?.responseType).toBe("reject");
    expect(mockSendKeys).toHaveBeenCalledWith({
      sessionName: "bmad-task-1-run-1",
      content: "不应该删除",
      addNewline: true,
    });
    expect(mockInteractionUpdate).toHaveBeenCalledWith({
      where: { id: "ir-1" },
      data: expect.objectContaining({ status: "responded" }),
    });
  });

  it("应拒绝处理非 pending 状态的交互请求", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce({
      id: "ir-1",
      status: "responded",
      taskId: "task-1",
      agentRunId: "run-1",
      title: "确认请求",
      content: "y",
    });

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "approve",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_INTERACTION_STATUS");
    expect(result.error).toContain("responded");
  });

  it("应拒绝处理不存在的交互请求", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce(null);

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-nonexistent",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "approve",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INTERACTION_REQUEST_NOT_FOUND");
  });

  it("应拒绝与 taskId 不匹配的交互请求", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce({
      id: "ir-1",
      status: "pending",
      taskId: "task-2",
      agentRunId: "run-1",
      title: "确认请求",
      content: "y",
    });

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "approve",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INTERACTION_REQUEST_MISMATCH");
  });

  it("应处理 delegate 响应类型", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce({
      id: "ir-1",
      status: "pending",
      taskId: "task-1",
      agentRunId: "run-1",
      title: "确认请求",
      content: "y",
    });
    mockInteractionUpdate.mockResolvedValueOnce({ id: "ir-1" } as never);

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "delegate",
      delegateTo: "user-2",
    });

    expect(result.success).toBe(true);
    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(mockInteractionUpdate).toHaveBeenCalledWith({
      where: { id: "ir-1" },
      data: expect.objectContaining({ status: "delegated" }),
    });
  });

  it("应处理 manual_takeover 响应类型", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce({
      id: "ir-1",
      status: "pending",
      taskId: "task-1",
      agentRunId: "run-1",
      title: "确认请求",
      content: "y",
    });
    mockInteractionUpdate.mockResolvedValueOnce({ id: "ir-1" } as never);

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "manual_takeover",
    });

    expect(result.success).toBe(true);
    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(mockInteractionUpdate).toHaveBeenCalledWith({
      where: { id: "ir-1" },
      data: expect.objectContaining({ status: "takeover_pending" }),
    });
  });

  it("驳回时无拒绝原因应返回错误", async () => {
    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "reject",
      // 无 responseContent 也无 rejectionReason
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("REJECTION_REASON_REQUIRED");
    expect(result.error).toBe("驳回时必须提供拒绝原因");
  });

  it("sendKeys 失败时应返回错误", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce({
      id: "ir-1",
      status: "pending",
      taskId: "task-1",
      agentRunId: "run-1",
      title: "确认请求",
      content: "y",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockRejectedValueOnce(new Error("tmux connection failed"));

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "approve",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("TMUX_SEND_FAILED");
  });

  it("应记录审计事件", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce({
      id: "ir-1",
      status: "pending",
      taskId: "task-1",
      agentRunId: "run-1",
      title: "确认请求",
      content: "y",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockResolvedValueOnce(undefined);
    mockInteractionUpdate.mockResolvedValueOnce({ id: "ir-1" } as never);
    const mockScheduler = { recordWithSnapshot: vi.fn() };
    mockGetScheduler.mockReturnValueOnce(mockScheduler);

    await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "approve",
      responseContent: "yes please",
    });

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventName: "interaction_response.approve",
        payload: expect.objectContaining({
          interactionRequestId: "ir-1",
          agentRunId: "run-1",
          responseType: "approve",
          responseContent: "yes please",
        }),
      }),
    });
  });

  it("任务状态为 running（非 waiting_for_input）时不应触发状态变更", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "running",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockInteractionFindUnique.mockResolvedValueOnce({
      id: "ir-1",
      status: "pending",
      taskId: "task-1",
      agentRunId: "run-1",
      title: "确认请求",
      content: "y",
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: "sess-1",
      sessionName: "bmad-task-1-run-1",
      status: "running",
    });
    mockSendKeys.mockResolvedValueOnce(undefined);
    mockInteractionUpdate.mockResolvedValueOnce({ id: "ir-1" } as never);

    await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "approve",
    });

    expect(mockTransitionTask).not.toHaveBeenCalled();
    expect(mockGetScheduler).not.toHaveBeenCalled();
  });

  it("未登录用户应返回 UNAUTHORIZED", async () => {
    mockGetAuthenticatedSession.mockResolvedValueOnce(null);

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "approve",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("UNAUTHORIZED");
  });

  it("无执行权限用户应被拒绝", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: "task-1",
      status: "waiting_for_input",
      currentAgentRunId: "run-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    mockRequireProjectAccess.mockResolvedValueOnce({
      success: false,
      error: "无权执行此操作",
    });

    const result = await respondToInteractionRequest({
      interactionRequestId: "ir-1",
      taskId: "task-1",
      agentRunId: "run-1",
      responseType: "approve",
    });

    expect(result.success).toBe(false);
    expect(mockSendKeys).not.toHaveBeenCalled();
  });
});
