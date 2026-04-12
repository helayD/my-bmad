import {
  BMAD_OUTPUT_DIR,
  BMAD_PLANNING_DIR,
} from "@/lib/bmad/utils";

export interface PlanningAgentCatalogItem {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
}

export interface PlanningSkillCatalogItem {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  stepKey: string;
  title: string;
  defaultOutputPath: string;
}

export const PLANNING_AGENT_CATALOG = {
  "bmad-agent-pm": {
    key: "bmad-agent-pm",
    label: "产品经理 Agent（bmad-agent-pm）",
    shortLabel: "产品经理 Agent",
    description: "负责需求澄清、PRD 组织与后续工件拆解。",
  },
  "bmad-agent-architect": {
    key: "bmad-agent-architect",
    label: "架构师 Agent（bmad-agent-architect）",
    shortLabel: "架构师 Agent",
    description: "负责技术方案、集成边界、性能与安全等设计决策。",
  },
} as const satisfies Record<string, PlanningAgentCatalogItem>;

export const PLANNING_SKILL_CATALOG = {
  "bmad-create-prd": {
    key: "bmad-create-prd",
    label: "创建 PRD（bmad-create-prd）",
    shortLabel: "创建 PRD",
    description: "沉淀目标、范围与用户价值。",
    stepKey: "generate-prd",
    title: "生成 PRD 工件",
    defaultOutputPath: `${BMAD_OUTPUT_DIR}/${BMAD_PLANNING_DIR}/prd.md`,
  },
  "bmad-create-architecture": {
    key: "bmad-create-architecture",
    label: "创建技术架构（bmad-create-architecture）",
    shortLabel: "技术架构",
    description: "补齐技术方案、集成边界与关键约束。",
    stepKey: "generate-architecture",
    title: "生成架构工件",
    defaultOutputPath: `${BMAD_OUTPUT_DIR}/${BMAD_PLANNING_DIR}/architecture.md`,
  },
  "bmad-create-epics-and-stories": {
    key: "bmad-create-epics-and-stories",
    label: "拆分 Epics 与 Stories（bmad-create-epics-and-stories）",
    shortLabel: "拆分 Stories",
    description: "把规划结果拆成后续可执行工件。",
    stepKey: "generate-epics-and-stories",
    title: "生成 Epics 与 Story 草案",
    defaultOutputPath: `${BMAD_OUTPUT_DIR}/${BMAD_PLANNING_DIR}/epics.md`,
  },
} as const satisfies Record<string, PlanningSkillCatalogItem>;

export type PlanningAgentCatalogKey = keyof typeof PLANNING_AGENT_CATALOG;
export type PlanningSkillCatalogKey = keyof typeof PLANNING_SKILL_CATALOG;

export const SUPPORTED_PLANNING_EXECUTION_SKILL_KEYS = Object.keys(
  PLANNING_SKILL_CATALOG,
) as PlanningSkillCatalogKey[];

export const DEFAULT_PLANNING_AGENT_PIPELINE = [
  "bmad-agent-pm",
] as const satisfies readonly PlanningAgentCatalogKey[];

export const ARCHITECTURE_PLANNING_AGENT_PIPELINE = [
  "bmad-agent-pm",
  "bmad-agent-architect",
] as const satisfies readonly PlanningAgentCatalogKey[];

export const DEFAULT_PLANNING_SKILL_PIPELINE = [
  "bmad-create-prd",
  "bmad-create-epics-and-stories",
] as const satisfies readonly PlanningSkillCatalogKey[];

export const ARCHITECTURE_PLANNING_SKILL_PIPELINE = [
  "bmad-create-prd",
  "bmad-create-architecture",
  "bmad-create-epics-and-stories",
] as const satisfies readonly PlanningSkillCatalogKey[];

export function getPlanningAgentLabel(key: string): string {
  return PLANNING_AGENT_CATALOG[key as PlanningAgentCatalogKey]?.label ?? key;
}

export function getPlanningAgentShortLabel(key: string): string {
  return PLANNING_AGENT_CATALOG[key as PlanningAgentCatalogKey]?.shortLabel ?? key;
}

export function getPlanningSkillLabel(key: string): string {
  return PLANNING_SKILL_CATALOG[key as PlanningSkillCatalogKey]?.label ?? key;
}

export function getPlanningSkillShortLabel(key: string): string {
  return PLANNING_SKILL_CATALOG[key as PlanningSkillCatalogKey]?.shortLabel ?? key;
}

export function getPlanningSkillExecutionConfig(key: string): PlanningSkillCatalogItem | null {
  return PLANNING_SKILL_CATALOG[key as PlanningSkillCatalogKey] ?? null;
}
