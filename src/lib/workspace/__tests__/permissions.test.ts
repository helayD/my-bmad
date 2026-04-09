import { describe, it, expect, vi, beforeEach } from "vitest";
import { hasPermission, canManageMembers, canChangeRole, isValidRole, ROLE_PERMISSIONS, requireWorkspaceAccess, requireProjectAccess } from "@/lib/workspace/permissions";

vi.mock("@/lib/db/helpers", () => ({
  getWorkspaceMembership: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
    },
  },
}));

import { getWorkspaceMembership } from "@/lib/db/helpers";
import { prisma } from "@/lib/db/client";

const mockGetMembership = getWorkspaceMembership as ReturnType<typeof vi.fn>;
const mockFindFirstProject = prisma.project.findFirst as ReturnType<typeof vi.fn>;

describe("hasPermission", () => {
  it("OWNER has READ permission", () => {
    expect(hasPermission("OWNER", "READ")).toBe(true);
  });

  it("AUDITOR does NOT have EXECUTE permission (AC #3)", () => {
    expect(hasPermission("AUDITOR", "EXECUTE")).toBe(false);
  });

  it("VIEWER does NOT have EXECUTE permission (AC #2)", () => {
    expect(hasPermission("VIEWER", "EXECUTE")).toBe(false);
  });

  it("MEMBER has EXECUTE permission (AC #4)", () => {
    expect(hasPermission("MEMBER", "EXECUTE")).toBe(true);
  });

  it("MEMBER does NOT have GOVERN permission (AC #4)", () => {
    expect(hasPermission("MEMBER", "GOVERN")).toBe(false);
  });

  it("ADMIN has GOVERN permission", () => {
    expect(hasPermission("ADMIN", "GOVERN")).toBe(true);
  });

  it("AUDITOR has READ permission", () => {
    expect(hasPermission("AUDITOR", "READ")).toBe(true);
  });

  it("VIEWER has READ permission", () => {
    expect(hasPermission("VIEWER", "READ")).toBe(true);
  });
});

describe("canManageMembers", () => {
  it("OWNER can manage members", () => {
    expect(canManageMembers("OWNER")).toBe(true);
  });

  it("ADMIN can manage members", () => {
    expect(canManageMembers("ADMIN")).toBe(true);
  });

  it("MEMBER cannot manage members", () => {
    expect(canManageMembers("MEMBER")).toBe(false);
  });

  it("VIEWER cannot manage members", () => {
    expect(canManageMembers("VIEWER")).toBe(false);
  });
});

describe("canChangeRole", () => {
  it("OWNER can assign OWNER", () => {
    expect(canChangeRole("OWNER", "OWNER")).toBe(true);
  });

  it("OWNER can assign MEMBER", () => {
    expect(canChangeRole("OWNER", "MEMBER")).toBe(true);
  });

  it("ADMIN cannot assign OWNER", () => {
    expect(canChangeRole("ADMIN", "OWNER")).toBe(false);
  });

  it("ADMIN can assign MEMBER", () => {
    expect(canChangeRole("ADMIN", "MEMBER")).toBe(true);
  });

  it("ADMIN can assign ADMIN", () => {
    expect(canChangeRole("ADMIN", "ADMIN")).toBe(true);
  });

  it("MEMBER cannot change roles", () => {
    expect(canChangeRole("MEMBER", "ADMIN")).toBe(false);
  });

  it("VIEWER cannot change roles", () => {
    expect(canChangeRole("VIEWER", "MEMBER")).toBe(false);
  });

  it("AUDITOR cannot change roles", () => {
    expect(canChangeRole("AUDITOR", "MEMBER")).toBe(false);
  });
});

describe("ROLE_PERMISSIONS", () => {
  it("all five roles have read=true", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER", "AUDITOR"] as const) {
      expect(ROLE_PERMISSIONS[role].read).toBe(true);
    }
  });

  it("OWNER and ADMIN have execute=true and govern=true", () => {
    expect(ROLE_PERMISSIONS.OWNER.execute).toBe(true);
    expect(ROLE_PERMISSIONS.OWNER.govern).toBe(true);
    expect(ROLE_PERMISSIONS.ADMIN.execute).toBe(true);
    expect(ROLE_PERMISSIONS.ADMIN.govern).toBe(true);
  });

  it("MEMBER has execute=true but govern=false", () => {
    expect(ROLE_PERMISSIONS.MEMBER.execute).toBe(true);
    expect(ROLE_PERMISSIONS.MEMBER.govern).toBe(false);
  });

  it("VIEWER and AUDITOR have execute=false and govern=false", () => {
    expect(ROLE_PERMISSIONS.VIEWER.execute).toBe(false);
    expect(ROLE_PERMISSIONS.VIEWER.govern).toBe(false);
    expect(ROLE_PERMISSIONS.AUDITOR.execute).toBe(false);
    expect(ROLE_PERMISSIONS.AUDITOR.govern).toBe(false);
  });
});

