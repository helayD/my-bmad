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
