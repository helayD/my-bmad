import { prisma } from "@/lib/db/client";

export interface HeartbeatTimeoutConfig {
  /** 心跳超时阈值（毫秒），默认 60 秒 */
  timeoutMs?: number;
}

export interface HeartbeatStatus {
  taskId: string;
  lastHeartbeatAt: Date | null;
  lastStatus: string | null;
  lastStage: string | null;
  lastActivity: string | null;
  isStale: boolean;
  staleDurationMs: number | null;
  confidence: "trusted" | "stale" | "unknown";
}

/**
 * 获取任务的心跳可信度状态。
 *
 * 规则（NFR3, NFR12, NFR39）：
 * - 最近 60 秒有心跳 → confidence = "trusted"
 * - 60 秒至 120 秒有心跳 → confidence = "stale"（可感知滞后）
 * - 超过 120 秒无心跳 → confidence = "unknown"（状态不可信）
 * - 任务未在运行 → confidence = "unknown"
 */
export async function getHeartbeatStatus(
  taskId: string,
  config: HeartbeatTimeoutConfig = {}
): Promise<HeartbeatStatus> {
  const { timeoutMs = 60_000 } = config;
  const staleThresholdMs = timeoutMs * 2; // 120 秒后标记为 unknown

  const latestHeartbeat = await prisma.heartbeat.findFirst({
    where: { taskId },
    orderBy: { timestamp: "desc" },
    select: {
      timestamp: true,
      status: true,
      currentStage: true,
      currentActivity: true,
    },
  });

  if (!latestHeartbeat) {
    return {
      taskId,
      lastHeartbeatAt: null,
      lastStatus: null,
      lastStage: null,
      lastActivity: null,
      isStale: true,
      staleDurationMs: null,
      confidence: "unknown",
    };
  }

  const now = new Date();
  const ageMs = now.getTime() - latestHeartbeat.timestamp.getTime();

  return {
    taskId,
    lastHeartbeatAt: latestHeartbeat.timestamp,
    lastStatus: latestHeartbeat.status,
    lastStage: latestHeartbeat.currentStage ?? null,
    lastActivity: latestHeartbeat.currentActivity ?? null,
    isStale: ageMs > timeoutMs,
    staleDurationMs: ageMs,
    confidence: ageMs <= timeoutMs
      ? "trusted"
      : ageMs <= staleThresholdMs
      ? "stale"
      : "unknown",
  };
}

/**
 * 批量获取多个任务的心跳状态（用于列表页）。
 */
export async function batchGetHeartbeatStatus(
  taskIds: string[],
  config: HeartbeatTimeoutConfig = {}
): Promise<Map<string, HeartbeatStatus>> {
  const results = await Promise.all(
    taskIds.map((id) => getHeartbeatStatus(id, config))
  );
  return new Map(results.map((r) => [r.taskId, r]));
}
