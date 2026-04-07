"use client";

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RemoveMemberDialog } from "@/components/workspace/remove-member-dialog";
import { ChangeRoleDialog } from "@/components/workspace/change-role-dialog";

interface Member {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface MemberListProps {
  members: Member[];
  workspaceId: string;
  currentUserId: string;
  canManage: boolean;
  actorRole: string;
}

export function MemberList({ members, workspaceId, currentUserId, canManage, actorRole }: MemberListProps) {
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  const [changingRoleMember, setChangingRoleMember] = useState<Member | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>用户</TableHead>
            <TableHead>邮箱</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>加入时间</TableHead>
            {canManage && <TableHead className="w-20">操作</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell className="font-medium">
                {member.user.name ?? member.user.email.split("@")[0]}
                {member.userId === currentUserId && (
                  <span className="ml-2 text-xs text-muted-foreground">(你)</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{member.user.email}</TableCell>
              <TableCell>
                <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>
                  {member.role}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {new Date(member.createdAt).toLocaleDateString("zh-CN")}
              </TableCell>
              {canManage && (
                <TableCell>
                  {member.userId !== currentUserId && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setChangingRoleMember(member)}
                      >
                        更改角色
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRemovingMember(member)}
                      >
                        移除
                      </Button>
                    </div>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {removingMember && (
        <RemoveMemberDialog
          open
          workspaceId={workspaceId}
          membershipId={removingMember.id}
          memberName={removingMember.user.name ?? removingMember.user.email}
          onClose={() => setRemovingMember(null)}
        />
      )}

      {changingRoleMember && (
        <ChangeRoleDialog
          open
          workspaceId={workspaceId}
          membershipId={changingRoleMember.id}
          memberName={changingRoleMember.user.name ?? changingRoleMember.user.email}
          currentRole={changingRoleMember.role}
          actorRole={actorRole}
          onClose={() => setChangingRoleMember(null)}
        />
      )}
    </>
  );
}
