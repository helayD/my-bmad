/**
 * 状态连续性管理器 — 负责在长时间运行任务中维护状态、上下文和监听三方面的连续性。
 *
 * 职责（FR25, NFR18, NFR33）：
 * - 状态连续：确保任务状态不会因时间长而丢失或降级
 * - 上下文保持：保留关键上下文快照，支持状态恢复
 * - 监听连续：确保日志和输出采集链路在长时间运行中不中断
 *
 * 上下文快照策略：
 * - 每 5 分钟记录一次完整的任务上下文快照到 Task.metadata
 * - 快照包含：currentStage、currentActivity、latestOutputOffset、产物列表
 * - 异常恢复时使用最近快照重建上下文
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";

const CONTEXT_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1_000; // 5 分钟

export interface ContinuitySnapshot {
  taskId: string;
  agentRunId: string;
  status: string;
  currentStage: string;
  currentActivity: string;
  nextStep: string;
  latestOutputOffset: number;
  artifactCount: number;
  lastHeartbeatAt: Date | null;
  snapshotAt: Date;
}

export interface ContinuityContext {
  latestSnapshot: ContinuitySnapshot | null;
  heartbeatConfidence: "trusted" | "stale" | "unknown";
  lastStateChangeAt: Date | null;
  continuousDurationMs: number | null;
}

/**
 * 获取任务的连续性上下文。
 */
export async function getContinuityContext(
  taskId: string
): Promise<ContinuityContext> {
  const [task, latestHeartbeat] = await Promise.all([
    prisma.task.findUnique({
      where: { id: taskId },
      select: {
        status: true,
        currentStage: true,
        currentActivity: true,
        nextStep: true,
        updatedAt: true,
        metadata: true,
      },
    }),
    prisma.heartbeat.findFirst({
      where: { taskId },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    }),
  ]);

  if (!task) {
    return {
      latestSnapshot: null,
      heartbeatConfidence: "unknown",
      lastStateChangeAt: null,
      continuousDurationMs: null,
    };
  }

  const isRunning = ["starting", "running", "waiting_for_input", "recovering"].includes(
    task.status
  );

  let confidence: ContinuityContext["heartbeatConfidence"] = "unknown";
  if (latestHeartbeat) {
    const ageMs = Date.now() - latestHeartbeat.timestamp.getTime();
    confidence = ageMs <= 60_000 ? "trusted" : ageMs <= 120_000 ? "stale" : "unknown";
  }

  // 如果任务在运行且心跳未知超过阈值，连续运行时长不计算
  const continuousDurationMs =
    isRunning && latestHeartbeat
      ? Date.now() - latestHeartbeat.timestamp.getTime()
      : null;

  // 从 metadata 中提取最新快照
  const metadata = task.metadata as Record<string, unknown> | null;
  const snapshot = metadata?.["_lastContinuitySnapshot"] as {
    currentStage: string;
    currentActivity: string;
    nextStep: string;
    latestOutputOffset: number;
    artifactCount: number;
    snapshotAt: string;
  } | null;

  return {
    latestSnapshot: snapshot
      ? {
          taskId,
          agentRunId: "",
          status: task.status,
          currentStage: task.currentStage,
          currentActivity: task.currentActivity,
          nextStep: task.nextStep,
          latestOutputOffset: snapshot.latestOutputOffset ?? 0,
          artifactCount: snapshot.artifactCount ?? 0,
          lastHeartbeatAt: latestHeartbeat?.timestamp ?? null,
          snapshotAt: new Date(snapshot.snapshotAt),
        }
      : null,
    heartbeatConfidence: confidence,
    lastStateChangeAt: task.updatedAt,
    continuousDurationMs,
  };
}

/**
 * 定期保存上下文快照（由 HeartbeatScheduler 在心跳时调用）。
 */
export async function saveContinuitySnapshot(
  taskId: string,
  snapshot: {
    latestOutputOffset: number;
    artifactCount: number;
  }
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      status: true,
      currentStage: true,
      currentActivity: true,
      nextStep: true,
      metadata: true,
    },
  });

  if (!task) return;

  // 只对运行中任务保存快照
  const isRunning = ["starting", "running", "waiting_for_input", "recovering"].includes(
    task.status
  );
  if (!isRunning) return;

  const now = new Date();
  const currentMetadata = (task.metadata ?? {}) as Record<string, unknown>;

  // 检查是否需要保存（每 5 分钟一次）
  const lastSnapshotAt = currentMetadata["_lastContinuitySnapshotAt"] as string | null;
  if (
    lastSnapshotAt &&
    now.getTime() - new Date(lastSnapshotAt).getTime() < CONTEXT_SNAPSHOT_INTERVAL_MS
  ) {
    return;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      metadata: {
        ...currentMetadata,
        _lastContinuitySnapshot: {
          currentStage: task.currentStage,
          currentActivity: task.currentActivity,
          nextStep: task.nextStep,
          latestOutputOffset: snapshot.latestOutputOffset,
          artifactCount: snapshot.artifactCount,
          snapshotAt: now.toISOString(),
        },
        _lastContinuitySnapshotAt: now.toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
}
