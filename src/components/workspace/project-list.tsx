import Link from "next/link";
import { Archive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import type { ProjectListItem } from "@/lib/workspace/types";
import { ArchiveProjectDialog } from "@/components/workspace/archive-project-dialog";

interface ProjectListProps {
  projects: ProjectListItem[];
  workspaceSlug: string;
  workspaceId?: string;
  canManage?: boolean;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  archived: "secondary",
  draft: "outline",
};

export function ProjectList({ projects, workspaceSlug, workspaceId, canManage }: ProjectListProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <div key={project.id} className="group relative">
          <Link
            href={`/workspace/${workspaceSlug}/project/${project.slug}`}
            className="block"
          >
            <Card className="transition-colors hover:border-primary/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold group-hover:text-primary">
                  {project.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant={statusVariant[project.status] ?? "outline"}>
                  {project.status}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(project.updatedAt)}
                </p>
              </CardContent>
            </Card>
          </Link>
          {canManage && workspaceId && project.status === "active" && (
            <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
              <ArchiveProjectDialog
                projectId={project.id}
                projectName={project.name}
                workspaceId={workspaceId}
                trigger={
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="sr-only">归档</span>
                  </Button>
                }
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
