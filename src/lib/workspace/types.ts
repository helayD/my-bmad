import type { Workspace, WorkspaceMembership } from "@/generated/prisma/client";
import { z } from "zod";

export interface EnsureWorkspaceResult {
  workspace: Workspace;
  membership: WorkspaceMembership;
  created: boolean;
}

export interface PersonalWorkspaceData {
  workspace: Pick<Workspace, "id" | "name" | "slug" | "type">;
  projects: ProjectListItem[];
}

export interface ProjectListItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  updatedAt: Date;
}

export type WorkspaceSummary = Pick<Workspace, "id" | "name" | "slug" | "type">;

export class ProjectLimitExceededError extends Error {
  currentCount: number;
  limit: number;

  constructor(currentCount: number, limit: number) {
    super(
      `活跃项目数已达上限（${limit}），当前活跃项目数：${currentCount}。`
    );
    this.name = "ProjectLimitExceededError";
    this.currentCount = currentCount;
    this.limit = limit;
  }
}

export const InvitationStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
} as const;

export const INVITATION_EXPIRY_DAYS = 7;

export interface MemberListItem {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  role: string;
  createdAt: Date;
}

export interface InvitationListItem {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  invitedByName: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export const inviteToWorkspaceInputSchema = z.object({
  workspaceId: z.string().cuid2(),
  email: z.string().email(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER", "AUDITOR"]).optional(),
});

export const removeWorkspaceMemberInputSchema = z.object({
  workspaceId: z.string().cuid2(),
  membershipId: z.string().cuid2(),
});

export const revokeInvitationInputSchema = z.object({
  workspaceId: z.string().cuid2(),
  invitationId: z.string().cuid2(),
});

export const acceptInvitationInputSchema = z.object({
  token: z.string().min(1),
});

export class MemberAlreadyExistsError extends Error {
  constructor(message?: string) {
    super(message ?? "Member already exists");
    this.name = "MemberAlreadyExistsError";
  }
}

export class InvitationExpiredError extends Error {
  constructor(message?: string) {
    super(message ?? "Invitation expired");
    this.name = "InvitationExpiredError";
  }
}

export class InvitationInvalidError extends Error {
  constructor(message?: string) {
    super(message ?? "Invitation invalid");
    this.name = "InvitationInvalidError";
  }
}

export class CannotRemoveSoleOwnerError extends Error {
  constructor(message?: string) {
    super(message ?? "Cannot remove sole owner");
    this.name = "CannotRemoveSoleOwnerError";
  }
}

export class SelfRemoveNotAllowedError extends Error {
  constructor(message?: string) {
    super(message ?? "Self remove not allowed");
    this.name = "SelfRemoveNotAllowedError";
  }
}

export const createTeamWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateTeamWorkspaceInput = z.infer<typeof createTeamWorkspaceInputSchema>;

export const createProjectInputSchema = z.object({
  workspaceId: z.string().cuid2(),
  name: z.string().trim().min(1).max(100),
  repoId: z.string().cuid2().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const archiveProjectInputSchema = z.object({
  projectId: z.string().cuid2(),
  workspaceId: z.string().cuid2(),
});

export const updateMemberRoleInputSchema = z.object({
  workspaceId: z.string().cuid2(),
  membershipId: z.string().cuid2(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER", "AUDITOR"]),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInputSchema>;

export class CannotAssignOwnerRoleError extends Error {
  constructor(message?: string) {
    super(message ?? "Cannot assign OWNER role");
    this.name = "CannotAssignOwnerRoleError";
  }
}

export class CannotChangeOwnRoleError extends Error {
  constructor(message?: string) {
    super(message ?? "Cannot change own role");
    this.name = "CannotChangeOwnRoleError";
  }
}

export interface WorkspaceGovernanceSettings {
  agentRoutingPreference: "auto" | "manual";
  maxConcurrentTasks: number;
  autoRecoveryEnabled: boolean;
  requireApprovalBeforeExecution: boolean;
  autoDispatchAfterPlanning: boolean;
}

export const workspaceGovernanceSettingsSchema = z.object({
  agentRoutingPreference: z.enum(["auto", "manual"]),
  maxConcurrentTasks: z.number().int().min(1).max(50),
  autoRecoveryEnabled: z.boolean(),
  requireApprovalBeforeExecution: z.boolean(),
  autoDispatchAfterPlanning: z.boolean(),
});

export const updateWorkspaceSettingsInputSchema = z.object({
  workspaceId: z.string().cuid2(),
  settings: workspaceGovernanceSettingsSchema,
});

export type UpdateWorkspaceSettingsInput = z.infer<typeof updateWorkspaceSettingsInputSchema>;
export type WorkspaceGovernanceSettingsInput = z.infer<typeof workspaceGovernanceSettingsSchema>;
