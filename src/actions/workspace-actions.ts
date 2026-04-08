"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession, getWorkspaceMembership, getWorkspaceById } from "@/lib/db/helpers";
import { sanitizeError } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import {
  type ProjectListItem,
  type WorkspaceSummary,
  type InvitationListItem,
  type UpdateMemberRoleInput,
  type UpdateWorkspaceSettingsInput,
  type WorkspaceGovernanceSettingsInput,
  ProjectLimitExceededError,
  MemberAlreadyExistsError,
  InvitationExpiredError,
  InvitationInvalidError,
  CannotRemoveSoleOwnerError,
  SelfRemoveNotAllowedError,
  CannotAssignOwnerRoleError,
  CannotChangeOwnRoleError,
  createTeamWorkspaceInputSchema,
  createProjectInputSchema,
  archiveProjectInputSchema,
  inviteToWorkspaceInputSchema,
  removeWorkspaceMemberInputSchema,
  revokeInvitationInputSchema,
  acceptInvitationInputSchema,
  updateMemberRoleInputSchema,
  updateWorkspaceSettingsInputSchema,
} from "@/lib/workspace/types";
import { createTeamWorkspace } from "@/lib/workspace/create-team-workspace";
import { createProject } from "@/lib/workspace/create-project";
import { archiveProject } from "@/lib/workspace/archive-project";
import { inviteMember } from "@/lib/workspace/invite-member";
import { acceptInvitation } from "@/lib/workspace/accept-invitation";
import { removeMember } from "@/lib/workspace/remove-member";
import { revokeInvitation } from "@/lib/workspace/revoke-invitation";
import { updateMemberRole } from "@/lib/workspace/update-member-role";
import { updateWorkspaceSettings, getGovernanceSettings } from "@/lib/workspace/update-workspace-settings";

const workspaceIdSchema = z.string().cuid2();

/**
 * Get governance settings for a workspace. Any member can read.
 */
export async function getWorkspaceSettingsAction(
  workspaceId: string
): Promise<ActionResult<WorkspaceGovernanceSettingsInput>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = z.string().cuid2().safeParse(workspaceId);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const membership = await getWorkspaceMembership(parsed.data, session.userId);
    if (!membership) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    const settings = await getGovernanceSettings(parsed.data);
    return { success: true, data: settings };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "SETTINGS_READ_ERROR"), code: "SETTINGS_READ_ERROR" };
  }
}

/**
 * Update governance settings for a TEAM workspace. Requires OWNER or ADMIN role.
 */
export async function updateWorkspaceSettingsAction(
  input: UpdateWorkspaceSettingsInput
): Promise<ActionResult<null>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = updateWorkspaceSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const actorMembership = await getWorkspaceMembership(parsed.data.workspaceId, session.userId);
    if (!actorMembership || !["OWNER", "ADMIN"].includes(actorMembership.role)) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    await updateWorkspaceSettings({
      workspaceId: parsed.data.workspaceId,
      settings: parsed.data.settings,
      actorUserId: session.userId,
    });

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (workspace) {
      revalidatePath(`/workspace/${workspace.slug}/settings`);
    }

    return { success: true, data: null };
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "TEAM_WORKSPACE_REQUIRED") {
      return { success: false, error: sanitizeError(error, "TEAM_WORKSPACE_REQUIRED"), code: "TEAM_WORKSPACE_REQUIRED" };
    }
    return { success: false, error: sanitizeError(error, "SETTINGS_UPDATE_ERROR"), code: "SETTINGS_UPDATE_ERROR" };
  }
}

/**
 * Update a workspace member's role. Requires OWNER or ADMIN role.
 */
export async function updateMemberRoleAction(
  input: UpdateMemberRoleInput
): Promise<ActionResult<{ membershipId: string; role: string }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = updateMemberRoleInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const actorMembership = await getWorkspaceMembership(parsed.data.workspaceId, session.userId);
    if (!actorMembership || !["OWNER", "ADMIN"].includes(actorMembership.role)) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    await updateMemberRole({
      workspaceId: parsed.data.workspaceId,
      membershipId: parsed.data.membershipId,
      newRole: parsed.data.role,
      actorUserId: session.userId,
      actorRole: actorMembership.role,
    });

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (workspace) {
      revalidatePath(`/workspace/${workspace.slug}/members`);
    }

    return { success: true, data: { membershipId: parsed.data.membershipId, role: parsed.data.role } };
  } catch (error: unknown) {
    if (error instanceof CannotAssignOwnerRoleError) {
      return { success: false, error: sanitizeError(error, "CANNOT_ASSIGN_OWNER_ROLE"), code: "CANNOT_ASSIGN_OWNER_ROLE" };
    }
    if (error instanceof CannotChangeOwnRoleError) {
      return { success: false, error: sanitizeError(error, "CANNOT_CHANGE_OWN_ROLE"), code: "CANNOT_CHANGE_OWN_ROLE" };
    }
    if (error instanceof CannotRemoveSoleOwnerError) {
      return { success: false, error: sanitizeError(error, "CANNOT_REMOVE_SOLE_OWNER"), code: "CANNOT_REMOVE_SOLE_OWNER" };
    }
    return { success: false, error: sanitizeError(error, "ROLE_UPDATE_ERROR"), code: "ROLE_UPDATE_ERROR" };
  }
}

