import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db/helpers", () => ({
  getAuthenticatedSession: vi.fn(),
  getWorkspaceById: vi.fn(),
}));

vi.mock("@/lib/workspace/permissions", () => ({
  requireProjectAccess: vi.fn(),
}));

const mockGetGovernanceSettings = vi.fn();

vi.mock("@/lib/workspace/update-workspace-settings", () => ({
  getGovernanceSettings: mockGetGovernanceSettings,
}));

vi.mock("@/lib/planning/queries", () => ({
  getPlanningRequestDetailById: vi.fn(),
  getRecentPlanningRequestsByProjectId: vi.fn(),
  mapPlanningRequestListItem: vi.fn((record: unknown) => record),
  planningRequestListItemSelect: {
    id: true,
    rawGoal: true,
    status: true,
    progressPercent: true,
    nextStep: true,
    routeType: true,
    selectionReasonCode: true,
    selectionReasonSummary: true,
    selectedAgentKeys: true,
    selectedSkillKeys: true,
    analyzedAt: true,
    executionHandoffDraft: true,
    executionStartedAt: true,
    executionCompletedAt: true,
    executionFailedAt: true,
    confirmedAt: true,
    artifactSummary: true,
    taskHandoffSummary: true,
    generatedArtifactCount: true,
    derivedTaskCount: true,
    deferredArtifactCount: true,
    lastExecutionErrorCode: true,
    executionSteps: {
      orderBy: [{ sequence: "asc" }],
      select: {
        id: true,
        skillKey: true,
        stepKey: true,
        sequence: true,
        status: true,
        title: true,
        startedAt: true,
        completedAt: true,
        failedAt: true,
        errorCode: true,
        errorMessage: true,
        outputSummary: true,
        artifactPaths: true,
        retryCount: true,
      },
    },
    createdAt: true,
    updatedAt: true,
    createdByUser: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
  },
}));

const mockExecutePlanningRequest = vi.fn();

vi.mock("@/lib/planning/execution", () => ({
  executePlanningRequest: mockExecutePlanningRequest,
}));

const mockGetPlanningRequestHandoffPreview = vi.fn();
const mockConfirmPlanningRequestHandoff = vi.fn();

vi.mock("@/lib/planning/handoff", () => ({
  getPlanningRequestHandoffPreview: mockGetPlanningRequestHandoffPreview,
  confirmPlanningRequestHandoff: mockConfirmPlanningRequestHandoff,
  PlanningHandoffServiceError: class PlanningHandoffServiceError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.name = "PlanningHandoffServiceError";
      this.code = code;
    }
  },
}));

const mockPlanningRequestCreate = vi.fn();
const mockPlanningRequestFindFirst = vi.fn();
const mockPlanningRequestUpdateMany = vi.fn();
const mockProjectFindFirst = vi.fn();
const mockAuditEventCreate = vi.fn();
const mockTxPlanningRequestUpdateMany = vi.fn();
const mockTxPlanningRequestFindUnique = vi.fn();
const mockTxAuditEventCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    planningRequest: {
      create: mockPlanningRequestCreate,
      findFirst: mockPlanningRequestFindFirst,
      updateMany: mockPlanningRequestUpdateMany,
    },
    project: {
      findFirst: mockProjectFindFirst,
    },
    auditEvent: {
      create: mockAuditEventCreate,
    },
    $transaction: mockTransaction,
  },
}));

const { revalidatePath } = await import("next/cache");
const { getAuthenticatedSession, getWorkspaceById } = await import("@/lib/db/helpers");
const { requireProjectAccess } = await import("@/lib/workspace/permissions");
const { getRecentPlanningRequestsByProjectId } = await import("@/lib/planning/queries");
const { getPlanningRequestDetailById } = await import("@/lib/planning/queries");
const { PlanningHandoffServiceError } = await import("@/lib/planning/handoff");
const {
  analyzePlanningRequestAction,
  confirmPlanningRequestAction,
  createPlanningRequestAction,
  executePlanningRequestAction,
  getPlanningRequestDetailAction,
  getPlanningRequestHandoffPreviewAction,
  getPlanningRequestsAction,
  retryAnalyzePlanningRequestAction,
} = await import("./planning-actions");

