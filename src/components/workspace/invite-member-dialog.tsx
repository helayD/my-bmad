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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteToWorkspaceAction } from "@/actions/workspace-actions";

interface InviteMemberDialogProps {
  workspaceId: string;
  trigger: React.ReactNode;
}

export function InviteMemberDialog({ workspaceId, trigger }: InviteMemberDialogProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setEmail("");
    setRole("MEMBER");
    setError(null);
    setInviteLink(null);
    setCopied(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await inviteToWorkspaceAction({ workspaceId, email: email.trim(), role });
      if (result.success) {
        const link = `${window.location.origin}/invite/${result.data.invitation.token}`;
        setInviteLink(link);
      } else {
        setError(result.error);
      }
    });
  }

  function handleCopy() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>邀请成员</DialogTitle>
          <DialogDescription>
            输入被邀请人的邮箱地址，系统将生成一个邀请链接。
          </DialogDescription>
        </DialogHeader>

        {inviteLink ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">邀请链接已生成，请将以下链接发送给被邀请人（有效期 7 天）：</p>
            <div className="flex items-center gap-2">
              <Input value={inviteLink} readOnly className="text-xs" />
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => { reset(); }}>再次邀请</Button>
              <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>关闭</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="invite-email" className="text-sm font-medium">邮箱地址</label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                disabled={isPending}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="invite-role" className="text-sm font-medium">角色</label>
              <Select value={role} onValueChange={setRole} disabled={isPending}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">MEMBER</SelectItem>
                  <SelectItem value="ADMIN">ADMIN</SelectItem>
                  <SelectItem value="VIEWER">VIEWER</SelectItem>
                  <SelectItem value="AUDITOR">AUDITOR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                取消
              </Button>
              <Button type="submit" disabled={isPending || !email.trim()}>
                {isPending ? "发送中…" : "发送邀请"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
