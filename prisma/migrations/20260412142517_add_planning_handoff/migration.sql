-- AlterTable
ALTER TABLE "planning_requests"
ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "deferredArtifactCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "derivedTaskCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "taskHandoffSummary" JSONB;

-- AlterTable
ALTER TABLE "tasks"
ADD COLUMN "planningRequestId" TEXT;

-- CreateIndex
CREATE INDEX "tasks_planningRequestId_idx" ON "tasks"("planningRequestId");

-- CreateIndex
CREATE INDEX "tasks_projectId_planningRequestId_idx" ON "tasks"("projectId", "planningRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_planningRequestId_sourceArtifactId_key" ON "tasks"("planningRequestId", "sourceArtifactId");

-- AddForeignKey
ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_planningRequestId_fkey"
FOREIGN KEY ("planningRequestId") REFERENCES "planning_requests"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
