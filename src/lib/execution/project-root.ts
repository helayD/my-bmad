/**
 * Project-boundary resolution chain for execution.
 *
 * Reuses and extends existing content-provider helpers rather than duplicating logic.
 *
 * Responsibilities:
 * 1. Resolve local execution root from project repo configuration.
 * 2. Canonicalize the root path (detect symlinks, validate directory).
 * 3. Provide the canonical realpath for tmux session cwd and context injection.
 *
 * Key decisions:
 * - LocalProvider is used for all local repos — not GitHub repos (they have no local path).
 * - Canonical root is always resolved via realpath() to prevent symlink-based path escapes.
 * - GitHub-only repos cannot execute locally — callers get a structured rejection, not a runtime error.
 */

import fs from "node:fs/promises";
import {
  createProjectContentProvider,
  toProjectRepoProviderConfig,
  ProjectProviderError,
} from "@/lib/content-provider/project-provider";
import type { ProjectRepoProviderConfig } from "@/lib/content-provider/project-provider";
import { LOCAL_PROVIDER_DEFAULTS } from "@/lib/content-provider/types";
import { EXECUTION_BOUNDARY_VIOLATION_CODES } from "./supervisor/boundary";

export class ExecutionPreconditionError extends Error {
  code: string;
  humanMessage: string;

  constructor(code: string, humanMessage: string) {
    super(code);
    this.code = code;
    this.humanMessage = humanMessage;
    this.name = "ExecutionPreconditionError";
  }
}

export interface ProjectExecutionRoot {
  projectId: string;
  repoId: string;
  /** Canonical realpath — symlinks resolved, always a real directory. */
  canonicalPath: string;
  /** User-configured localPath for display purposes. */
  displayPath: string;
  /** Whether the root itself was a symlink (rejected). */
  isRootSymlink: boolean;
  /** Whether the canonical path differs from display path (symlink in path). */
  hasSymlinkInPath: boolean;
  /** Resolved limits from provider defaults. */
  maxFileCount: number;
  maxDepth: number;
  maxFileSizeBytes: number;
  provider: ProjectRepoProviderConfig;
}

/**
 * Resolve the validated, canonical local execution root for a project.
 *
 * Rules:
 * - Only sourceType === "local" repos can execute locally.
 * - localPath must exist and be a real directory.
 * - The root itself must not be a symlink.
 * - Canonical path must be computed via realpath().
 *
 * Returns null for GitHub-only repos (not an error — just not locally executable).
 * Throws ExecutionPreconditionError for invalid local paths.
 */
export async function resolveProjectExecutionRoot(
  project: {
    id: string;
    repo: {
      id: string;
      sourceType: string;
      localPath: string | null;
    } | null;
  },
): Promise<ProjectExecutionRoot | null> {
  const repo = project.repo;

  // No repo at all
  if (!repo) {
    return null;
  }

  // GitHub repos have no local path
  if (repo.sourceType !== "local") {
    return null;
  }

  if (!repo.localPath) {
    return null;
  }

  const displayPath = repo.localPath;

  // Validate via content provider first
  try {
    const providerConfig = toProjectRepoProviderConfig({
      id: repo.id,
      owner: "",
      name: "",
      branch: "",
      displayName: "",
      description: null,
      sourceType: repo.sourceType,
      localPath: repo.localPath,
      lastSyncedAt: null,
    });

    const provider = await createProjectContentProvider(providerConfig, "");
    await provider.validateRoot();

    // Canonicalize: resolve all symlinks in the path
    let canonicalPath: string;
    let isSymlink: boolean;

    try {
      const realpathResult = await resolveCanonicalRoot(repo.localPath);
      canonicalPath = realpathResult.canonicalPath;
      isSymlink = realpathResult.isSymlink;
    } catch {
      throw new ExecutionPreconditionError(
        EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_UNAVAILABLE,
        `项目执行目录无法访问：${repo.localPath}`,
      );
    }

    // Reject root that is itself a symlink
    if (isSymlink) {
      throw new ExecutionPreconditionError(
        EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_IS_SYMLINK,
        `项目根目录 "${repo.localPath}" 本身是符号链接，不允许作为执行根目录。请使用实际目录路径。`,
      );
    }

    const hasSymlinkInPath = canonicalPath !== repo.localPath;

    return {
      projectId: project.id,
      repoId: repo.id,
      canonicalPath,
      displayPath,
      isRootSymlink: isSymlink,
      hasSymlinkInPath,
      maxFileCount: LOCAL_PROVIDER_DEFAULTS.maxFileCount,
      maxDepth: LOCAL_PROVIDER_DEFAULTS.maxDepth,
      maxFileSizeBytes: LOCAL_PROVIDER_DEFAULTS.maxFileSizeBytes,
      provider: providerConfig,
    };
  } catch (error) {
    if (error instanceof ExecutionPreconditionError) {
      throw error;
    }
    if (error instanceof ProjectProviderError) {
      // Token missing or validation failed — path is not usable
      return null;
    }
    // Unexpected error
    return null;
  }
}

