-- CreateTable
CREATE TABLE "planning_requests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "rawGoal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'analyzing',
    "progressPercent" INTEGER NOT NULL DEFAULT 10,
    "nextStep" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planning_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planning_requests_workspaceId_createdAt_idx" ON "planning_requests"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "planning_requests_projectId_createdAt_idx" ON "planning_requests"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "planning_requests_projectId_status_createdAt_idx" ON "planning_requests"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "planning_requests_createdByUserId_createdAt_idx" ON "planning_requests"("createdByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "planning_requests" ADD CONSTRAINT "planning_requests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_requests" ADD CONSTRAINT "planning_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_requests" ADD CONSTRAINT "planning_requests_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
