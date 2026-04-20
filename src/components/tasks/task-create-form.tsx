"use client";

import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { ArrowRight, Sparkles, Unplug } from "lucide-react";
import { MarkdownRenderer } from "@/components/docs/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { buildDefaultTaskDraft } from "@/lib/tasks/defaults";
import {
  TASK_CREATE_FORM_DEFAULTS,
  TASK_INTENT_DETAIL_MAX_LENGTH,
  TASK_INTENT_LABELS,
  TASK_INTENT_VALUES,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_LABELS,
  TASK_TITLE_MAX_LENGTH,
  TASK_GOAL_MAX_LENGTH,
  TASK_PREFERRED_AGENT_TYPE_LABELS,
  TASK_PREFERRED_AGENT_TYPE_VALUES,
  type CreatedTaskPayload,
  type TaskCreationContext,
  type TaskCreateFieldsInput,
  type TaskIntent,
  type TaskPreferredAgentType,
  type TaskPriority,
  getTaskCreateFieldErrors,
} from "@/lib/tasks/types";

interface TaskCreateFormViewProps {
  formId: string;
  projectName: string;
  context: TaskCreationContext | null;
  isLoadingContext?: boolean;
  loadError?: string | null;
  title: string;
  goal: string;
  priority: TaskPriority;
  intent: TaskIntent;
  intentDetail: string;
  preferredAgentType: TaskPreferredAgentType;
  goalError?: string | null;
  submitError?: string | null;
  createdTask?: CreatedTaskPayload | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onGoalChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onPriorityChange: (value: TaskPriority) => void;
  onIntentChange: (value: TaskIntent) => void;
  onIntentDetailChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onPreferredAgentTypeChange: (value: TaskPreferredAgentType) => void;
  onClearSourceContext?: () => void;
}

export interface TaskCreateFormState {
  title: string;
  goal: string;
  priority: TaskPriority;
  intent: TaskIntent;
  intentDetail: string;
  preferredAgentType: TaskPreferredAgentType;
}