const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;
const mockGetAuthenticatedSession = getAuthenticatedSession as ReturnType<typeof vi.fn>;
const mockGetWorkspaceById = getWorkspaceById as ReturnType<typeof vi.fn>;
const mockRequireProjectAccess = requireProjectAccess as ReturnType<typeof vi.fn>;
const mockGetRecentPlanningRequests = getRecentPlanningRequestsByProjectId as ReturnType<typeof vi.fn>;
const mockGetPlanningRequestDetailById = getPlanningRequestDetailById as ReturnType<typeof vi.fn>;

const basePlanningRequest = {
  id: "planning-1",
  rawGoal: "为项目添加用户反馈收集功能",
  status: "analyzing",
  progressPercent: 10,
  nextStep: "等待系统识别规划意图并选择 PM Agent 与 Skills",
  routeType: null,
  selectionReasonCode: null,
  selectionReasonSummary: null,
  selectedAgentKeys: [],
  selectedSkillKeys: [],
  analyzedAt: null,
  executionHandoffDraft: null,
  executionStartedAt: null,
  executionCompletedAt: null,
  executionFailedAt: null,
  confirmedAt: null,
  artifactSummary: [],
  taskHandoffSummary: null,
  generatedArtifactCount: 0,
  derivedTaskCount: 0,
  deferredArtifactCount: 0,
  lastExecutionErrorCode: null,
  executionSteps: [],
  createdAt: new Date("2026-04-11T00:20:00.000Z"),
  createdByUser: {
    id: "user-1",
    name: "Demo",
    email: "demo@example.com",
  },
};

