# Story 5.3: Agent 输出监听与实时状态推送

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

作为系统，
我希望能持续监听 codex 或 claude code 在执行过程中的输出、状态变化和交互请求，并将关键更新推送到控制面，
以便用户获得准实时的执行可见性。

## Acceptance Criteria

1. **Given** 任务在 tmux session 中执行
   **When** agent 产出新的输出内容
   **Then** 执行监督器捕获输出并提取关键状态变化和进度信息（FR26）
   **And** 通过 SSE 将状态更新推送到控制面，延迟小于 15 秒（NFR3）

2. **Given** agent 输出中包含交互请求（如提问、确认请求）
   **When** 执行监督器识别到交互请求模式
   **Then** 系统创建 InteractionRequest 记录并推送到控制面
   **And** 任务状态变为 WAITING_FOR_INPUT

3. **Given** SSE 连接断开
   **When** 用户刷新页面或重新连接
   **Then** 系统通过轮询兜底获取最新状态（架构要求）
   **And** 不丢失断开期间的状态变化

## Tasks / Subtasks

> **建议实现顺序：** Task 1（tmux 输出监听）→ Task 2（SSE 推送通道）→ Task 3（交互请求识别）→ Task 4（轮询兜底）→ Task 5（UI 集成）→ Task 6（测试）

### Task 1: tmux 输出捕获与状态提取

- [ ] 1.1 在 `src/lib/execution/monitor/` 目录（新建）下实现 `tmux-output-capture.ts`：

  ```typescript
  /**
   * tmux 输出捕获器 — 从 tmux session 中实时读取 agent 输出。
   *
   * 职责（FR26, NFR3）：
   * - 通过 tmux capture-pane 持续读取 session 输出缓冲区
   * - 维护读取偏移量，避免重复推送已推送过的内容
   * - 支持从任意 offset 恢复读取（断线重连时）
   * - 将原始输出流交给 OutputParser 进行解析
   *
   * 架构要求（原始长日志不进高频事务热表）：
   * - 输出缓冲区在内存中维护，不直接写入数据库
   * - 持久化仅存储：输出偏移量、关键事件提取结果、摘要信息
   * - 大体量输出内容通过文件系统或对象存储引用
   */

  import { execFile } from "child_process";
  import { promisify } from "util";

  const execFileAsync = promisify(execFile);

  export interface TmuxCaptureConfig {
    sessionName: string;
    /** 每次 capture 的最大行数 */
    maxLines?: number;
    /** 读取时使用的终端宽度 */
    pipeCols?: number;
  }

  export interface CapturedOutput {
    lines: string[];
    lineOffset: number;
    capturedAt: Date;
  }

  export class TmuxOutputCapture {
    private sessionName: string;
    private maxLines: number;
    private pipeCols: number;
    /** 当前已读取的行偏移量（基于 captureFull 的行索引） */
    private currentLineOffset: number = 0;

    constructor(config: TmuxCaptureConfig) {
      this.sessionName = config.sessionName;
      this.maxLines = config.maxLines ?? 100;
      this.pipeCols = config.pipeCols ?? 200;
    }

    /**
     * 从上次读取位置之后捕获新输出。
     * 返回新增的行和当前偏移量。
     */
    async captureNew(): Promise<CapturedOutput> {
      const fullOutput = await this.captureFull();
      const newLines = fullOutput.slice(this.currentLineOffset);
      const newOffset = fullOutput.length;

      this.currentLineOffset = newOffset;
      return {
        lines: newLines,
        lineOffset: newOffset,
        capturedAt: new Date(),
      };
    }

    /**
     * 获取完整的 tmux 面板内容（从缓冲区开头）。
     * 使用 execFile 直接调用 tmux 命令，而非依赖不存在的 utils 模块。
     * tmux client.ts 中的函数专用于 session 管理，不适合直接复用。
     */
    async captureFull(): Promise<string[]> {
      // -S -: 从 scrollback 缓冲区开头开始；-E -: 到末尾
      // -p: 输出到 stdout（用于管道）；-t session: 目标 session
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-t", this.sessionName,
        "-p",
        "-S", "-",
        "-E", "-",
      ]);
      const lines = (stdout || "").split("\n");
      return this.maxLines > 0 ? lines.slice(-this.maxLines) : lines;
    }

    /**
     * 从指定偏移量开始读取（用于重连场景）。
     */
    async captureFromOffset(offset: number): Promise<CapturedOutput> {
      const fullOutput = await this.captureFull();
      const lines = fullOutput.slice(offset);

      return {
        lines,
        lineOffset: fullOutput.length,
        capturedAt: new Date(),
      };
    }

    /** 设置当前偏移量（从外部状态恢复） */
    setOffset(offset: number): void {
      this.currentLineOffset = offset;
    }

    /** 获取当前偏移量（用于持久化） */
    getOffset(): number {
      return this.currentLineOffset;
    }
  }
  ```

