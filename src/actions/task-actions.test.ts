import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db/helpers", () => ({
  getAuthenticatedSession: vi.fn(),
  getProjectArtifacts: vi.fn(),
  getTaskHistoryCandidatesByProjectId: vi.fn(),
  getWorkspaceById: vi.fn(),
}));

vi.mock("@/lib/workspace/permissions", () => ({
  requireProjectAccess: vi.fn(),
}));

vi.mock("@/lib/content-provider/project-provider", () => ({
  createProjectContentProvider: vi.fn(),
  toProjectRepoProviderConfig: vi.fn((repo: unknown) => repo),
  ProjectProviderError: class ProjectProviderError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
      this.name = "ProjectProviderError";
    }
  },
}));

vi.mock("@/lib/tasks/context", () => ({
  buildTaskCreationContext: vi.fn(),
  TaskContextError: class TaskContextError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
      this.name = "TaskContextError";
    }
  },
}));

vi.mock("@/lib/tasks/defaults", () => ({
  getManualTaskLifecycle: vi.fn(() => ({
    status: "planned",
    currentStage: "已计划",
    currentActivity: "任务已计划完成，当前尚未开始编码或启动执行。",
    nextStep: "下一步可进入执行派发阶段。",
  })),
  buildTaskTitleFromGoal: vi.fn(({ goal, sourceArtifactName }: { goal: string; sourceArtifactName?: string | null }) =>
    sourceArtifactName ? `围绕《${sourceArtifactName}》执行：${goal}` : `项目任务：${goal}`),
}));

vi.mock("@/lib/execution/writeback", () => ({
  applyTaskTerminalStateWriteback: vi.fn(),
  WritebackServiceError: class WritebackServiceError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
      this.name = "WritebackServiceError";
    }
  },
}));

const mockArtifactFindFirst = vi.fn();
const mockProjectFindFirst = vi.fn();
const mockTaskCreate = vi.fn();
const mockAuditEventCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    bmadArtifact: {
      findFirst: (...args: unknown[]) => mockArtifactFindFirst(...args),
    },
    project: {
      findFirst: (...args: unknown[]) => mockProjectFindFirst(...args),
    },
    auditEvent: {
      create: (...args: unknown[]) => mockAuditEventCreate(...args),
    },
  },
}));

const { getAuthenticatedSession } = await import("@/lib/db/helpers");
const { getProjectArtifacts } = await import("@/lib/db/helpers");
const { getTaskHistoryCandidatesByProjectId } = await import("@/lib/db/helpers");
const { getWorkspaceById } = await import("@/lib/db/helpers");
const { requireProjectAccess } = await import("@/lib/workspace/permissions");
const { createProjectContentProvider } = await import("@/lib/content-provider/project-provider");
const { buildTaskCreationContext } = await import("@/lib/tasks/context");
const { applyTaskTerminalStateWriteback, WritebackServiceError } = await import("@/lib/execution/writeback");
const {
  getArtifactTaskHistoryAction,
  getTaskCreationContextAction,
  createTaskAction,
  createTaskFromArtifactAction,
  updateTaskTerminalStateAction,
} = await import("./task-actions");

const mockGetAuthenticatedSession = getAuthenticatedSession as ReturnType<typeof vi.fn>;
const mockGetProjectArtifacts = getProjectArtifacts as ReturnType<typeof vi.fn>;
const mockGetTaskHistoryCandidatesByProjectId = getTaskHistoryCandidatesByProjectId as ReturnType<typeof vi.fn>;
const mockGetWorkspaceById = getWorkspaceById as ReturnType<typeof vi.fn>;
const mockRequireProjectAccess = requireProjectAccess as ReturnType<typeof vi.fn>;
const mockCreateProjectContentProvider = createProjectContentProvider as ReturnType<typeof vi.fn>;
const mockBuildTaskCreationContext = buildTaskCreationContext as ReturnType<typeof vi.fn>;
const mockApplyTaskTerminalStateWriteback = applyTaskTerminalStateWriteback as ReturnType<typeof vi.fn>;

