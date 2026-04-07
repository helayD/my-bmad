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
      `Le nombre maximum de projets actifs (${limit}) a été atteint. Projets actifs actuels : ${currentCount}.`
    );
    this.name = "ProjectLimitExceededError";
    this.currentCount = currentCount;
    this.limit = limit;
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
