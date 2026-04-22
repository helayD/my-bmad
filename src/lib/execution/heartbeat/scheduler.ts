/**
 * 心跳调度器 — 在执行监督器进程内定期记录心跳。
 *
 * 职责（FR35, NFR3, NFR12, NFR18）：
 * - 定期向 Heartbeat 表写入心跳记录（默认间隔 30 秒）
 * - 捕获当前任务状态快照（状态、阶段、最近活动）
 * - 记录 agent 进程的 PID（用于进程存活检测）
 * - 在 session 结束时自动停止
 */

import { recordHeartbeat, type RecordHeartbeatParams } from "./recorder";
import { getProcessInfo } from "./process-info";

// ── Module-level scheduler registry ────────────────────────────────────────────
// Stores active scheduler instances by taskId for cross-module access.
// In serverless environments, each invocation is a fresh process, so this
// registry is per-invocation. For persistent processes, it persists across calls.

const _schedulers = new Map<string, HeartbeatScheduler>();

export function registerScheduler(taskId: string, scheduler: HeartbeatScheduler): void {
  _schedulers.set(taskId, scheduler);
}

export function getScheduler(taskId: string): HeartbeatScheduler | undefined {
  return _schedulers.get(taskId);
}

export function unregisterScheduler(taskId: string): void {
  _schedulers.delete(taskId);
}

const SNAPSHOT_INTERVAL_HEARTBEATS = 10; // 10 × 30s = 5 分钟

export class HeartbeatScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;
  private taskId: string;
  private agentRunId: string;
  private initialStatus: string;
  private intervalMs: number;
  private heartbeatCount = 0;

  constructor(
    sessionId: string,
    taskId: string,
    agentRunId: string,
    initialStatus: string,
    intervalMs = 30_000 // 默认 30 秒
  ) {
    this.sessionId = sessionId;
    this.taskId = taskId;
    this.agentRunId = agentRunId;
    this.initialStatus = initialStatus;
    this.intervalMs = intervalMs;
  }

  /** 启动心跳调度 */
  start(initialSnapshot: RecordHeartbeatParams): void {
    if (this.intervalId !== null) return;

    // 立即记录一次心跳
    this.heartbeatCount = 0;
    void this.record(initialSnapshot);
    void this.trySnapshot(initialSnapshot);

    this.intervalId = setInterval(() => {
      this.heartbeatCount++;
      void this.record(initialSnapshot);
      void this.trySnapshot(initialSnapshot);
    }, this.intervalMs);
  }

  /** 停止心跳调度 */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    unregisterScheduler(this.taskId);
  }

  /** 每 10 次心跳（约 5 分钟）触发一次上下文快照保存 */
  private async trySnapshot(snapshot: RecordHeartbeatParams): Promise<void> {
    if (this.heartbeatCount > 0 && this.heartbeatCount % SNAPSHOT_INTERVAL_HEARTBEATS !== 0) {
      return;
    }
    try {
      const { saveContinuitySnapshot } = await import("@/lib/execution/continuity");
      await saveContinuitySnapshot(this.taskId, {
        latestOutputOffset: 0,
        artifactCount: 0,
      });
    } catch (err) {
      // 快照保存失败不影响心跳记录
      console.error("[HeartbeatScheduler] Failed to save continuity snapshot:", err);
    }
  }

  /** 记录一次心跳 */
  private async record(snapshot: RecordHeartbeatParams): Promise<void> {
    try {
      const processInfo = await getProcessInfo();
      await recordHeartbeat({
        executionSessionId: this.sessionId,
        taskId: this.taskId,
        agentRunId: this.agentRunId,
        status: snapshot.status ?? this.initialStatus,
        currentStage: snapshot.currentStage,
        currentActivity: snapshot.currentActivity,
        lastOutputHash: snapshot.lastOutputHash,
        pid: processInfo?.pid,
        metadata: {
          hostname: processInfo?.hostname ?? process.env["HOSTNAME"] ?? "unknown",
        },
      });
    } catch (err) {
      // 心跳记录失败不应中断主流程
      console.error("[HeartbeatScheduler] Failed to record heartbeat:", err);
    }
  }

  /** 在主流程获取当前状态快照后调用，更新快照信息并尝试保存 */
  async recordWithSnapshot(snapshot: {
    status?: string;
    currentStage?: string;
    currentActivity?: string;
    lastOutputHash?: string;
  }): Promise<void> {
    const recordParams: RecordHeartbeatParams = {
      executionSessionId: this.sessionId,
      taskId: this.taskId,
      agentRunId: this.agentRunId,
      status: snapshot.status ?? this.initialStatus,
      currentStage: snapshot.currentStage,
      currentActivity: snapshot.currentActivity,
      lastOutputHash: snapshot.lastOutputHash,
    };
    await this.record(recordParams);
    void this.trySnapshot(recordParams);
  }
}
