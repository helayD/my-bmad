-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('PRD', 'EPIC', 'STORY', 'TASK');

-- CreateTable
CREATE TABLE "bmad_artifacts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ArtifactType" NOT NULL,
    "name" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "parentId" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bmad_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bmad_artifacts_projectId_idx" ON "bmad_artifacts"("projectId");

-- CreateIndex
CREATE INDEX "bmad_artifacts_parentId_idx" ON "bmad_artifacts"("parentId");

-- CreateIndex
CREATE INDEX "bmad_artifacts_projectId_type_idx" ON "bmad_artifacts"("projectId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "bmad_artifacts_projectId_filePath_key" ON "bmad_artifacts"("projectId", "filePath");

-- AddForeignKey
ALTER TABLE "bmad_artifacts" ADD CONSTRAINT "bmad_artifacts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bmad_artifacts" ADD CONSTRAINT "bmad_artifacts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "bmad_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
