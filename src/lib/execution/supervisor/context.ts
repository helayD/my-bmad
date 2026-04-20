/**
 * Context injection preparation — generates the allowlist of files to inject into
 * the agent's execution context.
 *
 * Principles:
 * - Allowlist only: files not explicitly verified are not injected.
 * - Context is built at real launch time (not dispatch time) to avoid stale paths.
 * - Sensitive paths are always excluded regardless of project configuration.
 * - Limits (count, depth, size) are enforced at scan time, not post-hoc.
 */

import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
// Sensitive path matching via supervisor module
import {
  findSensitivePaths,
  DEFAULT_MATCHERS,
  type SensitivePathMatcher,
} from "./sensitive-paths";
import type {
  ExecutionBoundaryProfile,
  ExecutionContextSnapshot,
} from "./boundary";
import {
  EXECUTION_BOUNDARY_VIOLATION_CODES,
} from "./boundary";

export interface PrepareContextOptions {
  /** Canonical root for all path resolutions. */
  canonicalRoot: string;
  /** Allowed sub-trees (relative to canonical root) for context injection. */
  allowedRoots: string[];
  /** Limits to apply during context scan. */
  maxFileCount: number;
  maxDepth: number;
  maxFileSizeBytes: number;
  /** Custom sensitive path matchers (merged with defaults). */
  sensitiveMatchers?: SensitivePathMatcher[];
}

export interface PrepareContextResult {
  success: boolean;
  snapshot: ExecutionContextSnapshot | null;
  /** All violations encountered (non-fatal unless fatalViolation is set). */
  violations: Array<{
    code: string;
    path: string;
    summary: string;
  }>;
  /** Fatal violation — prevents context from being prepared. */
  fatalViolation: {
    code: string;
    summary: string;
  } | null;
}

/**
 * Prepare the execution context (allowlist of files) for a task.
 *
 * This function:
 * 1. Enumerates candidate files within allowed roots using the local provider's scan logic.
 * 2. Filters out sensitive paths, symlink segments, oversized files, depth overflow.
 * 3. Returns a safe allowlist and context snapshot.
 *
 * This does NOT inject context into the agent — that is the caller's responsibility.
 * The result can be used to build prompt context, write context files, or audit.
 */
export async function prepareExecutionContext(
  opts: PrepareContextOptions,
): Promise<PrepareContextResult> {
  const violations: PrepareContextResult["violations"] = [];
  const injected: string[] = [];
  const skippedSensitive: string[] = [];
  const skippedOversized: string[] = [];
  let totalCandidates = 0;

  for (const allowedRoot of opts.allowedRoots) {

    try {
      const absoluteRoot = path.resolve(opts.canonicalRoot, allowedRoot);
      await scanAndFilter({
        absoluteRoot,
        canonicalRoot: opts.canonicalRoot,
        baseDepth: allowedRoot.split(/[\\/]+/).filter(Boolean).length,
        maxDepth: opts.maxDepth,
        maxFileCount: opts.maxFileCount,
        maxFileSizeBytes: opts.maxFileSizeBytes,
        injected,
        skippedSensitive,
        skippedOversized,
        violations,
        sensitiveMatchers: opts.sensitiveMatchers ?? DEFAULT_MATCHERS,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      violations.push({
        code: EXECUTION_BOUNDARY_VIOLATION_CODES.CONTEXT_PREPARATION_FAILED,
        path: allowedRoot,
        summary: `扫描目录 ${allowedRoot} 时失败：${msg}`,
      });
    }
  }

  totalCandidates = injected.length + skippedSensitive.length + skippedOversized.length;

  const snapshot: ExecutionContextSnapshot = {
    injectedFiles: injected,
    skippedSensitiveFiles: skippedSensitive,
    skippedOversizedFiles: skippedOversized,
    totalCandidates,
    canonicalRoot: opts.canonicalRoot,
  };

  return {
    success: true,
    snapshot,
    violations,
    fatalViolation: null,
  };
}

// ── Internal scanner ───────────────────────────────────────────────────────────────────

const SCAN_IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".svelte-kit",
  "dist", "build", ".cache", ".turbo", ".vercel", ".output",
  "__pycache__", ".venv", "venv", "target", ".now",
  // BMAD internal directories are scoped — agent can only write to artifact dirs.
  // Scanning them is fine (they're read-only in execution context anyway).
]);

