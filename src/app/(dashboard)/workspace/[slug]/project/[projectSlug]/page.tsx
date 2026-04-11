import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getProjectBySlug, getProjectArtifacts } from "@/lib/db/helpers";
import { getRecentPlanningRequestsByProjectId } from "@/lib/planning/queries";
import { guardWorkspacePage } from "@/lib/workspace/page-guard";
import { fetchBmadFiles } from "@/actions/repo-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import { PlanningRequestComposer } from "@/components/planning/planning-request-composer";
import { ProjectBmadArtifacts } from "@/components/workspace/project-bmad-artifacts";
import { ProjectNoRepo } from "@/components/workspace/project-no-repo";
import { ArtifactTree } from "@/components/artifacts/artifact-tree";
import { ScanButton } from "@/components/artifacts/scan-button";
import { buildArtifactTree } from "@/lib/artifacts/utils";
import type { FileTreeNode } from "@/lib/bmad/types";
import type { ArtifactTypeString, ArtifactTreeNode } from "@/lib/artifacts/types";

export const dynamic = "force-dynamic";

async function ArtifactTreeSection({
  projectId,
  workspaceId,
  workspaceSlug,
  projectSlug,
  initialSelectedArtifactId,
}: {
  projectId: string;
  workspaceId: string;
  workspaceSlug: string;
  projectSlug: string;
  initialSelectedArtifactId?: string;
}) {
  let treeNodes: ArtifactTreeNode[] = [];
  let loadError = false;

  try {
    const artifacts = await getProjectArtifacts(projectId);
    treeNodes = buildArtifactTree(
      artifacts.map((a) => ({
        id: a.id,
        type: a.type as ArtifactTypeString,
        name: a.name,
        filePath: a.filePath,
        metadata: (a.metadata as Record<string, unknown>) ?? null,
        parentId: a.parentId,
      })),
    );
  } catch {
    loadError = true;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">结构化工件树</h2>
        <ScanButton workspaceId={workspaceId} projectId={projectId} />
      </div>
      {loadError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-muted-foreground">
          工件树加载失败，请稍后重试。
        </div>
      ) : (
        <ArtifactTree
          nodes={treeNodes}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          projectSlug={projectSlug}
          initialSelectedArtifactId={initialSelectedArtifactId}
        />
      )}
    </div>
  );
}

interface ProjectPageProps {
  params: Promise<{ slug: string; projectSlug: string }>;
  searchParams: Promise<{ artifactId?: string }>;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  archived: "secondary",
  draft: "outline",
};

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { slug, projectSlug } = await params;
  const { artifactId } = await searchParams;

  const { workspace } = await guardWorkspacePage(slug);

  const project = await getProjectBySlug(workspace.id, projectSlug);
  if (!project) notFound();
  const planningRequests = await getRecentPlanningRequestsByProjectId(project.id);

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
  const artifactTreeSection = project.repo
    ? await ArtifactTreeSection({
        projectId: project.id,
        workspaceId: workspace.id,
        workspaceSlug: slug,
        projectSlug,
        initialSelectedArtifactId: artifactId,
      })
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

      <PlanningRequestComposer
        workspaceId={workspace.id}
        projectId={project.id}
        initialRequests={planningRequests}
        hasRepo={Boolean(project.repo)}
      />

      {/* Content */}
      {project.repo ? (
        <>
          {fileTree && fileTree.length > 0 ? (
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
          )}

          {/* Structured artifact tree */}
          {artifactTreeSection}
        </>
      ) : (
        <ProjectNoRepo />
      )}
    </div>
  );
}
