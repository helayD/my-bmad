import { describe, expect, it, vi } from "vitest";
import {
  buildProjectedStoryStub,
  extractStoriesFromEpicsDocument,
  projectStoriesFromEpicsDocument,
  type ProjectedStorySpec,
} from "@/lib/planning/story-projection";

function createWriter(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));

  return {
    files,
    writer: {
      readArtifact: vi.fn(async (filePath: string) => ({
        exists: files.has(filePath),
        content: files.get(filePath) ?? null,
        sha: null,
      })),
      writeArtifact: vi.fn(async (input: { path: string; content: string; summary: string }) => {
        const mode: "create" | "update" = files.has(input.path) ? "update" : "create";
        files.set(input.path, input.content);
        return {
          path: input.path,
          mode,
          commitSha: null,
          summary: input.summary,
          cacheTags: [],
        };
      }),
    },
  };
}

describe("extractStoriesFromEpicsDocument", () => {
  it("extracts epic stories from the controlled epics format", () => {
    const result = extractStoriesFromEpicsDocument(`## Epic 1: 目标与范围

### Story 1.1: 梳理关键场景

作为用户，我希望系统明确关键场景。

**验收标准：**

1. 关键流程被拆解。
2. 状态与下一步可见。

### Story 1.2: 整理验收标准

作为用户，我希望系统整理验收标准。

**验收标准：**

1. 验收标准可被继续编辑。
`);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      epicId: "1",
      storyId: "1.1",
      title: "梳理关键场景",
    });
    expect(result[0]?.acceptanceCriteria).toEqual([
      "关键流程被拆解。",
      "状态与下一步可见。",
    ]);
  });
});

describe("buildProjectedStoryStub", () => {
  it("creates a parse-story-compatible stub with planned status", () => {
    const story: ProjectedStorySpec = {
      epicId: "2",
      epicTitle: "核心交付",
      storyId: "2.1",
      title: "实现主流程与关键数据结构",
      summary: "实现主流程并补齐关键数据结构",
      acceptanceCriteria: [
        "主流程可以被完整执行。",
        "异常与反馈具备真实说明。",
      ],
    };

    const stub = buildProjectedStoryStub(story, "_bmad-output/planning-artifacts/epics.md");

    expect(stub).toContain("# Story 2.1: 实现主流程与关键数据结构");
    expect(stub).toContain("Status: planned");
    expect(stub).toContain("## Acceptance Criteria");
    expect(stub).toContain("## Tasks / Subtasks");
    expect(stub).toContain("planning:story-projection:start");
  });
});

describe("projectStoriesFromEpicsDocument", () => {
  it("creates missing story stub files and records created artifacts", async () => {
    const { writer, files } = createWriter();

    const result = await projectStoriesFromEpicsDocument({
      content: `## Epic 1: 目标与范围

### Story 1.1: 梳理关键场景

作为用户，我希望系统明确关键场景。

**验收标准：**

1. 关键流程被拆解。
2. 状态与下一步可见。
`,
      sourcePath: "_bmad-output/planning-artifacts/epics.md",
      writer,
      existingPaths: [],
      sourceSkillKey: "bmad-create-epics-and-stories",
    });

    expect(result.conflicts).toEqual([]);
    expect(result.writes).toHaveLength(1);
    expect(result.artifactSummary[0]).toMatchObject({
      kind: "story-stub",
      status: "created",
      storyId: "1.1",
    });
    const createdContent = [...files.values()][0];
    expect(createdContent).toContain("Status: planned");
  });

  it("does not overwrite an existing unmanaged story file", async () => {
    const existingPath = "_bmad-output/implementation-artifacts/1-1-梳理关键场景.md";
    const { writer } = createWriter({
      [existingPath]: "# Story 1.1: 手工维护版本\n\nStatus: ready-for-dev",
    });

    const result = await projectStoriesFromEpicsDocument({
      content: `## Epic 1: 目标与范围

### Story 1.1: 梳理关键场景

作为用户，我希望系统明确关键场景。
`,
      sourcePath: "_bmad-output/planning-artifacts/epics.md",
      writer,
      existingPaths: [existingPath],
      sourceSkillKey: "bmad-create-epics-and-stories",
    });

    expect(result.writes).toHaveLength(0);
    expect(result.conflicts[0]).toContain("已跳过覆盖");
    expect(result.artifactSummary[0]?.status).toBe("conflict");
  });
});
