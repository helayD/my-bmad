import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogDescription: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogFooter: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import {
  buildPlanningProjectUrl,
  getPlanningGoalDescribedBy,
  isPlanningRequestSubmissionBlocked,
  mergePlanningRequests,
  PlanningRequestHandoffDialog,
  PlanningRequestComposerView,
  PLANNING_GOAL_ERROR_ID,
  PLANNING_GOAL_HELP_ID,
  reconcileLatestAcceptedPlanningRequest,
  shouldIgnorePlanningDetailResponse,
  shouldIgnorePlanningHandoffPreviewResponse,
  submitPlanningRequestFlow,
} from "./planning-request-composer";

const baseRequest = {
  id: "planning-1",
  rawGoal: "为项目添加用户反馈收集功能",
  status: "analyzing" as const,
  progressPercent: 10,
  nextStep: "等待系统识别规划意图并选择 PM Agent 与 Skills",
  routeType: null,
  selectionReasonCode: null,
  selectionReasonSummary: null,
  selectedAgentKeys: [],
  selectedSkillKeys: [],
  analyzedAt: null,
  executionStartedAt: null,
  executionCompletedAt: null,
  executionFailedAt: null,
  confirmedAt: null,
  lastExecutionErrorCode: null,
  generatedArtifactCount: 0,
  derivedTaskCount: 0,
  deferredArtifactCount: 0,
  artifactSummary: [],
  executionSteps: [],
  executionHandoffDraft: null,
  taskHandoffSummary: null,
  createdAt: "2026-04-11T00:20:00.000Z",
  updatedAt: "2026-04-11T00:20:00.000Z",
  createdByUser: {
    id: "user-1",
    name: "Demo",
    email: "demo@example.com",
  },
};

describe("PlanningRequestComposerView", () => {
  it("keeps helper and error descriptions on separate ids when validation fails", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestComposerView
        goal="..."
        onGoalChange={() => {}}
        onSubmit={() => {}}
        onGoalKeyDown={() => {}}
        planningStatus="all"
        onChangePlanningStatus={() => {}}
        onOpenDetail={() => {}}
        onResolveAnalysis={() => {}}
        onExecutePlanning={() => {}}
        isPending={false}
        error="请输入明确的目标描述，不能只包含空格或标点。"
        latestAcceptedRequest={null}
        requests={[]}
        selectedPlanningRequestId={null}
        hasRepo
      />,
    );

    const helpIdMatches = markup.match(new RegExp(`id="${PLANNING_GOAL_HELP_ID}"`, "g")) ?? [];
    const errorIdMatches = markup.match(new RegExp(`id="${PLANNING_GOAL_ERROR_ID}"`, "g")) ?? [];

    expect(helpIdMatches).toHaveLength(1);
    expect(errorIdMatches).toHaveLength(1);
    expect(markup).toContain(`aria-describedby="${PLANNING_GOAL_HELP_ID} ${PLANNING_GOAL_ERROR_ID}"`);
  });

  it("renders success feedback and URL-driven filter controls", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestComposerView
        goal=""
        onGoalChange={() => {}}
        onSubmit={() => {}}
        onGoalKeyDown={() => {}}
        planningStatus="failed"
        onChangePlanningStatus={() => {}}
        onOpenDetail={() => {}}
        onResolveAnalysis={() => {}}
        onExecutePlanning={() => {}}
        isPending={false}
        error={null}
        latestAcceptedRequest={baseRequest}
        requests={[baseRequest]}
        selectedPlanningRequestId={null}
        hasRepo
      />,
    );

    expect(markup).toContain("请求已接收");
    expect(markup).toContain("分析中");
    expect(markup).toContain("规划请求历史");
    expect(markup).toContain("全部");
    expect(markup).toContain("已失败");
    expect(markup).toContain("查看链路详情");
  });

  it("keeps the planning entry visible even when the project has no repo", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestComposerView
        goal=""
        onGoalChange={() => {}}
        onSubmit={() => {}}
        onGoalKeyDown={() => {}}
        planningStatus="all"
        onChangePlanningStatus={() => {}}
        onOpenDetail={() => {}}
        onResolveAnalysis={() => {}}
        onExecutePlanning={() => {}}
        isPending={false}
        error={null}
        latestAcceptedRequest={null}
        requests={[]}
        selectedPlanningRequestId={null}
        hasRepo={false}
      />,
    );

    expect(markup).toContain("未关联仓库也可以先发起规划");
    expect(markup).toContain("一句话描述你希望系统规划的目标");
  });

  it("offers a recovery entry point when no executable task candidates exist", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestHandoffDialog
        open
        onOpenChange={() => {}}
        preview={{
          planningRequestId: "planning-1",
          dispatchMode: "manual",
          approvalRequired: false,
          candidateTaskCount: 0,
          storyCount: 0,
          groups: [],
        }}
        request={{
          ...baseRequest,
          status: "awaiting-confirmation",
          routeType: "planning",
        }}
        deferredArtifactIds={[]}
        error={null}
        isPending={false}
        onToggleDeferredStory={() => {}}
        onToggleDeferredTask={() => {}}
        onOpenDetail={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(markup).toContain("暂无可执行任务");
    expect(markup).toContain("查看链路详情");
    expect(markup).not.toContain("确认并生成执行任务");
  });

  it("keeps handoff selection copy fully in Chinese", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestHandoffDialog
        open
        onOpenChange={() => {}}
        preview={{
          planningRequestId: "planning-1",
          dispatchMode: "manual",
          approvalRequired: false,
          candidateTaskCount: 1,
          storyCount: 1,
          groups: [
            {
              storyArtifactId: "story-1",
              storyTitle: "Story 3.4",
              storyFilePath: "_bmad-output/implementation-artifacts/3-4.md",
              storyId: "3.4",
              tasks: [
                {
                  artifactId: "task-1",
                  artifactName: "补齐确认反馈",
                  filePath: "_bmad-output/implementation-artifacts/3-4.md#task-1",
                  storyArtifactId: "story-1",
                  storyTitle: "Story 3.4",
                  storyFilePath: "_bmad-output/implementation-artifacts/3-4.md",
                  order: 1,
                },
              ],
            },
          ],
        }}
        request={{
          ...baseRequest,
          status: "awaiting-confirmation",
          routeType: "planning",
        }}
        deferredArtifactIds={[]}
        error={null}
        isPending={false}
        onToggleDeferredStory={() => {}}
        onToggleDeferredTask={() => {}}
        onOpenDetail={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(markup).toContain("整个用户故事暂不执行");
    expect(markup).not.toContain("整个 Story 暂不执行");
  });
});

