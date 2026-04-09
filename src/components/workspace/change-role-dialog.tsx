"use client";

import { useTransition, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { updateMemberRoleAction } from "@/actions/workspace-actions";
import { toast } from "sonner";

const ALL_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER", "AUDITOR"] as const;
const NON_OWNER_ROLES = ["ADMIN", "MEMBER", "VIEWER", "AUDITOR"] as const;

interface ChangeRoleDialogProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  membershipId: string;
  memberName: string;
  currentRole: string;
  actorRole: string;
}

export function ChangeRoleDialog({
  open,
  onClose,
  workspaceId,
  membershipId,
  memberName,
  currentRole,
  actorRole,
}: ChangeRoleDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState(currentRole);

  const availableRoles = actorRole === "OWNER" ? ALL_ROLES : NON_OWNER_ROLES;

  function resetForm() {
    setSelectedRole(currentRole);
    setError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      resetForm();
      return;
    }

    onClose();
  }

  function handleSubmit() {
    if (selectedRole === currentRole) {
      onClose();
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateMemberRoleAction({
        workspaceId,
        membershipId,
        role: selectedRole as (typeof ALL_ROLES)[number],
      });
      if (result.success) {
        toast.success("角色已更新");
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>更改角色</DialogTitle>
          <DialogDescription>
            为 <strong>{memberName}</strong> 选择新角色
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger>
              <SelectValue placeholder="选择角色" />
            </SelectTrigger>
            <SelectContent>
              {availableRoles.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "更新中…" : "确认更改"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
