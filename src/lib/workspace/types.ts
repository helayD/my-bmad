import type { Workspace, WorkspaceMembership } from "@/generated/prisma/client";

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
