import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import {
  getWorkspaceMembers,
  getWorkspaceInvitations,
} from "@/lib/db/helpers";
import { guardWorkspacePage } from "@/lib/workspace/page-guard";
import { Button } from "@/components/ui/button";
import { MemberList } from "@/components/workspace/member-list";
import { InvitationList } from "@/components/workspace/invitation-list";
import { InviteMemberDialog } from "@/components/workspace/invite-member-dialog";

interface MembersPageProps {
  params: Promise<{ slug: string }>;
}

export default async function MembersPage({ params }: MembersPageProps) {
  const { slug } = await params;

  const { session, workspace, membership, isTeam, canManage } = await guardWorkspacePage(slug);
  if (!isTeam) notFound();

  const [members, invitations] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    canManage ? getWorkspaceInvitations(workspace.id) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">成员管理</h1>
          <p className="text-sm text-muted-foreground">
            {workspace.name} · {members.length} 名成员
          </p>
        </div>
        {canManage && (
          <InviteMemberDialog
            workspaceId={workspace.id}
            trigger={
              <Button>
                <Plus className="mr-1 h-4 w-4" />
                邀请成员
              </Button>
            }
          />
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">当前成员</h2>
        <MemberList
          members={members}
          workspaceId={workspace.id}
          currentUserId={session.userId}
          canManage={canManage}
          actorRole={membership.role}
        />
      </section>

      {canManage && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            待处理邀请
            {invitations.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({invitations.length})
              </span>
            )}
          </h2>
          <InvitationList invitations={invitations} workspaceId={workspace.id} />
        </section>
      )}
    </div>
  );
}
