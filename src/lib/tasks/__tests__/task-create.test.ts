import { describe, expect, it } from "vitest";
import {
  buildTaskTitleFromGoal,
  getInitialTaskLifecycle,
  getManualTaskLifecycle,
} from "@/lib/tasks/defaults";
import {
  getTaskCreateFieldErrors,
  taskCreateInputSchema,
} from "@/lib/tasks/types";

describe("task create defaults and schema", () => {
  it("returns planned lifecycle for manual task creation", () => {
    expect(getManualTaskLifecycle({ requireApprovalBeforeExecution: false })).toEqual({
      status: "planned",
      currentStage: "已计划",
      currentActivity: "任务已计划完成，当前尚未开始编码或启动执行。",
      nextStep: "下一步可进入执行派发阶段。",
    });
  });

  it("returns approval-aware manual lifecycle copy", () => {
    expect(getManualTaskLifecycle({ requireApprovalBeforeExecution: true })).toEqual({
      status: "planned",
      currentStage: "已计划",
      currentActivity: "任务已计划完成，正在等待审批后再进入执行派发。",
      nextStep: "等待审批通过后进入派发阶段。",
    });
  });

  it("keeps legacy pending lifecycle readable for historical tasks", () => {
    expect(getInitialTaskLifecycle()).toEqual({
      status: "pending",
      currentStage: "任务已创建",
      currentActivity: "系统已接收任务，正在整理来源工件上下文并准备进入执行派发。",
      nextStep: "下一步将进入执行派发阶段，并基于来源工件上下文生成执行计划。",
    });
  });

  it("normalizes empty optional fields and defaults preferred agent type", () => {
    const parsed = taskCreateInputSchema.parse({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: undefined,
      title: "  ",
      goal: "  补齐任务创建链路  ",
      priority: "medium",
      intent: "implement",
      intentDetail: "   ",
    });

    expect(parsed).toMatchObject({
      workspaceId: "cworkspaceid0000000000001",
      projectId: "cprojectid0000000000000001",
      artifactId: undefined,
      title: undefined,
      goal: "补齐任务创建链路",
      priority: "medium",
      intent: "implement",
      intentDetail: undefined,
      preferredAgentType: "auto",
    });
  });

  it("surfaces inline goal validation errors in Chinese", () => {
    const errors = getTaskCreateFieldErrors({
      title: "",
      goal: "   ",
      priority: "medium",
      intent: "implement",
      intentDetail: "",
      preferredAgentType: "auto",
    });

    expect(errors.goal?.[0]).toBe("请输入任务目标。");
  });

  it("builds source-aware fallback title from goal", () => {
    expect(buildTaskTitleFromGoal({
      goal: "补齐 Story 4.1 的项目级手动建任务链路。",
      sourceArtifactName: "Story 4.1",
    })).toBe("围绕《Story 4.1》执行：补齐 Story 4.1 的项目级手动建任务链路");
  });
});
