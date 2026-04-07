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
import { revokeInvitationAction } from "@/actions/workspace-actions";

interface RevokeInvitationDialogProps {
  open: boolean;
  workspaceId: string;
  invitationId: string;
  inviteeEmail: string;
  onClose: () => void;
}

export function RevokeInvitationDialog({
  open,
  workspaceId,
  invitationId,
  inviteeEmail,
  onClose,
}: RevokeInvitationDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await revokeInvitationAction({ workspaceId, invitationId });
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
          <AlertDialogTitle>撤销邀请</AlertDialogTitle>
          <AlertDialogDescription>
            确定要撤销发送给 <strong>{inviteeEmail}</strong> 的邀请吗？
            撤销后该邀请链接将立即失效。
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
            {isPending ? "撤销中…" : "确认撤销"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
