/**
 * Unit tests for heartbeat detector (confidence detection).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { getHeartbeatStatus, batchGetHeartbeatStatus } from "../detector";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    heartbeat: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/client";

const mockFindFirst = prisma.heartbeat.findFirst as ReturnType<typeof vi.fn>;

describe("心跳可信度检测", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("最近 60 秒内心跳应返回 trusted", async () => {
    const recentTime = new Date(Date.now() - 30_000);
    mockFindFirst.mockResolvedValue({
      timestamp: recentTime,
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 执行中",
    });

    const result = await getHeartbeatStatus("task-1");

    expect(result.confidence).toBe("trusted");
    expect(result.isStale).toBe(false);
    expect(result.lastHeartbeatAt).toEqual(recentTime);
  });

  it("60-120 秒内心跳应返回 stale", async () => {
    const staleTime = new Date(Date.now() - 90_000);
    mockFindFirst.mockResolvedValue({
      timestamp: staleTime,
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 执行中",
    });

    const result = await getHeartbeatStatus("task-1");

    expect(result.confidence).toBe("stale");
    expect(result.isStale).toBe(true);
  });

  it("超过 120 秒无心跳应返回 unknown", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await getHeartbeatStatus("task-1");

    expect(result.confidence).toBe("unknown");
    expect(result.isStale).toBe(true);
    expect(result.lastHeartbeatAt).toBeNull();
  });

  it("应正确返回心跳状态信息", async () => {
    const heartbeatTime = new Date(Date.now() - 20_000);
    mockFindFirst.mockResolvedValue({
      timestamp: heartbeatTime,
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 正在执行任务",
    });

    const result = await getHeartbeatStatus("task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.lastStatus).toBe("running");
    expect(result.lastStage).toBe("运行中");
    expect(result.lastActivity).toBe("Agent 正在执行任务");
    expect(result.staleDurationMs).toBeGreaterThanOrEqual(19_000);
    expect(result.staleDurationMs).toBeLessThanOrEqual(21_000);
  });

  it("应支持自定义超时阈值", async () => {
    const heartbeatTime = new Date(Date.now() - 50_000);
    mockFindFirst.mockResolvedValue({
      timestamp: heartbeatTime,
      status: "running",
      currentStage: null,
      currentActivity: null,
    });

    const result = await getHeartbeatStatus("task-1", { timeoutMs: 120_000 });

    expect(result.confidence).toBe("trusted");
    expect(result.isStale).toBe(false);
  });
});

describe("batchGetHeartbeatStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应返回任务 ID 到心跳状态的映射", async () => {
    const recentTime = new Date(Date.now() - 30_000);
    mockFindFirst.mockImplementation(async ({ where }: { where: { taskId: string } }) => {
      if (where.taskId === "task-1") {
        return {
          timestamp: recentTime,
          status: "running",
          currentStage: "运行中",
          currentActivity: null,
        };
      }
      return null;
    });

    const result = await batchGetHeartbeatStatus(["task-1", "task-2"]);

    expect(result.size).toBe(2);
    expect(result.get("task-1")?.confidence).toBe("trusted");
    expect(result.get("task-2")?.confidence).toBe("unknown");
  });
});
