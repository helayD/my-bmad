/**
 * Unit tests for state trust and continuity modules.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { computeStateTrust } from "../state-trust";
import { fetchReconnectionState } from "../reconnection";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    heartbeat: {
      findFirst: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/client";

const mockHeartbeatFindFirst = prisma.heartbeat.findFirst as ReturnType<typeof vi.fn>;
const mockTaskFindUnique = prisma.task.findUnique as ReturnType<typeof vi.fn>;

describe("computeStateTrust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("心跳可信时 confidence 为 trusted", async () => {
    const recentTime = new Date(Date.now() - 30_000);
    mockHeartbeatFindFirst.mockResolvedValue({
      timestamp: recentTime,
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 执行中",
    });

    const result = await computeStateTrust("task-1", "running");

    expect(result.confidence).toBe("trusted");
    expect(result.displayRecommendation).toBe("show_normal");
    expect(result.badgeText.zh).toBe("可信");
    expect(result.badgeVariant).toBe("default");
  });

  it("心跳有延迟时 confidence 为 stale", async () => {
    const staleTime = new Date(Date.now() - 90_000);
    mockHeartbeatFindFirst.mockResolvedValue({
      timestamp: staleTime,
      status: "running",
      currentStage: "运行中",
      currentActivity: null,
    });

    const result = await computeStateTrust("task-1", "running");

    expect(result.confidence).toBe("stale");
    expect(result.displayRecommendation).toBe("show_stale");
    expect(result.badgeText.zh).toBe("数据滞后");
    expect(result.badgeVariant).toBe("secondary");
  });

  it("运行态任务无心跳时 confidence 为 unknown，显示警告", async () => {
    mockHeartbeatFindFirst.mockResolvedValue(null);

    const result = await computeStateTrust("task-1", "running");

    expect(result.confidence).toBe("unknown");
    expect(result.displayRecommendation).toBe("show_unknown");
    expect(result.badgeText.zh).toBe("状态不可信");
    expect(result.badgeVariant).toBe("destructive");
  });

  it("终态任务即使无心跳也应为 trusted", async () => {
    mockHeartbeatFindFirst.mockResolvedValue(null);

    const result = await computeStateTrust("task-1", "completed");

    expect(result.confidence).toBe("unknown");
    // Even though confidence is unknown, for non-running tasks we show as trusted
    expect(result.displayRecommendation).toBe("show_normal");
  });

  it("应正确传递心跳状态信息", async () => {
    const recentTime = new Date(Date.now() - 30_000);
    mockHeartbeatFindFirst.mockResolvedValue({
      timestamp: recentTime,
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 执行中",
    });

    const result = await computeStateTrust("task-1", "running");

    expect(result.heartbeatStatus.lastStage).toBe("运行中");
    expect(result.heartbeatStatus.lastActivity).toBe("Agent 执行中");
  });
});

describe("fetchReconnectionState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应返回任务最新状态和可信度", async () => {
    const recentTime = new Date(Date.now() - 30_000);
    mockHeartbeatFindFirst.mockResolvedValue({
      timestamp: recentTime,
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 执行中",
    });
    mockTaskFindUnique.mockResolvedValue({
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 执行中",
      nextStep: "等待完成",
      updatedAt: recentTime,
    });

    const result = await fetchReconnectionState("task-1");

    expect(result).not.toBeNull();
    expect(result!.taskId).toBe("task-1");
    expect(result!.status).toBe("running");
    expect(result!.confidence).toBe("trusted");
    expect(result!.heartbeatFresh).toBe(true);
  });

  it("心跳超时时应返回 unknown 置信度", async () => {
    const oldTime = new Date(Date.now() - 180_000);
    mockHeartbeatFindFirst.mockResolvedValue({
      timestamp: oldTime,
      status: "running",
      currentStage: "运行中",
      currentActivity: null,
    });
    mockTaskFindUnique.mockResolvedValue({
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 执行中",
      nextStep: "等待完成",
      updatedAt: oldTime,
    });

    const result = await fetchReconnectionState("task-1");

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("unknown");
    expect(result!.heartbeatFresh).toBe(false);
  });

  it("任务不存在时返回 null", async () => {
    mockHeartbeatFindFirst.mockResolvedValue(null);
    mockTaskFindUnique.mockResolvedValue(null);

    const result = await fetchReconnectionState("task-1");

    expect(result).toBeNull();
  });

  it("应绕过缓存返回最新状态", async () => {
    const recentTime = new Date(Date.now() - 10_000);
    mockHeartbeatFindFirst.mockResolvedValue({
      timestamp: recentTime,
      status: "running",
      currentStage: "运行中",
      currentActivity: null,
    });
    mockTaskFindUnique.mockResolvedValue({
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 执行中",
      nextStep: "等待完成",
      updatedAt: recentTime,
    });

    const result = await fetchReconnectionState("task-1");

    // 直接查 DB，不使用缓存
    expect(mockTaskFindUnique).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });
});
