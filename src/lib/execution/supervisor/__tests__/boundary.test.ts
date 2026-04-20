/**
 * Unit tests for execution boundary profile types and helpers.
 * Tests: parseBoundaryProfile, buildFailedBoundaryProfile, buildBoundaryProfilePayload.
 */

import { describe, expect, it, vi } from "vitest";
import {
  EXECUTION_BOUNDARY_VIOLATION_CODES,
  EXECUTION_BOUNDARY_VIOLATION_LABELS,
  EXECUTION_BOUNDARY_VIOLATION_SUMMARIES,
  parseBoundaryProfile,
  buildFailedBoundaryProfile,
  buildBoundaryProfilePayload,
} from "../boundary";

describe("EXECUTION_BOUNDARY_VIOLATION_CODES", () => {
  it("contains all required violation codes", () => {
    expect(EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_UNAVAILABLE).toBe("EXECUTION_BOUNDARY_ROOT_UNAVAILABLE");
    expect(EXECUTION_BOUNDARY_VIOLATION_CODES.SCOPE_MISMATCH).toBe("EXECUTION_BOUNDARY_SCOPE_MISMATCH");
    expect(EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL).toBe("EXECUTION_BOUNDARY_PATH_TRAVERSAL");
    expect(EXECUTION_BOUNDARY_VIOLATION_CODES.SYMLINK_BLOCKED).toBe("EXECUTION_BOUNDARY_SYMLINK_BLOCKED");
    expect(EXECUTION_BOUNDARY_VIOLATION_CODES.SENSITIVE_PATH_BLOCKED).toBe("EXECUTION_BOUNDARY_SENSITIVE_PATH_BLOCKED");
    expect(EXECUTION_BOUNDARY_VIOLATION_CODES.CONTEXT_PREPARATION_FAILED).toBe("EXECUTION_CONTEXT_PREPARATION_FAILED");
    expect(EXECUTION_BOUNDARY_VIOLATION_CODES.CONTEXT_LIMIT_EXCEEDED).toBe("EXECUTION_CONTEXT_LIMIT_EXCEEDED");
    expect(EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_IS_SYMLINK).toBe("EXECUTION_BOUNDARY_ROOT_IS_SYMLINK");
    expect(EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_DRIFTED).toBe("EXECUTION_BOUNDARY_ROOT_DRIFTED");
  });
});

describe("EXECUTION_BOUNDARY_VIOLATION_LABELS", () => {
  it("has labels for all violation codes", () => {
    for (const code of Object.values(EXECUTION_BOUNDARY_VIOLATION_CODES)) {
      expect(EXECUTION_BOUNDARY_VIOLATION_LABELS[code]).toBeDefined();
      expect(typeof EXECUTION_BOUNDARY_VIOLATION_LABELS[code]).toBe("string");
      expect(EXECUTION_BOUNDARY_VIOLATION_LABELS[code].length).toBeGreaterThan(0);
    }
  });

  it("all labels are in Chinese", () => {
    for (const label of Object.values(EXECUTION_BOUNDARY_VIOLATION_LABELS)) {
      const hasChinese = /[\u4e00-\u9fa5]/.test(label);
      expect(hasChinese, `Label "${label}" should contain Chinese characters`).toBe(true);
    }
  });
});

describe("EXECUTION_BOUNDARY_VIOLATION_SUMMARIES", () => {
  it("has summaries for all violation codes", () => {
    for (const code of Object.values(EXECUTION_BOUNDARY_VIOLATION_CODES)) {
      expect(EXECUTION_BOUNDARY_VIOLATION_SUMMARIES[code]).toBeDefined();
    }
  });
});