/**
 * Invite a user to a TEAM workspace by email. Requires OWNER or ADMIN role.
 */
export async function inviteToWorkspaceAction(
  input: { workspaceId: string; email: string; role?: string }
): Promise<ActionResult<{ invitation: InvitationListItem }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = inviteToWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const membership = await getWorkspaceMembership(parsed.data.workspaceId, session.userId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (!workspace) {
      return { success: false, error: "Workspace not found", code: "NOT_FOUND" };
    }
    if (workspace.type !== "TEAM") {
      return { success: false, error: "Only TEAM workspaces support invitations", code: "FORBIDDEN" };
    }

    const [inv, inviterUser] = await Promise.all([
      inviteMember({
        workspaceId: parsed.data.workspaceId,
        email: parsed.data.email,
        invitedByUserId: session.userId,
        role: parsed.data.role as Parameters<typeof inviteMember>[0]["role"],
      }),
      prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } }),
    ]);

    revalidatePath(`/workspace/${workspace.slug}/members`);
    return {
      success: true,
      data: {
        invitation: {
          id: inv.id,
          email: inv.email,
          role: inv.role,
          status: inv.status,
          token: inv.token,
          invitedByName: inviterUser?.name ?? null,
          createdAt: inv.createdAt,
          expiresAt: inv.expiresAt,
        },
      },
    };
  } catch (error: unknown) {
    if (error instanceof MemberAlreadyExistsError) {
      return { success: false, error: sanitizeError(error, "MEMBER_ALREADY_EXISTS"), code: "MEMBER_ALREADY_EXISTS" };
    }
    return { success: false, error: sanitizeError(error, "INVITATION_ERROR"), code: "INVITATION_ERROR" };
  }
}

/**
 * Accept a workspace invitation by token. Must be authenticated.
 */
export async function acceptInvitationAction(
  input: { token: string }
): Promise<ActionResult<{ workspaceSlug: string }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = acceptInvitationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const result = await acceptInvitation({ token: parsed.data.token, userId: session.userId });
    revalidatePath("/");
    return { success: true, data: { workspaceSlug: result.workspace.slug } };
  } catch (error: unknown) {
    if (error instanceof InvitationExpiredError) {
      return { success: false, error: sanitizeError(error, "INVITATION_EXPIRED"), code: "INVITATION_EXPIRED" };
    }
    if (error instanceof InvitationInvalidError) {
      return { success: false, error: sanitizeError(error, "INVITATION_INVALID"), code: "INVITATION_INVALID" };
    }
    return { success: false, error: sanitizeError(error, "INVITATION_ERROR"), code: "INVITATION_ERROR" };
  }
}

/**
 * Remove a member from a workspace. Requires OWNER or ADMIN role.
 */
export async function removeMemberAction(
  input: { workspaceId: string; membershipId: string }
): Promise<ActionResult<null>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = removeWorkspaceMemberInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const membership = await getWorkspaceMembership(parsed.data.workspaceId, session.userId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    await removeMember({
      workspaceId: parsed.data.workspaceId,
      membershipId: parsed.data.membershipId,
      actorUserId: session.userId,
    });

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (workspace) {
      revalidatePath(`/workspace/${workspace.slug}/members`);
    }
    return { success: true, data: null };
  } catch (error: unknown) {
    if (error instanceof CannotRemoveSoleOwnerError) {
      return { success: false, error: sanitizeError(error, "CANNOT_REMOVE_SOLE_OWNER"), code: "CANNOT_REMOVE_SOLE_OWNER" };
    }
    if (error instanceof SelfRemoveNotAllowedError) {
      return { success: false, error: sanitizeError(error, "SELF_REMOVE_NOT_ALLOWED"), code: "SELF_REMOVE_NOT_ALLOWED" };
    }
    return { success: false, error: sanitizeError(error, "MEMBER_ERROR"), code: "MEMBER_ERROR" };
  }
}

/**
 * Revoke a pending workspace invitation. Requires OWNER or ADMIN role.
 */
