/**
 * 轮询兜底 — 当 SSE 不可用时，通过 HTTP 轮询获取最新状态。
 *
 * 架构要求（混合接口模式 — SSE 优先、轮询兜底）：
 * - SSE 连接时使用 SSE 获取实时更新
 * - SSE 断开或不可用时，自动降级到轮询
 * - 轮询端点返回自上次请求以来的所有增量事件
 * - 轮询间隔：10 秒（NFR3 延迟 < 15 秒，轮询间隔应小于此值）
 */

export interface PollingFallbackConfig {
  taskId: string;
  /** 轮询间隔（毫秒） */
  intervalMs?: number;
  /** SSE 可用时自动停止轮询 */
  sseAvailable?: boolean;
}

export interface PollingState {
  lastEventId: string | null;
  lastLineOffset: number;
  lastTimestamp: string | null;
}

/**
 * 创建轮询管理器。
 * 当 SSE 连接断开时，UI 层调用 start() 启动轮询；
 * 当 SSE 连接恢复时，调用 stop() 停止轮询。
 */
export function createPollingFallback(
  config: PollingFallbackConfig,
  onEvents: (events: unknown[]) => void
) {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const state: PollingState = {
    lastEventId: null,
    lastLineOffset: 0,
    lastTimestamp: null,
  };

  async function poll() {
    try {
      const params = new URLSearchParams();
      if (state.lastEventId) params.set("after_event", state.lastEventId);
      if (state.lastLineOffset > 0) params.set("after_line_offset", String(state.lastLineOffset));

      const res = await fetch(`/api/events/tasks/${config.taskId}/poll?${params}`);
      if (!res.ok) return;

      const data = await res.json();
      if (data.events && data.events.length > 0) {
        // 更新轮询状态
        const lastEvent = data.events[data.events.length - 1] as {
          id: string;
          lineOffset?: number;
          timestamp: string;
        };
        state.lastEventId = lastEvent.id;
        state.lastLineOffset = lastEvent.lineOffset ?? state.lastLineOffset;
        state.lastTimestamp = lastEvent.timestamp;

        onEvents(data.events);
      }
    } catch {
      // 轮询失败，继续重试
    }
  }

  return {
    start() {
      if (intervalId !== null) return;
      void poll(); // 立即执行一次
      intervalId = setInterval(poll, config.intervalMs ?? 10_000);
    },
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    getState(): PollingState {
      return { ...state };
    },
    setState(newState: Partial<PollingState>) {
      Object.assign(state, newState);
    },
  };
}
