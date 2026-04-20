import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TaskCreateFormView,
  buildTaskCreateFormStateFromContext,
  resolveTaskCreateSourceArtifactId,
  shouldApplyTaskCreateContextDraft,
} from "./task-create-form";

const noop = () => {};

describe("TaskCreateFormView", () => {
  it("renders honest no-source project context and inline goal error", () => {
    const markup = renderToStaticMarkup(
      <TaskCreateFormView
        formId="task-create-form"
        projectName="Demo Project"
        context={null}
        title=""
        goal=""
        priority="medium"
        intent="implement"
        intentDetail=""
        preferredAgentType="auto"
        goalError="请输入任务目标。"
        submitError={null}
        createdTask={null}
        onSubmit={noop}
        onTitleChange={noop}
        onGoalChange={noop}
        onPriorityChange={noop}
        onIntentChange={noop}
        onIntentDetailChange={noop}
        onPreferredAgentTypeChange={noop}
      />,
    );

    expect(markup).toContain("当前任务尚未关联 Story / Epic");
    expect(markup).toContain("Demo Project");
    expect(markup).toContain("请输入任务目标。");
    expect(markup).toContain("偏好 Agent");
  });

  it("renders explicit fallback action when source preload fails", () => {
    const markup = renderToStaticMarkup(
      <TaskCreateFormView
        formId="task-create-form"
        projectName="Demo Project"
        context={null}
        loadError="找不到指定的来源工件。"
        title=""
        goal=""
        priority="medium"
        intent="implement"
        intentDetail=""
        preferredAgentType="auto"
        createdTask={null}
        onSubmit={noop}
        onTitleChange={noop}
        onGoalChange={noop}
        onPriorityChange={noop}
        onIntentChange={noop}
        onIntentDetailChange={noop}
        onPreferredAgentTypeChange={noop}
        onClearSourceContext={noop}
      />,
    );

    expect(markup).toContain("找不到指定的来源工件。");
    expect(markup).toContain("忽略当前来源，改为项目上下文任务");
  });

  it("renders source context details and source clearing affordance", () => {
    const markup = renderToStaticMarkup(
      <TaskCreateFormView
        formId="task-create-form"
        projectName="Demo Project"
        context={{
          sourceArtifact: {
            artifactId: "artifact-1",
            artifactType: "STORY",
            artifactName: "任务定义与执行意图提交",
            filePath: "_bmad-output/implementation-artifacts/4-1.md",
            hierarchy: [
              { id: "prd-1", type: "PRD", name: "PRD" },
              { id: "epic-4", type: "EPIC", name: "Epic 4" },
              { id: "artifact-1", type: "STORY", name: "任务定义与执行意图提交" },
            ],
          },
          title: "任务定义与执行意图提交",
          goal: "围绕 Story 4.1 发起执行任务。",
          summary: "当前 Story 需要补齐项目级新建任务链路。",
          detailMarkdown: "# Story 4.1",
          acceptanceCriteria: ["表单持续显示关联 Story / Epic 上下文"],
          relatedStoryIds: ["4.1"],
          suggestedPriority: "high",
          suggestedIntent: "implement",
        }}
        title="发起执行任务"
        goal="推进 Story 4.1 实现"
        priority="high"
        intent="implement"
        intentDetail="优先补齐表单交互。"
        preferredAgentType="codex"
        createdTask={null}
        onSubmit={noop}
        onTitleChange={noop}
        onGoalChange={noop}
        onPriorityChange={noop}
        onIntentChange={noop}
        onIntentDetailChange={noop}
        onPreferredAgentTypeChange={noop}
        onClearSourceContext={noop}
      />,
    );

    expect(markup).toContain("当前 Story 需要补齐项目级新建任务链路。");
    expect(markup).toContain("关联 Story");
    expect(markup).toContain("Story 4.1");
    expect(markup).toContain("改为无来源工件任务");
  });

  it("renders planned feedback card after successful creation", () => {
    const markup = renderToStaticMarkup(
      <TaskCreateFormView
        formId="task-create-form"
        projectName="Demo Project"
        context={null}
        title="项目任务"
        goal="补齐项目级手动新建任务链路"
        priority="medium"
        intent="implement"
        intentDetail=""
        preferredAgentType="auto"
        createdTask={{
          taskId: "task-1",
          status: "planned",
          currentStage: "已计划",
          currentActivity: "任务已计划完成，当前尚未开始编码或启动执行。",
          nextStep: "下一步可进入执行派发阶段。",
          sourceArtifact: null,
        }}
        onSubmit={noop}
        onTitleChange={noop}
        onGoalChange={noop}
        onPriorityChange={noop}
        onIntentChange={noop}
        onIntentDetailChange={noop}
        onPreferredAgentTypeChange={noop}
      />,
    );

    expect(markup).toContain("任务已创建");
    expect(markup).toContain("已计划");
    expect(markup).toContain("来源：项目上下文");
    expect(markup).toContain("任务 ID: task-1");
  });

  it("builds context defaults and only keeps source artifact id when context is active", () => {
    const context = {
      sourceArtifact: {
        artifactId: "artifact-1",
        artifactType: "STORY" as const,
        artifactName: "任务定义与执行意图提交",
        filePath: "_bmad-output/implementation-artifacts/4-1.md",
        hierarchy: [
          { id: "prd-1", type: "PRD" as const, name: "PRD" },
          { id: "epic-4", type: "EPIC" as const, name: "Epic 4" },
          { id: "artifact-1", type: "STORY" as const, name: "任务定义与执行意图提交" },
        ],
      },
      title: "任务定义与执行意图提交",
      goal: "围绕 Story 4.1 发起执行任务。",
      summary: "当前 Story 需要补齐项目级新建任务链路。",
      detailMarkdown: "# Story 4.1",
      acceptanceCriteria: ["表单持续显示关联 Story / Epic 上下文"],
      relatedStoryIds: ["4.1"],
      suggestedPriority: "high" as const,
      suggestedIntent: "implement" as const,
    };

    expect(buildTaskCreateFormStateFromContext(context)).toEqual({
      title: "围绕《任务定义与执行意图提交》发起执行",
      goal: "基于Story《任务定义与执行意图提交》推进实现。",
      priority: "high",
      intent: "implement",
      intentDetail: "",
      preferredAgentType: "auto",
    });
    expect(resolveTaskCreateSourceArtifactId("artifact-1", context)).toBe("artifact-1");
    expect(resolveTaskCreateSourceArtifactId("artifact-stale", context)).toBeUndefined();
    expect(resolveTaskCreateSourceArtifactId("artifact-1", null)).toBeUndefined();
    expect(shouldApplyTaskCreateContextDraft(false)).toBe(true);
    expect(shouldApplyTaskCreateContextDraft(true)).toBe(false);
  });
});
