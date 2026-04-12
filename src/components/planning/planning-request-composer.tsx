"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  analyzePlanningRequestAction,
  createPlanningRequestAction,
  executePlanningRequestAction,
  retryAnalyzePlanningRequestAction,
} from "@/actions/planning-actions";
import { PlanningRequestList } from "@/components/planning/planning-request-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_PLANNING_REQUEST_LIMIT,
  getMeaningfulGoalLength,
  getPlanningRequestStatusLabel,
  type PlanningRequestListItem,
  PLANNING_REQUEST_MAX_GOAL_LENGTH,
  validatePlanningGoal,
} from "@/lib/planning/types";

interface PlanningRequestComposerProps {
  workspaceId: string;
  projectId: string;
  initialRequests: PlanningRequestListItem[];
  hasRepo: boolean;
}

export const PLANNING_GOAL_HELP_ID = "planning-goal-help";
export const PLANNING_GOAL_ERROR_ID = "planning-goal-error";
const PLANNING_REQUEST_SUBMIT_ERROR = "规划请求创建失败，请稍后重试。";

type CreatePlanningRequestResult = Awaited<ReturnType<typeof createPlanningRequestAction>>;
type AnalyzePlanningRequestResult = Awaited<ReturnType<typeof analyzePlanningRequestAction>>;

interface SubmitPlanningRequestFlowInput {
  workspaceId: string;
  projectId: string;
  rawGoal: string;
  createRequest?: typeof createPlanningRequestAction;
  analyzeRequest?: typeof analyzePlanningRequestAction;
  onCreated?: (request: PlanningRequestListItem) => void | Promise<void>;
}

interface SubmitPlanningRequestFlowResult {
  createResult: CreatePlanningRequestResult;
  analyzeResult: AnalyzePlanningRequestResult | null;
  latestRequest: PlanningRequestListItem | null;
}

export interface PlanningRequestComposerViewProps {
  goal: string;
  onGoalChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onGoalKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onResolveAnalysis: (request: PlanningRequestListItem) => void;
  onExecutePlanning: (request: PlanningRequestListItem) => void;
  isPending: boolean;
  error: string | null;
  latestAcceptedRequest: PlanningRequestListItem | null;
  requests: PlanningRequestListItem[];
  hasRepo: boolean;
}

export function isPlanningRequestSubmissionBlocked(isPending: boolean, isSubmitLocked: boolean): boolean {
  return isPending || isSubmitLocked;
}

export function getPlanningGoalDescribedBy(hasError: boolean): string {
  return hasError
    ? `${PLANNING_GOAL_HELP_ID} ${PLANNING_GOAL_ERROR_ID}`
    : PLANNING_GOAL_HELP_ID;
}

export function mergePlanningRequests(
  currentRequests: PlanningRequestListItem[],
  incomingRequest: PlanningRequestListItem,
  limit = DEFAULT_PLANNING_REQUEST_LIMIT,
): PlanningRequestListItem[] {
  return [
    incomingRequest,
    ...currentRequests.filter((request) => request.id !== incomingRequest.id),
  ].slice(0, limit);
}

export function reconcileLatestAcceptedPlanningRequest(
  serverRequests: PlanningRequestListItem[],
  latestAcceptedRequest: PlanningRequestListItem | null,
): PlanningRequestListItem | null {
  if (!latestAcceptedRequest) {
    return null;
  }

  return serverRequests.find((request) => request.id === latestAcceptedRequest.id) ?? latestAcceptedRequest;
}

export async function submitPlanningRequestFlow(
  input: SubmitPlanningRequestFlowInput,
): Promise<SubmitPlanningRequestFlowResult> {
  const createRequest = input.createRequest ?? createPlanningRequestAction;
  const analyzeRequest = input.analyzeRequest ?? analyzePlanningRequestAction;

  const createResult = await createRequest({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    rawGoal: input.rawGoal,
  });

  if (!createResult.success) {
    return {
      createResult,
      analyzeResult: null,
      latestRequest: null,
    };
  }

  await input.onCreated?.(createResult.data.request);

  const analyzeResult = await analyzeRequest({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    planningRequestId: createResult.data.request.id,
  });

  return {
    createResult,
    analyzeResult,
    latestRequest: analyzeResult?.success
      ? analyzeResult.data.request
      : createResult.data.request,
  };
}

function getAnalysisSuccessToastMessage(request: PlanningRequestListItem): string {
  if (request.status === "execution-ready") {
    return "已识别为可直接进入执行";
  }

  return "已完成规划意图识别";
}

function getAnalysisRecoveryErrorMessage(request: PlanningRequestListItem): string {
  return request.selectionReasonSummary ?? request.nextStep;
}