beforeEach(() => {
  vi.resetAllMocks();

  mockGetAuthenticatedSession.mockResolvedValue({
    userId: "user-1",
    role: "user",
    email: "demo@example.com",
    name: "Demo",
  });
  mockGetWorkspaceById.mockResolvedValue({
    id: "cworkspaceid0000000000001",
    slug: "demo-workspace",
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
  mockProjectFindFirst.mockResolvedValue({
    id: "cprojectid0000000000000001",
    name: "Demo Project",
    slug: "demo-project",
    repoId: "repo-1",
    repo: {
      id: "repo-1",
      owner: "demo",
      name: "repo",
      branch: "main",
      displayName: "Demo Repo",
      description: null,
      sourceType: "local",
      localPath: "/tmp/demo",
      lastSyncedAt: null,
    },
  });
  mockPlanningRequestCreate.mockResolvedValue(basePlanningRequest);
  mockPlanningRequestFindFirst.mockResolvedValue(basePlanningRequest);
  mockPlanningRequestUpdateMany.mockResolvedValue({ count: 1 });
  mockAuditEventCreate.mockResolvedValue({
    id: "audit-fallback",
  });
  mockGetRecentPlanningRequests.mockResolvedValue([
    {
      ...basePlanningRequest,
      createdAt: "2026-04-11T00:20:00.000Z",
    },
  ]);
  mockGetPlanningRequestDetailById.mockResolvedValue({
    request: {
      ...basePlanningRequest,
      createdAt: "2026-04-11T00:20:00.000Z",
    },
    problem: {
      stage: "execution-ready",
      severity: "info",
      title: "已衔接到执行准备",
      reason: "已进入执行准备态，当前可见 1 个衍生任务，但尚未开始编码。",
      nextAction: "查看执行准备",
    },
    artifacts: [
      {
        path: "_bmad-output/planning-artifacts/prd.md",
        title: "PRD 草案",
        kind: "prd",
        summary: "已生成 PRD。",
        sourceSkillKey: "bmad-create-prd",
        status: "created",
        artifactId: "artifact-prd-1",
        artifactName: "PRD 草案",
      },
    ],
    derivedTasks: [],
    deferredArtifacts: [],
  });
  mockGetGovernanceSettings.mockResolvedValue({
    agentRoutingPreference: "auto",
    maxConcurrentTasks: 5,
    autoRecoveryEnabled: true,
    requireApprovalBeforeExecution: false,
    autoDispatchAfterPlanning: false,
  });
  mockGetPlanningRequestHandoffPreview.mockResolvedValue({
    planningRequestId: "planning-1",
    dispatchMode: "manual",
    approvalRequired: false,
    candidateTaskCount: 2,
    storyCount: 1,
    groups: [
      {
        storyArtifactId: "artifact-story-1",
        storyTitle: "Story 3.4",
        storyFilePath: "_bmad-output/implementation-artifacts/3-4-story.md",
        storyId: "3.4",
        tasks: [
          {
            artifactId: "artifact-task-1",
            artifactName: "落地用户反馈入口",
            filePath: "_bmad-output/implementation-artifacts/3-4-story.md#task-1",
            storyArtifactId: "artifact-story-1",
            storyTitle: "Story 3.4",
            storyFilePath: "_bmad-output/implementation-artifacts/3-4-story.md",
            order: 1,
          },
        ],
      },
    ],
  });
  mockConfirmPlanningRequestHandoff.mockResolvedValue({
    didConfirm: true,
    createdTaskIds: ["task-1"],
    summary: {
      source: "planning-request-handoff",
      confirmedAt: "2026-04-11T00:30:00.000Z",
      dispatchMode: "manual",
      approvalRequired: false,
      candidateTaskCount: 1,
      createdTaskCount: 1,
      deferredArtifactCount: 0,
      deduplicatedTaskCount: 0,
      createdTasks: [],
      deferredArtifacts: [],
    },
  });
  mockTxPlanningRequestUpdateMany.mockResolvedValue({ count: 1 });
  mockTxPlanningRequestFindUnique.mockResolvedValue({
    ...basePlanningRequest,
    status: "planning",
    progressPercent: 45,
    nextStep: "已进入规划链路，下一步将先整理 PRD，再拆分 Epics 与 Stories。",
    routeType: "planning",
    selectionReasonCode: "new-feature-or-product-scope",
    selectionReasonSummary: "目标包含新功能建设或产品范围扩展，需要先进入规划链路拆解需求与工件。",
    selectedAgentKeys: ["bmad-agent-pm"],
    selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
    analyzedAt: new Date("2026-04-11T00:21:00.000Z"),
    executionHandoffDraft: null,
    artifactSummary: [],
    executionSteps: [],
  });
  mockTxAuditEventCreate.mockResolvedValue({
    id: "audit-1",
  });
  mockExecutePlanningRequest.mockResolvedValue({ didExecute: true });
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      planningRequest: {
        updateMany: mockTxPlanningRequestUpdateMany,
        findUnique: mockTxPlanningRequestFindUnique,
      },
      auditEvent: {
        create: mockTxAuditEventCreate,
      },
    }),
  );
});

describe("createPlanningRequestAction", () => {
  it("returns unauthorized when user is not logged in", async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const result = await createPlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      rawGoal: "为项目添加用户反馈收集功能",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNAUTHORIZED");
      expect(result.error).toBe("未登录，请先登录。");
    }
  });

  it("returns project access error when project does not match workspace permission scope", async () => {
    mockRequireProjectAccess.mockResolvedValue({
      success: false,
      error: "您没有访问此项目的权限。",
      code: "PROJECT_ACCESS_DENIED",
    });

    const result = await createPlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      rawGoal: "为项目添加用户反馈收集功能",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PROJECT_ACCESS_DENIED");
      expect(result.error).toBe("您没有访问此项目的权限。");
    }
  });

  it("rejects blank input with a Chinese validation message", async () => {
    const result = await createPlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      rawGoal: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PLANNING_REQUEST_GOAL_REQUIRED");
      expect(result.error).toContain("请输入明确的目标描述");
    }
  });

  it("rejects goals shorter than the minimum rule", async () => {
    const result = await createPlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      rawGoal: "做功能",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PLANNING_REQUEST_GOAL_TOO_SHORT");
    }
  });

  it("creates a planning request and revalidates the project page without requiring audit writes", async () => {
    const result = await createPlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      rawGoal: "为项目添加用户反馈收集功能",
    });

    expect(result.success).toBe(true);
    expect(mockRequireProjectAccess).toHaveBeenCalledWith(
      "cworkspaceid0000000000001",
      "cprojectid0000000000000001",
      "user-1",
      "execute",
    );
    expect(mockPlanningRequestCreate).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/workspace/demo-workspace/project/demo-project");

    if (result.success) {
      expect(result.data.request.status).toBe("analyzing");
      expect(result.data.request.progressPercent).toBe(10);
      expect(result.data.request.nextStep).toContain("等待系统识别规划意图");
    }
  });
});

