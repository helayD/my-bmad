/**
 * Unit tests for queue management logic.
 * Tests: snapshot parsing, wait estimation, queue position ordering.
 */

import { describe, expect, it, vi } from "vitest";
import {
  estimateWaitSeconds,
  estimateWaitLabel,
  parseExecutionQueueSnapshot,
} from "../supervisor/queue";

describe("parseExecutionQueueSnapshot", () => {
  it("returns null queue position when metadata has no executionQueue", () => {
    const snap = parseExecutionQueueSnapshot({});
    expect(snap.queuePosition).toBeNull();
    expect(snap.queueReasonCode).toBe("WORKSPACE_CAPACITY_FULL");
  });

  it("parses a full executionQueue snapshot", () => {
    const snap = parseExecutionQueueSnapshot({
      executionQueue: {
        queuePosition: 3,
        queuedAt: "2026-04-20T10:00:00Z",
        workspaceActiveConcurrentTasks: 5,
        projectActiveConcurrentTasks: 2,
        maxConcurrentTasks: 5,
        estimatedWaitSeconds: 120,
        estimatedWaitLabel: "预计等待约 2 分钟。",
        queueReasonCode: "WORKSPACE_CAPACITY_FULL",
        queueReasonSummary: "工作空间并发上限已满。",
      },
    });
    expect(snap.queuePosition).toBe(3);
    expect(snap.queuedAt).toBe("2026-04-20T10:00:00Z");
    expect(snap.workspaceActiveConcurrentTasks).toBe(5);
    expect(snap.projectActiveConcurrentTasks).toBe(2);
    expect(snap.maxConcurrentTasks).toBe(5);
    expect(snap.estimatedWaitSeconds).toBe(120);
    expect(snap.estimatedWaitLabel).toBe("预计等待约 2 分钟。");
    expect(snap.queueReasonCode).toBe("WORKSPACE_CAPACITY_FULL");
  });

  it("handles partial snapshots gracefully", () => {
    const snap = parseExecutionQueueSnapshot({
      executionQueue: { queuePosition: 1 },
    });
    expect(snap.queuePosition).toBe(1);
    expect(snap.queuedAt).toBeNull();
    expect(snap.maxConcurrentTasks).toBe(5); // defaults to 5
    expect(snap.queueReasonCode).toBe("WORKSPACE_CAPACITY_FULL");
  });

  it("returns null for null/undefined metadata", () => {
    expect(parseExecutionQueueSnapshot(null).queuePosition).toBeNull();
    expect(parseExecutionQueueSnapshot(undefined).queuePosition).toBeNull();
  });
});

describe("estimateWaitSeconds", () => {
  it("returns 0 when slot is immediately available", () => {
    // position 1, active 4, max 5 → 1 free slot >= 1 position → immediate
    expect(estimateWaitSeconds(1, 4, 5, null)).toBe(0);
    // position 0 is invalid → null
    expect(estimateWaitSeconds(0, 5, 5, null)).toBeNull();
    // position 2, active 4, max 5 → 1 free slot < 2 positions AND no median data → null
    expect(estimateWaitSeconds(2, 4, 5, null)).toBeNull();
  });

  it("returns null when task must wait but no median data is available", () => {
    // position 3, active 5, max 5 → all slots full, no median data → cannot estimate
    expect(estimateWaitSeconds(3, 5, 5, null)).toBeNull();
    // position 1, active 0, max 5 → free slot available → 0 (can start immediately)
    expect(estimateWaitSeconds(1, 0, 5, null)).toBe(0);
  });

  it("estimates based on median duration when capacity is full", () => {
    // max=5, active=5, position=1 → 1 task ahead, each takes 60000ms
    expect(estimateWaitSeconds(1, 5, 5, 60000)).toBe(60);
    // position=2 → 2 tasks ahead
    expect(estimateWaitSeconds(2, 5, 5, 60000)).toBe(120);
    // position=3 → 3 tasks ahead
    expect(estimateWaitSeconds(3, 5, 5, 60000)).toBe(180);
  });

  it("accounts for available slots before position", () => {
    // max=10, active=8, slots free=2 → position 1 & 2 get 0 wait
    expect(estimateWaitSeconds(1, 8, 10, 60000)).toBe(0);
    expect(estimateWaitSeconds(2, 8, 10, 60000)).toBe(0);
    // position 3: 1 task ahead
    expect(estimateWaitSeconds(3, 8, 10, 60000)).toBe(60);
  });

  it("returns null for non-positive queue position", () => {
    expect(estimateWaitSeconds(0, 5, 5, 60000)).toBeNull();
    expect(estimateWaitSeconds(-1, 5, 5, 60000)).toBeNull();
  });
});

describe("estimateWaitLabel", () => {
  it("returns immediate message when slots are free", () => {
    expect(estimateWaitLabel(1, 4, 5, null)).toBe("系统将在空闲后立即启动此任务。");
    expect(estimateWaitLabel(2, 3, 5, null)).toBe("系统将在空闲后立即启动此任务。");
  });

  it("returns fallback when no median data", () => {
    const label = estimateWaitLabel(3, 5, 5, null);
    expect(label).toBe("等待时间暂无法精确估算，系统会在空闲后自动启动。");
  });

  it("returns seconds-level label for short waits", () => {
    // position 3, active 5, max 5 → 3 tasks ahead × 60s = 180s = 3 minutes
    expect(estimateWaitLabel(3, 5, 5, 60 * 1000)).toBe("预计等待约 3 分钟。");
  });

  it("returns minute-level label for medium waits", () => {
    // position 5, active 5, max 5 → 5 tasks ahead × 60s = 300s = 5 分钟
    expect(estimateWaitLabel(5, 5, 5, 60 * 1000)).toBe("预计等待约 5 分钟。");
  });

  it("returns hour-level label for long waits", () => {
    // position 133, active 5, max 5 → 128 tasks ahead × 60s = 7680s → 2 hours
    expect(estimateWaitLabel(133, 5, 5, 60 * 1000)).toBe("预计等待约 2 小时。");
  });
});