function getExecutionFailureMessage(request: PlanningRequestListItem): string {
  return request.executionSteps.find((step) => step.status === "failed")?.errorMessage
    ?? request.nextStep;
}

export function PlanningRequestComposer({
  workspaceId,
  projectId,
  initialRequests,
  hasRepo,
}: PlanningRequestComposerProps) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [latestAcceptedRequest, setLatestAcceptedRequest] = useState<PlanningRequestListItem | null>(null);
  const submitLockRef = useRef(false);
  const [isSubmitLocked, setIsSubmitLocked] = useState(false);
  const [isPending, startTransition] = useTransition();
  const resolvedLatestAcceptedRequest = reconcileLatestAcceptedPlanningRequest(initialRequests, latestAcceptedRequest);
  const requests = resolvedLatestAcceptedRequest
    ? mergePlanningRequests(initialRequests, resolvedLatestAcceptedRequest)
    : initialRequests;
  const isSubmitting = isPlanningRequestSubmissionBlocked(isPending, isSubmitLocked);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current || isSubmitting) {
      return;
    }

    const validation = validatePlanningGoal(goal);
    if (!validation.valid) {
      setError(validation.message);
      return;
    }

    setError(null);
    submitLockRef.current = true;
    setIsSubmitLocked(true);
    startTransition(async () => {
      try {
        const flowResult = await submitPlanningRequestFlow({
          workspaceId,
          projectId,
          rawGoal: validation.rawGoal,
          onCreated: (request) => {
            setGoal("");
            setLatestAcceptedRequest(request);
            toast.success("规划请求已接收，正在分析意图");
            router.refresh();
          },
        });

        if (!flowResult.createResult.success) {
          setError(flowResult.createResult.error);
          toast.error(flowResult.createResult.error);
          return;
        }

        if (!flowResult.analyzeResult?.success) {
          if (flowResult.analyzeResult) {
            setError(flowResult.analyzeResult.error);
            toast.error(flowResult.analyzeResult.error);
          } else {
            setError(PLANNING_REQUEST_SUBMIT_ERROR);
            toast.error(PLANNING_REQUEST_SUBMIT_ERROR);
          }
          router.refresh();
          return;
        }

        setLatestAcceptedRequest(flowResult.latestRequest);
        toast.success(getAnalysisSuccessToastMessage(flowResult.analyzeResult.data.request));
        router.refresh();
      } catch {
        setError(PLANNING_REQUEST_SUBMIT_ERROR);
        toast.error(PLANNING_REQUEST_SUBMIT_ERROR);
      } finally {
        submitLockRef.current = false;
        setIsSubmitLocked(false);
      }
    });
  }

  function handleGoalKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleResolveAnalysis(request: PlanningRequestListItem) {
    if (submitLockRef.current || isSubmitting) {
      return;
    }

    setError(null);
    submitLockRef.current = true;
    setIsSubmitLocked(true);
    startTransition(async () => {
      try {
        const action =
          request.status === "failed"
            ? retryAnalyzePlanningRequestAction
            : analyzePlanningRequestAction;

        const result = await action({
          workspaceId,
          projectId,
          planningRequestId: request.id,
        });

        if (!result.success) {
          setError(result.error);
          toast.error(result.error);
          return;
        }

        setLatestAcceptedRequest(result.data.request);
        if (result.data.request.status === "failed") {
          const errorMessage = getAnalysisRecoveryErrorMessage(result.data.request);
          setError(errorMessage);
          toast.error(errorMessage);
        } else if (result.data.request.status === "analyzing") {
          toast.success("已继续尝试分析规划请求");
        } else {
          toast.success(getAnalysisSuccessToastMessage(result.data.request));
        }
        router.refresh();
      } catch {
        const fallbackMessage =
          request.status === "failed"
            ? "重新分析规划请求失败，请稍后重试。"
            : "继续分析规划请求失败，请稍后重试。";
        setError(fallbackMessage);
        toast.error(fallbackMessage);
      } finally {
        submitLockRef.current = false;
        setIsSubmitLocked(false);
      }
    });
  }

  function handleExecutePlanning(request: PlanningRequestListItem) {
    if (submitLockRef.current || isSubmitting) {
      return;
    }

    setError(null);
    submitLockRef.current = true;
    setIsSubmitLocked(true);
    startTransition(async () => {
      try {
        const result = await executePlanningRequestAction({
          workspaceId,
          projectId,
          planningRequestId: request.id,
        });

        if (!result.success) {
          setError(result.error);
          toast.error(result.error);
          return;
        }

        setLatestAcceptedRequest(result.data.request);
        if (result.data.request.status === "failed") {
          const failureMessage = getExecutionFailureMessage(result.data.request);
          setError(failureMessage);
          toast.error(failureMessage);
        } else if (result.data.request.status === "awaiting-confirmation") {
          toast.success("规划工件已生成，可以查看摘要并继续确认。");
        } else if (result.data.didExecute) {
          toast.success("规划执行已开始并同步最新工件。");
        } else {
          toast.success("规划请求状态已是最新，无需重复执行。");
        }

        router.refresh();
      } catch {
        const fallbackMessage = "执行规划失败，请稍后重试。";
        setError(fallbackMessage);
        toast.error(fallbackMessage);
      } finally {
        submitLockRef.current = false;
        setIsSubmitLocked(false);
      }
    });
  }

  return (
    <PlanningRequestComposerView
      goal={goal}
      onGoalChange={setGoal}
      onSubmit={handleSubmit}
      onGoalKeyDown={handleGoalKeyDown}
      onResolveAnalysis={handleResolveAnalysis}
      onExecutePlanning={handleExecutePlanning}
      isPending={isSubmitting}
      error={error}
      latestAcceptedRequest={resolvedLatestAcceptedRequest}
      requests={requests}
      hasRepo={hasRepo}
    />
  );
}

