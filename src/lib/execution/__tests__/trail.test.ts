/**
 * Unit tests for execution trail query (heartbeat sampling and pagination).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTaskStateHistoryPaginated, getTaskExecutionTrail } from "../../db/helpers";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    taskStateEvent: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    heartbeat: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/client";

const mockFindMany = prisma.taskStateEvent.findMany as ReturnType<typeof vi.fn>;
const mockCount = prisma.taskStateEvent.count as ReturnType<typeof vi.fn>;
const mockHeartbeatFindMany = prisma.heartbeat.findMany as ReturnType<typeof vi.fn>;
const mockHeartbeatCount = prisma.heartbeat.count as ReturnType<typeof vi.fn>;

describe("getTaskStateHistoryPaginated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应正确分页状态事件（游标分页）", async () => {
    const events = [
      { id: "e1", taskId: "task-1", agentRunId: "run-1", fromStatus: "planned", toStatus: "dispatched", trigger: "system_start", reason: null, actorType: "system", actorId: null, rejected: false, createdAt: new Date("2026-01-01T10:00:00Z") },
      { id: "e2", taskId: "task-1", agentRunId: "run-1", fromStatus: "dispatched", toStatus: "starting", trigger: "system_start", reason: null, actorType: "system", actorId: null, rejected: false, createdAt: new Date("2026-01-01T10:01:00Z") },
    ];
    mockFindMany.mockResolvedValue(events);
    mockCount.mockResolvedValue(2);

    const result = await getTaskStateHistoryPaginated("task-1", { limit: 50 });

    expect(result.events).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("应正确检测更多数据（hasMore）", async () => {
    const events = Array.from({ length: 51 }, (_, i) => ({
      id: `e${i}`,
      taskId: "task-1",
      agentRunId: "run-1",
      fromStatus: "planned",
      toStatus: "dispatched",
      trigger: "system_start",
      reason: null,
      actorType: "system",
      actorId: null,
      rejected: false,
      createdAt: new Date(Date.now() + i * 1000),
    }));
    mockFindMany.mockResolvedValue(events);
    mockCount.mockResolvedValue(100);

    const result = await getTaskStateHistoryPaginated("task-1", { limit: 50 });

    expect(result.events).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("e49");
  });

  it("应支持自定义 limit", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await getTaskStateHistoryPaginated("task-1", { limit: 10 });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 11 })
    );
  });

  it("应支持游标分页", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await getTaskStateHistoryPaginated("task-1", { cursor: "e5", limit: 10 });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "e5" }, skip: 1 })
    );
  });

  it("应支持反向查询", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await getTaskStateHistoryPaginated("task-1", { direction: "backward", limit: 10 });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });
});

describe("getTaskExecutionTrail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应合并状态事件和心跳采样并按时间排序", async () => {
    const stateEvents = [
      { id: "e1", toStatus: "dispatched", trigger: "system_start", reason: null, createdAt: new Date("2026-01-01T10:00:00Z") },
      { id: "e2", toStatus: "running", trigger: "agent_complete", reason: "started", createdAt: new Date("2026-01-01T10:01:00Z") },
    ];
    const heartbeats = [
      { id: "h1", currentActivity: "心跳活动 1", status: "running", timestamp: new Date("2026-01-01T10:00:30Z") },
      { id: "h2", currentActivity: "心跳活动 2", status: "running", timestamp: new Date("2026-01-01T10:01:30Z") },
    ];
    mockFindMany.mockResolvedValue(stateEvents);
    mockHeartbeatFindMany.mockResolvedValue(heartbeats);
    mockHeartbeatCount.mockResolvedValue(heartbeats.length);

    const result = await getTaskExecutionTrail("task-1");

    expect(result.trail).toHaveLength(4);
    expect(result.totalCount).toBe(stateEvents.length + heartbeats.length);
    // 验证按时间升序排列
    expect(result.trail[0].type).toBe("state_change");
    expect(result.trail[0].summary).toContain("dispatched");
    expect(result.trail[1].type).toBe("heartbeat");
    expect(result.trail[2].type).toBe("state_change");
    expect(result.trail[2].summary).toContain("running");
    expect(result.trail[3].type).toBe("heartbeat");
  });

  it("心跳应进行分钟级去重采样", async () => {
    const stateEvents = [
      { id: "e1", toStatus: "running", trigger: "system_start", reason: null, createdAt: new Date("2026-01-01T10:00:00Z") },
    ];
    // 同一分钟内的多条心跳（同 2026-01-01T10:05:00）
    const heartbeats = Array.from({ length: 10 }, (_, i) => ({
      id: `h${i}`,
      currentActivity: `心跳 ${i}`,
      status: "running",
      timestamp: new Date(`2026-01-01T10:05:${String(i).padStart(2, "0")}Z`),
    }));
    mockFindMany.mockResolvedValue(stateEvents);
    mockHeartbeatFindMany.mockResolvedValue(heartbeats);
    mockHeartbeatCount.mockResolvedValue(heartbeats.length);

    const result = await getTaskExecutionTrail("task-1");

    // 同一分钟只保留一条心跳（但 totalCount 用真实心跳总数）
    const heartbeatItems = result.trail.filter((t) => t.type === "heartbeat");
    expect(heartbeatItems).toHaveLength(1);
    expect(result.totalCount).toBe(stateEvents.length + heartbeats.length);
  });

  it("应在无心跳时正常返回", async () => {
    const stateEvents = [
      { id: "e1", toStatus: "completed", trigger: "agent_complete", reason: null, createdAt: new Date("2026-01-01T10:00:00Z") },
    ];
    mockFindMany.mockResolvedValue(stateEvents);
    mockHeartbeatFindMany.mockResolvedValue([]);
    mockHeartbeatCount.mockResolvedValue(0);

    const result = await getTaskExecutionTrail("task-1");

    expect(result.trail).toHaveLength(1);
    expect(result.trail[0].type).toBe("state_change");
    expect(result.totalCount).toBe(1);
  });

  it("应在无状态事件时正常返回", async () => {
    mockFindMany.mockResolvedValue([]);
    mockHeartbeatFindMany.mockResolvedValue([
      { id: "h1", currentActivity: "心跳活动", status: "running", timestamp: new Date("2026-01-01T10:00:30Z") },
    ]);
    mockHeartbeatCount.mockResolvedValue(1);

    const result = await getTaskExecutionTrail("task-1");

    expect(result.trail).toHaveLength(1);
    expect(result.trail[0].type).toBe("heartbeat");
  });
});
