/**
 * 状态可信度 — 长时间运行任务的核心信任机制。
 *
 * 规则（NFR3, NFR12, NFR36, NFR39）：
 * - 控制面展示的状态必须带有可信度标记
 * - "trusted"：最近有心跳，状态可信
 * - "stale"：心跳有延迟但未超时，用户可见但需提示
 * - "unknown"：心跳超时或任务不在运行，控制面必须显式暴露"状态不可信"
 * - 任何情况下不得在"unknown"状态下默认显示"成功"或"运行中"
 */

import { getHeartbeatStatus, type HeartbeatStatus } from "@/lib/execution/heartbeat";

export type StateConfidence = "trusted" | "stale" | "unknown";

export interface StateTrustLevel {
  confidence: StateConfidence;
  heartbeatStatus: HeartbeatStatus;
  displayRecommendation: "show_normal" | "show_warning" | "show_stale" | "show_unknown";
  badgeText: { zh: string; en: string };
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
}

/**
 * 根据任务 ID 和心跳状态计算状态可信度。
 */
export async function computeStateTrust(
  taskId: string,
  currentStatus: string,
  config: { heartbeatTimeoutMs?: number } = {}
): Promise<StateTrustLevel> {
  const heartbeat = await getHeartbeatStatus(taskId, {
    timeoutMs: config.heartbeatTimeoutMs ?? 60_000,
  });

  const confidence = heartbeat.confidence;

  let displayRecommendation: StateTrustLevel["displayRecommendation"];
  let badgeText: StateTrustLevel["badgeText"];
  let badgeVariant: StateTrustLevel["badgeVariant"];

  switch (confidence) {
    case "trusted":
      displayRecommendation = "show_normal";
      badgeText = { zh: "可信", en: "Trusted" };
      badgeVariant = "default";
      break;

    case "stale":
      displayRecommendation = "show_stale";
      badgeText = { zh: "数据滞后", en: "Stale" };
      badgeVariant = "secondary";
      break;

    case "unknown":
    default: {
      // 如果任务本就不是运行态（如已完成），"unknown" 心跳不代表问题
      const isRunningStatus = ["starting", "running", "waiting_for_input", "recovering"].includes(
        currentStatus
      );
      if (!isRunningStatus) {
        displayRecommendation = "show_normal";
        badgeText = { zh: "可信", en: "Trusted" };
        badgeVariant = "default";
      } else {
        displayRecommendation = "show_unknown";
        badgeText = { zh: "状态不可信", en: "Uncertain" };
        badgeVariant = "destructive";
      }
      break;
    }
  }

  return { confidence, heartbeatStatus: heartbeat, displayRecommendation, badgeText, badgeVariant };
}
