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
import { sseBroadcaster } from "./sse-broadcaster";
import { detectAndRecordInteraction } from "./interaction-detector";

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
    } catch {
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

    // 检测交互请求并记录
    for (const event of events) {
      if (event.type === "interaction_request") {
        void detectAndRecordInteraction({
          taskId: this.taskId,
          agentRunId: this.agentRunId,
          rawLine: event.rawLine,
          summary: event.summary,
          detail: event.detail,
          confidence: event.confidence,
        });
      }
    }

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
      data: {
        taskId: this.taskId,
        agentRunId: this.agentRunId,
        events,
      },
      lineOffset: captured.lineOffset,
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
