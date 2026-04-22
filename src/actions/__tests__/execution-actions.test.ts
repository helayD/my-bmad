/**
 * Unit tests for submitSupplementaryInput Server Action (Story 5.4 — FR27).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { submitSupplementaryInput } from "../execution-actions";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    executionSession: { findUnique: vi.fn() },
    interactionRequest: { updateMany: vi.fn() },
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

import { prisma } from "@/lib/db/client";
import { sendKeys } from "@/lib/execution/tmux";
import { transitionTask } from "@/lib/execution/state-machine";
import { getScheduler } from "@/lib/execution/heartbeat";
import { requireProjectAccess } from "@/lib/workspace/permissions";
import { getAuthenticatedSession } from "@/lib/db/helpers";

const mockTaskFindUnique = prisma.task.findUnique as ReturnType<typeof vi.fn>;
const mockSessionFindUnique = prisma.executionSession.findUnique as ReturnType<typeof vi.fn>;
const mockInteractionUpdate = prisma.interactionRequest.updateMany as ReturnType<typeof vi.fn>;
const mockAuditCreate = prisma.auditEvent.create as ReturnType<typeof vi.fn>;
const mockSendKeys = sendKeys as ReturnType<typeof vi.fn>;
const mockTransitionTask = transitionTask as ReturnType<typeof vi.fn>;
const mockGetScheduler = getScheduler as ReturnType<typeof vi.fn>;
const mockRequireProjectAccess = requireProjectAccess as ReturnType<typeof vi.fn>;
const mockGetAuthenticatedSession = getAuthenticatedSession as ReturnType<typeof vi.fn>;

describe("submitSupplementaryInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransitionTask.mockResolvedValue({ success: true });
    mockInteractionUpdate.mockResolvedValue({ count: 1 } as never);
    mockAuditCreate.mockResolvedValue({ id: "audit-1" } as never);
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
    expect(mockInteractionUpdate).toHaveBeenCalledWith({
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
