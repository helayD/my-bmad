import { describe, expect, it, vi } from "vitest";
import type { ContentProvider, ContentProviderTree } from "@/lib/content-provider";
import { buildTaskCreationContext } from "@/lib/tasks/context";

function createProvider(files: Record<string, string>): ContentProvider {
  return {
    getTree: vi.fn().mockResolvedValue({
      paths: Object.keys(files),
      rootDirectories: ["_bmad-output"],
    } satisfies ContentProviderTree),
    getFileContent: vi.fn((path: string) => {
      if (files[path] !== undefined) {
        return Promise.resolve(files[path]);
      }

      return Promise.reject(new Error(`Missing file: ${path}`));
    }),
    validateRoot: vi.fn().mockResolvedValue(undefined),
  };
}

describe("buildTaskCreationContext", () => {
  it("builds Story context with acceptance criteria and hierarchy", async () => {
    const provider = createProvider({
      "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md": `# Story 2.2: 从工件发起任务

Status: ready-for-dev

作为用户，我希望从 Story 发起执行。

## Acceptance Criteria
1. 用户可以看到来源上下文
2. 用户可以创建任务

## Tasks / Subtasks
- [ ] 创建任务模型
- [ ] 创建任务详情页
`,
    });

    const context = await buildTaskCreationContext(
      {
        id: "artifact-story-1",
        type: "STORY",
        name: "从工件发起任务",
        filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md",
        metadata: { storyId: "2.2", epicId: "2", status: "ready-for-dev" },
        parent: {
          id: "artifact-epic-1",
          type: "EPIC",
          name: "执行入口",
          filePath: "_bmad-output/planning-artifacts/epics.md#epic-2",
          metadata: { epicId: "2" },
          parent: {
            id: "artifact-prd-1",
            type: "PRD",
            name: "产品需求文档",
            filePath: "_bmad-output/planning-artifacts/prd.md",
            metadata: {},
          },
        },
      },
      provider,
    );

    expect(context.title).toBe("从工件发起任务");
    expect(context.acceptanceCriteria).toHaveLength(2);
    expect(context.relatedStoryIds).toEqual(["2.2"]);
    expect(context.sourceArtifact.hierarchy.map((item) => item.name)).toEqual([
      "产品需求文档",
      "执行入口",
      "从工件发起任务",
    ]);
  });

  it("prefers Epic metadata without unnecessary repo reads", async () => {
    const provider = createProvider({
      "_bmad-output/planning-artifacts/epics.md": "## Epic 2: 执行入口",
    });

    const context = await buildTaskCreationContext(
      {
        id: "artifact-epic-1",
        type: "EPIC",
        name: "执行入口",
        filePath: "_bmad-output/planning-artifacts/epics.md#epic-2",
        metadata: {
          epicId: "2",
          description: "该 Epic 聚焦从 BMAD 工件进入执行链路。",
          stories: ["2.2", "2.3"],
        },
      },
      provider,
    );

    expect(context.summary).toContain("执行链路");
    expect(context.relatedStoryIds).toEqual(["2.2", "2.3"]);
    expect(provider.getFileContent).not.toHaveBeenCalled();
  });

  it("builds PRD context from markdown content", async () => {
    const provider = createProvider({
      "_bmad-output/planning-artifacts/prd.md": `---
title: BMAD 平台 PRD
status: draft
---
# BMAD 平台 PRD

该 PRD 说明如何从规划工件进入执行链路。`,
    });

    const context = await buildTaskCreationContext(
      {
        id: "artifact-prd-1",
        type: "PRD",
        name: "BMAD 平台 PRD",
        filePath: "_bmad-output/planning-artifacts/prd.md",
        metadata: { status: "draft" },
      },
      provider,
    );

    expect(context.title).toBe("BMAD 平台 PRD");
    expect(context.summary).toContain("执行链路");
    expect(context.suggestedIntent).toBe("research");
  });

  it("builds Task context by resolving the referenced checkbox from its Story", async () => {
    const provider = createProvider({
      "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md": `# Story 2.2: 从工件发起任务

Status: ready-for-dev

## Acceptance Criteria
1. 用户可以看到来源上下文

## Tasks / Subtasks
- [ ] 创建任务模型
- [ ] 创建任务详情页
`,
    });

    const context = await buildTaskCreationContext(
      {
        id: "artifact-task-2",
        type: "TASK",
        name: "创建任务详情页",
        filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md#task-2",
        metadata: { taskId: "2.2.2", storyId: "2.2", order: 2 },
        parent: {
          id: "artifact-story-1",
          type: "STORY",
          name: "从工件发起任务",
          filePath: "_bmad-output/implementation-artifacts/2-2-task-from-artifact.md",
          metadata: { storyId: "2.2", epicId: "2" },
        },
      },
      provider,
    );

    expect(context.summary).toBe("创建任务详情页");
    expect(context.relatedStoryIds).toEqual(["2.2"]);
    expect(context.sourceArtifact.artifactType).toBe("TASK");
  });
});
