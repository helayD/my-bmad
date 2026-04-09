import { createContentProvider } from "@/lib/content-provider";
import { createUserOctokit, getGitHubToken } from "@/lib/github/client";
import type { ContentProvider } from "@/lib/content-provider";
import type { RepoConfig } from "@/lib/types";

interface ProjectRepoRecord {
  id: string;
  owner: string;
  name: string;
  branch: string;
  displayName: string;
  description: string | null;
  sourceType: string;
  localPath: string | null;
  lastSyncedAt: Date | null;
}

export interface ProjectRepoProviderConfig extends RepoConfig {
  id: string;
}

export class ProjectProviderError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ProjectProviderError";
  }
}

export function toProjectRepoProviderConfig(
  repo: ProjectRepoRecord,
): ProjectRepoProviderConfig {
  return {
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    branch: repo.branch,
    displayName: repo.displayName,
    description: repo.description,
    sourceType: repo.sourceType === "local" ? "local" : "github",
    localPath: repo.localPath,
    lastSyncedAt: repo.lastSyncedAt,
  };
}

export async function createProjectContentProvider(
  repo: ProjectRepoProviderConfig,
  userId: string,
): Promise<ContentProvider> {
  if (repo.sourceType === "local") {
    const provider = createContentProvider(repo);
    await provider.validateRoot();
    return provider;
  }

  const token = await getGitHubToken(userId);
  if (!token) {
    throw new ProjectProviderError("TOKEN_MISSING");
  }

  const octokit = createUserOctokit(token);
  return createContentProvider(repo, octokit, userId);
}
