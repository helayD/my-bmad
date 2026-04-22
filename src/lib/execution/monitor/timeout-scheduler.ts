/**
 * 交互请求超时调度器。
 *
 * 职责（Story 5.5 AC-3 — NPR19）：
 * - 在任务进入 WAITING_FOR_INPUT 状态时启动调度
 * - 在任务离开 WAITING_FOR_INPUT 状态时取消调度
 * - 每 5 分钟检查一次 pending 交互请求的超时状态
 *
 * 推荐在 supervisor 生命周期管理的主事件循环中集成。
 */

import { checkAllPendingInteractions } from "./interaction-detector";

const _timeoutTimers = new Map<string, ReturnType<typeof setInterval>>();
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 启动交互请求超时检查调度。
 * 如果任务已存在调度，则不重复注册。
 */
export function scheduleTimeoutCheck(taskId: string): void {
  if (_timeoutTimers.has(taskId)) return;

  const timer = setInterval(async () => {
    try {
      const expiredCount = await checkAllPendingInteractions({ timeoutMs: 5 * 60 * 1000 });
      if (expiredCount > 0) {
        console.log(`[timeout-scheduler] Task ${taskId}: ${expiredCount} interaction request(s) expired.`);
      }
    } catch (err) {
      console.error(`[timeout-scheduler] Task ${taskId}: timeout check failed:`, err);
    }
  }, CHECK_INTERVAL_MS);

  _timeoutTimers.set(taskId, timer);
}

/**
 * 取消交互请求超时检查调度。
 * 当任务离开 WAITING_FOR_INPUT 状态时调用。
 */
export function cancelTimeoutCheck(taskId: string): void {
  const timer = _timeoutTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    _timeoutTimers.delete(taskId);
  }
}

/**
 * 获取当前已注册的任务数量。
 */
export function getActiveTimeoutCheckCount(): number {
  return _timeoutTimers.size;
}

/**
 * 重置所有调度器（仅用于测试）。
 */
export function _resetForTesting(): void {
  for (const timer of _timeoutTimers.values()) {
    clearInterval(timer);
  }
  _timeoutTimers.clear();
}
