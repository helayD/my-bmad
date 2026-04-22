import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowUpRight, CheckCircle, CheckCheck, Circle, Clock, Database, FileText, Loader, MessageCircle, Play, RotateCw, Send, Sparkles, Square, XCircle } from "lucide-react";
import { TaskDispatchCard } from "@/components/tasks/task-dispatch-card";
import { TaskRedispatchCard } from "@/components/tasks/task-redispatch-card";
import { StateTimeline } from "@/components/tasks/state-timeline";
import { AgentOutputPanel } from "@/components/tasks/agent-output-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  EXECUTION_QUEUE_REASON_LABELS,
  TASK_INTENT_LABELS,
  TASK_PREFERRED_AGENT_TYPE_LABELS,
  TASK_PRIORITY_LABELS,
  WRITEBACK_OUTCOME_LABELS,
  WRITEBACK_STATUS_LABELS,
  buildSourceArtifactHref,
  buildTaskSourcePathText,
  formatArtifactTypeLabel,
  resolveTaskCurrentActivity,
  type ArtifactTaskHistoryAgentRun,
  type ExecutionQueueSnapshot,
  type ExecutionSessionView,
  type TaskSourceHierarchyItem,
  type TaskIntent,
  type TaskPreferredAgentType,
  type TaskPriority,
  type TaskWritebackView,
} from "@/lib/tasks";
import {
  STATUS_CATEGORY,
  STATUS_CATEGORY_LABELS,
  STATUS_LABELS,
  STATUS_SEMANTICS,
  type TaskStatus as TaskStatusSM,
} from "@/lib/execution/state-machine";
import {
  type StateTrustLevel,
} from "@/lib/execution/continuity";

interface TaskDetailViewProps {
  task: {
    workspaceId: string;
    projectId: string;
    id: string;
    title: string;
    goal: string;
    summary: string;
    priority: string;
    intent: string;
    intentDetail?: string | null;
    preferredAgentType?: string | null;
    status: string;
    currentStage: string;
    currentActivity: string;
    nextStep: string;
    createdAt: Date;
    metadata: unknown;
    project: { slug: string; name: string };
    workspace: { slug: string; name: string };
    sourceArtifact: {
      id: string | null;
      name: string;
      type: string;
      filePath: string;
    } | null;
    plannedDispatchState: "ready" | "selection-required" | "approval-required" | null;
    workspaceRoutingPreference: "auto" | "manual";
    dispatchPreviewAgentType: string | null;
    dispatchPreviewAgentLabel: string | null;
    dispatchPreviewReason: string | null;
    agentRuns: ArtifactTaskHistoryAgentRun[];
    routingReason: string | null;
    latestWriteback: TaskWritebackView | null;
    currentSession: ExecutionSessionView | null;
    currentAgentRunId?: string | null;
    /** Concurrency info passed from the server (populated when fetching task detail) */
    queueSnapshot?: ExecutionQueueSnapshot | null;
    workspaceActiveConcurrentTasks?: number;
    projectActiveConcurrentTasks?: number;
    maxConcurrentTasks?: number;
    /** Boundary info passed from the server (populated from active ExecutionSession metadata) */
    boundarySnapshot?: {
      hasBoundaryProfile: boolean;
      projectRootDisplayPath: string | null;
      preparationSucceeded: boolean | null;
      injectedFileCount: number;
      sensitivePathCount: number;
      lastViolationCode: string | null;
      lastViolationSummary: string | null;
      lastViolationFatal: boolean;
      boundaryCurrentStage: string | null;
      boundaryNextStep: string | null;
    } | null;
    /** Interaction requests for the task */
    interactionRequests?: Array<{
      id: string;
      type: string;
      title: string;
      content: string;
      context: unknown;
      status: string;
      createdAt: Date;
    }>;
  };
  sourceHierarchy: TaskSourceHierarchyItem[];
  canManageExecution?: boolean;
  stateEvents?: Array<{
    id: string;
    fromStatus: string;
    toStatus: string;
    trigger: string;
    reason: string | null;
    actorType: string;
    rejected: boolean;
    createdAt: Date;
  }>;
  /** Heartbeat trust level for status display */
  trustLevel?: StateTrustLevel | null;
}

