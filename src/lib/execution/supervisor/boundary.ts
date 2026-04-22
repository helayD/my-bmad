/**
 * Execution Boundary module — defines the boundary profile, violation codes,
 * and the core prepare/validate contract used by the supervisor.
 *
 * Architecture (§4.6 Task 1):
 * - ExecutionBoundaryProfile is the canonical truth stored in ExecutionSession.metadata.
 * - Violation codes are shared constants consumed by audit, errors, and UI — NOT buried in throw messages.
 * - Boundary state (projectRoot, contextSummary, violations) lives on the relation (Session),
 *   not duplicated in Task.metadata or AgentRun.metadata.
 */

import type { Prisma } from "@/generated/prisma/client";
import type { ExecutionQueueSnapshot } from "@/lib/tasks/types";

// ── Violation codes ───────────────────────────────────────────────────────────────────

/**
 * All platform-detectable boundary violations.
 * Consumed by: audit builders, error codes, UI labels, session summaries.
 * NOT used as raw throw messages — always translated through a label map.
 */
export const EXECUTION_BOUNDARY_VIOLATION_CODES = {
  /** Project root directory is unavailable or inaccessible. */
  ROOT_UNAVAILABLE: "EXECUTION_BOUNDARY_ROOT_UNAVAILABLE",
  /** Execution scope (workspace/project) does not match the task context. */
  SCOPE_MISMATCH: "EXECUTION_BOUNDARY_SCOPE_MISMATCH",
  /** A path traversal attempt (../, absolute path) was blocked. */
  PATH_TRAVERSAL: "EXECUTION_BOUNDARY_PATH_TRAVERSAL",
  /** A symlink was encountered in a controlled path and blocked. */
  SYMLINK_BLOCKED: "EXECUTION_BOUNDARY_SYMLINK_BLOCKED",
  /** A sensitive path (.env, .key, .ssh, etc.) was detected and blocked. */
  SENSITIVE_PATH_BLOCKED: "EXECUTION_BOUNDARY_SENSITIVE_PATH_BLOCKED",
  /** Context file preparation failed (scan error, limit exceeded). */
  CONTEXT_PREPARATION_FAILED: "EXECUTION_CONTEXT_PREPARATION_FAILED",
  /** Context limits (file count, depth, size) were exceeded. */
  CONTEXT_LIMIT_EXCEEDED: "EXECUTION_CONTEXT_LIMIT_EXCEEDED",
  /** Canonical project root is itself a symlink — not allowed. */
  ROOT_IS_SYMLINK: "EXECUTION_BOUNDARY_ROOT_IS_SYMLINK",
  /** Canonical project root resolves outside the expected repo boundary. */
  ROOT_DRIFTED: "EXECUTION_BOUNDARY_ROOT_DRIFTED",
} as const;

export type ExecutionBoundaryViolationCode =
  (typeof EXECUTION_BOUNDARY_VIOLATION_CODES)[keyof typeof EXECUTION_BOUNDARY_VIOLATION_CODES];

export const EXECUTION_BOUNDARY_VIOLATION_LABELS: Record<ExecutionBoundaryViolationCode, string> = {
  [EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_UNAVAILABLE]: "执行根目录不可用",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.SCOPE_MISMATCH]: "执行作用域与任务上下文不匹配",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL]: "路径穿越尝试被拦截",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.SYMLINK_BLOCKED]: "符号链接被拦截",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.SENSITIVE_PATH_BLOCKED]: "敏感路径被拦截",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.CONTEXT_PREPARATION_FAILED]: "上下文准备失败",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.CONTEXT_LIMIT_EXCEEDED]: "上下文规模超出限制",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_IS_SYMLINK]: "执行根目录本身是符号链接",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_DRIFTED]: "执行根目录已偏离预期仓库范围",
};

export const EXECUTION_BOUNDARY_VIOLATION_SUMMARIES: Partial<Record<ExecutionBoundaryViolationCode, string>> = {
  [EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_UNAVAILABLE]: "系统无法访问项目根目录，任务无法启动。",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.SCOPE_MISMATCH]: "任务的执行上下文与实际工作空间/项目不匹配。",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL]: "检测到路径穿越尝试，系统已拦截受控路径外的访问请求。",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.SYMLINK_BLOCKED]: "检测到符号链接，系统拒绝跟随符号链接访问。",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.SENSITIVE_PATH_BLOCKED]: "检测到敏感文件，系统已跳过该文件。",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.CONTEXT_PREPARATION_FAILED]: "上下文准备过程遇到错误，无法完成。",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.CONTEXT_LIMIT_EXCEEDED]: "上下文规模超出系统限制。",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_IS_SYMLINK]: "项目根目录本身是符号链接，这会破坏路径边界约束。",
  [EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_DRIFTED]: "规范化后的根目录已不在预期的仓库范围内。",
};

// ── Boundary Profile ───────────────────────────────────────────────────────────────────

