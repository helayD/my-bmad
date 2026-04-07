import type { WorkspaceRole } from "@/generated/prisma/client";

export const PERMISSIONS = {
  READ: ["OWNER", "ADMIN", "MEMBER", "VIEWER", "AUDITOR"] as string[],
  EXECUTE: ["OWNER", "ADMIN", "MEMBER"] as string[],
  GOVERN: ["OWNER", "ADMIN"] as string[],
};

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
