import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockUseState = vi.fn();

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useState: mockUseState,
    useTransition: vi.fn(() => [false, vi.fn()]),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/actions/execution-actions", () => ({
  dispatchTaskAction: vi.fn(),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? null}</span>,
}));

const { TaskDispatchCard } = await import("./task-dispatch-card");

function installDefaultStateMocks() {
  mockUseState.mockImplementation((initialValue: unknown) => [
    typeof initialValue === "function" ? (initialValue as () => unknown)() : initialValue,
    vi.fn(),
  ]);
}

function createProps(
  overrides: Partial<Parameters<typeof TaskDispatchCard>[0]> = {},
): Parameters<typeof TaskDispatchCard>[0] {
  return {
    workspaceId: "cworkspaceid0000000000001",
    projectId: "cprojectid0000000000000001",
    taskId: "ctaskid00000000000000001",
    taskTitle: "实现 Agent 自动路由",
    taskStatus: "planned",
    canManageExecution: true,
    dispatchState: "ready",
    workspaceRoutingPreference: "auto",
    preferredAgentType: null,
    previewAgentType: "codex",
    previewAgentLabel: "Codex",
    previewReasonSummary: "系统根据任务意图与上下文判断该任务更适合直接编码落地。",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultStateMocks();
});

describe("TaskDispatchCard", () => {
  it("shows auto-routing guidance for planned tasks", () => {
    const markup = renderToStaticMarkup(
      <TaskDispatchCard {...createProps()} />,
    );

    expect(markup).toContain("首次派发");
    expect(markup).toContain("等待派发");
    expect(markup).toContain("路由模式：自动选择");
    expect(markup).toContain("派发任务");
    expect(markup).toContain("自动路由会保持可解释");
    expect(markup).toContain("预计 Agent：Codex");
    expect(markup).not.toContain("指定 Agent");
  });

  it("shows manual agent selection when workspace requires it", () => {
    const markup = renderToStaticMarkup(
      <TaskDispatchCard
        {...createProps({
          dispatchState: "selection-required",
          workspaceRoutingPreference: "manual",
          previewAgentType: "codex",
          previewAgentLabel: "Codex",
          previewReasonSummary: "当前工作空间要求人工指定 Agent。系统已给出推荐，但不会自动派发。",
        })}
      />,
    );

    expect(markup).toContain("等待指定 Agent");
    expect(markup).toContain("路由模式：人工指定");
    expect(markup).toContain("系统推荐：Codex");
    expect(markup).toContain("指定 Agent");
    expect(markup).toContain("推荐理由：当前工作空间要求人工指定 Agent。系统已给出推荐，但不会自动派发。");
    expect(markup).toContain("更适合明确、可直接开始编码的任务。");
    expect(markup).toContain("确认派发");
  });

  it("shows approval-required copy before dispatch is allowed", () => {
    const markup = renderToStaticMarkup(
      <TaskDispatchCard
        {...createProps({
          dispatchState: "approval-required",
          previewAgentType: null,
          previewAgentLabel: null,
          previewReasonSummary: null,
        })}
      />,
    );

    expect(markup).toContain("等待审批");
    expect(markup).toContain("已计划，等待审批通过。");
    expect(markup).toContain("审批通过后才会进入已派发");
    expect(markup).toContain("当前任务仍在等待审批。");
    expect(markup).not.toContain("指定 Agent");
  });

  it("shows read-only feedback when execution permission is unavailable", () => {
    const markup = renderToStaticMarkup(
      <TaskDispatchCard
        {...createProps({
          canManageExecution: false,
        })}
      />,
    );

    expect(markup).toContain("你当前只有查看权限，不能发起任务派发。");
  });
});
