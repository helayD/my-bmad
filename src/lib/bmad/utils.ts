import { FileTreeNode, StoryStatus } from "./types";

export const BMAD_OUTPUT_DIR = "_bmad-output";
export const BMAD_CORE_DIR = "_bmad";
export const BMAD_PLANNING_DIR = "planning-artifacts";
export const BMAD_IMPLEMENTATION_DIR = "implementation-artifacts";

export function detectBmadOutputDir(paths: string[]): string {
  for (const p of paths) {
    const slash = p.indexOf("/");
    if (slash === -1) continue;
    const rootDir = p.slice(0, slash);
    const rest = p.slice(slash + 1);
    if (
      rest.startsWith(BMAD_PLANNING_DIR + "/") ||
      rest.startsWith(BMAD_IMPLEMENTATION_DIR + "/")
    ) {
      return rootDir;
    }
  }
  return BMAD_OUTPUT_DIR;
}

/**
 * Canonical normalizeStoryStatus used across all BMAD parsers.
 * Default fallback is "backlog".
 */
export function normalizeStoryStatus(raw: string | undefined): StoryStatus {
  if (!raw) return "backlog";
  const s = raw.toLowerCase().trim();
  if (s === "done" || s === "complete" || s === "completed") return "done";
  if (s.includes("progress") || s === "started") return "in-progress";
  if (s === "review" || s.includes("review")) return "review";
  if (s === "blocked") return "blocked";
  if (s === "ready-for-dev" || s === "ready") return "ready-for-dev";
  if (s === "backlog" || s === "todo" || s === "pending") return "backlog";
  if (s === "optional") return "backlog";
  return "backlog";
}

export function buildFileTree(paths: string[], basePath: string): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  const filtered = paths
    .filter((p) => p.startsWith(basePath))
    .map((p) => p.slice(basePath.length).replace(/^\//, ""));

  for (const relativePath of filtered) {
    const parts = relativePath.split("/");
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = basePath + "/" + parts.slice(0, i + 1).join("/");

      let existing = currentLevel.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          path: fullPath,
          type: isFile ? "file" : "directory",
          children: isFile ? undefined : [],
        };
        currentLevel.push(existing);
      }

      if (!isFile && existing.children) {
        currentLevel = existing.children;
      }
    }
  }

  return sortTree(root);
}

function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((n) => ({
      ...n,
      children: n.children ? sortTree(n.children) : undefined,
    }));
}

export function normalizeStoryId(raw: string): string {
  return raw
    .replace(/^(?:story|S)[_-]?/i, "")
    .replace(/[._]/, ".")
    .trim();
}
