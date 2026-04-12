import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  };
});

const mockPlanningRequestFindMany = vi.fn();
const mockPlanningRequestFindFirst = vi.fn();
const mockGetTasksByPlanningRequestIds = vi.fn();
const mockGetArtifactsByProjectIdAndFilePaths = vi.fn();
const mockGetArtifactsByProjectIdAndIds = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    planningRequest: {
      findMany: mockPlanningRequestFindMany,
      findFirst: mockPlanningRequestFindFirst,
    },
  },
}));

vi.mock("@/lib/db/helpers", () => ({
  getTasksByPlanningRequestIds: mockGetTasksByPlanningRequestIds,
  getArtifactsByProjectIdAndFilePaths: mockGetArtifactsByProjectIdAndFilePaths,
  getArtifactsByProjectIdAndIds: mockGetArtifactsByProjectIdAndIds,
}));

const {
  getPlanningRequestDetailById,
  getPlanningRequestsByProjectId,
} = await import("./queries");

function createPlanningRequestRecord(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "planning-1",
    rawGoal: "为项目添加用户反馈收集功能",
    status: "execution-ready",
    progressPercent: 100,
    nextStep: "已确认规划结果并生成执行任务，当前等待手动派发，尚未开始编码。",
    routeType: "planning",
    selectionReasonCode: "new-feature-or-product-scope",
    selectionReasonSummary: "目标包含新功能建设或产品范围扩展，需要先进入规划链路拆解需求与工件。",
    selectedAgentKeys: ["bmad-agent-pm"],
    selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
    analyzedAt: new Date("2026-04-11T00:21:00.000Z"),
    executionHandoffDraft: null,
    executionStartedAt: new Date("2026-04-11T00:22:00.000Z"),
    executionCompletedAt: new Date("2026-04-11T00:25:00.000Z"),
    executionFailedAt: null,
    confirmedAt: new Date("2026-04-11T00:30:00.000Z"),
    artifactSummary: [
      {
        path: "_bmad-output/planning-artifacts/prd.md",
        title: "PRD 草案",
        kind: "prd",
        summary: "已生成 PRD。",
        sourceSkillKey: "bmad-create-prd",
        status: "created",
      },
    ],
    taskHandoffSummary: {
      source: "planning-request-handoff",
      confirmedAt: "2026-04-11T00:30:00.000Z",
      dispatchMode: "manual",
      approvalRequired: false,
      candidateTaskCount: 1,
      createdTaskCount: 1,
      deferredArtifactCount: 1,
      deduplicatedTaskCount: 0,
      createdTasks: [
        {
          taskId: "task-1",
          taskTitle: "Task《落地用户反馈入口》",
          sourceArtifactId: "artifact-task-1",
          sourceArtifactName: "落地用户反馈入口",
          sourceArtifactPath: "_bmad-output/implementation-artifacts/3-5-story.md#task-1",
          storyArtifactId: "artifact-story-1",
          storyTitle: "Story 3.5",
          priority: "high",
          intent: "implement",
          status: "planned",
          currentStage: "已计划",
          nextStep: "等待手动派发。",
          queuePosition: 1,
          readyState: "manual",
        },
      ],
      deferredArtifacts: [
        {
          artifactId: "artifact-task-2",
          artifactType: "TASK",
          artifactName: "补齐确认后反馈",
          filePath: "_bmad-output/implementation-artifacts/3-5-story.md#task-2",
          storyArtifactId: "artifact-story-1",
          storyTitle: "Story 3.5",
          deferredBy: "task",
        },
      ],
    },
    generatedArtifactCount: 1,
    derivedTaskCount: 1,
    deferredArtifactCount: 1,
    lastExecutionErrorCode: null,
    executionSteps: [
      {
        id: "step-1",
        skillKey: "bmad-create-prd",
        stepKey: "generate-prd",
        sequence: 1,
        status: "completed",
        title: "生成 PRD 工件",
        startedAt: new Date("2026-04-11T00:21:00.000Z"),
        completedAt: new Date("2026-04-11T00:22:00.000Z"),
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        outputSummary: "已生成 PRD 草案。",
        artifactPaths: ["_bmad-output/planning-artifacts/prd.md"],
        retryCount: 0,
      },
    ],
    createdAt: new Date("2026-04-11T00:20:00.000Z"),
    updatedAt: new Date("2026-04-11T00:30:00.000Z"),
    createdByUser: {
      id: "user-1",
      name: "Demo",
      email: "demo@example.com",
    },
    ...overrides,
  };
}

