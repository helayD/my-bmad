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

const mockPlanningRequestCreate = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    planningRequest: {
      create: mockPlanningRequestCreate,
    },
  },
}));

const { revalidatePath } = await import("next/cache");
const { getAuthenticatedSession, getWorkspaceById } = await import("@/lib/db/helpers");
const { requireProjectAccess } = await import("@/lib/workspace/permissions");
const { getRecentPlanningRequestsByProjectId } = await import("@/lib/planning/queries");
const {
  createPlanningRequestAction,
  getPlanningRequestsAction,
} = await import("./planning-actions");

const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;
const mockGetAuthenticatedSession = getAuthenticatedSession as ReturnType<typeof vi.fn>;
const mockGetWorkspaceById = getWorkspaceById as ReturnType<typeof vi.fn>;
const mockRequireProjectAccess = requireProjectAccess as ReturnType<typeof vi.fn>;
const mockGetRecentPlanningRequestsByProjectId = getRecentPlanningRequestsByProjectId as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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
  mockPlanningRequestCreate.mockResolvedValue({
    id: "planning-1",
    rawGoal: "为项目添加用户反馈收集功能",
    status: "analyzing",
    progressPercent: 10,
    nextStep: "等待系统识别规划意图并选择 PM Agent 与 Skills",
    createdAt: new Date("2026-04-11T00:20:00.000Z"),
    createdByUser: {
      id: "user-1",
      name: "Demo",
      email: "demo@example.com",
    },
  });
  mockGetRecentPlanningRequestsByProjectId.mockResolvedValue([
    {
      id: "planning-1",
      rawGoal: "为项目添加用户反馈收集功能",
      status: "analyzing",
      progressPercent: 10,
      nextStep: "等待系统识别规划意图并选择 PM Agent 与 Skills",
      createdAt: "2026-04-11T00:20:00.000Z",
      createdByUser: {
        id: "user-1",
        name: "Demo",
        email: "demo@example.com",
      },
    },
  ]);
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
    expect(mockGetRecentPlanningRequestsByProjectId).toHaveBeenCalledWith("cprojectid0000000000000001", 5);

    if (result.success) {
      expect(result.data.requests).toHaveLength(1);
      expect(result.data.requests[0]?.rawGoal).toBe("为项目添加用户反馈收集功能");
    }
  });
});
