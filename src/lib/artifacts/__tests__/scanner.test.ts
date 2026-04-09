import { describe, it, expect, vi } from "vitest";
import { scanProjectArtifacts } from "../scanner";
import type { ContentProvider, ContentProviderTree } from "@/lib/content-provider";

function mockProvider(
  paths: string[],
  files: Record<string, string>,
): ContentProvider {
  return {
    getTree: vi.fn().mockResolvedValue({
      paths,
      rootDirectories: [...new Set(paths.map((p) => p.split("/")[0]))],
    } satisfies ContentProviderTree),
    getFileContent: vi.fn((path: string) => {
      if (files[path] !== undefined) return Promise.resolve(files[path]);
      return Promise.reject(new Error(`File not found: ${path}`));
    }),
    validateRoot: vi.fn().mockResolvedValue(undefined),
  };
}

describe("scanProjectArtifacts", () => {
  it("identifies PRD files", async () => {
    const provider = mockProvider(
      ["_bmad-output/planning-artifacts/prd.md"],
      {
        "_bmad-output/planning-artifacts/prd.md":
          "# Product Requirements Document\n\nSome content",
      },
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe("PRD");
    expect(result.artifacts[0].name).toBe("Product Requirements Document");
    expect(result.errors).toHaveLength(0);
  });

  it("identifies PRD with frontmatter", async () => {
    const provider = mockProvider(
      ["_bmad-output/planning-artifacts/prd.md"],
      {
        "_bmad-output/planning-artifacts/prd.md":
          "---\ntitle: My PRD\nstatus: draft\n---\n# Some heading\n\nContent",
      },
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe("PRD");
    expect(result.artifacts[0].name).toBe("My PRD");
    expect(result.artifacts[0].metadata).toHaveProperty("status", "draft");
  });

  it("identifies Epics from epics.md (single file)", async () => {
    const provider = mockProvider(
      ["_bmad-output/planning-artifacts/epics.md"],
      {
        "_bmad-output/planning-artifacts/epics.md": `## Epic 1: Setup
- Story 1.1 - Init

## Epic 2: Features
- Story 2.1 - Auth
`,
      },
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0].type).toBe("EPIC");
    expect(result.artifacts[0].name).toBe("Setup");
    expect(result.artifacts[0].epicId).toBe("1");
    expect(result.artifacts[0].filePath).toBe("_bmad-output/planning-artifacts/epics.md#epic-1");
    expect(result.artifacts[1].type).toBe("EPIC");
    expect(result.artifacts[1].name).toBe("Features");
    expect(result.artifacts[1].epicId).toBe("2");
    expect(result.artifacts[1].filePath).toBe("_bmad-output/planning-artifacts/epics.md#epic-2");
  });

  it("identifies Epic from individual epic file", async () => {
    const provider = mockProvider(
      ["_bmad-output/planning-artifacts/epics/epic-1.md"],
      {
        "_bmad-output/planning-artifacts/epics/epic-1.md": `---
id: 1
title: Project Setup
---
Description of the epic.
- Story 1.1 - Init
`,
      },
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe("EPIC");
    expect(result.artifacts[0].name).toBe("Project Setup");
    expect(result.artifacts[0].epicId).toBe("1");
  });

  it("identifies Story files from implementation-artifacts", async () => {
    const provider = mockProvider(
      ["_bmad-output/implementation-artifacts/1-1-project-init.md"],
      {
        "_bmad-output/implementation-artifacts/1-1-project-init.md": `# Story 1.1: Project Init

Status: done

## Acceptance Criteria
1. Given a repo When setup Then initialized
`,
      },
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe("STORY");
    expect(result.artifacts[0].name).toBe("Project Init");
    expect(result.artifacts[0].epicId).toBe("1");
    expect(result.artifacts[0].metadata).toHaveProperty("status", "done");
  });

  it("extracts TASK artifacts from Story checkbox items", async () => {
    const provider = mockProvider(
      ["_bmad-output/implementation-artifacts/2-1-artifact-engine.md"],
      {
        "_bmad-output/implementation-artifacts/2-1-artifact-engine.md": `# Story 2.1: Artifact Engine

Status: in-progress

## Tasks / Subtasks
- [ ] 建立 Prisma 模型
- [x] 创建扫描器
`,
      },
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(3);

    const story = result.artifacts.find((artifact) => artifact.type === "STORY");
    const tasks = result.artifacts.filter((artifact) => artifact.type === "TASK");

    expect(story).toBeDefined();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      name: "建立 Prisma 模型",
      filePath: "_bmad-output/implementation-artifacts/2-1-artifact-engine.md#task-1",
      storyId: "2.1",
      epicId: "2",
    });
    expect(tasks[0].metadata).toMatchObject({
      taskId: "2.1.1",
      storyId: "2.1",
      epicId: "2",
      completed: false,
      status: "pending",
      order: 1,
    });
    expect(tasks[1].metadata).toMatchObject({
      taskId: "2.1.2",
      completed: true,
      status: "done",
      order: 2,
    });
  });

  it("builds hierarchy: Story → Epic via epicId", async () => {
    const provider = mockProvider(
      [
        "_bmad-output/planning-artifacts/epics.md",
        "_bmad-output/implementation-artifacts/1-1-init.md",
        "_bmad-output/implementation-artifacts/2-1-auth.md",
      ],
      {
        "_bmad-output/planning-artifacts/epics.md": `## Epic 1: Setup
- Story 1.1

## Epic 2: Auth
- Story 2.1
`,
        "_bmad-output/implementation-artifacts/1-1-init.md": `# Story 1.1: Init
Status: done
`,
        "_bmad-output/implementation-artifacts/2-1-auth.md": `# Story 2.1: Auth
Status: in-progress
`,
      },
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(4); // 2 epics + 2 stories
    const stories = result.artifacts.filter((a) => a.type === "STORY");
    expect(stories[0].epicId).toBe("1");
    expect(stories[1].epicId).toBe("2");
  });

  it("handles empty repository (no BMAD files)", async () => {
    const provider = mockProvider(["README.md", "src/index.ts"], {});

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles file fetch errors gracefully and records them", async () => {
    // Provider lists files but one fails to fetch
    const provider: ContentProvider = {
      getTree: vi.fn().mockResolvedValue({
        paths: [
          "_bmad-output/planning-artifacts/prd.md",
          "_bmad-output/implementation-artifacts/1-1-init.md",
        ],
        rootDirectories: ["_bmad-output"],
      }),
      getFileContent: vi.fn((path: string) => {
        if (path.includes("prd.md")) return Promise.resolve("# PRD\nContent");
        return Promise.reject(new Error("Network error"));
      }),
      validateRoot: vi.fn().mockResolvedValue(undefined),
    };

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(1); // PRD succeeds
    expect(result.errors).toHaveLength(1); // Story fails
    expect(result.errors[0].error).toContain("Network error");
  });

  it("records errors for files that fail to fetch", async () => {
    const provider = mockProvider(
      ["_bmad-output/planning-artifacts/prd.md"],
      {},
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toContain("prd.md");
  });

  it("detects non-standard bmad output directory", async () => {
    const provider = mockProvider(
      ["custom-output/planning-artifacts/prd.md"],
      {
        "custom-output/planning-artifacts/prd.md": "# My PRD\nContent here",
      },
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe("PRD");
  });

  it("does not treat prd-validation-report.md as a PRD file", async () => {
    const provider = mockProvider(
      [
        "_bmad-output/planning-artifacts/prd.md",
        "_bmad-output/planning-artifacts/prd-validation-report.md",
      ],
      {
        "_bmad-output/planning-artifacts/prd.md": "# My PRD\nContent",
        "_bmad-output/planning-artifacts/prd-validation-report.md": "# Validation Report\nDetails",
      },
    );

    const result = await scanProjectArtifacts(provider);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe("PRD");
    expect(result.artifacts[0].name).toBe("My PRD");
  });
});
