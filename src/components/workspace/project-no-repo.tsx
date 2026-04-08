import Link from "next/link";
import { FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProjectNoRepo() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border p-8 text-center">
      <FolderSearch className="h-10 w-10 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">此项目尚未关联仓库</p>
        <p className="text-sm text-muted-foreground">
          关联仓库后可查看 BMAD 工件。
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/">前往仪表盘导入仓库</Link>
      </Button>
    </div>
  );
}
