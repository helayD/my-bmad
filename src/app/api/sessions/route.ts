/**
 * GET /api/sessions?taskId=<taskId>
 *
 * Read-only snapshot of the current ExecutionSession for a task.
 * Provides minimal session state consumed by task detail, planning detail,
 * and artifact history views without requiring full DB load.
 *
 * This is a lightweight read endpoint for Epic 5 polling / SSE integration.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { resolveTaskCurrentSessionView } from "@/lib/tasks/tracking";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  // Fetch minimal projection — only what's needed for session snapshot.
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      currentAgentRunId: true,
      executionSessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          taskId: true,
          agentRunId: true,
          transport: true,
          sessionName: true,
          processPid: true,
          status: true,
          startedAt: true,
          completedAt: true,
          terminatedAt: true,
          terminationReasonCode: true,
          terminationReasonSummary: true,
          createdAt: true,
        },
      },
      metadata: true,
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const session = resolveTaskCurrentSessionView(
    { executionSessions: task.executionSessions as never, metadata: task.metadata },
    task.currentAgentRunId,
  );

  return NextResponse.json({
    taskId: task.id,
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    session,
  });
}
