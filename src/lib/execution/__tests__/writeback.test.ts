import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskTerminalStateUpdateInput } from "@/lib/tasks/types";

const mockTaskFindFirst = vi.fn();
const mockWritebackFindUnique = vi.fn();
const mockPrismaTransaction = vi.fn();

const mockTxTaskUpdate = vi.fn();
const mockTxWritebackFindUnique = vi.fn();
const mockTxWritebackUpsert = vi.fn();
const mockTxArtifactUpdate = vi.fn();
const mockTxAuditEventCreate = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    task: {
      findFirst: (...args: unknown[]) => mockTaskFindFirst(...args),
    },
    writeback: {
      findUnique: (...args: unknown[]) => mockWritebackFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockPrismaTransaction(...args),
  },
}));

vi.mock("@/lib/errors", () => ({
  sanitizeError: vi.fn((_error: unknown, code: string) => `sanitized:${code}`),
}));

const {
  WritebackServiceError,
  applyTaskTerminalStateWriteback,
  buildWritebackIdempotencyKey,
  resolveTaskTerminalOutcome,
} = await import("../writeback");
const { sanitizeError } = await import("@/lib/errors");

const mockSanitizeError = sanitizeError as ReturnType<typeof vi.fn>;

function createTx() {
  return {
    task: {
      update: mockTxTaskUpdate,
    },
    writeback: {
      findUnique: mockTxWritebackFindUnique,
      upsert: mockTxWritebackUpsert,
    },
    bmadArtifact: {
      update: mockTxArtifactUpdate,
    },
    auditEvent: {
      create: mockTxAuditEventCreate,
    },
  };
}

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    sourceArtifactId: "artifact-1",
    title: "执行 Story 2.5",
    summary: "回写链路验证",
    status: "in-progress",
    currentStage: "正在执行",
    nextStep: "继续推进",
    metadata: {},
    sourceArtifact: {
      id: "artifact-1",
      projectId: "project-1",
    },
    ...overrides,
  };
}

function createWritebackRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "writeback-1",
    taskId: "task-1",
    artifactId: "artifact-1",
    outcome: "completed",
    writebackStatus: "succeeded",
    summary: "任务执行完成",
    errorSummary: null,
    occurredAt: new Date("2026-04-10T10:00:00.000Z"),
    payload: {
      recoveryHint: "可继续进入评审或查看最新工件结果。",
      artifacts: [
        {
          type: "代码变更",
          filePath: "src/actions/task-actions.ts",
          generatedAt: "2026-04-10T09:30:00.000Z",
          summary: "补齐任务终态回写",
        },
      ],
    },
    ...overrides,
  };
}

function createInput(overrides: Partial<TaskTerminalStateUpdateInput> = {}): TaskTerminalStateUpdateInput {
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    taskId: "task-1",
    status: "done",
    currentStage: "已完成",
    nextStep: "可进入评审",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTaskFindFirst.mockResolvedValue(createTask());
  mockWritebackFindUnique.mockResolvedValue(null);
  mockTxWritebackFindUnique.mockResolvedValue(null);
  mockTxWritebackUpsert.mockResolvedValue(createWritebackRecord());
  mockPrismaTransaction.mockImplementation(async (handler: (tx: ReturnType<typeof createTx>) => Promise<unknown>) => (
    handler(createTx())
  ));
});

describe("writeback helpers", () => {
  it("builds deterministic idempotency key", () => {
    expect(buildWritebackIdempotencyKey("task-100", "completed")).toBe("task-100:completed");
  });

  it("resolves terminal outcome correctly", () => {
    expect(resolveTaskTerminalOutcome({ status: "done", metadata: null })).toBe("completed");
    expect(resolveTaskTerminalOutcome({ status: "blocked", metadata: {} })).toBe("failed");
    expect(resolveTaskTerminalOutcome({ status: "blocked", metadata: { interrupted: true } })).toBe("interrupted");
    expect(resolveTaskTerminalOutcome({ status: "review", metadata: {} })).toBeNull();
  });
});

