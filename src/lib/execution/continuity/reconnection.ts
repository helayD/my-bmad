/**
 * 断线重连时的状态恢复。
 *
 * 场景（AC-2）：
 * - 执行监督器与控制面之间出现短时网络波动
 * - 连接恢复后，控制面需要获取最新的真实状态
 * - 不能展示波动前的缓存状态
 *
 * 策略：
 * - 强制从数据库重新拉取（bypass 缓存）
 * - 对比最近的心跳时间戳，确认数据新鲜度
 * - 必要时触发一次即时心跳写入
 */

import { prisma } from "@/lib/db/client";
import { getHeartbeatStatus } from "@/lib/execution/heartbeat";

export interface ReconnectionState {
  taskId: string;
  status: string;
  currentStage: string;
  currentActivity: string;
  nextStep: string;
  updatedAt: Date;
  heartbeatFresh: boolean;
  confidence: "trusted" | "stale" | "unknown";
}

/**
 * 获取重连后的最新任务状态（绕过缓存，直接查 DB）。
 */
export async function fetchReconnectionState(
  taskId: string
): Promise<ReconnectionState | null> {
  const [task, heartbeatStatus] = await Promise.all([
    // 直接查数据库（每次请求都是实时数据，无应用层缓存）
    prisma.task.findUnique({
      where: { id: taskId },
      select: {
        status: true,
        currentStage: true,
        currentActivity: true,
        nextStep: true,
        updatedAt: true,
      },
    }),
    getHeartbeatStatus(taskId),
  ]);

  if (!task) return null;

  return {
    taskId,
    status: task.status,
    currentStage: task.currentStage,
    currentActivity: task.currentActivity,
    nextStep: task.nextStep,
    updatedAt: task.updatedAt,
    heartbeatFresh: heartbeatStatus.confidence === "trusted",
    confidence: heartbeatStatus.confidence,
  };
}
