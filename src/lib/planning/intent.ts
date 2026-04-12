import {
  ARCHITECTURE_PLANNING_AGENT_PIPELINE,
  ARCHITECTURE_PLANNING_SKILL_PIPELINE,
  DEFAULT_PLANNING_AGENT_PIPELINE,
  DEFAULT_PLANNING_SKILL_PIPELINE,
} from "@/lib/planning/catalog";
import {
  DEFAULT_DIRECT_EXECUTION_NEXT_STEP,
  DEFAULT_PLANNING_ROUTE_NEXT_STEP,
  getPlanningRequestDefaultProgress,
  type PlanningExecutionIntent,
  type PlanningIntentAnalysisInput,
  type PlanningIntentAnalysisResult,
} from "@/lib/planning/types";

const ARCHITECTURE_KEYWORDS = [
  "架构",
  "architecture",
  "技术方案",
  "技术选型",
  "系统设计",
  "集成",
  "integration",
  "接口",
  "api",
  "性能",
  "performance",
  "安全",
  "security",
  "部署",
  "deploy",
  "infra",
  "数据库",
  "data model",
  "数据模型",
  "权限",
];

const PLANNING_SCOPE_KEYWORDS = [
  "规划",
  "prd",
  "roadmap",
  "epic",
  "story",
  "需求",
  "方案",
  "流程",
  "重构",
  "信息架构",
  "体验重做",
  "用户旅程",
  "模块",
  "系统",
  "平台",
  "新增功能",
  "添加功能",
  "新功能",
  "搭建",
  "构建",
];

const AMBIGUOUS_SCOPE_KEYWORDS = [
  "优化",
  "改进",
  "提升",
  "梳理",
  "完善",
  "升级",
  "支持更多",
  "做得更好",
  "整个",
  "整体",
];

const DIRECT_EXECUTION_ACTION_KEYWORDS = [
  "修复",
  "fix",
  "bug",
  "调整",
  "修改",
  "替换",
  "补齐",
  "改成",
  "改为",
  "微调",
];

const DIRECT_EXECUTION_TARGET_KEYWORDS = [
  "按钮",
  "颜色",
  "文案",
  "文档",
  "样式",
  "间距",
  "图标",
  "表单",
  "登录页",
  "登录页面",
  "空态",
  "提示词",
  "测试",
  "类型错误",
  "报错",
  "边框",
  "对齐",
];

function normalizeForIntent(input: string): string {
  return input.toLowerCase().trim();
}

function includesAnyKeyword(input: string, keywords: string[]): boolean {
  return keywords.some((keyword) => input.includes(keyword));
}

function hasMultipleChangeClauses(input: string): boolean {
  return /[，,；;、].{2,}/u.test(input);
}

function isNewFeatureRequest(input: string): boolean {
  return /(新增|添加|实现|构建|搭建).*(功能|页面|流程|系统|模块)/u.test(input);
}

function isDirectExecutionCandidate(input: string): boolean {
  return (
    includesAnyKeyword(input, DIRECT_EXECUTION_ACTION_KEYWORDS) &&
    includesAnyKeyword(input, DIRECT_EXECUTION_TARGET_KEYWORDS)
  );
}

function resolveDirectExecutionIntent(rawGoal: string): PlanningExecutionIntent {
  return /(修复|fix|bug|报错)/iu.test(rawGoal) ? "fix" : "implement";
}

function buildDirectExecutionSummary(rawGoal: string): string {
  const summary = rawGoal.trim();
  return summary.length <= 60 ? summary : `${summary.slice(0, 57)}...`;
}

function buildPlanningNextStep(needsArchitecture: boolean): string {
  if (!needsArchitecture) {
    return "已进入规划链路，下一步将先整理 PRD，再拆分 Epics 与 Stories。";
  }

  return DEFAULT_PLANNING_ROUTE_NEXT_STEP;
}

