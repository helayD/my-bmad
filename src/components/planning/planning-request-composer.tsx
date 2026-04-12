"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bot, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  analyzePlanningRequestAction,
  confirmPlanningRequestAction,
  createPlanningRequestAction,
  executePlanningRequestAction,
  getPlanningRequestDetailAction,
  getPlanningRequestHandoffPreviewAction,
  retryAnalyzePlanningRequestAction,
} from "@/actions/planning-actions";
import { PlanningRequestDetailSheet } from "@/components/planning/planning-request-detail-sheet";
import { PlanningRequestList } from "@/components/planning/planning-request-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  doesPlanningRequestMatchStatusFilter,
  getPlanningHandoffDispatchModeLabel,
  getMeaningfulGoalLength,
  getPlanningStatusFilterLabel,
  getPlanningRequestStatusLabel,
  type PlanningHandoffPreview,
  type PlanningRequestDetailView,
  type PlanningRequestListItem,
  type PlanningStatusFilter,
  parsePlanningStatusFilter,
  PLANNING_REQUEST_MAX_GOAL_LENGTH,
  validatePlanningGoal,
} from "@/lib/planning/types";

interface PlanningRequestComposerProps {
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
  initialRequests: PlanningRequestListItem[];
  initialPlanningStatus: PlanningStatusFilter;
  initialPlanningRequestId: string | null;
  hasRepo: boolean;
}

export const PLANNING_GOAL_HELP_ID = "planning-goal-help";
export const PLANNING_GOAL_ERROR_ID = "planning-goal-error";
const PLANNING_REQUEST_SUBMIT_ERROR = "规划请求创建失败，请稍后重试。";

type CreatePlanningRequestResult = Awaited<ReturnType<typeof createPlanningRequestAction>>;
type AnalyzePlanningRequestResult = Awaited<ReturnType<typeof analyzePlanningRequestAction>>;
type PlanningRequestDetailResult = Awaited<ReturnType<typeof getPlanningRequestDetailAction>>;

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
  planningStatus: PlanningStatusFilter;
  onChangePlanningStatus: (value: PlanningStatusFilter) => void;
  onOpenDetail?: (request: PlanningRequestListItem) => void;
  onResolveAnalysis?: (request: PlanningRequestListItem) => void;
  onExecutePlanning?: (request: PlanningRequestListItem) => void;
  onOpenHandoff?: (request: PlanningRequestListItem) => void;
  isPending: boolean;
  error: string | null;
  latestAcceptedRequest: PlanningRequestListItem | null;
  requests: PlanningRequestListItem[];
  selectedPlanningRequestId: string | null;
  hasRepo: boolean;
}

interface HandoffDialogState {
  open: boolean;
  request: PlanningRequestListItem | null;
  preview: PlanningHandoffPreview | null;
  deferredArtifactIds: string[];
  error: string | null;
  isLoading: boolean;
}

