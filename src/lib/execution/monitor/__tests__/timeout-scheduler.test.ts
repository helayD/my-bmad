/**
 * Unit tests for timeout-scheduler (Story 5.5 — AC-3).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleTimeoutCheck,
  cancelTimeoutCheck,
  getActiveTimeoutCheckCount,
  _resetForTesting,
} from "../timeout-scheduler";

vi.mock("../interaction-detector", () => ({
  checkAllPendingInteractions: vi.fn().mockResolvedValue(0),
}));

describe("交互请求超时调度器", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
  });

  it("scheduleTimeoutCheck 应注册调度", () => {
    scheduleTimeoutCheck("task-123");
    expect(getActiveTimeoutCheckCount()).toBe(1);
  });

  it("cancelTimeoutCheck 应取消调度", () => {
    scheduleTimeoutCheck("task-123");
    expect(getActiveTimeoutCheckCount()).toBe(1);
    cancelTimeoutCheck("task-123");
    expect(getActiveTimeoutCheckCount()).toBe(0);
  });

  it("不应重复注册同一任务的调度", () => {
    scheduleTimeoutCheck("task-123");
    scheduleTimeoutCheck("task-123");
    expect(getActiveTimeoutCheckCount()).toBe(1);
    cancelTimeoutCheck("task-123");
    expect(getActiveTimeoutCheckCount()).toBe(0);
  });

  it("可同时注册多个不同任务的调度", () => {
    scheduleTimeoutCheck("task-1");
    scheduleTimeoutCheck("task-2");
    scheduleTimeoutCheck("task-3");
    expect(getActiveTimeoutCheckCount()).toBe(3);
    cancelTimeoutCheck("task-2");
    expect(getActiveTimeoutCheckCount()).toBe(2);
  });
});
