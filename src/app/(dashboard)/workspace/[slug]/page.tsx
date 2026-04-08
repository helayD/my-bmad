import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Users } from "lucide-react";
import {
  getAuthenticatedSession,
  getWorkspaceBySlug,
  getWorkspaceMembership,
  getActiveProjectCount,
} from "@/lib/db/helpers";
import { TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT } from "@/lib/workspace/project-limit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectList } from "@/components/workspace/project-list";
import { EmptyWorkspaceState } from "@/components/workspace/empty-workspace-state";
import { CreateProjectDialog } from "@/components/workspace/create-project-dialog";
import { ProjectLimitBanner } from "@/components/workspace/project-limit-banner";

interface WorkspacePageProps {
  params: Promise<{ slug: string }>;
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const { slug } = await params;

  const session = await getAuthenticatedSession();
  if (!session) notFound();

  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) notFound();

  const membership = await getWorkspaceMembership(workspace.id, session.userId);
  if (!membership) notFound();

  const isTeam = workspace.type === "TEAM";
  const canManage = ["OWNER", "ADMIN"].includes(membership.role);
  const activeProjectCount = isTeam ? await getActiveProjectCount(workspace.id) : 0;

  const projects = workspace.projects.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    updatedAt: p.updatedAt,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{workspace.name}</h1>
            <Badge variant={isTeam ? "default" : "secondary"}>
              {isTeam ? "团队" : "个人"}
            </Badge>
            {isTeam && (
              <Badge variant="outline">
                {activeProjectCount} / {TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT} 活跃项目
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {isTeam ? "团队工作空间" : "个人工作空间"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isTeam && canManage && (
            <Button asChild variant="outline">
              <Link href={`/workspace/${slug}/members`}>
                <Users className="mr-1 h-4 w-4" />
                成员管理
              </Link>
            </Button>
          )}
          {canManage && (
            <CreateProjectDialog
              workspaceId={workspace.id}
              workspaceSlug={slug}
              trigger={
                <Button>
                  <Plus className="mr-1 h-4 w-4" />
                  创建项目
                </Button>
              }
            />
          )}
        </div>
      </div>

      {isTeam && (
        <ProjectLimitBanner
          currentCount={activeProjectCount}
          limit={TEAM_WORKSPACE_ACTIVE_PROJECT_LIMIT}
        />
      )}

      {projects.length > 0 ? (
        <ProjectList
          projects={projects}
          workspaceSlug={slug}
          workspaceId={workspace.id}
          canManage={isTeam && canManage}
        />
      ) : (
        <EmptyWorkspaceState workspaceSlug={slug} />
      )}
    </div>
  );
}
