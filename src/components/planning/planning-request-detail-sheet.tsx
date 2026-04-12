"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { getPlanningAgentShortLabel, getPlanningSkillShortLabel } from "@/lib/planning/catalog";
import {
  canConfirmPlanningRequest,
  canExecutePlanningRequest,
  canRetryPlanningExecution,
  getPlanningArtifactSyncStatusLabel,
  getPlanningExecutionStepBadgeVariant,
  getPlanningExecutionStepStatusLabel,
  getPlanningHandoffReadyStateLabel,
  getPlanningRequestBadgeVariant,
  getPlanningRequestCreatorLabel,
  getPlanningRequestRouteLabel,
  getPlanningRequestStatusLabel,
  type PlanningRequestDetailView,
  type PlanningRequestListItem,
  type PlanningRequestProblemSeverity,
} from "@/lib/planning/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { buildSourceArtifactHref, buildTaskDetailHref, TASK_STATUS_LABELS } from "@/lib/tasks";

interface PlanningRequestDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: PlanningRequestListItem | null;
  detail: PlanningRequestDetailView | null;
  workspaceSlug: string;
  projectSlug: string;
  isLoading: boolean;
  error: string | null;
  hasRepo: boolean;
  isPending?: boolean;
  onResolveAnalysis?: (request: PlanningRequestListItem) => void;
  onExecutePlanning?: (request: PlanningRequestListItem) => void;
  onOpenHandoff?: (request: PlanningRequestListItem) => void;
}

