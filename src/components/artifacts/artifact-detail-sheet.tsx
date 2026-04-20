"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createTaskAction, getArtifactTaskHistoryAction, getTaskCreationContextAction } from "@/actions/task-actions";
import { ArtifactTaskHistory } from "@/components/artifacts/artifact-task-history";
import {
  TaskCreateFormView,
  buildTaskCreateFormStateFromContext,
  createTaskFormState,
  getGoalFieldError,
  shouldApplyTaskCreateContextDraft,
  type TaskCreateFormState,
} from "@/components/tasks/task-create-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type CreatedTaskPayload,
  type TaskCreationContext,
} from "@/lib/tasks/types";
import { buildTaskDetailHref, type ArtifactTaskHistoryFilter, type ArtifactTaskHistoryPayload } from "@/lib/tasks";
import type { ArtifactTreeNode, ArtifactTypeString } from "@/lib/artifacts/types";

interface ArtifactSelection {
  node: ArtifactTreeNode;
  hierarchy: Array<{
    id: string;
    type: ArtifactTypeString;
    name: string;
  }>;
}

interface ArtifactDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
  selection: ArtifactSelection | null;
}

export function ArtifactDetailSheet({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  projectId,
  projectSlug,
  selection,
}: ArtifactDetailSheetProps) {
  const router = useRouter();
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [contextState, setContextState] = useState<{
    artifactId: string | null;
    context: TaskCreationContext | null;
    error: string | null;
  }>({ artifactId: null, context: null, error: null });
  const [createdTask, setCreatedTask] = useState<CreatedTaskPayload | null>(null);
  const [submitState, setSubmitState] = useState<{ artifactId: string | null; error: string | null }>({
    artifactId: null,
    error: null,
  });
  const [formState, setFormState] = useState(() => createTaskFormState());
  const [goalError, setGoalError] = useState<string | null>(null);
  const [detailTabState, setDetailTabState] = useState<{
    artifactId: string | null;
    tab: "overview" | "history";
  }>({ artifactId: null, tab: "overview" });
  const [historyFilterState, setHistoryFilterState] = useState<{
    artifactId: string | null;
    filter: ArtifactTaskHistoryFilter;
  }>({ artifactId: null, filter: "all" });
  const [historyReloadNonce, setHistoryReloadNonce] = useState(0);
  const [historyState, setHistoryState] = useState<{
    artifactId: string | null;
    filter: ArtifactTaskHistoryFilter;
    payload: ArtifactTaskHistoryPayload | null;
    error: string | null;
    isLoading: boolean;
  }>({ artifactId: null, filter: "all", payload: null, error: null, isLoading: false });

  const artifactTypeLabel = formatArtifactType(selection?.node.type);
  const currentArtifactId = selection?.node.id ?? null;
  const activeTab = detailTabState.artifactId === currentArtifactId ? detailTabState.tab : "overview";
  const historyFilter = historyFilterState.artifactId === currentArtifactId ? historyFilterState.filter : "all";
  const isLoadingContext = open && Boolean(currentArtifactId) && contextState.artifactId !== currentArtifactId;
  const context = contextState.artifactId === currentArtifactId ? contextState.context : null;
  const loadingError = contextState.artifactId === currentArtifactId ? contextState.error : null;
  const submitError = submitState.artifactId === currentArtifactId ? submitState.error : null;
  const visibleCreatedTask = createdTask?.sourceArtifact?.artifactId === currentArtifactId ? createdTask : null;
  const visibleHistory = historyState.artifactId === currentArtifactId && historyState.filter === historyFilter ? historyState.payload : null;
  const historyError = historyState.artifactId === currentArtifactId && historyState.filter === historyFilter ? historyState.error : null;
  const isHistoryLoading = open
    && activeTab === "history"
    && Boolean(currentArtifactId)
    && historyState.artifactId === currentArtifactId
    && historyState.filter === historyFilter
    && historyState.isLoading;
  const formEditedRef = useRef(false);

  function applyFormState(nextFormState: TaskCreateFormState = createTaskFormState()) {
    formEditedRef.current = false;
    setFormState(nextFormState);
  }

  function updateFormState(updater: (current: TaskCreateFormState) => TaskCreateFormState) {
    formEditedRef.current = true;
    setFormState((current) => updater(current));
  }

  useEffect(() => {
    if (!open || !currentArtifactId) {
      return;
    }

    let cancelled = false;
    formEditedRef.current = false;

    void (async () => {
      const result = await getTaskCreationContextAction(workspaceId, projectId, currentArtifactId);
      if (cancelled) {
        return;
      }

      if (result.success) {
        setContextState({ artifactId: currentArtifactId, context: result.data, error: null });
        if (shouldApplyTaskCreateContextDraft(formEditedRef.current)) {
          applyFormState(buildTaskCreateFormStateFromContext(result.data));
        }
      } else {
        setContextState({ artifactId: currentArtifactId, context: null, error: result.error });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentArtifactId, open, projectId, workspaceId]);

  useEffect(() => {
    if (!open || !currentArtifactId || activeTab !== "history") {
      return;
    }

    let cancelled = false;

    void (async () => {
      setHistoryState({
        artifactId: currentArtifactId,
        filter: historyFilter,
        payload: null,
        error: null,
        isLoading: true,
      });

      const result = await getArtifactTaskHistoryAction({
        workspaceId,
        projectId,
        artifactId: currentArtifactId,
        status: selection?.node.type === "STORY" && historyFilter !== "all" ? historyFilter : undefined,
      });
      if (cancelled) {
        return;
      }

      if (result.success) {
        setHistoryState({
          artifactId: currentArtifactId,
          filter: historyFilter,
          payload: result.data,
          error: null,
          isLoading: false,
        });
      } else {
        setHistoryState({
          artifactId: currentArtifactId,
          filter: historyFilter,
          payload: null,
          error: result.error,
          isLoading: false,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, currentArtifactId, historyFilter, historyReloadNonce, open, projectId, selection?.node.type, workspaceId]);

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
  }

  function handleHistoryFilterChange(value: ArtifactTaskHistoryFilter) {
    setHistoryFilterState({ artifactId: currentArtifactId, filter: value });
  }

  function handleDetailTabChange(value: string) {
    if (value !== "overview" && value !== "history") {
      return;
    }

    setDetailTabState({ artifactId: currentArtifactId, tab: value });
  }

  function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selection || !context) {
      return;
    }

    const nextGoalError = getGoalFieldError({
      title: formState.title,
      goal: formState.goal,
      priority: formState.priority,
      intent: formState.intent,
      intentDetail: formState.intentDetail,
      preferredAgentType: formState.preferredAgentType,
    });
    setGoalError(nextGoalError);
    if (nextGoalError) {
      return;
    }

    setSubmitState({ artifactId: selection.node.id, error: null });
    startSubmitTransition(async () => {
      const result = await createTaskAction({
        workspaceId,
        projectId,
        artifactId: selection.node.id,
        title: formState.title,
        goal: formState.goal,
        priority: formState.priority,
        intent: formState.intent,
        intentDetail: formState.intentDetail,
        preferredAgentType: formState.preferredAgentType,
      });

      if (result.success) {
        setCreatedTask(result.data);
        setHistoryReloadNonce((current) => current + 1);
        toast.success("任务已创建");
        router.refresh();
        return;
      }

      setSubmitState({ artifactId: selection.node.id, error: result.error });
      toast.error(result.error);
    });
  }

  const taskDetailHref = visibleCreatedTask
    ? buildTaskDetailHref(workspaceSlug, projectSlug, visibleCreatedTask.taskId)
    : null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>工件详情与发起执行</SheetTitle>
          <SheetDescription>
            从当前工件上下文直接创建任务，并立即查看执行阶段反馈。
          </SheetDescription>
        </SheetHeader>

        {!selection ? null : (
          <>
            <ScrollArea className="flex-1 px-4 pb-4">
              <div className="space-y-4">
                <Card>
                  <CardHeader className="gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{artifactTypeLabel}</Badge>
                      {selection.node.metadata?.status ? (
                        <Badge variant="secondary">{String(selection.node.metadata.status)}</Badge>
                      ) : null}
                    </div>
                    <div>
                      <CardTitle className="text-xl">{selection.node.name}</CardTitle>
                      <CardDescription className="mt-2 break-all">
                        {selection.node.filePath}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      {selection.hierarchy.map((item, index) => (
                        <div key={item.id} className="flex items-center gap-2 text-muted-foreground">
                          <Badge variant={item.id === selection.node.id ? "default" : "outline"}>{item.name}</Badge>
                          {index < selection.hierarchy.length - 1 ? <ArrowRight className="h-3.5 w-3.5" /> : null}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <Tabs value={activeTab} onValueChange={handleDetailTabChange} className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="overview">概览</TabsTrigger>
                    <TabsTrigger value="history">执行历史</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4">
                    <TaskCreateFormView
                      formId={`artifact-task-create-form-${currentArtifactId ?? "default"}`}
                      projectName={projectSlug}
                      context={context}
                      isLoadingContext={isLoadingContext}
                      loadError={loadingError}
                      title={formState.title}
                      goal={formState.goal}
                      priority={formState.priority}
                      intent={formState.intent}
                      intentDetail={formState.intentDetail}
                      preferredAgentType={formState.preferredAgentType}
                      goalError={goalError}
                      submitError={submitError}
                      createdTask={visibleCreatedTask}
                      onSubmit={handleCreateTask}
                      onTitleChange={(event) => updateFormState((current) => ({ ...current, title: event.target.value }))}
                      onGoalChange={(event) => {
                        const nextGoal = event.target.value;
                        updateFormState((current) => ({ ...current, goal: nextGoal }));
                        if (goalError) {
                          setGoalError(getGoalFieldError({
                            title: formState.title,
                            goal: nextGoal,
                            priority: formState.priority,
                            intent: formState.intent,
                            intentDetail: formState.intentDetail,
                            preferredAgentType: formState.preferredAgentType,
                          }));
                        }
                      }}
                      onPriorityChange={(value) => updateFormState((current) => ({ ...current, priority: value }))}
                      onIntentChange={(value) => updateFormState((current) => ({ ...current, intent: value }))}
                      onIntentDetailChange={(event) => updateFormState((current) => ({ ...current, intentDetail: event.target.value }))}
                      onPreferredAgentTypeChange={(value) => updateFormState((current) => ({ ...current, preferredAgentType: value }))}
                    />
                  </TabsContent>

                  <TabsContent value="history">
                    <ArtifactTaskHistory
                      artifactType={selection.node.type}
                      filter={historyFilter}
                      onFilterChange={handleHistoryFilterChange}
                      payload={visibleHistory}
                      isLoading={Boolean(isHistoryLoading)}
                      error={historyError}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>

            <Separator />

            <SheetFooter className="gap-2 border-t">
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
                关闭
              </Button>
              {taskDetailHref ? (
                <Button asChild>
                  <Link href={taskDetailHref}>
                    查看任务详情
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <Button
                  type="submit"
                  form={`artifact-task-create-form-${currentArtifactId ?? "default"}`}
                  disabled={isSubmitting || isLoadingContext || !context}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isSubmitting ? "创建中…" : "创建任务"}
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function formatArtifactType(type?: ArtifactTypeString) {
  switch (type) {
    case "PRD":
      return "PRD";
    case "EPIC":
      return "Epic";
    case "STORY":
      return "Story";
    case "TASK":
      return "Task";
    default:
      return "工件";
  }
}
