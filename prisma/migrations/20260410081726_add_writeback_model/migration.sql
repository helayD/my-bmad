-- AlterTable
ALTER TABLE "bmad_artifacts" ADD COLUMN     "executionStatus" TEXT,
ADD COLUMN     "latestRecoveryHint" TEXT,
ADD COLUMN     "latestWritebackArtifacts" JSONB,
ADD COLUMN     "latestWritebackAt" TIMESTAMP(3),
ADD COLUMN     "latestWritebackOutcome" TEXT,
ADD COLUMN     "latestWritebackSummary" TEXT,
ADD COLUMN     "latestWritebackTaskId" TEXT;

-- CreateTable
CREATE TABLE "writebacks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "writebackStatus" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "errorSummary" TEXT,
    "payload" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writebacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "artifactId" TEXT,
    "eventName" TEXT NOT NULL,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "writebacks_idempotencyKey_key" ON "writebacks"("idempotencyKey");

-- CreateIndex
CREATE INDEX "writebacks_workspaceId_idx" ON "writebacks"("workspaceId");

-- CreateIndex
CREATE INDEX "writebacks_projectId_idx" ON "writebacks"("projectId");

-- CreateIndex
CREATE INDEX "writebacks_taskId_occurredAt_idx" ON "writebacks"("taskId", "occurredAt");

-- CreateIndex
CREATE INDEX "writebacks_artifactId_occurredAt_idx" ON "writebacks"("artifactId", "occurredAt");

-- CreateIndex
CREATE INDEX "writebacks_projectId_artifactId_occurredAt_idx" ON "writebacks"("projectId", "artifactId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_workspaceId_occurredAt_idx" ON "audit_events"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_projectId_occurredAt_idx" ON "audit_events"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_taskId_occurredAt_idx" ON "audit_events"("taskId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_artifactId_occurredAt_idx" ON "audit_events"("artifactId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_projectId_eventName_occurredAt_idx" ON "audit_events"("projectId", "eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "bmad_artifacts_projectId_executionStatus_idx" ON "bmad_artifacts"("projectId", "executionStatus");

-- AddForeignKey
ALTER TABLE "writebacks" ADD CONSTRAINT "writebacks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writebacks" ADD CONSTRAINT "writebacks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writebacks" ADD CONSTRAINT "writebacks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writebacks" ADD CONSTRAINT "writebacks_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "bmad_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "bmad_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
