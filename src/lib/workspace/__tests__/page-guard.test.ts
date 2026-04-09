import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNotFound = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: (...args: unknown[]) => {
    mockNotFound(...args);
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/db/helpers", () => ({
  getAuthenticatedSession: vi.fn(),
  getWorkspaceBySlug: vi.fn(),
  getWorkspaceMembership: vi.fn(),
}));

import { getAuthenticatedSession, getWorkspaceBySlug, getWorkspaceMembership } from "@/lib/db/helpers";
import { guardWorkspacePage } from "@/lib/workspace/page-guard";

const mockGetSession = getAuthenticatedSession as ReturnType<typeof vi.fn>;
const mockGetWorkspace = getWorkspaceBySlug as ReturnType<typeof vi.fn>;
const mockGetMembership = getWorkspaceMembership as ReturnType<typeof vi.fn>;

describe("guardWorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls notFound when user is not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(guardWorkspacePage("my-ws")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("calls notFound when workspace does not exist", async () => {
    mockGetSession.mockResolvedValue({ userId: "u-1", role: "user", email: "a@b.com", name: "A" });
    mockGetWorkspace.mockResolvedValue(null);
    await expect(guardWorkspacePage("missing-ws")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("calls notFound when user is not a member", async () => {
    mockGetSession.mockResolvedValue({ userId: "u-1", role: "user", email: "a@b.com", name: "A" });
    mockGetWorkspace.mockResolvedValue({ id: "ws-1", slug: "my-ws", type: "TEAM", name: "My WS", projects: [] });
    mockGetMembership.mockResolvedValue(null);
    await expect(guardWorkspacePage("my-ws")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("returns session, workspace, membership, role, isTeam=true, canManage=true for OWNER of TEAM workspace", async () => {
    const session = { userId: "u-1", role: "user", email: "a@b.com", name: "A" };
    const workspace = { id: "ws-1", slug: "my-ws", type: "TEAM", name: "My WS", projects: [] };
    const membership = { id: "m-1", workspaceId: "ws-1", userId: "u-1", role: "OWNER" };
    mockGetSession.mockResolvedValue(session);
    mockGetWorkspace.mockResolvedValue(workspace);
    mockGetMembership.mockResolvedValue(membership);

    const result = await guardWorkspacePage("my-ws");
    expect(result.session).toBe(session);
    expect(result.workspace).toBe(workspace);
    expect(result.membership).toBe(membership);
    expect(result.role).toBe("OWNER");
    expect(result.isTeam).toBe(true);
    expect(result.canManage).toBe(true);
  });

  it("returns isTeam=false for PERSONAL workspace", async () => {
    mockGetSession.mockResolvedValue({ userId: "u-1", role: "user", email: "a@b.com", name: "A" });
    mockGetWorkspace.mockResolvedValue({ id: "ws-1", slug: "personal", type: "PERSONAL", name: "Personal", projects: [] });
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "u-1", role: "OWNER" });

    const result = await guardWorkspacePage("personal");
    expect(result.isTeam).toBe(false);
  });

  it("returns canManage=false for MEMBER role", async () => {
    mockGetSession.mockResolvedValue({ userId: "u-1", role: "user", email: "a@b.com", name: "A" });
    mockGetWorkspace.mockResolvedValue({ id: "ws-1", slug: "my-ws", type: "TEAM", name: "My WS", projects: [] });
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "u-1", role: "MEMBER" });

    const result = await guardWorkspacePage("my-ws");
    expect(result.canManage).toBe(false);
  });

  it("returns canManage=true for ADMIN role", async () => {
    mockGetSession.mockResolvedValue({ userId: "u-1", role: "user", email: "a@b.com", name: "A" });
    mockGetWorkspace.mockResolvedValue({ id: "ws-1", slug: "my-ws", type: "TEAM", name: "My WS", projects: [] });
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "u-1", role: "ADMIN" });

    const result = await guardWorkspacePage("my-ws");
    expect(result.canManage).toBe(true);
  });

  it("returns canManage=false for VIEWER role", async () => {
    mockGetSession.mockResolvedValue({ userId: "u-1", role: "user", email: "a@b.com", name: "A" });
    mockGetWorkspace.mockResolvedValue({ id: "ws-1", slug: "my-ws", type: "TEAM", name: "My WS", projects: [] });
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "u-1", role: "VIEWER" });

    const result = await guardWorkspacePage("my-ws");
    expect(result.canManage).toBe(false);
  });
});