describe("parseBoundaryProfile", () => {
  it("returns null for null input", () => {
    expect(parseBoundaryProfile(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseBoundaryProfile(undefined)).toBeNull();
  });

  it("returns null for array input", () => {
    expect(parseBoundaryProfile([])).toBeNull();
    expect(parseBoundaryProfile([{}])).toBeNull();
  });

  it("returns null when projectRootRealPath is missing", () => {
    expect(parseBoundaryProfile({})).toBeNull();
    expect(parseBoundaryProfile({ workspaceId: "ws1" })).toBeNull();
  });

  it("parses a complete boundary profile", () => {
    const metadata = {
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectRootRealPath: "/home/user/projects/my-app",
      projectRootDisplayPath: "~/projects/my-app",
      projectRootSourceType: "local",
      allowedContextRoots: ["src", "docs"],
      excludedSensitivePaths: [".env", ".ssh"],
      contextFileCountLimit: 10000,
      contextMaxDepth: 20,
      contextMaxFileSizeBytes: 10485760,
      preparedAt: "2026-04-20T10:00:00Z",
      preparedBy: "supervisor",
      injectedFileCount: 42,
      injectedFilePaths: ["src/index.ts", "src/main.ts"],
      sensitivePathCount: 3,
      sensitivePathSamples: [".env", ".ssh/config"],
      preparationSucceeded: true,
      lastViolationCode: null,
      lastViolationSummary: null,
      lastViolationAt: null,
      lastViolationFatal: false,
      boundaryCurrentStage: "已按项目边界准备执行环境",
      boundaryNextStep: "若需补充更多上下文，请在项目边界内显式授权。",
    };

    const profile = parseBoundaryProfile(metadata);
    expect(profile).not.toBeNull();
    expect(profile!.workspaceId).toBe("ws-1");
    expect(profile!.projectId).toBe("proj-1");
    expect(profile!.projectRootRealPath).toBe("/home/user/projects/my-app");
    expect(profile!.preparationSucceeded).toBe(true);
    expect(profile!.injectedFileCount).toBe(42);
    expect(profile!.sensitivePathCount).toBe(3);
    expect(profile!.lastViolationCode).toBeNull();
  });

  it("applies defaults for missing optional fields", () => {
    const metadata = {
      projectRootRealPath: "/tmp/test",
    };
    const profile = parseBoundaryProfile(metadata);
    expect(profile!.workspaceId).toBe("");
    expect(profile!.projectId).toBe("");
    expect(profile!.allowedContextRoots).toEqual([]);
    expect(profile!.contextFileCountLimit).toBe(10000);
    expect(profile!.contextMaxDepth).toBe(20);
    expect(profile!.contextMaxFileSizeBytes).toBe(10485760);
    expect(profile!.preparationSucceeded).toBe(false);
  });

  it("parses profile with violation", () => {
    const metadata = {
      projectRootRealPath: "/tmp/test",
      preparationSucceeded: false,
      lastViolationCode: "EXECUTION_BOUNDARY_SYMLINK_BLOCKED",
      lastViolationSummary: "符号链接被拦截",
      lastViolationAt: "2026-04-20T10:00:00Z",
      lastViolationFatal: true,
    };
    const profile = parseBoundaryProfile(metadata);
    expect(profile!.preparationSucceeded).toBe(false);
    expect(profile!.lastViolationCode).toBe("EXECUTION_BOUNDARY_SYMLINK_BLOCKED");
    expect(profile!.lastViolationFatal).toBe(true);
  });
});

describe("buildFailedBoundaryProfile", () => {
  it("creates a profile with failure state", () => {
    const profile = buildFailedBoundaryProfile({
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectRootRealPath: "/tmp/test",
      projectRootDisplayPath: "/tmp/test",
      violationCode: EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_IS_SYMLINK,
      preparedBy: "supervisor",
    });

    expect(profile.preparationSucceeded).toBe(false);
    expect(profile.lastViolationCode).toBe(EXECUTION_BOUNDARY_VIOLATION_CODES.ROOT_IS_SYMLINK);
    expect(profile.lastViolationFatal).toBe(true);
    expect(profile.boundaryCurrentStage).toBe("执行边界准备失败");
    expect(profile.workspaceId).toBe("ws-1");
    expect(profile.projectId).toBe("proj-1");
    expect(profile.preparedBy).toBe("supervisor");
  });

  it("sets summary from VIOLATION_SUMMARIES", () => {
    const profile = buildFailedBoundaryProfile({
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectRootRealPath: "/tmp/test",
      projectRootDisplayPath: "/tmp/test",
      violationCode: EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL,
      preparedBy: "reroute",
    });

    expect(profile.lastViolationSummary).toBe(
      EXECUTION_BOUNDARY_VIOLATION_SUMMARIES[EXECUTION_BOUNDARY_VIOLATION_CODES.PATH_TRAVERSAL]
    );
    expect(profile.preparedBy).toBe("reroute");
  });
});

describe("buildBoundaryProfilePayload", () => {
  it("creates a serializable JSON payload", () => {
    const profile = parseBoundaryProfile({
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectRootRealPath: "/home/user/project",
      projectRootDisplayPath: "~/project",
      projectRootSourceType: "local",
      allowedContextRoots: ["src"],
      excludedSensitivePaths: [".env"],
      contextFileCountLimit: 10000,
      contextMaxDepth: 20,
      contextMaxFileSizeBytes: 10485760,
      preparedAt: "2026-04-20T10:00:00Z",
      preparedBy: "supervisor",
      injectedFileCount: 5,
      injectedFilePaths: ["src/a.ts", "src/b.ts"],
      sensitivePathCount: 1,
      sensitivePathSamples: [".env"],
      preparationSucceeded: true,
      lastViolationCode: null,
      lastViolationSummary: null,
      lastViolationAt: null,
      lastViolationFatal: false,
      boundaryCurrentStage: "已按项目边界准备执行环境",
      boundaryNextStep: "若需补充更多上下文，请在项目边界内显式授权。",
    });

    expect(profile).not.toBeNull();

    const payload = buildBoundaryProfilePayload(profile!);
    expect(payload).toBeDefined();
    expect((payload as Record<string, unknown>).workspaceId).toBe("ws-1");
    expect((payload as Record<string, unknown>).projectRootRealPath).toBe("/home/user/project");
    expect((payload as Record<string, unknown>).preparationSucceeded).toBe(true);
    expect((payload as Record<string, unknown>).injectedFileCount).toBe(5);
  });
});
