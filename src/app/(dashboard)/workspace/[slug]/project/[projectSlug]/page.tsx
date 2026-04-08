import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getAuthenticatedSession,
  getWorkspaceBySlug,
  getWorkspaceMembership,
  getProjectBySlug,
} from "@/lib/db/helpers";
import { fetchBmadFiles } from "@/actions/repo-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import { ProjectBmadArtifacts } from "@/components/workspace/project-bmad-artifacts";
import { ProjectNoRepo } from "@/components/workspace/project-no-repo";
import type { FileTreeNode } from "@/lib/bmad/types";

export const dynamic = "force-dynamic";

interface ProjectPageProps {
  params: Promise<{ slug: string; projectSlug: string }>;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  archived: "secondary",
  draft: "outline",
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { slug, projectSlug } = await params;

  const session = await getAuthenticatedSession();
  if (!session) notFound();

  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) notFound();

  const membership = await getWorkspaceMembership(workspace.id, session.userId);
  if (!membership) notFound();

  const project = await getProjectBySlug(workspace.id, projectSlug);
  if (!project) notFound();

  let fileTree: FileTreeNode[] | null = null;
  if (project.repo) {
    try {
      const result = await fetchBmadFiles({
        owner: project.repo.owner,
        name: project.repo.name,
      });
      if (result.success) {
        fileTree = result.data.fileTree;
      }
    } catch {
      // GitHub rate limit or local path failure — degrade gracefully
      fileTree = null;
    }
  }

  const repoLabel = project.repo
    ? project.repo.sourceType === "local"
      ? project.repo.localPath ?? project.repo.displayName
      : `${project.repo.owner}/${project.repo.name}`
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2">
          <Link href={`/workspace/${slug}`}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {workspace.name}
          </Link>
        </Button>
        <span>/</span>
        <span className="font-medium text-foreground">{project.name}</span>
      </nav>

      {/* Project header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <Badge variant={statusVariant[project.status] ?? "outline"}>
            {project.status}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {repoLabel ? (
            <>
              <span className="truncate max-w-80" title={repoLabel}>
                {project.repo?.sourceType === "local" ? "本地目录：" : ""}
                {repoLabel}
              </span>
              {project.repo && (
                <Badge variant="outline" className="text-xs">
                  {project.repo.sourceType}
                </Badge>
              )}
              {project.repo?.lastSyncedAt && (
                <span>{formatRelativeTime(project.repo.lastSyncedAt)}</span>
              )}
            </>
          ) : (
            <span>未关联仓库</span>
          )}
        </div>
      </div>

      {/* Content */}
      {project.repo ? (
        fileTree && fileTree.length > 0 ? (
          <ProjectBmadArtifacts
            fileTree={fileTree}
            repoOwner={project.repo.owner}
            repoName={project.repo.name}
          />
        ) : fileTree !== null ? (
          <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
            未检测到 BMAD 工件，请确认仓库中包含 <code className="text-xs">_bmad-output</code> 目录
          </div>
        ) : (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-muted-foreground">
            BMAD 工件扫描失败，可能是 GitHub 接口限流或本地路径不可用。请稍后重试。
          </div>
        )
      ) : (
        <ProjectNoRepo />
      )}
    </div>
  );
}
