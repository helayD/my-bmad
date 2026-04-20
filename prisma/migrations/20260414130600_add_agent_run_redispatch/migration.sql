-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "currentAgentRunId" TEXT,
ADD COLUMN     "intentDetail" TEXT,
ADD COLUMN     "preferredAgentType" TEXT;

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dispatched',
    "decisionSource" TEXT NOT NULL,
    "selectionReasonCode" TEXT NOT NULL,
    "selectionReasonSummary" TEXT NOT NULL,
    "matchedSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "terminationReasonCode" TEXT,
    "terminationReasonSummary" TEXT,
    "replacesRunId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_replacesRunId_key" ON "agent_runs"("replacesRunId");

-- CreateIndex
CREATE INDEX "agent_runs_workspaceId_createdAt_idx" ON "agent_runs"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_projectId_status_createdAt_idx" ON "agent_runs"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_taskId_createdAt_idx" ON "agent_runs"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_taskId_status_createdAt_idx" ON "agent_runs"("taskId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_taskId_agentType_createdAt_idx" ON "agent_runs"("taskId", "agentType", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_requestedByUserId_idx" ON "agent_runs"("requestedByUserId");

-- CreateIndex
CREATE INDEX "tasks_currentAgentRunId_idx" ON "tasks"("currentAgentRunId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_currentAgentRunId_fkey" FOREIGN KEY ("currentAgentRunId") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_replacesRunId_fkey" FOREIGN KEY ("replacesRunId") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
