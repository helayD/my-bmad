import { describe, it, expect } from "vitest";
import {
  isValidTransition,
  getTransitionError,
  getAllowedTransitions,
  isTerminalStatus,
  isRecoveryStatus,
  isActiveStatus,
  needsWriteback,
} from "../validator";
import type { TaskStatus } from "../types";

describe("状态转换验证器", () => {
  it("应允许 planned → dispatched", () => {
    expect(isValidTransition("planned", "dispatched")).toBe(true);
  });

  it("应允许 planned → pending", () => {
    expect(isValidTransition("planned", "pending")).toBe(true);
  });

  it("应拒绝非法转换 planned → completed", () => {
    expect(isValidTransition("planned", "completed")).toBe(false);
  });

  it("应拒绝非法转换 planned → running", () => {
    expect(isValidTransition("planned", "running")).toBe(false);
  });

  it("应拒绝终态之间的转换 completed → failed", () => {
    expect(isValidTransition("completed", "failed")).toBe(false);
  });

  it("应拒绝终态之间的转换 failed → terminated", () => {
    expect(isValidTransition("failed", "terminated")).toBe(false);
  });

  it("应允许终态 → writeback_pending", () => {
    expect(isValidTransition("completed", "writeback_pending")).toBe(true);
    expect(isValidTransition("failed", "writeback_pending")).toBe(true);
    expect(isValidTransition("terminated", "writeback_pending")).toBe(true);
  });

  it("应允许 writeback_pending → writeback_done", () => {
    expect(isValidTransition("writeback_pending", "writeback_done")).toBe(true);
  });

  it("应拒绝 writeback_done 的任何转换", () => {
    expect(isValidTransition("writeback_done", "planned")).toBe(false);
    expect(isValidTransition("writeback_done", "running")).toBe(false);
  });

  it("应正确识别终态", () => {
    expect(isTerminalStatus("writeback_done")).toBe(true);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("terminated")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("pending")).toBe(false);
  });

  it("应正确识别恢复状态", () => {
    expect(isRecoveryStatus("recovering")).toBe(true);
    expect(isRecoveryStatus("awaiting_takeover")).toBe(true);
    expect(isRecoveryStatus("running")).toBe(false);
  });

  it("应正确识别进行中状态", () => {
    expect(isActiveStatus("running")).toBe(true);
    expect(isActiveStatus("waiting_for_input")).toBe(true);
    expect(isActiveStatus("completed")).toBe(false);
  });

  it("应正确识别需要回写的状态", () => {
    expect(needsWriteback("completed")).toBe(true);
    expect(needsWriteback("failed")).toBe(true);
    expect(needsWriteback("terminated")).toBe(true);
    expect(needsWriteback("running")).toBe(false);
  });

  it("应拒绝未知状态的转换", () => {
    expect(isValidTransition("unknown" as TaskStatus, "running")).toBe(false);
    expect(isValidTransition("planned", "unknown" as TaskStatus)).toBe(false);
  });

  it("应返回非法转换的错误信息", () => {
    const error = getTransitionError("planned", "completed");
    expect(error).toBeTruthy();
    expect(typeof error).toBe("string");
    expect(error!.length).toBeGreaterThan(0);
  });

  it("应返回空字符串表示合法转换", () => {
    const error = getTransitionError("planned", "dispatched");
    expect(error).toBe("");
  });

  it("应返回 planned 的允许转换列表", () => {
    const allowed = getAllowedTransitions("planned");
    expect(allowed).toContain("pending");
    expect(allowed).toContain("dispatched");
    expect(allowed).not.toContain("running");
    expect(allowed).not.toContain("completed");
  });

  it("应返回终态的允许转换列表", () => {
    const allowed = getAllowedTransitions("completed");
    expect(allowed).toContain("writeback_pending");
    expect(allowed).not.toContain("running");
  });

  it("应返回 running 的允许转换列表", () => {
    const allowed = getAllowedTransitions("running");
    expect(allowed).toContain("completed");
    expect(allowed).toContain("failed");
    expect(allowed).toContain("terminated");
    expect(allowed).not.toContain("planned");
  });

  it("应正确识别非终态", () => {
    expect(isTerminalStatus("planned")).toBe(false);
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("dispatched")).toBe(false);
    expect(isTerminalStatus("starting")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("waiting_for_input")).toBe(false);
    expect(isTerminalStatus("recovering")).toBe(false);
    expect(isTerminalStatus("awaiting_takeover")).toBe(false);
    expect(isTerminalStatus("writeback_pending")).toBe(false);
  });

  it("应正确识别非恢复状态", () => {
    expect(isRecoveryStatus("planned")).toBe(false);
    expect(isRecoveryStatus("pending")).toBe(false);
    expect(isRecoveryStatus("completed")).toBe(false);
  });

  it("应正确识别非进行中状态", () => {
    expect(isActiveStatus("completed")).toBe(false);
    expect(isActiveStatus("terminated")).toBe(false);
    expect(isActiveStatus("failed")).toBe(false);
    expect(isActiveStatus("writeback_pending")).toBe(false);
    expect(isActiveStatus("writeback_done")).toBe(false);
    expect(isActiveStatus("recovering")).toBe(false);
    expect(isActiveStatus("awaiting_takeover")).toBe(false);
  });

  it("应正确识别不需要回写的状态", () => {
    expect(needsWriteback("planned")).toBe(false);
    expect(needsWriteback("pending")).toBe(false);
    expect(needsWriteback("dispatched")).toBe(false);
    expect(needsWriteback("writeback_pending")).toBe(false);
    expect(needsWriteback("writeback_done")).toBe(false);
  });

  it("应允许 dispatched → starting", () => {
    expect(isValidTransition("dispatched", "starting")).toBe(true);
  });

  it("应允许 starting → running", () => {
    expect(isValidTransition("starting", "running")).toBe(true);
  });

  it("应允许 running → waiting_for_input", () => {
    expect(isValidTransition("running", "waiting_for_input")).toBe(true);
  });

  it("应允许 waiting_for_input → running", () => {
    expect(isValidTransition("waiting_for_input", "running")).toBe(true);
  });

  it("应允许 running → recovering", () => {
    expect(isValidTransition("running", "recovering")).toBe(true);
  });

  it("应允许 recovering → running", () => {
    expect(isValidTransition("recovering", "running")).toBe(true);
  });

  it("应允许 recovering → awaiting_takeover", () => {
    expect(isValidTransition("recovering", "awaiting_takeover")).toBe(true);
  });

  it("应允许 awaiting_takeover → running", () => {
    expect(isValidTransition("awaiting_takeover", "running")).toBe(true);
  });
});
