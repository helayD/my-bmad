import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TaskDetailView } from "@/components/tasks/task-detail-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProjectBySlug, getTaskById, resolveTaskConcurrencySnapshot, resolveTaskBoundarySnapshot, getTaskStateHistory } from "@/lib/db/helpers";
import { prisma } from "@/lib/db/client";
import { resolveTaskCurrentActivity } from "@/lib/tasks/tracking";
import { resolveTaskRoutingDecision as resolveDispatchRoutingDecision } from "@/lib/execution/routing";
import { computeStateTrust } from "@/lib/execution/continuity";
import {
  isTaskApprovalRequiredForDispatch,
  TASK_AGENT_TYPE_LABELS,
  resolveTaskAgentRuns,
  resolveTaskLatestWriteback,
  resolveTaskCurrentSessionView,
  resolveTaskRoutingDecision as resolveStoredTaskRoutingDecision,
  resolveTaskSourceArtifact,
  resolveTaskSourceHierarchy,
} from "@/lib/tasks";
import { guardWorkspacePage } from "@/lib/workspace/page-guard";
import { resolveWorkspaceGovernanceSettings } from "@/lib/workspace/settings";

interface TaskDetailPageProps {
  params: Promise<{ slug: string; projectSlug: string; taskId: string }>;
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { slug, projectSlug, taskId } = await params;
  const { workspace, role } = await guardWorkspacePage(slug);

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
  const latestWriteback = resolveTaskLatestWriteback(task.writebacks);
  const agentRuns = resolveTaskAgentRuns(
    task.metadata,
    task.agentRuns,
    task.currentAgentRunId,
  );
  const routingDecision = resolveStoredTaskRoutingDecision(task.metadata);
  const currentSession = resolveTaskCurrentSessionView(
    { executionSessions: task.currentAgentRun?.executionSession ? [task.currentAgentRun.executionSession] : [], metadata: task.metadata },
    task.currentAgentRunId,
  );
  const canManageExecution = role === "OWNER" || role === "ADMIN" || role === "MEMBER";
  const workspaceSettings = resolveWorkspaceGovernanceSettings(workspace.settings);
  const workspaceRoutingPreference = workspaceSettings.agentRoutingPreference;
  const requiresApprovalForDispatch = workspaceSettings.requireApprovalBeforeExecution
    || isTaskApprovalRequiredForDispatch(task.metadata);
  const dispatchPreviewDecision = task.status === "planned" && !requiresApprovalForDispatch
    ? resolveDispatchRoutingDecision({
        task: {
          goal: task.goal,
          summary: task.summary,
          intent: task.intent,
          intentDetail: task.intentDetail,
          preferredAgentType: task.preferredAgentType,
          metadata: task.metadata,
        },
        workspaceSettings,
        projectSettings: task.project.settings,
        reasonContext: "dispatch",
      })
    : null;
  const plannedDispatchState = task.status !== "planned"
    ? null
    : requiresApprovalForDispatch
      ? "approval-required"
      : dispatchPreviewDecision?.kind === "selection-required"
        ? "selection-required"
        : "ready";
  const dispatchPreviewAgentType = dispatchPreviewDecision?.kind === "selection-required"
    ? dispatchPreviewDecision.recommendedAgentType
    : dispatchPreviewDecision?.kind === "selected"
      ? dispatchPreviewDecision.selectedAgentType
      : null;
  const dispatchPreviewAgentLabel = dispatchPreviewAgentType
    ? TASK_AGENT_TYPE_LABELS[dispatchPreviewAgentType]
    : null;
  const dispatchPreviewReason = dispatchPreviewDecision?.selectionReasonSummary ?? null;
  const concurrencySnapshot = await resolveTaskConcurrencySnapshot(task.id, workspace.id, project.id);
  const boundarySnapshot = await resolveTaskBoundarySnapshot(task.id, workspace.id, project.id);
  const stateEvents = await getTaskStateHistory(task.id);
  const trustLevel = await computeStateTrust(task.id, task.status);
  const currentActivity = resolveTaskCurrentActivity({
    metadata: task.metadata,
    currentStage: task.currentStage,
    nextStep: task.nextStep,
  });
  const interactionRequests = task.status === "waiting_for_input" || task.status === "running"
    ? await prisma.interactionRequest.findMany({
        where: {
          taskId: task.id,
          status: "pending",
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];
  const queueSnapshot = concurrencySnapshot.queuePosition !== null
    ? {
        queuePosition: concurrencySnapshot.queuePosition,
        queuedAt: null,
        workspaceActiveConcurrentTasks: concurrencySnapshot.workspaceActiveConcurrentTasks,
        projectActiveConcurrentTasks: concurrencySnapshot.projectActiveConcurrentTasks,
        maxConcurrentTasks: concurrencySnapshot.maxConcurrentTasks,
        estimatedWaitSeconds: null,
        estimatedWaitLabel: null,
        queueReasonCode: "WORKSPACE_CAPACITY_FULL" as const,
        queueReasonSummary: concurrencySnapshot.workspaceActiveConcurrentTasks >= concurrencySnapshot.maxConcurrentTasks
          ? "工作空间并发上限已满，任务已排入等待队列。"
          : "",
      }
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
          workspaceId: task.workspace.id,
          projectId: task.project.id,
          id: task.id,
          title: task.title,
          goal: task.goal,
          summary: task.summary,
          priority: task.priority,
          intent: task.intent,
          intentDetail: task.intentDetail,
          preferredAgentType: task.preferredAgentType,
          status: task.status,
          currentStage: task.currentStage,
          currentActivity,
          nextStep: task.nextStep,
          createdAt: task.createdAt,
          metadata: task.metadata,
          project: { slug: task.project.slug, name: task.project.name },
          workspace: { slug: task.workspace.slug, name: task.workspace.name },
          sourceArtifact,
          plannedDispatchState,
          workspaceRoutingPreference,
          dispatchPreviewAgentType,
          dispatchPreviewAgentLabel,
          dispatchPreviewReason,
          agentRuns,
          routingReason: routingDecision?.selectionReasonSummary ?? null,
          latestWriteback,
          currentSession,
          currentAgentRunId: task.currentAgentRunId,
          interactionRequests: interactionRequests.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            content: r.content,
            context: r.context,
            status: r.status,
            createdAt: r.createdAt,
          })),
          queueSnapshot,
          boundarySnapshot,
          workspaceActiveConcurrentTasks: concurrencySnapshot.workspaceActiveConcurrentTasks,
          projectActiveConcurrentTasks: concurrencySnapshot.projectActiveConcurrentTasks,
          maxConcurrentTasks: concurrencySnapshot.maxConcurrentTasks,
        }}
        sourceHierarchy={sourceHierarchy}
        canManageExecution={canManageExecution}
        stateEvents={stateEvents}
        trustLevel={trustLevel}
      />
    </div>
  );
}
