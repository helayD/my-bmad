import { describe, expect, it } from "vitest";
import {
  canExecutePlanningRequest,
  canRetryPlanningExecution,
  DEFAULT_DIRECT_EXECUTION_NEXT_STEP,
  PLANNING_REQUEST_STAGE_ORDER,
  PLANNING_REQUEST_STATUS_VALUES,
  getPlanningArtifactSyncStatusLabel,
  getPlanningExecutionProgress,
  getPlanningRequestDefaultProgress,
  getPlanningRequestRouteLabel,
  getPlanningRequestStatusLabel,
  parsePlanningExecutionHandoffDraft,
  validatePlanningGoal,
} from "@/lib/planning/types";

describe("planning status metadata", () => {
  it("returns stable Chinese labels and default progress mapping", () => {
    expect(getPlanningRequestStatusLabel("analyzing")).toBe("分析中");
    expect(getPlanningRequestStatusLabel("execution-ready")).toBe("待进入执行");
    expect(getPlanningRequestDefaultProgress("analyzing")).toBe(10);
    expect(getPlanningRequestDefaultProgress("planning")).toBeGreaterThan(10);
    expect(getPlanningRequestDefaultProgress("completed")).toBe(100);
  });

  it("keeps stage order stable for status views", () => {
    expect(PLANNING_REQUEST_STAGE_ORDER).toEqual([
      "analyzing",
      "planning",
      "execution-ready",
      "awaiting-confirmation",
      "completed",
      "failed",
    ]);
    expect(PLANNING_REQUEST_STATUS_VALUES).toContain("execution-ready");
  });

  it("returns stable route and next-step labels", () => {
    expect(getPlanningRequestRouteLabel("planning")).toBe("需要先规划");
    expect(getPlanningRequestRouteLabel("direct-execution")).toBe("直接进入执行");
    expect(DEFAULT_DIRECT_EXECUTION_NEXT_STEP).toContain("执行任务定义与派发准备阶段");
  });
});

describe("validatePlanningGoal", () => {
  it("rejects blank or punctuation-only goals", () => {
    const result = validatePlanningGoal("  ...  ");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PLANNING_REQUEST_GOAL_REQUIRED");
      expect(result.message).toContain("请输入明确的目标描述");
    }
  });

  it("rejects goals that are too short", () => {
    const result = validatePlanningGoal("做功能");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PLANNING_REQUEST_GOAL_TOO_SHORT");
    }
  });

  it("accepts a clear natural-language planning goal", () => {
    const result = validatePlanningGoal("为项目添加用户反馈收集功能");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.rawGoal).toBe("为项目添加用户反馈收集功能");
    }
  });
});

describe("parsePlanningExecutionHandoffDraft", () => {
  it("returns parsed handoff draft when payload shape is valid", () => {
    expect(
      parsePlanningExecutionHandoffDraft({
        source: "planning-request",
        suggestedGoal: "修复登录页面按钮颜色",
        suggestedSummary: "修复登录页面按钮颜色",
        suggestedIntent: "fix",
        requiresRepo: true,
      }),
    ).toEqual({
      source: "planning-request",
      suggestedGoal: "修复登录页面按钮颜色",
      suggestedSummary: "修复登录页面按钮颜色",
      suggestedIntent: "fix",
      requiresRepo: true,
    });
  });

  it("returns null for invalid payloads", () => {
    expect(parsePlanningExecutionHandoffDraft({ source: "task" })).toBeNull();
    expect(parsePlanningExecutionHandoffDraft(null)).toBeNull();
  });
});

describe("planning execution helpers", () => {
  const planningRequest = {
    status: "planning" as const,
    routeType: "planning" as const,
    selectedSkillKeys: ["bmad-create-prd"],
    executionSteps: [],
  };

  it("derives execute and retry affordances from planning request state", () => {
    expect(canExecutePlanningRequest(planningRequest)).toBe(true);
    expect(
      canRetryPlanningExecution({
        status: "failed",
        routeType: "planning",
        executionSteps: [
          {
            id: "step-1",
            skillKey: "bmad-create-prd",
            stepKey: "generate-prd",
            sequence: 1,
            status: "failed",
            title: "生成 PRD 工件",
            startedAt: null,
            completedAt: null,
            failedAt: null,
            errorCode: "PLANNING_ARTIFACT_WRITE_ERROR",
            errorMessage: "失败",
            outputSummary: null,
            artifactPaths: [],
            retryCount: 0,
          },
        ],
      }),
    ).toBe(true);
  });

  it("calculates progress from completed planning steps and labels artifact sync states", () => {
    expect(
      getPlanningExecutionProgress([
        { status: "completed" },
        { status: "running" },
        { status: "pending" },
      ]),
    ).toBeGreaterThan(getPlanningRequestDefaultProgress("planning"));
    expect(getPlanningArtifactSyncStatusLabel("created")).toBe("新建");
    expect(getPlanningArtifactSyncStatusLabel("conflict")).toBe("冲突");
  });
});