interface PlanningRequestDetailState {
  requestId: string | null;
  detail: PlanningRequestDetailView | null;
  error: string | null;
  isLoading: boolean;
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
  options?: {
    filter?: PlanningStatusFilter;
    limit?: number;
  },
): PlanningRequestListItem[] {
  const filter = options?.filter ?? "all";
  const limit = options?.limit ?? Number.MAX_SAFE_INTEGER;
  const withoutIncoming = currentRequests.filter((request) => request.id !== incomingRequest.id);
  const nextRequests = doesPlanningRequestMatchStatusFilter(incomingRequest, filter)
    ? [incomingRequest, ...withoutIncoming]
    : withoutIncoming;

  return nextRequests.slice(0, limit);
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

export function buildPlanningProjectUrl(
  pathname: string,
  searchParams: URLSearchParams,
  updates: {
    planningStatus?: PlanningStatusFilter | null;
    planningRequestId?: string | null;
  },
): string {
  const nextSearchParams = new URLSearchParams(searchParams.toString());

  if (updates.planningStatus === null || updates.planningStatus === "all") {
    nextSearchParams.delete("planningStatus");
  } else if (updates.planningStatus) {
    nextSearchParams.set("planningStatus", updates.planningStatus);
  }

  if (updates.planningRequestId === null) {
    nextSearchParams.delete("planningRequestId");
  } else if (updates.planningRequestId) {
    nextSearchParams.set("planningRequestId", updates.planningRequestId);
  }

  const query = nextSearchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function shouldIgnorePlanningDetailResponse(input: {
  activeRequestId: string | null;
  responseRequestId: string;
  activeToken: number;
  responseToken: number;
}): boolean {
  return (
    !input.activeRequestId
    || input.activeRequestId !== input.responseRequestId
    || input.activeToken !== input.responseToken
  );
}

export function shouldIgnorePlanningHandoffPreviewResponse(input: {
  activeRequestId: string | null;
  responseRequestId: string;
  activeToken: number;
  responseToken: number;
}): boolean {
  return (
    !input.activeRequestId
    || input.activeRequestId !== input.responseRequestId
    || input.activeToken !== input.responseToken
  );
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

function getPlanningHandoffSuccessMessage(
  request: PlanningRequestListItem,
  didConfirm: boolean,
): string {
  if (!didConfirm) {
    return "已沿用最新的规划衔接结果，无需重复生成任务。";
  }

  if (request.derivedTaskCount === 0 && request.deferredArtifactCount > 0) {
    return `已确认规划结果，当前 ${request.deferredArtifactCount} 个可执行项已标记为暂不执行。`;
  }

  if (request.deferredArtifactCount > 0) {
    return `已确认规划结果，生成 ${request.derivedTaskCount} 个执行任务，另有 ${request.deferredArtifactCount} 个暂不执行。`;
  }

  return `已确认规划结果，生成 ${request.derivedTaskCount} 个执行任务。`;
}

function getDeferredTaskCount(
  preview: PlanningHandoffPreview | null,
  deferredArtifactIds: string[],
): number {
  if (!preview) {
    return 0;
  }

  const deferredSet = new Set(deferredArtifactIds);

  return preview.groups.reduce((count, group) => {
    if (deferredSet.has(group.storyArtifactId)) {
      return count + group.tasks.length;
    }

    return count + group.tasks.filter((task) => deferredSet.has(task.artifactId)).length;
  }, 0);
}

export function PlanningRequestComposer({
  workspaceId,
  workspaceSlug,
  projectId,
  projectSlug,
  initialRequests,
  initialPlanningStatus,
  initialPlanningRequestId,
  hasRepo,
}: PlanningRequestComposerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [latestAcceptedRequest, setLatestAcceptedRequest] = useState<PlanningRequestListItem | null>(null);
  const [detailState, setDetailState] = useState<PlanningRequestDetailState>({
    requestId: null,
    detail: null,
    error: null,
    isLoading: false,
  });
  const [handoffDialogState, setHandoffDialogState] = useState<HandoffDialogState>({
    open: false,
    request: null,
    preview: null,
    deferredArtifactIds: [],
    error: null,
    isLoading: false,
  });
  const submitLockRef = useRef(false);
  const detailRequestTokenRef = useRef(0);
  const handoffRequestTokenRef = useRef(0);
  const handoffRequestIdRef = useRef<string | null>(null);
  const [isSubmitLocked, setIsSubmitLocked] = useState(false);
  const [detailReloadNonce, setDetailReloadNonce] = useState(0);
  const [isPending, startTransition] = useTransition();
  const activePlanningStatus = parsePlanningStatusFilter(
    searchParams.get("planningStatus") ?? initialPlanningStatus,
  );
  const selectedPlanningRequestId =
    searchParams.get("planningRequestId") ?? initialPlanningRequestId;
  const resolvedLatestAcceptedRequest = reconcileLatestAcceptedPlanningRequest(initialRequests, latestAcceptedRequest);
  const requests = resolvedLatestAcceptedRequest
    ? mergePlanningRequests(initialRequests, resolvedLatestAcceptedRequest, {
        filter: activePlanningStatus,
      })
    : initialRequests;
  const isSubmitting = isPlanningRequestSubmissionBlocked(isPending, isSubmitLocked);
  const selectedPlanningRequest =
    requests.find((request) => request.id === selectedPlanningRequestId)
    ?? detailState.detail?.request
    ?? null;

  function navigatePlanningState(updates: {
    planningStatus?: PlanningStatusFilter | null;
    planningRequestId?: string | null;
  }) {
    const nextUrl = buildPlanningProjectUrl(
      pathname,
      new URLSearchParams(searchParams.toString()),
      updates,
    );
    router.push(nextUrl, { scroll: false });
  }

  function reloadSelectedPlanningDetail(requestId: string) {
    if (selectedPlanningRequestId === requestId) {
      setDetailReloadNonce((current) => current + 1);
    }
  }

  useEffect(() => {
    if (!selectedPlanningRequestId) {
      detailRequestTokenRef.current += 1;
      setDetailState({
        requestId: null,
        detail: null,
        error: null,
        isLoading: false,
      });
      return;
    }

    const responseToken = detailRequestTokenRef.current + 1;
    detailRequestTokenRef.current = responseToken;
    setDetailState((current) => ({
      requestId: selectedPlanningRequestId,
      detail:
        current.requestId === selectedPlanningRequestId ? current.detail : null,
      error: null,
      isLoading: true,
    }));

    let cancelled = false;

    void (async () => {
      const result: PlanningRequestDetailResult = await getPlanningRequestDetailAction({
        workspaceId,
        projectId,
        planningRequestId: selectedPlanningRequestId,
      });

      if (
        cancelled
        || shouldIgnorePlanningDetailResponse({
          activeRequestId: selectedPlanningRequestId,
          responseRequestId: selectedPlanningRequestId,
          activeToken: detailRequestTokenRef.current,
          responseToken,
        })
      ) {
        return;
      }

      if (result.success) {
        setDetailState({
          requestId: selectedPlanningRequestId,
          detail: result.data.detail,
          error: null,
          isLoading: false,
        });
        return;
      }

      setDetailState({
        requestId: selectedPlanningRequestId,
        detail: null,
        error: result.error,
        isLoading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [detailReloadNonce, projectId, selectedPlanningRequestId, workspaceId]);

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

  function handleChangePlanningStatus(nextStatus: PlanningStatusFilter) {
    if (nextStatus === activePlanningStatus) {
      return;
    }

    navigatePlanningState({
      planningStatus: nextStatus,
      planningRequestId: null,
    });
  }

  function handleOpenPlanningDetail(request: PlanningRequestListItem) {
    navigatePlanningState({
      planningStatus: activePlanningStatus,
      planningRequestId: request.id,
    });
  }

  function handlePlanningDetailOpenChange(open: boolean) {
    if (!open) {
      navigatePlanningState({
        planningStatus: activePlanningStatus,
        planningRequestId: null,
      });
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
        reloadSelectedPlanningDetail(result.data.request.id);
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
        reloadSelectedPlanningDetail(result.data.request.id);
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

  function closeHandoffDialog() {
    handoffRequestTokenRef.current += 1;
    handoffRequestIdRef.current = null;
    setHandoffDialogState({
      open: false,
      request: null,
      preview: null,
      deferredArtifactIds: [],
      error: null,
      isLoading: false,
    });
  }

  function handleOpenHandoff(request: PlanningRequestListItem) {
    if (submitLockRef.current || isSubmitting) {
      return;
    }

    setError(null);
    const responseToken = handoffRequestTokenRef.current + 1;
    handoffRequestTokenRef.current = responseToken;
    handoffRequestIdRef.current = request.id;
    setHandoffDialogState({
      open: true,
      request,
      preview: null,
      deferredArtifactIds: [],
      error: null,
      isLoading: true,
    });
    submitLockRef.current = true;
    setIsSubmitLocked(true);

    startTransition(async () => {
      try {
        const result = await getPlanningRequestHandoffPreviewAction({
          workspaceId,
          projectId,
          planningRequestId: request.id,
        });

        if (
          shouldIgnorePlanningHandoffPreviewResponse({
            activeRequestId: handoffRequestIdRef.current,
            responseRequestId: request.id,
            activeToken: handoffRequestTokenRef.current,
            responseToken,
          })
        ) {
          return;
        }

        if (!result.success) {
          setHandoffDialogState((current) => ({
            ...current,
            request,
            error: result.error,
            isLoading: false,
          }));
          toast.error(result.error);
          return;
        }

        setLatestAcceptedRequest(result.data.request);
        reloadSelectedPlanningDetail(result.data.request.id);
        setHandoffDialogState({
          open: true,
          request: result.data.request,
          preview: result.data.preview,
          deferredArtifactIds: [],
          error: null,
          isLoading: false,
        });

        if (result.data.preview.candidateTaskCount === 0) {
          toast.error("当前规划产出尚未形成可执行任务条目。");
        }
      } catch {
        const fallbackMessage = "加载规划衔接预览失败，请稍后重试。";
        if (
          shouldIgnorePlanningHandoffPreviewResponse({
            activeRequestId: handoffRequestIdRef.current,
            responseRequestId: request.id,
            activeToken: handoffRequestTokenRef.current,
            responseToken,
          })
        ) {
          return;
        }
        setHandoffDialogState((current) => ({
          ...current,
          request,
          error: fallbackMessage,
          isLoading: false,
        }));
        toast.error(fallbackMessage);
      } finally {
        submitLockRef.current = false;
        setIsSubmitLocked(false);
      }
    });
  }

  function handleToggleDeferredStory(storyArtifactId: string, checked: boolean) {
    setHandoffDialogState((current) => {
      const nextIds = new Set(current.deferredArtifactIds);
      const group = current.preview?.groups.find((item) => item.storyArtifactId === storyArtifactId);

      if (checked) {
        nextIds.add(storyArtifactId);
        group?.tasks.forEach((task) => nextIds.delete(task.artifactId));
      } else {
        nextIds.delete(storyArtifactId);
      }

      return {
        ...current,
        deferredArtifactIds: [...nextIds],
      };
    });
  }

  function handleToggleDeferredTask(taskArtifactId: string, checked: boolean) {
    setHandoffDialogState((current) => {
      const nextIds = new Set(current.deferredArtifactIds);
      if (checked) {
        nextIds.add(taskArtifactId);
      } else {
        nextIds.delete(taskArtifactId);
      }

      return {
        ...current,
        deferredArtifactIds: [...nextIds],
      };
    });
  }

  function handleConfirmHandoff() {
    if (!handoffDialogState.request || submitLockRef.current || isSubmitting) {
      return;
    }

    setError(null);
    setHandoffDialogState((current) => ({
      ...current,
      error: null,
    }));
    submitLockRef.current = true;
    setIsSubmitLocked(true);

    startTransition(async () => {
      try {
        const result = await confirmPlanningRequestAction({
          workspaceId,
          projectId,
          planningRequestId: handoffDialogState.request!.id,
          deferredArtifactIds: handoffDialogState.deferredArtifactIds,
        });

        if (!result.success) {
          setHandoffDialogState((current) => ({
            ...current,
            error: result.error,
          }));
          toast.error(result.error);
          return;
        }

        setLatestAcceptedRequest(result.data.request);
        reloadSelectedPlanningDetail(result.data.request.id);
        toast.success(getPlanningHandoffSuccessMessage(result.data.request, result.data.didConfirm));
        closeHandoffDialog();
        router.refresh();
      } catch {
        const fallbackMessage = "确认规划结果失败，请稍后重试。";
        setHandoffDialogState((current) => ({
          ...current,
          error: fallbackMessage,
        }));
        toast.error(fallbackMessage);
      } finally {
        submitLockRef.current = false;
        setIsSubmitLocked(false);
      }
    });
  }

  return (
    <>
      <PlanningRequestComposerView
        goal={goal}
        onGoalChange={setGoal}
        onSubmit={handleSubmit}
        onGoalKeyDown={handleGoalKeyDown}
        planningStatus={activePlanningStatus}
        onChangePlanningStatus={handleChangePlanningStatus}
        onOpenDetail={handleOpenPlanningDetail}
        onResolveAnalysis={handleResolveAnalysis}
        onExecutePlanning={handleExecutePlanning}
        onOpenHandoff={handleOpenHandoff}
        isPending={isSubmitting}
        error={error}
        latestAcceptedRequest={resolvedLatestAcceptedRequest}
        requests={requests}
        selectedPlanningRequestId={selectedPlanningRequestId}
        hasRepo={hasRepo}
      />

      <PlanningRequestDetailSheet
        open={Boolean(selectedPlanningRequestId)}
        onOpenChange={handlePlanningDetailOpenChange}
        request={selectedPlanningRequest}
        detail={detailState.detail}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        isLoading={detailState.isLoading}
        error={detailState.error}
        hasRepo={hasRepo}
        isPending={isSubmitting}
        onResolveAnalysis={handleResolveAnalysis}
        onExecutePlanning={handleExecutePlanning}
        onOpenHandoff={handleOpenHandoff}
      />

      <PlanningRequestHandoffDialog
        open={handoffDialogState.open}
        onOpenChange={(open) => {
          if (!open) {
            closeHandoffDialog();
          }
        }}
        preview={handoffDialogState.preview}
        request={handoffDialogState.request}
        deferredArtifactIds={handoffDialogState.deferredArtifactIds}
        error={handoffDialogState.error}
        isPending={isSubmitting || handoffDialogState.isLoading}
        onToggleDeferredStory={handleToggleDeferredStory}
        onToggleDeferredTask={handleToggleDeferredTask}
        onConfirm={handleConfirmHandoff}
      />
    </>
  );
}

export function PlanningRequestComposerView({
  goal,
  onGoalChange,
  onSubmit,
  onGoalKeyDown,
  planningStatus,
  onChangePlanningStatus,
  onOpenDetail,
  onResolveAnalysis,
  onExecutePlanning,
  onOpenHandoff,
  isPending,
  error,
  latestAcceptedRequest,
  requests,
  selectedPlanningRequestId,
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
          <h2 className="text-lg font-semibold">规划请求历史</h2>
          <p className="text-sm text-muted-foreground">
            这里展示当前项目的规划请求历史。你可以按状态筛选，并从摘要卡片打开完整链路详情。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "analyzing", "planning", "awaiting-confirmation", "execution-ready", "completed", "failed"] as const).map((status) => (
            <Button
              key={status}
              type="button"
              variant={planningStatus === status ? "default" : "outline"}
              size="sm"
              onClick={() => onChangePlanningStatus(status)}
              disabled={isPending}
            >
              {getPlanningStatusFilterLabel(status)}
            </Button>
          ))}
        </div>
        <PlanningRequestList
          requests={requests}
          hasRepo={hasRepo}
          isPending={isPending}
          selectedRequestId={selectedPlanningRequestId}
          onOpenDetail={onOpenDetail}
          onResolveAnalysis={onResolveAnalysis}
          onExecutePlanning={onExecutePlanning}
          onOpenHandoff={onOpenHandoff}
        />
      </div>
    </section>
  );
}

function PlanningRequestHandoffDialog({
  open,
  onOpenChange,
  preview,
  request,
  deferredArtifactIds,
  error,
  isPending,
  onToggleDeferredStory,
  onToggleDeferredTask,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: PlanningHandoffPreview | null;
  request: PlanningRequestListItem | null;
  deferredArtifactIds: string[];
  error: string | null;
  isPending: boolean;
  onToggleDeferredStory: (storyArtifactId: string, checked: boolean) => void;
  onToggleDeferredTask: (taskArtifactId: string, checked: boolean) => void;
  onConfirm: () => void;
}) {
  const deferredTaskCount = getDeferredTaskCount(preview, deferredArtifactIds);
  const confirmedTaskCount = preview
    ? Math.max(0, preview.candidateTaskCount - deferredTaskCount)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(42rem,calc(100vh-2rem))] max-w-3xl">
        <DialogHeader>
          <DialogTitle>确认规划结果并生成执行任务</DialogTitle>
          <DialogDescription>
            确认后会把规划结果衔接到执行域，生成 `planned` 任务，但当前仍不会开始编码。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {request ? (
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
              <p className="font-medium text-foreground">{request.rawGoal}</p>
              <p className="mt-1 text-muted-foreground">{request.nextStep}</p>
            </div>
          ) : null}

          {preview ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {getPlanningHandoffDispatchModeLabel(preview.dispatchMode)}
              </Badge>
              <Badge variant={preview.approvalRequired ? "secondary" : "default"}>
                {preview.approvalRequired ? "需审批后派发" : "确认后进入执行准备"}
              </Badge>
              <Badge variant="outline">候选任务 {preview.candidateTaskCount} 个</Badge>
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {isPending && !preview && !error ? (
            <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在整理可执行任务候选…
            </div>
          ) : null}

          {preview && preview.candidateTaskCount === 0 ? (
            <Alert>
              <AlertTitle>暂无可执行任务</AlertTitle>
              <AlertDescription>
                当前规划产出尚未形成可执行任务条目，因此这次确认不会生成执行任务。你可以先补充 Story 细节或重新运行规划。
              </AlertDescription>
            </Alert>
          ) : null}

          {preview && preview.candidateTaskCount > 0 ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <SummaryCard label="将生成执行任务" value={`${confirmedTaskCount} 个`} />
                <SummaryCard label="暂不执行" value={`${deferredTaskCount} 个`} />
              </div>

              <ScrollArea className="h-80 rounded-lg border border-border/70">
                <div className="space-y-3 p-4">
                  {preview.groups.map((group) => {
                    const isStoryDeferred = deferredArtifactIds.includes(group.storyArtifactId);

                    return (
                      <div
                        key={group.storyArtifactId}
                        className="space-y-3 rounded-lg border border-border/70 bg-background p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{group.storyTitle}</p>
                            <p className="text-xs text-muted-foreground">{group.tasks.length} 个候选任务</p>
                          </div>
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <Checkbox
                              checked={isStoryDeferred}
                              onCheckedChange={(checked) =>
                                onToggleDeferredStory(group.storyArtifactId, checked === true)
                              }
                              disabled={isPending}
                            />
                            <span>整个 Story 暂不执行</span>
                          </label>
                        </div>

                        <div className="space-y-2">
                          {group.tasks.map((task) => {
                            const isDeferred = isStoryDeferred || deferredArtifactIds.includes(task.artifactId);

                            return (
                              <div
                                key={task.artifactId}
                                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/10 p-3"
                              >
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-foreground">{task.artifactName}</p>
                                  <p className="font-mono text-[11px] text-muted-foreground">{task.filePath}</p>
                                </div>
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                  <Checkbox
                                    checked={isDeferred}
                                    onCheckedChange={(checked) =>
                                      onToggleDeferredTask(task.artifactId, checked === true)
                                    }
                                    disabled={isPending || isStoryDeferred}
                                  />
                                  <span>该任务暂不执行</span>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isPending || !preview || preview.candidateTaskCount === 0}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                确认中…
              </>
            ) : (
              "确认并生成执行任务"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/10 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
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