export function TaskCreateFormView({
  formId,
  projectName,
  context,
  isLoadingContext = false,
  loadError = null,
  title,
  goal,
  priority,
  intent,
  intentDetail,
  preferredAgentType,
  goalError = null,
  submitError = null,
  createdTask = null,
  onSubmit,
  onTitleChange,
  onGoalChange,
  onPriorityChange,
  onIntentChange,
  onIntentDetailChange,
  onPreferredAgentTypeChange,
  onClearSourceContext,
}: TaskCreateFormViewProps) {
  return (
    <div className="space-y-4">
      {isLoadingContext ? <TaskCreateContextSkeleton /> : null}

      {!isLoadingContext ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">关联上下文</CardTitle>
            <CardDescription>
              {context
                ? "创建后会保留当前来源工件的 Story / Epic 层级信息。"
                : `当前任务将在项目《${projectName}》上下文下创建。`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {loadError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive">
                {loadError}
              </div>
            ) : null}

            {context ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {context.sourceArtifact.hierarchy.map((item, index) => (
                    <div key={item.id} className="flex items-center gap-2 text-muted-foreground">
                      <Badge variant={index === context.sourceArtifact.hierarchy.length - 1 ? "default" : "outline"}>
                        {item.name}
                      </Badge>
                      {index < context.sourceArtifact.hierarchy.length - 1 ? <ArrowRight className="h-3.5 w-3.5" /> : null}
                    </div>
                  ))}
                </div>

                <p className="leading-6 text-muted-foreground">{context.summary}</p>

                {context.acceptanceCriteria.length > 0 ? (
                  <div className="space-y-2">
                    <div className="font-medium">相关验收标准</div>
                    <ul className="space-y-2 text-muted-foreground">
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
                    <div className="font-medium">关联 Story</div>
                    <div className="flex flex-wrap gap-2">
                      {context.relatedStoryIds.map((storyId) => (
                        <Badge key={storyId} variant="outline">
                          Story {storyId}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {onClearSourceContext ? (
                  <button
                    type="button"
                    onClick={onClearSourceContext}
                    className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Unplug className="h-4 w-4" />
                    改为无来源工件任务
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <div className="rounded-lg border border-dashed p-4 text-muted-foreground">
                  当前任务尚未关联 Story / Epic。系统会在项目边界内创建一个诚实的 `planned` 任务，你可以先填写目标、优先级和执行意图，后续再派发或补充来源上下文。
                </div>
                {onClearSourceContext && loadError ? (
                  <button
                    type="button"
                    onClick={onClearSourceContext}
                    className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Unplug className="h-4 w-4" />
                    忽略当前来源，改为项目上下文任务
                  </button>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!isLoadingContext && context?.detailMarkdown ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">工件详情</CardTitle>
            <CardDescription>创建前可快速确认当前来源内容。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-auto rounded-lg border p-4">
              <MarkdownRenderer content={context.detailMarkdown} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            新建任务
          </CardTitle>
          <CardDescription>
            任务会先以 `planned` 状态创建，保持“状态 + 原因 + 下一步”的真实反馈。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id={formId} className="space-y-4" onSubmit={onSubmit}>
            <Field label="任务标题（可选）">
              <Input
                value={title}
                onChange={onTitleChange}
                maxLength={TASK_TITLE_MAX_LENGTH}
                placeholder="不填时会根据目标自动生成标题"
              />
            </Field>

            <Field label="任务目标">
              <Textarea
                value={goal}
                onChange={onGoalChange}
                rows={4}
                maxLength={TASK_GOAL_MAX_LENGTH}
                placeholder="例如：补齐 Story 4.1 的项目级手动建任务链路"
                aria-invalid={goalError ? "true" : "false"}
              />
              {goalError ? <p className="text-sm text-destructive">{goalError}</p> : null}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="优先级">
                <Select value={priority} onValueChange={(value) => onPriorityChange(value as TaskPriority)}>
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

              <Field label="结构化意图">
                <Select value={intent} onValueChange={(value) => onIntentChange(value as TaskIntent)}>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="偏好 Agent">
                <Select
                  value={preferredAgentType}
                  onValueChange={(value) => onPreferredAgentTypeChange(value as TaskPreferredAgentType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择偏好 Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_PREFERRED_AGENT_TYPE_VALUES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {TASK_PREFERRED_AGENT_TYPE_LABELS[item]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="执行意图补充（可选）">
              <Textarea
                value={intentDetail}
                onChange={onIntentDetailChange}
                rows={3}
                maxLength={TASK_INTENT_DETAIL_MAX_LENGTH}
                placeholder="补充为什么要做、希望 Agent 更关注什么"
              />
            </Field>

            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          </form>
        </CardContent>
      </Card>

      {createdTask ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">任务已创建</CardTitle>
            <CardDescription>
              当前任务已经进入 `planned` 阶段，系统不会在这里假装它已经开始执行。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <FeedbackItem label="当前阶段" value={createdTask.currentStage} />
              <FeedbackItem label="系统正在做什么" value={createdTask.currentActivity} />
              <FeedbackItem label="下一步" value={createdTask.nextStep} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{TASK_STATUS_LABELS[createdTask.status]}</Badge>
              <Badge variant="outline">任务 ID: {createdTask.taskId}</Badge>
              {createdTask.sourceArtifact ? (
                <Badge variant="outline">来源：{createdTask.sourceArtifact.artifactName}</Badge>
              ) : (
                <Badge variant="outline">来源：项目上下文</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function createTaskFormState(
  overrides: Partial<TaskCreateFormState> = {},
): TaskCreateFormState {
  return {
    title: overrides.title ?? TASK_CREATE_FORM_DEFAULTS.title,
    goal: overrides.goal ?? TASK_CREATE_FORM_DEFAULTS.goal,
    priority: overrides.priority ?? TASK_CREATE_FORM_DEFAULTS.priority,
    intent: overrides.intent ?? TASK_CREATE_FORM_DEFAULTS.intent,
    intentDetail: overrides.intentDetail ?? TASK_CREATE_FORM_DEFAULTS.intentDetail,
    preferredAgentType: overrides.preferredAgentType ?? TASK_CREATE_FORM_DEFAULTS.preferredAgentType,
  };
}

export function getGoalFieldError(input: TaskCreateFieldsInput) {
  return getTaskCreateFieldErrors(input).goal?.[0] ?? null;
}

export function buildTaskCreateFormStateFromContext(
  context: TaskCreationContext,
): TaskCreateFormState {
  return createTaskFormState(buildDefaultTaskDraft(context));
}

export function shouldApplyTaskCreateContextDraft(hasUserEditedSinceLoad: boolean): boolean {
  return !hasUserEditedSinceLoad;
}

export function resolveTaskCreateSourceArtifactId(
  selectedArtifactId: string | null | undefined,
  context: TaskCreationContext | null | undefined,
): string | undefined {
  const sourceArtifactId = context?.sourceArtifact.artifactId;
  if (!selectedArtifactId || !sourceArtifactId) {
    return undefined;
  }

  return selectedArtifactId === sourceArtifactId ? sourceArtifactId : undefined;
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

function TaskCreateContextSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}
