/**
 * Unit tests for admission orchestration.
 * Verifies startTask() correctly orchestrates the admit → launch/queue/err paths.
 * Detailed capacity-snapshot and OCC tests live in capacity.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { startTask } from "../supervisor/admission";

const mTaskFindFirst = vi.fn();
const mAuditEventCreate = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    task: { findFirst: (...args: unknown[]) => mTaskFindFirst(...args) },
    auditEvent: { create: (...args: unknown[]) => mAuditEventCreate(...args) },
  },
}));

vi.mock("../supervisor/capacity", () => ({
  admitTask: vi.fn(),
}));

vi.mock("../supervisor/launch", () => ({
  launchTask: vi.fn(),
}));

vi.mock("../supervisor/queue", () => ({
  persistExecutionQueueSnapshot: vi.fn(),
  clearExecutionQueueSnapshot: vi.fn(),
  rebuildQueuePositions: vi.fn(),
  resolveNextQueuedTask: vi.fn(),
  parseExecutionQueueSnapshot: vi.fn(),
}));

import { admitTask } from "../supervisor/capacity";
import { launchTask } from "../supervisor/launch";
import { persistExecutionQueueSnapshot, clearExecutionQueueSnapshot } from "../supervisor/queue";

// ── Helpers ───────────────────────────────────────────────────────────

function mockTaskRecord(taskId: string, runId: string, status = "dispatched") {
  mTaskFindFirst.mockResolvedValueOnce({
    id: taskId,
    workspaceId: "ws-1",
    projectId: "proj-A",
    status,
    currentAgentRunId: runId,
    sourceArtifactId: null,
  });
  mAuditEventCreate.mockResolvedValue({ id: "audit-1" });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("startTask: outcome routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns status=launched with session details when capacity is available", async () => {
    mockTaskRecord("task-1", "run-1");
    (admitTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      outcome: "admitted",
      concurrencySnapshot: {
        workspaceId: "ws-1", projectId: "proj-A",
        maxConcurrentTasks: 5, workspaceActiveConcurrentTasks: 4,
        projectActiveConcurrentTasks: 2, hasCapacity: true, queueAhead: 0,
      },
    });
    (launchTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      executionSessionId: "sess-1", taskId: "task-1", agentRunId: "run-1",
      sessionName: "bmad-task-1-run-1", processPid: 12345, transport: "tmux",
    });

    const result = await startTask({
      workspaceId: "ws-1", projectId: "proj-A", taskId: "task-1",
    });

    expect(result.status).toBe("launched");
    if (result.status === "launched") {
      expect(result.result.executionSessionId).toBe("sess-1");
      expect(result.concurrency.workspaceActiveConcurrentTasks).toBe(4);
    }
    expect(launchTask).toHaveBeenCalled();
    expect(persistExecutionQueueSnapshot).not.toHaveBeenCalled();
  });

  it("returns status=queued with snapshot when capacity is full", async () => {
    mockTaskRecord("task-2", "run-2");
    (admitTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      outcome: "queued",
      queueSnapshot: {
        queuePosition: 2, queuedAt: "2026-04-20T10:00:00Z",
        workspaceActiveConcurrentTasks: 5, projectActiveConcurrentTasks: 3,
        maxConcurrentTasks: 5, estimatedWaitSeconds: 240,
        estimatedWaitLabel: "预计等待约 4 分钟。",
        queueReasonCode: "WORKSPACE_CAPACITY_FULL",
        queueReasonSummary: "工作空间并发上限已满。",
      },
      concurrencySnapshot: {
        workspaceId: "ws-1", projectId: "proj-A",
        maxConcurrentTasks: 5, workspaceActiveConcurrentTasks: 5,
        projectActiveConcurrentTasks: 3, hasCapacity: false, queueAhead: 0,
      },
    });

    const result = await startTask({
      workspaceId: "ws-1", projectId: "proj-A", taskId: "task-2",
    });

    expect(result.status).toBe("queued");
    if (result.status === "queued") {
      expect(result.queueSnapshot.queuePosition).toBe(2);
      expect(result.concurrency.estimatedWaitLabel).toBe("预计等待约 4 分钟。");
    }
    // launch is NOT called when queued (enqueued audit event is recorded instead)
    expect(launchTask).not.toHaveBeenCalled();
  });

  it("returns status=idempotent without re-launching when already queued", async () => {
    mockTaskRecord("task-3", "run-3");
    (admitTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      outcome: "idempotent",
      queueSnapshot: {
        queuePosition: 1, queuedAt: "2026-04-20T10:00:00Z",
        workspaceActiveConcurrentTasks: 5, projectActiveConcurrentTasks: 2,
        maxConcurrentTasks: 5, estimatedWaitSeconds: 60,
        estimatedWaitLabel: "预计等待约 1 分钟。",
        queueReasonCode: "WORKSPACE_CAPACITY_FULL",
        queueReasonSummary: "已满",
      },
      concurrencySnapshot: {
        workspaceId: "ws-1", projectId: "proj-A",
        maxConcurrentTasks: 5, workspaceActiveConcurrentTasks: 5,
        projectActiveConcurrentTasks: 2, hasCapacity: false, queueAhead: 0,
      },
    });

    const result = await startTask({
      workspaceId: "ws-1", projectId: "proj-A", taskId: "task-3",
    });

    expect(result.status).toBe("idempotent");
    expect(launchTask).not.toHaveBeenCalled();
    expect(persistExecutionQueueSnapshot).not.toHaveBeenCalled();
  });

  it("clears queue snapshot when launch fails after admission", async () => {
    mockTaskRecord("task-4", "run-4");
    (admitTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      outcome: "admitted",
      concurrencySnapshot: {
        workspaceId: "ws-1", projectId: "proj-A",
        maxConcurrentTasks: 5, workspaceActiveConcurrentTasks: 4,
        projectActiveConcurrentTasks: 2, hasCapacity: true, queueAhead: 0,
      },
    });
    (launchTask as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("tmux failed"));

    await expect(startTask({
      workspaceId: "ws-1", projectId: "proj-A", taskId: "task-4",
    })).rejects.toThrow("tmux failed");

    expect(clearExecutionQueueSnapshot).toHaveBeenCalledWith("task-4");
  });

  it("throws when task record not found", async () => {
    mTaskFindFirst.mockResolvedValueOnce(null);

    await expect(startTask({
      workspaceId: "ws-1", projectId: "proj-A", taskId: "nonexistent",
    })).rejects.toThrow("找不到指定的任务记录。");
  });

  it("throws when task has no currentAgentRunId", async () => {
    mTaskFindFirst.mockResolvedValueOnce({
      id: "task-5", workspaceId: "ws-1", projectId: "proj-A",
      status: "dispatched", currentAgentRunId: null,
    });

    await expect(startTask({
      workspaceId: "ws-1", projectId: "proj-A", taskId: "task-5",
    })).rejects.toThrow("当前任务还没有可启动的 Agent Run。");
  });

  it("throws when task status is not dispatched", async () => {
    mockTaskRecord("task-6", "run-6", "in-progress");

    await expect(startTask({
      workspaceId: "ws-1", projectId: "proj-A", taskId: "task-6",
    })).rejects.toThrow("还不能启动执行会话");
  });
});
