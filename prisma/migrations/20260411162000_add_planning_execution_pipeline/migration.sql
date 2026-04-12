-- AlterTable
ALTER TABLE "planning_requests"
ADD COLUMN "executionStartedAt" TIMESTAMP(3),
ADD COLUMN "executionCompletedAt" TIMESTAMP(3),
ADD COLUMN "executionFailedAt" TIMESTAMP(3),
ADD COLUMN "artifactSummary" JSONB,
ADD COLUMN "generatedArtifactCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastExecutionErrorCode" TEXT;

-- CreateTable
CREATE TABLE "planning_execution_steps" (
  "id" TEXT NOT NULL,
  "planningRequestId" TEXT NOT NULL,
  "skillKey" TEXT NOT NULL,
  "stepKey" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "title" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "outputSummary" TEXT,
  "artifactPaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "planning_execution_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planning_execution_steps_planningRequestId_stepKey_key"
ON "planning_execution_steps"("planningRequestId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "planning_execution_steps_planningRequestId_sequence_key"
ON "planning_execution_steps"("planningRequestId", "sequence");

-- CreateIndex
CREATE INDEX "planning_execution_steps_planningRequestId_sequence_idx"
ON "planning_execution_steps"("planningRequestId", "sequence");

-- CreateIndex
CREATE INDEX "planning_execution_steps_planningRequestId_status_idx"
ON "planning_execution_steps"("planningRequestId", "status");

-- CreateIndex
CREATE INDEX "planning_execution_steps_planningRequestId_skillKey_idx"
ON "planning_execution_steps"("planningRequestId", "skillKey");

-- AddForeignKey
ALTER TABLE "planning_execution_steps"
ADD CONSTRAINT "planning_execution_steps_planningRequestId_fkey"
FOREIGN KEY ("planningRequestId") REFERENCES "planning_requests"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
