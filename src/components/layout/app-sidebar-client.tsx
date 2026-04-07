"use client";

import dynamic from "next/dynamic";
import type { RepoConfig } from "@/lib/types";

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
}

export function AppSidebarClient(props: AppSidebarClientProps) {
  return <AppSidebarInner {...props} />;
}
