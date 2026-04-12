import fs from "node:fs/promises";
import path from "node:path";
import { fileTag, repoTag } from "@/lib/github/cache-tags";
import {
  createUserOctokit,
  getGitHubToken,
  type UserOctokit,
} from "@/lib/github/client";
import { LocalProvider } from "@/lib/content-provider/local-provider";
import {
  assertAllowedPlanningArtifactPath,
  assertNoSymlinkSegments,
  resolveSafePathWithinRoot,
} from "@/lib/content-provider/path-safety";
import type { ProjectRepoProviderConfig } from "@/lib/content-provider/project-provider";

export interface PlanningArtifactReadResult {
  exists: boolean;
  content: string | null;
  sha: string | null;
}

export interface PlanningArtifactWriteInput {
  path: string;
  content: string;
  summary: string;
  commitMessage?: string;
}

export interface PlanningArtifactWriteResult {
  path: string;
  mode: "create" | "update";
  commitSha: string | null;
  summary: string;
  cacheTags: string[];
}

export interface PlanningArtifactWriter {
  readArtifact(filePath: string): Promise<PlanningArtifactReadResult>;
  writeArtifact(input: PlanningArtifactWriteInput): Promise<PlanningArtifactWriteResult>;
}

export class PlanningArtifactWriteError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "PlanningArtifactWriteError";
    this.code = code;
  }
}

class LocalPlanningArtifactWriter implements PlanningArtifactWriter {
  private projectRootPromise: Promise<string> | null = null;

  constructor(private readonly repo: ProjectRepoProviderConfig) {}

  private async getProjectRoot(): Promise<string> {
    const localPath = this.repo.localPath;
    if (!localPath) {
      throw new PlanningArtifactWriteError("PLANNING_REPO_REQUIRED");
    }

    if (!this.projectRootPromise) {
      this.projectRootPromise = (async () => {
        const provider = new LocalProvider(localPath);
        await provider.validateRoot();
        return provider.getProjectRoot();
      })();
    }

    return this.projectRootPromise;
  }

  async readArtifact(filePath: string): Promise<PlanningArtifactReadResult> {
    assertAllowedPlanningArtifactPath(filePath);

    const projectRoot = await this.getProjectRoot();
    const fullPath = resolveSafePathWithinRoot(projectRoot, filePath);
    await assertNoSymlinkSegments(projectRoot, fullPath);

    try {
      const stat = await fs.lstat(fullPath);
      if (stat.isSymbolicLink()) {
        throw new PlanningArtifactWriteError("PLANNING_ARTIFACT_WRITE_ERROR");
      }

      return {
        exists: true,
        content: await fs.readFile(fullPath, "utf-8"),
        sha: null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false, content: null, sha: null };
      }

      if (error instanceof PlanningArtifactWriteError) {
        throw error;
      }

      throw new PlanningArtifactWriteError("PLANNING_ARTIFACT_WRITE_ERROR");
    }
  }

  async writeArtifact(input: PlanningArtifactWriteInput): Promise<PlanningArtifactWriteResult> {
    assertAllowedPlanningArtifactPath(input.path);

    const projectRoot = await this.getProjectRoot();
    const fullPath = resolveSafePathWithinRoot(projectRoot, input.path);
    const parentDir = path.dirname(fullPath);
    await assertNoSymlinkSegments(projectRoot, parentDir);

    const existing = await this.readArtifact(input.path);

    try {
      await fs.mkdir(parentDir, { recursive: true });
      await fs.writeFile(fullPath, input.content, "utf-8");

      return {
        path: input.path,
        mode: existing.exists ? "update" : "create",
        commitSha: null,
        summary: input.summary,
        cacheTags: [],
      };
    } catch {
      throw new PlanningArtifactWriteError("PLANNING_ARTIFACT_WRITE_ERROR");
    }
  }
}

class GitHubPlanningArtifactWriter implements PlanningArtifactWriter {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly octokit: UserOctokit,
    private readonly repo: ProjectRepoProviderConfig,
  ) {}

  async readArtifact(filePath: string): Promise<PlanningArtifactReadResult> {
    assertAllowedPlanningArtifactPath(filePath);

    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.repo.owner,
        repo: this.repo.name,
        path: filePath,
        ref: this.repo.branch,
      });

      if (Array.isArray(data) || data.type !== "file") {
        throw new PlanningArtifactWriteError("PLANNING_ARTIFACT_WRITE_ERROR");
      }

      return {
        exists: true,
        content:
          data.encoding === "base64" && data.content
            ? Buffer.from(data.content, "base64").toString("utf-8")
            : (data.content ?? ""),
        sha: data.sha ?? null,
      };
    } catch (error) {
      if (isGitHubNotFoundError(error)) {
        return { exists: false, content: null, sha: null };
      }

      if (error instanceof PlanningArtifactWriteError) {
        throw error;
      }

      throw new PlanningArtifactWriteError("PLANNING_ARTIFACT_WRITE_ERROR");
    }
  }

  async writeArtifact(input: PlanningArtifactWriteInput): Promise<PlanningArtifactWriteResult> {
    return this.enqueue(async () => {
      const existing = await this.readArtifact(input.path);

      try {
        const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
          owner: this.repo.owner,
          repo: this.repo.name,
          path: input.path,
          branch: this.repo.branch,
          message:
            input.commitMessage
            ?? `chore(planning): ${existing.exists ? "update" : "create"} ${path.basename(input.path)}`,
          content: Buffer.from(input.content, "utf-8").toString("base64"),
          sha: existing.sha ?? undefined,
        });

        return {
          path: input.path,
          mode: existing.exists ? "update" : "create",
          commitSha: data.commit.sha ?? null,
          summary: input.summary,
          cacheTags: [
            repoTag(this.repo.owner, this.repo.name),
            fileTag(this.repo.owner, this.repo.name, input.path),
          ],
        };
      } catch {
        throw new PlanningArtifactWriteError("PLANNING_ARTIFACT_WRITE_ERROR");
      }
    });
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function isGitHubNotFoundError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 404;
}

export async function createPlanningArtifactWriter(
  repo: ProjectRepoProviderConfig,
  userId: string,
): Promise<PlanningArtifactWriter> {
  if (repo.sourceType === "local") {
    return new LocalPlanningArtifactWriter(repo);
  }

  const token = await getGitHubToken(userId);
  if (!token) {
    throw new PlanningArtifactWriteError("TOKEN_MISSING");
  }

  const octokit = createUserOctokit(token);
  return new GitHubPlanningArtifactWriter(octokit, repo);
}
