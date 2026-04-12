import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StoryStatus, EpicStatus } from "@/lib/bmad/types";

const statusConfig: Record<string, { label: string; className: string }> = {
  done: {
    label: "已完成",
    className: "bg-success/15 text-success-foreground border-success/25",
  },
  "in-progress": {
    label: "进行中",
    className: "bg-info/15 text-info-foreground border-info/25",
  },
  review: {
    label: "待评审",
    className: "bg-warning/15 text-warning-foreground border-warning/25",
  },
  blocked: {
    label: "已阻塞",
    className: "bg-destructive/15 text-destructive-foreground border-destructive/25",
  },
  planned: {
    label: "已规划",
    className: "bg-primary/10 text-primary border-primary/20",
  },
  "ready-for-dev": {
    label: "可开发",
    className: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/25",
  },
  backlog: {
    label: "待处理",
    className: "bg-muted text-muted-foreground border-border",
  },
  "not-started": {
    label: "未开始",
    className: "bg-muted text-muted-foreground border-border",
  },
  unknown: {
    label: "未知",
    className: "bg-muted text-muted-foreground border-border",
  },
};

interface StatusBadgeProps {
  status: StoryStatus | EpicStatus;
  compact?: boolean;
}

export function StatusBadge({ status, compact }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.unknown;
  return (
    <Badge
      variant="outline"
      className={cn("min-w-24 justify-center", config.className, compact && "px-1.5 py-0 text-[10px] leading-4")}
    >
      {config.label}
    </Badge>
  );
}
