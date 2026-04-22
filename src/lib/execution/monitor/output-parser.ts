/**
 * Agent 输出解析器 — 从原始 tmux 输出中提取关键事件。
 *
 * 解析内容（FR26）：
 * - 关键状态变化（如 "Compiling...", "Running tests...", "Done"）
 * - 进度信息（如百分比、步骤编号）
 * - 交互请求模式（提问、确认请求、策略选择）
 * - 错误与警告
 *
 * 解析策略：
 * - 使用正则 + 关键词匹配，无需 LLM
 * - 交互请求识别：检测 "?", "Proceed?", "Continue?", "y/n", "Press Enter"
 * - 状态变化识别：检测阶段关键词（analyzing、planning、coding、testing、writing）
 * - 错误识别：检测 error、fail、warning 等关键词
 */

export interface ParsedEvent {
  type: "progress" | "interaction_request" | "error" | "warning" | "info";
  timestamp: Date;
  rawLine: string;
  summary: string;          // 简短摘要，用于 UI 展示
  detail?: string;          // 额外上下文
  confidence: "high" | "medium" | "low";
}

// 交互请求模式（可配置化）
const INTERACTION_PATTERNS = [
  /^\s*[?yYnN]\s*$/i,
  /\?$/,
  /proceed\?/i,
  /continue\?/i,
  /confirm\?/i,
  /approve\?/i,
  /overwrite\?/i,
  /delete\?/i,
  /press\s+enter\s+to/i,
  /type\s+["']?[Yy]/i,
  /\(y\/n\)/i,
  /\(yes\/no\)/i,
  /\[\s*y\s*\/\s*n\s*\]/i,
  // codex/claude code 常见交互模式
  /need[s]?\s+(more|additional)\s+information/i,
  /would\s+you\s+like/i,
  /should\s+I/i,
  /do\s+you\s+want/i,
];

// 状态阶段关键词
const STAGE_PATTERNS = {
  analyzing: /analyz/i,
  planning: /plan/i,
  coding: /^(implement|code|write|create|add|modify|update|refactor)/i,
  testing: /test/i,
  reviewing: /review/i,
  building: /build|compile/i,
  deploying: /deploy/i,
  done: /^(done|complete|finished|success)/i,
  error: /error|fail|exception/i,
};

// 进度模式
const PROGRESS_PATTERNS = [
  /(\d+)%/,
  /step\s+(\d+)\s*\/\s*(\d+)/i,
  /\[\s*[#>*]\s*\]/,
];

/**
 * 解析 tmux 输出行，提取关键事件。
 */
export function parseOutputLine(line: string, timestamp: Date): ParsedEvent | null {
  // 检查交互请求
  for (const pattern of INTERACTION_PATTERNS) {
    if (pattern.test(line.trim())) {
      return {
        type: "interaction_request",
        timestamp,
        rawLine: line,
        summary: "Agent 请求用户输入",
        detail: line.trim().substring(0, 200),
        confidence: "high",
      };
    }
  }

  // 检查状态阶段
  for (const [stage, pattern] of Object.entries(STAGE_PATTERNS)) {
    if (pattern.test(line)) {
      return {
        type: "progress",
        timestamp,
        rawLine: line,
        summary: `阶段: ${stage}`,
        detail: line.trim().substring(0, 200),
        confidence: stage === "error" ? "high" : "medium",
      };
    }
  }

  // 检查进度
  for (const pattern of PROGRESS_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      return {
        type: "progress",
        timestamp,
        rawLine: line,
        summary: `进度: ${match[0]}`,
        detail: line.trim().substring(0, 200),
        confidence: "medium",
      };
    }
  }

  // 检查错误
  if (/error|fail|exception/i.test(line)) {
    return {
      type: "error",
      timestamp,
      rawLine: line,
      summary: "检测到错误",
      detail: line.trim().substring(0, 200),
      confidence: "high",
    };
  }

  // 检查警告
  if (/warn/i.test(line)) {
    return {
      type: "warning",
      timestamp,
      rawLine: line,
      summary: "警告",
      detail: line.trim().substring(0, 200),
      confidence: "medium",
    };
  }

  return null;
}

/**
 * 批量解析输出行，返回非空事件列表。
 */
export function parseOutputBatch(
  lines: string[],
  capturedAt: Date
): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const line of lines) {
    if (!line || line.trim() === "") continue;

    const event = parseOutputLine(line, capturedAt);
    if (event) {
      events.push(event);
    }
  }

  return events;
}
