import { getPlanningAgentShortLabel, getPlanningSkillShortLabel } from "@/lib/planning/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  canConfirmPlanningRequest,
  canExecutePlanningRequest,
  canRetryPlanningExecution,
  getPlanningHandoffDispatchModeLabel,
  getPlanningRequestBadgeVariant,
  getPlanningRequestCreatorLabel,
  getPlanningRequestRouteLabel,
  getPlanningRequestStatusLabel,
  resolvePlanningRequestProblemSummary,
  type PlanningRequestListItem,
} from "@/lib/planning/types";

interface PlanningRequestListProps {
  requests: PlanningRequestListItem[];
  hasRepo?: boolean;
  isPending?: boolean;
  selectedRequestId?: string | null;
  onOpenDetail?: (request: PlanningRequestListItem) => void;
  onResolveAnalysis?: (request: PlanningRequestListItem) => void;
  onExecutePlanning?: (request: PlanningRequestListItem) => void;
  onOpenHandoff?: (request: PlanningRequestListItem) => void;
}

export function PlanningRequestList({
  requests,
  hasRepo = true,
  isPending = false,
  selectedRequestId = null,
  onOpenDetail,
  onResolveAnalysis,
  onExecutePlanning,
  onOpenHandoff,
}: PlanningRequestListProps) {
  if (requests.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">当前筛选下还没有规划请求</p>
          <p>你可以切换状态筛选，或直接提交新的目标，让系统开始分析这条规划请求。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => {
        const problem = resolvePlanningRequestProblemSummary(request);
        const selectedAgents = request.selectedAgentKeys.map(getPlanningAgentShortLabel);
        const selectedSkills = request.selectedSkillKeys.map(getPlanningSkillShortLabel);
        const lastStep = request.executionSteps.at(-1) ?? null;
        const canExecute = hasRepo && canExecutePlanningRequest(request);
        const canRetryExecution = hasRepo && canRetryPlanningExecution(request);
        const canConfirm = canConfirmPlanningRequest(request);

        return (
          <Card
            key={request.id}
            className={selectedRequestId === request.id ? "border-primary/40 shadow-sm" : undefined}
          >
            <CardHeader className="gap-3 pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold">{request.rawGoal}</CardTitle>
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span>创建人：{getPlanningRequestCreatorLabel(request.createdByUser)}</span>
                    <span>创建时间：{formatPlanningRequestDateTime(request.createdAt)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {request.routeType ? getPlanningRequestRouteLabel(request.routeType) : "等待识别"}
                  </Badge>
                  <Badge variant={getPlanningRequestBadgeVariant(request.status)}>
                    {getPlanningRequestStatusLabel(request.status)}
                  </Badge>
                  {problem ? (
                    <Badge variant={problem.severity === "critical" ? "destructive" : "secondary"}>
                      {problem.title}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <SummaryStat label="产出工件" value={`${request.generatedArtifactCount}`} />
                <SummaryStat label="衍生任务" value={`${request.derivedTaskCount}`} />
                <SummaryStat label="暂不执行" value={`${request.deferredArtifactCount}`} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <SummaryPanel
                  label="选择理由"
                  value={request.selectionReasonSummary ?? "系统正在判断这条请求应进入哪条链路。"}
                />
                <SummaryPanel label="下一步" value={request.nextStep} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <TagPanel
                  label="已选 PM Agent"
                  emptyText="当前无需 PM Agent"
                  values={selectedAgents}
                />
                <TagPanel
                  label="Skill 序列"
                  emptyText="当前无需 BMAD Skills"
                  values={selectedSkills}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <SummaryPanel
                  label="当前链路"
                  value={
                    request.routeType === "direct-execution"
                      ? "此请求跳过 BMAD 规划，当前只保留执行 handoff 草稿与准备状态。"
                      : lastStep
                        ? `${lastStep.title} · ${lastStep.errorMessage ?? lastStep.outputSummary ?? request.nextStep}`
                        : request.taskHandoffSummary
                          ? `${getPlanningHandoffDispatchModeLabel(request.taskHandoffSummary.dispatchMode)} · 已进入执行准备，尚未开始编码。`
                          : "当前还没有更细粒度的步骤记录。"
                  }
                />
                <SummaryPanel
                  label="问题环节 / 建议动作"
                  value={problem ? `${problem.reason} 建议动作：${problem.nextAction}` : "当前没有需要特别高亮的问题环节。"}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={selectedRequestId === request.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => onOpenDetail?.(request)}
                  disabled={isPending}
                >
                  查看链路详情
                </Button>

                {onOpenHandoff && canConfirm ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onOpenHandoff(request)}
                    disabled={isPending}
                  >
                    确认并生成执行任务
                  </Button>
                ) : null}

                {onExecutePlanning && canExecute ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onExecutePlanning(request)}
                    disabled={isPending}
                  >
                    {canRetryExecution ? "重试失败步骤" : "执行规划"}
                  </Button>
                ) : null}

                {onResolveAnalysis && (request.status === "analyzing" || request.status === "failed") ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onResolveAnalysis(request)}
                    disabled={isPending}
                  >
                    {request.status === "failed" ? "重新分析" : "继续分析"}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/80 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SummaryPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/10 p-3 text-sm">
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-1 text-muted-foreground">{value}</p>
    </div>
  );
}

function TagPanel({
  label,
  values,
  emptyText,
}: {
  label: string;
  values: string[];
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/10 p-3 text-sm">
      <p className="font-medium text-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.length > 0 ? (
          values.map((value) => (
            <Badge key={value} variant="secondary">
              {value}
            </Badge>
          ))
        ) : (
          <span className="text-muted-foreground">{emptyText}</span>
        )}
      </div>
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
