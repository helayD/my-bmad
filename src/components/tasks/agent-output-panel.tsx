"use client";

import { useEffect, useRef, useState, useCallback, useTransition } from "react";
import { createPollingFallback } from "@/lib/execution/monitor/polling-fallback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { submitSupplementaryInput } from "@/actions/execution-actions";
import type { TaskStatus } from "@/lib/execution/state-machine";

interface ParsedEvent {
  type: "progress" | "interaction_request" | "error" | "warning" | "info";
  summary: string;
  detail?: string;
  timestamp: string;
}

interface AgentOutputEvent {
  id: string;
  type: string;
  events: ParsedEvent[];
  lineOffset: number;
  timestamp: string;
}

interface InteractionRequestEvent {
  type: "interaction_request";
  requestId: string;
  taskId: string;
  title: string;
  content: string;
  context?: string;
  timestamp: string;
}

interface AgentOutputPanelProps {
  taskId: string;
  agentRunId: string;
  taskStatus?: TaskStatus | string;
}

export function AgentOutputPanel({ taskId, agentRunId, taskStatus }: AgentOutputPanelProps) {
  const [agentEvents, setAgentEvents] = useState<ParsedEvent[]>([]);
  const [interactionRequests, setInteractionRequests] = useState<InteractionRequestEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingRef = useRef<ReturnType<typeof createPollingFallback> | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  // Supplementary input state
  const [supplementaryInput, setSupplementaryInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [sentFeedback, setSentFeedback] = useState<string | null>(null);

  async function handleSendSupplementary(req?: InteractionRequestEvent) {
    const contentToSend = req?.content ?? supplementaryInput;
    if (!contentToSend?.trim()) return;

    startTransition(async () => {
      const result = await submitSupplementaryInput({
        taskId,
        agentRunId,
        content: contentToSend,
        inputType: req ? "confirmation" : "supplementary",
        interactionRequestId: req?.requestId,
      });

      if (result.success) {
        setSupplementaryInput("");
        setSentFeedback("指令已发送，Agent 正在处理……");
        setTimeout(() => setSentFeedback(null), 3000);
        toast.success("已发送：指令已送达执行会话");
      } else {
        toast.error("发送失败", {
          description: result.error ?? "无法发送指令",
        });
      }
    });
  }

  // Hooks must always be called — move conditionals inside the render logic
  const isRunning = taskStatus === "running" || taskStatus === "waiting_for_input";

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/events/tasks/${taskId}`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setSseConnected(true);
      pollingRef.current?.stop();
    };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as AgentOutputEvent | InteractionRequestEvent;

        if (data.type === "agent_output") {
          setAgentEvents((prev) => {
            const newEvents = [...prev, ...data.events].slice(-200);
            return newEvents;
          });
        }

        if (data.type === "interaction_request") {
          const irEvent = data as InteractionRequestEvent;
          setInteractionRequests((prev) => {
            const exists = prev.some((r) => r.requestId === irEvent.requestId);
            if (exists) return prev;
            return [...prev, irEvent];
          });
          setAgentEvents((prev) => [
            ...prev,
            {
              type: "interaction_request" as const,
              summary: irEvent.title ?? "Agent 请求输入",
              detail: irEvent.content,
              timestamp: irEvent.timestamp,
            },
          ].slice(-200));
        }

        if (data.type === "state_change") {
          setAgentEvents((prev) => [
            ...prev,
            {
              type: "info" as const,
              summary: "状态变更",
              detail: (data as { statusLabel?: string }).statusLabel,
              timestamp: data.timestamp,
            },
          ].slice(-200));
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setSseConnected(false);
      if (!pollingRef.current) {
        pollingRef.current = createPollingFallback(
          { taskId, intervalMs: 10_000 },
          (events) => {
            for (const ev of events as AgentOutputEvent[]) {
              if (ev.type === "agent_output") {
                setAgentEvents((prev) => [...prev, ...ev.events].slice(-200));
              }
              if (ev.type === "interaction_request") {
                const irEvent = ev as unknown as InteractionRequestEvent;
                setInteractionRequests((prev) => {
                  const exists = prev.some((r) => r.requestId === irEvent.requestId);
                  if (exists) return prev;
                  return [...prev, irEvent];
                });
              }
            }
          }
        );
        pollingRef.current.start();
      }
    };
  }, [taskId]);

  useEffect(() => {
    if (!isRunning) return;
    connectSSE();
    return () => {
      eventSourceRef.current?.close();
      pollingRef.current?.stop();
    };
  }, [connectSSE, isRunning, taskStatus]);

  if (!isRunning) {
    return null;
  }

  const hasEvents = agentEvents.length > 0 || interactionRequests.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Agent 实时输出</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`w-2 h-2 rounded-full ${sseConnected ? "bg-green-500" : "bg-yellow-500"}`}
            />
            {sseConnected ? "实时连接中" : "轮询模式"}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {interactionRequests.length > 0 && (
          <div className="mb-4 space-y-2">
            <div className="text-xs font-medium text-amber-600">待处理交互请求</div>
            {interactionRequests.map((req) => (
              <div
                key={req.requestId}
                className="rounded border border-amber-200 bg-amber-50 p-3 text-sm dark:bg-amber-950/20 dark:border-amber-800"
              >
                <div className="font-medium text-amber-700 dark:text-amber-400">{req.title}</div>
                <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                  {req.content}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 补充指令输入区域 — 仅当任务处于运行状态时显示 */}
        {(taskStatus === "running" || taskStatus === "waiting_for_input") && (
          <div className="space-y-2 pt-3 border-t">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                发送补充指令
              </span>
              {sentFeedback && (
                <span className="text-xs text-green-600">{sentFeedback}</span>
              )}
            </div>
            <div className="flex gap-2">
              <Textarea
                value={supplementaryInput}
                onChange={(e) => setSupplementaryInput(e.target.value)}
                placeholder="输入补充指令或上下文信息，发送给执行中的 Agent……"
                className="min-h-[60px] resize-none text-sm"
                disabled={isPending}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleSendSupplementary();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={() => void handleSendSupplementary()}
                disabled={!supplementaryInput.trim() || isPending}
                className="self-end"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Ctrl+Enter 快速发送
            </p>
          </div>
        )}

        {!hasEvents && (
          <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
            暂无 agent 输出内容
          </div>
        )}

        {agentEvents.length > 0 && (
          <div className="space-y-2">
            {agentEvents.map((event, i) => (
              <div
                key={i}
                className={`text-sm p-2 rounded ${
                  event.type === "interaction_request"
                    ? "bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
                    : event.type === "error"
                    ? "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400"
                    : event.type === "warning"
                    ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400"
                    : "bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{event.summary}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.timestamp).toLocaleTimeString("zh-CN")}
                  </span>
                </div>
                {event.detail && (
                  <p className="text-xs text-muted-foreground mt-1">{event.detail}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