const baseArtifact = {
  id: "artifact-1",
  projectId: "cprojectid0000000000000001",
  status: "active",
  type: "STORY",
  name: "从工件发起任务",
  filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md",
  parentId: "artifact-epic-1",
  metadata: { storyId: "2.2", epicId: "2" },
  parent: null,
};

const baseProject = {
  id: "cprojectid0000000000000001",
  workspaceId: "cworkspaceid0000000000001",
  slug: "demo-project",
  name: "Demo Project",
  workspace: { slug: "demo-workspace", settings: null },
  repo: {
    id: "repo-1",
    owner: "demo",
    name: "repo",
    branch: "main",
    displayName: "demo/repo",
    description: null,
    sourceType: "github",
    localPath: null,
    lastSyncedAt: null,
  },
};

const baseContext = {
  sourceArtifact: {
    artifactId: "artifact-1",
    artifactType: "STORY",
    artifactName: "从工件发起任务",
    filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md",
    hierarchy: [
      { id: "artifact-1", type: "STORY", name: "从工件发起任务" },
    ],
  },
  title: "从工件发起任务",
  goal: "围绕 Story《从工件发起任务》发起执行任务。",
  summary: "Story 摘要",
  detailMarkdown: "# Story 2.2",
  acceptanceCriteria: ["用户可以创建任务"],
  relatedStoryIds: ["2.2"],
  suggestedPriority: "high",
  suggestedIntent: "implement",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedSession.mockResolvedValue({
    userId: "user-1",
    role: "user",
    email: "demo@example.com",
    name: "Demo",
  });
  mockRequireProjectAccess.mockResolvedValue({
    success: true,
    data: {
      project: {
        id: "cprojectid0000000000000001",
        workspaceId: "cworkspaceid0000000000001",
        name: "Demo Project",
        slug: "demo-project",
        status: "active",
      },
    },
  });
  mockGetWorkspaceById.mockResolvedValue({
    id: "cworkspaceid0000000000001",
    slug: "demo-workspace",
  });
  mockArtifactFindFirst.mockResolvedValue(baseArtifact);
  mockProjectFindFirst.mockResolvedValue(baseProject);
  mockCreateProjectContentProvider.mockResolvedValue(undefined);
  mockBuildTaskCreationContext.mockResolvedValue(baseContext);
  mockTaskCreate.mockResolvedValue({ id: "ctaskid00000000000000001" });
  mockAuditEventCreate.mockResolvedValue({ id: "audit-1" });
  mockTransaction.mockImplementation(async (callback: (tx: { task: { create: typeof mockTaskCreate }; auditEvent: { create: typeof mockAuditEventCreate } }) => unknown) =>
    callback({
      task: {
        create: mockTaskCreate as typeof mockTaskCreate,
      },
      auditEvent: {
        create: mockAuditEventCreate as typeof mockAuditEventCreate,
      },
    }));
  mockGetProjectArtifacts.mockResolvedValue([baseArtifact]);
  mockGetTaskHistoryCandidatesByProjectId.mockResolvedValue([
    {
      id: "ctaskid00000000000000001",
      sourceArtifactId: "artifact-1",
      title: "发起执行任务",
      status: "pending",
      currentStage: "任务已创建",
      nextStep: "下一步将进入执行派发阶段。",
      createdAt: new Date("2026-04-09T01:00:00.000Z"),
      metadata: {},
      sourceArtifact: {
        id: "artifact-1",
        type: "STORY",
        name: "从工件发起任务",
        filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md",
        parent: null,
      },
    },
  ]);
  mockApplyTaskTerminalStateWriteback.mockResolvedValue({
    taskId: "ctaskid00000000000000001",
    artifactId: "artifact-1",
    status: "done",
    currentStage: "执行完成",
    currentActivity: "正在回写执行摘要。",
    nextStep: "下一步可前往来源工件查看最新结果。",
    writeback: {
      id: "writeback-1",
      taskId: "ctaskid00000000000000001",
      artifactId: "artifact-1",
      outcome: "completed",
      writebackStatus: "succeeded",
      summary: "已完成结果回写",
      errorSummary: null,
      occurredAt: "2026-04-10T03:00:00.000Z",
      recoveryHint: "可继续进入评审或查看最新工件结果。",
      artifacts: [],
    },
  });
});

