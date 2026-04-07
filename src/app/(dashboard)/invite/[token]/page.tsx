import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcceptInvitationCard } from "@/components/workspace/accept-invitation-card";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    include: {
      workspace: { select: { name: true, slug: true } },
      invitedBy: { select: { name: true } },
    },
  });

  if (!invitation) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>邀请链接无效</CardTitle>
            <CardDescription>此邀请链接不存在或已被使用。</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              请联系工作空间管理员重新发送邀请链接。
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/">返回首页</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const now = new Date();
  const isExpired = invitation.status === "EXPIRED" || invitation.expiresAt < now;
  const isInvalid = invitation.status !== "PENDING" && !isExpired;

  if (isExpired) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>邀请已过期</CardTitle>
            <CardDescription>此邀请链接已过期，无法使用。</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              邀请链接有效期为 7 天。请联系 <strong>{invitation.workspace.name}</strong> 的管理员重新发送邀请。
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/">返回首页</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (isInvalid) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>邀请链接已失效</CardTitle>
            <CardDescription>此邀请链接已被使用或已被撤销。</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              请联系工作空间管理员重新发送邀请链接。
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/">返回首页</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <AcceptInvitationCard
        token={token}
        workspaceName={invitation.workspace.name}
        invitedByName={invitation.invitedBy.name}
        role={invitation.role}
      />
    </div>
  );
}
