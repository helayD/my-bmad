/**
 * Unit tests for heartbeat recorder.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { recordHeartbeat } from "../recorder";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    heartbeat: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/client";

const mockCreate = prisma.heartbeat.create as ReturnType<typeof vi.fn>;

describe("心跳记录器", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "hb-mock-id" });
  });

  it("应创建心跳记录并返回 id", async () => {
    const result = await recordHeartbeat({
      executionSessionId: "session-1",
      taskId: "task-1",
      agentRunId: "run-1",
      status: "running",
      currentStage: "运行中",
      currentActivity: "Agent 正在执行",
    });

    expect(result).toEqual({ id: "hb-mock-id" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        executionSessionId: "session-1",
        taskId: "task-1",
        agentRunId: "run-1",
        status: "running",
        currentStage: "运行中",
        currentActivity: "Agent 正在执行",
        lastOutputHash: null,
        pid: null,
        metadata: {},
      },
    });
  });

  it("应正确处理可选字段缺失", async () => {
    await recordHeartbeat({
      executionSessionId: "session-1",
      taskId: "task-1",
      agentRunId: "run-1",
      status: "running",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        executionSessionId: "session-1",
        taskId: "task-1",
        agentRunId: "run-1",
        status: "running",
        currentStage: null,
        currentActivity: null,
        lastOutputHash: null,
        pid: null,
        metadata: {},
      }),
    });
  });

  it("应正确处理 pid 和 metadata 字段", async () => {
    await recordHeartbeat({
      executionSessionId: "session-1",
      taskId: "task-1",
      agentRunId: "run-1",
      status: "running",
      pid: 12345,
      metadata: { hostname: "test-host" },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pid: 12345,
        metadata: { hostname: "test-host" },
      }),
    });
  });

  it("应正确处理 lastOutputHash 字段", async () => {
    await recordHeartbeat({
      executionSessionId: "session-1",
      taskId: "task-1",
      agentRunId: "run-1",
      status: "running",
      lastOutputHash: "abc123def456",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lastOutputHash: "abc123def456",
      }),
    });
  });
});
