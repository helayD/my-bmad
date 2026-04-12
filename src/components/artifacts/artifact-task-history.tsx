import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ArtifactTypeString } from "@/lib/artifacts/types";
import {
  ARTIFACT_EXECUTION_STATUS_LABELS,
  TASK_AGENT_RUN_EMPTY_STATE,
  TASK_ARTIFACT_GENERATED_AT_FALLBACK,
  TASK_ARTIFACTS_EMPTY_STATE,
  TASK_EXECUTION_TIME_FALLBACK,
  TASK_STATUS_LABELS,
  TASK_STATUS_VALUES,
  TASK_WRITEBACK_CONFLICT_STATE,
  TASK_WRITEBACK_EMPTY_STATE,
  type ArtifactExecutionStatus,
  type ArtifactTaskHistoryEntry,
  type ArtifactTaskHistoryFilter,
  type ArtifactTaskHistoryPayload,
  type ArtifactTaskHistoryStorySummary,
  type TaskStatus,
} from "@/lib/tasks";

interface ArtifactTaskHistoryProps {
  artifactType: ArtifactTypeString;
  filter: ArtifactTaskHistoryFilter;
  onFilterChange: (value: ArtifactTaskHistoryFilter) => void;
  payload: ArtifactTaskHistoryPayload | null;
  isLoading: boolean;
  error: string | null;
}

export function ArtifactTaskHistory({
  artifactType,
  filter,
  onFilterChange,
  payload,
  isLoading,
  error,
}: ArtifactTaskHistoryProps) {
  const isHistoryPending = !error && (isLoading || payload === null);
  const cardDescription = resolveCardDescription(payload?.viewType ?? null, artifactType);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">执行历史</CardTitle>
          <CardDescription>{cardDescription}</CardDescription>
        </div>
        {artifactType === "STORY" ? (
          <Select value={filter} onValueChange={(value) => onFilterChange(value as ArtifactTaskHistoryFilter)}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="筛选状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {TASK_STATUS_VALUES.map((status) => (
                <SelectItem key={status} value={status}>
                  {TASK_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {isHistoryPending ? (
          <div aria-label="执行历史加载中">
            <HistorySkeleton />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : !payload || !payload.supportsExecutionHistory ? (
          <UnsupportedHint />
        ) : payload.viewType === "story" ? (
          <>
            <LatestWritebackSummary payload={payload} />
            <StoryHistoryView items={payload.items} />
          </>
        ) : payload.viewType === "epic" ? (
          <>
            <LatestWritebackSummary payload={payload} />
            <EpicHistoryView payload={payload} />
          </>
        ) : (
          <UnsupportedHint />
        )}
      </CardContent>
    </Card>
  );
}

function StoryHistoryView({ items }: { items: ArtifactTaskHistoryEntry[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        该 Story 暂未发起执行。你可以先在“概览”标签里创建任务，随后这里会展示任务历史、Agent Run 和产物摘要。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <HistoryItem key={item.taskId} entry={item} />
      ))}
    </div>
  );
}

function EpicHistoryView({ payload }: { payload: ArtifactTaskHistoryPayload }) {
  if (payload.storySummaries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        当前 Epic 还没有可聚合的 Story 执行记录。请先确认该 Epic 下已有 Story，并从 Story 工件发起执行。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DistributionCard label={ARTIFACT_EXECUTION_STATUS_LABELS.completed} value={payload.statusDistribution.completed} />
        <DistributionCard label={ARTIFACT_EXECUTION_STATUS_LABELS["in-progress"]} value={payload.statusDistribution.inProgress} />
        <DistributionCard label={ARTIFACT_EXECUTION_STATUS_LABELS.pending} value={payload.statusDistribution.pending} />
        <DistributionCard label={ARTIFACT_EXECUTION_STATUS_LABELS.failed} value={payload.statusDistribution.failed} />
      </div>

      <div className="space-y-3">
        {payload.storySummaries.map((summary) => (
          <EpicStorySummaryCard key={summary.storyArtifactId} summary={summary} />
        ))}
      </div>
    </div>
  );
}

function LatestWritebackSummary({ payload }: { payload: ArtifactTaskHistoryPayload }) {
  if (!payload.latestWriteback) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{payload.latestWriteback.writebackStatus === "succeeded" ? "最新回写已完成" : "最新回写异常"}</Badge>
        <Badge variant="outline">{payload.latestWriteback.outcome === "completed" ? "结果已完成" : payload.latestWriteback.outcome === "interrupted" ? "结果已中断" : "结果失败"}</Badge>
      </div>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <HistoryField label="回写时间" value={formatDateTime(payload.latestWriteback.occurredAt, "时间待记录")} />
        <HistoryField label="下一步建议" value={payload.latestWriteback.recoveryHint ?? "可前往任务详情查看完整上下文"} />
        <HistoryField label="回写摘要" value={payload.latestWriteback.summary} className="sm:col-span-2" />
        {payload.latestWriteback.errorSummary ? (
          <HistoryField label="失败原因" value={payload.latestWriteback.errorSummary} className="sm:col-span-2" />
        ) : null}
      </div>
      {payload.latestWritebackTaskDetailHref ? (
        <Link href={payload.latestWritebackTaskDetailHref} className="mt-3 inline-flex text-sm font-medium text-primary hover:underline">
          查看来源任务详情
        </Link>
      ) : null}
    </div>
  );
}