- [ ] 1.2 在 `src/lib/execution/monitor/` 下实现 `output-parser.ts`：

  ```typescript
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
  ```

- [ ] 1.3 在 `src/lib/execution/monitor/` 下实现 `output-monitor.ts`：

  ```typescript
  /**
   * 输出监控器 — 定期轮询 tmux 输出并推送更新。
   *
   * 职责（FR26, NFR3）：
   * - 按固定间隔（默认 5 秒）轮询 tmux 输出
   * - 将新增输出交给 OutputParser 解析
   * - 通过 SSE 将解析后的事件推送给所有连接的客户端
   * - 维护各 session 的监控状态（偏移量、运行中/已停止）
   */

  import { TmuxOutputCapture, type CapturedOutput } from "./tmux-output-capture";
  import { parseOutputBatch, type ParsedEvent } from "./output-parser";
  import { sseBroadcaster } from "./sse-broadcaster"; // Task 2 中定义

  export interface OutputMonitorConfig {
    sessionName: string;
    taskId: string;
    agentRunId: string;
    /** 轮询间隔（毫秒），默认 5 秒（NFR3 要求推送延迟 < 15 秒） */
    pollIntervalMs?: number;
    /** 每次捕获的最大行数 */
    maxLines?: number;
  }

  type MonitorEvent =
    | { type: "output"; events: ParsedEvent[]; lineOffset: number }
    | { type: "error"; message: string }
    | { type: "stopped" };

  export class OutputMonitor {
    private sessionName: string;
    private taskId: string;
    private agentRunId: string;
    private pollIntervalMs: number;
    private capture: TmuxOutputCapture;
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private running: boolean = false;
    private onEvent?: (event: MonitorEvent) => void;

    constructor(config: OutputMonitorConfig) {
      this.sessionName = config.sessionName;
      this.taskId = config.taskId;
      this.agentRunId = config.agentRunId;
      this.pollIntervalMs = config.pollIntervalMs ?? 5_000;
      this.capture = new TmuxOutputCapture({
        sessionName: config.sessionName,
        maxLines: config.maxLines,
      });
    }

    /** 启动监控 */
    start(onEvent?: (event: MonitorEvent) => void): void {
      if (this.running) return;
      this.running = true;
      this.onEvent = onEvent;

      // 立即执行一次捕获
      void this.poll();

      this.intervalId = setInterval(() => {
        void this.poll();
      }, this.pollIntervalMs);
    }

    /** 停止监控 */
    stop(): void {
      this.running = false;
      if (this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }

    /** 恢复从指定偏移量读取（断线重连） */
    async restoreFromOffset(offset: number): Promise<void> {
      this.capture.setOffset(offset);
      const result = await this.capture.captureFromOffset(offset);
      this.processCapture(result);
    }

    private async poll(): Promise<void> {
      if (!this.running) return;

      try {
        const captured = await this.capture.captureNew();
        if (captured.lines.length === 0) return;

        this.processCapture(captured);
      } catch (err) {
        // tmux session 可能已不存在（任务已结束）
        this.stop();
        this.onEvent?.({
          type: "stopped",
        });
      }
    }

    private processCapture(captured: CapturedOutput): void {
      const events = parseOutputBatch(captured.lines, captured.capturedAt);
      if (events.length === 0) return;

      const monitorEvent: MonitorEvent = {
        type: "output",
        events,
        lineOffset: captured.lineOffset,
      };

      // 触发回调
      this.onEvent?.(monitorEvent);

      // 通过 SSE 广播
      sseBroadcaster.broadcast(this.taskId, {
        type: "agent_output",
        taskId: this.taskId,
        agentRunId: this.agentRunId,
        events,
        lineOffset: captured.lineOffset,
        timestamp: captured.capturedAt.toISOString(),
      });
    }

    isRunning(): boolean {
      return this.running;
    }
  }

  /**
   * 全局监控器注册表 — 按 taskId 管理各任务的监控器实例。
   */
  const monitors = new Map<string, OutputMonitor>();

  export function startMonitor(config: OutputMonitorConfig): OutputMonitor {
    // 如果已存在，先停止
    stopMonitor(config.taskId);

    const monitor = new OutputMonitor(config);
    monitors.set(config.taskId, monitor);
    monitor.start();
    return monitor;
  }

  export function stopMonitor(taskId: string): void {
    const monitor = monitors.get(taskId);
    if (monitor) {
      monitor.stop();
      monitors.delete(taskId);
    }
  }

  export function getMonitor(taskId: string): OutputMonitor | undefined {
    return monitors.get(taskId);
  }
  ```

