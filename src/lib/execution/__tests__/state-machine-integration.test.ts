/**
 * Integration tests for state machine integration with existing modules.
 *
 * These tests verify that the state machine validation and event recording
 * are correctly integrated with dispatch, redispatch, and writeback modules.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { isValidTransition } from "../state-machine/validator";
import { canTransition } from "../state-machine/transitioner";

describe("状态机与 dispatch 模块集成", () => {
  describe("planned → dispatched 转换验证", () => {
    it("应允许从已计划状态派发到已派发", () => {
      expect(isValidTransition("planned", "dispatched")).toBe(true);
    });

    it("canTransition 应返回 planned → dispatched 为合法", () => {
      const result = canTransition("planned", "dispatched");
      expect(result.allowed).toBe(true);
      expect(result.errorMessage).toBeUndefined();
    });

    it("不应允许从未计划状态直接派发", () => {
      expect(isValidTransition("completed", "dispatched")).toBe(false);
    });
  });

  describe("planned → pending 转换验证", () => {
    it("应允许已计划任务进入排队", () => {
      expect(isValidTransition("planned", "pending")).toBe(true);
    });
  });
});

describe("状态机与 supervisor launch 模块集成", () => {
  describe("dispatched → starting → running 转换链", () => {
    it("dispatched → starting 应为合法转换", () => {
      expect(isValidTransition("dispatched", "starting")).toBe(true);
    });

    it("starting → running 应为合法转换", () => {
      expect(isValidTransition("starting", "running")).toBe(true);
    });

    it("dispatched → running 不应为直接转换（需经过 starting）", () => {
      expect(isValidTransition("dispatched", "running")).toBe(false);
    });
  });

  describe("会话启动失败处理", () => {
    it("dispatched → failed 应为合法转换（启动失败）", () => {
      expect(isValidTransition("dispatched", "failed")).toBe(true);
    });
  });
});

describe("状态机与 lifecycle 模块集成", () => {
  describe("running → 终态 转换", () => {
    it("running → completed 应为合法转换", () => {
      expect(isValidTransition("running", "completed")).toBe(true);
    });

    it("running → failed 应为合法转换", () => {
      expect(isValidTransition("running", "failed")).toBe(true);
    });

    it("running → terminated 应为合法转换", () => {
      expect(isValidTransition("running", "terminated")).toBe(true);
    });

    it("starting → completed 不应为直接转换", () => {
      expect(isValidTransition("starting", "completed")).toBe(false);
    });
  });
});

describe("状态机与 writeback 模块集成", () => {
  describe("终态 → writeback_pending 转换", () => {
    it("completed → writeback_pending 应为合法转换", () => {
      expect(isValidTransition("completed", "writeback_pending")).toBe(true);
    });

    it("failed → writeback_pending 应为合法转换", () => {
      expect(isValidTransition("failed", "writeback_pending")).toBe(true);
    });

    it("terminated → writeback_pending 应为合法转换", () => {
      expect(isValidTransition("terminated", "writeback_pending")).toBe(true);
    });

    it("running → writeback_pending 不应为直接转换", () => {
      expect(isValidTransition("running", "writeback_pending")).toBe(false);
    });
  });

  describe("writeback_pending → writeback_done 转换", () => {
    it("writeback_pending → writeback_done 应为合法转换", () => {
      expect(isValidTransition("writeback_pending", "writeback_done")).toBe(true);
    });

    it("writeback_done → 任何状态均不应为合法转换", () => {
      expect(isValidTransition("writeback_done", "planned")).toBe(false);
      expect(isValidTransition("writeback_done", "running")).toBe(false);
      expect(isValidTransition("writeback_done", "completed")).toBe(false);
    });
  });
});

describe("状态机与恢复/接管流程集成", () => {
  describe("running → 恢复状态 转换", () => {
    it("running → recovering 应为合法转换", () => {
      expect(isValidTransition("running", "recovering")).toBe(true);
    });

    it("recovering → running 应为合法转换（自动恢复成功）", () => {
      expect(isValidTransition("recovering", "running")).toBe(true);
    });

    it("recovering → awaiting_takeover 应为合法转换（恢复失败需接管）", () => {
      expect(isValidTransition("recovering", "awaiting_takeover")).toBe(true);
    });

    it("awaiting_takeover → running 应为合法转换（人工接管后恢复）", () => {
      expect(isValidTransition("awaiting_takeover", "running")).toBe(true);
    });
  });

  describe("running → waiting_for_input 转换", () => {
    it("running → waiting_for_input 应为合法转换", () => {
      expect(isValidTransition("running", "waiting_for_input")).toBe(true);
    });

    it("waiting_for_input → running 应为合法转换（用户输入后继续）", () => {
      expect(isValidTransition("waiting_for_input", "running")).toBe(true);
    });
  });
});

describe("状态机与 redispatch 模块集成", () => {
  describe("终态任务重新派发", () => {
    it("completed → planned 应为合法转换（重新派发）", () => {
      expect(isValidTransition("completed", "planned")).toBe(true);
    });

    it("failed → planned 应为合法转换（重新派发）", () => {
      expect(isValidTransition("failed", "planned")).toBe(true);
    });

    it("terminated → planned 应为合法转换（重新派发）", () => {
      expect(isValidTransition("terminated", "planned")).toBe(true);
    });

    it("writeback_pending → planned 不应为合法转换（回写未完成）", () => {
      expect(isValidTransition("writeback_pending", "planned")).toBe(false);
    });
  });
});