describe("requireWorkspaceAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns FORBIDDEN when user has no membership", async () => {
    mockGetMembership.mockResolvedValue(null);
    const result = await requireWorkspaceAccess("ws-1", "user-1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("returns success for MEMBER with default read level", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "MEMBER" });
    const result = await requireWorkspaceAccess("ws-1", "user-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("MEMBER");
      expect(result.data.permissions.read).toBe(true);
    }
  });

  it("returns FORBIDDEN for VIEWER requesting execute level", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "VIEWER" });
    const result = await requireWorkspaceAccess("ws-1", "user-1", "execute");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("returns FORBIDDEN for MEMBER requesting govern level", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "MEMBER" });
    const result = await requireWorkspaceAccess("ws-1", "user-1", "govern");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("returns success for ADMIN requesting govern level", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "ADMIN" });
    const result = await requireWorkspaceAccess("ws-1", "user-1", "govern");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("ADMIN");
      expect(result.data.permissions.govern).toBe(true);
    }
  });

  it("returns success for OWNER requesting govern level", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "OWNER" });
    const result = await requireWorkspaceAccess("ws-1", "user-1", "govern");
    expect(result.success).toBe(true);
  });
});

describe("requireProjectAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns FORBIDDEN when user has no workspace membership", async () => {
    mockGetMembership.mockResolvedValue(null);
    const result = await requireProjectAccess("ws-1", "proj-1", "user-1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("returns NOT_FOUND when project does not belong to workspace", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "MEMBER" });
    mockFindFirstProject.mockResolvedValue(null);
    const result = await requireProjectAccess("ws-1", "proj-1", "user-1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("NOT_FOUND");
    }
  });

  it("returns success with project data when project belongs to workspace", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "MEMBER" });
    mockFindFirstProject.mockResolvedValue({ id: "proj-1", workspaceId: "ws-1", name: "Test", slug: "test", status: "active" });
    const result = await requireProjectAccess("ws-1", "proj-1", "user-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project.id).toBe("proj-1");
      expect(result.data.project.workspaceId).toBe("ws-1");
    }
  });

  it("returns FORBIDDEN for VIEWER requesting execute level project access", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "VIEWER" });
    const result = await requireProjectAccess("ws-1", "proj-1", "user-1", "execute");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("returns FORBIDDEN for MEMBER requesting govern level project access", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "MEMBER" });
    const result = await requireProjectAccess("ws-1", "proj-1", "user-1", "govern");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("enforces workspaceId filter in project query", async () => {
    mockGetMembership.mockResolvedValue({ id: "m-1", workspaceId: "ws-1", userId: "user-1", role: "MEMBER" });
    mockFindFirstProject.mockResolvedValue(null);
    await requireProjectAccess("ws-1", "proj-1", "user-1");
    expect(mockFindFirstProject).toHaveBeenCalledWith({
      where: { id: "proj-1", workspaceId: "ws-1" },
      select: { id: true, workspaceId: true, name: true, slug: true, status: true },
    });
  });
});

describe("isValidRole", () => {
  it("OWNER is valid", () => {
    expect(isValidRole("OWNER")).toBe(true);
  });

  it("ADMIN is valid", () => {
    expect(isValidRole("ADMIN")).toBe(true);
  });

  it("MEMBER is valid", () => {
    expect(isValidRole("MEMBER")).toBe(true);
  });

  it("VIEWER is valid", () => {
    expect(isValidRole("VIEWER")).toBe(true);
  });

  it("AUDITOR is valid", () => {
    expect(isValidRole("AUDITOR")).toBe(true);
  });

  it("SUPERUSER is NOT valid", () => {
    expect(isValidRole("SUPERUSER")).toBe(false);
  });

  it("empty string is NOT valid", () => {
    expect(isValidRole("")).toBe(false);
  });
});
