/**
 * Unit tests for state transitioner.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { canTransition, transitionTask } from "../transitioner";
import type { TaskStatus, TransitionInput } from "../types";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../event-recorder", () => ({
  recordTaskStateEvent: vi.fn().mockResolvedValue({ id: "event-mock" }),
}));

vi.mock("../side-effects", () => ({
  triggerStateTransitionSideEffects: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@/lib/db/client";

describe("canTransition", () => {
  it("应允许有效的转换 planned → dispatched", () => {
    const result = canTransition("planned", "dispatched");
    expect(result.allowed).toBe(true);
  });

  it("应拒绝无效的转换 planned → completed", () => {
    const result = canTransition("planned", "completed");
    expect(result.allowed).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  });

  it("应拒绝终态之间的非法转换 completed → failed", () => {
    const result = canTransition("completed", "failed");
    expect(result.allowed).toBe(false);
  });

  it("应拒绝未知源状态的转换", () => {
    const result = canTransition("unknown_status" as TaskStatus, "running");
    expect(result.allowed).toBe(false);
  });

  it("应返回转换的源状态和目标状态", () => {
    const result = canTransition("planned", "dispatched");
    expect(result.fromStatus).toBe("planned");
    expect(result.toStatus).toBe("dispatched");
  });

  it("应返回合法转换的错误信息为 undefined", () => {
    const result = canTransition("planned", "dispatched");
    expect(result.errorMessage).toBeUndefined();
  });

  it("应允许 running → completed", () => {
    expect(canTransition("running", "completed").allowed).toBe(true);
  });

  it("应允许 running → failed", () => {
    expect(canTransition("running", "failed").allowed).toBe(true);
  });

  it("应允许 running → terminated", () => {
    expect(canTransition("running", "terminated").allowed).toBe(true);
  });
});

describe("transitionTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应成功执行有效的状态转换 planned → dispatched", async () => {
    const mockTask = {
      id: "task-1",
      status: "planned",
      currentStage: "已计划",
      currentActivity: "",
      nextStep: "",
      workspaceId: "ws-1",
      projectId: "proj-1",
      currentAgentRunId: null,
    };
    const mockUpdatedTask = {
      ...mockTask,
      status: "dispatched",
      currentStage: "已派发",
      currentActivity: "任务已派发，等待执行监督器启动",
      nextStep: "执行监督器正在准备启动",
    };
    const mockEvent = { id: "event-1" };

    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockTask);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (cb) => {
      const tx = {
        task: { update: vi.fn().mockResolvedValue(mockUpdatedTask) },
        taskStateEvent: { create: vi.fn().mockResolvedValue(mockEvent) },
      };
      return cb(tx);
    });

    const result = await transitionTask({
      taskId: "task-1",
      toStatus: "dispatched",
      trigger: "user_dispatch",
      reason: "用户派发任务",
      actorType: "user",
      actorId: "user-1",
    });

    expect(result.success).toBe(true);
    const ok = result as { success: true; data: { taskId: string; fromStatus: string; toStatus: string; eventId: string } };
    expect(ok.data).toBeDefined();
    expect(ok.data.taskId).toBe("task-1");
    expect(ok.data.fromStatus).toBe("planned");
    expect(ok.data.toStatus).toBe("dispatched");
    expect(ok.data.eventId).toBe("event-1");
  });

  it("任务不存在时应返回失败结果", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await transitionTask({
      taskId: "nonexistent",
      toStatus: "dispatched",
      trigger: "user_dispatch",
      reason: undefined,
      actorType: "user",
      actorId: undefined,
    });

    expect(result.success).toBe(false);
    const fail = result as { success: false; error: string; code: string };
    expect(fail.error).toContain("不存在");
    expect(fail.code).toBe("TASK_NOT_FOUND");
  });

  it("非法转换 planned → completed 应返回失败结果", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "task-1",
      status: "planned",
      workspaceId: "ws-1",
      projectId: "proj-1",
      currentAgentRunId: null,
    });

    const result = await transitionTask({
      taskId: "task-1",
      toStatus: "completed",
      trigger: "user_dispatch",
      reason: undefined,
      actorType: "user",
      actorId: undefined,
    });

    expect(result.success).toBe(false);
    const fail = result as { success: false; error: string; code: string };
    expect(fail.error).toContain("状态机拒绝");
    expect(fail.code).toBe("INVALID_TRANSITION");
  });

  it("无效输入参数应返回验证失败", async () => {
    const result = await transitionTask({
      taskId: "",
      toStatus: "dispatched",
      trigger: "user_dispatch",
    } as TransitionInput);

    expect(result.success).toBe(false);
    const fail = result as { success: false; error: string; code: string };
    expect(fail.error).toContain("输入参数无效");
    expect(fail.code).toBe("TRANSITION_FAILED");
  });

  it("应正确拒绝终态后的非法入站转换", async () => {
    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "task-1",
      status: "writeback_done",
      workspaceId: "ws-1",
      projectId: "proj-1",
      currentAgentRunId: null,
    });

    const result = await transitionTask({
      taskId: "task-1",
      toStatus: "running",
      trigger: "user_dispatch",
      reason: undefined,
      actorType: "user",
      actorId: undefined,
    });

    expect(result.success).toBe(false);
    const fail = result as { success: false; error: string; code: string };
    expect(fail.code).toBe("INVALID_TRANSITION");
  });

  it("应正确处理 running → completed 转换并记录事件", async () => {
    const mockTask = {
      id: "task-1",
      status: "running",
      workspaceId: "ws-1",
      projectId: "proj-1",
      currentAgentRunId: "run-1",
    };
    const mockUpdatedTask = { ...mockTask, status: "completed" };
    const mockEvent = { id: "event-2" };

    (prisma.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockTask);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (cb) => {
      const tx = {
        task: { update: vi.fn().mockResolvedValue(mockUpdatedTask) },
        taskStateEvent: { create: vi.fn().mockResolvedValue(mockEvent) },
      };
      return cb(tx);
    });

    const result = await transitionTask({
      taskId: "task-1",
      toStatus: "completed",
      trigger: "agent_complete",
      reason: undefined,
      actorType: "agent",
      actorId: "run-1",
    });

    expect(result.success).toBe(true);
    const ok = result as { success: true; data: { taskId: string; eventId: string } };
    expect(ok.data.taskId).toBe("task-1");
    expect(ok.data.eventId).toBe("event-2");
  });
});
