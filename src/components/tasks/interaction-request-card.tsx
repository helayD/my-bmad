"use client";

import { useState, useTransition } from "react";
import { respondToInteractionRequest } from "@/actions/execution-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Users, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface InteractionRequestCardProps {
  requestId: string;
  taskId: string;
  agentRunId: string;
  title: string;
  content: string;
  context?: string;
  confidence?: "high" | "medium" | "low";
  createdAt: Date;
  /** 可选：初始建议动作（如 "y" 表示批准，"n" 表示驳回） */
  suggestedActions?: { label: string; value: string }[];
  /** 是否展示超时警告（由父组件从 SSE 超时事件中获取） */
  isExpired?: boolean;
  /** 父组件传入的回调：响应成功后调用 */
  onResponse?: () => void;
}

const CONFIDENCE_LABELS = {
  high: { zh: "高置信", variant: "default" as const },
  medium: { zh: "中置信", variant: "secondary" as const },
  low: { zh: "低置信", variant: "outline" as const },
};

const ACTION_LABELS = {
  approve: { zh: "批准", icon: CheckCircle },
  reject: { zh: "驳回", icon: XCircle },
  delegate: { zh: "改派", icon: Users },
  manual_takeover: { zh: "人工接管", icon: AlertTriangle },
};

export function InteractionRequestCard({
  requestId,
  taskId,
  agentRunId,
  title,
  content,
  context,
  confidence = "medium",
  createdAt,
  suggestedActions,
  isExpired = false,
  onResponse,
}: InteractionRequestCardProps) {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [responseContent, setResponseContent] = useState("");
  const [isPending, startTransition] = useTransition();

  const confidenceInfo = CONFIDENCE_LABELS[confidence];
  const showExpiredWarning = isExpired;

  function handleQuickAction(action: "approve" | "reject") {
    setSelectedAction(action);
    setResponseContent(
      action === "approve"
        ? (suggestedActions?.find((a) => a.value === "y")?.value ?? "y")
        : (suggestedActions?.find((a) => a.value === "n")?.value ?? "n"),
    );
  }

  function handleSubmit(finalAction?: "approve" | "reject" | "delegate" | "manual_takeover") {
    const action = finalAction ?? selectedAction ?? "approve";
    if (!action) return;

    startTransition(async () => {
      const result = await respondToInteractionRequest({
        interactionRequestId: requestId,
        taskId,
        agentRunId,
        responseType: action as "approve" | "reject" | "delegate" | "manual_takeover",
        responseContent: responseContent || undefined,
      });

      if (result.success) {
        toast.success(
          `已${ACTION_LABELS[result.data.responseType as keyof typeof ACTION_LABELS]?.zh ?? "响应"}交互请求`,
          { description: "Agent 将继续执行" },
        );
        onResponse?.();
      } else {
        toast.error("响应失败", { description: result.error });
      }
    });
  }

  return (
    <Card
      className={`relative ${
        showExpiredWarning
          ? "border-red-300 bg-red-50/50 dark:bg-red-950/10"
          : "border-amber-200 bg-amber-50/50 dark:bg-amber-950/10"
      }`}
      tabIndex={0}
      role="article"
      aria-label={`交互请求: ${title}`}
    >
      {/* 超时标记 */}
      {showExpiredWarning && (
        <div className="absolute -top-2 -right-2">
          <Badge variant="destructive" className="text-xs gap-1">
            <AlertTriangle className="w-3 h-3" />
            已超时
          </Badge>
        </div>
      )}

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{title}</span>
            <Badge variant={confidenceInfo.variant} className="text-xs">
              {confidenceInfo.zh}
            </Badge>
            {showExpiredWarning && (
              <Badge variant="destructive" className="text-xs">
                超时未处理
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {createdAt.toLocaleTimeString("zh-CN")}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* 请求内容 */}
        <div className="rounded bg-background/80 p-3 text-sm whitespace-pre-wrap">
          {content}
        </div>

        {/* 上下文摘要 */}
        {context && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">上下文：</span>
            {context}
          </div>
        )}

        {/* 快速操作按钮 */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 bg-green-600 hover:bg-green-700"
            onClick={() => handleSubmit("approve")}
            disabled={isPending}
            tabIndex={0}
          >
            <CheckCircle className="w-4 h-4" />
            批准
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={() => handleSubmit("reject")}
            disabled={isPending}
            tabIndex={0}
          >
            <XCircle className="w-4 h-4" />
            驳回
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={() => handleSubmit("delegate")}
            disabled={isPending}
            tabIndex={0}
          >
            <Users className="w-4 h-4" />
            改派
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={() => handleSubmit("manual_takeover")}
            disabled={isPending}
            tabIndex={0}
          >
            <AlertTriangle className="w-4 h-4" />
            人工接管
          </Button>
        </div>

        {/* 响应输入区（展开时显示） */}
        {(selectedAction || showExpiredWarning) && (
          <div className="space-y-2 pt-2 border-t">
            <Textarea
              value={responseContent}
              onChange={(e) => setResponseContent(e.target.value)}
              placeholder={
                selectedAction === "approve"
                  ? "补充说明（可选），将发送给 Agent……"
                  : selectedAction === "reject"
                    ? "驳回原因（必填）……"
                    : "备注（可选）……"
              }
              className="min-h-[60px] resize-none text-sm"
              disabled={isPending}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              aria-label="响应内容"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Ctrl+Enter 快速提交
              </span>
              <Button
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={
                  isPending ||
                  (selectedAction === "reject" && !responseContent.trim())
                }
              >
                {isPending ? "提交中……" : "提交响应"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
