import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanResult } from "../types";

// Mock prisma before importing sync module
const mockFindMany = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    bmadArtifact: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      create: (...args: unknown[]) => {
        const result = mockCreate(...args);
        return result;
      },
      update: (...args: unknown[]) => {
        const result = mockUpdate(...args);
        return result;
      },
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

// Import after mock setup
const { syncArtifacts } = await import("../sync");

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockTransaction.mockImplementation(async (ops: unknown[]) => {
    return ops;
  });
  mockCreate.mockImplementation((args: Record<string, unknown>) => ({
    id: `new-${Math.random().toString(36).slice(2)}`,
    ...((args as { data: Record<string, unknown> }).data || {}),
  }));
  mockUpdate.mockImplementation((args: Record<string, unknown>) => ({
    id: (args as { where: { id: string } }).where?.id,
    ...((args as { data: Record<string, unknown> }).data || {}),
  }));
});

describe("syncArtifacts", () => {
  it("creates new artifacts on first scan", async () => {
    const scanResult: ScanResult = {
      artifacts: [
        {
          type: "PRD",
          name: "My PRD",
          filePath: "_bmad-output/planning-artifacts/prd.md",
          metadata: { title: "My PRD" },
        },
        {
          type: "EPIC",
          name: "Setup",
          filePath: "_bmad-output/planning-artifacts/epics.md#epic-1",
          metadata: { epicId: "1" },
          epicId: "1",
        },
      ],
      errors: [],
    };

    // Phase 1 findMany: no existing records
    mockFindMany.mockResolvedValueOnce([]);
    // Phase 2 findMany: return newly created records
    mockFindMany.mockResolvedValueOnce([
      { id: "prd-1", type: "PRD", filePath: "prd.md", metadata: {}, parentId: null },
      { id: "epic-1", type: "EPIC", filePath: "epics.md#epic-1", metadata: { epicId: "1" }, parentId: null },
    ]);

    const report = await syncArtifacts("project-1", scanResult);

    expect(report.created).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.deleted).toBe(0);
    expect(mockTransaction).toHaveBeenCalled();
  });

  it("updates existing artifacts on rescan", async () => {
    const existingArtifacts = [
      {
        id: "prd-1",
        type: "PRD",
        name: "Old PRD",
        filePath: "_bmad-output/planning-artifacts/prd.md",
        metadata: { title: "Old PRD" },
        status: "active",
        parentId: null,
      },
    ];

    const scanResult: ScanResult = {
      artifacts: [
        {
          type: "PRD",
          name: "Updated PRD",
          filePath: "_bmad-output/planning-artifacts/prd.md",
          metadata: { title: "Updated PRD" },
        },
      ],
      errors: [],
    };

    mockFindMany.mockResolvedValueOnce(existingArtifacts);
    mockFindMany.mockResolvedValueOnce([
      { ...existingArtifacts[0], name: "Updated PRD" },
    ]);

    const report = await syncArtifacts("project-1", scanResult);

    expect(report.updated).toBe(1);
    expect(report.created).toBe(0);
    expect(report.deleted).toBe(0);
  });

  it("soft-deletes artifacts not found in scan", async () => {
    const existingArtifacts = [
      {
        id: "prd-1",
        type: "PRD",
        name: "Old PRD",
        filePath: "_bmad-output/planning-artifacts/prd.md",
        metadata: {},
        status: "active",
        parentId: null,
      },
      {
        id: "epic-1",
        type: "EPIC",
        name: "Removed Epic",
        filePath: "_bmad-output/planning-artifacts/epics.md#epic-1",
        metadata: { epicId: "1" },
        status: "active",
        parentId: null,
      },
    ];

    const scanResult: ScanResult = {
      artifacts: [
        {
          type: "PRD",
          name: "Still here",
          filePath: "_bmad-output/planning-artifacts/prd.md",
          metadata: {},
        },
      ],
      errors: [],
    };

    mockFindMany.mockResolvedValueOnce(existingArtifacts);
    mockFindMany.mockResolvedValueOnce([existingArtifacts[0]]);

    const report = await syncArtifacts("project-1", scanResult);

    expect(report.updated).toBe(1);
    expect(report.deleted).toBe(1);
  });

  it("does not soft-delete when scan returns only errors (empty scan protection)", async () => {
    const existingArtifacts = [
      {
        id: "prd-1",
        type: "PRD",
        name: "PRD",
        filePath: "_bmad-output/planning-artifacts/prd.md",
        metadata: {},
        status: "active",
        parentId: null,
      },
    ];

    const scanResult: ScanResult = {
      artifacts: [],
      errors: [{ file: "some-file.md", error: "Connection timeout" }],
    };

    mockFindMany.mockResolvedValueOnce(existingArtifacts);
    mockFindMany.mockResolvedValueOnce(existingArtifacts);

    const report = await syncArtifacts("project-1", scanResult);

    expect(report.deleted).toBe(0);
    expect(report.created).toBe(0);
  });

  it("establishes parentId relationships (Epic → PRD)", async () => {
    const scanResult: ScanResult = {
      artifacts: [
        {
          type: "PRD",
          name: "PRD",
          filePath: "_bmad-output/planning-artifacts/prd.md",
          metadata: {},
        },
        {
          type: "EPIC",
          name: "Epic 1",
          filePath: "_bmad-output/planning-artifacts/epics.md#epic-1",
          metadata: { epicId: "1" },
          epicId: "1",
        },
      ],
      errors: [],
    };

    mockFindMany.mockResolvedValueOnce([]);
    // Phase 2: return created records with IDs
    mockFindMany.mockResolvedValueOnce([
      { id: "prd-1", type: "PRD", filePath: "prd.md", metadata: {}, parentId: null },
      { id: "epic-1", type: "EPIC", filePath: "epics.md#epic-1", metadata: { epicId: "1" }, parentId: null },
    ]);

    const report = await syncArtifacts("project-1", scanResult);

    // Phase 2 transaction should have been called for parent updates
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(report.errors).toHaveLength(0);
  });

  it("establishes parentId relationships (Task → Story)", async () => {
    const scanResult: ScanResult = {
      artifacts: [
        {
          type: "STORY",
          name: "Story 2.1",
          filePath: "_bmad-output/implementation-artifacts/2-1-artifact-engine.md",
          metadata: { storyId: "2.1", epicId: "2" },
          epicId: "2",
          storyId: "2.1",
        },
        {
          type: "TASK",
          name: "建立 Prisma 模型",
          filePath: "_bmad-output/implementation-artifacts/2-1-artifact-engine.md#task-1",
          metadata: { taskId: "2.1.1", storyId: "2.1", epicId: "2" },
          epicId: "2",
          storyId: "2.1",
        },
      ],
      errors: [],
    };

    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([
      {
        id: "story-1",
        type: "STORY",
        filePath: "_bmad-output/implementation-artifacts/2-1-artifact-engine.md",
        metadata: { storyId: "2.1", epicId: "2" },
        parentId: null,
      },
      {
        id: "task-1",
        type: "TASK",
        filePath: "_bmad-output/implementation-artifacts/2-1-artifact-engine.md#task-1",
        metadata: { taskId: "2.1.1", storyId: "2.1", epicId: "2" },
        parentId: null,
      },
    ]);

    const report = await syncArtifacts("project-1", scanResult);

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    const parentUpdateBatch = mockTransaction.mock.calls[1][0] as Array<{ parentId?: string }>;
    expect(parentUpdateBatch).toHaveLength(1);
    expect(parentUpdateBatch[0].parentId).toBe("story-1");
    expect(report.errors).toHaveLength(0);
  });
});