describe("analyzePlanningRequestAction", () => {
  it("returns permission error when user lacks execute access", async () => {
    mockRequireProjectAccess.mockResolvedValue({
      success: false,
      error: "您的角色权限不足，无法执行此操作。",
      code: "FORBIDDEN",
    });

    const result = await analyzePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("您的角色权限不足，无法执行此操作。");
    }
  });

  it("returns not found when the planning request does not exist", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue(null);

    const result = await analyzePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-missing",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PLANNING_REQUEST_NOT_FOUND");
      expect(result.error).toBe("找不到指定的规划请求记录。");
    }
  });

  it("returns an idempotent no-op result when the request has already been analyzed", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue({
      ...basePlanningRequest,
      status: "planning",
      routeType: "planning",
      selectionReasonCode: "new-feature-or-product-scope",
      selectionReasonSummary: "目标包含新功能建设或产品范围扩展，需要先进入规划链路拆解需求与工件。",
      selectedAgentKeys: ["bmad-agent-pm"],
      selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
      analyzedAt: new Date("2026-04-11T00:21:00.000Z"),
    });

    const result = await analyzePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.didAnalyze).toBe(false);
      expect(result.data.request.status).toBe("planning");
    }
  });

  it("persists the analysis result, writes an audit event and revalidates the exact project path", async () => {
    const result = await analyzePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxPlanningRequestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "planning-1",
          status: "analyzing",
        }),
        data: expect.objectContaining({
          routeType: "planning",
          selectionReasonCode: "new-feature-or-product-scope",
          selectedAgentKeys: ["bmad-agent-pm"],
          selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
        }),
      }),
    );
    expect(mockTxAuditEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          planningRequestId: "planning-1",
          eventName: "planningRequest.intentResolved",
        }),
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/workspace/demo-workspace/project/demo-project");

    if (result.success) {
      expect(result.data.didAnalyze).toBe(true);
      expect(result.data.request.status).toBe("planning");
    }
  });

  it("stores only a handoff draft for direct execution and does not create tasks", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue({
      ...basePlanningRequest,
      rawGoal: "修复登录页面的按钮颜色",
    });
    mockTxPlanningRequestFindUnique.mockResolvedValue({
      ...basePlanningRequest,
      rawGoal: "修复登录页面的按钮颜色",
      status: "execution-ready",
      progressPercent: 40,
      nextStep: "将跳过 BMAD 规划，进入执行任务定义与派发准备阶段。",
      routeType: "direct-execution",
      selectionReasonCode: "small-scoped-repo-change",
      selectionReasonSummary: "目标已明确为小范围代码改动，且项目具备仓库上下文，可直接进入执行准备阶段。",
      selectedAgentKeys: [],
      selectedSkillKeys: [],
      analyzedAt: new Date("2026-04-11T00:21:00.000Z"),
      executionHandoffDraft: {
        source: "planning-request",
        suggestedGoal: "修复登录页面的按钮颜色",
        suggestedSummary: "修复登录页面的按钮颜色",
        suggestedIntent: "fix",
        requiresRepo: true,
      },
    });

    const result = await analyzePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    expect(mockTxPlanningRequestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routeType: "direct-execution",
          selectedAgentKeys: [],
          selectedSkillKeys: [],
          executionHandoffDraft: expect.objectContaining({
            source: "planning-request",
            suggestedIntent: "fix",
          }),
        }),
      }),
    );
    expect(mockAuditEventCreate).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.request.status).toBe("execution-ready");
      expect(result.data.request.executionHandoffDraft).toEqual(
        expect.objectContaining({
          suggestedGoal: "修复登录页面的按钮颜色",
          suggestedIntent: "fix",
        }),
      );
    }
  });
});