export function TaskDetailView({
  task,
  sourceHierarchy,
  canManageExecution = false,
  stateEvents = [],
  trustLevel,
}: TaskDetailViewProps) {
  const currentActivity = resolveTaskCurrentActivity({
    metadata: task.metadata,
    currentStage: task.currentStage,
    nextStep: task.nextStep,
  });
  const sourcePathText = sourceHierarchy.length > 0 ? buildTaskSourcePathText(sourceHierarchy) : "";

  const sourceHref = task.sourceArtifact?.id
    ? buildSourceArtifactHref(task.workspace.slug, task.project.slug, task.sourceArtifact.id)
    : null;
  const hasWritebackConflict = (task.status === "done" || task.status === "blocked")
    && (!task.latestWriteback || task.latestWriteback.writebackStatus !== "succeeded");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <TaskStatusBadge status={task.status} />
        <TaskStatusCategoryBadge status={task.status} />
        {trustLevel && (
          <TaskConfidenceBadge trustLevel={trustLevel} />
        )}
        <Badge variant="outline">优先级：{resolvePriorityLabel(task.priority)}</Badge>
        <Badge variant="outline">执行意图：{resolveIntentLabel(task.intent)}</Badge>
      </div>

      {trustLevel?.displayRecommendation === "show_unknown" && (
        <TrustWarningAlert trustLevel={trustLevel} currentStage={task.currentStage} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{task.title}</CardTitle>
          <CardDescription>
            创建于 {task.createdAt.toLocaleString("zh-CN", { hour12: false })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6">
          <section className="space-y-2">
            <h2 className="font-semibold">任务目标</h2>
            <p className="text-muted-foreground">{task.goal}</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">{task.sourceArtifact ? "来源摘要" : "任务摘要"}</h2>
            <p className="text-muted-foreground">{task.summary}</p>
          </section>

          {task.intentDetail ? (
            <section className="space-y-2">
              <h2 className="font-semibold">执行意图补充</h2>
              <p className="text-muted-foreground">{task.intentDetail}</p>
            </section>
          ) : null}

          {task.preferredAgentType ? (
            <section className="space-y-2">
              <h2 className="font-semibold">偏好 Agent</h2>
              <p className="text-muted-foreground">{resolvePreferredAgentLabel(task.preferredAgentType)}</p>
            </section>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatusCard label="当前阶段" value={task.currentStage} />
        <StatusCard label="系统正在做什么" value={currentActivity} icon={<Sparkles className="h-4 w-4" />} />
        <StatusCard label="下一步" value={task.nextStep} />
      </div>

      {task.currentSession ? (
        <Card>
          <CardHeader>
            <CardTitle>执行会话</CardTitle>
            <CardDescription>
              任务在 Agent 运行时的会话信息，用于追踪 tmux 后台会话状态。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{task.currentSession.transport}</Badge>
              <Badge variant="outline">{task.currentSession.statusLabel}</Badge>
            </div>
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
              <DetailField label="会话名称" value={task.currentSession.sessionName} />
              {task.currentSession.processPid ? (
                <DetailField label="进程 PID" value={String(task.currentSession.processPid)} />
              ) : (
                <DetailField label="进程 PID" value="—" />
              )}
              <DetailField label="启动时间" value={task.currentSession.startedAt
                ? new Date(task.currentSession.startedAt).toLocaleString("zh-CN", { hour12: false })
                : "—"} />
              {task.currentSession.terminatedAt ? (
                <DetailField label="结束时间" value={new Date(task.currentSession.terminatedAt).toLocaleString("zh-CN", { hour12: false })} />
              ) : task.currentSession.completedAt ? (
                <DetailField label="完成时间" value={new Date(task.currentSession.completedAt).toLocaleString("zh-CN", { hour12: false })} />
              ) : (
                <DetailField label="结束时间" value="会话仍在运行" />
              )}
              {task.currentSession.terminationReasonSummary ? (
                <DetailField
                  label="终止原因"
                  value={task.currentSession.terminationReasonSummary}
                  className="sm:col-span-2"
                />
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {task.queueSnapshot?.queuePosition !== null && task.queueSnapshot?.queuePosition !== undefined ? (
        <ConcurrencyQueueCard
          queueSnapshot={task.queueSnapshot}
          workspaceActiveConcurrentTasks={task.workspaceActiveConcurrentTasks ?? 0}
          projectActiveConcurrentTasks={task.projectActiveConcurrentTasks ?? 0}
          maxConcurrentTasks={task.maxConcurrentTasks ?? 5}
        />
      ) : null}

      {task.boundarySnapshot?.hasBoundaryProfile ? (
        <ExecutionBoundaryCard boundary={task.boundarySnapshot} />
      ) : null}

      {task.status === "planned" ? (
        <TaskDispatchCard
          workspaceId={task.workspaceId}
          projectId={task.projectId}
          taskId={task.id}
          taskTitle={task.title}
          taskStatus={task.status}
          canManageExecution={canManageExecution}
          dispatchState={task.plannedDispatchState ?? "ready"}
          workspaceRoutingPreference={task.workspaceRoutingPreference}
          preferredAgentType={task.preferredAgentType}
          previewAgentType={task.dispatchPreviewAgentType === "codex" || task.dispatchPreviewAgentType === "claude-code" ? task.dispatchPreviewAgentType : null}
          previewAgentLabel={task.dispatchPreviewAgentLabel}
          previewReasonSummary={task.dispatchPreviewReason}
        />
      ) : (
        <TaskRedispatchCard
          workspaceId={task.workspaceId}
          projectId={task.projectId}
          taskId={task.id}
          taskTitle={task.title}
          taskStatus={task.status}
          currentActivity={currentActivity}
          canManageExecution={canManageExecution}
          routingReason={task.routingReason}
          agentRuns={task.agentRuns}
        />
      )}

      <StateTimeline events={stateEvents} currentStatus={task.status} />

      {task.currentAgentRunId ? (
        <AgentOutputPanel
          taskId={task.id}
          agentRunId={task.currentAgentRunId}
          taskStatus={task.status}
        />
      ) : null}

      {task.interactionRequests && task.interactionRequests.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">待处理交互请求</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {task.interactionRequests.map((req) => (
              <div
                key={req.id}
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/20 dark:border-amber-800"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-amber-700 dark:text-amber-400">{req.title}</span>
                  <Badge variant="outline">{STATUS_LABELS[req.status as TaskStatusSM]?.zh ?? req.status}</Badge>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {req.content}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  创建于 {new Date(req.createdAt).toLocaleString("zh-CN", { hour12: false })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>回写状态</CardTitle>
          <CardDescription>
            用于确认当前任务结果是否已经成功同步回来源工件。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {task.latestWriteback ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{WRITEBACK_STATUS_LABELS[task.latestWriteback.writebackStatus]}</Badge>
                <Badge variant="outline">{WRITEBACK_OUTCOME_LABELS[task.latestWriteback.outcome]}</Badge>
                {hasWritebackConflict ? <Badge variant="outline">待处理</Badge> : null}
              </div>
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
                <DetailField
                  label="回写时间"
                  value={new Date(task.latestWriteback.occurredAt).toLocaleString("zh-CN", { hour12: false })}
                />
                <DetailField label="下一步建议" value={task.latestWriteback.recoveryHint ?? "可继续查看来源工件中的最新状态。"} />
                <DetailField label="回写摘要" value={task.latestWriteback.summary} className="sm:col-span-2" />
                {task.latestWriteback.errorSummary ? (
                  <DetailField label="失败原因" value={task.latestWriteback.errorSummary} className="sm:col-span-2" />
                ) : null}
              </div>
            </>
          ) : hasWritebackConflict ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              任务已结束，但结果尚未成功回写到来源工件。请先处理回写异常，再继续依赖该工件的最新执行状态。
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              当前任务还没有回写记录。通常会在任务进入已完成、失败或中断等终态后生成。
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>来源工件引用</CardTitle>
          <CardDescription>
            任务与 BMAD 工件之间的最小追踪链路。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {task.sourceArtifact ? (
            <>
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
                <DetailField label="来源工件类型" value={formatArtifactTypeLabel(task.sourceArtifact.type)} />
                <DetailField label="来源工件名称" value={task.sourceArtifact.name} />
                <DetailField label="来源文件路径" value={task.sourceArtifact.filePath} className="sm:col-span-2" />
                {sourcePathText ? (
                  <DetailField label="层级路径" value={sourcePathText} className="sm:col-span-2" />
                ) : null}
              </div>
              {sourceHierarchy.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  {sourceHierarchy.map((item, index) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <Badge variant={index === sourceHierarchy.length - 1 ? "default" : "outline"}>
                        {formatArtifactTypeLabel(item.type)}
                        <span className="ml-1">{item.name}</span>
                      </Badge>
                      {index < sourceHierarchy.length - 1 ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {sourceHref ? (
                <Link href={sourceHref} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                  <ArrowLeft className="h-4 w-4" />
                  返回来源工件视图
                </Link>
              ) : null}
            </>
          ) : (
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
              <DetailField label="来源类型" value="项目上下文手动创建" />
              <DetailField label="所属项目" value={task.project.name} />
              <DetailField
                label="说明"
                value="该任务当前没有关联 Story / Epic 或其他来源工件，系统会基于项目边界保留目标、优先级和执行意图。"
                className="sm:col-span-2"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DetailField({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all text-sm leading-6">{value}</div>
    </div>
  );
}

function StatusCard({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-muted-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  Clock,
  Send,
  Loader,
  Play,
  MessageCircle,
  RotateCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Square,
  Database,
  CheckCheck,
  Circle,
};

function TaskStatusBadge({ status }: { status: string }) {
  const semantics = STATUS_SEMANTICS[status as TaskStatusSM];
  const label = STATUS_LABELS[status as TaskStatusSM]?.zh ?? status;
  const Icon = semantics ? ICON_MAP[semantics.icon] ?? Circle : Circle;

  const colorClass = semantics?.color === "primary"
    ? "bg-primary/10 text-primary border-primary/20"
    : semantics?.color === "success"
      ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
      : semantics?.color === "warning"
        ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
        : semantics?.color === "danger"
          ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
          : "bg-muted text-muted-foreground border-muted";

  return (
    <Badge className={`gap-1.5 border ${colorClass}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Badge>
  );
}

function TaskStatusCategoryBadge({ status }: { status: string }) {
  const category = STATUS_CATEGORY[status as TaskStatusSM];
  if (!category) return null;

  const catLabel = STATUS_CATEGORY_LABELS[category];
  const colorClass = category === "active"
    ? "bg-primary/10 text-primary border-primary/20"
    : category === "terminal"
      ? "bg-muted text-muted-foreground border-muted"
      : category === "recovery"
        ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
        : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";

  return (
    <Badge variant="outline" className={`gap-1 border ${colorClass}`}>
      {catLabel.zh}
    </Badge>
  );
}

function resolvePriorityLabel(value: string) {
  return TASK_PRIORITY_LABELS[(value as TaskPriority) ?? "medium"] ?? value;
}

function resolveIntentLabel(value: string) {
  return TASK_INTENT_LABELS[(value as TaskIntent) ?? "implement"] ?? value;
}

function resolvePreferredAgentLabel(value: string) {
  return TASK_PREFERRED_AGENT_TYPE_LABELS[(value as TaskPreferredAgentType) ?? "auto"] ?? value;
}

interface TaskConfidenceBadgeProps {
  trustLevel: StateTrustLevel;
}

function TaskConfidenceBadge({ trustLevel }: TaskConfidenceBadgeProps) {
  if (trustLevel.displayRecommendation === "show_normal") return null;

  return (
    <Badge variant={trustLevel.badgeVariant} className="text-xs">
      {trustLevel.displayRecommendation === "show_stale" && (
        <>
          <Clock className="h-3 w-3 mr-1" />
          {trustLevel.badgeText.zh}
        </>
      )}
      {trustLevel.displayRecommendation === "show_unknown" && (
        <>
          <AlertTriangle className="h-3 w-3 mr-1" />
          {trustLevel.badgeText.zh}
        </>
      )}
    </Badge>
  );
}

interface TrustWarningAlertProps {
  trustLevel: StateTrustLevel;
  currentStage: string;
}

function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return "刚刚";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}天前`;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function TrustWarningAlert({ trustLevel, currentStage }: TrustWarningAlertProps) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>状态不可信</AlertTitle>
      <AlertDescription>
        已超过 2 分钟未收到心跳，任务状态可能已过期。
        最后已知状态：{trustLevel.heartbeatStatus.lastStage ?? currentStage}
        {trustLevel.heartbeatStatus.lastHeartbeatAt && (
          <span className="block mt-1">
            最后心跳：{formatDistanceToNow(trustLevel.heartbeatStatus.lastHeartbeatAt)}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

function ConcurrencyQueueCard({
  queueSnapshot,
  workspaceActiveConcurrentTasks,
  projectActiveConcurrentTasks,
  maxConcurrentTasks,
}: {
  queueSnapshot: ExecutionQueueSnapshot;
  workspaceActiveConcurrentTasks: number;
  projectActiveConcurrentTasks: number;
  maxConcurrentTasks: number;
}) {
  const reasonLabel = EXECUTION_QUEUE_REASON_LABELS[queueSnapshot.queueReasonCode] ?? queueSnapshot.queueReasonSummary;

  return (
    <Card>
      <CardHeader>
        <CardTitle>执行队列状态</CardTitle>
        <CardDescription>
          当前任务正在等待执行槽位，尚未真正启动 Agent。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{reasonLabel}</Badge>
          {queueSnapshot.queuePosition !== null && queueSnapshot.queuePosition !== undefined ? (
            <Badge>等待顺位：{queueSnapshot.queuePosition}</Badge>
          ) : null}
        </div>
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
          <DetailField
            label="工作空间并发"
            value={`${workspaceActiveConcurrentTasks}/${maxConcurrentTasks}`}
          />
          <DetailField
            label="项目并发"
            value={`${projectActiveConcurrentTasks} 个任务`}
          />
          {queueSnapshot.queuePosition !== null && queueSnapshot.queuePosition !== undefined ? (
            <DetailField
              label="等待顺位"
              value={`第 ${queueSnapshot.queuePosition} 位`}
            />
          ) : null}
          {queueSnapshot.queuedAt ? (
            <DetailField
              label="入队时间"
              value={new Date(queueSnapshot.queuedAt).toLocaleString("zh-CN", { hour12: false })}
            />
          ) : null}
          {queueSnapshot.estimatedWaitLabel ? (
            <DetailField
              label="预估等待"
              value={queueSnapshot.estimatedWaitLabel}
              className="sm:col-span-2"
            />
          ) : null}
          {queueSnapshot.queueReasonSummary ? (
            <DetailField
              label="排队原因"
              value={queueSnapshot.queueReasonSummary}
              className="sm:col-span-2"
            />
          ) : null}
        </div>
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          系统会在执行槽位空闲后自动启动此任务，无需手动重复操作。
        </div>
      </CardContent>
    </Card>
  );
}

interface ExecutionBoundaryCardProps {
  boundary: NonNullable<TaskDetailViewProps["task"]["boundarySnapshot"]>;
}

function ExecutionBoundaryCard({ boundary }: ExecutionBoundaryCardProps) {
  const isSuccess = boundary.preparationSucceeded === true && !boundary.lastViolationCode;
  const hasViolation = !!boundary.lastViolationCode;

  const stageLabel = boundary.boundaryCurrentStage ?? (
    isSuccess
      ? "已按项目边界准备执行环境"
      : hasViolation
        ? `检测到边界违规：${boundary.lastViolationSummary ?? ""}`
        : "执行边界准备中"
  );

  const statusVariant = isSuccess ? "default" : hasViolation ? "destructive" : "secondary";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">执行边界</CardTitle>
          <Badge variant={statusVariant}>{stageLabel}</Badge>
        </div>
        <CardDescription>
          平台已按项目边界限制上下文注入范围。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {boundary.projectRootDisplayPath ? (
            <DetailField
              label="执行根目录"
              value={boundary.projectRootDisplayPath}
              className="sm:col-span-2"
            />
          ) : null}
          <DetailField
            label="已注入文件数"
            value={boundary.injectedFileCount > 0 ? `${boundary.injectedFileCount} 个文件` : "未注入"}
          />
          <DetailField
            label="敏感路径"
            value={boundary.sensitivePathCount > 0 ? `${boundary.sensitivePathCount} 个已跳过` : "无"}
          />
          {hasViolation ? (
            <>
              <DetailField
                label="违规类型"
                value={boundary.lastViolationCode ?? ""}
              />
              {boundary.lastViolationSummary ? (
                <DetailField
                  label="违规摘要"
                  value={boundary.lastViolationSummary}
                  className="sm:col-span-2"
                />
              ) : null}
            </>
          ) : null}
        </div>
        {boundary.boundaryNextStep ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {boundary.boundaryNextStep}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
