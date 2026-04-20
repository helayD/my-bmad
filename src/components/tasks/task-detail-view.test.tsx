import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskSourceHierarchyItem, TaskWritebackView } from "@/lib/tasks";
import type { ExecutionQueueSnapshot } from "@/lib/tasks";
import { TaskDetailView } from "./task-detail-view";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("./task-redispatch-card", () => ({
  TaskRedispatchCard: () => <div>执行路由卡片</div>,
}));

vi.mock("./task-dispatch-card", () => ({
  TaskDispatchCard: () => <div>首次派发卡片</div>,
}));

type TaskDetailTask = Parameters<typeof TaskDetailView>[0]["task"];

function createWriteback(overrides: Partial<TaskWritebackView> = {}): TaskWritebackView {
  return {
    id: "writeback-1",
    taskId: "task-1",
    artifactId: "artifact-1",
    outcome: "completed",
    writebackStatus: "succeeded",
    summary: "已完成回写并同步来源工件",
    errorSummary: null,
    occurredAt: "2026-04-10T10:00:00.000Z",
    recoveryHint: "可继续进入评审或查看最新工件结果。",
    artifacts: [
      {
        type: "代码变更",
        filePath: "src/actions/task-actions.ts",
        generatedAt: "2026-04-10T09:30:00.000Z",
        summary: "补齐终态回写 action",
      },
    ],
    ...overrides,
  };
}

function createTask(overrides: Partial<TaskDetailTask> = {}): TaskDetailTask {
  return {
    workspaceId: "cworkspaceid0000000000001",
    projectId: "cprojectid0000000000000001",
    id: "task-1",
    title: "实现 Story 2.5 终态回写",
    goal: "补齐任务终态回写链路。",
    summary: "回写成功后需要在任务详情展示状态。",
    priority: "high",
    intent: "implement",
    intentDetail: null,
    preferredAgentType: null,
    status: "done",
    currentStage: "执行完成",
    nextStep: "进入评审",
    createdAt: new Date("2026-04-10T08:00:00.000Z"),
    metadata: {
      currentActivity: "正在整理交付说明",
    },
    project: { slug: "demo-project", name: "Demo Project" },
    workspace: { slug: "demo-workspace", name: "Demo Workspace" },
    sourceArtifact: {
      id: "artifact-1",
      name: "Story 2.5",
      type: "STORY",
      filePath: "_bmad-output/implementation-artifacts/2-5.md",
    },
    plannedDispatchState: null,
    workspaceRoutingPreference: "auto",
    dispatchPreviewAgentType: null,
    dispatchPreviewAgentLabel: null,
    dispatchPreviewReason: null,
    currentSession: null,
    agentRuns: [],
    routingReason: null,
    latestWriteback: createWriteback(),
    ...overrides,
  };
}

const baseHierarchy: TaskSourceHierarchyItem[] = [
  { id: "prd-1", type: "PRD", name: "PRD" },
  { id: "epic-2", type: "EPIC", name: "Epic 2" },
  { id: "artifact-1", type: "STORY", name: "Story 2.5" },
];

