import { notFound } from "next/navigation";
import { guardWorkspacePage } from "@/lib/workspace/page-guard";
import { getGovernanceSettings } from "@/lib/workspace/update-workspace-settings";
import { GovernanceSettingsForm } from "@/components/workspace/governance-settings-form";

export const dynamic = "force-dynamic";

interface SettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { slug } = await params;

  const { workspace, isTeam, canManage } = await guardWorkspacePage(slug);
  if (!isTeam) notFound();
  if (!canManage) notFound();

  const defaultValues = await getGovernanceSettings(workspace.id);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">治理策略配置</h1>
        <p className="text-sm text-muted-foreground">
          {workspace.name} · 管理团队执行策略与控制规则
        </p>
      </div>

      <GovernanceSettingsForm
        workspaceId={workspace.id}
        defaultValues={defaultValues}
      />
    </div>
  );
}
