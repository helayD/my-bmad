/**
 * Unit tests for capacity admission logic.
 * Tests: admission flow, queue snapshot building, OCC protection, idempotency.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { admitTask } from "../supervisor/capacity";

import "@/lib/db/client"; // needed for vi.mocked() to work

import { prisma } from "@/lib/db/client";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    executionSession: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/workspace/settings", () => ({
  resolveWorkspaceGovernanceSettings: vi.fn(() => ({ maxConcurrentTasks: 5 })),
}));

// ── Type-safe mock accessor ──────────────────────────────────────────────

type MockedPrisma = {
  task: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  executionSession: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  workspace: { findUnique: ReturnType<typeof vi.fn> };
};

function getMocks(): MockedPrisma {
  return prisma as unknown as MockedPrisma;
}

// ── Helpers ────────────────────────────────────────────────────────────

function setupWorkspace(activeCount: number, max = 5) {
  const m = getMocks();
  m.workspace.findUnique.mockResolvedValueOnce({ settings: { maxConcurrentTasks: max } });
  m.executionSession.findMany.mockReset();
  m.executionSession.findMany.mockResolvedValue(
    Array.from({ length: activeCount }, (_, i) => ({
      id: `session-${i}`,
      projectId: "project-A",
    })),
  );
  // OCC re-check uses count
  m.executionSession.count.mockReset();
  m.executionSession.count.mockResolvedValue(4);
}

function setupTask(taskId: string, runId: string, metadata = {}) {
  const m = getMocks();
  m.task.findUnique.mockResolvedValueOnce({
    id: taskId,
    workspaceId: "ws-1",
    projectId: "project-A",
    status: "dispatched",
    currentAgentRunId: runId,
    metadata,
  });
}

function setupCapacityAvailable(taskId = "task-10", runId = "run-10") {
  setupWorkspace(4); // 4/5 used, 1 slot free
  setupTask(taskId, runId);
  getMocks().task.updateMany.mockResolvedValueOnce({ count: 1 });
  getMocks().task.findMany.mockReset();
  getMocks().task.findMany.mockResolvedValue([]);
}

function setupCapacityFull(taskId = "task-11", runId = "run-11") {
  setupWorkspace(5); // all 5 slots used
  setupTask(taskId, runId);
  getMocks().task.findMany.mockReset();
  getMocks().task.findMany.mockResolvedValue([]);
}

// ── Tests ────────────────────────────────────────────────────────────

describe("admitTask: capacity available", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("admits task when workspace has a free slot", async () => {
    setupCapacityAvailable();
    const result = await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-10",
      agentRunId: "run-10",
    });
    expect(result.outcome).toBe("admitted");
    if (result.outcome === "admitted") {
      expect(result.concurrencySnapshot.workspaceActiveConcurrentTasks).toBe(4);
      expect(result.concurrencySnapshot.maxConcurrentTasks).toBe(5);
      expect(result.concurrencySnapshot.hasCapacity).toBe(true);
    }
  });

  it("clears stale queue snapshot when task is admitted", async () => {
    setupCapacityAvailable();
    await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-10",
      agentRunId: "run-10",
    });
    expect(getMocks().task.updateMany).toHaveBeenCalled();
  });

  it("queues task when OCC detects slot was taken concurrently", async () => {
    const m = getMocks();
    m.workspace.findUnique.mockResolvedValueOnce({ settings: { maxConcurrentTasks: 5 } });
    m.executionSession.findMany.mockReset();
    m.executionSession.findMany.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({ id: `session-${i}`, projectId: "project-A" })),
    );
    setupTask("task-12", "run-12");
    m.task.updateMany.mockResolvedValueOnce({ count: 0 });
    m.task.findMany.mockReset();
    m.task.findMany.mockResolvedValue([]);

    const result = await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-12",
      agentRunId: "run-12",
    });
    expect(result.outcome).toBe("queued");
  });
});

describe("admitTask: capacity full", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues task when workspace capacity is full", async () => {
    setupCapacityFull();
    const result = await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-11",
      agentRunId: "run-11",
    });
    expect(result.outcome).toBe("queued");
    if (result.outcome === "queued") {
      expect(result.queueSnapshot.queuePosition).toBe(1);
      expect(result.queueSnapshot.workspaceActiveConcurrentTasks).toBe(5);
      expect(result.queueSnapshot.queueReasonCode).toBe("WORKSPACE_CAPACITY_FULL");
    }
  });

  it("does not claim slot when queueing", async () => {
    setupCapacityFull();
    await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-11",
      agentRunId: "run-11",
    });
    expect(getMocks().task.updateMany).not.toHaveBeenCalled();
  });

  it("sets correct queue reason summary when full", async () => {
    setupCapacityFull();
    const result = await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-11",
      agentRunId: "run-11",
    });
    expect(result.outcome).toBe("queued");
    if (result.outcome === "queued") {
      expect(result.queueSnapshot.queueReasonSummary).toContain("已满");
    }
  });
});

describe("admitTask: idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns idempotent result when task already has queue snapshot", async () => {
    const m = getMocks();
    m.task.findUnique.mockResolvedValueOnce({
      id: "task-11",
      workspaceId: "ws-1",
      projectId: "project-A",
      status: "dispatched",
      currentAgentRunId: "run-11",
      metadata: {
        executionQueue: {
          queuePosition: 2,
          queuedAt: "2026-04-20T10:00:00Z",
          workspaceActiveConcurrentTasks: 5,
          projectActiveConcurrentTasks: 2,
          maxConcurrentTasks: 5,
          estimatedWaitSeconds: 240,
          estimatedWaitLabel: "预计等待约 4 分钟。",
          queueReasonCode: "WORKSPACE_CAPACITY_FULL",
          queueReasonSummary: "工作空间并发上限已满。",
        },
      },
    });
    m.workspace.findUnique.mockResolvedValueOnce({ settings: { maxConcurrentTasks: 5 } });
    m.executionSession.findMany.mockReset();
    m.executionSession.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ id: `session-${i}`, projectId: "project-A" })),
    );
    m.task.findMany.mockReset();
    m.task.findMany.mockResolvedValue([]);

    const result = await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-11",
      agentRunId: "run-11",
    });
    expect(result.outcome).toBe("idempotent");
    if (result.outcome === "idempotent") {
      expect(result.queueSnapshot.queuePosition).toBe(2);
      expect(result.concurrencySnapshot.hasCapacity).toBe(false);
    }
  });
});

describe("admitTask: concurrency snapshot correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses ExecutionSession as source of truth for active count", async () => {
    const m = getMocks();
    m.workspace.findUnique.mockResolvedValueOnce({ settings: { maxConcurrentTasks: 10 } });
    m.executionSession.findMany.mockReset();
    m.executionSession.findMany.mockResolvedValue([
      { id: "s1", projectId: "project-A" },
      { id: "s2", projectId: "project-B" },
      { id: "s3", projectId: "project-A" },
    ]);
    setupTask("task-X", "run-X");
    m.task.updateMany.mockResolvedValueOnce({ count: 1 });
    m.task.findMany.mockReset();
    m.task.findMany.mockResolvedValue([]);

    const result = await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-X",
      agentRunId: "run-X",
    });
    expect(result.outcome).toBe("admitted");
    if (result.outcome === "admitted") {
      expect(result.concurrencySnapshot.workspaceActiveConcurrentTasks).toBe(3);
      expect(result.concurrencySnapshot.projectActiveConcurrentTasks).toBe(2); // s1, s3 in project-A
    }
  });

  it("counts only same-project sessions for projectActiveConcurrentTasks", async () => {
    const m = getMocks();
    m.workspace.findUnique.mockResolvedValueOnce({ settings: { maxConcurrentTasks: 10 } });
    m.executionSession.findMany.mockReset();
    m.executionSession.findMany.mockResolvedValue([
      { id: "s1", projectId: "project-A" },
      { id: "s2", projectId: "project-A" },
      { id: "s3", projectId: "project-B" },
      { id: "s4", projectId: "project-A" },
      { id: "s5", projectId: "project-C" },
    ]);
    setupTask("task-Y", "run-Y");
    m.task.updateMany.mockResolvedValueOnce({ count: 1 });
    m.task.findMany.mockReset();
    m.task.findMany.mockResolvedValue([]);

    const result = await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-Y",
      agentRunId: "run-Y",
    });
    expect(result.outcome).toBe("admitted");
    if (result.outcome === "admitted") {
      expect(result.concurrencySnapshot.workspaceActiveConcurrentTasks).toBe(5);
      expect(result.concurrencySnapshot.projectActiveConcurrentTasks).toBe(3); // s1, s2, s4 in project-A
    }
  });

  it("respects workspace maxConcurrentTasks from governance settings", async () => {
    const m = getMocks();
    m.workspace.findUnique.mockResolvedValueOnce({ settings: { maxConcurrentTasks: 10 } });
    m.executionSession.findMany.mockReset();
    m.executionSession.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `s-${i}`, projectId: "project-A" })),
    );
    setupTask("task-Z", "run-Z");
    m.task.updateMany.mockResolvedValueOnce({ count: 1 });
    m.task.findMany.mockReset();
    m.task.findMany.mockResolvedValue([]);

    const result = await admitTask({
      workspaceId: "ws-1",
      projectId: "project-A",
      taskId: "task-Z",
      agentRunId: "run-Z",
    });
    expect(result.outcome).toBe("admitted");
    if (result.outcome === "admitted") {
      expect(result.concurrencySnapshot.maxConcurrentTasks).toBe(10);
      expect(result.concurrencySnapshot.workspaceActiveConcurrentTasks).toBe(8);
    }
  });
});