describe("retryAnalyzePlanningRequestAction", () => {
  it("resets failed requests to analyzing and reruns analysis", async () => {
    mockPlanningRequestFindFirst
      .mockResolvedValueOnce({
        ...basePlanningRequest,
        status: "analyzing",
      })
      .mockResolvedValueOnce({
        ...basePlanningRequest,
        status: "planning",
        routeType: "planning",
        selectionReasonCode: "new-feature-or-product-scope",
        selectionReasonSummary: "目标包含新功能建设或产品范围扩展，需要先进入规划链路拆解需求与工件。",
        selectedAgentKeys: ["bmad-agent-pm"],
        selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
        analyzedAt: new Date("2026-04-11T00:21:00.000Z"),
      });

    const result = await retryAnalyzePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    expect(mockPlanningRequestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "planning-1",
          status: "failed",
        }),
      }),
    );
  });
});

describe("executePlanningRequestAction", () => {
  it("rejects execution when the planning request has not finished analysis", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue({
      ...basePlanningRequest,
      status: "analyzing",
      routeType: null,
    });

    const result = await executePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PLANNING_REQUEST_EXECUTION_NOT_READY");
    }
  });

  it("degrades honestly when the project has no linked repo", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue({
      ...basePlanningRequest,
      status: "planning",
      routeType: "planning",
      selectedSkillKeys: ["bmad-create-prd"],
    });
    mockProjectFindFirst.mockResolvedValue({
      id: "cprojectid0000000000000001",
      name: "Demo Project",
      slug: "demo-project",
      repoId: null,
      repo: null,
    });

    const result = await executePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PLANNING_REPO_REQUIRED");
      expect(result.error).toContain("尚未关联仓库");
    }
  });

  it("executes the controlled planning pipeline and returns the refreshed request", async () => {
    const planningRequest = {
      ...basePlanningRequest,
      status: "planning",
      routeType: "planning",
      selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
    };
    mockPlanningRequestFindFirst
      .mockResolvedValueOnce(planningRequest)
      .mockResolvedValueOnce({
        ...planningRequest,
        status: "awaiting-confirmation",
        progressPercent: 90,
        nextStep: "规划产出已生成，可查看摘要、编辑工件并确认后进入后续执行链路。",
        generatedArtifactCount: 2,
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
      });

    const result = await executePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    expect(mockExecutePlanningRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        planningRequestId: "planning-1",
        selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
      }),
    );
    if (result.success) {
      expect(result.data.didExecute).toBe(true);
      expect(result.data.request.status).toBe("awaiting-confirmation");
      expect(result.data.request.generatedArtifactCount).toBe(2);
    }
  });

  it("returns the latest failed request state when execution fails after persisting step status", async () => {
    const planningRequest = {
      ...basePlanningRequest,
      status: "planning",
      routeType: "planning",
      selectedSkillKeys: ["bmad-create-prd"],
    };
    mockPlanningRequestFindFirst
      .mockResolvedValueOnce(planningRequest)
      .mockResolvedValueOnce({
        ...planningRequest,
        status: "failed",
        nextStep: "规划执行在某一步失败。你可以重试失败步骤，或调整目标后重新规划。",
        lastExecutionErrorCode: "PLANNING_ARTIFACT_WRITE_ERROR",
        executionSteps: [
          {
            id: "step-1",
            skillKey: "bmad-create-prd",
            stepKey: "generate-prd",
            sequence: 1,
            status: "failed",
            title: "生成 PRD 工件",
            startedAt: new Date("2026-04-11T00:21:00.000Z"),
            completedAt: null,
            failedAt: new Date("2026-04-11T00:22:00.000Z"),
            errorCode: "PLANNING_ARTIFACT_WRITE_ERROR",
            errorMessage: "规划工件写入失败，请检查仓库连接或本地目录权限后重试。",
            outputSummary: null,
            artifactPaths: [],
            retryCount: 0,
          },
        ],
      });
    mockExecutePlanningRequest.mockRejectedValueOnce(
      new Error("planning execution failed"),
    );

    const result = await executePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.didExecute).toBe(false);
      expect(result.data.request.status).toBe("failed");
      expect(result.data.request.executionSteps[0]?.status).toBe("failed");
    }
  });

  it("surfaces bootstrap execution failures when the request state did not change", async () => {
    const planningRequest = {
      ...basePlanningRequest,
      status: "planning",
      routeType: "planning",
      selectedSkillKeys: ["bmad-create-prd"],
    };
    mockPlanningRequestFindFirst
      .mockResolvedValueOnce(planningRequest)
      .mockResolvedValueOnce(planningRequest);
    mockExecutePlanningRequest.mockRejectedValueOnce(
      new Error("provider bootstrap failed"),
    );

    const result = await executePlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PLANNING_REQUEST_EXECUTE_ERROR");
      expect(result.error).toBe("规划执行失败，请稍后重试。");
    }
  });
});

