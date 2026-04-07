"use client";

import { useState, useTransition } from "react";
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
import { createProjectAction } from "@/actions/workspace-actions";

interface CreateProjectDialogProps {
  workspaceId: string;
  trigger: React.ReactNode;
}

export function CreateProjectDialog({ workspaceId, trigger }: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmedName = name.trim();
  const charCount = trimmedName.length;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (charCount < 1 || charCount > 100) return;

    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const result = await createProjectAction({ workspaceId, name: trimmedName });
      if (result.success) {
        setOpen(false);
        setName("");
      } else {
        setError(result.error);
        setErrorCode(result.code ?? null);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setName(""); setError(null); setErrorCode(null); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建项目</DialogTitle>
          <DialogDescription>
            在此工作空间中创建一个新项目。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="project-name" className="text-sm font-medium">
              项目名称
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：my-awesome-project"
              maxLength={100}
              disabled={isPending}
              autoFocus
            />
            <div className="text-xs text-muted-foreground">{charCount}/100</div>
            {error && (
              <p className={`text-sm ${errorCode === "PROJECT_LIMIT_EXCEEDED" ? "text-destructive font-medium" : "text-destructive"}`}>
                {error}
              </p>
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
