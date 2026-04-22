import { prisma } from "@/lib/db/client";

export interface RecordHeartbeatParams {
  executionSessionId: string;
  taskId: string;
  agentRunId: string;
  status: string;
  currentStage?: string;
  currentActivity?: string;
  lastOutputHash?: string;
  pid?: number;
  metadata?: Record<string, unknown>;
}

export async function recordHeartbeat(
  params: RecordHeartbeatParams
): Promise<{ id: string }> {
  const heartbeat = await prisma.heartbeat.create({
    data: {
      executionSessionId: params.executionSessionId,
      taskId: params.taskId,
      agentRunId: params.agentRunId,
      status: params.status,
      currentStage: params.currentStage ?? null,
      currentActivity: params.currentActivity ?? null,
      lastOutputHash: params.lastOutputHash ?? null,
      pid: params.pid ?? null,
      metadata: (params.metadata ?? {}) as object,
    },
  });
  return { id: heartbeat.id };
}