describe("applyTaskTerminalStateWriteback", () => {
  it("writes success snapshot for done status and keeps artifact lifecycle status untouched", async () => {
    const input = createInput({
      status: "done",
      currentActivity: "正在整理交付说明",
      resultSummary: "任务执行完成并已验证",
      metadata: {
        terminalAt: "2026-04-10T10:00:00.000Z",
      },
    });

    const result = await applyTaskTerminalStateWriteback(input);

    expect(result.taskId).toBe("task-1");
    expect(result.writeback?.writebackStatus).toBe("succeeded");
    expect(result.writeback?.outcome).toBe("completed");
    expect(mockTxTaskUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxWritebackUpsert).toHaveBeenCalledTimes(1);
    expect(mockTxArtifactUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        executionStatus: "completed",
        latestWritebackOutcome: "completed",
      }),
    }));
    expect(mockTxArtifactUpdate.mock.calls[0]?.[0]?.data).not.toHaveProperty("status");
    expect(mockTxAuditEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventName: "writeback.succeeded",
      }),
    }));
  });

  it("returns existing succeeded writeback as idempotent result", async () => {
    const existing = createWritebackRecord({
      id: "writeback-existing",
      summary: "已回写，无需重复提交",
      payload: {
        recoveryHint: "继续推进",
        artifacts: [{ type: "代码变更" }],
      },
    });
    mockWritebackFindUnique.mockResolvedValue(existing);

    const result = await applyTaskTerminalStateWriteback(createInput());

    expect(result.writeback?.id).toBe("writeback-existing");
    expect(result.writeback?.summary).toBe("已回写，无需重复提交");
    expect(result.writeback?.artifacts).toEqual([{
      type: "代码变更",
      filePath: "文件路径待记录",
      generatedAt: null,
      summary: "暂无产物说明",
    }]);
    expect(mockPrismaTransaction).not.toHaveBeenCalled();
  });

  it("records failed audit when source artifact is missing", async () => {
    mockTaskFindFirst.mockResolvedValue(createTask({
      sourceArtifactId: null,
      sourceArtifact: null,
    }));

    await expect(applyTaskTerminalStateWriteback(createInput()))
      .rejects
      .toMatchObject<Partial<WritebackServiceError>>({
        code: "ARTIFACT_SOURCE_NOT_FOUND",
      });

    expect(mockTxTaskUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxWritebackUpsert).not.toHaveBeenCalled();
    expect(mockTxAuditEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        artifactId: null,
        eventName: "writeback.failed",
      }),
    }));
    expect(mockSanitizeError).toHaveBeenCalledWith(null, "ARTIFACT_SOURCE_NOT_FOUND");
  });

  it("maps interrupted outcome to retry-pending execution snapshot when next step asks for retry", async () => {
    mockTxWritebackUpsert.mockResolvedValue(createWritebackRecord({
      outcome: "interrupted",
      summary: "执行已中断，下一步建议：请重试执行",
      payload: {
        recoveryHint: "请重试执行",
        artifacts: [],
      },
    }));

    const result = await applyTaskTerminalStateWriteback(createInput({
      status: "blocked",
      nextStep: "请重试执行",
      metadata: { interrupted: true },
    }));

    expect(result.writeback?.outcome).toBe("interrupted");
    expect(mockTxArtifactUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        executionStatus: "retry-pending",
        latestWritebackOutcome: "interrupted",
      }),
    }));
  });

  it("falls back to failed writeback record when transaction throws", async () => {
    mockWritebackFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrismaTransaction
      .mockImplementationOnce(async () => {
        throw new Error("db unavailable");
      })
      .mockImplementationOnce(async (handler: (tx: ReturnType<typeof createTx>) => Promise<unknown>) => (
        handler(createTx())
      ));

    await expect(applyTaskTerminalStateWriteback(createInput()))
      .rejects
      .toMatchObject<Partial<WritebackServiceError>>({
        code: "WRITEBACK_ERROR",
      });

    expect(mockTxWritebackUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        writebackStatus: "failed",
      }),
      update: expect.objectContaining({
        writebackStatus: "failed",
      }),
    }));
    expect(mockTxAuditEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventName: "writeback.failed",
      }),
    }));
    expect(mockSanitizeError).toHaveBeenCalledWith(null, "WRITEBACK_ERROR");
  });

  it("returns succeeded writeback when concurrent transaction already committed the same idempotency key", async () => {
    const concurrentWriteback = createWritebackRecord({
      id: "writeback-concurrent",
      summary: "并发请求已完成回写",
    });
    mockWritebackFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentWriteback);
    mockPrismaTransaction.mockImplementationOnce(async () => {
      throw new Error("serialization conflict");
    });

    const result = await applyTaskTerminalStateWriteback(createInput());

    expect(result.writeback?.id).toBe("writeback-concurrent");
    expect(result.writeback?.summary).toBe("并发请求已完成回写");
    expect(mockTxWritebackUpsert).not.toHaveBeenCalled();
    expect(mockTxAuditEventCreate).not.toHaveBeenCalled();
  });
});
