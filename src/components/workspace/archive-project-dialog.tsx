"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { archiveProjectAction } from "@/actions/workspace-actions";

interface ArchiveProjectDialogProps {
  projectId: string;
  projectName: string;
  workspaceId: string;
  trigger: React.ReactNode;
}

export function ArchiveProjectDialog({
  projectId,
  projectName,
  workspaceId,
  trigger,
}: ArchiveProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      const result = await archiveProjectAction({ projectId, workspaceId });
      if (result.success) {
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认归档项目</AlertDialogTitle>
          <AlertDialogDescription>
            你确定要归档项目 <strong>{projectName}</strong> 吗？归档后项目将不再计入活跃项目配额，但不会被删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleArchive}
            disabled={isPending}
          >
            {isPending ? "归档中…" : "确认归档"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
