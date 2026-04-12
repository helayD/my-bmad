import { describe, expect, it } from "vitest";
import {
  canConfirmPlanningRequest,
  canExecutePlanningRequest,
  canRetryPlanningExecution,
  DEFAULT_DIRECT_EXECUTION_NEXT_STEP,
  doesPlanningRequestMatchStatusFilter,
  PLANNING_REQUEST_STAGE_ORDER,
  PLANNING_REQUEST_STATUS_VALUES,
  getPlanningStatusFilterLabel,
  getPlanningArtifactSyncStatusLabel,
  getPlanningHandoffDispatchModeLabel,
  getPlanningExecutionProgress,
  getPlanningRequestDefaultProgress,
  getPlanningRequestRouteLabel,
  getPlanningRequestStatusLabel,
  parsePlanningStatusFilter,
  parsePlanningExecutionHandoffDraft,
  parsePlanningTaskHandoffSummary,
  resolvePlanningRequestProblemSummary,
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

  it("parses planning status filters and keeps Chinese labels stable", () => {
    expect(parsePlanningStatusFilter("planning")).toBe("planning");
    expect(parsePlanningStatusFilter("unknown")).toBe("all");
    expect(getPlanningStatusFilterLabel("all")).toBe("全部");
    expect(getPlanningStatusFilterLabel("awaiting-confirmation")).toBe("待确认");
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
      canConfirmPlanningRequest({
        status: "awaiting-confirmation",
        routeType: "planning",
      }),
    ).toBe(true);
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
    expect(getPlanningHandoffDispatchModeLabel("auto")).toBe("自动派发准备");
  });

  it("parses planning handoff summary payloads safely", () => {
    expect(
      parsePlanningTaskHandoffSummary({
        source: "planning-request-handoff",
        confirmedAt: "2026-04-12T05:00:00.000Z",
        dispatchMode: "manual",
        approvalRequired: false,
        candidateTaskCount: 2,
        createdTaskCount: 1,
        deferredArtifactCount: 1,
        deduplicatedTaskCount: 0,
        createdTasks: [
          {
            taskId: "task-1",
            taskTitle: "Task《落地用户反馈入口》",
            sourceArtifactId: "artifact-task-1",
            sourceArtifactName: "落地用户反馈入口",
            sourceArtifactPath: "_bmad-output/implementation-artifacts/3-4-story.md#task-1",
            storyArtifactId: "artifact-story-1",
            storyTitle: "Story 3.4",
            priority: "high",
            intent: "implement",
            status: "planned",
            currentStage: "已计划",
            nextStep: "等待手动派发。",
            queuePosition: 1,
            readyState: "manual",
          },
        ],
        deferredArtifacts: [
          {
            artifactId: "artifact-task-2",
            artifactType: "TASK",
            artifactName: "补齐确认后反馈",
            filePath: "_bmad-output/implementation-artifacts/3-4-story.md#task-2",
            storyArtifactId: "artifact-story-1",
            storyTitle: "Story 3.4",
            deferredBy: "task",
          },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        dispatchMode: "manual",
        createdTaskCount: 1,
        deferredArtifactCount: 1,
      }),
    );
  });

  it("matches requests against the selected status filter", () => {
    expect(
      doesPlanningRequestMatchStatusFilter(
        { status: "planning" },
        "all",
      ),
    ).toBe(true);
    expect(
      doesPlanningRequestMatchStatusFilter(
        { status: "planning" },
        "planning",
      ),
    ).toBe(true);
    expect(
      doesPlanningRequestMatchStatusFilter(
        { status: "planning" },
        "failed",
      ),
    ).toBe(false);
  });

  it("resolves stalled, failed and execution-ready problem stages consistently", () => {
    expect(
      resolvePlanningRequestProblemSummary({
        status: "analyzing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        routeType: null,
        nextStep: "等待系统识别规划意图并选择 PM Agent 与 Skills",
        selectionReasonSummary: null,
        executionSteps: [],
        derivedTaskCount: 0,
        taskHandoffSummary: null,
      }),
    ).toBeNull();

    expect(
      resolvePlanningRequestProblemSummary({
        status: "analyzing",
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
        routeType: null,
        nextStep: "等待系统识别规划意图并选择 PM Agent 与 Skills",
        selectionReasonSummary: null,
        executionSteps: [],
        derivedTaskCount: 0,
        taskHandoffSummary: null,
      }),
    ).toEqual(
      expect.objectContaining({
        stage: "analysis-stalled",
        nextAction: "继续分析",
      }),
    );

    expect(
      resolvePlanningRequestProblemSummary({
        status: "failed",
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
        routeType: "planning",
        nextStep: "规划执行在某一步失败。",
        selectionReasonSummary: null,
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
            errorMessage: "规划工件写入失败，请检查仓库连接或本地目录权限后重试。",
            outputSummary: null,
            artifactPaths: [],
            retryCount: 0,
          },
        ],
        derivedTaskCount: 0,
        taskHandoffSummary: null,
      }),
    ).toEqual(
      expect.objectContaining({
        stage: "execution-failed",
        nextAction: "重试失败步骤",
      }),
    );

    expect(
      resolvePlanningRequestProblemSummary({
        status: "execution-ready",
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
        routeType: "direct-execution",
        nextStep: "将跳过 BMAD 规划，进入执行任务定义与派发准备阶段。",
        selectionReasonSummary: "目标已明确为小范围代码改动。",
        executionSteps: [],
        derivedTaskCount: 0,
        taskHandoffSummary: null,
      }),
    ).toEqual(
      expect.objectContaining({
        stage: "execution-ready",
        title: "直接进入执行准备",
      }),
    );

    expect(
      resolvePlanningRequestProblemSummary({
        status: "analyzing",
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: new Date().toISOString(),
        routeType: null,
        nextStep: "等待系统识别规划意图并选择 PM Agent 与 Skills",
        selectionReasonSummary: null,
        executionSteps: [],
        derivedTaskCount: 0,
        taskHandoffSummary: null,
      }),
    ).toBeNull();
  });
});
