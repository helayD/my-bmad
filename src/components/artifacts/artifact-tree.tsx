"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  Layers,
  BookOpen,
  CheckSquare,
  ChevronRight,
  ChevronDown,
  TreePine,
  PanelRightOpen,
} from "lucide-react";
import { ArtifactDetailSheet } from "@/components/artifacts/artifact-detail-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ArtifactTreeNode, ArtifactTypeString } from "@/lib/artifacts/types";

const TYPE_CONFIG: Record<
  string,
  { icon: typeof FileText; color: string; label: string }
> = {
  PRD: { icon: FileText, color: "text-purple-500", label: "PRD" },
  EPIC: { icon: Layers, color: "text-blue-500", label: "Epic" },
  STORY: { icon: BookOpen, color: "text-green-500", label: "Story" },
  TASK: { icon: CheckSquare, color: "text-orange-500", label: "Task" },
};

interface ArtifactSelection {
  node: ArtifactTreeNode;
  hierarchy: Array<{
    id: string;
    type: ArtifactTypeString;
    name: string;
  }>;
}

function ArtifactNode({
  node,
  depth = 0,
  ancestors,
  selectedId,
  onSelect,
}: {
  node: ArtifactTreeNode;
  depth?: number;
  ancestors: ArtifactSelection["hierarchy"];
  selectedId?: string;
  onSelect: (selection: ArtifactSelection) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const config = TYPE_CONFIG[node.type] ?? TYPE_CONFIG.TASK;
  const Icon = config.icon;
  const status = node.metadata?.status as string | undefined;
  const isSelected = selectedId === node.id;
  const hierarchy = [...ancestors, { id: node.id, type: node.type, name: node.name }];

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
          isSelected ? "bg-primary/10" : "hover:bg-muted/50"
        }`}
        style={{ paddingLeft: depth * 20 + 8 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted"
            aria-label={expanded ? "折叠子节点" : "展开子节点"}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect({ node, hierarchy })}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        <Badge variant="outline" className="shrink-0 text-xs">
          {config.label}
        </Badge>
        {status ? (
          <Badge variant="secondary" className="shrink-0 text-xs">
            {status}
          </Badge>
        ) : null}
      </div>
      {expanded && hasChildren
        ? node.children.map((child) => (
            <ArtifactNode
              key={child.id}
              node={child}
              depth={depth + 1}
              ancestors={hierarchy}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

interface ArtifactTreeProps {
  nodes: ArtifactTreeNode[];
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
  initialSelectedArtifactId?: string;
}

export function ArtifactTree({
  nodes,
  workspaceId,
  workspaceSlug,
  projectId,
  projectSlug,
  initialSelectedArtifactId,
}: ArtifactTreeProps) {
  const [selected, setSelected] = useState<ArtifactSelection | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissedInitialSelection, setDismissedInitialSelection] = useState(false);

  const initialSelection = useMemo(() => {
    if (!initialSelectedArtifactId) {
      return null;
    }

    return findSelectionById(nodes, initialSelectedArtifactId);
  }, [initialSelectedArtifactId, nodes]);

  const activeSelection = selected ?? initialSelection;
  const effectiveSheetOpen = sheetOpen || (Boolean(initialSelection) && !selected && !dismissedInitialSelection);

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
        <TreePine className="h-10 w-10 text-muted-foreground/50" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            暂无工件
          </p>
          <p className="text-xs text-muted-foreground/70">
            请先扫描仓库以识别 BMAD 工件结构
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div id="artifact-tree" className="rounded-lg border p-2">
        <div className="mb-2 flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
          <span>点击工件查看详情并发起执行</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2"
            onClick={() => {
              if (activeSelection) {
                setSheetOpen(true);
              }
            }}
            disabled={!activeSelection}
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
            打开详情
          </Button>
        </div>
        {nodes.map((node) => (
          <ArtifactNode
            key={node.id}
            node={node}
            ancestors={[]}
            selectedId={activeSelection?.node.id}
            onSelect={(selection) => {
              setSelected(selection);
              setDismissedInitialSelection(false);
              setSheetOpen(true);
            }}
          />
        ))}
      </div>

      <ArtifactDetailSheet
        open={effectiveSheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open && !selected && initialSelection) {
            setDismissedInitialSelection(true);
          }
        }}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        projectSlug={projectSlug}
        selection={activeSelection}
      />
    </>
  );
}

function findSelectionById(
  nodes: ArtifactTreeNode[],
  targetId: string,
  ancestors: ArtifactSelection["hierarchy"] = [],
): ArtifactSelection | null {
  for (const node of nodes) {
    const hierarchy = [...ancestors, { id: node.id, type: node.type, name: node.name }];
    if (node.id === targetId) {
      return { node, hierarchy };
    }

    const childSelection = findSelectionById(node.children, targetId, hierarchy);
    if (childSelection) {
      return childSelection;
    }
  }

  return null;
}
