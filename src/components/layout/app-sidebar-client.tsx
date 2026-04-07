"use client";

import dynamic from "next/dynamic";
import type { RepoConfig } from "@/lib/types";
import type { WorkspaceSummary } from "@/lib/workspace/types";

const AppSidebarInner = dynamic(
  () => import("@/components/layout/app-sidebar").then((m) => ({ default: m.AppSidebar })),
  { ssr: false }
);

interface AppSidebarClientProps {
  repos: RepoConfig[];
  userEmail?: string;
  localFsEnabled?: boolean;
  githubEnabled?: boolean;
  personalWorkspaceSlug?: string;
  workspaces?: WorkspaceSummary[];
}

export function AppSidebarClient(props: AppSidebarClientProps) {
  return <AppSidebarInner {...props} />;
}
