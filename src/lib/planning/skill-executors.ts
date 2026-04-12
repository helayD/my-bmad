import {
  getPlanningSkillExecutionConfig,
  type PlanningSkillCatalogKey,
} from "@/lib/planning/catalog";
import type {
  PlanningArtifactSummaryItem,
  PlanningArtifactSyncStatus,
} from "@/lib/planning/types";
import type {
  PlanningArtifactWriter,
  PlanningArtifactWriteResult,
} from "@/lib/planning/artifact-writer";
import { projectStoriesFromEpicsDocument } from "@/lib/planning/story-projection";

const MANAGED_BLOCK_START = "<!-- planning:managed:start -->";
const MANAGED_BLOCK_END = "<!-- planning:managed:end -->";

interface PlanningOutlineStory {
  id: string;
  title: string;
  summary: string;
  acceptanceCriteria: string[];
}

interface PlanningOutlineEpic {
  id: string;
  title: string;
  summary: string;
  stories: PlanningOutlineStory[];
}

interface PlanningOutline {
  goalLabel: string;
  title: string;
  summary: string;
  epics: PlanningOutlineEpic[];
}

export interface PlanningSkillExecutionInput {
  planningRequestId: string;
  projectName: string;
  rawGoal: string;
  skillKey: PlanningSkillCatalogKey;
  writer: PlanningArtifactWriter;
  existingPaths: string[];
}

export interface PlanningSkillExecutionResult {
  skillKey: PlanningSkillCatalogKey;
  stepKey: string;
  title: string;
  outputSummary: string;
  writeResults: PlanningArtifactWriteResult[];
  artifactSummary: PlanningArtifactSummaryItem[];
  errors: string[];
}

export async function executePlanningSkill(
  input: PlanningSkillExecutionInput,
): Promise<PlanningSkillExecutionResult> {
  const config = getPlanningSkillExecutionConfig(input.skillKey);
  if (!config) {
    throw new Error("PLANNING_SKILL_UNSUPPORTED");
  }

  const outline = buildPlanningOutline(input.projectName, input.rawGoal);

  switch (input.skillKey) {
    case "bmad-create-prd":
      return executePrdSkill(input, outline, config);
    case "bmad-create-architecture":
      return executeArchitectureSkill(input, outline, config);
    case "bmad-create-epics-and-stories":
      return executeEpicsSkill(input, outline, config);
    default:
      throw new Error("PLANNING_SKILL_UNSUPPORTED");
  }
}

async function executePrdSkill(
  input: PlanningSkillExecutionInput,
  outline: PlanningOutline,
  config: NonNullable<ReturnType<typeof getPlanningSkillExecutionConfig>>,
): Promise<PlanningSkillExecutionResult> {
  const nextContent = buildPrdDocument({
    planningRequestId: input.planningRequestId,
    projectName: input.projectName,
    rawGoal: input.rawGoal,
    outline,
  });

  const existing = await input.writer.readArtifact(config.defaultOutputPath);
  const mergedContent = mergeManagedDocument(
    existing.content,
    nextContent,
    "自动规划更新",
  );
  const writeResult = await input.writer.writeArtifact({
    path: config.defaultOutputPath,
    content: mergedContent,
    summary: existing.exists ? "更新 PRD 规划内容" : "创建 PRD 规划内容",
  });

  return {
    skillKey: input.skillKey,
    stepKey: config.stepKey,
    title: config.title,
    outputSummary: "已生成 PRD 草案并写入规划目录。",
    writeResults: [writeResult],
    artifactSummary: [
      buildArtifactSummaryItem(
        writeResult,
        "prd",
        "PRD 草案",
        "产出目标、范围、核心流程与成功指标草案。",
        input.skillKey,
      ),
    ],
    errors: [],
  };
}

async function executeArchitectureSkill(
  input: PlanningSkillExecutionInput,
  outline: PlanningOutline,
  config: NonNullable<ReturnType<typeof getPlanningSkillExecutionConfig>>,
): Promise<PlanningSkillExecutionResult> {
  const nextContent = buildArchitectureDocument({
    planningRequestId: input.planningRequestId,
    projectName: input.projectName,
    rawGoal: input.rawGoal,
    outline,
  });

  const existing = await input.writer.readArtifact(config.defaultOutputPath);
  const mergedContent = mergeManagedDocument(
    existing.content,
    nextContent,
    "自动规划更新",
  );
  const writeResult = await input.writer.writeArtifact({
    path: config.defaultOutputPath,
    content: mergedContent,
    summary: existing.exists ? "更新架构规划内容" : "创建架构规划内容",
  });

  return {
    skillKey: input.skillKey,
    stepKey: config.stepKey,
    title: config.title,
    outputSummary: existing.exists
      ? "已在现有架构文档中追加/更新规划块。"
      : "已创建架构规划文档。",
    writeResults: [writeResult],
    artifactSummary: [
      buildArtifactSummaryItem(
        writeResult,
        "architecture",
        "架构草案",
        "补充关键组件、数据边界、写入/扫描链路与风险提示。",
        input.skillKey,
      ),
    ],
    errors: [],
  };
}