export async function revokeInvitationAction(
  input: { workspaceId: string; invitationId: string }
): Promise<ActionResult<null>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = revokeInvitationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const membership = await getWorkspaceMembership(parsed.data.workspaceId, session.userId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    await revokeInvitation({
      workspaceId: parsed.data.workspaceId,
      invitationId: parsed.data.invitationId,
    });

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (workspace) {
      revalidatePath(`/workspace/${workspace.slug}/members`);
    }
    return { success: true, data: null };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "INVITATION_ERROR"), code: "INVITATION_ERROR" };
  }
}

/**
 * Get all projects for a workspace the current user has access to.
 * Returns projects sorted by updatedAt descending.
 */
export async function getWorkspaceProjects(
  workspaceId: string
): Promise<ActionResult<ProjectListItem[]>> {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid workspace ID",
      code: "VALIDATION_ERROR",
    };
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  try {
    const membership = await prisma.workspaceMembership.findFirst({
      where: { workspaceId: parsed.data, userId: session.userId },
    });

    if (!membership) {
      return {
        success: false,
        error: "Access denied",
        code: "FORBIDDEN",
      };
    }

    const projects = await prisma.project.findMany({
      where: { workspaceId: parsed.data },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return { success: true, data: projects };
  } catch (error: unknown) {
    return {
      success: false,
      error: sanitizeError(error, "WORKSPACE_ERROR"),
      code: "WORKSPACE_ERROR",
    };
  }
}

/**
 * Create a new TEAM workspace. Any authenticated user can create one (MVP).
 */
export async function createTeamWorkspaceAction(
  input: { name: string }
): Promise<ActionResult<{ workspace: WorkspaceSummary }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = createTeamWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const result = await createTeamWorkspace(session.userId, parsed.data.name);
    revalidatePath("/");
    return {
      success: true,
      data: {
        workspace: {
          id: result.workspace.id,
          name: result.workspace.name,
          slug: result.workspace.slug,
          type: result.workspace.type,
        },
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: sanitizeError(error, "WORKSPACE_ERROR"),
      code: "WORKSPACE_ERROR",
    };
  }
}

/**
 * Create a project within a workspace. Requires OWNER or ADMIN role.
 * For TEAM workspaces, enforces the active project limit.
 */
export async function createProjectAction(
  input: { workspaceId: string; name: string; repoId?: string }
): Promise<ActionResult<{ project: ProjectListItem; repoId: string | null }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = createProjectInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const membership = await getWorkspaceMembership(parsed.data.workspaceId, session.userId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    if (parsed.data.repoId) {
      const repo = await prisma.repo.findFirst({
        where: { id: parsed.data.repoId, userId: session.userId },
      });
      if (!repo) {
        return { success: false, error: sanitizeError(null, "REPO_NOT_FOUND"), code: "REPO_NOT_FOUND" };
      }
    }

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (!workspace) {
      return { success: false, error: "Workspace not found", code: "NOT_FOUND" };
    }

    const project = await createProject({
      workspaceId: parsed.data.workspaceId,
      name: parsed.data.name,
      workspaceType: workspace.type,
      repoId: parsed.data.repoId,
    });

    revalidatePath(`/workspace/${workspace.slug}`);
    return {
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          status: project.status,
          updatedAt: project.updatedAt,
        },
        repoId: parsed.data.repoId ?? null,
      },
    };
  } catch (error: unknown) {
    if (error instanceof ProjectLimitExceededError) {
      return {
        success: false,
        error: sanitizeError(error, "PROJECT_LIMIT_EXCEEDED"),
        code: "PROJECT_LIMIT_EXCEEDED",
      };
    }
    return {
      success: false,
      error: sanitizeError(error, "PROJECT_IMPORT_ERROR"),
      code: "PROJECT_IMPORT_ERROR",
    };
  }
}

/**
 * Archive a project. Requires OWNER or ADMIN role in the workspace.
 */
export async function archiveProjectAction(
  input: { projectId: string; workspaceId: string }
): Promise<ActionResult<{ project: ProjectListItem }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const parsed = archiveProjectInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  try {
    const membership = await getWorkspaceMembership(parsed.data.workspaceId, session.userId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return { success: false, error: "Access denied", code: "FORBIDDEN" };
    }

    const project = await archiveProject(parsed.data.projectId, parsed.data.workspaceId);

    const workspace = await getWorkspaceById(parsed.data.workspaceId);
    if (workspace) {
      revalidatePath(`/workspace/${workspace.slug}`);
    }

    return {
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          status: project.status,
          updatedAt: project.updatedAt,
        },
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: sanitizeError(error, "WORKSPACE_ERROR"),
      code: "WORKSPACE_ERROR",
    };
  }
}
