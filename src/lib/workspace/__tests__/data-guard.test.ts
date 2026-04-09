import { describe, it, expect, vi, beforeEach } from "vitest";
import { scopedProjectQuery, getAccessibleWorkspaceIds } from "@/lib/workspace/data-guard";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    workspaceMembership: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/client";

const mockFindMany = prisma.workspaceMembership.findMany as ReturnType<typeof vi.fn>;

describe("scopedProjectQuery", () => {
  it("returns an object with workspaceId property", () => {
    const result = scopedProjectQuery("ws-123");
    expect(result).toEqual({ workspaceId: "ws-123" });
  });

  it("returned object is readonly (as const)", () => {
    const result = scopedProjectQuery("ws-abc");
    expect(result.workspaceId).toBe("ws-abc");
  });
});

describe("getAccessibleWorkspaceIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when user has no memberships", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await getAccessibleWorkspaceIds("user-1");
    expect(result).toEqual([]);
  });

  it("returns workspace IDs from user memberships", async () => {
    mockFindMany.mockResolvedValue([
      { workspaceId: "ws-1" },
      { workspaceId: "ws-2" },
      { workspaceId: "ws-3" },
    ]);
    const result = await getAccessibleWorkspaceIds("user-1");
    expect(result).toEqual(["ws-1", "ws-2", "ws-3"]);
  });

  it("queries with correct userId filter", async () => {
    mockFindMany.mockResolvedValue([]);
    await getAccessibleWorkspaceIds("user-42");
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: "user-42" },
      select: { workspaceId: true },
    });
  });
});
