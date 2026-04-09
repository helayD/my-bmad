import type { WorkspaceMembership, WorkspaceRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getWorkspaceMembership } from "@/lib/db/helpers";
import { sanitizeError } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";

export const PERMISSIONS = {
  READ: ["OWNER", "ADMIN", "MEMBER", "VIEWER", "AUDITOR"] as string[],
  EXECUTE: ["OWNER", "ADMIN", "MEMBER"] as string[],
  GOVERN: ["OWNER", "ADMIN"] as string[],
};

/**
 * Role-permission matrix: read / execute / govern per workspace role.
 */
export const ROLE_PERMISSIONS: Record<WorkspaceRole, { read: boolean; execute: boolean; govern: boolean }> = {
  OWNER:   { read: true,  execute: true,  govern: true  },
  ADMIN:   { read: true,  execute: true,  govern: true  },
  MEMBER:  { read: true,  execute: true,  govern: false },
  VIEWER:  { read: true,  execute: false, govern: false },
  AUDITOR: { read: true,  execute: false, govern: false },
};

export type PermissionLevel = "read" | "execute" | "govern";

interface WorkspaceAccessData {
  membership: WorkspaceMembership;
  role: WorkspaceRole;
  permissions: { read: boolean; execute: boolean; govern: boolean };
}

/**
 * Check that a user has workspace access at the requested permission level.
 * Returns FORBIDDEN if user is not a member or lacks the required level.
 */
export async function requireWorkspaceAccess(
  workspaceId: string,
  userId: string,
  level: PermissionLevel = "read"
): Promise<ActionResult<WorkspaceAccessData>> {
  const membership = await getWorkspaceMembership(workspaceId, userId);
  if (!membership) {
    return { success: false, error: sanitizeError(null, "WORKSPACE_ACCESS_DENIED"), code: "FORBIDDEN" };
  }

  const role = membership.role as WorkspaceRole;
  const permissions = ROLE_PERMISSIONS[role];

  if (!permissions[level]) {
    return { success: false, error: sanitizeError(null, "INSUFFICIENT_PERMISSION"), code: "FORBIDDEN" };
  }

  return { success: true, data: { membership, role, permissions } };
}

interface ProjectAccessData extends WorkspaceAccessData {
  project: { id: string; workspaceId: string; name: string; slug: string; status: string };
}

/**
 * Check that a user has project access within a workspace.
 * Validates workspace membership first, then verifies the project belongs to the workspace.
 * MVP: all workspace members can access all projects — projectId filter reserved for future ACL.
 */
export async function requireProjectAccess(
  workspaceId: string,
  projectId: string,
  userId: string,
  level: PermissionLevel = "read"
): Promise<ActionResult<ProjectAccessData>> {
  const wsResult = await requireWorkspaceAccess(workspaceId, userId, level);
  if (!wsResult.success) return wsResult;

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true, workspaceId: true, name: true, slug: true, status: true },
  });

  if (!project) {
    return { success: false, error: sanitizeError(null, "PROJECT_ACCESS_DENIED"), code: "NOT_FOUND" };
  }

  return { success: true, data: { ...wsResult.data, project } };
}

export function hasPermission(role: string, permission: keyof typeof PERMISSIONS): boolean {
  return PERMISSIONS[permission].includes(role);
}

export function canManageMembers(role: string): boolean {
  return hasPermission(role, "GOVERN");
}

export function canChangeRole(actorRole: string, targetRole: string): boolean {
  if (actorRole === "OWNER") {
    return true;
  }
  if (actorRole === "ADMIN") {
    return targetRole !== "OWNER";
  }
  return false;
}

const VALID_ROLES: readonly string[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER", "AUDITOR"];

export function isValidRole(role: string): role is WorkspaceRole {
  return VALID_ROLES.includes(role);
}

/**
 * API Route Handler 权限检查模式（供后续 Epic 2+ 实现参考）：
 *
 * 1. 认证：从 Bearer token 或 session cookie 提取 userId
 * 2. 从请求中提取 workspaceId（path param 或 body）
 * 3. 调用 requireWorkspaceAccess(workspaceId, userId, level) 检查权限
 * 4. 所有数据库查询必须包含 workspaceId 过滤条件
 */
