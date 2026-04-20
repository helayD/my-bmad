"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";
import { redispatchTaskAction } from "@/actions/execution-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getExecutionAgentCatalog as loadExecutionAgentCatalog,
} from "@/lib/execution/catalog";
import type { ArtifactTaskHistoryAgentRun } from "@/lib/tasks";

interface TaskRedispatchCardProps {
  workspaceId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  currentActivity: string;
  canManageExecution: boolean;
  routingReason: string | null;
  agentRuns: ArtifactTaskHistoryAgentRun[];
}

interface ActionFeedback {
  tone: "error" | "warning";
  message: string;
}

export function TaskRedispatchCard({
  workspaceId,
  projectId,
  taskId,
  taskTitle,
  taskStatus,
  currentActivity,
  canManageExecution,
  routingReason,
  agentRuns,
}: TaskRedispatchCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [reasonSummary, setReasonSummary] = useState("");
  const [confirmRunningRedispatch, setConfirmRunningRedispatch] = useState(false);
  const [targetAgentType, setTargetAgentType] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const currentRun = agentRuns.find((run) => run.isCurrent) ?? agentRuns[0] ?? null;
  const availableTargets = loadExecutionAgentCatalog()
    .filter((agent) => agent.type !== currentRun?.agentType);
  const isRunning = taskStatus === "in-progress" || currentRun?.status === "running";
  const canRedispatch = Boolean(
    canManageExecution
    && currentRun?.id
    && (taskStatus === "dispatched" || taskStatus === "in-progress"),
  );
  const rerouteCount = agentRuns.filter((run) => run.replacesRunId).length;

  async function handleSubmit() {
    const currentRunId = currentRun?.id;
    if (!currentRunId || !targetAgentType || !reasonSummary.trim()) {
      return;
    }

    startTransition(async () => {
      const result = await redispatchTaskAction({
        workspaceId,
        projectId,
        taskId,
        targetAgentType,
        expectedAgentRunId: currentRunId,
        reasonSummary: reasonSummary.trim(),
        confirmRunningRedispatch,
      });

      if (!result.success) {
        setFeedback({
          tone:
            result.code === "TASK_RUNNING_REDISPATCH_PRECONDITION_MISSING"
              || result.code === "TASK_RUNNING_REDISPATCH_CONFIRMATION_REQUIRED"
              ? "warning"
              : "error",
          message: result.error,
        });
        return;
      }

      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>执行路由</CardTitle>
        <CardDescription>
          查看当前 Agent、Run 历史和重新派发入口。这里会诚实区分“已派发”和“执行中”。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {currentRun ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{currentRun.statusLabel}</Badge>
              <Badge variant="outline">{currentRun.agentTypeLabel}</Badge>
              <Badge variant="outline">当前 Run：{currentRun.id}</Badge>
              {rerouteCount > 0 ? <Badge variant="outline">已改派 {rerouteCount} 次</Badge> : null}
            </div>
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
              <ExecutionField label="当前 Agent" value={currentRun.agentTypeLabel} />
              <ExecutionField label="当前 Run 状态" value={currentRun.statusLabel} />
              <ExecutionField label="最近活动" value={currentActivity} className="sm:col-span-2" />
              {routingReason ? <ExecutionField label="路由原因" value={routingReason} className="sm:col-span-2" /> : null}
              {currentRun.selectionReasonSummary ? (
                <ExecutionField label="当前 Run 摘要" value={currentRun.selectionReasonSummary} className="sm:col-span-2" />
              ) : null}
              {currentRun.terminatedAt ? (
                <ExecutionField
                  label="终止时间"
                  value={new Date(currentRun.terminatedAt).toLocaleString("zh-CN", { hour12: false })}
                />
              ) : null}
            </div>

            {agentRuns.length > 1 ? (
              <div className="space-y-2">
                <div className="font-medium">Run 历史</div>
                <div className="space-y-2">
                  {agentRuns.map((run) => (
                    <div
                      key={run.id ?? `${run.agentTypeLabel}-${run.createdAt ?? "unknown"}`}
                      className="rounded-lg border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={run.isCurrent ? "default" : "outline"}>
                          {run.isCurrent ? "当前 Run" : "历史 Run"}
                        </Badge>
                        <Badge variant="outline">{run.agentTypeLabel}</Badge>
                        <Badge variant="outline">{run.statusLabel}</Badge>
                        {run.id ? <Badge variant="outline">{run.id}</Badge> : null}
                      </div>
                      <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                        {run.createdAt ? (
                          <ExecutionField
                            label="创建时间"
                            value={new Date(run.createdAt).toLocaleString("zh-CN", { hour12: false })}
                          />
                        ) : null}
                        {run.selectionReasonSummary ? (
                          <ExecutionField label="原因" value={run.selectionReasonSummary} className="sm:col-span-2" />
                        ) : null}
                        {run.terminationReasonSummary ? (
                          <ExecutionField label="终止说明" value={run.terminationReasonSummary} className="sm:col-span-2" />
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {canRedispatch ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFeedback(null);
                    setConfirmRunningRedispatch(false);
                    setReasonSummary("");
                    setTargetAgentType(availableTargets[0]?.type ?? "");
                    setOpen(true);
                  }}
                >
                  <RefreshCcw className="h-4 w-4" />
                  重新派发
                </Button>
                <span className="text-muted-foreground">
                  重新派发会创建新的 Agent Run，而不是原地修改当前 Run。
                </span>
              </div>
            ) : !canManageExecution ? (
              <div className="rounded-lg border border-dashed p-3 text-muted-foreground">
                你当前只有查看权限，不能调整路由。
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-3 text-muted-foreground">
                当前任务还没有处于可重新派发的执行态。
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-muted-foreground">
            当前任务还没有 Agent Run 记录，因此暂时不能重新派发。
          </div>
        )}

        {feedback ? (
          <div
            className={
              feedback.tone === "warning"
                ? "rounded-lg border border-warning/30 bg-warning/5 p-4 text-warning-foreground"
                : "rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive"
            }
          >
            {feedback.message}
          </div>
        ) : null}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>确认重新派发</DialogTitle>
              <DialogDescription>
                你正在调整任务《{taskTitle}》的执行路由。系统会创建新的 Agent Run，并保留已有执行链路。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
                <ExecutionField label="当前 Agent" value={currentRun?.agentTypeLabel ?? "待分配"} />
                <ExecutionField label="当前 Run" value={currentRun?.id ?? "暂无"} />
                <ExecutionField label="最近活动" value={currentActivity} className="sm:col-span-2" />
                {isRunning ? (
                  <>
                    <ExecutionField label="影响说明" value="重新派发会先终止当前执行，再创建新的 Run。" className="sm:col-span-2" />
                    <ExecutionField label="状态回落" value="新 Run 创建后，任务会回到“已派发”，等待新会话启动。" className="sm:col-span-2" />
                  </>
                ) : (
                  <ExecutionField label="状态回落" value="系统会直接替换当前已派发 Run，并继续保持“已派发”状态。" className="sm:col-span-2" />
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="redispatch-target-agent">
                  目标 Agent
                </label>
                <Select value={targetAgentType} onValueChange={setTargetAgentType}>
                  <SelectTrigger id="redispatch-target-agent" className="w-full">
                    <SelectValue placeholder="选择新的 Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTargets.map((agent) => (
                      <SelectItem key={agent.type} value={agent.type}>
                        {agent.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {targetAgentType ? (
                  <p className="text-xs text-muted-foreground">
                    {availableTargets.find((agent) => agent.type === targetAgentType)?.dispatchHint}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="redispatch-reason">
                  调整原因
                </label>
                <Textarea
                  id="redispatch-reason"
                  value={reasonSummary}
                  onChange={(event) => setReasonSummary(event.target.value)}
                  placeholder="例如：当前任务更偏向方案分析，适合切换到 Claude Code。"
                />
                <p className="text-xs text-muted-foreground">
                  该说明会写入审计事件和新的路由摘要，便于后续追踪。
                </p>
              </div>

              {isRunning ? (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="space-y-2">
                      <p className="font-medium">当前任务正在执行</p>
                      <p className="text-sm text-muted-foreground">
                        重新派发会先终止当前执行会话，系统会保留最近活动和可恢复上下文，再创建新的 Run。
                      </p>
                      <label className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={confirmRunningRedispatch}
                          onCheckedChange={(checked) => setConfirmRunningRedispatch(checked === true)}
                        />
                        <span>我确认终止当前执行并重新派发到新的 Agent。</span>
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              {feedback ? (
                <div
                  className={
                    feedback.tone === "warning"
                      ? "rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning-foreground"
                      : "rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                  }
                >
                  {feedback.message}
                </div>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                取消
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  isPending
                  || !targetAgentType
                  || reasonSummary.trim().length === 0
                  || (isRunning && !confirmRunningRedispatch)
                }
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                确认重新派发
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function ExecutionField({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all text-sm leading-6">{value}</div>
    </div>
  );
}
