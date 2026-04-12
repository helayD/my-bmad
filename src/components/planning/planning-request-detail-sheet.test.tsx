import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetDescription: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { PlanningRequestDetailSheet } from "./planning-request-detail-sheet";

const baseRequest = {
  id: "planning-1",
  rawGoal: "为项目添加用户反馈收集功能",
  status: "execution-ready" as const,
  progressPercent: 100,
  nextStep: "已确认规划结果并生成执行任务，当前等待手动派发，尚未开始编码。",
  routeType: "planning" as const,
  selectionReasonCode: "new-feature-or-product-scope" as const,
  selectionReasonSummary: "目标包含新功能建设或产品范围扩展，需要先进入规划链路拆解需求与工件。",
  selectedAgentKeys: ["bmad-agent-pm"],
  selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
  analyzedAt: "2026-04-11T00:21:00.000Z",
  executionStartedAt: "2026-04-11T00:22:00.000Z",
  executionCompletedAt: "2026-04-11T00:25:00.000Z",
  executionFailedAt: null,
  confirmedAt: "2026-04-11T00:30:00.000Z",
  lastExecutionErrorCode: null,
  generatedArtifactCount: 1,
  derivedTaskCount: 1,
  deferredArtifactCount: 1,
  artifactSummary: [
    {
      path: "_bmad-output/planning-artifacts/prd.md",
      title: "PRD 草案",
      kind: "prd" as const,
      summary: "已生成 PRD。",
      sourceSkillKey: "bmad-create-prd",
      status: "created" as const,
    },
  ],
  executionSteps: [
    {
      id: "step-1",
      skillKey: "bmad-create-prd",
      stepKey: "generate-prd",
      sequence: 1,
      status: "completed" as const,
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
  executionHandoffDraft: null,
  taskHandoffSummary: {
    source: "planning-request-handoff" as const,
    confirmedAt: "2026-04-11T00:30:00.000Z",
    dispatchMode: "manual" as const,
    approvalRequired: false,
    candidateTaskCount: 1,
    createdTaskCount: 1,
    deferredArtifactCount: 1,
    deduplicatedTaskCount: 0,
    createdTasks: [],
    deferredArtifacts: [],
  },
  createdAt: "2026-04-11T00:20:00.000Z",
  createdByUser: {
    id: "user-1",
    name: "Demo",
    email: "demo@example.com",
  },
};

const baseDetail = {
  request: baseRequest,
  problem: {
    stage: "execution-ready" as const,
    severity: "info" as const,
    title: "已衔接到执行准备",
    reason: "已进入执行准备态，当前可见 1 个衍生任务，但尚未开始编码。",
    nextAction: "查看执行准备",
  },
  artifacts: [
    {
      ...baseRequest.artifactSummary[0],
      artifactId: "artifact-prd-1",
      artifactName: "PRD 草案",
    },
  ],
  derivedTasks: [
    {
      taskId: "task-1",
      title: "Task《落地用户反馈入口》",
      status: "planned",
      currentStage: "已计划",
      nextStep: "等待手动派发。",
      queuePosition: 1,
      readyState: "manual" as const,
      sourceArtifactId: "artifact-task-1",
      sourceArtifactName: "落地用户反馈入口",
      sourceArtifactPath: "_bmad-output/implementation-artifacts/3-5-story.md#task-1",
      storyArtifactId: "artifact-story-1",
      storyTitle: "Story 3.5",
      isLegacyPending: false,
    },
  ],
  deferredArtifacts: [
    {
      artifactId: "artifact-task-2",
      artifactName: "补齐确认后反馈",
      filePath: "_bmad-output/implementation-artifacts/3-5-story.md#task-2",
      storyTitle: "Story 3.5",
      deferredBy: "task" as const,
      sourceArtifactId: "artifact-task-2",
    },
  ],
};

describe("PlanningRequestDetailSheet", () => {
  it("renders real execution-ready messaging and deep links for tasks and artifacts", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestDetailSheet
        open
        onOpenChange={() => {}}
        request={baseRequest}
        detail={baseDetail}
        workspaceSlug="demo-workspace"
        projectSlug="demo-project"
        isLoading={false}
        error={null}
        hasRepo
      />,
    );

    expect(markup).toContain("规划链路详情");
    expect(markup).toContain("尚未开始编码");
    expect(markup).toContain("/workspace/demo-workspace/project/demo-project/tasks/task-1");
    expect(markup).toContain("/workspace/demo-workspace/project/demo-project?artifactId=artifact-prd-1#artifact-tree");
    expect(markup).toContain("/workspace/demo-workspace/project/demo-project?artifactId=artifact-task-1#artifact-tree");
    expect(markup).toContain("补齐确认后反馈");
  });

  it("degrades honestly for direct-execution requests", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestDetailSheet
        open
        onOpenChange={() => {}}
        request={{
          ...baseRequest,
          routeType: "direct-execution",
          nextStep: "将跳过 BMAD 规划，进入执行任务定义与派发准备阶段。",
          selectedAgentKeys: [],
          selectedSkillKeys: [],
          generatedArtifactCount: 0,
          derivedTaskCount: 0,
          executionSteps: [],
          taskHandoffSummary: null,
        }}
        detail={{
          ...baseDetail,
          request: {
            ...baseRequest,
            routeType: "direct-execution",
            nextStep: "将跳过 BMAD 规划，进入执行任务定义与派发准备阶段。",
            selectedAgentKeys: [],
            selectedSkillKeys: [],
            generatedArtifactCount: 0,
            derivedTaskCount: 0,
            executionSteps: [],
            taskHandoffSummary: null,
          },
          artifacts: [],
          derivedTasks: [],
          deferredArtifacts: [],
          problem: {
            stage: "execution-ready",
            severity: "info",
            title: "直接进入执行准备",
            reason: "此请求跳过了 BMAD 规划，当前仅进入执行准备态，尚未开始编码。",
            nextAction: "查看执行准备",
          },
        }}
        workspaceSlug="demo-workspace"
        projectSlug="demo-project"
        isLoading={false}
        error={null}
        hasRepo
      />,
    );

    expect(markup).toContain("直接进入执行准备");
    expect(markup).toContain("不会伪造 Skill 执行轨迹或规划工件");
    expect(markup).toContain("此请求没有规划执行步骤");
  });
});