describe("getArtifactTaskHistoryAction", () => {
  it("returns validation error for invalid input", async () => {
    const result = await getArtifactTaskHistoryAction({
      workspaceId: undefined as unknown as string,
      projectId: undefined as unknown as string,
      artifactId: undefined as unknown as string,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns unauthorized when user is not logged in", async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const result = await getArtifactTaskHistoryAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns access error from permission guard", async () => {
    mockRequireProjectAccess.mockResolvedValue({ success: false, error: "权限不足", code: "FORBIDDEN" });

    const result = await getArtifactTaskHistoryAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("returns artifact-not-found when artifact does not belong to project", async () => {
    mockArtifactFindFirst.mockResolvedValue(null);

    const result = await getArtifactTaskHistoryAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("ARTIFACT_NOT_FOUND");
    }
  });

  it("returns read-only payload for unsupported artifact types", async () => {
    mockArtifactFindFirst.mockResolvedValue({
      id: "artifact-prd-1",
      type: "PRD",
      name: "产品需求文档",
      filePath: "_bmad-output/planning-artifacts/prd.md",
      parentId: null,
      metadata: null,
    });

    const result = await getArtifactTaskHistoryAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.viewType).toBe("unsupported");
      expect(result.data.supportsExecutionHistory).toBe(false);
      expect(result.data.items).toEqual([]);
      expect(result.data.storySummaries).toEqual([]);
    }
    expect(mockGetProjectArtifacts).not.toHaveBeenCalled();
    expect(mockGetTaskHistoryCandidatesByProjectId).not.toHaveBeenCalled();
  });

  it("loads Story execution history scoped by project and optional status", async () => {
    const result = await getArtifactTaskHistoryAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
      status: "pending",
    });

    expect(mockArtifactFindFirst).toHaveBeenCalledWith({
      where: {
        id: "cartifactid000000000000001",
        projectId: "cprojectid0000000000000001",
      },
      select: {
        id: true,
        type: true,
        name: true,
        filePath: true,
        parentId: true,
        metadata: true,
      },
    });
    expect(mockGetTaskHistoryCandidatesByProjectId).toHaveBeenCalledWith(
      "cprojectid0000000000000001",
      "pending",
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.viewType).toBe("story");
      expect(result.data.supportsDirectHistory).toBe(true);
      expect(result.data.supportsExecutionHistory).toBe(true);
      expect(result.data.items[0]).toMatchObject({
        taskId: "ctaskid00000000000000001",
        sourceArtifactName: "从工件发起任务",
        taskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/ctaskid00000000000000001",
        executionStartedAt: null,
        agentRuns: [],
        artifacts: [],
      });
    }
  });

  it("keeps Story history when the task still points to a deleted artifact row with the same story id", async () => {
    mockGetTaskHistoryCandidatesByProjectId.mockResolvedValue([
      {
        id: "task-stale-story-history",
        sourceArtifactId: "artifact-story-old",
        title: "旧 Story 执行任务",
        status: "done",
        currentStage: "已完成",
        nextStep: "查看来源工件",
        createdAt: new Date("2026-04-10T04:00:00.000Z"),
        metadata: {
          sourceContext: {
            artifactId: "artifact-story-old",
            artifactType: "STORY",
            artifactName: "旧 Story 2.2",
            filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact-old.md",
            relatedStoryIds: ["2.2"],
          },
          resultSummary: "历史任务仍应归并到当前 Story",
        },
        sourceArtifact: {
          id: "artifact-story-old",
          type: "STORY",
          name: "旧 Story 2.2",
          filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact-old.md",
          metadata: { storyId: "2.2", epicId: "2" },
          parent: null,
        },
        writebacks: [],
      },
    ]);

    const result = await getArtifactTaskHistoryAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.viewType).toBe("story");
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toMatchObject({
        taskId: "task-stale-story-history",
        sourceArtifactName: "旧 Story 2.2",
        resultSummary: "历史任务仍应归并到当前 Story",
      });
    }
  });

  it("loads Epic aggregate history across descendant stories", async () => {
    mockArtifactFindFirst.mockResolvedValue({
      id: "artifact-epic-1",
      type: "EPIC",
      name: "执行入口",
      filePath: "_bmad-output/planning-artifacts/epics.md#epic-2",
      parentId: "artifact-prd-1",
      metadata: { epicId: "2" },
    });
    mockGetProjectArtifacts.mockResolvedValue([
      {
        id: "artifact-epic-1",
        type: "EPIC",
        name: "执行入口",
        filePath: "_bmad-output/planning-artifacts/epics.md#epic-2",
        parentId: "artifact-prd-1",
        metadata: { epicId: "2" },
      },
      {
        id: "artifact-story-1",
        type: "STORY",
        name: "Story 2.3",
        filePath: "_bmad-output/implementation-artifacts/2-3-执行任务与来源工件的追踪映射.md",
        parentId: "artifact-epic-1",
        metadata: { storyId: "2.3", epicId: "2" },
      },
      {
        id: "artifact-story-2",
        type: "STORY",
        name: "Story 2.4",
        filePath: "_bmad-output/implementation-artifacts/2-4-查看工件关联的执行历史状态与产物.md",
        parentId: null,
        metadata: { storyId: "2.4", epicId: "2" },
      },
    ]);
    mockGetTaskHistoryCandidatesByProjectId.mockResolvedValue([
      {
        id: "task-story-1",
        sourceArtifactId: "artifact-story-1",
        title: "补齐 Story 历史视图",
        status: "review",
        currentStage: "等待评审",
        nextStep: "等待人工确认",
        createdAt: new Date("2026-04-10T01:00:00.000Z"),
        metadata: {
          executionStartedAt: "2026-04-10T01:05:00.000Z",
          executionResultSummary: "已补齐 Story 历史视图",
        },
        sourceArtifact: {
          id: "artifact-story-1",
          type: "STORY",
          name: "Story 2.3",
          filePath: "_bmad-output/implementation-artifacts/2-3-执行任务与来源工件的追踪映射.md",
          parent: null,
        },
      },
      {
        id: "task-story-2",
        sourceArtifactId: "artifact-story-2",
        title: "搭建 Epic 聚合视图",
        status: "in-progress",
        currentStage: "正在实现",
        nextStep: "补齐组件测试",
        createdAt: new Date("2026-04-10T02:00:00.000Z"),
        metadata: {
          currentActivity: "正在整理 Epic 聚合卡片",
        },
        sourceArtifact: {
          id: "artifact-story-2",
          type: "STORY",
          name: "Story 2.4",
          filePath: "_bmad-output/implementation-artifacts/2-4-查看工件关联的执行历史状态与产物.md",
          parent: null,
        },
      },
    ]);

    const result = await getArtifactTaskHistoryAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000099",
      status: "pending",
    });

    expect(mockGetProjectArtifacts).toHaveBeenCalledWith("cprojectid0000000000000001");
    expect(mockGetTaskHistoryCandidatesByProjectId).toHaveBeenCalledWith(
      "cprojectid0000000000000001",
      undefined,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.viewType).toBe("epic");
      expect(result.data.supportsDirectHistory).toBe(false);
      expect(result.data.supportsExecutionHistory).toBe(true);
      expect(result.data.statusDistribution).toEqual({
        completed: 1,
        inProgress: 1,
        dispatched: 0,
        pending: 0,
        failed: 0,
      });

      const reviewStory = result.data.storySummaries.find((item) => item.storyArtifactId === "artifact-story-1");
      const activeStory = result.data.storySummaries.find((item) => item.storyArtifactId === "artifact-story-2");

      expect(reviewStory).toMatchObject({
        storyName: "Story 2.3",
        aggregateStatus: "completed",
        taskCount: 1,
      });
      expect(activeStory).toMatchObject({
        storyName: "Story 2.4",
        aggregateStatus: "in-progress",
        taskCount: 1,
      });
      expect(reviewStory?.items[0]).toMatchObject({
        taskId: "task-story-1",
        artifacts: [],
        agentRuns: [],
      });
    }
  });
});

