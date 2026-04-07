"use client";

import { useTransition, useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updateWorkspaceSettingsAction } from "@/actions/workspace-actions";
import { toast } from "sonner";
import type { WorkspaceGovernanceSettingsInput } from "@/lib/workspace/types";

interface GovernanceSettingsFormProps {
  workspaceId: string;
  defaultValues: WorkspaceGovernanceSettingsInput;
}

function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-input"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-background shadow-lg transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

type HighRiskChange = "disableAutoRecovery" | "enableApproval" | null;

function getHighRiskChange(
  current: WorkspaceGovernanceSettingsInput,
  prev: WorkspaceGovernanceSettingsInput
): HighRiskChange {
  if (prev.autoRecoveryEnabled && !current.autoRecoveryEnabled) {
    return "disableAutoRecovery";
  }
  if (!prev.requireApprovalBeforeExecution && current.requireApprovalBeforeExecution) {
    return "enableApproval";
  }
  return null;
}

const HIGH_RISK_MESSAGES: Record<NonNullable<HighRiskChange>, { title: string; description: string }> = {
  disableAutoRecovery: {
    title: "关闭自动恢复",
    description:
      "关闭自动恢复后，执行异常的任务不会自动重试，需管理员手工介入处理。确认关闭？",
  },
  enableApproval: {
    title: "开启任务审批",
    description:
      "开启后，团队成员发起的所有任务都需经过审批才能执行，请确认已准备好审批流程。确认开启？",
  },
};

export function GovernanceSettingsForm({
  workspaceId,
  defaultValues,
}: GovernanceSettingsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<WorkspaceGovernanceSettingsInput>(defaultValues);
  const [pendingValues, setPendingValues] = useState<WorkspaceGovernanceSettingsInput | null>(null);
  const [highRiskChange, setHighRiskChange] = useState<HighRiskChange>(null);

  useEffect(() => {
    setValues(defaultValues);
  }, [defaultValues]);

  function handleSubmit(confirmed: boolean = false) {
    if (!confirmed) {
      const risk = getHighRiskChange(values, defaultValues);
      if (risk) {
        setHighRiskChange(risk);
        setPendingValues(values);
        return;
      }
    }

    const submitValues = confirmed && pendingValues ? pendingValues : values;

    setError(null);
    startTransition(async () => {
      const result = await updateWorkspaceSettingsAction({
        workspaceId,
        settings: submitValues,
      });
      if (result.success) {
        toast.success("策略已更新");
      } else {
        setError(result.error);
      }
    });
  }

  function handleConfirmHighRisk() {
    setHighRiskChange(null);
    handleSubmit(true);
  }

  function handleCancelHighRisk() {
    setHighRiskChange(null);
    setPendingValues(null);
  }

  return (
    <>
      <div className="space-y-8">
        <div className="rounded-lg border bg-card p-6 space-y-6">
          {/* 默认 agent 路由偏好 */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <label htmlFor="agentRoutingPreference" className="text-sm font-medium leading-none">
                默认 Agent 路由偏好
              </label>
              <p className="text-sm text-muted-foreground">
                控制任务派发时是自动选择最佳 Agent，还是由管理员手动指定。
              </p>
            </div>
            <Select
              value={values.agentRoutingPreference}
              onValueChange={(v) =>
                setValues((prev) => ({
                  ...prev,
                  agentRoutingPreference: v as "auto" | "manual",
                }))
              }
              disabled={isPending}
            >
              <SelectTrigger id="agentRoutingPreference" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto（自动）</SelectItem>
                <SelectItem value="manual">manual（手动）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="h-px bg-border" />

          {/* 并发任务上限 */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <label htmlFor="maxConcurrentTasks" className="text-sm font-medium leading-none">
                并发任务上限
              </label>
              <p className="text-sm text-muted-foreground">
                团队工作空间同时运行的最大任务数量（1–50）。
              </p>
            </div>
            <Input
              id="maxConcurrentTasks"
              type="number"
              min={1}
              max={50}
              value={values.maxConcurrentTasks}
              onChange={(e) => {
                const num = parseInt(e.target.value, 10);
                if (!isNaN(num)) {
                  setValues((prev) => ({ ...prev, maxConcurrentTasks: num }));
                }
              }}
              disabled={isPending}
              className="w-24"
            />
          </div>

          <div className="h-px bg-border" />

          {/* 自动恢复策略 */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <label htmlFor="autoRecoveryEnabled" className="text-sm font-medium leading-none">
                自动恢复策略
              </label>
              <p className="text-sm text-muted-foreground">
                开启后，执行异常的任务将自动尝试恢复；关闭后需管理员手工介入。
              </p>
            </div>
            <Switch
              id="autoRecoveryEnabled"
              checked={values.autoRecoveryEnabled}
              onCheckedChange={(v) =>
                setValues((prev) => ({ ...prev, autoRecoveryEnabled: v }))
              }
              disabled={isPending}
            />
          </div>

          <div className="h-px bg-border" />

          {/* 任务执行前需审批 */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <label htmlFor="requireApprovalBeforeExecution" className="text-sm font-medium leading-none">
                任务执行前需审批
              </label>
              <p className="text-sm text-muted-foreground">
                开启后，所有任务派发前需经过管理员审批（配置仅保存，派发拦截将在后续版本实现）。
              </p>
            </div>
            <Switch
              id="requireApprovalBeforeExecution"
              checked={values.requireApprovalBeforeExecution}
              onCheckedChange={(v) =>
                setValues((prev) => ({
                  ...prev,
                  requireApprovalBeforeExecution: v,
                }))
              }
              disabled={isPending}
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end">
          <Button onClick={() => handleSubmit(false)} disabled={isPending}>
            {isPending ? "保存中…" : "保存策略"}
          </Button>
        </div>
      </div>

      {highRiskChange && (
        <AlertDialog open={!!highRiskChange} onOpenChange={(v) => { if (!v) handleCancelHighRisk(); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {HIGH_RISK_MESSAGES[highRiskChange].title}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {HIGH_RISK_MESSAGES[highRiskChange].description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancelHighRisk}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmHighRisk}>
                确认
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
