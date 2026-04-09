import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db/helpers", () => ({
  getAuthenticatedSession: vi.fn(),
  getTasksBySourceArtifactId: vi.fn(),
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
  getInitialTaskLifecycle: vi.fn(() => ({
    status: "pending",
    currentStage: "任务已创建",
    currentActivity: "系统正在整理工件上下文。",
    nextStep: "下一步将进入执行派发阶段。",
  })),
}));

const mockArtifactFindFirst = vi.fn();
const mockProjectFindFirst = vi.fn();
const mockTaskCreate = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    bmadArtifact: {
      findFirst: (...args: unknown[]) => mockArtifactFindFirst(...args),
    },
    project: {
      findFirst: (...args: unknown[]) => mockProjectFindFirst(...args),
    },
    task: {
      create: (...args: unknown[]) => mockTaskCreate(...args),
    },
  },
}));

const { getAuthenticatedSession } = await import("@/lib/db/helpers");
const { getTasksBySourceArtifactId } = await import("@/lib/db/helpers");
const { requireProjectAccess } = await import("@/lib/workspace/permissions");
const { createProjectContentProvider } = await import("@/lib/content-provider/project-provider");
const { buildTaskCreationContext } = await import("@/lib/tasks/context");
const { getArtifactTaskHistoryAction, getTaskCreationContextAction, createTaskFromArtifactAction } = await import("./task-actions");

const mockGetAuthenticatedSession = getAuthenticatedSession as ReturnType<typeof vi.fn>;
const mockGetTasksBySourceArtifactId = getTasksBySourceArtifactId as ReturnType<typeof vi.fn>;
const mockRequireProjectAccess = requireProjectAccess as ReturnType<typeof vi.fn>;
const mockCreateProjectContentProvider = createProjectContentProvider as ReturnType<typeof vi.fn>;
const mockBuildTaskCreationContext = buildTaskCreationContext as ReturnType<typeof vi.fn>;

const baseArtifact = {
  id: "artifact-1",
  projectId: "cprojectid0000000000000001",
  status: "active",
  type: "STORY",
  name: "从工件发起任务",
  filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md",
  metadata: { storyId: "2.2", epicId: "2" },
  parent: null,
};

const baseProject = {
  id: "cprojectid0000000000000001",
  workspaceId: "cworkspaceid0000000000001",
  slug: "demo-project",
  workspace: { slug: "demo-workspace" },
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
  mockArtifactFindFirst.mockResolvedValue(baseArtifact);
  mockProjectFindFirst.mockResolvedValue(baseProject);
  mockCreateProjectContentProvider.mockResolvedValue(undefined);
  mockBuildTaskCreationContext.mockResolvedValue(baseContext);
  mockTaskCreate.mockResolvedValue({ id: "ctaskid00000000000000001" });
  mockGetTasksBySourceArtifactId.mockResolvedValue([
    {
      id: "ctaskid00000000000000001",
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

  it("returns read-only hint for non-story artifact", async () => {
    mockArtifactFindFirst.mockResolvedValue({
      id: "artifact-epic-1",
      type: "EPIC",
      name: "执行入口",
    });

    const result = await getArtifactTaskHistoryAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supportsDirectHistory).toBe(false);
      expect(result.data.items).toEqual([]);
    }
    expect(mockGetTasksBySourceArtifactId).not.toHaveBeenCalled();
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
      },
    });
    expect(mockGetTasksBySourceArtifactId).toHaveBeenCalledWith(
      "cprojectid0000000000000001",
      "cartifactid000000000000001",
      "pending",
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supportsDirectHistory).toBe(true);
      expect(result.data.items[0]).toMatchObject({
        taskId: "ctaskid00000000000000001",
        sourceArtifactName: "从工件发起任务",
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

describe("createTaskFromArtifactAction", () => {
  it("returns validation error for malformed payload", async () => {
    const result = await createTaskFromArtifactAction({
      workspaceId: "bad",
      projectId: "bad",
      artifactId: "bad",
      title: "",
      goal: "",
      priority: "medium",
      intent: "implement",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns access error from permission guard", async () => {
    mockRequireProjectAccess.mockResolvedValue({ success: false, error: "权限不足", code: "FORBIDDEN" });

    const result = await createTaskFromArtifactAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
      title: "发起执行任务",
      goal: "推进 Story 2.2 实现",
      priority: "high",
      intent: "implement",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("creates a task and returns immediate feedback payload", async () => {
    const result = await createTaskFromArtifactAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: "cartifactid000000000000001",
      title: "发起执行任务",
      goal: "推进 Story 2.2 实现",
      priority: "high",
      intent: "implement",
    });

    expect(result.success).toBe(true);
    expect(mockTaskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "cworkspaceid0000000000001",
        projectId: "cprojectid0000000000000001",
        sourceArtifactId: "artifact-1",
        title: "发起执行任务",
        goal: "推进 Story 2.2 实现",
      }),
    });

    if (result.success) {
      expect(result.data.taskId).toBe("ctaskid00000000000000001");
      expect(result.data.currentStage).toBe("任务已创建");
      expect(result.data.sourceArtifact.artifactName).toBe("从工件发起任务");
    }
  });
});