async function scanAndFilter(opts: {
  absoluteRoot: string;
  canonicalRoot: string;
  baseDepth: number;
  maxDepth: number;
  maxFileCount: number;
  maxFileSizeBytes: number;
  injected: string[];
  skippedSensitive: string[];
  skippedOversized: string[];
  violations: PrepareContextResult["violations"];
  sensitiveMatchers: SensitivePathMatcher[];
}): Promise<void> {
  const {
    absoluteRoot, canonicalRoot, baseDepth, maxDepth, maxFileCount,
    maxFileSizeBytes, injected, skippedSensitive, skippedOversized,
    violations, sensitiveMatchers,
  } = opts;

  await walkDir(absoluteRoot, baseDepth, {
    maxDepth,
    maxFileCount,
    maxFileSizeBytes,
    injected,
    skippedSensitive,
    skippedOversized,
    violations,
    sensitiveMatchers,
    canonicalRoot,
  });
}

async function walkDir(
  dirPath: string,
  currentDepth: number,
  opts: {
    maxDepth: number;
    maxFileCount: number;
    maxFileSizeBytes: number;
    injected: string[];
    skippedSensitive: string[];
    skippedOversized: string[];
    violations: PrepareContextResult["violations"];
    sensitiveMatchers: SensitivePathMatcher[];
    canonicalRoot: string;
  },
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    // Directory unreadable — skip
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    // ── Symlink: block traversal of symlink segments ──────────────────
    if (entry.isSymbolicLink()) {
      opts.violations.push({
        code: EXECUTION_BOUNDARY_VIOLATION_CODES.SYMLINK_BLOCKED,
        path: fullPath,
        summary: `符号链接 ${fullPath} 被拦截，不允许跟随。`,
      });
      continue;
    }

    if (entry.isDirectory()) {
      if (SCAN_IGNORED_DIRS.has(entry.name)) continue;
      if (currentDepth >= opts.maxDepth) continue;
      await walkDir(fullPath, currentDepth + 1, opts);
      continue;
    }

    if (!entry.isFile()) continue;

    // ── File: check limits ─────────────────────────────────────────
    const relativePath = path.relative(opts.canonicalRoot, fullPath);

    // Sensitive path check
    const sensitiveMatch = findSensitivePaths([relativePath], opts.sensitiveMatchers);
    if (sensitiveMatch.length > 0) {
      opts.skippedSensitive.push(relativePath);
      continue;
    }

    // Size check
    let stat: Stats;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      opts.violations.push({
        code: EXECUTION_BOUNDARY_VIOLATION_CODES.CONTEXT_PREPARATION_FAILED,
        path: relativePath,
        summary: `无法读取文件元数据：${relativePath}`,
      });
      continue;
    }

    if (stat.size > opts.maxFileSizeBytes) {
      opts.skippedOversized.push(relativePath);
      continue;
    }

    // Count limit
    if (opts.injected.length >= opts.maxFileCount) {
      opts.violations.push({
        code: EXECUTION_BOUNDARY_VIOLATION_CODES.CONTEXT_LIMIT_EXCEEDED,
        path: "",
        summary: `上下文文件数已达上限 ${opts.maxFileCount}，停止扫描。`,
      });
      return; // Stop scanning
    }

    opts.injected.push(relativePath);
  }
}

/**
 * Resolve and canonicalize a project root for execution use.
 * Performs:
 * 1. realpath() to resolve any symlinks in the path.
 * 2. lstat() to detect if the root itself is a symlink.
 * 3. Basic existence check.
 *
 * Returns null if the root is invalid or inaccessible.
 */