describe("TaskDetailView", () => {
  it("renders success writeback summary and source trace", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createTask()}
        sourceHierarchy={baseHierarchy}
      />,
    );

    expect(markup).toContain("回写状态");
    expect(markup).toContain("回写成功");
    expect(markup).toContain("回写摘要");
    expect(markup).toContain("已完成回写并同步来源工件");
    expect(markup).toContain("层级路径");
    expect(markup).toContain("返回来源工件视图");
    expect(markup).toContain("/workspace/demo-workspace/project/demo-project?artifactId=artifact-1#artifact-tree");
  });

  it("shows terminal conflict warning when task is done but has no writeback", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createTask({
          status: "done",
          latestWriteback: null,
        })}
        sourceHierarchy={baseHierarchy}
      />,
    );

    expect(markup).toContain("任务已结束，但结果尚未成功回写到来源工件。请先处理回写异常，再继续依赖该工件的最新执行状态。");
    expect(markup).not.toContain("当前任务还没有回写记录");
  });

  it("shows non-terminal empty state when no writeback exists", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createTask({
          status: "in-progress",
          latestWriteback: null,
        })}
        sourceHierarchy={baseHierarchy}
      />,
    );

    expect(markup).toContain("当前任务还没有回写记录。通常会在任务进入已完成、失败或中断等终态后生成。");
  });

  it("shows failed writeback details and actionable badge for blocked task", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createTask({
          status: "blocked",
          latestWriteback: createWriteback({
            writebackStatus: "failed",
            outcome: "failed",
            summary: "执行失败：仓库冲突未解决",
            errorSummary: "仓库冲突未解决",
            recoveryHint: "请先解决冲突后重试。",
          }),
        })}
        sourceHierarchy={baseHierarchy}
      />,
    );

    expect(markup).toContain("回写失败");
    expect(markup).toContain("执行失败");
    expect(markup).toContain("待处理");
    expect(markup).toContain("失败原因");
    expect(markup).toContain("仓库冲突未解决");
  });

  it("shows no-source fallback text when task has no source artifact", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createTask({
          sourceArtifact: null,
        })}
        sourceHierarchy={[]}
      />,
    );

    expect(markup).toContain("项目上下文手动创建");
    expect(markup).toContain("该任务当前没有关联 Story / Epic 或其他来源工件");
    expect(markup).not.toContain("返回来源工件视图");
  });

  it("keeps legacy pending status readable without exposing old-tag copy", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createTask({
          status: "pending",
          latestWriteback: null,
        })}
        sourceHierarchy={baseHierarchy}
      />,
    );

    expect(markup).toContain("待处理");
    expect(markup).not.toContain("待处理（旧）");
  });

  it("shows planned status plus intent detail and preferred agent fields", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createTask({
          status: "planned",
          plannedDispatchState: "ready",
          summary: "该任务由用户在项目上下文中手动创建，当前尚未关联来源工件。",
          intentDetail: "优先补齐项目级新建任务与工件来源衔接。",
          preferredAgentType: "codex",
          latestWriteback: null,
        })}
        sourceHierarchy={baseHierarchy}
      />,
    );

    expect(markup).toContain("已计划");
    expect(markup).toContain("执行意图补充");
    expect(markup).toContain("优先补齐项目级新建任务与工件来源衔接。");
    expect(markup).toContain("偏好 Agent");
    expect(markup).toContain("优先 Codex");
    expect(markup).toContain("首次派发卡片");
    expect(markup).not.toContain("执行路由卡片");
  });
});

describe("TaskDetailView: concurrency queue card (§4.5)", () => {
  function createQueuedTask(overrides: Partial<Parameters<typeof TaskDetailView>[0]["task"]> = {}) {
    return createTask({
      status: "dispatched",
      latestWriteback: null,
      currentSession: null,
      metadata: {},
      ...overrides,
    });
  }

  const queueSnapshot: ExecutionQueueSnapshot = {
    queuePosition: 2,
    queuedAt: "2026-04-20T10:05:00.000Z",
    workspaceActiveConcurrentTasks: 5,
    projectActiveConcurrentTasks: 3,
    maxConcurrentTasks: 5,
    estimatedWaitSeconds: 180,
    estimatedWaitLabel: "预计等待约 3 分钟。",
    queueReasonCode: "WORKSPACE_CAPACITY_FULL",
    queueReasonSummary: "工作空间并发上限已满。",
  };

  it("shows queue card when task has queue snapshot", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createQueuedTask({ queueSnapshot })}
        sourceHierarchy={[]}
      />,
    );

    expect(markup).toContain("执行队列状态");
    expect(markup).toContain("等待顺位：2");
    expect(markup).toContain("工作空间并发");
    expect(markup).toContain("预计等待约 3 分钟。");
  });

  it("does not render queue card when no queue snapshot", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createQueuedTask({ queueSnapshot: undefined })}
        sourceHierarchy={[]}
      />,
    );

    expect(markup).not.toContain("执行队列状态");
  });

  it("renders without queue props when they are not needed", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        task={createTask({ status: "done" })}
        sourceHierarchy={[]}
      />,
    );
    expect(markup).toContain("任务详情");
    expect(markup).not.toContain("执行队列状态");
  });
});