describe("getTaskCreationContextAction", () => {
  it("returns validation error for invalid input", async () => {
    const result = await getTaskCreationContextAction(
      undefined as unknown as string,
      undefined as unknown as string,
      undefined as unknown as string,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns unauthorized when user is not logged in", async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const result = await getTaskCreationContextAction(
      "cworkspaceid0000000000001",
      "cprojectid0000000000000001",
      "cartifactid000000000000001",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns source-not-found when artifact is missing", async () => {
    mockArtifactFindFirst.mockResolvedValue(null);

    const result = await getTaskCreationContextAction(
      "cworkspaceid0000000000001",
      "cprojectid0000000000000001",
      "cartifactid000000000000001",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("ARTIFACT_SOURCE_NOT_FOUND");
    }
  });

  it("scopes artifact lookup to the current project", async () => {
    await getTaskCreationContextAction(
      "cworkspaceid0000000000001",
      "cprojectid0000000000000001",
      "cartifactid000000000000001",
    );

    expect(mockArtifactFindFirst).toHaveBeenCalledWith({
      where: {
        id: "cartifactid000000000000001",
        projectId: "cprojectid0000000000000001",
        status: "active",
      },
      include: {
        parent: {
          include: {
            parent: {
              include: {
                parent: true,
              },
            },
          },
        },
      },
    });
  });

  it("returns a context payload for valid Story source", async () => {
    const result = await getTaskCreationContextAction(
      "cworkspaceid0000000000001",
      "cprojectid0000000000000001",
      "cartifactid000000000000001",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary).toBe("Story 摘要");
      expect(result.data.sourceArtifact.artifactId).toBe("artifact-1");
    }
  });
});