- [ ] 1.4 在 `src/lib/execution/monitor/index.ts` 导出所有公共 API：

  ```typescript
  export { TmuxOutputCapture, type TmuxCaptureConfig, type CapturedOutput } from "./tmux-output-capture";
  export { parseOutputLine, parseOutputBatch, type ParsedEvent } from "./output-parser";
  export { OutputMonitor, type OutputMonitorConfig, startMonitor, stopMonitor, getMonitor, type MonitorEvent } from "./output-monitor";
  ```

### Task 2: SSE 推送通道

- [ ] 2.1 在 `src/app/api/events/tasks/[taskId]/route.ts` 实现 SSE endpoint：

  ```typescript
  /**
   * SSE endpoint: /api/events/tasks/[taskId]
   *
   * 职责（架构要求 — 实时更新优先 SSE、轮询兜底）：
   * - 建立 taskId 对应的 SSE 连接
   * - 将客户端注册到 taskId 的广播组
   * - 推送：agent 输出事件、状态变更、心跳、交互请求
   * - 连接断开时自动清理注册
   * - 支持断线重连：客户端可带 Last-Event-ID
   */

  import { NextRequest } from "next/server";
  import { sseBroadcaster } from "@/lib/execution/monitor/sse-broadcaster";

  export const dynamic = "force-dynamic";

  export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
  ) {
    const { taskId } = await params;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        // 注册到 taskId 的广播组
        const clientId = sseBroadcaster.register(taskId, (data) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            // 客户端已断开，cleanup 由 unregister 处理
          }
        });

        // 处理 Last-Event-ID（断线重连）
        const lastEventId = request.headers.get("Last-Event-ID");
        if (lastEventId) {
          sseBroadcaster.sendCatchup(taskId, lastEventId, (data) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          });
        }

        // 心跳注释，保持连接活跃
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            clearInterval(heartbeat);
          }
        }, 30_000);

        // 清理函数
        request.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          sseBroadcaster.unregister(taskId, clientId);
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // 禁用 Nginx 缓冲
      },
    });
  }
  ```

