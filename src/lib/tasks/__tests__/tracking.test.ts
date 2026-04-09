import { describe, expect, it } from "vitest";
import {
  TASK_ACTIVITY_FALLBACK,
  TASK_AGENT_TYPE_FALLBACK,
  TASK_RESULT_SUMMARY_FALLBACK,
  buildArtifactTaskHistoryEntries,
  buildTaskSourcePathText,
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

  it("builds history entries with descending order and Chinese fallbacks", () => {
    const entries = buildArtifactTaskHistoryEntries([
      {
        id: "task-old",
        title: "旧任务",
        status: "pending",
        currentStage: "待处理",
        nextStep: "稍后执行",
        createdAt: new Date("2026-04-01T08:00:00.000Z"),
        metadata: {},
        sourceArtifact: null,
      },
      {
        id: "task-new",
        title: "新任务",
        status: "done",
        currentStage: "已完成",
        nextStep: "无需后续步骤",
        createdAt: new Date("2026-04-02T08:00:00.000Z"),
        metadata: {
          currentActivity: "正在整理交付总结",
          agentTypeLabel: "实现 Agent",
          resultSummary: "已完成任务详情追踪视图",
        },
        sourceArtifact: { id: "story-1", type: "STORY", name: "Story 2.3" },
      },
    ]);

    expect(entries.map((item) => item.taskId)).toEqual(["task-new", "task-old"]);
    expect(entries[0]).toMatchObject({
      currentActivity: "正在整理交付总结",
      agentTypeLabel: "实现 Agent",
      resultSummary: "已完成任务详情追踪视图",
      sourceArtifactName: "Story 2.3",
    });
    expect(entries[1]).toMatchObject({
      currentActivity: "待处理",
      agentTypeLabel: TASK_AGENT_TYPE_FALLBACK,
      resultSummary: TASK_RESULT_SUMMARY_FALLBACK,
    });
  });

  it("uses next step fallback when current activity and stage are absent", () => {
    const [entry] = buildArtifactTaskHistoryEntries([
      {
        id: "task-1",
        title: "任务 1",
        status: "review",
        currentStage: "",
        nextStep: "等待人工确认",
        createdAt: new Date("2026-04-03T08:00:00.000Z"),
        metadata: {},
        sourceArtifact: null,
      },
    ]);

    expect(entry.currentActivity).toBe("等待人工确认");
  });

  it("uses stable empty activity fallback when no signals are present", () => {
    const [entry] = buildArtifactTaskHistoryEntries([
      {
        id: "task-2",
        title: "任务 2",
        status: "blocked",
        currentStage: "",
        nextStep: "",
        createdAt: new Date("2026-04-04T08:00:00.000Z"),
        metadata: {},
        sourceArtifact: null,
      },
    ]);

    expect(entry.currentActivity).toBe(TASK_ACTIVITY_FALLBACK);
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
});
