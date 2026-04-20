import {
  createProjectContentProvider,
  toProjectRepoProviderConfig,
  ProjectProviderError,
} from "@/lib/content-provider/project-provider";
import type { ProjectRepoProviderConfig } from "@/lib/content-provider/project-provider";

export class ExecutionPreconditionError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ExecutionPreconditionError";
  }
}

export interface ProjectExecutionRoot {
  projectId: string;
  repoId: string;
  /** Absolute, validated local path. Always a real directory on the filesystem. */
  absolutePath: string;
  provider: ProjectRepoProviderConfig;
}

/**
 * Resolve the validated local execution root for a project.
 *
 * Rules (story 4.4 §2.2–2.3):
 * - Only projects with sourceType === "local" can execute.
 * - The localPath must pass ContentProvider validation (path safety checks).
 * - Falls back to null when the project has no local repo or the path is invalid.
 *
 * This function does NOT throw for missing repos — it returns null so callers
 * can surface a user-friendly error message instead of leaking stderr.
 */
export async function resolveProjectExecutionRoot(
  project: { id: string; repo: { id: string; sourceType: string; localPath: string | null } | null },
): Promise<ProjectExecutionRoot | null> {
  const repo = project.repo;

  if (!repo) {
    return null;
  }

  if (repo.sourceType !== "local") {
    // Currently self-hosted execution only supports local repos.
    return null;
  }

  if (!repo.localPath) {
    return null;
  }

  try {
    const providerConfig = toProjectRepoProviderConfig({
      id: repo.id,
      owner: "",
      name: "",
      branch: "",
      displayName: "",
      description: null,
      sourceType: repo.sourceType,
      localPath: repo.localPath,
      lastSyncedAt: null,
    });

    const provider = await createProjectContentProvider(providerConfig, "");
    await provider.validateRoot();

    return {
      projectId: project.id,
      repoId: repo.id,
      absolutePath: repo.localPath,
      provider: providerConfig,
    };
  } catch (error) {
    if (error instanceof ProjectProviderError) {
      // Token missing, validation failed — path is not usable.
      return null;
    }

    // Unexpected error — treat as not usable.
    return null;
  }
}