describe("createTaskAction", () => {
  it("returns validation error for malformed payload", async () => {
    const result = await createTaskAction({
      workspaceId: "bad",
      projectId: "bad",
      artifactId: "bad",
      title: "",
      goal: "",
      priority: "medium",
      intent: "implement",
      intentDetail: undefined,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns access error from permission guard", async () => {
    mockRequireProjectAccess.mockResolvedValue({ success: false, error: "权限不足", code: "FORBIDDEN" });

    const result = await createTaskAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
      title: "发起执行任务",
      goal: "推进 Story 2.2 实现",
      priority: "high",
      intent: "implement",
      intentDetail: undefined,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("creates a project-level planned task without source artifact", async () => {
    const result = await createTaskAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      goal: "补齐项目级手动新建任务链路",
      priority: "medium",
      intent: "implement",
      preferredAgentType: "auto",
      artifactId: undefined,
    });

    expect(result.success).toBe(true);
    expect(mockArtifactFindFirst).not.toHaveBeenCalled();
    expect(mockTaskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceArtifactId: null,
        status: "planned",
        currentStage: "已计划",
        title: "项目任务：补齐项目级手动新建任务链路",
        preferredAgentType: "auto",
        summary: "该任务由用户在项目上下文中手动创建，当前尚未关联来源工件。",
      }),
    });
    expect(mockTaskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          currentActivity: "任务已计划完成，当前尚未开始编码或启动执行。",
          creationMode: "manual-project",
        }),
      }),
    });
    expect(mockAuditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventName: "task.created",
        artifactId: null,
        payload: expect.objectContaining({
          sourceArtifactId: null,
          priority: "medium",
          preferredAgentType: "auto",
        }),
      }),
    });

    if (result.success) {
      expect(result.data.sourceArtifact).toBeNull();
      expect(result.data.status).toBe("planned");
    }
  });

  it("creates a source-linked planned task and returns immediate feedback payload", async () => {
    const result = await createTaskAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
      title: "发起执行任务",
      goal: "推进 Story 2.2 实现",
      priority: "high",
      intent: "implement",
      intentDetail: "优先补齐低摩擦表单交互。",
      preferredAgentType: "codex",
    });

    expect(result.success).toBe(true);
    expect(mockTaskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "cworkspaceid0000000000001",
        projectId: "cprojectid0000000000000001",
        sourceArtifactId: "artifact-1",
        title: "发起执行任务",
        goal: "推进 Story 2.2 实现",
        intentDetail: "优先补齐低摩擦表单交互。",
        preferredAgentType: "codex",
      }),
    });
    expect(mockTaskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          currentActivity: "任务已计划完成，当前尚未开始编码或启动执行。",
          sourceContext: {
            artifactId: "artifact-1",
            artifactType: "STORY",
            artifactName: "从工件发起任务",
            filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md",
            hierarchy: [
              { id: "artifact-1", type: "STORY", name: "从工件发起任务" },
            ],
            acceptanceCriteria: ["用户可以创建任务"],
            relatedStoryIds: ["2.2"],
          },
        }),
      }),
    });
    expect(mockAuditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventName: "task.created",
        artifactId: "artifact-1",
        payload: expect.objectContaining({
          sourceArtifactId: "artifact-1",
          intentDetail: "优先补齐低摩擦表单交互。",
          preferredAgentType: "codex",
        }),
      }),
    });

    if (result.success) {
      expect(result.data.taskId).toBe("ctaskid00000000000000001");
      expect(result.data.currentStage).toBe("已计划");
      expect(result.data.sourceArtifact?.artifactName).toBe("从工件发起任务");
    }
  });

  it("keeps the legacy artifact-only wrapper available", async () => {
    const result = await createTaskFromArtifactAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
      goal: "推进 Story 2.2 实现",
      priority: "high",
      intent: "implement",
      preferredAgentType: undefined,
    });

    expect(result.success).toBe(true);
    expect(mockArtifactFindFirst).toHaveBeenCalledTimes(1);
  });
});

