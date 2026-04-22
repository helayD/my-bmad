/**
 * Unit tests for InteractionRequestCard component (Story 5.5 — AC-1, AC-4).
 */

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractionRequestCard } from "../interaction-request-card";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: vi.fn((init: unknown) => [init, vi.fn()]),
    useTransition: vi.fn(() => [false, vi.fn()]),
  };
});

vi.mock("@/actions/execution-actions", () => ({
  respondToInteractionRequest: vi.fn(),
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
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ value }: { value: string }) => <textarea value={value} />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("InteractionRequestCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应正确渲染标题和内容", () => {
    const result = renderToStaticMarkup(
      <InteractionRequestCard
        requestId="req-1"
        taskId="task-1"
        agentRunId="run-1"
        title="确认删除旧表"
        content="是否删除 user_history 表？"
        createdAt={new Date("2026-04-22T10:00:00Z")}
      />,
    );

    expect(result).toContain("确认删除旧表");
    expect(result).toContain("是否删除 user_history 表？");
  });

  it("应渲染四个操作按钮", () => {
    const result = renderToStaticMarkup(
      <InteractionRequestCard
        requestId="req-1"
        taskId="task-1"
        agentRunId="run-1"
        title="确认请求"
        content="继续执行？"
        createdAt={new Date()}
      />,
    );

    expect(result).toContain("批准");
    expect(result).toContain("驳回");
    expect(result).toContain("改派");
    expect(result).toContain("人工接管");
  });

  it("超时状态应显示警告", () => {
    const result = renderToStaticMarkup(
      <InteractionRequestCard
        requestId="req-1"
        taskId="task-1"
        agentRunId="run-1"
        title="确认请求"
        content="继续？"
        createdAt={new Date()}
        isExpired={true}
      />,
    );

    expect(result).toContain("已超时");
    expect(result).toContain("超时未处理");
  });

  it("应渲染置信度标签", () => {
    const result = renderToStaticMarkup(
      <InteractionRequestCard
        requestId="req-1"
        taskId="task-1"
        agentRunId="run-1"
        title="高置信请求"
        content="确认执行"
        createdAt={new Date()}
        confidence="high"
      />,
    );

    expect(result).toContain("高置信");
  });

  it("应渲染上下文信息", () => {
    const result = renderToStaticMarkup(
      <InteractionRequestCard
        requestId="req-1"
        taskId="task-1"
        agentRunId="run-1"
        title="上下文请求"
        content="需要确认"
        context="这是在执行删除操作前需要确认"
        createdAt={new Date()}
      />,
    );

    expect(result).toContain("上下文：");
    expect(result).toContain("这是在执行删除操作前需要确认");
  });
});
