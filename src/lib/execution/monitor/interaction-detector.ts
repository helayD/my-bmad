/**
 * 交互请求检测器 — 当 OutputParser 识别到交互请求时触发。
 *
 * 职责（FR26, AC-2）：
 * - 接收 ParsedEvent 中 type="interaction_request" 的事件
 * - 创建 InteractionRequest 记录到数据库
 * - 通过 SSE 推送到控制面
 * - 触发状态变更：RUNNING → WAITING_FOR_INPUT
 */

import { prisma } from "@/lib/db/client";
import { sseBroadcaster } from "./sse-broadcaster";
import { transitionTask } from "@/lib/execution/state-machine";

export interface DetectInteractionParams {
  taskId: string;
  agentRunId: string;
  rawLine: string;
  summary: string;
  detail?: string;
  confidence: "high" | "medium" | "low";
}

/**
 * 检测并记录交互请求。
 * 如果同一行内容已在最近 60 秒内记录过（去重），则跳过。
 */
export async function detectAndRecordInteraction(
  params: DetectInteractionParams
): Promise<{ created: boolean; requestId?: string }> {
  const { taskId, agentRunId, rawLine, summary, detail, confidence } = params;

  // 去重：检查最近 60 秒内是否有相同的交互请求
  const recentCutoff = new Date(Date.now() - 60_000);
  const existing = await prisma.interactionRequest.findFirst({
    where: {
      taskId,
      createdAt: { gte: recentCutoff },
      content: { contains: rawLine.substring(0, 100) },
    },
  });

  if (existing) {
    return { created: false };
  }

  // 创建 InteractionRequest 记录
  const request = await prisma.interactionRequest.create({
    data: {
      taskId,
      agentRunId,
      type: "input_required",
      title: summary,
      content: rawLine,
      context: detail ? { detail } : undefined,
      confidence,
      status: "pending",
    },
  });

  // 触发状态变更：RUNNING → WAITING_FOR_INPUT
  // transitionTask() 接受单个 TransitionInput 对象参数
  await transitionTask({
    taskId,
    toStatus: "waiting_for_input",
    trigger: "agent_request_input",
    actorType: "agent",
    reason: `Agent 请求用户输入: ${summary}`,
  });

  // 通过 SSE 广播交互请求事件
  sseBroadcaster.broadcast(taskId, {
    type: "interaction_request",
    data: {
      requestId: request.id,
      taskId,
      title: summary,
      content: rawLine,
      context: detail,
    },
  });

  return { created: true, requestId: request.id };
}

// ── Timeout Detection ───────────────────────────────────────────────────────────

export interface InteractionTimeoutConfig {
  /** 超时时间（毫秒），默认 5 分钟 */
  timeoutMs?: number;
}

/**
 * 检查交互请求是否超时。
 * 如果超时应执行升级操作：标记为 expired + 状态回转 + SSE 广播。
 */
export async function checkInteractionTimeout(
  interactionRequestId: string,
  config: InteractionTimeoutConfig = {},
): Promise<{ expired: boolean; wasExpired: boolean }> {
  const { timeoutMs = 5 * 60 * 1000 } = config;

  const request = await prisma.interactionRequest.findUnique({
    where: { id: interactionRequestId },
    select: { id: true, taskId: true, status: true, createdAt: true, title: true },
  });

  if (!request) {
    return { expired: false, wasExpired: false };
  }

  if (request.status !== "pending") {
    return { expired: false, wasExpired: false };
  }

  const ageMs = Date.now() - request.createdAt.getTime();
  const expired = ageMs > timeoutMs;

  if (expired) {
    // 标记为超时
    await prisma.interactionRequest.update({
      where: { id: interactionRequestId },
      data: { status: "expired" },
    });

    // 触发任务状态回转（如果任务仍处于 WAITING_FOR_INPUT）
    const task = await prisma.task.findUnique({
      where: { id: request.taskId },
      select: { id: true, status: true, currentAgentRunId: true },
    });

    if (task && task.status === "waiting_for_input") {
      await transitionTask({
        taskId: request.taskId,
        toStatus: "running",
        trigger: "user_response",
        actorType: "system",
        reason: `交互请求「${request.title}」超时未处理`,
      });
    }

    // 广播超时事件
    sseBroadcaster.broadcast(request.taskId, {
      type: "interaction_timeout",
      data: {
        requestId: interactionRequestId,
        taskId: request.taskId,
        ageMs,
        timeoutMs,
        timestamp: new Date().toISOString(),
      },
    });
  }

  return { expired, wasExpired: expired };
}

/**
 * 批量检查所有 pending 交互请求的超时状态。
 * 由定时任务或心跳调度器定期调用。
 */
export async function checkAllPendingInteractions(
  config: InteractionTimeoutConfig = {},
): Promise<number> {
  const { timeoutMs = 5 * 60 * 1000 } = config;
  const cutoff = new Date(Date.now() - timeoutMs);

  const timedOutRequests = await prisma.interactionRequest.findMany({
    where: {
      status: "pending",
      createdAt: { lt: cutoff },
    },
    select: { id: true },
  });

  let expiredCount = 0;
  for (const req of timedOutRequests) {
    const result = await checkInteractionTimeout(req.id, config);
    if (result.wasExpired) expiredCount++;
  }

  return expiredCount;
}