async function executeEpicsSkill(
  input: PlanningSkillExecutionInput,
  outline: PlanningOutline,
  config: NonNullable<ReturnType<typeof getPlanningSkillExecutionConfig>>,
): Promise<PlanningSkillExecutionResult> {
  const nextContent = buildEpicsDocument({
    planningRequestId: input.planningRequestId,
    projectName: input.projectName,
    rawGoal: input.rawGoal,
    outline,
  });

  const existing = await input.writer.readArtifact(config.defaultOutputPath);
  const mergedContent = mergeManagedDocument(
    existing.content,
    nextContent,
    "自动规划更新",
  );
  const epicsWrite = await input.writer.writeArtifact({
    path: config.defaultOutputPath,
    content: mergedContent,
    summary: existing.exists ? "更新 Epics 规划内容" : "创建 Epics 规划内容",
  });

  const projection = await projectStoriesFromEpicsDocument({
    content: nextContent,
    sourcePath: config.defaultOutputPath,
    writer: input.writer,
    existingPaths: input.existingPaths,
    sourceSkillKey: input.skillKey,
  });

  return {
    skillKey: input.skillKey,
    stepKey: config.stepKey,
    title: config.title,
    outputSummary: `已生成 Epics 文档，并投影 ${projection.writes.length} 个实现故事文件。`,
    writeResults: [epicsWrite, ...projection.writes],
    artifactSummary: [
      buildArtifactSummaryItem(
        epicsWrite,
        "epics",
        "Epics 与 Stories",
        "产出 Epic 分解结果，并为后续故事投影提供结构化来源。",
        input.skillKey,
      ),
      ...projection.artifactSummary,
    ],
    errors: projection.conflicts,
  };
}

function buildPlanningOutline(projectName: string, rawGoal: string): PlanningOutline {
  const goalLabel = normalizeGoalLabel(rawGoal);
  const title = truncate(goalLabel, 48);
  const summary = `${projectName} 需要围绕“${goalLabel}”形成一条可执行、可追踪、可确认的规划产出链路。`;

  return {
    goalLabel,
    title,
    summary,
    epics: [
      {
        id: "1",
        title: `明确 ${truncate(goalLabel, 20)} 的目标与范围`,
        summary: "先把目标、边界与核心场景沉淀为统一规划输入。",
        stories: [
          buildOutlineStory("1.1", goalLabel, "梳理关键场景与约束"),
          buildOutlineStory("1.2", goalLabel, "整理验收标准与影响范围"),
        ],
      },
      {
        id: "2",
        title: `交付 ${truncate(goalLabel, 20)} 的核心能力`,
        summary: "围绕主流程、状态同步与数据结构完成核心交付拆解。",
        stories: [
          buildOutlineStory("2.1", goalLabel, "实现主流程与关键数据结构"),
          buildOutlineStory("2.2", goalLabel, "串联状态、权限与工件同步"),
        ],
      },
      {
        id: "3",
        title: `验证 ${truncate(goalLabel, 20)} 的反馈与质量`,
        summary: "补齐反馈、异常、回归测试与后续确认入口。",
        stories: [
          buildOutlineStory("3.1", goalLabel, "补充用户反馈与异常处理"),
          buildOutlineStory("3.2", goalLabel, "补齐测试、文档与确认准备"),
        ],
      },
    ],
  };
}

function buildOutlineStory(
  id: string,
  goalLabel: string,
  action: string,
): PlanningOutlineStory {
  return {
    id,
    title: `${action}`,
    summary: `${action}，让“${goalLabel}”可以稳定进入后续执行阶段。`,
    acceptanceCriteria: [
      `围绕“${goalLabel}”的关键用户流程被明确拆解，并能映射到后续实现任务。`,
      "涉及的状态、错误与下一步动作具备真实且清晰的反馈。",
    ],
  };
}

function buildPrdDocument(input: {
  planningRequestId: string;
  projectName: string;
  rawGoal: string;
  outline: PlanningOutline;
}): string {
  const epicsSummary = input.outline.epics
    .map((epic) => `- Epic ${epic.id}: ${epic.title}`)
    .join("\n");

  return `---
planningRequestId: ${input.planningRequestId}
workflowType: planning-request
sourceGoal: ${JSON.stringify(input.rawGoal)}
---
${MANAGED_BLOCK_START}
# Product Requirements Document - ${input.projectName}

## Executive Summary

${input.outline.summary}

## Goal

${input.rawGoal}

## Scope

- 聚焦“${input.outline.goalLabel}”相关的核心能力、数据边界与用户反馈。
- 规划结果需要最终落到 BMAD 工件目录，并支持后续继续编辑和确认。

## Functional Requirements

- 系统需要为“${input.outline.goalLabel}”生成结构化规划工件。
- 规划结果需要拆成可追踪的 Epic、Story 与实现故事 stub。
- 失败时应保留已生成产物，并允许后续重试失败步骤。

## Proposed Epic Breakdown

${epicsSummary}

## Success Signals

- 规划工件可以被写入并同步到 BMAD artifact 真值链路。
- 用户可以查看产出摘要、继续编辑，并基于结果进入下一阶段。
${MANAGED_BLOCK_END}`;
}

