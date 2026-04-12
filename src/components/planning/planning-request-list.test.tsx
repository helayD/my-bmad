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
  confirmedAt: null,
  lastExecutionErrorCode: null,
  generatedArtifactCount: 2,
  derivedTaskCount: 1,
  deferredArtifactCount: 0,
  artifactSummary: [],
  executionSteps: [],
  taskHandoffSummary: null,
  createdAt: "2026-04-11T00:20:00.000Z",
  createdByUser: {
    id: "user-1",
    name: "Demo",
    email: "demo@example.com",
  },
};

describe("PlanningRequestList", () => {
  it("renders summary cards, status badges and a detail entry point", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestList requests={[planningRequest]} onOpenDetail={() => {}} />,
    );

    expect(markup).toContain("需要先规划");
    expect(markup).toContain("规划中");
    expect(markup).toContain("产出工件");
    expect(markup).toContain("衍生任务");
    expect(markup).toContain("产品经理 Agent");
    expect(markup).toContain("创建 PRD");
    expect(markup).toContain("查看链路详情");
  });

  it("renders direct-execution summaries truthfully without fake planning detail", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestList
        requests={[
          {
            ...planningRequest,
            id: "planning-2",
            rawGoal: "修复登录页面的按钮颜色",
            status: "execution-ready",
            nextStep: "将跳过 BMAD 规划，进入执行任务定义与派发准备阶段。",
            routeType: "direct-execution",
            selectionReasonCode: "small-scoped-repo-change",
            selectionReasonSummary: "目标已明确为小范围代码改动，且项目具备仓库上下文，可直接进入执行准备阶段。",
            selectedAgentKeys: [],
            selectedSkillKeys: [],
            derivedTaskCount: 0,
            generatedArtifactCount: 0,
          },
        ]}
        onOpenDetail={() => {}}
      />,
    );

    expect(markup).toContain("直接进入执行");
    expect(markup).toContain("待进入执行");
    expect(markup).toContain("跳过 BMAD 规划");
    expect(markup).toContain("当前无需 PM Agent");
    expect(markup).toContain("查看链路详情");
  });

  it("highlights failed stages and keeps recovery actions visible", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestList
        requests={[
          {
            ...planningRequest,
            id: "planning-3",
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
        onOpenDetail={() => {}}
        onResolveAnalysis={() => {}}
      />,
    );

    expect(markup).toContain("失败步骤：生成 PRD 工件");
    expect(markup).toContain("规划工件写入失败");
    expect(markup).toContain("重新分析");
    expect(markup).toContain("查看链路详情");
  });

  it("renders execution-ready summaries honestly after planning handoff", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestList
        requests={[
          {
            ...planningRequest,
            status: "execution-ready",
            nextStep: "已确认规划结果并生成执行任务，当前等待手动派发，尚未开始编码。",
            taskHandoffSummary: {
              source: "planning-request-handoff",
              confirmedAt: "2026-04-11T00:30:00.000Z",
              dispatchMode: "manual",
              approvalRequired: false,
              candidateTaskCount: 1,
              createdTaskCount: 1,
              deferredArtifactCount: 0,
              deduplicatedTaskCount: 0,
              createdTasks: [],
              deferredArtifacts: [],
            },
          },
        ]}
        onOpenDetail={() => {}}
      />,
    );

    expect(markup).toContain("手动派发");
    expect(markup).toContain("尚未开始编码");
    expect(markup).toContain("查看链路详情");
  });
});
