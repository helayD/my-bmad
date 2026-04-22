"use client";

import { ArrowRight, Circle, Heart, Loader } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  STATUS_LABELS,
  STATUS_SEMANTICS,
  TRIGGER_LABELS,
  ACTOR_TYPE_LABELS,
  type TaskStatus,
  type StateTransitionTrigger,
  type TransitionActorType,
} from "@/lib/execution/state-machine/types";

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

export interface StateChangeEvent {
  id: string;
  fromStatus: string;
  toStatus: string;
  trigger: string;
  reason: string | null;
  actorType: string;
  rejected: boolean;
  createdAt: Date;
}

export interface HeartbeatEvent {
  id: string;
  timestamp: Date;
  summary: string;
}

export interface TrailItem {
  id: string;
  type: "state_change" | "heartbeat" | "interaction" | "recovery";
  timestamp: Date;
  summary: string;
}

interface StateTimelineProps {
  events: StateChangeEvent[];
  currentStatus: string;
  compact?: boolean;
  /** Optional execution trail from server (includes heartbeats) */
  executionTrail?: TrailItem[] | null;
  /** Total count for pagination indicator */
  totalTrailCount?: number;
  taskId?: string;
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

export function StateTimeline({ events, currentStatus, compact = false, executionTrail, totalTrailCount }: StateTimelineProps) {
  // When executionTrail is provided, merge heartbeats with state events for long-running tasks.
  const allItems: Array<{
    id: string;
    type: "state_change" | "heartbeat" | "interaction" | "recovery";
    timestamp: Date;
    label: string;
    detail: string;
    stateEvent?: StateChangeEvent;
  }> = executionTrail && executionTrail.length > 0
    ? executionTrail.map((item) => ({
        id: item.id,
        type: item.type,
        timestamp: item.timestamp,
        label: item.type === "heartbeat" ? "心跳" : item.type === "recovery" ? "恢复" : item.type === "interaction" ? "交互" : "状态变更",
        detail: item.summary,
        stateEvent: item.type === "state_change" ? (events.find((e) => e.id === item.id)) : undefined,
      }))
    : events.map((event) => ({
        id: event.id,
        type: "state_change" as const,
        timestamp: event.createdAt,
        label: "状态变更",
        detail: "",
        stateEvent: event,
      }));

  if (allItems.length === 0) {
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

  const itemCount = executionTrail && executionTrail.length > 0
    ? (totalTrailCount ?? executionTrail.length)
    : events.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">状态流转历史</CardTitle>
          <Badge variant="outline">
            {executionTrail && executionTrail.length > 0
              ? `${itemCount} 条记录（含心跳）`
              : `${events.length} 次转换`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-0">
        <div className="relative">
          {allItems.map((item, index) => {
            if (compact) {
              return (
                <div key={item.id} className="flex items-center gap-2 py-2">
                  <div className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${
                    item.type === "heartbeat"
                      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      : item.stateEvent
                        ? getStatusColorClass(item.stateEvent.toStatus)
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {item.type === "heartbeat"
                      ? <Heart className="h-3.5 w-3.5" />
                      : <Circle className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {item.type === "heartbeat" ? item.detail : item.stateEvent
                        ? `${STATUS_LABELS[item.stateEvent.fromStatus as TaskStatus]?.zh ?? item.stateEvent.fromStatus} → ${STATUS_LABELS[item.stateEvent.toStatus as TaskStatus]?.zh ?? item.stateEvent.toStatus}`
                        : item.detail}
                    </span>
                    {item.stateEvent?.rejected && (
                      <Badge variant="destructive" className="text-xs shrink-0">已拒绝</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(item.timestamp)}
                  </span>
                </div>
              );
            }

            // Full mode
            if (item.type === "heartbeat") {
              return (
                <div key={item.id} className="flex items-start gap-3 py-3">
                  <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      <Heart className="h-4 w-4" />
                    </div>
                    {index < allItems.length - 1 && (
                      <div className="w-px flex-1 bg-border mt-1 min-h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-blue-600 dark:text-blue-400">心跳记录</span>
                      <span className="text-xs text-muted-foreground">系统</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                    <p className="text-xs text-muted-foreground/50 mt-0.5">
                      {item.timestamp.toLocaleString("zh-CN", { hour12: false })}
                      {" · "}
                      {formatRelativeTime(item.timestamp)}
                    </p>
                  </div>
                </div>
              );
            }

            const stateEvent = item.stateEvent;
            if (!stateEvent) {
              return (
                <div key={item.id} className="flex items-start gap-3 py-3">
                  <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 bg-muted text-muted-foreground">
                      <Circle className="h-4 w-4" />
                    </div>
                    {index < allItems.length - 1 && (
                      <div className="w-px flex-1 bg-border mt-1 min-h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <p className="text-sm text-muted-foreground">{item.detail}</p>
                    <p className="text-xs text-muted-foreground/50 mt-0.5">
                      {item.timestamp.toLocaleString("zh-CN", { hour12: false })}
                    </p>
                  </div>
                </div>
              );
            }

            const toSemantics = STATUS_SEMANTICS[stateEvent.toStatus as TaskStatus];
            const toInfo = STATUS_LABELS[stateEvent.toStatus as TaskStatus];
            const fromInfo = STATUS_LABELS[stateEvent.fromStatus as TaskStatus];
            const triggerInfo = TRIGGER_LABELS[stateEvent.trigger as StateTransitionTrigger];
            const actorInfo = ACTOR_TYPE_LABELS[stateEvent.actorType as TransitionActorType];
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

            return (
              <div key={item.id} className="flex items-start gap-3 py-3">
                <div className="flex flex-col items-center">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${colorClass}`}>
                    <IconComponent className="h-4 w-4" />
                  </div>
                  {index < allItems.length - 1 && (
                    <div className="w-px flex-1 bg-border mt-1 min-h-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">
                      {toInfo?.zh ?? stateEvent.toStatus}
                    </span>
                    {fromInfo && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ArrowRight className="h-3 w-3" />
                        {fromInfo.zh}
                      </span>
                    )}
                    {stateEvent.rejected && (
                      <Badge variant="destructive" className="text-xs">已拒绝</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {triggerInfo?.zh ?? stateEvent.trigger}
                    {actorInfo && ` · ${actorInfo.zh}`}
                  </p>
                  {stateEvent.reason && (
                    <p className="text-xs text-muted-foreground/70 mt-1 italic">
                      {stateEvent.reason}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground/50 mt-0.5">
                    {item.timestamp.toLocaleString("zh-CN", { hour12: false })}
                    {" · "}
                    {formatRelativeTime(item.timestamp)}
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

function getStatusColorClass(status: string): string {
  const semantics = STATUS_SEMANTICS[status as TaskStatus];
  if (!semantics) return "bg-muted text-muted-foreground";
  switch (semantics.color) {
    case "primary": return "bg-primary/10 text-primary";
    case "success": return "bg-green-500/10 text-green-600 dark:text-green-400";
    case "warning": return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
    case "danger": return "bg-red-500/10 text-red-600 dark:text-red-400";
    default: return "bg-muted text-muted-foreground";
  }
}
