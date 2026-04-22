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
