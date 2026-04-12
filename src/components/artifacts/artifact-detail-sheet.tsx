"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createTaskFromArtifactAction, getArtifactTaskHistoryAction, getTaskCreationContextAction } from "@/actions/task-actions";
import { ArtifactTaskHistory } from "@/components/artifacts/artifact-task-history";
import { MarkdownRenderer } from "@/components/docs/markdown-renderer";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { buildDefaultTaskDraft } from "@/lib/tasks/defaults";
import {
  TASK_INTENT_LABELS,
  TASK_INTENT_VALUES,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_LABELS,
  type CreatedTaskPayload,
  type TaskCreationContext,
  type TaskIntent,
  type TaskPriority,
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
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [intent, setIntent] = useState<TaskIntent>("implement");
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
  const visibleCreatedTask = createdTask?.sourceArtifact.artifactId === currentArtifactId ? createdTask : null;
  const visibleHistory = historyState.artifactId === currentArtifactId && historyState.filter === historyFilter ? historyState.payload : null;
  const historyError = historyState.artifactId === currentArtifactId && historyState.filter === historyFilter ? historyState.error : null;
  const isHistoryLoading = open
    && activeTab === "history"
    && Boolean(currentArtifactId)
    && historyState.artifactId === currentArtifactId
    && historyState.filter === historyFilter
    && historyState.isLoading;

  useEffect(() => {
    if (!open || !currentArtifactId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = await getTaskCreationContextAction(workspaceId, projectId, currentArtifactId);
      if (cancelled) {
        return;
      }

      if (result.success) {
        setContextState({ artifactId: currentArtifactId, context: result.data, error: null });
        const draft = buildDefaultTaskDraft(result.data);
        setTitle(draft.title);
        setGoal(draft.goal);
        setPriority(draft.priority);
        setIntent(draft.intent);
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

  function handleCreateTask() {
    if (!selection || !context) {
      return;
    }

    setSubmitState({ artifactId: selection.node.id, error: null });
    startSubmitTransition(async () => {
      const result = await createTaskFromArtifactAction({
        workspaceId,
        projectId,
        artifactId: selection.node.id,
        title,
        goal,
        priority,
        intent,
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
                    {isLoadingContext ? (
                      <ContextSkeleton />
                    ) : loadingError ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                        {loadingError}
                      </div>
                    ) : context ? (
                      <>
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">上下文摘要</CardTitle>
                            <CardDescription>
                              创建任务时会复用这里的来源工件信息。
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <p className="text-sm leading-6 text-muted-foreground">{context.summary}</p>

                            {context.acceptanceCriteria.length > 0 ? (
                              <div className="space-y-2">
                                <div className="text-sm font-medium">相关验收标准</div>
                                <ul className="space-y-2 text-sm text-muted-foreground">
                                  {context.acceptanceCriteria.map((criterion, index) => (
                                    <li key={criterion} className="flex gap-2">
                                      <span>{index + 1}.</span>
                                      <span>{criterion}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {context.relatedStoryIds.length > 0 ? (
                              <div className="space-y-2">
                                <div className="text-sm font-medium">关联 Story</div>
                                <div className="flex flex-wrap gap-2">
                                  {context.relatedStoryIds.map((storyId) => (
                                    <Badge key={storyId} variant="outline">
                                      Story {storyId}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">工件详情</CardTitle>
                            <CardDescription>可在创建前快速确认来源内容是否正确。</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="max-h-80 overflow-hidden rounded-lg border p-4">
                              <MarkdownRenderer content={context.detailMarkdown} />
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <Sparkles className="h-4 w-4" />
                              发起执行
                            </CardTitle>
                            <CardDescription>
                              低摩擦创建任务：补充目标、优先级和执行意图后立即提交。
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <Field label="任务标题">
                              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
                            </Field>

                            <Field label="任务目标">
                              <Textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={4} maxLength={500} />
                            </Field>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field label="优先级">
                                <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="选择优先级" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TASK_PRIORITY_VALUES.map((item) => (
                                      <SelectItem key={item} value={item}>
                                        {TASK_PRIORITY_LABELS[item]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Field>

                              <Field label="执行意图">
                                <Select value={intent} onValueChange={(value) => setIntent(value as TaskIntent)}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="选择执行意图" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TASK_INTENT_VALUES.map((item) => (
                                      <SelectItem key={item} value={item}>
                                        {TASK_INTENT_LABELS[item]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                            </div>

                            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
                          </CardContent>
                        </Card>

                        {visibleCreatedTask ? (
                          <Card className="border-primary/20 bg-primary/5">
                            <CardHeader>
                              <CardTitle className="text-base">任务已创建</CardTitle>
                              <CardDescription>
                                你现在可以直接查看任务详情，或切换到“执行历史”查看最新记录。
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 text-sm">
                              <div className="grid gap-3 sm:grid-cols-3">
                                <FeedbackItem label="当前阶段" value={visibleCreatedTask.currentStage} />
                                <FeedbackItem label="系统正在做什么" value={visibleCreatedTask.currentActivity} />
                                <FeedbackItem label="下一步预计是什么" value={visibleCreatedTask.nextStep} />
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge>{TASK_STATUS_LABELS[visibleCreatedTask.status]}</Badge>
                                <Badge variant="outline">任务 ID: {visibleCreatedTask.taskId}</Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ) : null}
                      </>
                    ) : null}
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
                <Button onClick={handleCreateTask} disabled={isSubmitting || isLoadingContext || !context || !title.trim() || !goal.trim()}>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function FeedbackItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-medium leading-6">{value}</div>
    </div>
  );
}

function ContextSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    </div>
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
