import Link from "next/link";
import { File, Folder } from "lucide-react";
import type { FileTreeNode } from "@/lib/bmad/types";

interface ProjectBmadArtifactsProps {
  fileTree: FileTreeNode[];
  repoOwner: string;
  repoName: string;
}

function TreeNode({
  node,
  repoOwner,
  repoName,
  depth = 0,
}: {
  node: FileTreeNode;
  repoOwner: string;
  repoName: string;
  depth?: number;
}) {
  const paddingLeft = depth * 16;

  if (node.type === "directory") {
    return (
      <div>
        <div
          className="flex items-center gap-2 py-1 text-sm font-medium text-muted-foreground"
          style={{ paddingLeft }}
        >
          <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          <span>{node.name}</span>
        </div>
        {node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            repoOwner={repoOwner}
            repoName={repoName}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 py-1 text-sm"
      style={{ paddingLeft }}
    >
      <File className="h-4 w-4 shrink-0 text-blue-500" />
      <span className="truncate">{node.name}</span>
    </div>
  );
}

export function ProjectBmadArtifacts({
  fileTree,
  repoOwner,
  repoName,
}: ProjectBmadArtifactsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">BMAD 工件</h2>
        <Link
          href={`/repo/${repoOwner}/${repoName}`}
          className="text-sm text-primary hover:underline"
        >
          查看完整仓库
        </Link>
      </div>
      <div className="rounded-lg border p-4">
        {fileTree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            repoOwner={repoOwner}
            repoName={repoName}
          />
        ))}
      </div>
    </div>
  );
}
