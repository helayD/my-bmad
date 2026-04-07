import { notFound } from "next/navigation";
import {
  getAuthenticatedSession,
  getWorkspaceBySlug,
  getWorkspaceMembership,
} from "@/lib/db/helpers";
import { ProjectList } from "@/components/workspace/project-list";
import { EmptyWorkspaceState } from "@/components/workspace/empty-workspace-state";

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

  const projects = workspace.projects.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    updatedAt: p.updatedAt,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{workspace.name}</h1>
        <p className="text-sm text-muted-foreground">
          {workspace.type === "PERSONAL" ? "个人工作空间" : "团队工作空间"}
        </p>
      </div>

      {projects.length > 0 ? (
        <ProjectList projects={projects} workspaceSlug={slug} />
      ) : (
        <EmptyWorkspaceState workspaceSlug={slug} />
      )}
    </div>
  );
}
