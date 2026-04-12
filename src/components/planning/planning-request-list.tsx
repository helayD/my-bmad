import { getPlanningAgentShortLabel, getPlanningSkillShortLabel } from "@/lib/planning/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  canExecutePlanningRequest,
  canRetryPlanningExecution,
  getPlanningArtifactSyncStatusLabel,
  getPlanningExecutionStepBadgeVariant,
  getPlanningExecutionStepStatusLabel,
  getPlanningRequestBadgeVariant,
  getPlanningRequestCreatorLabel,
  getPlanningRequestRouteLabel,
  getPlanningRequestStatusLabel,
  type PlanningRequestListItem,
} from "@/lib/planning/types";

interface PlanningRequestListProps {
  requests: PlanningRequestListItem[];
  hasRepo?: boolean;
  isPending?: boolean;
  onResolveAnalysis?: (request: PlanningRequestListItem) => void;
  onExecutePlanning?: (request: PlanningRequestListItem) => void;
}

export function PlanningRequestList({
  requests,
  hasRepo = true,
  isPending = false,
  onResolveAnalysis,
  onExecutePlanning,
}: PlanningRequestListProps) {
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
        const analyzedAt = request.analyzedAt
          ? formatPlanningRequestDateTime(request.analyzedAt)
          : null;
        const routeLabel = request.routeType ? getPlanningRequestRouteLabel(request.routeType) : "等待识别";
        const selectedAgents = request.selectedAgentKeys.map(getPlanningAgentShortLabel);
        const selectedSkills = request.selectedSkillKeys.map(getPlanningSkillShortLabel);
        const executionSteps = request.executionSteps ?? [];
        const artifactSummary = request.artifactSummary ?? [];
        const failedStep = executionSteps.find((step) => step.status === "failed") ?? null;
        const hasExecutionFailure = request.status === "failed" && failedStep !== null;
        const failureSummary = hasExecutionFailure
          ? failedStep.errorMessage ?? request.nextStep
          : request.selectionReasonSummary ?? request.nextStep;
        const executionAwareRequest = {
          ...request,
          executionSteps,
        };
        const canExecute = hasRepo && canExecutePlanningRequest(executionAwareRequest);
        const canRetryExecution = hasRepo && canRetryPlanningExecution(executionAwareRequest);
        const showExecuteAction = canExecute && onExecutePlanning;
        const showExecutionSummary =
          executionSteps.length > 0 || artifactSummary.length > 0;

        return (
          <Card key={request.id}>
            <CardHeader className="gap-3 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold">{request.rawGoal}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{routeLabel}</Badge>
                  <Badge variant={getPlanningRequestBadgeVariant(request.status)}>{statusLabel}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>创建人：{creatorLabel}</span>
                <span>创建时间：{createdAt}</span>
                {analyzedAt ? <span>分析时间：{analyzedAt}</span> : null}
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

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground">选择理由</p>
                  <p className="text-muted-foreground">
                    {request.selectionReasonSummary ?? "系统正在判定是否需要先进入规划链路。"}
                  </p>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground">下一步</p>
                  <p className="text-muted-foreground">{request.nextStep}</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground">已选 PM Agent</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedAgents.length > 0 ? (
                      selectedAgents.map((agent) => (
                        <Badge key={agent} variant="secondary">
                          {agent}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">当前无需 PM Agent</span>
                    )}
                  </div>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground">Skill 序列</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedSkills.length > 0 ? (
                      selectedSkills.map((skill) => (
                        <Badge key={skill} variant="secondary">
                          {skill}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">当前无需 BMAD Skills</span>
                    )}
                  </div>
                </div>
              </div>

              {request.routeType === "planning" ? (
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-foreground">规划执行</p>
                      <p className="text-muted-foreground">
                        {hasRepo
                          ? "系统会按已选 Skill 顺序生成工件，并在每一步完成后同步 BMAD artifact 真值。"
                          : "当前项目尚未关联仓库，只能先分析规划意图；生成工件前需要先关联仓库。"}
                      </p>
                    </div>
                    {showExecuteAction ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onExecutePlanning(request)}
                        disabled={isPending}
                      >
                        {canRetryExecution ? "重试失败步骤" : "执行规划"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {request.routeType === "direct-execution" ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
                  此请求将跳过 BMAD 规划，进入执行链准备阶段。当前只会保存执行 handoff 草稿，不会直接宣称已开始编码。
                </div>
              ) : null}

              {showExecutionSummary ? (
                <div className="space-y-3 rounded-lg border border-border/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">步骤状态</p>
                    {request.generatedArtifactCount > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        已生成 {request.generatedArtifactCount} 个工件
                      </span>
                    ) : null}
                  </div>

                  {executionSteps.length > 0 ? (
                    <div className="space-y-2">
                      {executionSteps.map((step) => (
                        <div
                          key={step.id}
                          className="rounded-md border border-border/60 bg-background/70 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-foreground">{step.title}</p>
                              <p className="text-xs text-muted-foreground">{step.stepKey}</p>
                            </div>
                            <Badge variant={getPlanningExecutionStepBadgeVariant(step.status)}>
                              {getPlanningExecutionStepStatusLabel(step.status)}
                            </Badge>
                          </div>
                          {step.outputSummary ? (
                            <p className="mt-2 text-sm text-muted-foreground">{step.outputSummary}</p>
                          ) : null}
                          {step.errorMessage ? (
                            <p className="mt-2 text-sm text-destructive">{step.errorMessage}</p>
                          ) : null}
                          {step.artifactPaths.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {step.artifactPaths.map((artifactPath) => (
                                <Badge key={artifactPath} variant="outline" className="font-mono text-[11px]">
                                  {artifactPath}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {artifactSummary.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">产出摘要</p>
                      <div className="space-y-2">
                        {artifactSummary.map((artifact) => (
                          <div
                            key={artifact.path}
                            className="rounded-md border border-border/60 bg-background/70 p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-medium text-foreground">{artifact.title}</p>
                              <Badge variant="outline">
                                {getPlanningArtifactSyncStatusLabel(artifact.status)}
                              </Badge>
                            </div>
                            <p className="mt-1 text-muted-foreground">{artifact.summary}</p>
                            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                              {artifact.path}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {request.status === "failed" && !hasExecutionFailure ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <p>{failureSummary}</p>
                  {onResolveAnalysis ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => onResolveAnalysis(request)}
                      disabled={isPending}
                    >
                      重新分析
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {hasExecutionFailure ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <p>{failureSummary}</p>
                  <p className="mt-1 text-xs text-destructive/80">
                    已保留此前成功生成的工件。你可以重试失败步骤，或调整目标后重新提交新的规划请求。
                  </p>
                  {showExecuteAction ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => onExecutePlanning(request)}
                      disabled={isPending}
                    >
                      重试失败步骤
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {request.status === "analyzing" ? (
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  <p>如果分析长时间没有推进，可以手动继续分析，避免请求停留在“分析中”。</p>
                  {onResolveAnalysis ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => onResolveAnalysis(request)}
                      disabled={isPending}
                    >
                      继续分析
                    </Button>
                  ) : null}
                </div>
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
