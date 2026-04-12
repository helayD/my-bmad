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

vi.mock("@/lib/planning/queries", () => ({
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
    artifactSummary: true,
    generatedArtifactCount: true,
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
const {
  analyzePlanningRequestAction,
  createPlanningRequestAction,
  executePlanningRequestAction,
  getPlanningRequestsAction,
  retryAnalyzePlanningRequestAction,
} = await import("./planning-actions");

const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;
const mockGetAuthenticatedSession = getAuthenticatedSession as ReturnType<typeof vi.fn>;
const mockGetWorkspaceById = getWorkspaceById as ReturnType<typeof vi.fn>;
const mockRequireProjectAccess = requireProjectAccess as ReturnType<typeof vi.fn>;
const mockGetRecentPlanningRequests = getRecentPlanningRequestsByProjectId as ReturnType<typeof vi.fn>;

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
  artifactSummary: [],
  generatedArtifactCount: 0,
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
