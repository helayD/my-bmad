-- Create ExecutionSession model
CREATE TABLE "execution_sessions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "transport" TEXT NOT NULL DEFAULT 'tmux',
  "sessionName" TEXT NOT NULL,
  "processPid" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'starting',
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "terminatedAt" TIMESTAMPTZ,
  "terminationReasonCode" TEXT,
  "terminationReasonSummary" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "execution_sessions_pkey" PRIMARY KEY ("id")
);

-- ExecutionSession -> Workspace
ALTER TABLE "execution_sessions"
  ADD CONSTRAINT "execution_sessions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "workspaces"("id")
  ON DELETE CASCADE;

-- ExecutionSession -> Project
ALTER TABLE "execution_sessions"
  ADD CONSTRAINT "execution_sessions_projectId_fkey"
  FOREIGN KEY ("projectId")
  REFERENCES "projects"("id")
  ON DELETE CASCADE;

-- ExecutionSession -> Task
ALTER TABLE "execution_sessions"
  ADD CONSTRAINT "execution_sessions_taskId_fkey"
  FOREIGN KEY ("taskId")
  REFERENCES "tasks"("id")
  ON DELETE CASCADE;

-- ExecutionSession -> AgentRun (unique: one active session per run)
ALTER TABLE "execution_sessions"
  ADD CONSTRAINT "execution_sessions_agentRunId_fkey"
  FOREIGN KEY ("agentRunId")
  REFERENCES "agent_runs"("id")
  ON DELETE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "execution_sessions_sessionName_key" ON "execution_sessions"("sessionName");
CREATE INDEX "execution_sessions_projectId_status_createdAt_idx" ON "execution_sessions"("projectId", "status", "createdAt");
CREATE INDEX "execution_sessions_taskId_createdAt_idx" ON "execution_sessions"("taskId", "createdAt");
CREATE INDEX "execution_sessions_workspaceId_createdAt_idx" ON "execution_sessions"("workspaceId", "createdAt");
CREATE INDEX "execution_sessions_agentRunId_idx" ON "execution_sessions"("agentRunId");

-- Add foreign key for agentRuns -> execution_sessions (optional back-reference via metadata, no FK needed)
