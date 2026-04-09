import { describe, it, expect } from "vitest";
import { buildArtifactTree } from "../utils";

describe("buildArtifactTree", () => {
  it("returns empty array for empty input", () => {
    const result = buildArtifactTree([]);
    expect(result).toEqual([]);
  });

  it("returns root nodes when no parentId is set", () => {
    const result = buildArtifactTree([
      { id: "1", type: "PRD", name: "PRD", filePath: "prd.md", metadata: null, parentId: null },
      { id: "2", type: "EPIC", name: "Epic 1", filePath: "epics.md", metadata: null, parentId: null },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("1");
    expect(result[1].id).toBe("2");
    expect(result[0].children).toHaveLength(0);
  });

  it("builds correct parent-child hierarchy", () => {
    const result = buildArtifactTree([
      { id: "prd-1", type: "PRD", name: "PRD", filePath: "prd.md", metadata: null, parentId: null },
      { id: "epic-1", type: "EPIC", name: "Epic 1", filePath: "epics.md", metadata: { epicId: "1" }, parentId: "prd-1" },
      { id: "story-1", type: "STORY", name: "Story 1.1", filePath: "1-1-init.md", metadata: { epicId: "1" }, parentId: "epic-1" },
    ]);

    expect(result).toHaveLength(1); // Only PRD at root
    expect(result[0].id).toBe("prd-1");
    expect(result[0].children).toHaveLength(1); // Epic under PRD
    expect(result[0].children[0].id).toBe("epic-1");
    expect(result[0].children[0].children).toHaveLength(1); // Story under Epic
    expect(result[0].children[0].children[0].id).toBe("story-1");
  });

  it("promotes orphan nodes to root (parentId points to non-existent record)", () => {
    const result = buildArtifactTree([
      { id: "1", type: "STORY", name: "Orphan Story", filePath: "1-1-orphan.md", metadata: null, parentId: "non-existent-id" },
      { id: "2", type: "EPIC", name: "Epic", filePath: "epics.md", metadata: null, parentId: null },
    ]);

    expect(result).toHaveLength(2); // Both at root
    expect(result.find((n) => n.id === "1")).toBeDefined();
    expect(result.find((n) => n.id === "2")).toBeDefined();
  });

  it("handles deep nesting (PRD → Epic → Story → Task)", () => {
    const result = buildArtifactTree([
      { id: "prd", type: "PRD", name: "PRD", filePath: "prd.md", metadata: null, parentId: null },
      { id: "epic", type: "EPIC", name: "Epic", filePath: "epics.md", metadata: null, parentId: "prd" },
      { id: "story", type: "STORY", name: "Story", filePath: "1-1.md", metadata: null, parentId: "epic" },
      { id: "task", type: "TASK", name: "Task", filePath: "task.md", metadata: null, parentId: "story" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].children[0].children[0].children[0].id).toBe("task");
  });

  it("preserves metadata in tree nodes", () => {
    const metadata = { status: "done", epicId: "1", completedTasks: 5 };
    const result = buildArtifactTree([
      { id: "1", type: "STORY", name: "Story", filePath: "1-1.md", metadata, parentId: null },
    ]);

    expect(result[0].metadata).toEqual(metadata);
  });

  it("handles multiple children under one parent", () => {
    const result = buildArtifactTree([
      { id: "prd", type: "PRD", name: "PRD", filePath: "prd.md", metadata: null, parentId: null },
      { id: "e1", type: "EPIC", name: "Epic 1", filePath: "e1.md", metadata: null, parentId: "prd" },
      { id: "e2", type: "EPIC", name: "Epic 2", filePath: "e2.md", metadata: null, parentId: "prd" },
      { id: "e3", type: "EPIC", name: "Epic 3", filePath: "e3.md", metadata: null, parentId: "prd" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(3);
  });
});
