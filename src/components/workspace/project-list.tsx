import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";
import type { ProjectListItem } from "@/lib/workspace/types";

interface ProjectListProps {
  projects: ProjectListItem[];
  workspaceSlug: string;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  archived: "secondary",
  draft: "outline",
};

export function ProjectList({ projects, workspaceSlug }: ProjectListProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <Link
          key={project.id}
          href={`/workspace/${workspaceSlug}/project/${project.slug}`}
          className="group"
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
      ))}
    </div>
  );
}