function createPlanningTaskRecord(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "task-1",
    planningRequestId: "planning-1",
    sourceArtifactId: "artifact-task-1",
    title: "Task《落地用户反馈入口》",
    status: "pending",
    currentStage: "等待派发",
    nextStep: "仍在等待执行器接单。",
    createdAt: new Date("2026-04-11T00:31:00.000Z"),
    metadata: {
      planningHandoff: {
        queuePosition: 3,
        readyState: "manual",
      },
    },
    sourceArtifact: {
      id: "artifact-task-1",
      type: "TASK",
      name: "落地用户反馈入口",
      filePath: "_bmad-output/implementation-artifacts/3-5-story.md#task-1",
      metadata: null,
      parent: {
        id: "artifact-story-1",
        type: "STORY",
        name: "Story 3.5",
        parent: null,
      },
    },
    writebacks: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetTasksByPlanningRequestIds.mockResolvedValue([]);
  mockGetArtifactsByProjectIdAndFilePaths.mockResolvedValue([]);
  mockGetArtifactsByProjectIdAndIds.mockResolvedValue([]);
});

describe("getPlanningRequestsByProjectId", () => {
  it("applies project-level status filtering on the server query", async () => {
    mockPlanningRequestFindMany.mockResolvedValue([
      createPlanningRequestRecord({ status: "failed" }),
    ]);

    const result = await getPlanningRequestsByProjectId("project-1", "failed");

    expect(mockPlanningRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project-1",
          status: "failed",
        },
      }),
    );
    expect(result[0]?.status).toBe("failed");
  });

  it("reconciles execution-ready task counts from real linked tasks", async () => {
    mockPlanningRequestFindMany.mockResolvedValue([
      createPlanningRequestRecord({
        derivedTaskCount: 0,
        taskHandoffSummary: null,
      }),
    ]);
    mockGetTasksByPlanningRequestIds.mockResolvedValue([
      createPlanningTaskRecord(),
    ]);

    const result = await getPlanningRequestsByProjectId("project-1", "execution-ready");

    expect(mockGetTasksByPlanningRequestIds).toHaveBeenCalledWith("project-1", ["planning-1"]);
    expect(result[0]?.derivedTaskCount).toBe(1);
  });
});

describe("getPlanningRequestDetailById", () => {
  it("builds detail views from real tasks while keeping handoff metadata for queue state", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue(createPlanningRequestRecord());
    mockGetTasksByPlanningRequestIds.mockResolvedValue([createPlanningTaskRecord()]);
    mockGetArtifactsByProjectIdAndFilePaths.mockResolvedValue([
      {
        id: "artifact-prd-1",
        type: "PRD",
        name: "PRD 草案",
        filePath: "_bmad-output/planning-artifacts/prd.md",
        parentId: null,
        metadata: null,
      },
    ]);
    mockGetArtifactsByProjectIdAndIds.mockResolvedValue([
      {
        id: "artifact-task-2",
        type: "TASK",
        name: "补齐确认后反馈",
        filePath: "_bmad-output/implementation-artifacts/3-5-story.md#task-2",
        parentId: "artifact-story-1",
        metadata: null,
      },
    ]);

    const detail = await getPlanningRequestDetailById("project-1", "planning-1");

    expect(mockGetTasksByPlanningRequestIds).toHaveBeenCalledWith("project-1", ["planning-1"]);
    expect(detail?.artifacts[0]).toEqual(
      expect.objectContaining({
        artifactId: "artifact-prd-1",
        artifactName: "PRD 草案",
      }),
    );
    expect(detail?.derivedTasks[0]).toEqual(
      expect.objectContaining({
        taskId: "task-1",
        status: "pending",
        nextStep: "仍在等待执行器接单。",
        queuePosition: 1,
        readyState: "manual",
        sourceArtifactId: "artifact-task-1",
        storyTitle: "Story 3.5",
        isLegacyPending: true,
      }),
    );
    expect(detail?.deferredArtifacts[0]).toEqual(
      expect.objectContaining({
        artifactId: "artifact-task-2",
        sourceArtifactId: "artifact-task-2",
      }),
    );
  });

  it("keeps artifact paths visible when no real artifact record can be resolved", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue(
      createPlanningRequestRecord({
        taskHandoffSummary: null,
      }),
    );

    const detail = await getPlanningRequestDetailById("project-1", "planning-1");

    expect(detail?.artifacts[0]).toEqual(
      expect.objectContaining({
        path: "_bmad-output/planning-artifacts/prd.md",
        artifactId: null,
        artifactName: null,
      }),
    );
    expect(detail?.derivedTasks).toEqual([]);
  });

  it("uses real linked tasks to describe execution-ready visibility for legacy requests", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue(
      createPlanningRequestRecord({
        derivedTaskCount: 0,
        taskHandoffSummary: null,
      }),
    );
    mockGetTasksByPlanningRequestIds.mockResolvedValue([createPlanningTaskRecord()]);

    const detail = await getPlanningRequestDetailById("project-1", "planning-1");

    expect(detail?.request.derivedTaskCount).toBe(1);
    expect(detail?.problem?.reason).toContain("1 个衍生任务");
  });
});
