/**
 * SSE endpoint: /api/events/tasks/[taskId]
 *
 * 职责（架构要求 — 实时更新优先 SSE、轮询兜底）：
 * - 建立 taskId 对应的 SSE 连接
 * - 将客户端注册到 taskId 的广播组
 * - 推送：agent 输出事件、状态变更、心跳、交互请求
 * - 连接断开时自动清理注册
 * - 支持断线重连：客户端可带 Last-Event-ID
 */

import { NextRequest } from "next/server";
import { sseBroadcaster } from "@/lib/execution/monitor/sse-broadcaster";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 注册到 taskId 的广播组
      const clientId = sseBroadcaster.register(taskId, (data) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // 客户端已断开，cleanup 由 unregister 处理
        }
      });

      // 处理 Last-Event-ID（断线重连）
      const lastEventId = request.headers.get("Last-Event-ID");
      if (lastEventId) {
        sseBroadcaster.sendCatchup(taskId, lastEventId, (data) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        });
      }

      // 心跳注释，保持连接活跃
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // 清理函数
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        sseBroadcaster.unregister(taskId, clientId);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // 禁用 Nginx 缓冲
    },
  });
}