export interface ExecutionBoundaryProfile {
  /** Workspace identity for scope verification. */
  workspaceId: string;
  /** Project identity for scope verification. */
  projectId: string;
  /** Canonical realpath of the project root (always resolved, never a symlink). */
  projectRootRealPath: string;
  /** User-configured localPath (lexical, for display only). */
  projectRootDisplayPath: string;
  /** How the root was resolved: "local" | "canonical". */
  projectRootSourceType: string;
  /** Allowed root directories for context injection (allowlist). */
  allowedContextRoots: string[];
  /** Paths excluded from context injection (sensitive paths). */
  excludedSensitivePaths: string[];
  /** Soft context limits — scanner respects these. */
  contextFileCountLimit: number;
  contextMaxDepth: number;
  contextMaxFileSizeBytes: number;
  /** When this profile was prepared (ISO string). */
  preparedAt: string;
  /** Who/what prepared it: "supervisor" | "admission" | "reroute". */
  preparedBy: "supervisor" | "admission" | "reroute";
  /** Summary of injected context files. */
  injectedFileCount: number;
  injectedFilePaths: string[];
  /** Number of sensitive paths skipped. */
  sensitivePathCount: number;
  sensitivePathSamples: string[];
  /** Whether boundary preparation succeeded. */
  preparationSucceeded: boolean;
  /** Most recent violation (if any). Non-fatal unless isFatal=true. */
  lastViolationCode: ExecutionBoundaryViolationCode | null;
  lastViolationSummary: string | null;
  lastViolationAt: string | null;
  /** Whether this violation is fatal (blocks launch). */
  lastViolationFatal: boolean;
  /** Human-readable current stage describing boundary state. */
  boundaryCurrentStage: string;
  /** Next step hint for the user. */
  boundaryNextStep: string;
}

export interface ExecutionBoundaryViolation {
  code: ExecutionBoundaryViolationCode;
  requestedPath: string;
  resolvedPath: string;
  isFatal: boolean;
  summary: string;
  occurredAt: string;
}

export interface ExecutionContextSnapshot {
  /** Files that passed all checks and can be safely injected. */
  injectedFiles: string[];
  /** Files that were skipped due to sensitive path matches. */
  skippedSensitiveFiles: string[];
  /** Files that were skipped due to size/depth/count limits. */
  skippedOversizedFiles: string[];
  /** Total files considered before filtering. */
  totalCandidates: number;
  /** Resolved canonical root used. */
  canonicalRoot: string;
}

// ── Builder helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a boundary profile snapshot for storage in ExecutionSession.metadata.
 * Only the summary fields are stored — no full file lists or environment content.
 */
export function buildBoundaryProfilePayload(
  profile: ExecutionBoundaryProfile,
): Prisma.InputJsonValue {
  return {
    workspaceId: profile.workspaceId,
    projectId: profile.projectId,
    projectRootRealPath: profile.projectRootRealPath,
    projectRootDisplayPath: profile.projectRootDisplayPath,
    projectRootSourceType: profile.projectRootSourceType,
    allowedContextRoots: profile.allowedContextRoots,
    excludedSensitivePaths: profile.excludedSensitivePaths,
    contextFileCountLimit: profile.contextFileCountLimit,
    contextMaxDepth: profile.contextMaxDepth,
    contextMaxFileSizeBytes: profile.contextMaxFileSizeBytes,
    preparedAt: profile.preparedAt,
    preparedBy: profile.preparedBy,
    injectedFileCount: profile.injectedFileCount,
    injectedFilePaths: profile.injectedFilePaths,
    sensitivePathCount: profile.sensitivePathCount,
    sensitivePathSamples: profile.sensitivePathSamples,
    preparationSucceeded: profile.preparationSucceeded,
    lastViolationCode: profile.lastViolationCode,
    lastViolationSummary: profile.lastViolationSummary,
    lastViolationAt: profile.lastViolationAt,
    lastViolationFatal: profile.lastViolationFatal,
    boundaryCurrentStage: profile.boundaryCurrentStage,
    boundaryNextStep: profile.boundaryNextStep,
  } as unknown as Prisma.InputJsonValue;
}

/**
 * Parse boundary profile from ExecutionSession.metadata.
 * Returns null if the session has no boundary data.
 */
export function parseBoundaryProfile(
  metadata: unknown,
): ExecutionBoundaryProfile | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  if (!record?.projectRootRealPath) {
    return null;
  }
  return {
    workspaceId: (record.workspaceId as string) ?? "",
    projectId: (record.projectId as string) ?? "",
    projectRootRealPath: (record.projectRootRealPath as string) ?? "",
    projectRootDisplayPath: (record.projectRootDisplayPath as string) ?? "",
    projectRootSourceType: (record.projectRootSourceType as string) ?? "local",
    allowedContextRoots: (record.allowedContextRoots as string[]) ?? [],
    excludedSensitivePaths: (record.excludedSensitivePaths as string[]) ?? [],
    contextFileCountLimit: (record.contextFileCountLimit as number) ?? 10_000,
    contextMaxDepth: (record.contextMaxDepth as number) ?? 20,
    contextMaxFileSizeBytes: (record.contextMaxFileSizeBytes as number) ?? 10 * 1024 * 1024,
    preparedAt: (record.preparedAt as string) ?? "",
    preparedBy: (record.preparedBy as "supervisor" | "admission" | "reroute") ?? "supervisor",
    injectedFileCount: (record.injectedFileCount as number) ?? 0,
    injectedFilePaths: (record.injectedFilePaths as string[]) ?? [],
    sensitivePathCount: (record.sensitivePathCount as number) ?? 0,
    sensitivePathSamples: (record.sensitivePathSamples as string[]) ?? [],
    preparationSucceeded: (record.preparationSucceeded as boolean) ?? false,
    lastViolationCode: (record.lastViolationCode as ExecutionBoundaryViolationCode | null) ?? null,
    lastViolationSummary: (record.lastViolationSummary as string | null) ?? null,
    lastViolationAt: (record.lastViolationAt as string | null) ?? null,
    lastViolationFatal: (record.lastViolationFatal as boolean) ?? false,
    boundaryCurrentStage: (record.boundaryCurrentStage as string) ?? "",
    boundaryNextStep: (record.boundaryNextStep as string) ?? "",
  };
}

