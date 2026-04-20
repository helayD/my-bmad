"use client";

import { ArrowRight, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  STATUS_LABELS,
  STATUS_SEMANTICS,
  TRIGGER_LABELS,
  ACTOR_TYPE_LABELS,
  type TaskStatus,
  type StateTransitionTrigger,
  type TransitionActorType,
} from "@/lib/execution/state-machine";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText: () => <Circle className="h-4 w-4" />,
  Clock: () => <Circle className="h-4 w-4" />,
  Send: () => <Circle className="h-4 w-4" />,
  Loader: () => <Circle className="h-4 w-4" />,
  Play: () => <Circle className="h-4 w-4" />,
  MessageCircle: () => <Circle className="h-4 w-4" />,
  RotateCw: () => <Circle className="h-4 w-4" />,
  AlertTriangle: () => <Circle className="h-4 w-4" />,
  CheckCircle: () => <Circle className="h-4 w-4" />,
  XCircle: () => <Circle className="h-4 w-4" />,
  Square: () => <Circle className="h-4 w-4" />,
  Database: () => <Circle className="h-4 w-4" />,
  CheckCheck: () => <Circle className="h-4 w-4" />,
  Circle: () => <Circle className="h-4 w-4" />,
};

interface TimelineEvent {
  id: string;
  fromStatus: string;
  toStatus: string;
  trigger: string;
  reason: string | null;
  actorType: string;
  rejected: boolean;
  createdAt: Date;
}

interface StateTimelineProps {
  events: TimelineEvent[];
  currentStatus: string;
  compact?: boolean;
}

function formatRelativeTime(date: Date): string {
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

export function StateTimeline({ events, currentStatus, compact = false }: StateTimelineProps) {
  if (events.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">状态流转历史</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">暂无状态流转记录。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">状态流转历史</CardTitle>
          <Badge variant="outline">{events.length} 次转换</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-0">
        <div className="relative">
          {events.map((event, index) => {
            const toSemantics = STATUS_SEMANTICS[event.toStatus as TaskStatus];
            const toInfo = STATUS_LABELS[event.toStatus as TaskStatus];
            const fromInfo = STATUS_LABELS[event.fromStatus as TaskStatus];
            const triggerInfo = TRIGGER_LABELS[event.trigger as StateTransitionTrigger];
            const actorInfo = ACTOR_TYPE_LABELS[event.actorType as TransitionActorType];

            const colorClass = toSemantics?.color === "primary"
              ? "bg-primary/10 text-primary"
              : toSemantics?.color === "success"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : toSemantics?.color === "warning"
                  ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                  : toSemantics?.color === "danger"
                    ? "bg-red-500/10 text-red-600 dark:text-red-400"
                    : "bg-muted text-muted-foreground";

            const IconComponent = toSemantics ? ICON_MAP[toSemantics.icon] ?? Circle : Circle;

            if (compact) {
              return (
                <div key={event.id} className="flex items-center gap-2 py-2">
                  <div className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${colorClass}`}>
                    <IconComponent className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {fromInfo?.zh ?? event.fromStatus} → {toInfo?.zh ?? event.toStatus}
                    </span>
                    {event.rejected && (
                      <Badge variant="destructive" className="text-xs shrink-0">已拒绝</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(new Date(event.createdAt))}
                  </span>
                </div>
              );
            }

            return (
              <div key={event.id} className="flex items-start gap-3 py-3">
                {/* Timeline indicator */}
                <div className="flex flex-col items-center">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${colorClass}`}>
                    <IconComponent className="h-4 w-4" />
                  </div>
                  {index < events.length - 1 && (
                    <div className="w-px flex-1 bg-border mt-1 min-h-4" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">
                      {toInfo?.zh ?? event.toStatus}
                    </span>
                    {fromInfo && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ArrowRight className="h-3 w-3" />
                        {fromInfo.zh}
                      </span>
                    )}
                    {event.rejected && (
                      <Badge variant="destructive" className="text-xs">已拒绝</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {triggerInfo?.zh ?? event.trigger}
                    {actorInfo && ` · ${actorInfo.zh}`}
                  </p>
                  {event.reason && (
                    <p className="text-xs text-muted-foreground/70 mt-1 italic">
                      {event.reason}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground/50 mt-0.5">
                    {new Date(event.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    {" · "}
                    {formatRelativeTime(new Date(event.createdAt))}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Current status indicator */}
          <div className="flex items-start gap-3 py-3 border-t mt-2 pt-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary shrink-0">
              <Circle className="h-4 w-4 fill-current" />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <p className="text-sm font-medium">当前状态：{STATUS_LABELS[currentStatus as TaskStatus]?.zh ?? currentStatus}</p>
              <p className="text-xs text-muted-foreground">最新状态</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
