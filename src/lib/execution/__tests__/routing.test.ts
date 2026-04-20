import { describe, expect, it } from "vitest";
import { buildTaskRoutingDecisionSummary, resolveTaskRoutingDecision } from "../routing";

const baseWorkspaceSettings = {
  agentRoutingPreference: "auto" as const,
  maxConcurrentTasks: 5,
  autoRecoveryEnabled: true,
  requireApprovalBeforeExecution: false,
  autoDispatchAfterPlanning: false,
};

const baseTask = {
  goal: "补齐任务执行入口",
  summary: "范围明确，适合直接编码",
  intent: "implement",
  intentDetail: null,
  preferredAgentType: null,
  metadata: {},
};

describe("resolveTaskRoutingDecision", () => {
  it("uses explicit dispatch selection as the highest priority", () => {
    const decision = resolveTaskRoutingDecision({
      task: baseTask,
      workspaceSettings: baseWorkspaceSettings,
      projectSettings: {},
      explicitAgentType: "codex",
      reasonContext: "dispatch",
    });

    expect(decision).toEqual({
      kind: "selected",
      selectedAgentType: "codex",
      decisionSource: "manual-selection",
      selectionReasonCode: "manual-selection",
      selectionReasonSummary: "已按你的显式选择派发到 Codex。",
      matchedSignals: ["explicit:codex"],
    });
  });

  it("marks explicit reroute as manual-reroute", () => {
    const decision = resolveTaskRoutingDecision({
      task: baseTask,
      workspaceSettings: baseWorkspaceSettings,
      projectSettings: {},
      explicitAgentType: "claude-code",
      reasonContext: "reroute",
    });

    expect(decision).toMatchObject({
      kind: "selected",
      selectedAgentType: "claude-code",
      decisionSource: "manual-reroute",
      selectionReasonCode: "manual-reroute",
    });
  });

  it("honors task preferred agent before project default", () => {
    const decision = resolveTaskRoutingDecision({
      task: {
        ...baseTask,
        preferredAgentType: "claude-code",
      },
      workspaceSettings: baseWorkspaceSettings,
      projectSettings: {
        defaultAgentType: "codex",
      },
    });

    expect(decision).toMatchObject({
      kind: "selected",
      selectedAgentType: "claude-code",
      decisionSource: "task-preference",
    });
  });

  it("requires manual selection when workspace governance disables auto routing", () => {
    const decision = resolveTaskRoutingDecision({
      task: {
        ...baseTask,
        summary: "需要先输出重构方案并梳理架构。",
      },
      workspaceSettings: {
        ...baseWorkspaceSettings,
        agentRoutingPreference: "manual",
      },
      projectSettings: {},
    });

    expect(decision).toMatchObject({
      kind: "selection-required",
      recommendedAgentType: "claude-code",
      recommendationSource: "intent-heuristic",
      selectionReasonCode: "manual-selection-required",
    });
  });

  it("uses project default agent when configured", () => {
    const decision = resolveTaskRoutingDecision({
      task: baseTask,
      workspaceSettings: baseWorkspaceSettings,
      projectSettings: {
        defaultAgentType: "claude-code",
      },
    });

    expect(decision).toMatchObject({
      kind: "selected",
      selectedAgentType: "claude-code",
      decisionSource: "project-default",
      matchedSignals: ["project-default:claude-code"],
    });
  });

  it("falls back to heuristic signals for analysis-heavy tasks", () => {
    const decision = resolveTaskRoutingDecision({
      task: {
        ...baseTask,
        summary: "需要先调研、分析并整理设计方案。",
        metadata: {
          sourceContext: {
            artifactName: "Story 4.3",
            hierarchy: [{ id: "story-43", type: "STORY", name: "路由策略调整" }],
          },
        },
      },
      workspaceSettings: baseWorkspaceSettings,
      projectSettings: {},
    });

    expect(decision).toMatchObject({
      kind: "selected",
      selectedAgentType: "claude-code",
      decisionSource: "intent-heuristic",
      selectionReasonCode: "heuristic-claude-code",
    });
    expect(decision.matchedSignals).toContain("claude:keyword:调研");
  });
});

describe("buildTaskRoutingDecisionSummary", () => {
  it("builds a stable routing summary with reroute extras", () => {
    const summary = buildTaskRoutingDecisionSummary({
      kind: "selected",
      selectedAgentType: "claude-code",
      decisionSource: "manual-reroute",
      selectionReasonCode: "manual-reroute",
      selectionReasonSummary: "当前任务更适合先做方案分析。",
      matchedSignals: ["explicit:claude-code"],
    }, {
      agentRunId: "run-current",
      replacedAgentRunId: "run-previous",
      reroutedAt: "2026-04-14T03:00:00.000Z",
    });

    expect(summary).toEqual({
      selectedAgentType: "claude-code",
      decisionSource: "manual-reroute",
      selectionReasonCode: "manual-reroute",
      selectionReasonSummary: "当前任务更适合先做方案分析。",
      matchedSignals: ["explicit:claude-code"],
      agentRunId: "run-current",
      replacedAgentRunId: "run-previous",
      routedAt: null,
      reroutedAt: "2026-04-14T03:00:00.000Z",
    });
  });
});
