import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPlanningRequestBadgeVariant,
  getPlanningRequestCreatorLabel,
  getPlanningRequestStatusLabel,
  type PlanningRequestListItem,
} from "@/lib/planning/types";

interface PlanningRequestListProps {
  requests: PlanningRequestListItem[];
}

export function PlanningRequestList({ requests }: PlanningRequestListProps) {
  if (requests.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">还没有规划请求</p>
          <p>输入一句目标后，系统会先创建请求，再展示当前阶段、预估进度和下一步动作。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => {
        const statusLabel = getPlanningRequestStatusLabel(request.status);
        const creatorLabel = getPlanningRequestCreatorLabel(request.createdByUser);
        const createdAt = formatPlanningRequestDateTime(request.createdAt);

        return (
          <Card key={request.id}>
            <CardHeader className="gap-3 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold">{request.rawGoal}</CardTitle>
                <Badge variant={getPlanningRequestBadgeVariant(request.status)}>{statusLabel}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>创建人：{creatorLabel}</span>
                <span>创建时间：{createdAt}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">预估进度</span>
                  <span>{request.progressPercent}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${statusLabel}，预估进度 ${request.progressPercent}%`}
                  aria-valuenow={request.progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2 rounded-full bg-muted"
                >
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(0, Math.min(request.progressPercent, 100))}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">下一步</p>
                <p className="text-muted-foreground">{request.nextStep}</p>
              </div>

              {request.status === "failed" ? (
                <p className="text-sm text-destructive">
                  本次规划未能完成，可修改目标描述后重新提交。
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function formatPlanningRequestDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间待记录";
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}
