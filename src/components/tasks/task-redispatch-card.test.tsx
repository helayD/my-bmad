import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArtifactTaskHistoryAgentRun } from "@/lib/tasks";

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

vi.mock("@/actions/execution-actions", () => ({
  redispatchTaskAction: vi.fn(),
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

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked }: { checked?: boolean }) => <input checked={checked} readOnly type="checkbox" />,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? null}</span>,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ value, placeholder }: { value?: string; placeholder?: string }) => (
    <textarea readOnly value={value} placeholder={placeholder} />
  ),
}));

const { TaskRedispatchCard } = await import("./task-redispatch-card");

function installDefaultStateMocks() {
  mockUseState.mockImplementation((initialValue: unknown) => [
    typeof initialValue === "function" ? (initialValue as () => unknown)() : initialValue,
    vi.fn(),
  ]);
}

function createAgentRuns(): ArtifactTaskHistoryAgentRun[] {
  return [
    {
      id: "run-current",
      agentType: "codex",
      agentTypeLabel: "Codex",
      status: "dispatched",
      statusLabel: "已派发",
      createdAt: "2026-04-14T02:00:00.000Z",
      startedAt: null,
      completedAt: null,
      terminatedAt: null,
      supersededAt: null,
      selectionReasonSummary: "初次派发到 Codex。",
      decisionSource: "intent-heuristic",
      replacesRunId: "run-previous",
      replacementRunId: null,
      terminationReasonSummary: null,
      isCurrent: true,
      summary: "等待新会话启动。",
    },
    {
      id: "run-previous",
      agentType: "claude-code",
      agentTypeLabel: "Claude Code",
      status: "superseded",
      statusLabel: "已替代",
      createdAt: "2026-04-14T01:30:00.000Z",
      startedAt: "2026-04-14T01:35:00.000Z",
      completedAt: null,
      terminatedAt: "2026-04-14T01:55:00.000Z",
      supersededAt: "2026-04-14T01:55:00.000Z",
      selectionReasonSummary: "旧路由策略。",
      decisionSource: "manual-reroute",
      replacesRunId: null,
      replacementRunId: "run-current",
      terminationReasonSummary: "旧会话已终止。",
      isCurrent: false,
      summary: "旧会话已终止。",
    },
  ];
}

function createProps(
  overrides: Partial<Parameters<typeof TaskRedispatchCard>[0]> = {},
): Parameters<typeof TaskRedispatchCard>[0] {
  return {
    workspaceId: "cworkspaceid0000000000001",
    projectId: "cprojectid0000000000000001",
    taskId: "ctaskid00000000000000001",
    taskTitle: "调整执行路由",
    taskStatus: "dispatched",
    currentActivity: "已重新派发，等待新会话启动。",
    canManageExecution: true,
    routingReason: "当前任务更适合先做方案分析。",
    agentRuns: createAgentRuns(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultStateMocks();
});

describe("TaskRedispatchCard", () => {
  it("shows reroute entry and run history for dispatchable tasks", () => {
    const markup = renderToStaticMarkup(<TaskRedispatchCard {...createProps()} />);

    expect(markup).toContain("执行路由");
    expect(markup).toContain("当前 Run：run-current");
    expect(markup).toContain("已改派 1 次");
    expect(markup).toContain("Run 历史");
    expect(markup).toContain("重新派发");
    expect(markup).toContain("当前任务更适合先做方案分析。");
  });

  it("shows read-only permission feedback when execution cannot be managed", () => {
    const markup = renderToStaticMarkup(
      <TaskRedispatchCard
        {...createProps({
          canManageExecution: false,
        })}
      />,
    );

    expect(markup).toContain("你当前只有查看权限，不能调整路由。");
    expect(markup).not.toContain("重新派发会创建新的 Agent Run，而不是原地修改当前 Run。");
  });

  it("renders running redispatch confirmation details when the dialog is open", () => {
    mockUseState
      .mockImplementationOnce(() => [true, vi.fn()])
      .mockImplementationOnce(() => [null, vi.fn()])
      .mockImplementationOnce(() => ["改派到 Claude Code 处理分析任务。", vi.fn()])
      .mockImplementationOnce(() => [true, vi.fn()])
      .mockImplementationOnce(() => ["claude-code", vi.fn()]);

    const markup = renderToStaticMarkup(
      <TaskRedispatchCard
        {...createProps({
          taskStatus: "in-progress",
          agentRuns: [
            {
              ...createAgentRuns()[0],
              status: "running",
              statusLabel: "执行中",
            },
          ],
        })}
      />,
    );

    expect(markup).toContain("确认重新派发");
    expect(markup).toContain("重新派发会先终止当前执行，再创建新的 Run。");
    expect(markup).toContain("新 Run 创建后，任务会回到“已派发”，等待新会话启动。");
    expect(markup).toContain("我确认终止当前执行并重新派发到新的 Agent。");
    expect(markup).toContain("调整原因");
  });
});
