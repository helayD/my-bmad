"use client";

import { useTransition, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { removeMemberAction } from "@/actions/workspace-actions";

interface RemoveMemberDialogProps {
  open: boolean;
  workspaceId: string;
  membershipId: string;
  memberName: string;
  onClose: () => void;
}

export function RemoveMemberDialog({
  open,
  workspaceId,
  membershipId,
  memberName,
  onClose,
}: RemoveMemberDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction({ workspaceId, membershipId });
      if (result.success) {
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除成员</AlertDialogTitle>
          <AlertDialogDescription>
            确定要将 <strong>{memberName}</strong> 从工作空间移除吗？
            移除后该成员将立即失去对此工作空间所有资源的访问权限。
            此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? "移除中…" : "确认移除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