describe("getPlanningRequestHandoffPreviewAction", () => {
  it("rejects preview requests outside awaiting-confirmation planning flow", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue({
      ...basePlanningRequest,
      status: "planning",
      routeType: "planning",
    });

    const result = await getPlanningRequestHandoffPreviewAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PLANNING_REQUEST_CONFIRMATION_NOT_READY");
    }
  });

  it("loads handoff preview with governance settings for awaiting-confirmation requests", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue({
      ...basePlanningRequest,
      status: "awaiting-confirmation",
      progressPercent: 90,
      routeType: "planning",
      nextStep: "规划产出已生成，可查看摘要、编辑工件并确认后进入后续执行链路。",
      artifactSummary: [
        {
          path: "_bmad-output/implementation-artifacts/3-4-story.md",
          title: "Story 3.4",
          kind: "story-stub",
          summary: "已生成实现 Story stub。",
          sourceSkillKey: "bmad-create-epics-and-stories",
          status: "created",
          storyId: "3.4",
          epicId: "3",
        },
      ],
    });

    const result = await getPlanningRequestHandoffPreviewAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    expect(mockGetGovernanceSettings).toHaveBeenCalledWith("cworkspaceid0000000000001");
    expect(mockGetPlanningRequestHandoffPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "cprojectid0000000000000001",
        planningRequest: expect.objectContaining({
          id: "planning-1",
        }),
      }),
    );
    if (result.success) {
      expect(result.data.preview.candidateTaskCount).toBe(2);
      expect(result.data.request.status).toBe("awaiting-confirmation");
    }
  });
});

