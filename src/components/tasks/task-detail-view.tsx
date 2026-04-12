import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TASK_INTENT_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  WRITEBACK_OUTCOME_LABELS,
  WRITEBACK_STATUS_LABELS,
  buildSourceArtifactHref,
  buildTaskSourcePathText,
  formatArtifactTypeLabel,
  resolveTaskCurrentActivity,
  type TaskSourceHierarchyItem,
  type TaskIntent,
  type TaskPriority,
  type TaskStatus,
  type TaskWritebackView,
} from "@/lib/tasks";

interface TaskDetailViewProps {
  task: {
    id: string;
    title: string;
    goal: string;
    summary: string;
    priority: string;
    intent: string;
    status: string;
    currentStage: string;
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
    latestWriteback: TaskWritebackView | null;
  };
  sourceHierarchy: TaskSourceHierarchyItem[];
}

export function TaskDetailView({ task, sourceHierarchy }: TaskDetailViewProps) {
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
        <Badge>{resolveStatusLabel(task.status)}</Badge>
        <Badge variant="outline">优先级：{resolvePriorityLabel(task.priority)}</Badge>
        <Badge variant="outline">执行意图：{resolveIntentLabel(task.intent)}</Badge>
      </div>

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
            <h2 className="font-semibold">来源摘要</h2>
            <p className="text-muted-foreground">{task.summary}</p>
          </section>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatusCard label="当前阶段" value={task.currentStage} />
        <StatusCard label="系统正在做什么" value={currentActivity} icon={<Sparkles className="h-4 w-4" />} />
        <StatusCard label="下一步" value={task.nextStep} />
      </div>

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
          ) : <p className="text-muted-foreground">该任务当前没有关联来源工件。</p>}
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

function resolveStatusLabel(value: string) {
  return TASK_STATUS_LABELS[(value as TaskStatus) ?? "pending"] ?? value;
}

function resolvePriorityLabel(value: string) {
  return TASK_PRIORITY_LABELS[(value as TaskPriority) ?? "medium"] ?? value;
}

function resolveIntentLabel(value: string) {
  return TASK_INTENT_LABELS[(value as TaskIntent) ?? "implement"] ?? value;
}
