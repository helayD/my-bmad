/**
 * SSE 广播器 — 维护 taskId → 客户端订阅者的映射。
 *
 * 职责：
 * - 按 taskId 管理 SSE 客户端注册
 * - 提供广播接口供 OutputMonitor、状态机、心跳系统调用
 * - 支持断线重连的 catch-up 事件重发
 * - 连接生命周期管理
 */

type SSEClient = {
  id: string;
  send: (data: unknown) => void;
};

type BroadcastEvent = {
  id: string;         // 事件唯一 ID，用于去重和 catch-up
  type: string;
  data: unknown;
  timestamp: string;
  /** 输出行偏移量（用于轮询端点的增量查询） */
  lineOffset?: number;
};

// 按 taskId 存储客户端
const clientsByTask = new Map<string, Map<string, SSEClient>>();

// 按 taskId 存储最近事件（用于断线重连）
const recentEventsByTask = new Map<string, BroadcastEvent[]>();
const MAX_RECENT_EVENTS = 100;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const sseBroadcaster = {
  /**
   * 注册一个新的 SSE 客户端到 taskId 频道。
   */
  register(taskId: string, send: (data: unknown) => void): string {
    if (!clientsByTask.has(taskId)) {
      clientsByTask.set(taskId, new Map());
    }

    const clientId = generateId();
    clientsByTask.get(taskId)!.set(clientId, { id: clientId, send });
    return clientId;
  },

  /**
   * 取消注册 SSE 客户端。
   */
  unregister(taskId: string, clientId: string): void {
    const clients = clientsByTask.get(taskId);
    if (clients) {
      clients.delete(clientId);
      if (clients.size === 0) {
        clientsByTask.delete(taskId);
      }
    }
  },

  /**
   * 广播事件到 taskId 频道的所有客户端。
   */
  broadcast(taskId: string, event: Omit<BroadcastEvent, "id" | "timestamp">): void {
    const clients = clientsByTask.get(taskId);
    if (!clients || clients.size === 0) return;

    const fullEvent: BroadcastEvent = {
      ...event,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };

    // 存储到最近事件队列（用于断线重连）
    let recentEvents = recentEventsByTask.get(taskId);
    if (!recentEvents) {
      recentEvents = [];
      recentEventsByTask.set(taskId, recentEvents);
    }
    recentEvents.push(fullEvent);
    if (recentEvents.length > MAX_RECENT_EVENTS) {
      recentEvents.shift();
    }

    // 广播到所有客户端
    for (const client of clients.values()) {
      client.send(fullEvent);
    }
  },

  /**
   * 发送 catch-up 事件（断线重连时补发丢失的事件）。
   * 从 lastEventId 之后的事件开始发送。
   */
  sendCatchup(
    taskId: string,
    lastEventId: string,
    send: (data: unknown) => void
  ): void {
    const recentEvents = recentEventsByTask.get(taskId);
    if (!recentEvents) return;

    let foundLastId = false;
    for (const event of recentEvents) {
      if (event.id === lastEventId) {
        foundLastId = true;
        continue;
      }
      if (foundLastId) {
        send(event);
      }
    }
  },

  /**
   * 获取最近事件（供轮询端点调用）。
   * 按 lineOffset 过滤，避免重复推送已拉取的事件。
   */
  getRecentEvents(
    taskId: string,
    options?: { afterEventId?: string; afterLineOffset?: number }
  ): BroadcastEvent[] {
    const recentEvents = recentEventsByTask.get(taskId) ?? [];
    let startIndex = 0;

    if (options?.afterEventId) {
      const idx = recentEvents.findIndex((e) => e.id === options.afterEventId);
      startIndex = idx >= 0 ? idx + 1 : 0;
    } else if (options?.afterLineOffset !== undefined) {
      // 找到第一个 lineOffset 大于阈值的索引
      const idx = recentEvents.findIndex(
        (e) => e.lineOffset !== undefined && e.lineOffset > options.afterLineOffset!
      );
      startIndex = idx >= 0 ? idx : recentEvents.length;
    }

    return recentEvents.slice(startIndex);
  },

    /**
     * 获取当前连接的客户端数量。
     */
    getClientCount(taskId: string): number {
      return clientsByTask.get(taskId)?.size ?? 0;
    },

    /**
     * 重置所有状态（仅用于测试）。
     */
    _resetForTesting(): void {
      clientsByTask.clear();
      recentEventsByTask.clear();
    },
  };
