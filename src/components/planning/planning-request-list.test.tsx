import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanningRequestList } from "./planning-request-list";

const planningRequest = {
  id: "planning-1",
  rawGoal: "为项目添加用户反馈收集功能",
  status: "planning" as const,
  progressPercent: 45,
  nextStep: "已进入规划链路，下一步将先整理 PRD，再拆分 Epics 与 Stories。",
  routeType: "planning" as const,
  selectionReasonCode: "new-feature-or-product-scope" as const,
  selectionReasonSummary: "目标包含新功能建设或产品范围扩展，需要先进入规划链路拆解需求与工件。",
  selectedAgentKeys: ["bmad-agent-pm"],
  selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
  analyzedAt: "2026-04-11T00:21:00.000Z",
  executionHandoffDraft: null,
  executionStartedAt: null,
  executionCompletedAt: null,
  executionFailedAt: null,
  lastExecutionErrorCode: null,
  generatedArtifactCount: 0,
  artifactSummary: [],
  executionSteps: [],
  createdAt: "2026-04-11T00:20:00.000Z",
  createdByUser: {
    id: "user-1",
    name: "Demo",
    email: "demo@example.com",
  },
};

describe("PlanningRequestList", () => {
  it("renders route and skill badges for planning requests", () => {
    const markup = renderToStaticMarkup(<PlanningRequestList requests={[planningRequest]} />);

    expect(markup).toContain("需要先规划");
    expect(markup).toContain("规划中");
    expect(markup).toContain("产品经理 Agent");
    expect(markup).toContain("创建 PRD");
    expect(markup).toContain("拆分 Stories");
    expect(markup).toContain("规划执行");
  });

  it("renders direct execution guidance truthfully", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestList
        requests={[
          {
            ...planningRequest,
            id: "planning-2",
            rawGoal: "修复登录页面的按钮颜色",
            status: "execution-ready",
            progressPercent: 40,
            nextStep: "将跳过 BMAD 规划，进入执行任务定义与派发准备阶段。",
            routeType: "direct-execution",
            selectionReasonCode: "small-scoped-repo-change",
            selectionReasonSummary: "目标已明确为小范围代码改动，且项目具备仓库上下文，可直接进入执行准备阶段。",
            selectedAgentKeys: [],
            selectedSkillKeys: [],
            executionHandoffDraft: {
              source: "planning-request",
              suggestedGoal: "修复登录页面的按钮颜色",
              suggestedSummary: "修复登录页面的按钮颜色",
              suggestedIntent: "fix",
              requiresRepo: true,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("直接进入执行");
    expect(markup).toContain("待进入执行");
    expect(markup).toContain("跳过 BMAD 规划，进入执行链准备阶段");
    expect(markup).toContain("当前无需 PM Agent");
    expect(markup).toContain("当前无需 BMAD Skills");
  });

  it("renders failure retry entry when analysis fails", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestList
        requests={[
          {
            ...planningRequest,
            id: "planning-3",
            status: "failed",
            routeType: null,
            selectionReasonCode: null,
            selectionReasonSummary: "分析失败：保存识别结果时出现问题。",
            selectedAgentKeys: [],
            selectedSkillKeys: [],
            analyzedAt: "2026-04-11T00:21:00.000Z",
          },
        ]}
        onResolveAnalysis={() => {}}
      />,
    );

    expect(markup).toContain("分析失败：保存识别结果时出现问题。");
    expect(markup).toContain("重新分析");
  });

  it("renders a continue-analysis action for requests still stuck in analyzing", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestList
        requests={[
          {
            ...planningRequest,
            id: "planning-4",
            status: "analyzing",
            progressPercent: 10,
            routeType: null,
            selectionReasonCode: null,
            selectionReasonSummary: null,
            selectedAgentKeys: [],
            selectedSkillKeys: [],
            analyzedAt: null,
            executionHandoffDraft: null,
          },
        ]}
        onResolveAnalysis={() => {}}
      />,
    );

    expect(markup).toContain("如果分析长时间没有推进");
    expect(markup).toContain("继续分析");
  });

  it("renders execution step state and artifact summary once planning has run", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestList
        requests={[
          {
            ...planningRequest,
            status: "awaiting-confirmation",
            progressPercent: 90,
            nextStep: "规划产出已生成，可查看摘要、编辑工件并确认后进入后续执行链路。",
            generatedArtifactCount: 2,
            artifactSummary: [
              {
                path: "_bmad-output/planning-artifacts/prd.md",
                title: "PRD 草案",
                kind: "prd",
                summary: "已生成 PRD。",
                sourceSkillKey: "bmad-create-prd",
                status: "created",
              },
            ],
            executionSteps: [
              {
                id: "step-1",
                skillKey: "bmad-create-prd",
                stepKey: "generate-prd",
                sequence: 1,
                status: "completed",
                title: "生成 PRD 工件",
                startedAt: "2026-04-11T00:21:00.000Z",
                completedAt: "2026-04-11T00:22:00.000Z",
                failedAt: null,
                errorCode: null,
                errorMessage: null,
                outputSummary: "已生成 PRD 草案。",
                artifactPaths: ["_bmad-output/planning-artifacts/prd.md"],
                retryCount: 0,
              },
            ],
          },
        ]}
      />,
    );

    expect(markup).toContain("步骤状态");
    expect(markup).toContain("已生成 2 个工件");
    expect(markup).toContain("生成 PRD 工件");
    expect(markup).toContain("产出摘要");
    expect(markup).toContain("_bmad-output/planning-artifacts/prd.md");
  });

  it("renders a retry action for failed execution steps", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestList
        requests={[
          {
            ...planningRequest,
            status: "failed",
            nextStep: "规划执行在某一步失败。你可以重试失败步骤，或调整目标后重新规划。",
            executionSteps: [
              {
                id: "step-1",
                skillKey: "bmad-create-prd",
                stepKey: "generate-prd",
                sequence: 1,
                status: "failed",
                title: "生成 PRD 工件",
                startedAt: "2026-04-11T00:21:00.000Z",
                completedAt: null,
                failedAt: "2026-04-11T00:22:00.000Z",
                errorCode: "PLANNING_ARTIFACT_WRITE_ERROR",
                errorMessage: "规划工件写入失败，请检查仓库连接或本地目录权限后重试。",
                outputSummary: null,
                artifactPaths: [],
                retryCount: 0,
              },
            ],
          },
        ]}
        onExecutePlanning={() => {}}
      />,
    );

    expect(markup).toContain("规划工件写入失败");
    expect(markup).toContain("重试失败步骤");
  });
});