function buildArchitectureDocument(input: {
  planningRequestId: string;
  projectName: string;
  rawGoal: string;
  outline: PlanningOutline;
}): string {
  const componentList = [
    "规划请求真值与步骤状态持久化",
    "受控工件写入层（本地/GitHub）",
    "工件扫描与 BmadArtifact 同步",
    "规划结果投影与项目页可见反馈",
  ]
    .map((item) => `- ${item}`)
    .join("\n");

  return `---
planningRequestId: ${input.planningRequestId}
workflowType: planning-request
sourceGoal: ${JSON.stringify(input.rawGoal)}
---
${MANAGED_BLOCK_START}
# Architecture Decision Document

## Context

本规划围绕“${input.outline.goalLabel}”展开，目标是让 ${input.projectName} 能够在受控边界内持续生成、写入并同步 BMAD 工件。

## Components

${componentList}

## Key Decisions

- 所有规划执行步骤都需要持久化为可见的 step 真值，而不是只在 UI 中临时显示。
- 写入成功后立即触发 artifact 扫描与同步，避免规划结果和工件树脱节。
- Story stub 仅在缺失时创建；已有实现故事文件优先保留人工补充内容。

## Risks And Mitigations

- 写入失败：使用中文错误摘要并保留已成功步骤。
- 现有 story 文件冲突：跳过覆盖并记录冲突，避免误伤开发内容。
- GitHub 缓存滞后：写入后明确失效 repo/file 级缓存标签。
${MANAGED_BLOCK_END}`;
}

function buildEpicsDocument(input: {
  planningRequestId: string;
  projectName: string;
  rawGoal: string;
  outline: PlanningOutline;
}): string {
  const epicSections = input.outline.epics
    .map((epic) => {
      const stories = epic.stories
        .map(
          (story) => `### Story ${story.id}: ${story.title}

作为用户，
我希望${story.summary}
以便“${input.outline.goalLabel}”可以顺利进入实现阶段。

**验收标准：**

${story.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}
`,
        )
        .join("\n");

      return `## Epic ${epic.id}: ${epic.title}

${epic.summary}

${stories}`;
    })
    .join("\n");

  return `---
planningRequestId: ${input.planningRequestId}
workflowType: planning-request
sourceGoal: ${JSON.stringify(input.rawGoal)}
---
${MANAGED_BLOCK_START}
# ${input.projectName} - Epic Breakdown

## Overview

以下规划结果将“${input.outline.goalLabel}”拆解为可继续编辑的 Epic 与 Story 结构。

${epicSections}
${MANAGED_BLOCK_END}`;
}

function mergeManagedDocument(
  existingContent: string | null,
  managedContent: string,
  appendHeading: string,
): string {
  if (!existingContent || existingContent.trim().length === 0) {
    return managedContent;
  }

  if (
    existingContent.includes(MANAGED_BLOCK_START)
    && existingContent.includes(MANAGED_BLOCK_END)
  ) {
    return existingContent.replace(
      new RegExp(
        `${escapeRegExp(MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MANAGED_BLOCK_END)}`,
        "m",
      ),
      extractManagedBlock(managedContent),
    );
  }

  return `${existingContent.trimEnd()}\n\n## ${appendHeading}\n\n${extractManagedBlock(managedContent)}\n`;
}

function extractManagedBlock(content: string): string {
  const match = content.match(
    new RegExp(
      `${escapeRegExp(MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MANAGED_BLOCK_END)}`,
      "m",
    ),
  );

  return match?.[0] ?? content;
}

function buildArtifactSummaryItem(
  writeResult: PlanningArtifactWriteResult,
  kind: PlanningArtifactSummaryItem["kind"],
  title: string,
  summary: string,
  sourceSkillKey: PlanningSkillCatalogKey,
): PlanningArtifactSummaryItem {
  return {
    path: writeResult.path,
    title,
    kind,
    summary,
    sourceSkillKey,
    status: toArtifactSyncStatus(writeResult.mode),
  };
}

function toArtifactSyncStatus(
  mode: PlanningArtifactWriteResult["mode"],
): PlanningArtifactSyncStatus {
  return mode === "create" ? "created" : "updated";
}

function normalizeGoalLabel(rawGoal: string): string {
  return rawGoal.trim().replace(/[。！？!?]+$/u, "") || "新规划目标";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
