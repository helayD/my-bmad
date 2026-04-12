import { describe, expect, it } from "vitest";
import { analyzePlanningIntent } from "@/lib/planning/intent";

describe("analyzePlanningIntent", () => {
  it("routes new feature goals to planning with default PM pipeline", () => {
    const result = analyzePlanningIntent({
      rawGoal: "为项目添加用户反馈收集功能",
      hasRepo: true,
      projectSummary: "Demo Project",
    });

    expect(result.routeType).toBe("planning");
    expect(result.status).toBe("planning");
    expect(result.selectionReasonCode).toBe("new-feature-or-product-scope");
    expect(result.selectedAgentKeys).toEqual(["bmad-agent-pm"]);
    expect(result.selectedSkillKeys).toEqual([
      "bmad-create-prd",
      "bmad-create-epics-and-stories",
    ]);
  });

  it("routes narrow bug fixes with repo context to direct execution", () => {
    const result = analyzePlanningIntent({
      rawGoal: "修复登录页面的按钮颜色",
      hasRepo: true,
      projectSummary: "Demo Project",
    });

    expect(result.routeType).toBe("direct-execution");
    expect(result.status).toBe("execution-ready");
    expect(result.selectionReasonCode).toBe("small-scoped-repo-change");
    expect(result.selectedAgentKeys).toEqual([]);
    expect(result.selectedSkillKeys).toEqual([]);
    expect(result.executionHandoffDraft?.suggestedIntent).toBe("fix");
  });

  it("falls back to planning when repo context is missing", () => {
    const result = analyzePlanningIntent({
      rawGoal: "修复登录页面的按钮颜色",
      hasRepo: false,
      projectSummary: "Demo Project",
    });

    expect(result.routeType).toBe("planning");
    expect(result.selectionReasonCode).toBe("repo-missing-for-direct-execution");
    expect(result.selectedSkillKeys).toEqual([
      "bmad-create-prd",
      "bmad-create-epics-and-stories",
    ]);
  });

  it("adds architect and architecture skill for architecture-heavy requests", () => {
    const result = analyzePlanningIntent({
      rawGoal: "规划新的权限架构和外部系统集成方案",
      hasRepo: true,
      projectSummary: "Demo Project",
    });

    expect(result.routeType).toBe("planning");
    expect(result.selectionReasonCode).toBe("architecture-or-integration-design");
    expect(result.selectedAgentKeys).toEqual([
      "bmad-agent-pm",
      "bmad-agent-architect",
    ]);
    expect(result.selectedSkillKeys).toEqual([
      "bmad-create-prd",
      "bmad-create-architecture",
      "bmad-create-epics-and-stories",
    ]);
  });

  it("defaults ambiguous goals to planning", () => {
    const result = analyzePlanningIntent({
      rawGoal: "优化整体体验并梳理后续方向",
      hasRepo: true,
      projectSummary: "Demo Project",
    });

    expect(result.routeType).toBe("planning");
    expect(result.selectionReasonCode).toBe("goal-is-ambiguous");
    expect(result.executionHandoffDraft).toBeNull();
  });
});