- [ ] 2.2 在 `src/lib/execution/monitor/` 下实现 `sse-broadcaster.ts`：

  ```typescript
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
  };

### Task 3: 交互请求识别与 WAITING_FOR_INPUT 状态联动

- [ ] 3.1 在 `src/lib/execution/monitor/interaction-detector.ts` 中实现交互请求识别：

  ```typescript
  /**
   * 交互请求检测器 — 当 OutputParser 识别到交互请求时触发。
   *
   * 职责（FR26, AC-2）：
   * - 接收 ParsedEvent 中 type="interaction_request" 的事件
   * - 创建 InteractionRequest 记录到数据库
   * - 通过 SSE 推送到控制面
   * - 触发状态变更：RUNNING → WAITING_FOR_INPUT
   */

  import { prisma } from "@/lib/db/client";
  import { sseBroadcaster } from "./sse-broadcaster";
  import { transitionTask } from "@/lib/execution/state-machine";

  export interface DetectInteractionParams {
    taskId: string;
    agentRunId: string;
    rawLine: string;
    summary: string;
    detail?: string;
    confidence: "high" | "medium" | "low";
  }

  /**
   * 检测并记录交互请求。
   * 如果同一行内容已在最近 60 秒内记录过（去重），则跳过。
   */
  export async function detectAndRecordInteraction(
    params: DetectInteractionParams
  ): Promise<{ created: boolean; requestId?: string }> {
    const { taskId, agentRunId, rawLine, summary, detail, confidence } = params;

    // 去重：检查最近 60 秒内是否有相同的交互请求
    const recentCutoff = new Date(Date.now() - 60_000);
    const existing = await prisma.interactionRequest.findFirst({
      where: {
        taskId,
        createdAt: { gte: recentCutoff },
        content: { contains: rawLine.substring(0, 100) },
      },
    });

    if (existing) {
      return { created: false };
    }

    // 创建 InteractionRequest 记录
    const request = await prisma.interactionRequest.create({
      data: {
        taskId,
        agentRunId,
        type: "input_required",
        title: summary,
        content: rawLine,
        context: detail ? { detail } : undefined,
        confidence,
        status: "pending",
      },
    });

    // 触发状态变更：RUNNING → WAITING_FOR_INPUT
    // 注意：transitionTask() 接受单个 TransitionInput 对象参数，不是 positional 参数
    // 触发器使用枚举值 "agent_request_input"（见 state-machine/types.ts）
    await transitionTask({
      taskId,
      toStatus: "waiting_for_input",
      trigger: "agent_request_input",
      reason: `Agent 请求用户输入: ${summary}`,
    });

    // 通过 SSE 广播交互请求事件
    sseBroadcaster.broadcast(taskId, {
      type: "interaction_request",
      requestId: request.id,
      taskId,
      title: summary,
      content: rawLine,
      context: detail,
      timestamp: new Date().toISOString(),
    });

    return { created: true, requestId: request.id };
  }
  ```

- [ ] 3.2 在 `prisma/schema.prisma` 中添加 `InteractionRequest` 模型（如尚未存在）：

  ```prisma
  model InteractionRequest {
    id        String   @id @default(cuid())
    taskId    String
    agentRunId String
    type      String   // "input_required" | "confirmation" | "strategy_choice"
    title     String
    content   String
    context   Json?
    confidence String  // "high" | "medium" | "low"
    status    String   // "pending" | "responded" | "expired"
    response  String?
    respondedBy String?
    respondedAt DateTime?
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    task     Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
    agentRun AgentRun @relation(fields: [agentRunId], references: [id], onDelete: Cascade)

    @@index([taskId, status])
    @@index([agentRunId])
    @@map("interaction_requests")
  }
  ```

- [ ] 3.3 运行 `pnpm prisma migrate dev --name add_interaction_request_model`

### Task 4: 轮询兜底机制

- [ ] 4.1 在 `src/lib/execution/monitor/polling-fallback.ts` 中实现轮询兜底：

  ```typescript
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
  ```

  - [ ] 4.2 在 `src/app/api/events/tasks/[taskId]/poll/route.ts` 实现轮询端点：

  ```typescript
  /**
   * 轮询端点: /api/events/tasks/[taskId]/poll
   *
   * 返回自 after_event 或 after_line_offset 之后的所有新事件。
   */

  import { NextRequest, NextResponse } from "next/server";
  import { sseBroadcaster } from "@/lib/execution/monitor/sse-broadcaster";

  export const dynamic = "force-dynamic";

  export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
  ) {
    const { taskId } = await params;
    const afterEventId = request.nextUrl.searchParams.get("after_event");
    const afterLineOffset = request.nextUrl.searchParams.get("after_line_offset");

    const events = sseBroadcaster.getRecentEvents(taskId, {
      afterEventId: afterEventId ?? undefined,
      afterLineOffset: afterLineOffset ? parseInt(afterLineOffset, 10) : undefined,
    });

    return NextResponse.json({ events, taskId });
  }
  ```

### Task 5: UI 集成 — 实时输出展示

- [ ] 5.1 更新 `src/components/tasks/task-detail-view.tsx`：

  - 5.1.1 添加 SSE 连接和轮询兜底逻辑：

    ```tsx
    "use client";

    import { useEffect, useRef, useState, useCallback } from "react";
    import { createPollingFallback, type PollingState } from "@/lib/execution/monitor/polling-fallback";

    interface AgentOutputEvent {
      id: string;
      type: string;
      events: Array<{
        type: "progress" | "interaction_request" | "error" | "warning" | "info";
        summary: string;
        detail?: string;
        timestamp: string;
      }>;
      lineOffset: number;
      timestamp: string;
    }

    export function TaskDetailPanel({ taskId }: { taskId: string }) {
      const [agentEvents, setAgentEvents] = useState<AgentOutputEvent["events"]>([]);
      const eventSourceRef = useRef<EventSource | null>(null);
      const pollingRef = useRef<ReturnType<typeof createPollingFallback> | null>(null);
      const [sseConnected, setSseConnected] = useState(false);

      const connectSSE = useCallback(() => {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }

        const es = new EventSource(`/api/events/tasks/${taskId}`);
        eventSourceRef.current = es;

        es.onopen = () => {
          setSseConnected(true);
          // SSE 连上后停止轮询
          pollingRef.current?.stop();
        };

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data) as AgentOutputEvent;
            if (data.type === "agent_output" || data.type === "state_change") {
              setAgentEvents((prev) => [...prev, ...data.events].slice(-200));
            }
            if (data.type === "interaction_request") {
              // 交互请求单独高亮处理
              setAgentEvents((prev) => [
                ...prev,
                {
                  type: "interaction_request",
                  summary: data.title ?? "Agent 请求输入",
                  detail: data.content,
                  timestamp: data.timestamp,
                },
              ]);
            }
          } catch {
            // ignore parse errors
          }
        };

        es.onerror = () => {
          setSseConnected(false);
          // SSE 断开时启动轮询兜底
          if (!pollingRef.current) {
            pollingRef.current = createPollingFallback(
              { taskId, intervalMs: 10_000 },
              (events) => {
                setAgentEvents((prev) => [...prev, ...(events as AgentOutputEvent["events"])].slice(-200));
              }
            );
            pollingRef.current.start();
          }
        };
      }, [taskId]);

      useEffect(() => {
        connectSSE();
        return () => {
          eventSourceRef.current?.close();
          pollingRef.current?.stop();
        };
      }, [connectSSE]);

      return (
        <div className="space-y-4">
          {/* SSE/轮询状态指示 */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`w-2 h-2 rounded-full ${sseConnected ? "bg-green-500" : "bg-yellow-500"}`}
            />
            {sseConnected ? "实时连接中" : "轮询模式"}
          </div>

          {/* Agent 输出事件列表 */}
          <div className="space-y-2">
            {agentEvents.map((event, i) => (
              <div
                key={i}
                className={`text-sm p-2 rounded ${
                  event.type === "interaction_request"
                    ? "bg-amber-50 border border-amber-200"
                    : event.type === "error"
                    ? "bg-red-50 text-red-700"
                    : "bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{event.summary}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.timestamp).toLocaleTimeString("zh-CN")}
                  </span>
                </div>
                {event.detail && (
                  <p className="text-xs text-muted-foreground mt-1">{event.detail}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }
    ```

- [ ] 5.2 在任务详情页中集成交互请求面板（Story 5.5 会进一步扩展）：

  - 5.2.1 在 `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/tasks/[taskId]/page.tsx` 中添加交互请求列表：

    ```tsx
    // 获取当前任务的待处理交互请求
    const pendingRequests = await prisma.interactionRequest.findMany({
      where: {
        taskId,
        status: "pending",
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    ```

### Task 6: 补充回归测试

- [ ] 6.1 在 `src/lib/execution/monitor/__tests__/output-parser.test.ts` 中测试输出解析器：

  ```typescript
  import { describe, it, expect } from "vitest";
  import { parseOutputLine, parseOutputBatch } from "../output-parser";

  describe("输出解析器", () => {
    it("应识别交互请求模式（? 结尾）", () => {
      const event = parseOutputLine("Should I proceed?");
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别交互请求模式（y/n）", () => {
      const event = parseOutputLine("(y/n)");
      expect(event?.type).toBe("interaction_request");
    });

    it("应识别 coding 阶段", () => {
      const event = parseOutputLine("Implementing the feature...");
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("coding");
    });

    it("应识别 error", () => {
      const event = parseOutputLine("Error: file not found");
      expect(event?.type).toBe("error");
    });

    it("应识别进度百分比", () => {
      const event = parseOutputLine("[####    ] 40%");
      expect(event?.type).toBe("progress");
      expect(event?.summary).toContain("40%");
    });

    it("应跳过空行", () => {
      const events = parseOutputBatch(["", "  ", "normal output line"], new Date());
      // 空行不产生事件
      expect(events.length).toBeLessThanOrEqual(1);
    });

    it("parseOutputBatch 应批量解析并返回非空事件", () => {
      const lines = [
        "Starting task...",
        "Analyzing codebase...",
        "Should I create the file?",
        "Done.",
      ];
      const events = parseOutputBatch(lines, new Date());
      expect(events.length).toBeGreaterThan(0);
    });
  });
  ```

- [ ] 6.2 在 `src/lib/execution/monitor/__tests__/sse-broadcaster.test.ts` 中测试 SSE 广播器：

  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { sseBroadcaster } from "../sse-broadcaster";

  describe("SSE 广播器", () => {
    beforeEach(() => {
      // 重置广播器状态
      vi.restoreAllMocks();
    });

    it("应注册和取消注册客户端", () => {
      const send = vi.fn();
      const clientId = sseBroadcaster.register("task-1", send);
      expect(sseBroadcaster.getClientCount("task-1")).toBe(1);

      sseBroadcaster.unregister("task-1", clientId);
      expect(sseBroadcaster.getClientCount("task-1")).toBe(0);
    });

    it("应广播事件到所有注册的客户端", () => {
      const send1 = vi.fn();
      const send2 = vi.fn();
      sseBroadcaster.register("task-1", send1);
      sseBroadcaster.register("task-1", send2);

      sseBroadcaster.broadcast("task-1", { type: "test", data: { msg: "hello" } });

      expect(send1).toHaveBeenCalledTimes(1);
      expect(send2).toHaveBeenCalledTimes(1);
    });

    it("广播到不存在的 taskId 不应报错", () => {
      expect(() => {
        sseBroadcaster.broadcast("nonexistent-task", { type: "test", data: {} });
      }).not.toThrow();
    });

    it("getRecentEvents 应返回最近事件", () => {
      sseBroadcaster.broadcast("task-1", { type: "event1", data: { n: 1 } });
      sseBroadcaster.broadcast("task-1", { type: "event2", data: { n: 2 } });

      const events = sseBroadcaster.getRecentEvents("task-1");
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it("getRecentEvents 应按 afterLineOffset 过滤", () => {
      sseBroadcaster.broadcast("task-1", { type: "e1", data: {}, lineOffset: 10 });
      sseBroadcaster.broadcast("task-1", { type: "e2", data: {}, lineOffset: 20 });
      sseBroadcaster.broadcast("task-1", { type: "e3", data: {}, lineOffset: 30 });

      const after15 = sseBroadcaster.getRecentEvents("task-1", { afterLineOffset: 15 });
      // 应只返回 lineOffset > 15 的事件
      expect(after15.every((e) => (e.lineOffset ?? 0) > 15)).toBe(true);
    });

    it("getClientCount 应返回当前连接数", () => {
      expect(sseBroadcaster.getClientCount("task-1")).toBe(0);
      const id1 = sseBroadcaster.register("task-1", vi.fn());
      const id2 = sseBroadcaster.register("task-1", vi.fn());
      expect(sseBroadcaster.getClientCount("task-1")).toBe(2);
      sseBroadcaster.unregister("task-1", id1);
      expect(sseBroadcaster.getClientCount("task-1")).toBe(1);
      sseBroadcaster.unregister("task-1", id2);
      expect(sseBroadcaster.getClientCount("task-1")).toBe(0);
    });
  });
  ```

- [ ] 6.3 在 `src/lib/execution/monitor/__tests__/interaction-detector.test.ts` 中测试交互检测器：

  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { detectAndRecordInteraction } from "../interaction-detector";

  describe("交互请求检测", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("应创建 InteractionRequest 记录并触发状态变更", async () => {
      // mock prisma 和 transitionTask
    });

    it("应对重复请求去重", async () => {
      // mock prisma 找到近期重复记录
    });
  });
  ```

- [ ] 6.4 运行 `pnpm test` 确保所有测试通过

- [ ] 6.5 运行 `pnpm lint` 确保无 lint 错误

## Dev Notes

### 关键约束（来自 Checklist 自动分析）

> **这些约束必须严格遵守，违反将导致实现失败或破坏现有功能。**

1. **原始输出不写数据库**：tmux 输出在内存中维护，持久化仅存储偏移量和解析后的事件摘要。大体量输出内容通过文件系统引用（架构要求）。

2. **SSE 优先、轮询兜底**：UI 必须同时实现两种机制。SSE 断开时自动降级到轮询（间隔 10 秒），恢复时切回 SSE。

3. **推送延迟 < 15 秒**：OutputMonitor 的轮询间隔默认 5 秒，加上解析和 SSE 传输，总延迟需满足 NFR3。监控器轮询间隔可通过配置调整，但不能超过 15 秒。

4. **交互请求去重**：同一内容在 60 秒内只创建一个 `InteractionRequest` 记录，避免重复推送。

5. **`transitionTask()` API 签名**：函数接受**单个 `TransitionInput` 对象参数**，不是 positional 参数：
   ```typescript
   // ✅ 正确：
   await transitionTask({ taskId, toStatus: "waiting_for_input", trigger: "agent_request_input", reason: "..." });
   // ❌ 错误（会编译失败）：
   await transitionTask(taskId, "waiting_for_input", { trigger: "...", reason: "..." });
   ```
   触发器必须使用枚举值 `"agent_request_input"`（来自 `STATE_TRANSITION_TRIGGER_VALUES`），而不是自定义字符串。

6. **WAITING_FOR_INPUT 状态联动**：检测到交互请求后，必须通过 `transitionTask()` 触发状态变更，状态机是唯一的状态真值来源。

7. **SSE 心跳保持连接**：每 30 秒发送一次 `: heartbeat\n\n` 注释，防止代理或中间节点关闭空闲连接。

8. **断线重连支持**：`Last-Event-ID` 用于 catch-up 重发最近 100 条事件，确保重连后不丢失数据。

9. **SSE broadcaster 是新建，非复用**：Story 5.2 没有 SSE broadcaster。Task 2 新建的 `sseBroadcaster` 将作为 SSE 推送的唯一来源。

10. **与 `HeartbeatScheduler` 注册表对齐**：`OutputMonitor` 应使用类似的模块级 Map 注册表（`startMonitor`/`stopMonitor`/`getMonitor`），`lifecycle.ts` 在 session 结束时同时停止两者。

11. **中文 UI 文本**：所有用户可见文本必须中文。

### 核心实现目标

- Story 5.3 的核心是建立**实时可见性管道**：让用户在任务运行时看到 agent 输出、状态变化和交互请求。
- SSE 是主要推送通道，轮询是降级兜底。
- tmux 输出捕获 + 输出解析 + SSE 广播构成完整链路。
- 交互请求检测触发状态变更，形成端到端的感知-响应闭环。

### 前序 Story 情报（Story 5.2）

#### 已建立的心跳基础设施

- `Heartbeat` Prisma 模型已建立，心跳记录每 30 秒写入一次。
- `HeartbeatScheduler` 运行在监督器进程内存中，使用模块级 Map 注册表（`registerScheduler`/`getScheduler`/`unregisterScheduler`）。
- `computeStateTrust()` 已实现，UI 侧可根据心跳 confidence 展示状态可信度。
- **注意：Story 5.2 没有 SSE broadcaster** — SSE 广播器是本故事 Task 2 的新建内容，不存在复用问题。

#### 与本 Story 的关系

- Story 5.2 的心跳系统提供"系统是否活着"的信心，本 Story 的输出监听提供"agent 在做什么"的内容可见性。
- `OutputMonitor` 应参照 `HeartbeatScheduler` 的注册表模式，在 `launch.ts` 中使用类似的 `startMonitor`/`stopMonitor` 函数注册管理。
- 两者都通过本故事 Task 2 新建的 `sseBroadcaster` 推送更新，可以共享同一 `/api/events/tasks/[taskId]` endpoint。
- `lifecycle.ts` 在 session 结束时，应同时停止 `OutputMonitor` 和 `HeartbeatScheduler`。

### 当前代码锚点

- `src/lib/execution/supervisor/launch.ts` — session 启动，需在 running 状态后 `startMonitor()`
- `src/lib/execution/supervisor/lifecycle.ts` — session 结束，需 `stopMonitor()`
- `src/lib/execution/heartbeat/` — 心跳系统（Story 5.2），可复用 SSE 通道
- `src/lib/execution/monitor/` — 新建目录，放置本故事所有新模块
- `src/app/api/events/tasks/[taskId]/` — SSE endpoint（新建）
- `src/app/api/events/tasks/[taskId]/poll/` — 轮询 endpoint（新建）
- `src/components/tasks/task-detail-view.tsx` — 任务详情 UI，需集成 SSE 连接
- `prisma/schema.prisma` — 需添加 `InteractionRequest` 模型

### 推荐文件落点

```
src/lib/execution/
├── monitor/                        # 新建目录
│   ├── index.ts                   # 导出所有 monitor API
│   ├── tmux-output-capture.ts     # tmux 输出捕获
│   ├── output-parser.ts           # 输出解析（状态/交互/错误识别）
│   ├── output-monitor.ts          # 轮询调度 + 事件提取
│   ├── sse-broadcaster.ts         # SSE 广播器（Task 2 新建，为 monitor 和后续 heartbeat 广播共用）
│   ├── interaction-detector.ts    # 交互请求检测与状态联动
│   ├── polling-fallback.ts        # 轮询兜底机制
│   └── __tests__/
│       ├── output-parser.test.ts
│       ├── sse-broadcaster.test.ts
│       └── interaction-detector.test.ts
└── heartbeat/                     # Story 5.2 已建立
    └── ...

src/app/api/events/
└── tasks/
    └── [taskId]/
        ├── route.ts               # SSE endpoint
        └── poll/
            └── route.ts           # 轮询 endpoint
```

### 测试要求

- 测试框架继续使用 Vitest。
- 必须覆盖输出解析器的所有模式识别（交互请求、状态阶段、进度、错误）。
- 必须覆盖 SSE 广播器的注册、取消注册、广播和最近事件查询。
- 必须覆盖交互请求检测的去重逻辑和状态联动。
- 必须覆盖轮询兜底的启动、停止和状态管理。
- 集成测试（可选）：测试 SSE 连接、事件广播、轮询降级的完整链路。

### 最新技术信息

- Next.js 16.1.6、React 19.2.3、Prisma 6.19.2、Zod 4.3.6 版本基线不变。
- SSE 实现使用 Next.js App Router Route Handler + `ReadableStream`，无需额外库。
- tmux 输出捕获使用 `tmux capture-pane -t session -p -S - -E -` 命令。
- SSE 心跳间隔 30 秒，防止 Nginx/代理关闭空闲连接。
- `X-Accel-Buffering: no` 头禁用 Nginx 缓冲，确保实时推送。

### 范围边界

**本 Story 包含：**

- ✅ tmux 输出捕获（内存中，不写 DB）
- ✅ 输出解析（交互请求、状态阶段、进度、错误识别）
- ✅ SSE 推送通道（SSE endpoint + 广播器）
- ✅ 交互请求检测 + InteractionRequest 记录创建
- ✅ 状态联动（RUNNING → WAITING_FOR_INPUT）
- ✅ 轮询兜底机制（轮询端点 + 降级逻辑）
- ✅ 断线重连支持（Last-Event-ID + catch-up）
- ✅ UI 集成（SSE 连接 + 轮询切换 + 事件展示）
- ✅ 交互请求检测的 Prisma 模型
- ✅ 单元测试

**本 Story 不包含：**

- ❌ 交互请求的 UI 响应（由 Story 5.4/5.5 负责）
- ❌ 用户输入转发到 tmux（由 Story 5.4 负责）
- ❌ 交互请求的批准/驳回/改派操作（由 Story 5.5 负责）
- ❌ 执行日志的流式采集（由 Story 5.8 负责）
- ❌ 完整交互历史的存储和展示（由 Story 5.6 负责）
- ❌ 原始日志的文件系统持久化（由 Story 5.8 负责）
- ❌ 心跳超时的异常检测（由 Story 6.1 负责）

### Project Structure Notes

- `src/lib/execution/monitor/` 是本故事的核心目录，与 `heartbeat/`、`state-machine/` 平级。
- SSE broadcaster 是跨模块共享组件，Story 5.2 的心跳更新和本故事的输出更新共用同一广播通道。
- Prisma 模型变更需运行迁移并提交迁移文件。
- UI 组件使用 `"use client"`，但 SSE 连接和轮询逻辑封装在可复用的 hook 中。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3] — Story 5.3 原始用户故事与验收标准
- [Source: _bmad-output/planning-artifacts/epics.md#FR26] — Agent 输出监听（FR26）
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 5] — Epic 5 完整上下文
- [Source: _bmad-output/planning-artifacts/prd.md#NFR3] — 推送延迟小于 15 秒（NFR3）
- [Source: _bmad-output/planning-artifacts/architecture.md#Hybrid Communication Patterns] — SSE 优先、轮询兜底
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — 原始日志不进高频事务热表
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Feedback Patterns] — 状态 + 原因 + 下一步反馈原则
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Journey 2] — 第二个关键时刻：系统第一次发起交互请求
- [Source: _bmad-output/implementation-artifacts/5-2-长时间运行任务的状态连续与上下文保持.md] — 前序 Story 5.2（心跳系统已建立；SSE broadcaster 由本故事 Task 2 新建，非复用）
- [Source: _bmad-output/implementation-artifacts/4-4-tmux后台执行会话创建与管理.md] — tmux 会话管理
- [Source: _bmad-output/project-context.md] — 项目约束与规范
- [Source: AGENTS.md] — 错误处理、Tailwind、Server Actions 规范
- [Source: src/lib/execution/state-machine/transitioner.ts] — 状态变更入口，transitionTask() 接受 TransitionInput 对象参数
- [Source: src/lib/execution/state-machine/types.ts] — STATE_TRANSITION_TRIGGER_VALUES 枚举值（含 "agent_request_input"）
- [Source: src/lib/execution/state-machine/types.ts] — TASK_STATUS_VALUES 枚举值（含 "waiting_for_input"）
- [Source: src/lib/execution/supervisor/launch.ts] — 会话启动，需接入 OutputMonitor
- [Source: src/lib/execution/supervisor/lifecycle.ts] — 会话生命周期，需停止 OutputMonitor
- [Source: src/lib/execution/heartbeat/scheduler.ts] — HeartbeatScheduler 注册表模式（registerScheduler/getScheduler），OutputMonitor 应参照此模式
- [Source: prisma/schema.prisma] — 数据库模型，需添加 InteractionRequest

## Dev Agent Record

### Agent Model Used

（待 dev-story 执行时填写）

### Debug Log References

（待 dev-story 执行时填写）

### Completion Notes List

（待 dev-story 执行时填写）

### File List

（待 dev-story 执行时填写）
