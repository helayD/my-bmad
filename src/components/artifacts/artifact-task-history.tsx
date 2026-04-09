import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ArtifactTypeString } from "@/lib/artifacts/types";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_VALUES,
  type ArtifactTaskHistoryEntry,
  type ArtifactTaskHistoryFilter,
  type ArtifactTaskHistoryPayload,
  type TaskStatus,
} from "@/lib/tasks";

interface ArtifactTaskHistoryProps {
  artifactType: ArtifactTypeString;
  workspaceSlug: string;
  projectSlug: string;
  filter: ArtifactTaskHistoryFilter;
  onFilterChange: (value: ArtifactTaskHistoryFilter) => void;
  payload: ArtifactTaskHistoryPayload | null;
  isLoading: boolean;
  error: string | null;
}

export function ArtifactTaskHistory({
  artifactType,
  workspaceSlug,
  projectSlug,
  filter,
  onFilterChange,
  payload,
  isLoading,
  error,
}: ArtifactTaskHistoryProps) {
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">关联执行 / 执行历史</CardTitle>
          <CardDescription>
            查看当前工件直接发起的任务记录，并按状态筛选最近执行。
          </CardDescription>
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
        {artifactType !== "STORY" ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            仅 Story 支持查看直接执行历史。
          </div>
        ) : isLoading ? (
          <HistorySkeleton />
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : !payload?.supportsDirectHistory ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            仅 Story 支持查看直接执行历史。
          </div>
        ) : payload.items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            该工件暂未发起执行。
          </div>
        ) : (
          <div className="space-y-3">
            {payload.items.map((item) => (
              <HistoryItem
                key={item.taskId}
                entry={item}
                href={`/workspace/${workspaceSlug}/project/${projectSlug}/tasks/${item.taskId}`}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryItem({ entry, href }: { entry: ArtifactTaskHistoryEntry; href: string }) {
  return (
    <Link href={href} className="block rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/40">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{resolveStatusLabel(entry.status)}</Badge>
        <Badge variant="outline">任务 ID: {entry.taskId}</Badge>
        <Badge variant="outline">{entry.agentTypeLabel}</Badge>
      </div>
      <div className="mt-3 space-y-2">
        <div>
          <div className="font-medium">{entry.title}</div>
          <div className="text-sm text-muted-foreground">
            来源：{entry.sourceArtifactName}
          </div>
        </div>
        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
          <HistoryField label="创建时间" value={formatDateTime(entry.createdAt)} />
          <HistoryField label="最近活动" value={entry.currentActivity} />
          <HistoryField label="当前阶段" value={entry.currentStage} />
          <HistoryField label="结果摘要" value={entry.resultSummary} />
        </div>
      </div>
    </Link>
  );
}

function HistoryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs">{label}</div>
      <div className="leading-6 text-foreground">{value}</div>
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

function resolveStatusLabel(value: string) {
  return TASK_STATUS_LABELS[(value as TaskStatus) ?? "pending"] ?? value;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}
