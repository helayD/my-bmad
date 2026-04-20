import {
  type TaskAgentType,
  type TaskPreferredAgentType,
  type TaskRoutingDecisionSource,
  type TaskRoutingDecisionSummary,
} from "@/lib/tasks";
import type { WorkspaceGovernanceSettingsInput } from "@/lib/workspace/types";
import { resolveProjectDefaultAgentType } from "@/lib/projects/settings";
import { isTaskAgentType } from "./catalog";

export interface TaskRoutingInput {
  task: {
    goal: string;
    summary: string;
    intent: string;
    intentDetail?: string | null;
    preferredAgentType?: string | null;
    metadata?: unknown;
  };
  workspaceSettings: WorkspaceGovernanceSettingsInput;
  projectSettings: unknown;
  explicitAgentType?: TaskAgentType;
  reasonContext?: "dispatch" | "reroute";
}

export interface TaskRoutingSelectedDecision {
  kind: "selected";
  selectedAgentType: TaskAgentType;
  decisionSource: TaskRoutingDecisionSource;
  selectionReasonCode: string;
  selectionReasonSummary: string;
  matchedSignals: string[];
}

export interface TaskRoutingSelectionRequiredDecision {
  kind: "selection-required";
  recommendedAgentType: TaskAgentType;
  recommendationSource: Exclude<TaskRoutingDecisionSource, "manual-selection" | "manual-reroute">;
  selectionReasonCode: string;
  selectionReasonSummary: string;
  matchedSignals: string[];
}

export type TaskRoutingDecision =
  | TaskRoutingSelectedDecision
  | TaskRoutingSelectionRequiredDecision;

const CLAUDE_SIGNALS = [
  "调研",
  "探索",
  "方案",
  "架构",
  "设计",
  "分析",
  "analysis",
  "design",
  "refactor",
  "重构",
];

export function resolveTaskRoutingDecision(input: TaskRoutingInput): TaskRoutingDecision {
  const explicitAgentType = input.explicitAgentType;
  if (explicitAgentType) {
    const decisionSource = input.reasonContext === "reroute"
      ? "manual-reroute"
      : "manual-selection";
    const selectionReasonSummary = input.reasonContext === "reroute"
      ? `已按你的重新派发选择改派到 ${explicitAgentType === "codex" ? "Codex" : "Claude Code"}。`
      : `已按你的显式选择派发到 ${explicitAgentType === "codex" ? "Codex" : "Claude Code"}。`;

    return {
      kind: "selected",
      selectedAgentType: explicitAgentType,
      decisionSource,
      selectionReasonCode: decisionSource,
      selectionReasonSummary,
      matchedSignals: [`explicit:${explicitAgentType}`],
    };
  }

  const preferredAgentType = normalizePreferredAgentType(input.task.preferredAgentType);
  if (preferredAgentType && preferredAgentType !== "auto") {
    return {
      kind: "selected",
      selectedAgentType: preferredAgentType,
      decisionSource: "task-preference",
      selectionReasonCode: "task-preference",
      selectionReasonSummary: "任务已声明偏好 Agent，系统按该偏好完成路由。",
      matchedSignals: [`task-preference:${preferredAgentType}`],
    };
  }

  const recommended = resolveRecommendedAgentSelection(input);
  if (input.workspaceSettings.agentRoutingPreference === "manual") {
    return {
      kind: "selection-required",
      recommendedAgentType: recommended.agentType,
      recommendationSource: recommended.source,
      selectionReasonCode: "manual-selection-required",
      selectionReasonSummary: "当前工作空间要求人工指定 Agent。系统已给出推荐，但不会自动派发。",
      matchedSignals: recommended.matchedSignals,
    };
  }

  return {
    kind: "selected",
    selectedAgentType: recommended.agentType,
    decisionSource: recommended.source,
    selectionReasonCode: recommended.reasonCode,
    selectionReasonSummary: recommended.reasonSummary,
    matchedSignals: recommended.matchedSignals,
  };
}

export function buildTaskRoutingDecisionSummary(
  decision: TaskRoutingSelectedDecision,
  extras?: {
    agentRunId?: string | null;
    replacedAgentRunId?: string | null;
    routedAt?: string | null;
    reroutedAt?: string | null;
  },
): TaskRoutingDecisionSummary {
  return {
    selectedAgentType: decision.selectedAgentType,
    decisionSource: decision.decisionSource,
    selectionReasonCode: decision.selectionReasonCode,
    selectionReasonSummary: decision.selectionReasonSummary,
    matchedSignals: decision.matchedSignals,
    agentRunId: extras?.agentRunId ?? null,
    replacedAgentRunId: extras?.replacedAgentRunId ?? null,
    routedAt: extras?.routedAt ?? null,
    reroutedAt: extras?.reroutedAt ?? null,
  };
}

function resolveRecommendedAgentSelection(input: TaskRoutingInput): {
  agentType: TaskAgentType;
  source: Exclude<TaskRoutingDecisionSource, "manual-selection" | "manual-reroute" | "task-preference">;
  reasonCode: string;
  reasonSummary: string;
  matchedSignals: string[];
} {
  const projectDefaultAgentType = resolveProjectDefaultAgentType(input.projectSettings);
  if (projectDefaultAgentType) {
    return {
      agentType: projectDefaultAgentType,
      source: "project-default",
      reasonCode: "project-default-agent",
      reasonSummary: "项目配置了默认执行 Agent，系统按项目偏好完成路由。",
      matchedSignals: [`project-default:${projectDefaultAgentType}`],
    };
  }

  const matchedSignals = collectHeuristicSignals(input.task);
  const agentType = matchedSignals.some((signal) => signal.startsWith("claude:"))
    ? "claude-code"
    : "codex";

  return {
    agentType,
    source: "intent-heuristic",
    reasonCode: agentType === "codex" ? "heuristic-codex" : "heuristic-claude-code",
    reasonSummary: agentType === "codex"
      ? "系统根据任务意图与上下文判断该任务更适合直接编码落地。"
      : "系统根据任务意图与上下文判断该任务更适合先做分析、设计或重构。",
    matchedSignals,
  };
}

function collectHeuristicSignals(task: TaskRoutingInput["task"]): string[] {
  const signals: string[] = [];
  const searchableText = [
    task.goal,
    task.summary,
    task.intentDetail ?? "",
    extractSourceContextText(task.metadata),
  ]
    .join("\n")
    .toLowerCase();

  if (task.intent === "research") {
    signals.push("claude:intent-research");
  }

  if (task.intent === "fix") {
    signals.push("codex:intent-fix");
  }

  if (task.intent === "implement") {
    signals.push("codex:intent-implement");
  }

  for (const keyword of CLAUDE_SIGNALS) {
    if (searchableText.includes(keyword.toLowerCase())) {
      signals.push(`claude:keyword:${keyword}`);
    }
  }

  if (signals.length === 0) {
    signals.push("codex:default-fallback");
  }

  return [...new Set(signals)];
}

function extractSourceContextText(metadata: unknown): string {
  const record = toRecord(metadata);
  const sourceContext = toRecord(record.sourceContext);
  const hierarchy = Array.isArray(sourceContext.hierarchy)
    ? sourceContext.hierarchy
        .map((item) => toRecord(item).name)
        .filter((value): value is string => typeof value === "string")
    : [];

  return [
    sourceContext.artifactName,
    sourceContext.filePath,
    ...hierarchy,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function normalizePreferredAgentType(value: unknown): TaskPreferredAgentType | null {
  if (typeof value !== "string") {
    return null;
  }

  return value === "auto" || isTaskAgentType(value) ? value : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
