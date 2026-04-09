import type { ArtifactTreeNode, ArtifactTypeString } from "./types";

interface FlatArtifact {
  id: string;
  type: ArtifactTypeString;
  name: string;
  filePath: string;
  metadata: Record<string, unknown> | null;
  parentId: string | null;
}

/**
 * Convert a flat list of artifacts into a tree structure based on parentId.
 * Orphan nodes (parentId points to a non-existent record) are promoted to root.
 */
export function buildArtifactTree(artifacts: FlatArtifact[]): ArtifactTreeNode[] {
  const nodeMap = new Map<string, ArtifactTreeNode>();
  const roots: ArtifactTreeNode[] = [];

  // Create all nodes first
  for (const a of artifacts) {
    nodeMap.set(a.id, {
      id: a.id,
      type: a.type,
      name: a.name,
      filePath: a.filePath,
      metadata: a.metadata,
      children: [],
    });
  }

  // Build tree by linking children to parents
  for (const a of artifacts) {
    const node = nodeMap.get(a.id)!;
    if (a.parentId && nodeMap.has(a.parentId)) {
      nodeMap.get(a.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
