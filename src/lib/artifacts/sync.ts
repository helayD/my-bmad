import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/generated/prisma/client";
import type { ScanResult, SyncReport } from "./types";

/**
 * Sync scanned artifacts into the database for a given project.
 * Uses batch transaction for atomicity.
 */
export async function syncArtifacts(
  projectId: string,
  scanResult: ScanResult,
): Promise<SyncReport> {
  const report: SyncReport = { created: 0, updated: 0, deleted: 0, errors: [] };

  // Empty scan protection: if no artifacts found but errors exist, skip soft-delete
  const hasOnlyErrors =
    scanResult.artifacts.length === 0 && scanResult.errors.length > 0;

  // Fetch existing records
  const existing = await prisma.bmadArtifact.findMany({
    where: { projectId },
  });
  // For epics from a single epics.md file, scanner generates unique filePath per epic
  // (e.g. epics.md#epic-1). Use filePath + epicId/storyId as compound key for matching.
  function artifactKey(filePath: string, metadata?: Record<string, unknown>): string {
    const epicId = metadata?.epicId;
    if (epicId !== undefined) return `${filePath}::epic::${epicId}`;
    const storyId = metadata?.storyId;
    if (storyId !== undefined) return `${filePath}::story::${storyId}`;
    return filePath;
  }

  const existingByKey = new Map(
    existing.map((a) => [
      artifactKey(a.filePath, (a.metadata as Record<string, unknown>) ?? {}),
      a,
    ]),
  );

  const scannedKeys = new Set<string>();
  // Track created artifact IDs with their type info for parentId resolution
  const artifactIdByKey = new Map<string, string>();

  // Pre-populate with existing IDs
  for (const [key, record] of existingByKey) {
    artifactIdByKey.set(key, record.id);
  }

  // Phase 1: Create/Update all records (without parentId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const operations: Prisma.PrismaPromise<any>[] = [];

  for (const artifact of scanResult.artifacts) {
    const key = artifactKey(artifact.filePath, artifact.metadata);
    scannedKeys.add(key);

    const existingRecord = existingByKey.get(key);

    if (existingRecord) {
      // Update existing
      operations.push(
        prisma.bmadArtifact.update({
          where: { id: existingRecord.id },
          data: {
            name: artifact.name,
            type: artifact.type,
            metadata: artifact.metadata as Prisma.InputJsonValue,
            status: "active",
          },
        }),
      );
      artifactIdByKey.set(key, existingRecord.id);
      report.updated++;
    } else {
      // Create new — IDs will be resolved in Phase 2 via findMany
      operations.push(
        prisma.bmadArtifact.create({
          data: {
            projectId,
            type: artifact.type,
            name: artifact.name,
            filePath: artifact.filePath,
            metadata: artifact.metadata as Prisma.InputJsonValue,
            status: "active",
          },
        }),
      );
      report.created++;
    }
  }

  // Phase 1.5: Soft-delete records not in scan results
  if (!hasOnlyErrors) {
    for (const [key, record] of existingByKey) {
      if (!scannedKeys.has(key) && record.status !== "deleted") {
        operations.push(
          prisma.bmadArtifact.update({
            where: { id: record.id },
            data: { status: "deleted" },
          }),
        );
        report.deleted++;
      }
    }
  }

  // Execute phase 1
  if (operations.length > 0) {
    try {
      await prisma.$transaction(operations);
    } catch (e) {
      report.errors.push(e instanceof Error ? e.message : String(e));
      return report;
    }
  }

  // Phase 2: Resolve parentId relationships
  // Reload all active artifacts to get proper IDs (including newly created ones)
  const allArtifacts = await prisma.bmadArtifact.findMany({
    where: { projectId, status: "active" },
  });

  const prdRecord = allArtifacts.find((a) => a.type === "PRD");
  const epicRecords = allArtifacts.filter((a) => a.type === "EPIC");
  const storyRecords = allArtifacts.filter((a) => a.type === "STORY");
  const taskRecords = allArtifacts.filter((a) => a.type === "TASK");

  const epicByEpicId = new Map<string, string>();
  for (const epic of epicRecords) {
    const meta = epic.metadata as Record<string, unknown> | null;
    const epicId = meta?.epicId;
    if (epicId !== undefined) {
      epicByEpicId.set(String(epicId), epic.id);
    }
  }

  const storyByStoryId = new Map<string, string>();
  for (const story of storyRecords) {
    const meta = story.metadata as Record<string, unknown> | null;
    const storyId = meta?.storyId;
    if (storyId !== undefined) {
      storyByStoryId.set(String(storyId), story.id);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parentUpdates: Prisma.PrismaPromise<any>[] = [];

  // Epic → PRD
  if (prdRecord) {
    for (const epic of epicRecords) {
      if (epic.parentId !== prdRecord.id) {
        parentUpdates.push(
          prisma.bmadArtifact.update({
            where: { id: epic.id },
            data: { parentId: prdRecord.id },
          }),
        );
      }
    }
  }

  // Story → Epic (via epicId in metadata)
  for (const story of storyRecords) {
    const meta = story.metadata as Record<string, unknown> | null;
    const epicId = meta?.epicId;
    if (epicId !== undefined) {
      const parentEpicId = epicByEpicId.get(String(epicId));
      if (parentEpicId && story.parentId !== parentEpicId) {
        parentUpdates.push(
          prisma.bmadArtifact.update({
            where: { id: story.id },
            data: { parentId: parentEpicId },
          }),
        );
      }
    }
  }

  // Task → Story (via storyId in metadata)
  for (const task of taskRecords) {
    const meta = task.metadata as Record<string, unknown> | null;
    const storyId = meta?.storyId;
    if (storyId !== undefined) {
      const parentStoryId = storyByStoryId.get(String(storyId));
      if (parentStoryId && task.parentId !== parentStoryId) {
        parentUpdates.push(
          prisma.bmadArtifact.update({
            where: { id: task.id },
            data: { parentId: parentStoryId },
          }),
        );
      }
    }
  }

  if (parentUpdates.length > 0) {
    try {
      await prisma.$transaction(parentUpdates);
    } catch (e) {
      report.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return report;
}
