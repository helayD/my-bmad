"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { scanProjectArtifactsAction } from "@/actions/artifact-actions";

interface ScanButtonProps {
  workspaceId: string;
  projectId: string;
}

export function ScanButton({ workspaceId, projectId }: ScanButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleScan() {
    startTransition(async () => {
      const result = await scanProjectArtifactsAction(workspaceId, projectId);
      if (result.success) {
        const { created, updated, deleted } = result.data;
        toast.success(
          `扫描完成：新增 ${created} 个，更新 ${updated} 个，移除 ${deleted} 个`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleScan}
      disabled={isPending}
      className="gap-1.5"
    >
      <ScanSearch className="h-4 w-4" />
      {isPending ? "扫描中..." : "扫描工件"}
    </Button>
  );
}