export function analyzePlanningIntent(
  input: PlanningIntentAnalysisInput,
): PlanningIntentAnalysisResult {
  const normalizedGoal = normalizeForIntent(input.rawGoal);
  const needsArchitecture = includesAnyKeyword(normalizedGoal, ARCHITECTURE_KEYWORDS);
  const explicitPlanningScope = includesAnyKeyword(normalizedGoal, PLANNING_SCOPE_KEYWORDS);
  const ambiguousScope =
    includesAnyKeyword(normalizedGoal, AMBIGUOUS_SCOPE_KEYWORDS) ||
    hasMultipleChangeClauses(normalizedGoal);
  const newFeatureScope = isNewFeatureRequest(normalizedGoal);
  const directExecutionCandidate = isDirectExecutionCandidate(normalizedGoal);

  if (!input.hasRepo) {
    return {
      routeType: "planning",
      status: "planning",
      progressPercent: getPlanningRequestDefaultProgress("planning"),
      nextStep: "项目暂未关联仓库，系统会先进入规划链路补齐范围与执行前置上下文。",
      selectionReasonCode: "repo-missing-for-direct-execution",
      selectionReasonSummary: "当前项目尚未关联仓库，不能把请求直接送入执行链路，需先进入规划链路补齐上下文。",
      selectedAgentKeys: [...DEFAULT_PLANNING_AGENT_PIPELINE],
      selectedSkillKeys: [...DEFAULT_PLANNING_SKILL_PIPELINE],
      executionHandoffDraft: null,
    };
  }

  if (needsArchitecture) {
    return {
      routeType: "planning",
      status: "planning",
      progressPercent: getPlanningRequestDefaultProgress("planning"),
      nextStep: buildPlanningNextStep(true),
      selectionReasonCode: "architecture-or-integration-design",
      selectionReasonSummary: "目标涉及技术方案、架构约束或集成边界，需要先进入规划链路补齐架构设计。",
      selectedAgentKeys: [...ARCHITECTURE_PLANNING_AGENT_PIPELINE],
      selectedSkillKeys: [...ARCHITECTURE_PLANNING_SKILL_PIPELINE],
      executionHandoffDraft: null,
    };
  }

  if (explicitPlanningScope || newFeatureScope) {
    return {
      routeType: "planning",
      status: "planning",
      progressPercent: getPlanningRequestDefaultProgress("planning"),
      nextStep: buildPlanningNextStep(false),
      selectionReasonCode: "new-feature-or-product-scope",
      selectionReasonSummary: "目标包含新功能建设或产品范围扩展，需要先进入规划链路拆解需求与工件。",
      selectedAgentKeys: [...DEFAULT_PLANNING_AGENT_PIPELINE],
      selectedSkillKeys: [...DEFAULT_PLANNING_SKILL_PIPELINE],
      executionHandoffDraft: null,
    };
  }

  if (directExecutionCandidate && !ambiguousScope) {
    const suggestedIntent = resolveDirectExecutionIntent(input.rawGoal);

    return {
      routeType: "direct-execution",
      status: "execution-ready",
      progressPercent: getPlanningRequestDefaultProgress("execution-ready"),
      nextStep: DEFAULT_DIRECT_EXECUTION_NEXT_STEP,
      selectionReasonCode: "small-scoped-repo-change",
      selectionReasonSummary: "目标已明确为小范围代码改动，且项目具备仓库上下文，可直接进入执行准备阶段。",
      selectedAgentKeys: [],
      selectedSkillKeys: [],
      executionHandoffDraft: {
        source: "planning-request",
        suggestedGoal: input.rawGoal.trim(),
        suggestedSummary: buildDirectExecutionSummary(input.rawGoal),
        suggestedIntent,
        requiresRepo: true,
      },
    };
  }

  return {
    routeType: "planning",
    status: "planning",
    progressPercent: getPlanningRequestDefaultProgress("planning"),
    nextStep: "目标范围暂不够稳定，系统会先进入规划链路澄清范围并拆解后续工件。",
    selectionReasonCode: "goal-is-ambiguous",
    selectionReasonSummary: "目标范围仍较模糊或包含多个变化点，先进入规划链路更稳妥。",
    selectedAgentKeys: [...DEFAULT_PLANNING_AGENT_PIPELINE],
    selectedSkillKeys: [...DEFAULT_PLANNING_SKILL_PIPELINE],
    executionHandoffDraft: null,
  };
}