/**
 * Resolve canonical path for a local filesystem path.
 * Uses realpath() to resolve all symlinks and lstat() to detect if root itself is a symlink.
 */
async function resolveCanonicalRoot(
  localPath: string,
): Promise<{ canonicalPath: string; isSymlink: boolean }> {
  // Step 1: realpath resolves all symlinks in the path
  const canonicalPath = await fs.realpath(localPath);

  // Step 2: lstat tells us if the resolved root is a symlink
  const lstat = await fs.lstat(canonicalPath);
  const isSymlink = lstat.isSymbolicLink();

  return { canonicalPath, isSymlink };
}

/**
 * Validate that a given path is safely contained within the project root.
 * Used for checking any supervisor-controlled path access (context files, writeback, etc).
 *
 * Combines: assertSafeRelativePath + assertNoSymlinkSegments + realpath canonicalization.
 */
export async function validatePathWithinProject(
  projectRoot: string,
  relativePath: string,
): Promise<{ safe: boolean; canonicalPath: string; violationCode: string | null }> {
  try {
    const resolved = await resolveSafePathWithinProject(projectRoot, relativePath);
    await assertNoSymlinkWithinProject(projectRoot, resolved);
    return { safe: true, canonicalPath: resolved, violationCode: null };
  } catch (error) {
    if (error instanceof Error) {
      const code = mapPathErrorToViolationCode(error.message);
      return { safe: false, canonicalPath: "", violationCode: code };
    }
    return {
      safe: false,
      canonicalPath: "",
      violationCode: EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL,
    };
  }
}

// Reuse existing path-safety helpers
import { assertSafeRelativePath } from "@/lib/content-provider/path-safety";

function resolveSafePathWithinProject(
  projectRoot: string,
  relativePath: string,
): Promise<string> {
  assertSafeRelativePath(relativePath);
  const resolvedRoot = path.resolve(projectRoot);
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  const resolved = path.resolve(resolvedRoot, ...segments);
  // Ensure it stays within project root
  if (
    !resolved.startsWith(resolvedRoot + path.sep) &&
    resolved !== resolvedRoot
  ) {
    throw new Error("Path traversal detected");
  }
  return Promise.resolve(resolved);
}

import path from "node:path";

async function assertNoSymlinkWithinProject(
  projectRoot: string,
  targetPath: string,
): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
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

function mapPathErrorToViolationCode(errorMessage: string): string {
  if (errorMessage.includes("null bytes")) {
    return EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL;
  }
  if (errorMessage.includes("unsupported characters")) {
    return EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL;
  }
  if (errorMessage.includes("Path traversal detected")) {
    return EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL;
  }
  if (errorMessage.includes("Symlinks are not allowed")) {
    return EXECUTION_BOUNDARY_VIOLATION_CODES.SYMLINK_BLOCKED;
  }
  return EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL;
}