export async function resolveAndValidateCanonicalRoot(
  localPath: string,
): Promise<{ canonicalPath: string; isSymlink: boolean } | null> {
  try {
    // Step 1: check if the root itself is a symlink (use lstat on the original path).
    const rootLstat = await fs.lstat(localPath);
    const isSymlink = rootLstat.isSymbolicLink();

    // Step 2: verify it is a directory (after symlink resolution).
    if (!rootLstat.isDirectory()) {
      return null;
    }

    // Step 3: resolve all symlinks in the path to get the canonical path.
    const canonical = await fs.realpath(localPath);

    return { canonicalPath: canonical, isSymlink };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

/**
 * Build a full ExecutionBoundaryProfile from a resolved root and context result.
 */
export function buildBoundaryProfileFromContext(opts: {
  workspaceId: string;
  projectId: string;
  canonicalRoot: string;
  displayRoot: string;
  contextResult: PrepareContextResult;
  allowedRoots: string[];
  sensitiveMatchers?: SensitivePathMatcher[];
  maxFileCount: number;
  maxDepth: number;
  maxFileSizeBytes: number;
  preparedBy: "supervisor" | "admission" | "reroute";
}): ExecutionBoundaryProfile {
  const { contextResult, allowedRoots } = opts;

  const sensitiveSampleCount = Math.min(
    contextResult.snapshot?.skippedSensitiveFiles.length ?? 0,
    5,
  );
  const sensitiveSamples = contextResult.snapshot
    ? contextResult.snapshot.skippedSensitiveFiles.slice(0, sensitiveSampleCount)
    : [];

  if (!contextResult.success && contextResult.fatalViolation) {
    // Fatal — boundary failed to prepare
    const code = contextResult.fatalViolation.code as typeof EXECUTION_BOUNDARY_VIOLATION_CODES[keyof typeof EXECUTION_BOUNDARY_VIOLATION_CODES];
    return {
      workspaceId: opts.workspaceId,
      projectId: opts.projectId,
      projectRootRealPath: opts.canonicalRoot,
      projectRootDisplayPath: opts.displayRoot,
      projectRootSourceType: "local",
      allowedContextRoots: allowedRoots,
      excludedSensitivePaths: sensitiveSamples,
      contextFileCountLimit: opts.maxFileCount,
      contextMaxDepth: opts.maxDepth,
      contextMaxFileSizeBytes: opts.maxFileSizeBytes,
      preparedAt: new Date().toISOString(),
      preparedBy: opts.preparedBy,
      injectedFileCount: 0,
      injectedFilePaths: [],
      sensitivePathCount: contextResult.snapshot?.skippedSensitiveFiles.length ?? 0,
      sensitivePathSamples: sensitiveSamples,
      preparationSucceeded: false,
      lastViolationCode: code as never,
      lastViolationSummary: contextResult.fatalViolation.summary,
      lastViolationAt: new Date().toISOString(),
      lastViolationFatal: true,
      boundaryCurrentStage: "执行边界准备失败",
      boundaryNextStep: contextResult.fatalViolation.summary,
    };
  }

  const nonFatalViolations = contextResult.violations.filter(
    (v) => contextResult.fatalViolation === null || v.code !== contextResult.fatalViolation.code,
  );
  const lastNonFatal = nonFatalViolations[nonFatalViolations.length - 1] ?? null;

  return {
    workspaceId: opts.workspaceId,
    projectId: opts.projectId,
    projectRootRealPath: opts.canonicalRoot,
    projectRootDisplayPath: opts.displayRoot,
    projectRootSourceType: "local",
    allowedContextRoots: allowedRoots,
    excludedSensitivePaths: sensitiveSamples,
    contextFileCountLimit: opts.maxFileCount,
    contextMaxDepth: opts.maxDepth,
    contextMaxFileSizeBytes: opts.maxFileSizeBytes,
    preparedAt: new Date().toISOString(),
    preparedBy: opts.preparedBy,
    injectedFileCount: contextResult.snapshot?.injectedFiles.length ?? 0,
    injectedFilePaths: (contextResult.snapshot?.injectedFiles ?? []).slice(0, 50),
    sensitivePathCount: contextResult.snapshot?.skippedSensitiveFiles.length ?? 0,
    sensitivePathSamples: sensitiveSamples,
    preparationSucceeded: true,
    lastViolationCode: lastNonFatal
      ? (lastNonFatal.code as typeof EXECUTION_BOUNDARY_VIOLATION_CODES[keyof typeof EXECUTION_BOUNDARY_VIOLATION_CODES])
      : null,
    lastViolationSummary: lastNonFatal?.summary ?? null,
    lastViolationAt: lastNonFatal ? new Date().toISOString() : null,
    lastViolationFatal: false,
    boundaryCurrentStage: "已按项目边界准备执行环境",
    boundaryNextStep: "若需补充更多上下文，请在项目边界内显式授权。",
  };
}
