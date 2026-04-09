import type { ContentProvider } from "@/lib/content-provider";
import { parseEpics } from "@/lib/bmad/parse-epics";
import { parseEpicFile } from "@/lib/bmad/parse-epic-file";
import { parseStory } from "@/lib/bmad/parse-story";
import {
  detectBmadOutputDir,
  BMAD_PLANNING_DIR,
  BMAD_IMPLEMENTATION_DIR,
} from "@/lib/bmad/utils";
import { parsePrdArtifactContent } from "./prd";
import type { ScanResult, ScannedArtifact } from "./types";

/**
 * Scan a project's repository for BMAD artifacts (PRD, Epic, Story).
 * Reuses existing ContentProvider interface and BMAD parsers.
 */
export async function scanProjectArtifacts(
  provider: ContentProvider,
): Promise<ScanResult> {
  const artifacts: ScannedArtifact[] = [];
  const errors: { file: string; error: string }[] = [];

  const providerTree = await provider.getTree();
  const allPaths = providerTree.paths;

  const bmadOutput = detectBmadOutputDir(allPaths);
  const bmadPaths = allPaths.filter((p) => p.startsWith(bmadOutput + "/"));

  // --- PRD files: *prd*.md in planning-artifacts ---
  const planningPrefix = `${bmadOutput}/${BMAD_PLANNING_DIR}/`;
  const prdPaths = bmadPaths.filter((p) => {
    if (!p.startsWith(planningPrefix) || !p.endsWith(".md")) return false;
    const filename = p.split("/").pop()?.toLowerCase() ?? "";
    return /^prd(?:[._-]|$)/.test(filename) && !/(?:validation|report)/.test(filename);
  });

  // --- Epic files: epics.md or epics/ directory ---
  const epicsPath = bmadPaths.find(
    (p) =>
      p.startsWith(planningPrefix) &&
      (p.endsWith("epics.md") || p.endsWith("epic.md")),
  );

  const EPICS_DIR = BMAD_PLANNING_DIR + "/epics";
  const epicFilePaths = epicsPath
    ? []
    : bmadPaths.filter((p) => {
        if (
          !p.includes(EPICS_DIR + "/") ||
          !p.endsWith(".md")
        )
          return false;
        const filename = p.split("/").pop() || "";
        return /^(?:epic[_-]?)?\d+/i.test(filename);
      });

  // --- Story files: N-N-*.md in implementation-artifacts ---
  const implPrefix = `${bmadOutput}/${BMAD_IMPLEMENTATION_DIR}/`;
  const storyPaths = bmadPaths.filter((p) => {
    if (!p.startsWith(implPrefix) || !p.endsWith(".md")) return false;
    const filename = p.split("/").pop() || "";
    return /^\d+-\d+-.+\.md$/.test(filename);
  });

  // --- Fetch all file contents in parallel ---
  const fetches: Promise<{ key: string; path: string; content: string }>[] = [];

  for (const p of prdPaths) {
    fetches.push(
      provider
        .getFileContent(p)
        .then((content) => ({ key: "prd", path: p, content }))
        .catch((e) => {
          errors.push({ file: p, error: e instanceof Error ? e.message : String(e) });
          return null;
        }) as Promise<{ key: string; path: string; content: string }>,
    );
  }

  if (epicsPath) {
    fetches.push(
      provider
        .getFileContent(epicsPath)
        .then((content) => ({ key: "epics", path: epicsPath, content }))
        .catch((e) => {
          errors.push({ file: epicsPath, error: e instanceof Error ? e.message : String(e) });
          return null;
        }) as Promise<{ key: string; path: string; content: string }>,
    );
  }

  for (const ep of epicFilePaths) {
    fetches.push(
      provider
        .getFileContent(ep)
        .then((content) => ({ key: "epic-file", path: ep, content }))
        .catch((e) => {
          errors.push({ file: ep, error: e instanceof Error ? e.message : String(e) });
          return null;
        }) as Promise<{ key: string; path: string; content: string }>,
    );
  }

  for (const sp of storyPaths) {
    fetches.push(
      provider
        .getFileContent(sp)
        .then((content) => ({ key: "story", path: sp, content }))
        .catch((e) => {
          errors.push({ file: sp, error: e instanceof Error ? e.message : String(e) });
          return null;
        }) as Promise<{ key: string; path: string; content: string }>,
    );
  }

  const results = (await Promise.all(fetches)).filter(
    (r): r is { key: string; path: string; content: string } => r !== null,
  );

  // --- Parse each result ---
  for (const { key, path: filePath, content } of results) {
    try {
      if (key === "prd") {
        const parsed = parsePrdArtifactContent(content);
        artifacts.push({
          type: "PRD",
          name: parsed.title,
          filePath,
          metadata: parsed.metadata,
        });
      } else if (key === "epics") {
        const result = parseEpics(content);
        for (const epic of result.epics) {
          artifacts.push({
            type: "EPIC",
            name: epic.title,
            filePath: `${filePath}#epic-${epic.id}`,
            metadata: {
              epicId: epic.id,
              description: epic.description,
              stories: epic.stories,
              totalStories: epic.totalStories,
            },
            epicId: epic.id,
          });
        }
        if (result.error) {
          errors.push({ file: filePath, error: result.error });
        }
      } else if (key === "epic-file") {
        const filename = filePath.split("/").pop() || "";
        const epic = parseEpicFile(content, filename);
        if (epic) {
          artifacts.push({
            type: "EPIC",
            name: epic.title,
            filePath,
            metadata: {
              epicId: epic.id,
              description: epic.description,
              stories: epic.stories,
              totalStories: epic.totalStories,
            },
            epicId: epic.id,
          });
        } else {
          errors.push({ file: filePath, error: "Failed to parse epic file" });
        }
      } else if (key === "story") {
        const filename = filePath.split("/").pop() || "";
        const story = parseStory(content, filename);
        if (story) {
          artifacts.push({
            type: "STORY",
            name: story.title,
            filePath,
            metadata: {
              storyId: story.id,
              status: story.status,
              epicId: story.epicId,
              completedTasks: story.completedTasks,
              totalTasks: story.totalTasks,
            },
            epicId: story.epicId,
            storyId: story.id,
          });

          story.tasks.forEach((task, index) => {
            const taskNumber = index + 1;
            artifacts.push({
              type: "TASK",
              name: task.description,
              filePath: `${filePath}#task-${taskNumber}`,
              metadata: {
                taskId: `${story.id}.${taskNumber}`,
                storyId: story.id,
                epicId: story.epicId,
                completed: task.completed,
                status: task.completed ? "done" : "pending",
                order: taskNumber,
              },
              epicId: story.epicId,
              storyId: story.id,
            });
          });
        } else {
          errors.push({ file: filePath, error: "Failed to parse story file" });
        }
      }
    } catch (e) {
      errors.push({
        file: filePath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { artifacts, errors };
}
