-- CreateInteractionRequest
CREATE TABLE "interaction_requests" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "context" JSONB,
    "confidence" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response" TEXT,
    "respondedBy" TEXT,
    "respondedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "interaction_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "interaction_requests_taskId_status_idx" ON "interaction_requests"("taskId", "status");
CREATE INDEX "interaction_requests_agentRunId_idx" ON "interaction_requests"("agentRunId");

ALTER TABLE "interaction_requests" ADD CONSTRAINT "interaction_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "interaction_requests" ADD CONSTRAINT "interaction_requests_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
