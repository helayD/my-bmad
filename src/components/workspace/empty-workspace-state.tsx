import { FolderOpen, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EmptyWorkspaceStateProps {
  workspaceSlug: string;
}

export function EmptyWorkspaceState({ workspaceSlug }: EmptyWorkspaceStateProps) {
  void workspaceSlug;
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
        </div>

        <h3 className="mb-2 text-lg font-semibold">还没有项目</h3>

        <p className="mb-6 max-w-sm text-sm text-muted-foreground">
          你的工作空间目前还是空的。你可以导入 GitHub 仓库、关联本地项目文件夹，或者创建一个全新项目来开始使用 BMAD 工作流。
        </p>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button disabled className="gap-2">
                  <Plus className="h-4 w-4" />
                  创建新项目
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>即将推出</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
