import fs from "node:fs/promises";
import path from "node:path";
import {
  BMAD_IMPLEMENTATION_DIR,
  BMAD_OUTPUT_DIR,
  BMAD_PLANNING_DIR,
} from "@/lib/bmad/utils";

const ALLOWED_WRITE_PREFIXES = [
  `${BMAD_OUTPUT_DIR}/${BMAD_PLANNING_DIR}/`,
  `${BMAD_OUTPUT_DIR}/${BMAD_IMPLEMENTATION_DIR}/`,
] as const;

export function assertSafeRelativePath(filePath: string): void {
  if (filePath.includes("\0")) {
    throw new Error("Invalid path: null bytes not allowed");
  }

  if (/[\u2215\uFF0F]/.test(filePath)) {
    throw new Error("Invalid path: unsupported characters");
  }

  if (path.isAbsolute(filePath)) {
    throw new Error("Path traversal detected");
  }

  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(filePath)) {
    throw new Error("Path traversal detected");
  }
}

export function assertAllowedPlanningArtifactPath(filePath: string): void {
  assertSafeRelativePath(filePath);

  if (!ALLOWED_WRITE_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    throw new Error("Access denied: only BMAD artifact directories are writable");
  }
}

export function resolveSafePathWithinRoot(rootPath: string, relativePath: string): string {
  assertSafeRelativePath(relativePath);

  const resolvedRoot = path.resolve(rootPath);
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  const resolved = path.resolve(resolvedRoot, ...segments);

  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error("Path traversal detected");
  }

  return resolved;
}

export async function assertNoSymlinkSegments(
  rootPath: string,
  targetPath: string,
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relativeTarget = path.relative(resolvedRoot, resolvedTarget);

  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error("Path traversal detected");
  }

  let currentPath = resolvedRoot;
  const segments = relativeTarget.split(path.sep).filter(Boolean);

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);

    try {
      const stat = await fs.lstat(currentPath);
      if (stat.isSymbolicLink()) {
        throw new Error("Symlinks are not allowed");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }
}