describe("getPlanningRequestDetailAction", () => {
  it("rejects invalid input with zod-backed validation errors", async () => {
    const result = await getPlanningRequestDetailAction({
      workspaceId: "",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns unauthorized when the viewer is not logged in", async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const result = await getPlanningRequestDetailAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNAUTHORIZED");
      expect(result.error).toBe("未登录，请先登录。");
    }
  });

  it("enforces project read access before loading the detail view", async () => {
    mockRequireProjectAccess.mockResolvedValue({
      success: false,
      error: "您没有访问此项目的权限。",
      code: "PROJECT_ACCESS_DENIED",
    });

    const result = await getPlanningRequestDetailAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PROJECT_ACCESS_DENIED");
    }
  });

  it("returns not found when the requested planning record cannot be loaded", async () => {
    mockGetPlanningRequestDetailById.mockResolvedValueOnce(null);

    const result = await getPlanningRequestDetailAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-missing",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PLANNING_REQUEST_NOT_FOUND");
    }
  });

  it("returns an honest direct-execution detail view without fabricated planning steps", async () => {
    mockGetPlanningRequestDetailById.mockResolvedValueOnce({
      request: {
        ...basePlanningRequest,
        createdAt: "2026-04-11T00:20:00.000Z",
        status: "execution-ready",
        routeType: "direct-execution",
        nextStep: "将跳过 BMAD 规划，进入执行任务定义与派发准备阶段。",
      },
      problem: {
        stage: "execution-ready",
        severity: "info",
        title: "直接进入执行准备",
        reason: "此请求跳过了 BMAD 规划，当前仅进入执行准备态，尚未开始编码。",
        nextAction: "查看执行准备",
      },
      artifacts: [],
      derivedTasks: [],
      deferredArtifacts: [],
    });

    const result = await getPlanningRequestDetailAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.detail.request.routeType).toBe("direct-execution");
      expect(result.data.detail.problem?.title).toBe("直接进入执行准备");
      expect(result.data.detail.artifacts).toEqual([]);
    }
  });

  it("returns failed-detail payloads with the highlighted failed stage", async () => {
    mockGetPlanningRequestDetailById.mockResolvedValueOnce({
      request: {
        ...basePlanningRequest,
        createdAt: "2026-04-11T00:20:00.000Z",
        status: "failed",
      },
      problem: {
        stage: "execution-failed",
        severity: "critical",
        title: "失败步骤：生成 PRD 工件",
        reason: "规划工件写入失败，请检查仓库连接或本地目录权限后重试。",
        nextAction: "重试失败步骤",
      },
      artifacts: [],
      derivedTasks: [],
      deferredArtifacts: [],
    });

    const result = await getPlanningRequestDetailAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.detail.problem?.stage).toBe("execution-failed");
      expect(result.data.detail.problem?.nextAction).toBe("重试失败步骤");
    }
  });

  it("returns execution-ready details with derived task visibility", async () => {
    mockGetPlanningRequestDetailById.mockResolvedValueOnce({
      request: {
        ...basePlanningRequest,
        createdAt: "2026-04-11T00:20:00.000Z",
        status: "execution-ready",
        routeType: "planning",
        derivedTaskCount: 1,
      },
      problem: {
        stage: "execution-ready",
        severity: "info",
        title: "已衔接到执行准备",
        reason: "已进入执行准备态，当前可见 1 个衍生任务，但尚未开始编码。",
        nextAction: "查看执行准备",
      },
      artifacts: [],
      derivedTasks: [
        {
          taskId: "task-1",
          title: "Task《落地用户反馈入口》",
          status: "planned",
          currentStage: "已计划",
          nextStep: "等待手动派发。",
          queuePosition: 1,
          readyState: "manual",
          sourceArtifactId: "artifact-task-1",
          sourceArtifactName: "落地用户反馈入口",
          sourceArtifactPath: "_bmad-output/implementation-artifacts/3-5-story.md#task-1",
          storyArtifactId: "artifact-story-1",
          storyTitle: "Story 3.5",
          isLegacyPending: false,
        },
      ],
      deferredArtifacts: [],
    });

    const result = await getPlanningRequestDetailAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.detail.derivedTasks[0]?.taskId).toBe("task-1");
      expect(result.data.detail.problem?.stage).toBe("execution-ready");
    }
  });
});