/**
 * Create a boundary profile with default/empty values for a failed preparation.
 */
export function buildFailedBoundaryProfile(opts: {
  workspaceId: string;
  projectId: string;
  projectRootRealPath: string;
  projectRootDisplayPath: string;
  violationCode: ExecutionBoundaryViolationCode;
  preparedBy: "supervisor" | "admission" | "reroute";
}): ExecutionBoundaryProfile {
  const summary = EXECUTION_BOUNDARY_VIOLATION_SUMMARIES[opts.violationCode] ?? "执行边界准备失败。";
  return {
    workspaceId: opts.workspaceId,
    projectId: opts.projectId,
    projectRootRealPath: opts.projectRootRealPath,
    projectRootDisplayPath: opts.projectRootDisplayPath,
    projectRootSourceType: "local",
    allowedContextRoots: [],
    excludedSensitivePaths: [],
    contextFileCountLimit: 10_000,
    contextMaxDepth: 20,
    contextMaxFileSizeBytes: 10 * 1024 * 1024,
    preparedAt: new Date().toISOString(),
    preparedBy: opts.preparedBy,
    injectedFileCount: 0,
    injectedFilePaths: [],
    sensitivePathCount: 0,
    sensitivePathSamples: [],
    preparationSucceeded: false,
    lastViolationCode: opts.violationCode,
    lastViolationSummary: summary,
    lastViolationAt: new Date().toISOString(),
    lastViolationFatal: true,
    boundaryCurrentStage: "执行边界准备失败",
    boundaryNextStep: "请检查项目根目录配置后重试，或联系管理员排查。",
  };
}

// ── Execution Queue snapshot helpers ──────────────────────────────────────────────────

/**
 * Parse an ExecutionQueueSnapshot from task metadata.
 * Pure function — safe for both server and client contexts.
 */
export function parseExecutionQueueSnapshot(
  metadata: unknown,
): ExecutionQueueSnapshot {
  const record = toRecord(metadata);
  const snap = toRecord(record?.executionQueue);
  const queuePosition = typeof snap?.queuePosition === "number" ? snap.queuePosition : null;
  const queuedAt = typeof snap?.queuedAt === "string" ? snap.queuedAt : null;
  const workspaceActive = typeof snap?.workspaceActiveConcurrentTasks === "number" ? snap.workspaceActiveConcurrentTasks : 0;
  const projectActive = typeof snap?.projectActiveConcurrentTasks === "number" ? snap.projectActiveConcurrentTasks : 0;
  const maxConcurrent = typeof snap?.maxConcurrentTasks === "number" ? snap.maxConcurrentTasks : 5;
  const estimatedSeconds = typeof snap?.estimatedWaitSeconds === "number" ? snap.estimatedWaitSeconds : null;
  const estimatedLabel = typeof snap?.estimatedWaitLabel === "string" ? snap.estimatedWaitLabel : null;
  const reasonCode = normalizeQueueReasonCode(snap?.queueReasonCode);
  const reasonSummary = typeof snap?.queueReasonSummary === "string" ? snap.queueReasonSummary : "";

  return {
    queuePosition,
    queuedAt,
    workspaceActiveConcurrentTasks: workspaceActive,
    projectActiveConcurrentTasks: projectActive,
    maxConcurrentTasks: maxConcurrent,
    estimatedWaitSeconds: estimatedSeconds,
    estimatedWaitLabel: estimatedLabel,
    queueReasonCode: reasonCode,
    queueReasonSummary: reasonSummary,
  };
}

function normalizeQueueReasonCode(value: unknown): ExecutionQueueSnapshot["queueReasonCode"] {
  const validCodes: ExecutionQueueSnapshot["queueReasonCode"][] = [
    "WORKSPACE_CAPACITY_FULL",
    "PROJECT_ISOLATION",
    "ADMISSION_IN_PROGRESS",
    "ALREADY_QUEUED",
  ];
  if (typeof value === "string" && validCodes.includes(value as ExecutionQueueSnapshot["queueReasonCode"])) {
    return value as ExecutionQueueSnapshot["queueReasonCode"];
  }
  return "WORKSPACE_CAPACITY_FULL";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
