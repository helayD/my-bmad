import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getPlanningGoalDescribedBy,
  isPlanningRequestSubmissionBlocked,
  mergePlanningRequests,
  PlanningRequestComposerView,
  PLANNING_GOAL_ERROR_ID,
  PLANNING_GOAL_HELP_ID,
  reconcileLatestAcceptedPlanningRequest,
} from "./planning-request-composer";

const baseRequest = {
  id: "planning-1",
  rawGoal: "为项目添加用户反馈收集功能",
  status: "analyzing" as const,
  progressPercent: 10,
  nextStep: "等待系统识别规划意图并选择 PM Agent 与 Skills",
  createdAt: "2026-04-11T00:20:00.000Z",
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
        isPending={false}
        error="请输入明确的目标描述，不能只包含空格或标点。"
        latestAcceptedRequest={null}
        requests={[]}
        hasRepo
      />,
    );

    const helpIdMatches = markup.match(new RegExp(`id="${PLANNING_GOAL_HELP_ID}"`, "g")) ?? [];
    const errorIdMatches = markup.match(new RegExp(`id="${PLANNING_GOAL_ERROR_ID}"`, "g")) ?? [];

    expect(helpIdMatches).toHaveLength(1);
    expect(errorIdMatches).toHaveLength(1);
    expect(markup).toContain(`aria-describedby="${PLANNING_GOAL_HELP_ID} ${PLANNING_GOAL_ERROR_ID}"`);
  });

  it("renders success feedback with current stage, progress, next step and created time", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestComposerView
        goal=""
        onGoalChange={() => {}}
        onSubmit={() => {}}
        onGoalKeyDown={() => {}}
        isPending={false}
        error={null}
        latestAcceptedRequest={baseRequest}
        requests={[baseRequest]}
        hasRepo
      />,
    );

    expect(markup).toContain("请求已接收");
    expect(markup).toContain("分析中");
    expect(markup).toContain("10%");
    expect(markup).toContain("等待系统识别规划意图并选择 PM Agent 与 Skills");
    expect(markup).toContain("创建时间");
  });

  it("disables input and submit button while request is pending", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestComposerView
        goal="为项目添加用户反馈收集功能"
        onGoalChange={() => {}}
        onSubmit={() => {}}
        onGoalKeyDown={() => {}}
        isPending
        error={null}
        latestAcceptedRequest={null}
        requests={[]}
        hasRepo
      />,
    );

    expect(markup).toContain("提交中…");
    expect(markup).toContain("disabled");
  });

  it("renders validation feedback next to the input area", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestComposerView
        goal="..."
        onGoalChange={() => {}}
        onSubmit={() => {}}
        onGoalKeyDown={() => {}}
        isPending={false}
        error="请输入明确的目标描述，不能只包含空格或标点。"
        latestAcceptedRequest={null}
        requests={[]}
        hasRepo
      />,
    );

    expect(markup).toContain("请输入明确的目标描述");
    expect(markup).toContain("aria-invalid=\"true\"");
  });

  it("keeps the planning entry visible even when the project has no repo", () => {
    const markup = renderToStaticMarkup(
      <PlanningRequestComposerView
        goal=""
        onGoalChange={() => {}}
        onSubmit={() => {}}
        onGoalKeyDown={() => {}}
        isPending={false}
        error={null}
        latestAcceptedRequest={null}
        requests={[]}
        hasRepo={false}
      />,
    );

    expect(markup).toContain("未关联仓库也可以先发起规划");
    expect(markup).toContain("一句话描述你希望系统规划的目标");
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

  it("merges the latest accepted request ahead of the server list without duplicates", () => {
    const latestAcceptedRequest = {
      ...baseRequest,
      id: "planning-2",
      rawGoal: "整理规划入口文案与状态反馈",
    };

    expect(mergePlanningRequests([baseRequest], latestAcceptedRequest)).toEqual([
      latestAcceptedRequest,
      baseRequest,
    ]);
  });

  it("prefers refreshed server data for the latest accepted request when available", () => {
    const refreshedRequest = {
      ...baseRequest,
      status: "planning" as const,
      progressPercent: 45,
      nextStep: "正在整理规划步骤与需要的 BMAD 工件",
    };

    expect(reconcileLatestAcceptedPlanningRequest([refreshedRequest], baseRequest)).toEqual(refreshedRequest);
  });
});
