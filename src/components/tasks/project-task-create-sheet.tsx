"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createTaskAction, getTaskCreationContextAction } from "@/actions/task-actions";
import {
  TaskCreateFormView,
  buildTaskCreateFormStateFromContext,
  createTaskFormState,
  getGoalFieldError,
  resolveTaskCreateSourceArtifactId,
  shouldApplyTaskCreateContextDraft,
} from "@/components/tasks/task-create-form";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  buildTaskDetailHref,
  type CreatedTaskPayload,
  type TaskCreationContext,
} from "@/lib/tasks";

interface ProjectTaskCreateSheetProps {
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  initialArtifactId?: string;
}

export function ProjectTaskCreateSheet({
  workspaceId,
  workspaceSlug,
  projectId,
  projectSlug,
  projectName,
  initialArtifactId,
}: ProjectTaskCreateSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(initialArtifactId ?? null);
  const [contextState, setContextState] = useState<{
    artifactId: string | null;
    context: TaskCreationContext | null;
    error: string | null;
    isLoading: boolean;
  }>({
    artifactId: null,
    context: null,
    error: null,
    isLoading: false,
  });
  const [createdTask, setCreatedTask] = useState<CreatedTaskPayload | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [formState, setFormState] = useState(() => createTaskFormState());
  const formEditedRef = useRef(false);

  function resetFormState(nextFormState: ReturnType<typeof createTaskFormState> = createTaskFormState()) {
    formEditedRef.current = false;
    setFormState(nextFormState);
  }

  function updateFormState(updater: (current: ReturnType<typeof createTaskFormState>) => ReturnType<typeof createTaskFormState>) {
    formEditedRef.current = true;
    setFormState((current) => updater(current));
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!selectedArtifactId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = await getTaskCreationContextAction(workspaceId, projectId, selectedArtifactId);
      if (cancelled) {
        return;
      }

      if (result.success) {
        setContextState({
          artifactId: selectedArtifactId,
          context: result.data,
          error: null,
          isLoading: false,
        });
        if (shouldApplyTaskCreateContextDraft(formEditedRef.current)) {
          resetFormState(buildTaskCreateFormStateFromContext(result.data));
        }
        return;
      }

      setContextState({
        artifactId: selectedArtifactId,
        context: null,
        error: result.error,
        isLoading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, projectId, selectedArtifactId, workspaceId]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);

    if (nextOpen) {
      setSelectedArtifactId(initialArtifactId ?? null);
      setCreatedTask(null);
      setSubmitError(null);
      setGoalError(null);
      resetFormState();
      setContextState({
        artifactId: initialArtifactId ?? null,
        context: null,
        error: null,
        isLoading: Boolean(initialArtifactId),
      });
      return;
    }

    setContextState({
      artifactId: null,
      context: null,
      error: null,
      isLoading: false,
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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

    setSubmitError(null);
    startSubmitTransition(async () => {
      const result = await createTaskAction({
        workspaceId,
        projectId,
        artifactId: resolveTaskCreateSourceArtifactId(selectedArtifactId, contextState.context),
        title: formState.title,
        goal: formState.goal,
        priority: formState.priority,
        intent: formState.intent,
        intentDetail: formState.intentDetail,
        preferredAgentType: formState.preferredAgentType,
      });

      if (result.success) {
        setCreatedTask(result.data);
        toast.success("任务已创建");
        router.refresh();
        return;
      }

      setSubmitError(result.error);
      toast.error(result.error);
    });
  }

  function handleClearSourceContext() {
    const currentContextState = contextState.context;
    const currentDraft = currentContextState
      ? buildTaskCreateFormStateFromContext(currentContextState)
      : null;

    setSelectedArtifactId(null);
    setContextState({
      artifactId: null,
      context: null,
      error: null,
      isLoading: false,
    });
    updateFormState((current) => ({
      ...current,
      title: currentDraft && current.title === currentDraft.title ? "" : current.title,
      goal: currentDraft && current.goal === currentDraft.goal ? "" : current.goal,
    }));
  }

  const taskDetailHref = createdTask
    ? buildTaskDetailHref(workspaceSlug, projectSlug, createdTask.taskId)
    : null;

  return (
    <>
      <Button className="gap-2" onClick={() => handleOpenChange(true)}>
        <Plus className="h-4 w-4" />
        新建任务
      </Button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>项目级新建任务</SheetTitle>
            <SheetDescription>
              可以直接在项目上下文里定义目标、优先级和执行意图，也可以带上当前选中的来源工件。
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <TaskCreateFormView
              formId="project-task-create-form"
              projectName={projectName}
              context={contextState.context}
              isLoadingContext={contextState.isLoading}
              loadError={contextState.error}
              title={formState.title}
              goal={formState.goal}
              priority={formState.priority}
              intent={formState.intent}
              intentDetail={formState.intentDetail}
              preferredAgentType={formState.preferredAgentType}
              goalError={goalError}
              submitError={submitError}
              createdTask={createdTask}
              onSubmit={handleSubmit}
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
              onClearSourceContext={selectedArtifactId ? handleClearSourceContext : undefined}
            />
          </div>

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
                form="project-task-create-form"
                disabled={isSubmitting || contextState.isLoading}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSubmitting ? "创建中…" : "创建任务"}
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
