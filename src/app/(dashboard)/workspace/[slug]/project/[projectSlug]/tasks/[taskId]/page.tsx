import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TaskDetailView } from "@/components/tasks/task-detail-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProjectBySlug, getTaskById } from "@/lib/db/helpers";
import { resolveTaskSourceArtifact, resolveTaskSourceHierarchy } from "@/lib/tasks";
import { guardWorkspacePage } from "@/lib/workspace/page-guard";

interface TaskDetailPageProps {
  params: Promise<{ slug: string; projectSlug: string; taskId: string }>;
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { slug, projectSlug, taskId } = await params;
  const { workspace } = await guardWorkspacePage(slug);

  const project = await getProjectBySlug(workspace.id, projectSlug);
  if (!project) {
    notFound();
  }

  const task = await getTaskById(taskId);
  if (!task || task.projectId !== project.id || task.workspaceId !== workspace.id) {
    notFound();
  }

  const sourceHierarchy = resolveTaskSourceHierarchy({
    sourceArtifact: task.sourceArtifact,
    metadata: task.metadata,
  });
  const sourceArtifact = task.sourceArtifact || sourceHierarchy.length > 0
    ? resolveTaskSourceArtifact({
        sourceArtifact: task.sourceArtifact,
        metadata: task.metadata,
      })
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2">
          <Link href={`/workspace/${slug}/project/${projectSlug}`}>
            <ArrowLeft className="h-3.5 w-3.5" />
            返回项目
          </Link>
        </Button>
        <span>/</span>
        <span>{project.name}</span>
        <span>/</span>
        <span className="font-medium text-foreground">任务详情</span>
      </nav>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">任务详情</h1>
          <Badge variant="outline">{task.id}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          查看任务状态、阶段反馈以及来源工件引用。
        </p>
      </div>

      <TaskDetailView
        task={{
          id: task.id,
          title: task.title,
          goal: task.goal,
          summary: task.summary,
          priority: task.priority,
          intent: task.intent,
          status: task.status,
          currentStage: task.currentStage,
          nextStep: task.nextStep,
          createdAt: task.createdAt,
          metadata: task.metadata,
          project: { slug: task.project.slug, name: task.project.name },
          workspace: { slug: task.workspace.slug, name: task.workspace.name },
          sourceArtifact,
        }}
        sourceHierarchy={sourceHierarchy}
      />
    </div>
  );
}
