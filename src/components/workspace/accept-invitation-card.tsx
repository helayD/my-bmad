"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { acceptInvitationAction } from "@/actions/workspace-actions";

interface AcceptInvitationCardProps {
  token: string;
  workspaceName: string;
  invitedByName: string | null;
  role: string;
}

export function AcceptInvitationCard({ token, workspaceName, invitedByName, role }: AcceptInvitationCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitationAction({ token });
      if (result.success) {
        router.push(`/workspace/${result.data.workspaceSlug}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>工作空间邀请</CardTitle>
        <CardDescription>
          {invitedByName ? `${invitedByName} 邀请您加入` : "您被邀请加入"} <strong>{workspaceName}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">工作空间：</span>
          <span className="font-medium">{workspaceName}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">邀请角色：</span>
          <Badge variant="secondary">{role}</Badge>
        </div>
        {invitedByName && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">邀请人：</span>
            <span className="font-medium">{invitedByName}</span>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
      <CardFooter>
        <Button onClick={handleAccept} disabled={isPending} className="w-full">
          {isPending ? "处理中…" : "接受邀请"}
        </Button>
      </CardFooter>
    </Card>
  );
}
