export type ArtifactTypeString = "PRD" | "EPIC" | "STORY" | "TASK";

export interface ScannedArtifact {
  type: ArtifactTypeString;
  name: string;
  filePath: string;
  metadata: Record<string, unknown>;
  epicId?: string;
  storyId?: string;
}

export interface ScanResult {
  artifacts: ScannedArtifact[];
  errors: { file: string; error: string }[];
}

export interface SyncReport {
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

export interface ArtifactTreeNode {
  id: string;
  type: ArtifactTypeString;
  name: string;
  filePath: string;
  metadata: Record<string, unknown> | null;
  children: ArtifactTreeNode[];
}
