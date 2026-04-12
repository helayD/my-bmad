-- AlterTable
ALTER TABLE "planning_requests"
ADD COLUMN "routeType" TEXT,
ADD COLUMN "selectionReasonCode" TEXT,
ADD COLUMN "selectionReasonSummary" TEXT,
ADD COLUMN "selectedAgentKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "selectedSkillKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "analyzedAt" TIMESTAMP(3),
ADD COLUMN "executionHandoffDraft" JSONB;

-- AlterTable
ALTER TABLE "audit_events"
ADD COLUMN "planningRequestId" TEXT;

-- CreateIndex
CREATE INDEX "planning_requests_projectId_routeType_createdAt_idx"
ON "planning_requests"("projectId", "routeType", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_planningRequestId_occurredAt_idx"
ON "audit_events"("planningRequestId", "occurredAt");

-- AddForeignKey
ALTER TABLE "audit_events"
ADD CONSTRAINT "audit_events_planningRequestId_fkey"
FOREIGN KEY ("planningRequestId") REFERENCES "planning_requests"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