export function PlanningRequestDetailSheet({
  open,
  onOpenChange,
  request,
  detail,
  workspaceSlug,
  projectSlug,
  isLoading,
  error,
  hasRepo,
  isPending = false,
  onResolveAnalysis,
  onExecutePlanning,
  onOpenHandoff,
}: PlanningRequestDetailSheetProps) {
  const activeRequest = detail?.request ?? request;
  const problem = detail?.problem ?? null;
  const selectedAgents = activeRequest?.selectedAgentKeys.map(getPlanningAgentShortLabel) ?? [];
  const selectedSkills = activeRequest?.selectedSkillKeys.map(getPlanningSkillShortLabel) ?? [];
  const routeLabel = activeRequest?.routeType
    ? getPlanningRequestRouteLabel(activeRequest.routeType)
    : "等待识别";
  const actionButtons = activeRequest
    ? resolvePlanningActions({
        request: activeRequest,
        hasRepo,
        isPending,
        onResolveAnalysis,
        onExecutePlanning,
        onOpenHandoff,
      })
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>规划链路详情</SheetTitle>
          <SheetDescription>
            查看从目标输入到执行准备的完整链路与当前状态。这里展示真实的步骤、工件和衍生任务，不会把准备态说成已开始编码。
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-4 pb-4">
          <div className="space-y-4">
            {activeRequest ? (
              <Card>
                <CardHeader className="gap-3 pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base font-semibold">
                        {activeRequest.rawGoal}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        创建人：{getPlanningRequestCreatorLabel(activeRequest.createdByUser)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{routeLabel}</Badge>
                      <Badge variant={getPlanningRequestBadgeVariant(activeRequest.status)}>
                        {getPlanningRequestStatusLabel(activeRequest.status)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>创建时间：{formatPlanningRequestDateTime(activeRequest.createdAt)}</span>
                    {activeRequest.analyzedAt ? (
                      <span>分析时间：{formatPlanningRequestDateTime(activeRequest.analyzedAt)}</span>
                    ) : null}
                    {activeRequest.confirmedAt ? (
                      <span>确认时间：{formatPlanningRequestDateTime(activeRequest.confirmedAt)}</span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <SummaryStat
                      label="产出工件"
                      value={`${activeRequest.generatedArtifactCount}`}
                    />
                    <SummaryStat
                      label="衍生任务"
                      value={`${detail?.derivedTasks.length ?? activeRequest.derivedTaskCount}`}
                    />
                    <SummaryStat
                      label="暂不执行"
                      value={`${detail?.deferredArtifacts.length ?? activeRequest.deferredArtifactCount}`}
                    />
                  </div>

                  {problem ? (
                    <div className={getProblemPanelClassName(problem.severity)}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="flex items-center gap-2 text-sm font-medium">
                            <AlertTriangle className="h-4 w-4" />
                            {problem.title}
                          </p>
                          <p className="text-sm text-muted-foreground">{problem.reason}</p>
                          <p className="text-xs text-muted-foreground">
                            建议动作：{problem.nextAction}
                          </p>
                        </div>
                        {actionButtons.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {actionButtons.map((action) => action)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : actionButtons.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {actionButtons.map((action) => action)}
                    </div>
                  ) : null}

                  {error ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {isLoading ? (
              <PlanningRequestDetailLoadingState />
            ) : null}

            {!activeRequest && !isLoading && error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {activeRequest && detail ? (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">意图识别结果</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">选择理由</p>
                      <p className="text-muted-foreground">
                        {activeRequest.selectionReasonSummary ?? "系统仍在整理这条请求的意图说明。"}
                      </p>
                    </div>
                    {activeRequest.routeType === "direct-execution" ? (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-foreground">
                        此请求跳过了 BMAD 规划步骤，只保留执行 handoff 草稿与当前准备状态，不会伪造 Skill 执行轨迹或规划工件。
                      </div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">已选 PM Agent / Skills</p>
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
                          {selectedSkills.length > 0 ? (
                            selectedSkills.map((skill) => (
                              <Badge key={skill} variant="outline">
                                {skill}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground">当前无需 BMAD Skills</span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">下一步</p>
                        <p className="text-muted-foreground">{activeRequest.nextStep}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">执行步骤时间线</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {activeRequest.routeType === "direct-execution" ? (
                      <EmptyState
                        title="此请求没有规划执行步骤"
                        description="系统会直接进入执行准备，不会为 direct-execution 请求展示伪造的 Skill 执行时间线。"
                      />
                    ) : activeRequest.executionSteps.length === 0 ? (
                      <EmptyState
                        title="还没有规划执行步骤"
                        description="当前请求尚未开始执行规划步骤。你可以先完成分析，或在需要时手动触发规划执行。"
                      />
                    ) : (
                      activeRequest.executionSteps.map((step) => (
                        <div
                          key={step.id}
                          className={
                            step.status === "failed"
                              ? "rounded-lg border border-destructive/30 bg-destructive/5 p-3"
                              : "rounded-lg border border-border/70 bg-background/80 p-3"
                          }
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">{step.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {step.stepKey}
                              </p>
                            </div>
                            <Badge variant={getPlanningExecutionStepBadgeVariant(step.status)}>
                              {getPlanningExecutionStepStatusLabel(step.status)}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {step.startedAt ? (
                              <span>开始：{formatPlanningRequestDateTime(step.startedAt)}</span>
                            ) : null}
                            {step.completedAt ? (
                              <span>完成：{formatPlanningRequestDateTime(step.completedAt)}</span>
                            ) : null}
                            {step.failedAt ? (
                              <span>失败：{formatPlanningRequestDateTime(step.failedAt)}</span>
                            ) : null}
                          </div>
                          {step.outputSummary ? (
                            <p className="mt-2 text-sm text-muted-foreground">
                              {step.outputSummary}
                            </p>
                          ) : null}
                          {step.errorMessage ? (
                            <p className="mt-2 text-sm text-destructive">
                              {step.errorMessage}
                            </p>
                          ) : null}
                          {step.artifactPaths.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {step.artifactPaths.map((artifactPath) => (
                                <Badge key={artifactPath} variant="outline">
                                  {artifactPath}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">产出工件列表</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail.artifacts.length === 0 ? (
                      <EmptyState
                        title="当前没有可展示的规划工件"
                        description={
                          activeRequest.routeType === "direct-execution"
                            ? "该请求跳过了 BMAD 规划，因此不会生成规划工件列表。"
                            : "规划步骤尚未产出工件，或当前请求仍处在分析 / 规划过程中。"
                        }
                      />
                    ) : (
                      detail.artifacts.map((artifact) => (
                        <div
                          key={artifact.path}
                          className="rounded-lg border border-border/70 bg-background/80 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">{artifact.title}</p>
                              <p className="text-sm text-muted-foreground">{artifact.summary}</p>
                            </div>
                            <Badge variant="outline">
                              {getPlanningArtifactSyncStatusLabel(artifact.status)}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>{artifact.path}</span>
                            {artifact.artifactId ? (
                              <Link
                                href={buildSourceArtifactHref(
                                  workspaceSlug,
                                  projectSlug,
                                  artifact.artifactId,
                                )}
                                className="font-medium text-primary hover:underline"
                              >
                                查看工件
                              </Link>
                            ) : (
                              <span>暂未找到对应工件记录，先展示真实路径。</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">衍生执行任务列表</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail.derivedTasks.length === 0 ? (
                      <EmptyState
                        title="当前没有可见的衍生执行任务"
                        description={getDerivedTaskEmptyDescription(activeRequest)}
                      />
                    ) : (
                      detail.derivedTasks.map((task) => (
                        <div
                          key={task.taskId}
                          className="rounded-lg border border-border/70 bg-background/80 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">{task.title}</p>
                              <p className="text-sm text-muted-foreground">{task.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline">{getTaskStatusLabel(task.status)}</Badge>
                              {task.readyState ? (
                                <Badge variant="secondary">
                                  {getPlanningHandoffReadyStateLabel(task.readyState)}
                                </Badge>
                              ) : null}
                              {task.isLegacyPending ? (
                                <Badge variant="outline">兼容 pending</Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {task.queuePosition ? (
                              <span>队列顺位：{task.queuePosition}</span>
                            ) : null}
                            <span>当前阶段：{task.currentStage}</span>
                            {task.storyTitle ? <span>来源 Story：{task.storyTitle}</span> : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3 text-xs">
                            <Link
                              href={buildTaskDetailHref(workspaceSlug, projectSlug, task.taskId)}
                              className="font-medium text-primary hover:underline"
                            >
                              查看任务详情
                            </Link>
                            {task.sourceArtifactId ? (
                              <Link
                                href={buildSourceArtifactHref(
                                  workspaceSlug,
                                  projectSlug,
                                  task.sourceArtifactId,
                                )}
                                className="font-medium text-primary hover:underline"
                              >
                                查看来源工件
                              </Link>
                            ) : null}
                            <span className="text-muted-foreground">{task.sourceArtifactPath}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                {detail.deferredArtifacts.length > 0 ? (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">暂不执行项</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {detail.deferredArtifacts.map((artifact) => (
                        <div
                          key={artifact.artifactId}
                          className="rounded-lg border border-border/70 bg-background/80 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">{artifact.artifactName}</p>
                              <p className="text-sm text-muted-foreground">{artifact.storyTitle}</p>
                            </div>
                            <Badge variant="outline">
                              {artifact.deferredBy === "story" ? "整条 Story 暂不执行" : "该任务暂不执行"}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>{artifact.filePath}</span>
                            {artifact.sourceArtifactId ? (
                              <Link
                                href={buildSourceArtifactHref(
                                  workspaceSlug,
                                  projectSlug,
                                  artifact.sourceArtifactId,
                                )}
                                className="font-medium text-primary hover:underline"
                              >
                                返回工件详情
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                <Separator />
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <CheckCircle2 className="h-4 w-4" />
                    下一步建议
                  </div>
                  <p className="mt-2">
                    你可以基于当前链路继续分析、重试失败步骤、确认规划结果，或返回目标输入区重新调整这条请求的目标描述。
                  </p>
                </div>
              </>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function resolvePlanningActions(input: {
  request: PlanningRequestListItem;
  hasRepo: boolean;
  isPending: boolean;
  onResolveAnalysis?: (request: PlanningRequestListItem) => void;
  onExecutePlanning?: (request: PlanningRequestListItem) => void;
  onOpenHandoff?: (request: PlanningRequestListItem) => void;
}) {
  const actions: ReactNode[] = [];

  if (input.onResolveAnalysis && (input.request.status === "analyzing" || input.request.status === "failed")) {
    actions.push(
      <Button
        key="resolve-analysis"
        type="button"
        variant="outline"
        size="sm"
        onClick={() => input.onResolveAnalysis?.(input.request)}
        disabled={input.isPending}
      >
        {input.request.status === "failed" ? "重新分析" : "继续分析"}
      </Button>,
    );
  }

  if (input.onExecutePlanning && input.hasRepo) {
    if (canRetryPlanningExecution(input.request)) {
      actions.push(
        <Button
          key="retry-execution"
          type="button"
          variant="outline"
          size="sm"
          onClick={() => input.onExecutePlanning?.(input.request)}
          disabled={input.isPending}
        >
          重试失败步骤
        </Button>,
      );
    } else if (canExecutePlanningRequest(input.request)) {
      actions.push(
        <Button
          key="execute-planning"
          type="button"
          size="sm"
          onClick={() => input.onExecutePlanning?.(input.request)}
          disabled={input.isPending}
        >
          执行规划
        </Button>,
      );
    }
  }

  if (input.onOpenHandoff && canConfirmPlanningRequest(input.request)) {
    actions.push(
      <Button
        key="confirm-handoff"
        type="button"
        size="sm"
        onClick={() => input.onOpenHandoff?.(input.request)}
        disabled={input.isPending}
      >
        确认并生成执行任务
      </Button>,
    );
  }

  return actions;
}

function PlanningRequestDetailLoadingState() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载链路详情…
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </CardContent>
    </Card>
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

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-muted-foreground">{description}</p>
    </div>
  );
}

function getProblemPanelClassName(severity: PlanningRequestProblemSeverity) {
  switch (severity) {
    case "critical":
      return "rounded-lg border border-destructive/30 bg-destructive/5 p-3";
    case "warning":
      return "rounded-lg border border-amber-200 bg-amber-50/80 p-3";
    default:
      return "rounded-lg border border-primary/20 bg-primary/5 p-3";
  }
}

function getDerivedTaskEmptyDescription(request: PlanningRequestListItem) {
  if (request.routeType === "direct-execution") {
    return "这条请求只保留了执行 handoff 草稿，当前还没有生成执行任务。";
  }

  if (request.status === "awaiting-confirmation") {
    return "确认规划结果后，系统才会把可执行项衔接成真实任务。";
  }

  if (request.status === "execution-ready") {
    return "当前请求已经进入执行准备，但还没有读取到真实任务记录。你可以返回工件详情补充 Story / Task，或重新规划。";
  }

  return "当前还没有可展示的执行任务。";
}

function getTaskStatusLabel(status: string) {
  return TASK_STATUS_LABELS[status as keyof typeof TASK_STATUS_LABELS] ?? status;
}

function formatPlanningRequestDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间待记录";
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}
