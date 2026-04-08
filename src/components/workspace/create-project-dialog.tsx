"use client";

import { useState, useEffect, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createProjectAction } from "@/actions/workspace-actions";
import { getUserReposAction } from "@/actions/repo-actions";

interface RepoOption {
  id: string;
  displayName: string;
  sourceType: string;
}

interface CreateProjectDialogProps {
  workspaceId: string;
  workspaceSlug: string;
  trigger: React.ReactNode;
}

export function CreateProjectDialog({ workspaceId, workspaceSlug, trigger }: CreateProjectDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmedName = name.trim();
  const charCount = trimmedName.length;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadRepos = async () => {
      const result = await getUserReposAction();
      if (cancelled) return;
      if (result.success) {
        setRepos(
          result.data.map((r) => ({
            id: r.id,
            displayName: r.displayName,
            sourceType: r.sourceType,
          }))
        );
      }
    };
    startTransition(() => {
      loadRepos();
    });
    return () => { cancelled = true; };
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (charCount < 1 || charCount > 100) return;

    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const repoId = selectedRepoId && selectedRepoId !== "none" ? selectedRepoId : undefined;
      const result = await createProjectAction({ workspaceId, name: trimmedName, repoId });
      if (result.success) {
        setOpen(false);
        resetForm();
        router.push(`/workspace/${workspaceSlug}/project/${result.data.project.slug}`);
      } else {
        setError(result.error);
        setErrorCode(result.code ?? null);
      }
    });
  }

  function resetForm() {
    setName("");
    setSelectedRepoId("");
    setRepos(null);
    setError(null);
    setErrorCode(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
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
          </div>

          <div className="space-y-2">
            <label htmlFor="repo-select" className="text-sm font-medium">
              关联仓库 <span className="text-muted-foreground font-normal">（可选）</span>
            </label>
            {repos === null ? (
              <p className="text-sm text-muted-foreground">加载仓库列表…</p>
            ) : repos.length > 0 ? (
              <Select
                value={selectedRepoId}
                onValueChange={setSelectedRepoId}
                disabled={isPending}
              >
                <SelectTrigger id="repo-select">
                  <SelectValue placeholder="不关联仓库" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联仓库</SelectItem>
                  {repos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id}>
                      <span className="flex items-center gap-2">
                        {repo.displayName}
                        <Badge variant="outline" className="text-xs">
                          {repo.sourceType}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                请先在仪表盘导入仓库
              </p>
            )}
          </div>

          {error && (
            <p className={`text-sm ${errorCode === "PROJECT_LIMIT_EXCEEDED" ? "text-destructive font-medium" : "text-destructive"}`}>
              {error}
            </p>
          )}

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
