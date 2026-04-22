import { describe, it, expect } from "vitest";
import { parseOutputLine, parseOutputBatch } from "../output-parser";

describe("输出解析器", () => {
  describe("parseOutputLine", () => {
    it("应识别交互请求模式（? 结尾）", () => {
      const event = parseOutputLine("Should I proceed?", new Date());
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别交互请求模式（y/n）", () => {
      const event = parseOutputLine("(y/n)", new Date());
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别 y/n 方括号模式", () => {
      const event = parseOutputLine("Continue? [y/N]", new Date());
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别 'proceed?'", () => {
      const event = parseOutputLine("Do you want to proceed?", new Date());
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别 'continue?'", () => {
      const event = parseOutputLine("Continue? (yes/no)", new Date());
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别 'should I?' 模式", () => {
      const event = parseOutputLine("Should I create the file?", new Date());
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别 'would you like?' 模式", () => {
      const event = parseOutputLine("Would you like to see more details?", new Date());
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别单个 y/n 字符", () => {
      const event = parseOutputLine("y", new Date());
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别 'need more information' 模式", () => {
      const event = parseOutputLine("I need more information about the project.", new Date());
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别 coding 阶段 - implement", () => {
      const event = parseOutputLine("Implementing the feature...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("coding");
    });

    it("应识别 coding 阶段 - write（行首匹配）", () => {
      const event = parseOutputLine("Write component...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("coding");
    });

    it("应识别 coding 阶段 - create（行首匹配）", () => {
      const event = parseOutputLine("Create user auth module...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("coding");
    });

    it("应识别 coding 阶段 - add", () => {
      const event = parseOutputLine("Adding new endpoint to API...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("coding");
    });

    it("应识别 coding 阶段 - modify", () => {
      const event = parseOutputLine("Modifying configuration...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("coding");
    });

    it("应识别 coding 阶段 - update（行首匹配）", () => {
      const event = parseOutputLine("Update dependencies...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("coding");
    });

    it("应识别 coding 阶段 - refactor", () => {
      const event = parseOutputLine("Refactoring the module...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("coding");
    });

    it("应识别 testing 阶段", () => {
      const event = parseOutputLine("Running test suite...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("testing");
    });

    it("应识别 done 阶段 - done 开头", () => {
      const event = parseOutputLine("Done. Task completed successfully.", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("done");
    });

    it("应识别 done 阶段 - complete 开头", () => {
      const event = parseOutputLine("Completed all tasks.", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("done");
    });

    it("应识别 done 阶段 - finished 开头", () => {
      const event = parseOutputLine("Finished execution.", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("done");
    });

    it("应识别 done 阶段 - success 开头", () => {
      const event = parseOutputLine("Success! All steps completed.", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("done");
    });

    it("应识别 building 阶段 - build 开头", () => {
      const event = parseOutputLine("Building project...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("building");
    });

    it("应识别 building 阶段 - compile 开头", () => {
      const event = parseOutputLine("Compile finished.", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("building");
    });

    it("应识别 error 阶段（STAGE_PATTERNS error 优先于独立 error 检查）", () => {
      // "Error:" 匹配 STAGE_PATTERNS.error → progress
      const event = parseOutputLine("Error: file not found", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("error");
    });

    it("应识别 fail 阶段（行首匹配）", () => {
      // "Fail:" 开头匹配 fail
      const event = parseOutputLine("Failed: connection timeout", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("error");
    });

    it("应识别 exception 阶段", () => {
      const event = parseOutputLine("Exception occurred: null pointer", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("error");
    });

    it("应识别警告", () => {
      const event = parseOutputLine("Warning: deprecated API usage", new Date());
      expect(event?.type).toBe("warning");
    });

    it("应识别进度百分比", () => {
      const event = parseOutputLine("[####    ] 40%", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("40%");
    });

    it("应识别进度 step X/Y", () => {
      const event = parseOutputLine("Step 3 / 10", new Date());
      expect(event?.type).toBe("progress");
    });

    it("应识别普通进度条（# 符号）", () => {
      const event = parseOutputLine("[####    ] 40% complete", new Date());
      expect(event?.type).toBe("progress");
    });

    it("应跳过空行返回 null", () => {
      const event = parseOutputLine("", new Date());
      expect(event).toBeNull();
    });

    it("应跳过空白行返回 null", () => {
      const event = parseOutputLine("   ", new Date());
      expect(event).toBeNull();
    });

    it("应包含 rawLine 和 timestamp", () => {
      const ts = new Date("2026-04-21T10:00:00Z");
      const event = parseOutputLine("Error: something went wrong", ts);
      expect(event?.rawLine).toBe("Error: something went wrong");
      expect(event?.timestamp).toBe(ts);
    });

    it("detail 应限制在 200 字符以内", () => {
      const errorLine = "Error: " + "x".repeat(200);
      const event = parseOutputLine(errorLine, new Date());
      expect(event?.detail?.length).toBeLessThanOrEqual(200);
    });

    it("error 阶段应有 high confidence", () => {
      const event = parseOutputLine("Error: fatal error", new Date());
      expect(event?.confidence).toBe("high");
    });

    it("interaction_request 类型应有 high confidence", () => {
      const event = parseOutputLine("Proceed? (y/n)", new Date());
      expect(event?.confidence).toBe("high");
    });

    it("应识别 planning 阶段", () => {
      const event = parseOutputLine("Planning the implementation approach...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("planning");
    });

    it("应识别 reviewing 阶段", () => {
      const event = parseOutputLine("Reviewing code changes...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("reviewing");
    });

    it("应识别 deploying 阶段", () => {
      const event = parseOutputLine("Deploying to production...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("deploying");
    });

    it("应识别 analyzing 阶段", () => {
      const event = parseOutputLine("Analyzing codebase structure...", new Date());
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("analyzing");
    });

    it("普通文本行应返回 null", () => {
      const event = parseOutputLine("This is a normal log message without special patterns.", new Date());
      expect(event).toBeNull();
    });
  });

  describe("parseOutputBatch", () => {
    it("空数组应返回空数组", () => {
      const events = parseOutputBatch([], new Date());
      expect(events).toEqual([]);
    });

    it("所有空行应返回空数组", () => {
      const events = parseOutputBatch(["", "  ", "\t", "   "], new Date());
      expect(events).toEqual([]);
    });

    it("应跳过空行", () => {
      const events = parseOutputBatch(["", "  ", "Error: test"], new Date());
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("progress");
    });

    it("应批量解析并返回非空事件", () => {
      const lines = [
        "Starting task...",
        "Analyzing codebase...",
        "Should I create the file?",
        "Done.",
      ];
      const events = parseOutputBatch(lines, new Date());
      expect(events.length).toBeGreaterThan(0);
    });

    it("应正确分配 timestamp", () => {
      const ts = new Date("2026-04-21T10:00:00Z");
      const events = parseOutputBatch(["Error: test", "Warning: test"], ts);
      expect(events.every((e) => e.timestamp === ts)).toBe(true);
    });

    it("应识别多个交互请求行", () => {
      const lines = [
        "Should I proceed?",
        "Continue?",
        "Another question?",
      ];
      const events = parseOutputBatch(lines, new Date());
      const irEvents = events.filter((e) => e.type === "interaction_request");
      expect(irEvents.length).toBe(3);
    });

    it("应处理混有多种类型的行", () => {
      const lines = [
        "Starting...",
        "Build failed: connection error",
        "Reviewing code...",
        "Warning: deprecated",
        "Done.",
      ];
      const events = parseOutputBatch(lines, new Date());
      expect(events.some((e) => e.type === "progress")).toBe(true);
      expect(events.some((e) => e.type === "warning")).toBe(true);
    });

    it("进度行应被正确识别", () => {
      const lines = [
        "Implementing feature...",
        "[####    ] 50%",
        "Step 2 / 5",
      ];
      const events = parseOutputBatch(lines, new Date());
      const progressEvents = events.filter((e) => e.type === "progress");
      expect(progressEvents.length).toBeGreaterThanOrEqual(3);
    });
  });
});
