import { describe, expect, it } from "vitest";
import {
  PLANNING_REQUEST_STAGE_ORDER,
  getPlanningRequestDefaultProgress,
  getPlanningRequestStatusLabel,
  validatePlanningGoal,
} from "@/lib/planning/types";

describe("planning status metadata", () => {
  it("returns stable Chinese labels and default progress mapping", () => {
    expect(getPlanningRequestStatusLabel("analyzing")).toBe("分析中");
    expect(getPlanningRequestStatusLabel("awaiting-confirmation")).toBe("待确认");
    expect(getPlanningRequestDefaultProgress("analyzing")).toBe(10);
    expect(getPlanningRequestDefaultProgress("planning")).toBeGreaterThan(10);
    expect(getPlanningRequestDefaultProgress("completed")).toBe(100);
  });

  it("keeps stage order stable for status views", () => {
    expect(PLANNING_REQUEST_STAGE_ORDER).toEqual([
      "analyzing",
      "planning",
      "awaiting-confirmation",
      "completed",
      "failed",
    ]);
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
