"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createTeamWorkspaceAction } from "@/actions/workspace-actions";

interface CreateTeamWorkspaceDialogProps {
  trigger: React.ReactNode;
}

export function CreateTeamWorkspaceDialog({ trigger }: CreateTeamWorkspaceDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmedName = name.trim();
  const charCount = trimmedName.length;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (charCount < 1 || charCount > 100) return;

    setError(null);
    startTransition(async () => {
      const result = await createTeamWorkspaceAction({ name: trimmedName });
      if (result.success) {
        setOpen(false);
        setName("");
        router.push(`/workspace/${result.data.workspace.slug}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setName(""); setError(null); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建团队工作空间</DialogTitle>
          <DialogDescription>
            团队工作空间可以让多个成员协作管理项目。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="team-name" className="text-sm font-medium">
              团队名称
            </label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：前端团队"
              maxLength={100}
              disabled={isPending}
              autoFocus
            />
            <div className="text-xs text-muted-foreground">
              {charCount}/100
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={isPending || charCount < 1}>
              {isPending ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
