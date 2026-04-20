import { describe, expect, it } from "vitest";
import {
  TASK_ACTIVITY_FALLBACK,
  TASK_AGENT_TYPE_FALLBACK,
  TASK_ARTIFACT_SUMMARY_FALLBACK,
  TASK_RESULT_SUMMARY_FALLBACK,
  TASK_SOURCE_NAME_FALLBACK,
  TASK_SOURCE_PATH_FALLBACK,
  buildArtifactTaskHistoryEntries,
  buildArtifactTaskHistoryPayload,
  buildSourceArtifactHref,
  buildTaskDetailHref,
  buildTaskSourceContextSnapshot,
  buildTaskSourcePathText,
  resolveTaskAgentRuns,
  resolveTaskSourceArtifact,
  resolveTaskSourceHierarchy,
} from "@/lib/tasks/tracking";

describe("task tracking helpers", () => {
  it("prefers source relation hierarchy when present", () => {
    const hierarchy = resolveTaskSourceHierarchy({
      sourceArtifact: {
        id: "story-1",
        type: "STORY",
        name: "Story 2.3",
        parent: {
          id: "epic-2",
          type: "EPIC",
          name: "Epic 2",
          parent: {
            id: "prd-1",
            type: "PRD",
            name: "PRD",
          },
        },
      },
      metadata: {
        sourceContext: {
          hierarchy: [{ id: "stale-1", type: "STORY", name: "旧 Story" }],
        },
      },
    });

    expect(hierarchy.map((item) => item.name)).toEqual(["PRD", "Epic 2", "Story 2.3"]);
    expect(buildTaskSourcePathText(hierarchy)).toBe("PRD > Epic 2 > Story 2.3");
  });

  it("falls back to metadata hierarchy when relation chain is missing", () => {
    const hierarchy = resolveTaskSourceHierarchy({
      sourceArtifact: null,
      metadata: {
        sourceContext: {
          hierarchy: [
            { id: "prd-1", type: "PRD", name: "产品需求文档" },
            { id: "epic-2", type: "EPIC", name: "执行入口" },
            { id: "story-23", type: "STORY", name: "执行任务与来源工件的追踪映射" },
          ],
        },
      },
    });

    expect(hierarchy.map((item) => item.type)).toEqual(["PRD", "EPIC", "STORY"]);
    expect(hierarchy.at(-1)?.name).toBe("执行任务与来源工件的追踪映射");
  });

  it("returns stable no-source fallback copy for manual project tasks", () => {
    const sourceArtifact = resolveTaskSourceArtifact({
      sourceArtifact: null,
      metadata: {},
    });

    expect(sourceArtifact.name).toBe(TASK_SOURCE_NAME_FALLBACK);
    expect(sourceArtifact.filePath).toBe(TASK_SOURCE_PATH_FALLBACK);
  });

  it("builds Story history entries with truthful execution time and artifact details", () => {
    const entries = buildArtifactTaskHistoryEntries(
      [
        {
          id: "task-new",
          sourceArtifactId: "story-1",
          title: "补齐执行历史",
          status: "done",
          currentStage: "已完成",
          nextStep: "无需后续步骤",
          createdAt: new Date("2026-04-02T08:00:00.000Z"),
          metadata: {
            currentActivity: "正在整理交付总结",
            agentTypeLabel: "实现 Agent",
            executionResultSummary: "已完成任务详情追踪视图",
            executionStartedAt: "2026-04-02T08:30:00.000Z",
            agentRuns: [
              {
                id: "run-1",
                agentType: "实现 Agent",
                status: "done",
                startedAt: "2026-04-02T08:30:00.000Z",
                completedAt: "2026-04-02T09:00:00.000Z",
                summary: "执行完成",
              },
            ],
            artifacts: [
              {
                type: "代码变更",
                filePath: "src/actions/task-actions.ts",
                generatedAt: "2026-04-02T08:45:00.000Z",
                summary: "补齐 action 历史读取",
              },
            ],
          },
          sourceArtifact: { id: "story-1", type: "STORY", name: "Story 2.3" },
        },
        {
          id: "task-old",
          sourceArtifactId: "story-1",
          title: "旧任务",
          status: "pending",
          currentStage: "待处理",
          nextStep: "稍后执行",
          createdAt: new Date("2026-04-01T08:00:00.000Z"),
          metadata: {},
          sourceArtifact: null,
        },
      ],
      {
        workspaceSlug: "demo-workspace",
        projectSlug: "demo-project",
      },
    );

    expect(entries.map((item) => item.taskId)).toEqual(["task-new", "task-old"]);
    expect(entries[0]).toMatchObject({
      currentActivity: "正在整理交付总结",
      agentTypeLabel: "实现 Agent",
      resultSummary: "已完成任务详情追踪视图",
      artifactSummary: expect.stringContaining("src/actions/task-actions.ts"),
      sourceArtifactName: "Story 2.3",
      taskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/task-new",
      executionStartedAt: "2026-04-02T08:30:00.000Z",
    });
    expect(entries[0].agentRuns).toHaveLength(1);
    expect(entries[0].artifacts).toMatchObject([
      {
        type: "代码变更",
        filePath: "src/actions/task-actions.ts",
        generatedAt: "2026-04-02T08:45:00.000Z",
        summary: "补齐 action 历史读取",
      },
    ]);
  });

  it("orders tasks by the most recent activity timestamp", () => {
    const history = buildArtifactTaskHistoryEntries(
      [
        {
          id: "task-older",
          sourceArtifactId: "story-activity",
          title: "旧任务",
          status: "done",
          currentStage: "已完成",
          nextStep: "无需",
          createdAt: new Date("2026-04-10T01:00:00.000Z"),
          metadata: {
            executionStartedAt: "2026-04-10T02:00:00.000Z",
            agentRuns: [
              {
                id: "run-older",
                agentType: "实现 Agent",
                status: "done",
                startedAt: "2026-04-10T02:00:00.000Z",
                completedAt: "2026-04-10T02:30:00.000Z",
                summary: "早鸟执行",
              },
            ],
            artifacts: [
              {
                type: "文档",
                filePath: "docs/activity.md",
                generatedAt: "2026-04-10T05:00:00.000Z",
                summary: "最新产出",
              },
            ],
          },
          sourceArtifact: { id: "story-activity", type: "STORY", name: "Story Activity Case" },
        },
        {
          id: "task-newer",
          sourceArtifactId: "story-activity",
          title: "新任务",
          status: "done",
          currentStage: "已完成",
          nextStep: "无需",
          createdAt: new Date("2026-04-10T03:00:00.000Z"),
          metadata: {
            executionStartedAt: "2026-04-10T04:00:00.000Z",
            agentRuns: [
              {
                id: "run-newer",
                agentType: "执行 Agent",
                status: "done",
                startedAt: "2026-04-10T04:00:00.000Z",
                completedAt: "2026-04-10T04:30:00.000Z",
                summary: "较晚执行",
              },
            ],
          },
          sourceArtifact: { id: "story-activity", type: "STORY", name: "Story Activity Case" },
        },
      ],
      { workspaceSlug: "demo-workspace", projectSlug: "demo-project" },
    );

    expect(history.map((item) => item.taskId)).toEqual(["task-older", "task-newer"]);
  });

  it("prefers relation-first agent runs and keeps reroute chain truthfully ordered", () => {
    const agentRuns = resolveTaskAgentRuns(
      {
        agentRuns: [
          {
            id: "legacy-run",
            agentType: "Codex",
            status: "done",
            summary: "旧 metadata 记录",
          },
        ],
      },
      [
        {
          id: "run-previous",
          agentType: "codex",
          status: "superseded",
          decisionSource: "intent-heuristic",
          selectionReasonCode: "heuristic-codex",
          selectionReasonSummary: "初次派发到 Codex。",
          matchedSignals: ["codex:intent-implement"],
          requestedByUserId: "user-1",
          createdAt: new Date("2026-04-14T01:20:00.000Z"),
          startedAt: new Date("2026-04-14T01:25:00.000Z"),
          completedAt: null,
          terminatedAt: new Date("2026-04-14T02:08:00.000Z"),
          supersededAt: new Date("2026-04-14T02:08:00.000Z"),
          terminationReasonCode: "manual-reroute",
          terminationReasonSummary: "当前任务更适合方案分析。",
          replacesRunId: null,
          replacementRun: { id: "run-current" },
          metadata: {
            currentActivity: "旧会话已终止。",
          },
        },
        {
          id: "run-current",
          agentType: "claude-code",
          status: "dispatched",
          decisionSource: "manual-reroute",
          selectionReasonCode: "manual-reroute",
          selectionReasonSummary: "已改派到 Claude Code。",
          matchedSignals: ["explicit:claude-code"],
          requestedByUserId: "user-1",
          createdAt: new Date("2026-04-14T02:10:00.000Z"),
          startedAt: null,
          completedAt: null,
          terminatedAt: null,
          supersededAt: null,
          terminationReasonCode: null,
          terminationReasonSummary: null,
          replacesRunId: "run-previous",
          replacementRun: null,
          metadata: {
            currentActivity: "已重新派发，等待新会话启动。",
          },
        },
      ],
      "run-current",
    );

    expect(agentRuns.map((run) => run.id)).toEqual(["run-current", "run-previous"]);
    expect(agentRuns[0]).toMatchObject({
      isCurrent: true,
      agentType: "claude-code",
      agentTypeLabel: "Claude Code",
      statusLabel: "已派发",
      replacesRunId: "run-previous",
      summary: "已重新派发，等待新会话启动。",
    });
    expect(agentRuns[1]).toMatchObject({
      isCurrent: false,
      agentType: "codex",
      statusLabel: "已替代",
      replacementRunId: "run-current",
      terminationReasonSummary: "当前任务更适合方案分析。",
    });
  });

  it("uses stable Chinese fallbacks when no run or artifact data exist", () => {
    const [entry] = buildArtifactTaskHistoryEntries(
      [
        {
          id: "task-2",
          sourceArtifactId: "story-1",
          title: "任务 2",
          status: "blocked",
          currentStage: "",
          nextStep: "",
          createdAt: new Date("2026-04-04T08:00:00.000Z"),
          metadata: {},
          sourceArtifact: null,
        },
      ],
      {
        workspaceSlug: "demo-workspace",
        projectSlug: "demo-project",
      },
    );

    expect(entry.currentActivity).toBe(TASK_ACTIVITY_FALLBACK);
    expect(entry.agentTypeLabel).toBe(TASK_AGENT_TYPE_FALLBACK);
    expect(entry.resultSummary).toBe(TASK_RESULT_SUMMARY_FALLBACK);
    expect(entry.artifactSummary).toBe(TASK_ARTIFACT_SUMMARY_FALLBACK);
    expect(entry.executionStartedAt).toBeNull();
    expect(entry.agentRuns).toEqual([]);
    expect(entry.artifacts).toEqual([]);
  });

  it("projects latest writeback into task history entries", () => {
    const [entry] = buildArtifactTaskHistoryEntries(
      [
        {
          id: "task-writeback-1",
          sourceArtifactId: "story-25",
          title: "完成回写",
          status: "done",
          currentStage: "执行完成",
          nextStep: "查看来源工件",
          createdAt: new Date("2026-04-10T08:00:00.000Z"),
          metadata: {
            resultSummary: "任务本地摘要",
          },
          writebacks: [
            {
              id: "writeback-1",
              taskId: "task-writeback-1",
              artifactId: "story-25",
              outcome: "completed",
              writebackStatus: "succeeded",
              summary: "已把关键结果回写到来源工件",
              errorSummary: null,
              occurredAt: new Date("2026-04-10T09:00:00.000Z"),
              payload: {
                recoveryHint: "可继续进入评审或查看最新工件结果。",
                artifacts: [
                  {
                    type: "代码变更",
                    filePath: "src/lib/execution/writeback.ts",
                    generatedAt: "2026-04-10T09:00:00.000Z",
                    summary: "新增统一回写管道",
                  },
                ],
              },
            },
          ],
          sourceArtifact: { id: "story-25", type: "STORY", name: "Story 2.5" },
        },
      ],
      { workspaceSlug: "demo-workspace", projectSlug: "demo-project" },
    );

    expect(entry.resultSummary).toBe("已把关键结果回写到来源工件");
    expect(entry.writebackStatusLabel).toBe("回写成功");
    expect(entry.writebackOutcomeLabel).toBe("已完成");
    expect(entry.hasWritebackConflict).toBe(false);
    expect(entry.writeback?.artifacts[0]).toMatchObject({
      filePath: "src/lib/execution/writeback.ts",
    });
  });

  it("marks terminal tasks without successful writeback as conflict", () => {
    const [entry] = buildArtifactTaskHistoryEntries(
      [
        {
          id: "task-writeback-2",
          sourceArtifactId: "story-25",
          title: "回写失败",
          status: "blocked",
          currentStage: "执行已结束",
          nextStep: "处理回写异常",
          createdAt: new Date("2026-04-10T08:00:00.000Z"),
          metadata: {
            terminalReason: "数据库事务冲突",
          },
          writebacks: [
            {
              id: "writeback-2",
              taskId: "task-writeback-2",
              artifactId: "story-25",
              outcome: "failed",
              writebackStatus: "failed",
              summary: "执行失败：数据库事务冲突",
              errorSummary: "执行结果回写失败，请稍后重试。",
              occurredAt: new Date("2026-04-10T09:30:00.000Z"),
              payload: {
                recoveryHint: "请检查失败原因并修复后重试。",
                artifacts: [],
              },
            },
          ],
          sourceArtifact: { id: "story-25", type: "STORY", name: "Story 2.5" },
        },
      ],
      { workspaceSlug: "demo-workspace", projectSlug: "demo-project" },
    );

    expect(entry.hasWritebackConflict).toBe(true);
    expect(entry.writebackStatusLabel).toBe("回写失败");
    expect(entry.writebackErrorSummary).toBe("执行结果回写失败，请稍后重试。");
    expect(entry.writebackRecoveryHint).toBe("请检查失败原因并修复后重试。");
  });

  it("builds Epic aggregate payload with descendant-story fallback and status distribution", () => {
    const payload = buildArtifactTaskHistoryPayload({
      artifact: {
        id: "epic-2",
        type: "EPIC",
        name: "Epic 2",
        filePath: "_bmad-output/planning-artifacts/epics.md#epic-2",
        parentId: "prd-1",
        metadata: { epicId: "2" },
      },
      allArtifacts: [
        {
          id: "epic-2",
          type: "EPIC",
          name: "Epic 2",
          filePath: "_bmad-output/planning-artifacts/epics.md#epic-2",
          parentId: "prd-1",
          metadata: { epicId: "2" },
        },
        {
          id: "story-review",
          type: "STORY",
          name: "Story Review",
          filePath: "_bmad-output/implementation-artifacts/2-3.md",
          parentId: "epic-2",
          metadata: { epicId: "2", storyId: "2.3" },
        },
        {
          id: "story-active",
          type: "STORY",
          name: "Story Active",
          filePath: "_bmad-output/implementation-artifacts/2-4.md",
          parentId: null,
          metadata: { epicId: "2", storyId: "2.4" },
        },
        {
          id: "story-pending",
          type: "STORY",
          name: "Story Pending",
          filePath: "_bmad-output/implementation-artifacts/2-5.md",
          parentId: "epic-2",
          metadata: { epicId: "2", storyId: "2.5" },
        },
        {
          id: "story-blocked",
          type: "STORY",
          name: "Story Blocked",
          filePath: "_bmad-output/implementation-artifacts/2-6.md",
          parentId: "epic-2",
          metadata: { epicId: "2", storyId: "2.6" },
        },
      ],
      tasks: [
        {
          id: "task-review",
          sourceArtifactId: "story-review",
          title: "补齐 Story 历史",
          status: "review",
          currentStage: "等待评审",
          nextStep: "等待人工确认",
          createdAt: new Date("2026-04-10T01:00:00.000Z"),
          metadata: {
            executionStartedAt: "2026-04-10T01:10:00.000Z",
          },
          sourceArtifact: {
            id: "story-review",
            type: "STORY",
            name: "Story Review",
            parent: null,
          },
        },
        {
          id: "task-active",
          sourceArtifactId: "story-active",
          title: "搭建 Epic 聚合视图",
          status: "dispatched",
          currentStage: "已派发",
          nextStep: "等待执行监督器创建会话并启动。",
          createdAt: new Date("2026-04-10T02:00:00.000Z"),
          metadata: {
            currentActivity: "已完成 Agent 路由，等待执行监督器创建会话并启动。",
          },
          sourceArtifact: {
            id: "story-active",
            type: "STORY",
            name: "Story Active",
            parent: null,
          },
        },
        {
          id: "task-blocked",
          sourceArtifactId: "story-blocked",
          title: "等待执行域接入",
          status: "blocked",
          currentStage: "外部阻塞",
          nextStep: "等待依赖准备完毕",
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          metadata: {},
          sourceArtifact: {
            id: "story-blocked",
            type: "STORY",
            name: "Story Blocked",
            parent: null,
          },
        },
      ],
      workspaceSlug: "demo-workspace",
      projectSlug: "demo-project",
    });

    expect(payload.viewType).toBe("epic");
    expect(payload.items).toEqual([]);
    expect(payload.statusDistribution).toEqual({
      completed: 1,
      inProgress: 0,
      dispatched: 1,
      pending: 1,
      failed: 1,
    });
    expect(payload.storySummaries.map((item) => item.storyName)).toEqual([
      "Story Active",
      "Story Review",
      "Story Blocked",
      "Story Pending",
    ]);
    expect(payload.storySummaries.find((item) => item.storyArtifactId === "story-active")).toMatchObject({
      aggregateStatus: "dispatched",
      taskCount: 1,
      latestTaskDetailHref: "/workspace/demo-workspace/project/demo-project/tasks/task-active",
    });
    expect(payload.storySummaries.find((item) => item.storyArtifactId === "story-review")).toMatchObject({
      aggregateStatus: "completed",
      taskCount: 1,
    });
    expect(payload.storySummaries.find((item) => item.storyArtifactId === "story-pending")).toMatchObject({
      aggregateStatus: "pending",
      taskCount: 0,
    });
    expect(payload.storySummaries.find((item) => item.storyArtifactId === "story-blocked")).toMatchObject({
      aggregateStatus: "failed",
      taskCount: 1,
    });
  });

  it("restores source artifact snapshot from metadata when relation is missing", () => {
    const sourceArtifact = resolveTaskSourceArtifact({
      sourceArtifact: null,
      metadata: {
        sourceContext: {
          artifactId: "story-23",
          artifactType: "STORY",
          artifactName: "执行任务与来源工件的追踪映射",
          filePath: "_bmad-output/implementation-artifacts/2-3-执行任务与来源工件的追踪映射.md",
          hierarchy: [
            { id: "prd-1", type: "PRD", name: "产品需求文档" },
            { id: "epic-2", type: "EPIC", name: "执行入口" },
            { id: "story-23", type: "STORY", name: "执行任务与来源工件的追踪映射" },
          ],
        },
      },
    });

    expect(sourceArtifact).toMatchObject({
      id: "story-23",
      type: "STORY",
      name: "执行任务与来源工件的追踪映射",
      filePath: "_bmad-output/implementation-artifacts/2-3-执行任务与来源工件的追踪映射.md",
    });
  });

  it("creates a stable source context snapshot for task metadata", () => {
    expect(buildTaskSourceContextSnapshot(
      {
        artifactId: "story-23",
        artifactType: "STORY",
        artifactName: "执行任务与来源工件的追踪映射",
        filePath: "_bmad-output/implementation-artifacts/2-3-执行任务与来源工件的追踪映射.md",
        hierarchy: [
          { id: "prd-1", type: "PRD", name: "产品需求文档" },
          { id: "epic-2", type: "EPIC", name: "BMAD 工件执行入口" },
          { id: "story-23", type: "STORY", name: "执行任务与来源工件的追踪映射" },
        ],
      },
      {
        acceptanceCriteria: ["查看任务来源链路"],
        relatedStoryIds: ["2.3"],
      },
    )).toEqual({
      artifactId: "story-23",
      artifactType: "STORY",
      artifactName: "执行任务与来源工件的追踪映射",
      filePath: "_bmad-output/implementation-artifacts/2-3-执行任务与来源工件的追踪映射.md",
      hierarchy: [
        { id: "prd-1", type: "PRD", name: "产品需求文档" },
        { id: "epic-2", type: "EPIC", name: "BMAD 工件执行入口" },
        { id: "story-23", type: "STORY", name: "执行任务与来源工件的追踪映射" },
      ],
      acceptanceCriteria: ["查看任务来源链路"],
      relatedStoryIds: ["2.3"],
    });
  });

  it("builds stable task and artifact hrefs", () => {
    expect(buildTaskDetailHref("demo-workspace", "demo-project", "task-1"))
      .toBe("/workspace/demo-workspace/project/demo-project/tasks/task-1");
    expect(buildSourceArtifactHref("demo-workspace", "demo-project", "artifact-1"))
      .toBe("/workspace/demo-workspace/project/demo-project?artifactId=artifact-1#artifact-tree");
  });
});
