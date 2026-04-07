"use client";

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RevokeInvitationDialog } from "@/components/workspace/revoke-invitation-dialog";

interface Invitation {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
  invitedBy: {
    id: string;
    name: string | null;
  };
}

interface InvitationListProps {
  invitations: Invitation[];
  workspaceId: string;
}

export function InvitationList({ invitations, workspaceId }: InvitationListProps) {
  const [revokingInvitation, setRevokingInvitation] = useState<Invitation | null>(null);

  if (invitations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">暂无待处理邀请</p>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>邮箱</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>邀请人</TableHead>
            <TableHead>邀请时间</TableHead>
            <TableHead>过期时间</TableHead>
            <TableHead className="w-20">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="font-medium">{inv.email}</TableCell>
              <TableCell>
                <Badge variant="secondary">{inv.role}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {inv.invitedBy.name ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {new Date(inv.createdAt).toLocaleDateString("zh-CN")}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {new Date(inv.expiresAt).toLocaleDateString("zh-CN")}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setRevokingInvitation(inv)}
                >
                  撤销
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {revokingInvitation && (
        <RevokeInvitationDialog
          open
          workspaceId={workspaceId}
          invitationId={revokingInvitation.id}
          inviteeEmail={revokingInvitation.email}
          onClose={() => setRevokingInvitation(null)}
        />
      )}
    </>
  );
}
