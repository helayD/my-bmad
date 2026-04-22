import { describe, it, expect, vi, beforeEach } from "vitest";

let testCounter = 0;

function uid(): string {
  return `test-${++testCounter}-${Date.now()}`;
}

const sharedState = {
  clientsByTask: new Map<string, Map<string, { id: string; send: (data: unknown) => void }>>(),
  recentEventsByTask: new Map<string, Array<{ id: string; type: string; data: unknown; timestamp: string; lineOffset?: number }>>(),
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const MAX_RECENT_EVENTS = 100;

const broadcaster = {
  register(taskId: string, send: (data: unknown) => void): string {
    if (!sharedState.clientsByTask.has(taskId)) {
      sharedState.clientsByTask.set(taskId, new Map());
    }
    const clientId = generateId();
    sharedState.clientsByTask.get(taskId)!.set(clientId, { id: clientId, send });
    return clientId;
  },

  unregister(taskId: string, clientId: string): void {
    const clients = sharedState.clientsByTask.get(taskId);
    if (clients) {
      clients.delete(clientId);
      if (clients.size === 0) sharedState.clientsByTask.delete(taskId);
    }
  },

  // 注意：只有存在注册客户端时才会存储事件
  broadcast(taskId: string, event: { type: string; data: unknown; lineOffset?: number }): void {
    const clients = sharedState.clientsByTask.get(taskId);
    if (!clients || clients.size === 0) return;

    const fullEvent = {
      ...event,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };

    let recent = sharedState.recentEventsByTask.get(taskId);
    if (!recent) {
      recent = [];
      sharedState.recentEventsByTask.set(taskId, recent);
    }
    recent.push(fullEvent);
    if (recent.length > MAX_RECENT_EVENTS) {
      recent.shift();
    }

    for (const client of clients.values()) {
      client.send(fullEvent);
    }
  },

  sendCatchup(taskId: string, lastEventId: string, send: (data: unknown) => void): void {
    const recent = sharedState.recentEventsByTask.get(taskId);
    if (!recent) return;
    let found = false;
    for (const ev of recent) {
      if (ev.id === lastEventId) {
        found = true;
        continue;
      }
      if (found) send(ev);
    }
  },

  getRecentEvents(taskId: string, options?: { afterEventId?: string; afterLineOffset?: number }) {
    const recent = sharedState.recentEventsByTask.get(taskId) ?? [];
    let start = 0;
    if (options?.afterEventId) {
      const idx = recent.findIndex((e) => e.id === options.afterEventId);
      start = idx >= 0 ? idx + 1 : 0;
    } else if (options?.afterLineOffset !== undefined) {
      const idx = recent.findIndex(
        (e) => e.lineOffset !== undefined && e.lineOffset > options.afterLineOffset!
      );
      start = idx >= 0 ? idx : recent.length;
    }
    return recent.slice(start);
  },

  getClientCount(taskId: string): number {
    return sharedState.clientsByTask.get(taskId)?.size ?? 0;
  },

  _resetForTesting(): void {
    sharedState.clientsByTask.clear();
    sharedState.recentEventsByTask.clear();
  },
};

describe("SSE 广播器", () => {
  beforeEach(() => {
    broadcaster._resetForTesting();
  });

  it("应注册和取消注册客户端", () => {
    const tid = uid();
    const send = vi.fn();
    const clientId = broadcaster.register(tid, send);
    expect(broadcaster.getClientCount(tid)).toBe(1);

    broadcaster.unregister(tid, clientId);
    expect(broadcaster.getClientCount(tid)).toBe(0);
  });

  it("同一 taskId 注册多个客户端", () => {
    const tid = uid();
    broadcaster.register(tid, vi.fn());
    broadcaster.register(tid, vi.fn());
    broadcaster.register(tid, vi.fn());
    expect(broadcaster.getClientCount(tid)).toBe(3);
  });

  it("应广播事件到所有注册的客户端", () => {
    const tid = uid();
    const send1 = vi.fn();
    const send2 = vi.fn();
    broadcaster.register(tid, send1);
    broadcaster.register(tid, send2);

    broadcaster.broadcast(tid, { type: "test", data: { msg: "hello" } });

    expect(send1).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledTimes(1);
  });

  it("广播到不存在的 taskId 不应报错", () => {
    expect(() => {
      broadcaster.broadcast(uid(), { type: "test", data: {} });
    }).not.toThrow();
  });

  it("广播事件应生成唯一 ID 和 timestamp", () => {
    const tid = uid();
    const send = vi.fn();
    broadcaster.register(tid, send);

    broadcaster.broadcast(tid, { type: "test", data: {} });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        timestamp: expect.any(String),
        type: "test",
      })
    );
  });

  // 重要：broadcast 只在有客户端注册时存储事件
  it("getRecentEvents 应返回最近事件（需先注册客户端）", () => {
    const tid = uid();
    broadcaster.register(tid, vi.fn()); // 必须先注册客户端
    broadcaster.broadcast(tid, { type: "event1", data: { n: 1 } });
    broadcaster.broadcast(tid, { type: "event2", data: { n: 2 } });

    const events = broadcaster.getRecentEvents(tid);
    expect(events.length).toBe(2);
  });

  it("getRecentEvents 应按 afterEventId 过滤", () => {
    const tid = uid();
    broadcaster.register(tid, vi.fn());
    broadcaster.broadcast(tid, { type: "e1", data: {} });
    broadcaster.broadcast(tid, { type: "e2", data: {} });
    broadcaster.broadcast(tid, { type: "e3", data: {} });

    const events = broadcaster.getRecentEvents(tid, {});
    const firstEventId = events[0].id;

    const afterFirst = broadcaster.getRecentEvents(tid, { afterEventId: firstEventId });
    expect(afterFirst.length).toBe(events.length - 1);
  });

  it("getRecentEvents 应按 afterLineOffset 过滤", () => {
    const tid = uid();
    broadcaster.register(tid, vi.fn());
    broadcaster.broadcast(tid, { type: "e1", data: {}, lineOffset: 10 });
    broadcaster.broadcast(tid, { type: "e2", data: {}, lineOffset: 20 });
    broadcaster.broadcast(tid, { type: "e3", data: {}, lineOffset: 30 });

    const after15 = broadcaster.getRecentEvents(tid, { afterLineOffset: 15 });
    expect(after15.length).toBe(2);
    expect(after15.every((e) => (e.lineOffset ?? 0) > 15)).toBe(true);
  });

  it("getRecentEvents 对不存在的 taskId 返回空数组", () => {
    const events = broadcaster.getRecentEvents("nonexistent-" + uid());
    expect(events).toEqual([]);
  });

  it("getClientCount 应返回当前连接数", () => {
    const tid = uid();
    expect(broadcaster.getClientCount(tid)).toBe(0);
    const id1 = broadcaster.register(tid, vi.fn());
    const id2 = broadcaster.register(tid, vi.fn());
    expect(broadcaster.getClientCount(tid)).toBe(2);
    broadcaster.unregister(tid, id1);
    expect(broadcaster.getClientCount(tid)).toBe(1);
    broadcaster.unregister(tid, id2);
    expect(broadcaster.getClientCount(tid)).toBe(0);
  });

  it("sendCatchup 应从 lastEventId 之后重发事件", () => {
    const tid = uid();
    broadcaster.register(tid, vi.fn());
    broadcaster.broadcast(tid, { type: "e1", data: {} });
    broadcaster.broadcast(tid, { type: "e2", data: {} });
    broadcaster.broadcast(tid, { type: "e3", data: {} });

    const events = broadcaster.getRecentEvents(tid, {});
    const secondEventId = events[1].id;

    const catchupSend = vi.fn();
    broadcaster.sendCatchup(tid, secondEventId, catchupSend);

    expect(catchupSend).toHaveBeenCalledTimes(1);
    expect(catchupSend).toHaveBeenCalledWith(expect.objectContaining({ type: "e3" }));
  });

  it("sendCatchup 对不存在的事件 ID 不发送任何事件（应用 getRecentEvents 获取全部）", () => {
    const tid = uid();
    broadcaster.register(tid, vi.fn());
    broadcaster.broadcast(tid, { type: "e1", data: {} });
    broadcaster.broadcast(tid, { type: "e2", data: {} });

    const catchupSend = vi.fn();
    broadcaster.sendCatchup(tid, "nonexistent-id", catchupSend);

    // sendCatchup 只发送 lastEventId 之后的事件
    // 如果 lastEventId 不存在，什么都不发送（客户端应使用 getRecentEvents 获取全部）
    expect(catchupSend).toHaveBeenCalledTimes(0);
  });

  it("广播不含 lineOffset 的事件也能正常工作", () => {
    const tid = uid();
    const send = vi.fn();
    broadcaster.register(tid, send);

    broadcaster.broadcast(tid, { type: "state_change", data: { status: "running" } });

    expect(send).toHaveBeenCalledTimes(1);
    const sentData = send.mock.calls[0][0] as { lineOffset?: number };
    expect(sentData.lineOffset).toBeUndefined();
  });

  it("recentEventsByTask 应限制在 MAX_RECENT_EVENTS 以内", () => {
    const tid = uid();
    broadcaster.register(tid, vi.fn());
    for (let i = 0; i < 105; i++) {
      broadcaster.broadcast(tid, { type: "e", data: { n: i }, lineOffset: i });
    }

    const events = broadcaster.getRecentEvents(tid);
    expect(events.length).toBeLessThanOrEqual(100);
    const latestEvent = events[events.length - 1];
    expect((latestEvent.data as { n: number }).n).toBe(104);
  });

  it("多个 taskId 的事件应互相隔离", () => {
    const tidA = uid();
    const tidB = uid();
    broadcaster.register(tidA, vi.fn());
    broadcaster.register(tidB, vi.fn());
    broadcaster.broadcast(tidA, { type: "a_event", data: {} });
    broadcaster.broadcast(tidB, { type: "b_event", data: {} });

    const eventsA = broadcaster.getRecentEvents(tidA);
    const eventsB = broadcaster.getRecentEvents(tidB);

    expect(eventsA.length).toBe(1);
    expect(eventsA[0].type).toBe("a_event");
    expect(eventsB.length).toBe(1);
    expect(eventsB[0].type).toBe("b_event");
  });

  it("注销最后客户端后该 taskId 不应再接收广播", () => {
    const tid = uid();
    const send = vi.fn();
    const id = broadcaster.register(tid, send);
    broadcaster.unregister(tid, id);

    broadcaster.broadcast(tid, { type: "test", data: {} });
    expect(send).not.toHaveBeenCalled();
  });
});
