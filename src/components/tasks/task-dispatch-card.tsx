"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { dispatchTaskAction } from "@/actions/execution-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getExecutionAgentCatalog } from "@/lib/execution/catalog";
import type { TaskAgentType } from "@/lib/tasks";

interface TaskDispatchCardProps {
  workspaceId: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  canManageExecution: boolean;
  dispatchState: "ready" | "selection-required" | "approval-required";
  workspaceRoutingPreference: "auto" | "manual";
  preferredAgentType?: string | null;
  previewAgentType?: TaskAgentType | null;
  previewAgentLabel?: string | null;
  previewReasonSummary?: string | null;
}

interface DispatchCardFeedback {
  tone: "info" | "error";
  message: string;
}

export function TaskDispatchCard({
  workspaceId,
  projectId,
  taskId,
  taskTitle,
  taskStatus,
  canManageExecution,
  dispatchState,
  workspaceRoutingPreference,
  preferredAgentType,
  previewAgentType,
  previewAgentLabel,
  previewReasonSummary,
}: TaskDispatchCardProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<DispatchCardFeedback | null>(null);
  const [selectedAgentType, setSelectedAgentType] = useState<TaskAgentType | "">(
    dispatchState === "selection-required"
      ? preferredAgentType === "codex" || preferredAgentType === "claude-code"
        ? preferredAgentType
        : previewAgentType ?? ""
      : "",
  );
  const [isPending, startTransition] = useTransition();

  const requiresApproval = dispatchState === "approval-required";
  const requiresManualSelection = dispatchState === "selection-required";
  const executionAgents = getExecutionAgentCatalog();
  const canDispatch = canManageExecution && taskStatus === "planned" && !requiresApproval;
  const dispatchButtonDisabled = isPending || !canDispatch || (requiresManualSelection && selectedAgentType === "");

  function handleDispatch() {
    if (!canDispatch) {
      return;
    }

    startTransition(async () => {
      const result = await dispatchTaskAction({
        workspaceId,
        projectId,
        taskId,
        agentType: selectedAgentType || undefined,
      });

      if (result.success && result.data.selectionRequired) {
        setSelectedAgentType((current) => current || result.data.recommendedAgentType || "");
        setFeedback({
          tone: "info",
          message: result.data.selectionReasonSummary ?? "当前工作空间要求先指定 Agent，系统不会自动派发。",
        });
        return;
      }

      if (!result.success) {
        setFeedback({
          tone: "error",
          message: result.error,
        });
        toast.error(result.error);
        return;
      }

      setFeedback(null);
      toast.success(result.data.didDispatch ? "任务已完成派发。" : "任务已经是最新派发状态。");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>首次派发</CardTitle>
        <CardDescription>
          将 `planned` 任务正式路由到执行 Agent。这里会诚实区分“等待派发”和“已派发未启动”。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{resolveDispatchStateLabel(dispatchState)}</Badge>
          <Badge variant="outline">
            路由模式：{workspaceRoutingPreference === "manual" ? "人工指定" : "自动选择"}
          </Badge>
          {preferredAgentType === "codex" || preferredAgentType === "claude-code" ? (
            <Badge variant="outline">
              任务偏好：{preferredAgentType === "codex" ? "Codex" : "Claude Code"}
            </Badge>
          ) : null}
          {!requiresApproval && previewAgentLabel ? (
            <Badge variant="secondary">
              {requiresManualSelection ? `系统推荐：${previewAgentLabel}` : `预计 Agent：${previewAgentLabel}`}
            </Badge>
          ) : null}
        </div>

        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
          <DispatchField label="任务标题" value={taskTitle} className="sm:col-span-2" />
          <DispatchField label="当前状态" value={resolveCurrentStateCopy(dispatchState)} />
          <DispatchField
            label="派发后状态"
            value={resolvePostDispatchCopy(dispatchState)}
          />
          <DispatchField
            label="路由说明"
            value={resolveDispatchExplanation(dispatchState, previewReasonSummary)}
            className="sm:col-span-2"
          />
        </div>

        {requiresApproval ? (
          <div className="rounded-lg border border-dashed p-4 text-muted-foreground">
            当前任务仍在等待审批。审批通过前，系统不会创建 Agent Run，也不会进入已派发状态。
          </div>
        ) : requiresManualSelection ? (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="dispatch-agent">
              指定 Agent
            </label>
            <Select value={selectedAgentType} onValueChange={(value) => setSelectedAgentType(value as TaskAgentType)}>
              <SelectTrigger id="dispatch-agent" className="w-full">
                <SelectValue placeholder="请选择要派发的 Agent" />
              </SelectTrigger>
              <SelectContent>
                {executionAgents.map((agent) => (
                  <SelectItem key={agent.type} value={agent.type}>
                    {agent.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selectedAgentType
                ? executionAgents.find((agent) => agent.type === selectedAgentType)?.dispatchHint
                : "请选择一个 Agent，系统会把这次显式选择写入路由摘要和审计事件。"}
            </p>
            {previewReasonSummary ? (
              <p className="text-xs text-muted-foreground">
                推荐理由：{previewReasonSummary}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Sparkles className="h-4 w-4" />
              自动路由会保持可解释
            </div>
            <p className="mt-2">
              派发后会记录所选 Agent、路由原因、命中信号和首个 Agent Run ID，便于后续追踪与重新派发。
            </p>
          </div>
        )}

        {!canManageExecution ? (
          <div className="rounded-lg border border-dashed p-4 text-muted-foreground">
            你当前只有查看权限，不能发起任务派发。
          </div>
        ) : null}

        {feedback ? (
          <div
            className={
              feedback.tone === "error"
                ? "rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive"
                : "rounded-lg border bg-muted/20 p-4 text-foreground"
            }
          >
            {feedback.message}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleDispatch} disabled={dispatchButtonDisabled}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {requiresApproval ? "等待审批" : requiresManualSelection ? "确认派发" : "派发任务"}
          </Button>
          <span className="text-muted-foreground">
            {requiresApproval
              ? "审批通过后，任务才会进入首次派发。"
              : requiresManualSelection
              ? "人工指定只影响本次派发决策，不会伪造“已启动执行”的状态。"
              : "系统只会完成路由与首次派发，不会在这里直接启动 tmux 或执行会话。"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function DispatchField({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all text-sm leading-6">{value}</div>
    </div>
  );
}

function resolveDispatchStateLabel(state: TaskDispatchCardProps["dispatchState"]) {
  switch (state) {
    case "approval-required":
      return "等待审批";
    case "selection-required":
      return "等待指定 Agent";
    default:
      return "等待派发";
  }
}

function resolveCurrentStateCopy(state: TaskDispatchCardProps["dispatchState"]) {
  switch (state) {
    case "approval-required":
      return "已计划，等待审批通过。";
    case "selection-required":
      return "已计划，等待人工指定 Agent。";
    default:
      return "已计划，尚未派发。";
  }
}

function resolvePostDispatchCopy(state: TaskDispatchCardProps["dispatchState"]) {
  return state === "approval-required"
    ? "审批通过后才会进入已派发，并等待执行监督器创建会话。"
    : "已派发，等待执行监督器创建会话并启动。";
}

function resolveDispatchExplanation(
  state: TaskDispatchCardProps["dispatchState"],
  previewReasonSummary?: string | null,
) {
  if (state === "approval-required") {
    return "当前任务受审批门控保护，审批通过前不会开始派发或执行。";
  }

  return previewReasonSummary
    ?? (state === "selection-required"
      ? "当前工作空间要求先明确指定 Agent，系统不会自动越过治理策略。"
      : "系统会综合任务偏好、项目默认和任务意图，为你选择更合适的执行 Agent。");
}