describe("updateTaskTerminalStateAction", () => {
  it("returns validation error for malformed payload", async () => {
    const result = await updateTaskTerminalStateAction({
      workspaceId: "bad",
      projectId: "bad",
      taskId: "bad",
      status: "done",
      currentStage: "",
      nextStep: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns access error from permission guard", async () => {
    mockRequireProjectAccess.mockResolvedValue({ success: false, error: "权限不足", code: "FORBIDDEN" });

    const result = await updateTaskTerminalStateAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      taskId: "ctaskid00000000000000001",
      status: "done",
      currentStage: "执行完成",
      nextStep: "查看来源工件",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("returns writeback payload and revalidates affected paths", async () => {
    const result = await updateTaskTerminalStateAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      taskId: "ctaskid00000000000000001",
      status: "done",
      currentStage: "执行完成",
      nextStep: "查看来源工件",
      currentActivity: "正在回写执行摘要。",
      resultSummary: "已完成结果回写",
    });

    expect(mockApplyTaskTerminalStateWriteback).toHaveBeenCalledWith({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      taskId: "ctaskid00000000000000001",
      status: "done",
      currentStage: "执行完成",
      nextStep: "查看来源工件",
      currentActivity: "正在回写执行摘要。",
      resultSummary: "已完成结果回写",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.writeback?.writebackStatus).toBe("succeeded");
      expect(result.data.writeback?.summary).toBe("已完成结果回写");
    }
  });

  it("surfaces writeback service errors with sanitized Chinese copy", async () => {
    mockApplyTaskTerminalStateWriteback.mockRejectedValue(new WritebackServiceError("WRITEBACK_INVALID_STATE"));

    const result = await updateTaskTerminalStateAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      taskId: "ctaskid00000000000000001",
      status: "done",
      currentStage: "执行完成",
      nextStep: "查看来源工件",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("WRITEBACK_INVALID_STATE");
      expect(result.error).toBe("当前任务状态还不能回写执行结果。");
    }
  });
});
