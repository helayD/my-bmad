import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskSourceHierarchyItem, TaskWritebackView } from "@/lib/tasks";
import { TaskDetailView } from "./task-detail-view";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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
    id: "task-1",
    title: "实现 Story 2.5 终态回写",
    goal: "补齐任务终态回写链路。",
    summary: "回写成功后需要在任务详情展示状态。",
    priority: "high",
    intent: "implement",
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

    expect(markup).toContain("该任务当前没有关联来源工件。");
    expect(markup).not.toContain("返回来源工件视图");
  });
});
