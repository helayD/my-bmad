import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlanningArtifactWriter } from "@/lib/planning/artifact-writer";

let tempDir: string;

beforeEach(async () => {
  process.env.ENABLE_LOCAL_FS = "true";
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "planning-writer-"));
});

afterEach(async () => {
  delete process.env.ENABLE_LOCAL_FS;
  await fs.rm(tempDir, { recursive: true, force: true });
});

function createLocalRepoConfig() {
  return {
    id: "repo-local",
    owner: "local",
    name: "demo",
    branch: "main",
    displayName: "demo",
    description: null,
    sourceType: "local" as const,
    localPath: tempDir,
    lastSyncedAt: null,
  };
}

describe("createPlanningArtifactWriter", () => {
  it("writes planning artifacts inside the controlled BMAD directory", async () => {
    const writer = await createPlanningArtifactWriter(createLocalRepoConfig(), "user-1");

    const result = await writer.writeArtifact({
      path: "_bmad-output/planning-artifacts/prd.md",
      content: "# PRD\n\n内容",
      summary: "创建 PRD",
    });

    expect(result.mode).toBe("create");
    expect(
      await fs.readFile(path.join(tempDir, "_bmad-output", "planning-artifacts", "prd.md"), "utf-8"),
    ).toContain("# PRD");
  });

  it("returns update mode when overwriting an existing managed artifact", async () => {
    await fs.mkdir(path.join(tempDir, "_bmad-output", "planning-artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "_bmad-output", "planning-artifacts", "prd.md"),
      "# Old PRD",
      "utf-8",
    );

    const writer = await createPlanningArtifactWriter(createLocalRepoConfig(), "user-1");
    const result = await writer.writeArtifact({
      path: "_bmad-output/planning-artifacts/prd.md",
      content: "# New PRD",
      summary: "更新 PRD",
    });

    expect(result.mode).toBe("update");
    expect(
      await fs.readFile(path.join(tempDir, "_bmad-output", "planning-artifacts", "prd.md"), "utf-8"),
    ).toContain("# New PRD");
  });

  it("rejects writes outside the controlled BMAD artifact directories", async () => {
    const writer = await createPlanningArtifactWriter(createLocalRepoConfig(), "user-1");

    await expect(
      writer.writeArtifact({
        path: "README.md",
        content: "bad",
        summary: "should fail",
      }),
    ).rejects.toThrow("Access denied");
  });
});