export function PlanningRequestComposerView({
  goal,
  onGoalChange,
  onSubmit,
  onGoalKeyDown,
  onResolveAnalysis,
  onExecutePlanning,
  isPending,
  error,
  latestAcceptedRequest,
  requests,
  hasRepo,
}: PlanningRequestComposerViewProps) {
  const goalDescribedBy = getPlanningGoalDescribedBy(Boolean(error));
  const charCount = goal.trim().length;
  const meaningfulLength = getMeaningfulGoalLength(goal);

  return (
    <section className="space-y-4" aria-labelledby="planning-request-composer-title">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Sparkles className="h-3.5 w-3.5" />
              一句话规划
            </Badge>
            {!hasRepo ? (
              <Badge variant="secondary">未关联仓库也可以先发起规划</Badge>
            ) : null}
          </div>
          <div className="space-y-1">
            <CardTitle id="planning-request-composer-title" className="text-xl">
              一句话描述你希望系统规划的目标
            </CardTitle>
            <CardDescription>
              系统会先创建规划请求，再显示当前阶段、预估进度和下一步动作。支持按 Ctrl/Cmd + Enter 快速提交。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasRepo ? (
            <Alert>
              <Bot className="h-4 w-4" />
              <AlertTitle>当前项目还没有关联仓库</AlertTitle>
              <AlertDescription>
                这不会阻止你先发起规划请求。后续如需读取 BMAD 工件或扫描仓库，再补充仓库关联即可。
              </AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-2">
              <label htmlFor="planning-raw-goal" className="text-sm font-medium">
                规划目标
              </label>
              <Textarea
                id="planning-raw-goal"
                value={goal}
                onChange={(event) => onGoalChange(event.target.value)}
                onKeyDown={onGoalKeyDown}
                placeholder="例如：为项目添加用户反馈收集功能"
                disabled={isPending}
                aria-invalid={error ? true : undefined}
                aria-describedby={goalDescribedBy}
                rows={4}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <p id={PLANNING_GOAL_HELP_ID}>
                  至少需要 6 个有效字符。当前有效字符 {meaningfulLength} 个，总长度 {charCount}/{PLANNING_REQUEST_MAX_GOAL_LENGTH}。
                </p>
                <p>提交后会立即生成规划请求记录</p>
              </div>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>提交失败</AlertTitle>
                <AlertDescription id={PLANNING_GOAL_ERROR_ID}>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    提交中…
                  </>
                ) : (
                  "发起规划请求"
                )}
              </Button>
              <p className="text-sm text-muted-foreground">
                适合输入一句明确目标，例如功能规划、流程设计或产品改造方向。
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      {latestAcceptedRequest ? (
        <Alert>
          <AlertTitle>请求已接收</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>当前阶段：{getPlanningRequestStatusLabel(latestAcceptedRequest.status)}</p>
            <p>预估进度：{latestAcceptedRequest.progressPercent}%</p>
            <p>下一步：{latestAcceptedRequest.nextStep}</p>
            <p>创建时间：{formatPlanningRequestDateTime(latestAcceptedRequest.createdAt)}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">最近规划请求</h2>
          <p className="text-sm text-muted-foreground">
            这里展示当前项目最近提交的规划请求状态，方便你确认系统已经接单。
          </p>
        </div>
        <PlanningRequestList
          requests={requests}
          hasRepo={hasRepo}
          isPending={isPending}
          onResolveAnalysis={onResolveAnalysis}
          onExecutePlanning={onExecutePlanning}
        />
      </div>
    </section>
  );
}

function formatPlanningRequestDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间待记录";
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}