describe("planning request composer helpers", () => {
  it("computes described-by ids for help and validation feedback", () => {
    expect(getPlanningGoalDescribedBy(false)).toBe(PLANNING_GOAL_HELP_ID);
    expect(getPlanningGoalDescribedBy(true)).toBe(`${PLANNING_GOAL_HELP_ID} ${PLANNING_GOAL_ERROR_ID}`);
  });

  it("blocks submission while a request is pending or locally locked", () => {
    expect(isPlanningRequestSubmissionBlocked(false, false)).toBe(false);
    expect(isPlanningRequestSubmissionBlocked(true, false)).toBe(true);
    expect(isPlanningRequestSubmissionBlocked(false, true)).toBe(true);
  });

  it("merges the latest accepted request while respecting the current status filter", () => {
    const latestAcceptedRequest = {
      ...baseRequest,
      id: "planning-2",
      rawGoal: "整理规划入口文案与状态反馈",
      status: "failed" as const,
    };

    expect(
      mergePlanningRequests([], latestAcceptedRequest, { filter: "failed" }),
    ).toEqual([latestAcceptedRequest]);
    expect(
      mergePlanningRequests([baseRequest], latestAcceptedRequest, { filter: "planning" }),
    ).toEqual([baseRequest]);
  });

  it("prefers refreshed server data for the latest accepted request when available", () => {
    const refreshedRequest = {
      ...baseRequest,
      status: "planning" as const,
      progressPercent: 45,
      nextStep: "正在整理规划步骤与需要的 BMAD 工件",
      routeType: "planning" as const,
    };

    expect(reconcileLatestAcceptedPlanningRequest([refreshedRequest], baseRequest)).toEqual(refreshedRequest);
  });

  it("builds shareable project URLs while preserving unrelated search params", () => {
    const url = buildPlanningProjectUrl(
      "/workspace/demo/project/app",
      new URLSearchParams("artifactId=artifact-1&planningRequestId=planning-1"),
      {
        planningStatus: "failed",
        planningRequestId: null,
      },
    );

    expect(url).toBe("/workspace/demo/project/app?artifactId=artifact-1&planningStatus=failed");
  });

  it("ignores stale planning detail responses after close or request switch", () => {
    expect(
      shouldIgnorePlanningDetailResponse({
        activeRequestId: null,
        responseRequestId: "planning-1",
        activeToken: 2,
        responseToken: 2,
      }),
    ).toBe(true);

    expect(
      shouldIgnorePlanningDetailResponse({
        activeRequestId: "planning-2",
        responseRequestId: "planning-1",
        activeToken: 3,
        responseToken: 2,
      }),
    ).toBe(true);

    expect(
      shouldIgnorePlanningDetailResponse({
        activeRequestId: "planning-1",
        responseRequestId: "planning-1",
        activeToken: 2,
        responseToken: 2,
      }),
    ).toBe(false);
  });

  it("ignores stale handoff preview responses after close or request switch", () => {
    expect(
      shouldIgnorePlanningHandoffPreviewResponse({
        activeRequestId: null,
        responseRequestId: "planning-1",
        activeToken: 2,
        responseToken: 2,
      }),
    ).toBe(true);

    expect(
      shouldIgnorePlanningHandoffPreviewResponse({
        activeRequestId: "planning-2",
        responseRequestId: "planning-1",
        activeToken: 3,
        responseToken: 2,
      }),
    ).toBe(true);

    expect(
      shouldIgnorePlanningHandoffPreviewResponse({
        activeRequestId: "planning-1",
        responseRequestId: "planning-1",
        activeToken: 2,
        responseToken: 2,
      }),
    ).toBe(false);
  });

  it("creates a request and automatically triggers analysis", async () => {
    const onCreated = vi.fn();
    const createRequest = vi.fn().mockResolvedValue({
      success: true,
      data: {
        request: baseRequest,
      },
    });
    const analyzeRequest = vi.fn().mockResolvedValue({
      success: true,
      data: {
        request: {
          ...baseRequest,
          status: "planning",
          progressPercent: 45,
          routeType: "planning",
          selectionReasonCode: "new-feature-or-product-scope",
          selectionReasonSummary: "目标包含新功能建设或产品范围扩展，需要先进入规划链路拆解需求与工件。",
          selectedAgentKeys: ["bmad-agent-pm"],
          selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
          analyzedAt: "2026-04-11T00:21:00.000Z",
        },
        didAnalyze: true,
      },
    });

    const result = await submitPlanningRequestFlow({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      rawGoal: baseRequest.rawGoal,
      createRequest,
      analyzeRequest,
      onCreated,
    });

    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(baseRequest);
    expect(analyzeRequest).toHaveBeenCalledWith({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      planningRequestId: "planning-1",
    });
    expect(result.latestRequest).toEqual(
      expect.objectContaining({
        status: "planning",
        routeType: "planning",
      }),
    );
  });
});
