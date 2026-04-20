import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactTaskHistory } from "./artifact-task-history";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("ArtifactTaskHistory", () => {
  it("shows read-only hint for unsupported artifact types", () => {
    const markup = renderToStaticMarkup(
      <ArtifactTaskHistory
        artifactType="TASK"
        filter="all"
        onFilterChange={() => {}}
        payload={{
          artifact: {
            id: "artifact-task-1",
            type: "TASK",
            name: "Task 2.4.1",
          },
          latestWriteback: null,
          latestWritebackTaskDetailHref: null,
          viewType: "unsupported",
          supportsDirectHistory: false,
          supportsExecutionHistory: false,
          items: [],
          storySummaries: [],
          statusDistribution: {
            completed: 0,
            inProgress: 0,
            dispatched: 0,
            pending: 0,
            failed: 0,
          },
        }}
        isLoading={false}
        error={null}
      />,
    );

    expect(markup).toContain("暂不支持执行历史聚合");
    expect(markup).not.toContain("该 Story 暂未发起执行");
  });

  it("shows loading state while execution history is being fetched", () => {
    const markup = renderToStaticMarkup(
      <ArtifactTaskHistory
        artifactType="STORY"
        filter="all"
        onFilterChange={() => {}}
        payload={null}
        isLoading
        error={null}
      />,
    );

    expect(markup).toContain('aria-label="执行历史加载中"');
    expect(markup).not.toContain("暂不支持执行历史聚合");
  });

  it("renders Story history cards with inline task details, artifact list and task links", () => {
    const markup = renderToStaticMarkup(
      <ArtifactTaskHistory
        artifactType="STORY"
        filter="all"
        onFilterChange={() => {}}
        payload={{
          artifact: {
            id: "artifact-story-1",
            type: "STORY",
            name: "Story 2.4",
          },
          latestWriteback: {
            id: "writeback-1",
            taskId: "task-1",
            artifactId: "artifact-story-1",
            outcome: "completed",
            writebackStatus: "succeeded",
            summary: "已把关键结果回写到来源工件",
            errorSummary: null,
            occurredAt: "2026-04-10T02:35:00.000Z",
            recoveryHint: "可继续进入评审或查看最新工件结果。",
            artifacts: [
              {
                type: "代码变更",
                filePath: "src/actions/task-actions.ts",
                generatedAt: "2026-04-10T02:30:00.000Z",
                summary: "补齐 action 历史读取",
              },
            ],
          },
          latestWritebackTaskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/task-1",
          viewType: "story",
          supportsDirectHistory: true,
          supportsExecutionHistory: true,
          items: [
            {
              taskId: "task-1",
              title: "补齐执行历史视图",
              status: "review",
              executionStartedAt: "2026-04-10T02:00:00.000Z",
              currentStage: "等待评审",
              currentActivity: "正在整理交付总结",
              agentTypeLabel: "实现 Agent",
              artifactSummary: "已记录 1 个产物 · src/actions/task-actions.ts",
              resultSummary: "已补齐任务历史聚合",
              sourceArtifactName: "Story 2.4",
              taskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/task-1",
              agentRuns: [],
              artifacts: [
                {
                  type: "代码变更",
                  filePath: "src/actions/task-actions.ts",
                  generatedAt: "2026-04-10T02:30:00.000Z",
                  summary: "补齐 action 历史读取",
                },
              ],
              writeback: {
                id: "writeback-1",
                taskId: "task-1",
                artifactId: "artifact-story-1",
                outcome: "completed",
                writebackStatus: "succeeded",
                summary: "已把关键结果回写到来源工件",
                errorSummary: null,
                occurredAt: "2026-04-10T02:35:00.000Z",
                recoveryHint: "可继续进入评审或查看最新工件结果。",
                artifacts: [
                  {
                    type: "代码变更",
                    filePath: "src/actions/task-actions.ts",
                    generatedAt: "2026-04-10T02:30:00.000Z",
                    summary: "补齐 action 历史读取",
                  },
                ],
              },
              writebackStatusLabel: "回写成功",
              writebackOutcomeLabel: "已完成",
              writebackOccurredAt: "2026-04-10T02:35:00.000Z",
              writebackErrorSummary: null,
              writebackRecoveryHint: "可继续进入评审或查看最新工件结果。",
              hasWritebackConflict: false,
            },
          ],
          storySummaries: [],
          statusDistribution: {
            completed: 0,
            inProgress: 0,
            dispatched: 0,
            pending: 0,
            failed: 0,
          },
        }}
        isLoading={false}
        error={null}
      />,
    );

    expect(markup).toContain("补齐执行历史视图");
    expect(markup).toContain("最新回写已完成");
    expect(markup).toContain("已把关键结果回写到来源工件");
    expect(markup).toContain("执行时间");
    expect(markup).toContain("暂无 Agent Run 记录");
    expect(markup).toContain("src/actions/task-actions.ts");
    expect(markup).toContain("查看产物详情");
    expect(markup).toContain("/workspace/demo-workspace/project/demo-project/tasks/task-1");
  });

  it("renders rerouted run history with current markers and termination details", () => {
    const markup = renderToStaticMarkup(
      <ArtifactTaskHistory
        artifactType="STORY"
        filter="all"
        onFilterChange={() => {}}
        payload={{
          artifact: {
            id: "artifact-story-2",
            type: "STORY",
            name: "Story 4.3",
          },
          latestWriteback: null,
          latestWritebackTaskDetailHref: null,
          viewType: "story",
          supportsDirectHistory: true,
          supportsExecutionHistory: true,
          items: [
            {
              taskId: "task-redispatch-1",
              title: "调整执行路由",
              status: "dispatched",
              executionStartedAt: "2026-04-14T02:00:00.000Z",
              currentStage: "已重新派发",
              currentActivity: "已重新派发，等待新会话启动。",
              agentTypeLabel: "Claude Code",
              artifactSummary: "暂无关键产物",
              resultSummary: "旧 Run 已终止，新 Run 已派发",
              sourceArtifactName: "Story 4.3",
              taskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/task-redispatch-1",
              agentRuns: [
                {
                  id: "run-current",
                  agentType: "claude-code",
                  agentTypeLabel: "Claude Code",
                  status: "dispatched",
                  statusLabel: "已派发",
                  createdAt: "2026-04-14T02:10:00.000Z",
                  startedAt: null,
                  completedAt: null,
                  terminatedAt: null,
                  supersededAt: null,
                  selectionReasonSummary: "当前任务更适合先做分析与方案整理。",
                  decisionSource: "manual-reroute",
                  replacesRunId: "run-previous",
                  replacementRunId: null,
                  terminationReasonSummary: null,
                  isCurrent: true,
                  summary: "已重新派发，等待新会话启动。",
                },
                {
                  id: "run-previous",
                  agentType: "codex",
                  agentTypeLabel: "Codex",
                  status: "superseded",
                  statusLabel: "已替代",
                  createdAt: "2026-04-14T01:30:00.000Z",
                  startedAt: "2026-04-14T01:35:00.000Z",
                  completedAt: null,
                  terminatedAt: "2026-04-14T02:08:00.000Z",
                  supersededAt: "2026-04-14T02:08:00.000Z",
                  selectionReasonSummary: "初次派发到 Codex。",
                  decisionSource: "intent-heuristic",
                  replacesRunId: null,
                  replacementRunId: "run-current",
                  terminationReasonSummary: "当前任务更适合改派到 Claude Code。",
                  isCurrent: false,
                  summary: "旧会话已终止。",
                },
              ],
              artifacts: [],
              writeback: null,
              writebackStatusLabel: null,
              writebackOutcomeLabel: null,
              writebackOccurredAt: null,
              writebackErrorSummary: null,
              writebackRecoveryHint: null,
              hasWritebackConflict: false,
            },
          ],
          storySummaries: [],
          statusDistribution: {
            completed: 0,
            inProgress: 1,
            dispatched: 0,
            pending: 0,
            failed: 0,
          },
        }}
        isLoading={false}
        error={null}
      />,
    );

    expect(markup).toContain("当前 Run");
    expect(markup).toContain("历史 Run");
    expect(markup).toContain("run-current");
    expect(markup).toContain("run-previous");
    expect(markup).toContain("替代自 Run");
    expect(markup).toContain("终止说明");
    expect(markup).toContain("当前任务更适合改派到 Claude Code。");
  });

  it("renders Epic aggregate distribution and Story summaries", () => {
    const markup = renderToStaticMarkup(
      <ArtifactTaskHistory
        artifactType="EPIC"
        filter="all"
        onFilterChange={() => {}}
        payload={{
          artifact: {
            id: "artifact-epic-1",
            type: "EPIC",
            name: "Epic 2",
          },
          latestWriteback: {
            id: "writeback-epic-1",
            taskId: "task-1",
            artifactId: "story-1",
            outcome: "completed",
            writebackStatus: "succeeded",
            summary: "Story 2.3 已完成回写",
            errorSummary: null,
            occurredAt: "2026-04-10T02:40:00.000Z",
            recoveryHint: "可继续进入评审或查看最新工件结果。",
            artifacts: [],
          },
          latestWritebackTaskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/task-1",
          viewType: "epic",
          supportsDirectHistory: false,
          supportsExecutionHistory: true,
          items: [],
          storySummaries: [
            {
              storyArtifactId: "story-1",
              storyName: "Story 2.3",
              aggregateStatus: "completed",
              latestActivity: "等待人工确认",
              taskCount: 1,
              latestTaskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/task-1",
              items: [
                {
                  taskId: "task-1",
                  title: "补齐 Story 历史",
                  status: "review",
                  executionStartedAt: null,
                  currentStage: "等待评审",
                  currentActivity: "等待人工确认",
                  agentTypeLabel: "实现 Agent",
                  artifactSummary: "暂无关键产物",
                  resultSummary: "已补齐 Story 历史",
                  sourceArtifactName: "Story 2.3",
                  taskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/task-1",
                  agentRuns: [],
                  artifacts: [],
                  writeback: {
                    id: "writeback-epic-1",
                    taskId: "task-1",
                    artifactId: "story-1",
                    outcome: "completed",
                    writebackStatus: "succeeded",
                    summary: "Story 2.3 已完成回写",
                    errorSummary: null,
                    occurredAt: "2026-04-10T02:40:00.000Z",
                    recoveryHint: "可继续进入评审或查看最新工件结果。",
                    artifacts: [],
                  },
                  writebackStatusLabel: "回写成功",
                  writebackOutcomeLabel: "已完成",
                  writebackOccurredAt: "2026-04-10T02:40:00.000Z",
                  writebackErrorSummary: null,
                  writebackRecoveryHint: "可继续进入评审或查看最新工件结果。",
                  hasWritebackConflict: false,
                },
              ],
            },
            {
              storyArtifactId: "story-2",
              storyName: "Story 2.4",
              aggregateStatus: "dispatched",
              latestActivity: "正在整理 Epic 聚合卡片",
              taskCount: 1,
              latestTaskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/task-2",
              items: [],
            },
          ],
          statusDistribution: {
            completed: 1,
            inProgress: 0,
            dispatched: 1,
            pending: 0,
            failed: 0,
          },
        }}
        isLoading={false}
        error={null}
      />,
    );

    expect(markup).toContain("已完成");
    expect(markup).toContain("已派发");
    expect(markup).toContain("Story 2.3 已完成回写");
    expect(markup).toContain("Story 2.3");
    expect(markup).toContain("Story 2.4");
    expect(markup).toContain("最近任务详情");
  });

  it("shows actionable empty state for Story history", () => {
    const markup = renderToStaticMarkup(
      <ArtifactTaskHistory
        artifactType="STORY"
        filter="all"
        onFilterChange={() => {}}
        payload={{
          artifact: {
            id: "artifact-story-1",
            type: "STORY",
            name: "Story 2.4",
          },
          latestWriteback: null,
          latestWritebackTaskDetailHref: null,
          viewType: "story",
          supportsDirectHistory: true,
          supportsExecutionHistory: true,
          items: [],
          storySummaries: [],
          statusDistribution: {
            completed: 0,
            inProgress: 0,
            dispatched: 0,
            pending: 0,
            failed: 0,
          },
        }}
        isLoading={false}
        error={null}
      />,
    );

    expect(markup).toContain("该 Story 暂未发起执行");
    expect(markup).toContain("概览");
  });
});