describe("confirmPlanningRequestAction", () => {
  it("returns the latest handoff result without recreating tasks when request is already execution-ready", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue({
      ...basePlanningRequest,
      status: "execution-ready",
      routeType: "planning",
      taskHandoffSummary: {
        source: "planning-request-handoff",
        confirmedAt: "2026-04-11T00:30:00.000Z",
        dispatchMode: "manual",
        approvalRequired: false,
        candidateTaskCount: 1,
        createdTaskCount: 1,
        deferredArtifactCount: 0,
        deduplicatedTaskCount: 0,
        createdTasks: [],
        deferredArtifacts: [],
      },
      derivedTaskCount: 1,
    });

    const result = await confirmPlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(true);
    expect(mockConfirmPlanningRequestHandoff).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.didConfirm).toBe(false);
      expect(result.data.request.status).toBe("execution-ready");
    }
  });

  it("confirms planning handoff, passes deferred artifact ids and revalidates task detail paths", async () => {
    mockPlanningRequestFindFirst
      .mockResolvedValueOnce({
        ...basePlanningRequest,
        status: "awaiting-confirmation",
        progressPercent: 90,
        routeType: "planning",
        nextStep: "规划产出已生成，可查看摘要、编辑工件并确认后进入后续执行链路。",
        artifactSummary: [
          {
            path: "_bmad-output/implementation-artifacts/3-4-story.md",
            title: "Story 3.4",
            kind: "story-stub",
            summary: "已生成实现 Story stub。",
            sourceSkillKey: "bmad-create-epics-and-stories",
            status: "created",
            storyId: "3.4",
            epicId: "3",
          },
        ],
      })
      .mockResolvedValueOnce({
        ...basePlanningRequest,
        status: "execution-ready",
        progressPercent: 100,
        routeType: "planning",
        confirmedAt: new Date("2026-04-11T00:30:00.000Z"),
        nextStep: "已确认规划结果并生成执行任务，当前等待手动派发，尚未开始编码。",
        derivedTaskCount: 1,
        deferredArtifactCount: 1,
        taskHandoffSummary: {
          source: "planning-request-handoff",
          confirmedAt: "2026-04-11T00:30:00.000Z",
          dispatchMode: "manual",
          approvalRequired: false,
          candidateTaskCount: 2,
          createdTaskCount: 1,
          deferredArtifactCount: 1,
          deduplicatedTaskCount: 0,
          createdTasks: [],
          deferredArtifacts: [],
        },
      });

    const result = await confirmPlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
      deferredArtifactIds: ["artifact-story-1"],
    });

    expect(result.success).toBe(true);
    expect(mockConfirmPlanningRequestHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        planningRequestId: "planning-1",
        deferredArtifactIds: ["artifact-story-1"],
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/workspace/demo-workspace/project/demo-project");
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/workspace/demo-workspace/project/demo-project/tasks/task-1",
    );
    if (result.success) {
      expect(result.data.didConfirm).toBe(true);
      expect(result.data.request.status).toBe("execution-ready");
      expect(result.data.request.derivedTaskCount).toBe(1);
    }
  });

  it("surfaces honest no-task feedback when planning output has no executable task artifacts", async () => {
    mockPlanningRequestFindFirst.mockResolvedValue({
      ...basePlanningRequest,
      status: "awaiting-confirmation",
      routeType: "planning",
    });
    mockConfirmPlanningRequestHandoff.mockRejectedValueOnce(
      new PlanningHandoffServiceError("PLANNING_REQUEST_NO_EXECUTABLE_TASKS"),
    );

    const result = await confirmPlanningRequestAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PLANNING_REQUEST_NO_EXECUTABLE_TASKS");
    }
  });
});

describe("getPlanningRequestsAction", () => {
  it("returns permission error when user lacks project read access", async () => {
    mockRequireProjectAccess.mockResolvedValue({
      success: false,
      error: "您没有访问此项目的权限。",
      code: "PROJECT_ACCESS_DENIED",
    });

    const result = await getPlanningRequestsAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("您没有访问此项目的权限。");
    }
  });

  it("returns recent planning requests with read permission", async () => {
    const result = await getPlanningRequestsAction({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
    });

    expect(result.success).toBe(true);
    expect(mockRequireProjectAccess).toHaveBeenCalledWith(
      "cworkspaceid0000000000001",
      "cprojectid0000000000000001",
      "user-1",
      "read",
    );
    expect(mockGetRecentPlanningRequests).toHaveBeenCalledWith("cprojectid0000000000000001", 5);

    if (result.success) {
      expect(result.data.requests).toHaveLength(1);
      expect(result.data.requests[0]?.rawGoal).toBe("为项目添加用户反馈收集功能");
    }
  });
});