function EpicStorySummaryCard({ summary }: { summary: ArtifactTaskHistoryStorySummary }) {
  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer list-none p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{resolveAggregateStatusLabel(summary.aggregateStatus)}</Badge>
          <Badge variant="outline">任务数：{summary.taskCount}</Badge>
        </div>
        <div className="mt-3 space-y-2">
          <div className="font-medium">{summary.storyName}</div>
          <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <HistoryField label="最近活动" value={summary.latestActivity} />
            <HistoryField label="最近任务详情" value={summary.latestTaskDetailHref ? "展开后可查看" : "暂无任务详情"} />
          </div>
        </div>
      </summary>
      <div className="space-y-3 border-t px-4 py-4">
        {summary.latestTaskDetailHref ? (
          <Link href={summary.latestTaskDetailHref} className="inline-flex text-sm font-medium text-primary hover:underline">
            最近任务详情
          </Link>
        ) : null}

        {summary.items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            该 Story 还没有任务历史，后续执行后会在这里展开最近任务明细。
          </div>
        ) : (
          summary.items.map((item) => (
            <HistoryItem key={item.taskId} entry={item} />
          ))
        )}
      </div>
    </details>
  );
}

function HistoryItem({ entry }: { entry: ArtifactTaskHistoryEntry }) {
  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer list-none p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{resolveStatusLabel(entry.status)}</Badge>
          <Badge variant="outline">任务 ID: {entry.taskId}</Badge>
          <Badge variant="outline">{entry.agentTypeLabel}</Badge>
          {entry.writebackStatusLabel ? (
            <Badge variant="outline">{entry.writebackStatusLabel}</Badge>
          ) : null}
        </div>
        <div className="mt-3 space-y-2">
          <div>
            <div className="font-medium">{entry.title}</div>
            <div className="text-sm text-muted-foreground">来源：{entry.sourceArtifactName}</div>
          </div>
          <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <HistoryField label="执行时间" value={formatDateTime(entry.executionStartedAt, TASK_EXECUTION_TIME_FALLBACK)} />
            <HistoryField label="最近活动" value={entry.currentActivity} />
            <HistoryField label="当前阶段" value={entry.currentStage} />
            <HistoryField label="关键产物" value={entry.artifactSummary} />
            <HistoryField label="结果摘要" value={entry.resultSummary} className="sm:col-span-2" />
          </div>
        </div>
      </summary>
      <div className="space-y-4 border-t px-4 py-4">
        <section className="space-y-3">
          <div className="text-sm font-medium">回写结果</div>
          {entry.writeback ? (
            <div className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {entry.writebackStatusLabel ? <Badge>{entry.writebackStatusLabel}</Badge> : null}
                {entry.writebackOutcomeLabel ? <Badge variant="outline">{entry.writebackOutcomeLabel}</Badge> : null}
                {entry.hasWritebackConflict ? <Badge variant="outline">待处理</Badge> : null}
              </div>
              <div className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                <HistoryField label="回写时间" value={formatDateTime(entry.writebackOccurredAt, "时间待记录")} />
                <HistoryField label="下一步建议" value={entry.writebackRecoveryHint ?? "可回到任务详情继续跟进。"} />
                <HistoryField label="回写摘要" value={entry.writeback.summary} className="sm:col-span-2" />
                {entry.writebackErrorSummary ? (
                  <HistoryField label="失败原因" value={entry.writebackErrorSummary} className="sm:col-span-2" />
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {entry.hasWritebackConflict ? TASK_WRITEBACK_CONFLICT_STATE : TASK_WRITEBACK_EMPTY_STATE}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="text-sm font-medium">Agent Run</div>
          {entry.agentRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {TASK_AGENT_RUN_EMPTY_STATE}
            </div>
          ) : (
            <div className="space-y-3">
              {entry.agentRuns.map((run, index) => (
                <div key={`${entry.taskId}-run-${run.id ?? index}`} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{run.agentTypeLabel}</Badge>
                    <Badge variant="outline">{run.statusLabel}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                    <HistoryField label="开始时间" value={formatDateTime(run.startedAt, TASK_EXECUTION_TIME_FALLBACK)} />
                    <HistoryField label="结束时间" value={formatDateTime(run.completedAt, "尚未结束")} />
                    <HistoryField label="执行摘要" value={run.summary} className="sm:col-span-2" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="text-sm font-medium">产物</div>
          {entry.artifacts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {TASK_ARTIFACTS_EMPTY_STATE}
            </div>
          ) : (
            <div className="space-y-3">
              {entry.artifacts.map((artifact, index) => (
                <details key={`${entry.taskId}-artifact-${index}`} className="rounded-lg border p-3">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium">{artifact.type}</div>
                      <div className="text-sm text-muted-foreground">{artifact.filePath}</div>
                    </div>
                    <span className="text-sm font-medium text-primary">查看产物详情</span>
                  </summary>
                  <div className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                    <HistoryField label="产物类型" value={artifact.type} />
                    <HistoryField label="生成时间" value={formatDateTime(artifact.generatedAt, TASK_ARTIFACT_GENERATED_AT_FALLBACK)} />
                    <HistoryField label="文件路径" value={artifact.filePath} className="sm:col-span-2" />
                    <HistoryField label="产物说明" value={artifact.summary} className="sm:col-span-2" />
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>

        <Link href={entry.taskDetailHref} className="inline-flex text-sm font-medium text-primary hover:underline">
          查看任务详情
        </Link>
      </div>
    </details>
  );
}

function DistributionCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function UnsupportedHint() {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      当前工件类型暂不支持执行历史聚合。请切换到 Story 或 Epic 查看执行历史。
    </div>
  );
}

function HistoryField({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs">{label}</div>
      <div className="mt-1 leading-6 text-foreground">{value}</div>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={`history-skeleton-${index}`} className="rounded-lg border p-4">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function resolveCardDescription(
  viewType: ArtifactTaskHistoryPayload["viewType"] | null,
  artifactType: ArtifactTypeString,
) {
  if (viewType === "epic" || artifactType === "EPIC") {
    return "查看当前 Epic 下所有 Story 的执行分布，并按 Story 展开最近任务与产物区域。";
  }

  if (viewType === "story" || artifactType === "STORY") {
    return "查看当前 Story 的任务历史、Agent Run 区域与产物摘要。";
  }

  return "查看当前工件的执行历史；部分工件类型会安全降级为只读提示。";
}

function resolveAggregateStatusLabel(value: ArtifactExecutionStatus) {
  return ARTIFACT_EXECUTION_STATUS_LABELS[value] ?? value;
}

function resolveStatusLabel(value: string) {
  return TASK_STATUS_LABELS[(value as TaskStatus) ?? "pending"] ?? value;
}

function formatDateTime(value: string | null, fallback: string) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}
