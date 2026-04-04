"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { repoTag } from "@/lib/github/cache-tags";
import {
  createUserOctokit,
  getGitHubToken,
  getCachedUserRepoTree,
  getCachedUserRawContent,
} from "@/lib/github/client";
import { LocalProvider } from "@/lib/content-provider/local-provider";
import {
  BMAD_CORE_DIR,
  BMAD_IMPLEMENTATION_DIR,
  BMAD_OUTPUT_DIR,
  BMAD_PLANNING_DIR,
  buildFileTree,
  detectBmadOutputDir,
} from "@/lib/bmad/utils";
import { parseBmadFile } from "@/lib/bmad/parser";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession } from "@/lib/db/helpers";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { z } from "zod";
import { createHash } from "node:crypto";
import path from "node:path";
import type { GitHubRepo } from "@/lib/github/types";
import type { FileTreeNode, ParsedBmadFile } from "@/lib/bmad/types";
import type { ActionResult } from "@/lib/types";
import { sanitizeError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";

// GraphQL can handle ~30 repos per query safely (GitHub complexity limits)
const GRAPHQL_BATCH_SIZE = 30;

function getLocalBmadFiles(allPaths: string[]) {
  const outputDir = detectBmadOutputDir(allPaths);
  const bmadFiles = allPaths.filter((p) => p.startsWith(outputDir + "/"));
  return { outputDir, bmadFiles };
}

function hasLocalBmadStructure(rootDirectories: string[], allPaths: string[]): boolean {
  if (rootDirectories.includes(BMAD_CORE_DIR) || rootDirectories.includes(BMAD_OUTPUT_DIR)) {
    return true;
  }

  return rootDirectories.some(
    (dirName) =>
      allPaths.some((p) => p.startsWith(`${dirName}/${BMAD_PLANNING_DIR}/`)) ||
      allPaths.some((p) => p.startsWith(`${dirName}/${BMAD_IMPLEMENTATION_DIR}/`))
  );
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Validate session and retrieve an authenticated Octokit instance.
 * For GitHub-only actions.
 */
async function getAuthenticatedOctokit(): Promise<
  ActionResult<{ octokit: ReturnType<typeof createUserOctokit>; userId: string }>
> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const token = await getGitHubToken(session.userId);
  if (!token) {
    return {
      success: false,
      error: "GitHub OAuth token not found. Please reconnect.",
      code: "TOKEN_MISSING",
    };
  }

  return {
    success: true,
    data: { octokit: createUserOctokit(token), userId: session.userId },
  };
}

/**
 * Get authenticated user ID only (no GitHub token required).
 * For actions that work with both GitHub and local repos.
 */
async function requireAuthenticated(): Promise<ActionResult<{ userId: string }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }
  return { success: true, data: { userId: session.userId } };
}

// ---------------------------------------------------------------------------
// GitHub-only actions
// ---------------------------------------------------------------------------

/**
 * Phase 1: List repos (fast — no BMAD detection).
 */
export async function listUserRepos(): Promise<ActionResult<GitHubRepo[]>> {
  const authResult = await getAuthenticatedOctokit();
  if (!authResult.success) return authResult;

  const { octokit, userId } = authResult.data;

  if (!checkRateLimit(`list:${userId}`, 30, 60000)) {
    return { success: false, error: "Trop de requêtes", code: "RATE_LIMIT" };
  }

  try {
    const repos = await octokit.paginate(
      octokit.rest.repos.listForAuthenticatedUser,
      { per_page: 100, sort: "updated" }
    );

    const mapped: GitHubRepo[] = repos.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      description: r.description ?? null,
      isPrivate: r.private,
      updatedAt: r.updated_at ?? "",
      defaultBranch: r.default_branch ?? "main",
      hasBmad: false,
    }));

    return { success: true, data: mapped };
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 403
    ) {
      return {
        success: false,
        error: "GitHub rate limit reached. Try again in a few minutes.",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: sanitizeError(error, "GITHUB_ERROR"), code: "GITHUB_ERROR" };
  }
}

/**
 * Phase 2: Detect BMAD via GraphQL (batch — ~30 repos per query).
 */
export async function detectBmadRepos(
  repoIds: { fullName: string; owner: string; name: string }[]
): Promise<ActionResult<Record<string, boolean>>> {
  const authResult = await getAuthenticatedOctokit();
  if (!authResult.success) return authResult;

  const { octokit } = authResult.data;
  const results: Record<string, boolean> = {};

  for (let i = 0; i < repoIds.length; i += GRAPHQL_BATCH_SIZE) {
    const chunk = repoIds.slice(i, i + GRAPHQL_BATCH_SIZE);

    const variables: Record<string, string> = {};
    const repoFragments = chunk.map((repo, idx) => {
      const alias = `repo_${idx}`;
      const ownerVar = `$owner_${idx}`;
      const nameVar = `$name_${idx}`;
      variables[`owner_${idx}`] = repo.owner;
      variables[`name_${idx}`] = repo.name;
      return `${alias}: repository(owner: ${ownerVar}, name: ${nameVar}) {
      bmad: object(expression: "HEAD:_bmad") { __typename }
      bmadOutput: object(expression: "HEAD:_bmad-output") { __typename }
    }`;
    });

    const variableDeclarations = chunk
      .map((_, idx) => `$owner_${idx}: String!, $name_${idx}: String!`)
      .join(", ");

    const query = `query BmadDetect(${variableDeclarations}) { ${repoFragments.join("\n")} }`;

    try {
      const response: Record<
        string,
        { bmad: { __typename: string } | null; bmadOutput: { __typename: string } | null } | null
      > = await octokit.graphql(query, variables);

      chunk.forEach((repo, idx) => {
        const data = response[`repo_${idx}`];
        results[repo.fullName] = !!(data?.bmad || data?.bmadOutput);
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[detectBmadRepos] GraphQL batch ${i / GRAPHQL_BATCH_SIZE + 1} failed: ${msg}`
      );
      for (const repo of chunk) {
        results[repo.fullName] = false;
      }
    }
  }

  return { success: true, data: results };
}

const importRepoSchema = z.object({
  owner: z.string().min(1).max(255).trim(),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(1000).nullable(),
  defaultBranch: z.string().min(1).max(255).trim(),
  fullName: z.string().min(1).max(512).trim(),
});

/**
 * Import a GitHub BMAD repo into the user's dashboard.
 */
export async function importRepo(input: {
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  fullName: string;
}): Promise<
  ActionResult<{ id: string; owner: string; name: string; displayName: string }>
> {
  const parsed = importRepoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid data: " + parsed.error.issues[0].message,
      code: "VALIDATION_ERROR",
    };
  }
  const data = parsed.data;

  const authResult = await getAuthenticatedOctokit();
  if (!authResult.success) return authResult;

  const { userId } = authResult.data;

  if (!checkRateLimit(`import:${userId}`, 10, 60000)) {
    return { success: false, error: "Trop de requêtes", code: "RATE_LIMIT" };
  }

  try {
    const repo = await prisma.repo.create({
      data: {
        owner: data.owner,
        name: data.name,
        branch: data.defaultBranch,
        displayName: data.name,
        description: data.description,
        sourceType: "github",
        lastSyncedAt: new Date(),
        userId,
      },
      select: { id: true, owner: true, name: true, displayName: true },
    });

    revalidatePath("/(dashboard)");
    return { success: true, data: repo };
  } catch (error: unknown) {
    if (
      error instanceof PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: "This repository is already imported.",
        code: "DUPLICATE",
      };
    }
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}

// ---------------------------------------------------------------------------
// Source-type-aware actions (GitHub + Local)
// ---------------------------------------------------------------------------

const deleteRepoSchema = z.object({
  owner: z.string().min(1).max(255).trim(),
  name: z.string().min(1).max(255).trim(),
});

/**
 * Delete an imported repo from the user's dashboard (GitHub or local).
 */
export async function deleteRepo(input: {
  owner: string;
  name: string;
}): Promise<ActionResult<{ deleted: boolean }>> {
  const parsed = deleteRepoSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid data", code: "VALIDATION_ERROR" };
  }

  // F15: Use session auth (no GitHub token required)
  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  try {
    // F5: Always scope by userId
    const deleted = await prisma.repo.deleteMany({
      where: { userId, owner: parsed.data.owner, name: parsed.data.name },
    });

    if (deleted.count === 0) {
      return { success: false, error: "Repo not found", code: "NOT_FOUND" };
    }

    revalidatePath("/(dashboard)");
    return { success: true, data: { deleted: true } };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}

const refreshRepoSchema = z.object({
  owner: z.string().min(1).max(255).trim(),
  name: z.string().min(1).max(255).trim(),
});

/**
 * Refresh repo data: re-fetch tree, count BMAD files, update lastSyncedAt.
 * Routes by sourceType for GitHub vs Local repos.
 */
export async function refreshRepoData(input: {
  owner: string;
  name: string;
}): Promise<ActionResult<{ totalFiles: number; lastSyncedAt: string }>> {
  const parsed = refreshRepoSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid data", code: "VALIDATION_ERROR" };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  try {
    // F5: Always scope by userId
    const repoConfig = await prisma.repo.findFirst({
      where: { userId, owner: parsed.data.owner, name: parsed.data.name },
      select: { id: true, branch: true, sourceType: true, localPath: true },
    });

    if (!repoConfig) {
      return { success: false, error: "Project not found", code: "NOT_FOUND" };
    }

    if (repoConfig.sourceType === "local") {
      return refreshLocalRepo(repoConfig);
    }

    return refreshGitHubRepo(parsed.data, repoConfig, userId);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 403
    ) {
      return {
        success: false,
        error: "GitHub rate limit reached. Cached data is displayed.",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: sanitizeError(error, "GITHUB_ERROR"), code: "GITHUB_ERROR" };
  }
}

async function refreshLocalRepo(
  repoConfig: { id: string; localPath: string | null },
): Promise<ActionResult<{ totalFiles: number; lastSyncedAt: string }>> {
  if (!repoConfig.localPath) {
    return { success: false, error: sanitizeError(null, "FS_ERROR"), code: "FS_ERROR" };
  }

  try {
    const provider = new LocalProvider(repoConfig.localPath);
    await provider.validateRoot();

    const tree = await provider.getTree();
    const { bmadFiles } = getLocalBmadFiles(tree.paths);
    const totalFiles = bmadFiles.length;

    const now = new Date();
    await prisma.repo.update({
      where: { id: repoConfig.id },
      data: { lastSyncedAt: now, totalFiles },
    });

    // F8: Revalidate dashboard RSC
    revalidatePath("/(dashboard)");
    // F37: No revalidateTag for local repos (no unstable_cache)

    return { success: true, data: { totalFiles, lastSyncedAt: now.toISOString() } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "PATH_NOT_FOUND" || msg === "LOCAL_DISABLED") {
      return { success: false, error: sanitizeError(error, "PATH_STALE"), code: "PATH_STALE" };
    }
    return { success: false, error: sanitizeError(error, "FS_ERROR"), code: "FS_ERROR" };
  }
}

async function refreshGitHubRepo(
  input: { owner: string; name: string },
  repoConfig: { id: string; branch: string },
  userId: string,
): Promise<ActionResult<{ totalFiles: number; lastSyncedAt: string }>> {
  const token = await getGitHubToken(userId);
  if (!token) {
    return { success: false, error: "GitHub OAuth token not found.", code: "TOKEN_MISSING" };
  }
  const octokit = createUserOctokit(token);

  revalidateTag(repoTag(input.owner, input.name), "default");

  // Use the branch already configured for this repo — don't override it
  const syncBranch = repoConfig.branch;

  const { data: tree } = await octokit.rest.git.getTree({
    owner: input.owner,
    repo: input.name,
    tree_sha: syncBranch,
    recursive: "1",
  });

  const allPaths = tree.tree
    .filter((item): item is typeof item & { path: string } => item.type === "blob" && !!item.path)
    .map((item) => item.path);
  const { bmadFiles } = getLocalBmadFiles(allPaths);
  const totalFiles = bmadFiles.length;

  const now = new Date();
  await prisma.repo.update({
    where: { id: repoConfig.id },
    data: { lastSyncedAt: now, totalFiles },
  });

  return { success: true, data: { totalFiles, lastSyncedAt: now.toISOString() } };
}

// ---------------------------------------------------------------------------
// BMAD file browsing Server Actions
// ---------------------------------------------------------------------------

const fetchBmadFilesSchema = z.object({
  owner: z.string().min(1).max(255).trim(),
  name: z.string().min(1).max(255).trim(),
});

/**
 * Fetch the BMAD file tree for a repo.
 * Routes by sourceType for GitHub vs Local.
 */
export async function fetchBmadFiles(input: {
  owner: string;
  name: string;
}): Promise<
  ActionResult<{
    fileTree: FileTreeNode[];
    docsTree: FileTreeNode[];
    bmadCoreTree: FileTreeNode[];
    bmadFiles: string[];
  }>
> {
  const parsed = fetchBmadFilesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid data", code: "VALIDATION_ERROR" };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  // F5: Always scope by userId
  const repoConfig = await prisma.repo.findFirst({
    where: { userId, owner: parsed.data.owner, name: parsed.data.name },
    select: { branch: true, sourceType: true, localPath: true },
  });
  if (!repoConfig) {
    return { success: false, error: "Project not found", code: "NOT_FOUND" };
  }

  try {
    if (repoConfig.sourceType === "local") {
      if (!repoConfig.localPath) {
        return { success: false, error: sanitizeError(null, "FS_ERROR"), code: "FS_ERROR" };
      }
      return fetchBmadFilesLocal(repoConfig.localPath);
    }
    return fetchBmadFilesGitHub(parsed.data, repoConfig.branch, userId);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "PATH_NOT_FOUND" || msg === "LOCAL_DISABLED") {
      return { success: false, error: sanitizeError(error, "PATH_STALE"), code: "PATH_STALE" };
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 403
    ) {
      return {
        success: false,
        error: "GitHub rate limit reached. Cached data is displayed.",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: sanitizeError(error, "GITHUB_ERROR"), code: "GITHUB_ERROR" };
  }
}

async function fetchBmadFilesLocal(localPath: string) {
  const provider = new LocalProvider(localPath);
  await provider.validateRoot();
  const providerTree = await provider.getTree();
  const allPaths = providerTree.paths;

  const { outputDir, bmadFiles } = getLocalBmadFiles(allPaths);
  const fileTree = buildFileTree(bmadFiles, outputDir);

  const bmadCorePaths = allPaths.filter((p) => p.startsWith(BMAD_CORE_DIR + "/"));
  const bmadCoreTree = buildFileTree(bmadCorePaths, BMAD_CORE_DIR);

  // F20/F35: Detect docs/ via rootDirectories
  const docsFolderName = providerTree.rootDirectories.find(
    (d) => d.toLowerCase() === "docs"
  ) ?? null;
  const docsTree = docsFolderName
    ? buildFileTree(
        allPaths.filter((p) => p.startsWith(docsFolderName + "/")),
        docsFolderName,
      )
    : [];

  return { success: true as const, data: { fileTree, docsTree, bmadCoreTree, bmadFiles } };
}

async function fetchBmadFilesGitHub(
  input: { owner: string; name: string },
  branch: string,
  userId: string,
) {
  const token = await getGitHubToken(userId);
  if (!token) {
    return { success: false as const, error: "GitHub OAuth token not found.", code: "TOKEN_MISSING" };
  }
  const octokit = createUserOctokit(token);

  const tree = await getCachedUserRepoTree(
    octokit,
    userId,
    input.owner,
    input.name,
    branch,
  );

  const allPaths = tree.tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path);

  const { outputDir, bmadFiles } = getLocalBmadFiles(allPaths);
  const fileTree = buildFileTree(bmadFiles, outputDir);

  const bmadCorePaths = allPaths.filter((p) => p.startsWith(BMAD_CORE_DIR + "/"));
  const bmadCoreTree = buildFileTree(bmadCorePaths, BMAD_CORE_DIR);

  // F20/F35: Detect docs/ via rootDirectories (from tree items)
  const docsFolder = tree.tree.find(
    (item) =>
      item.type === "tree" &&
      !item.path.includes("/") &&
      item.path.toLowerCase() === "docs",
  );
  const docsFolderName = docsFolder?.path ?? null;
  const docsTree = docsFolderName
    ? buildFileTree(
        allPaths.filter((p) => p.startsWith(docsFolderName + "/")),
        docsFolderName,
      )
    : [];

  return { success: true as const, data: { fileTree, docsTree, bmadCoreTree, bmadFiles } };
}

const fetchFileContentSchema = z.object({
  owner: z.string().min(1).max(255).trim(),
  name: z.string().min(1).max(255).trim(),
  path: z
    .string()
    .min(1)
    .max(1024)
    .trim()
    .refine((p) => !p.includes(".."), { message: "Invalid path" }),
});

/**
 * Fetch individual file content (lazy loading).
 * Routes by sourceType for GitHub vs Local.
 */
export async function fetchFileContent(input: {
  owner: string;
  name: string;
  path: string;
}): Promise<
  ActionResult<{
    content: string;
    contentType: "markdown" | "yaml" | "json" | "text";
  }>
> {
  const parsed = fetchFileContentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid data: " + parsed.error.issues[0].message,
      code: "VALIDATION_ERROR",
    };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  // F5: Always scope by userId
  const repoConfig = await prisma.repo.findFirst({
    where: { userId, owner: parsed.data.owner, name: parsed.data.name },
    select: { branch: true, sourceType: true, localPath: true },
  });
  if (!repoConfig) {
    return { success: false, error: "Project not found", code: "NOT_FOUND" };
  }

  const ext = parsed.data.path.split(".").pop()?.toLowerCase() ?? "";
  let contentType: "markdown" | "yaml" | "json" | "text" = "text";
  if (ext === "md") contentType = "markdown";
  else if (ext === "yaml" || ext === "yml") contentType = "yaml";
  else if (ext === "json") contentType = "json";

  try {
    let content: string;

    if (repoConfig.sourceType === "local") {
      if (!repoConfig.localPath) {
        return { success: false, error: sanitizeError(null, "FS_ERROR"), code: "FS_ERROR" };
      }
      const provider = new LocalProvider(repoConfig.localPath);
      content = await provider.getFileContent(parsed.data.path);
    } else {
      const token = await getGitHubToken(userId);
      if (!token) {
        return { success: false, error: "GitHub OAuth token not found.", code: "TOKEN_MISSING" };
      }
      const octokit = createUserOctokit(token);
      content = await getCachedUserRawContent(
        octokit,
        userId,
        parsed.data.owner,
        parsed.data.name,
        repoConfig.branch,
        parsed.data.path,
      );
    }

    return { success: true, data: { content, contentType } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "PATH_NOT_FOUND" || msg === "LOCAL_DISABLED") {
      return { success: false, error: sanitizeError(error, "PATH_STALE"), code: "PATH_STALE" };
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error
    ) {
      const status = (error as { status: number }).status;
      if (status === 403) {
        return { success: false, error: "GitHub rate limit reached.", code: "RATE_LIMITED" };
      }
      if (status === 404) {
        return { success: false, error: "File not found.", code: "NOT_FOUND" };
      }
    }
    return { success: false, error: sanitizeError(error, "GITHUB_ERROR"), code: "GITHUB_ERROR" };
  }
}

/**
 * Fetch and parse a BMAD file in a single server action call.
 */
export async function fetchParsedFileContent(input: {
  owner: string;
  name: string;
  path: string;
}): Promise<ActionResult<ParsedBmadFile>> {
  const result = await fetchFileContent(input);
  if (!result.success) return result;

  const parsed = parseBmadFile(result.data.content, result.data.contentType);
  return { success: true, data: parsed };
}

// ---------------------------------------------------------------------------
// Local folder import (Task 16)
// ---------------------------------------------------------------------------

const importLocalFolderSchema = z.object({
  localPath: z
    .string()
    .min(1)
    .max(4096)
    .trim()
    .refine((p) => !p.includes("\0"), { message: "Invalid path" }) // F12: null bytes
    .refine((p) => !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p), { message: "Invalid path" }), // F33
  displayName: z.string().min(1).max(255).trim().optional(),
});

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function sanitizeBasename(name: string): string {
  return name
    .replace(/[^a-z0-9-_]/gi, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/**
 * Import a local folder as a BMAD project.
 * F2: All FS operations go through LocalProvider (no direct fs calls).
 */
export async function importLocalFolder(input: {
  localPath: string;
  displayName?: string;
}): Promise<
  ActionResult<{ id: string; owner: string; name: string; displayName: string }>
> {
  // Guard: feature flag
  if (process.env.ENABLE_LOCAL_FS !== "true") {
    return { success: false, error: sanitizeError(null, "LOCAL_DISABLED"), code: "LOCAL_DISABLED" };
  }

  const parsed = importLocalFolderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid data: " + parsed.error.issues[0].message,
      code: "VALIDATION_ERROR",
    };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  // F3: Rate limit
  if (!checkRateLimit(`import-local:${userId}`, 10, 60000)) {
    return { success: false, error: "Trop de requêtes", code: "RATE_LIMIT" };
  }

  try {
    const rootProvider = new LocalProvider(parsed.data.localPath);
    await rootProvider.validateRoot();

    const resolvedRoot = await rootProvider.getProjectRoot();
    const bmadTree = await rootProvider.getTree();
    if (!hasLocalBmadStructure(bmadTree.rootDirectories, bmadTree.paths)) {
      return {
        success: false,
        error: "No BMAD structure found. Expected _bmad/, _bmad-output/, or a directory containing planning-artifacts/ or implementation-artifacts/.",
        code: "NO_BMAD",
      };
    }
    const { bmadFiles } = getLocalBmadFiles(bmadTree.paths);

    // F7/F19/F45: URL-safe name + collision-resistant hash based on project root
    const rawBasename = path.basename(resolvedRoot);
    const sanitizedBasename = sanitizeBasename(rawBasename);
    const hash = shortHash(resolvedRoot);
    const repoName = `${sanitizedBasename}-${hash}`;

    // F11: displayName from project root basename
    const displayName = parsed.data.displayName ?? rawBasename;

    const repo = await prisma.repo.create({
      data: {
        owner: "local",
        name: repoName,
        branch: "local",
        displayName,
        sourceType: "local",
        localPath: resolvedRoot,
        totalFiles: bmadFiles.length,
        lastSyncedAt: new Date(),
        userId,
      },
      select: { id: true, owner: true, name: true, displayName: true },
    });

    revalidatePath("/(dashboard)");
    return { success: true, data: repo };
  } catch (error: unknown) {
    if (
      error instanceof PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: "This folder is already imported.",
        code: "DUPLICATE",
      };
    }
    const msg = error instanceof Error ? error.message : "";
    if (msg === "PATH_NOT_FOUND") {
      return { success: false, error: sanitizeError(error, "PATH_NOT_FOUND"), code: "PATH_NOT_FOUND" };
    }
    if (msg === "LOCAL_DISABLED") {
      return { success: false, error: sanitizeError(error, "LOCAL_DISABLED"), code: "LOCAL_DISABLED" };
    }
    if (msg.startsWith("File count exceeds limit")) {
      return { success: false, error: "This folder contains too many files (limit: 10 000). Consider pointing to a sub-directory that contains the BMAD output.", code: "FS_ERROR" };
    }
    return { success: false, error: sanitizeError(error, "FS_ERROR"), code: "FS_ERROR" };
  }
}

// ---------------------------------------------------------------------------
// Local directory scanner
// ---------------------------------------------------------------------------

/**
 * Scan a parent directory for immediate subdirectories that contain _bmad or _bmad-output.
 * Returns a list of discovered project paths with their names.
 */
export async function scanLocalDirectory(input: {
  parentPath: string;
}): Promise<ActionResult<{ path: string; name: string }[]>> {
  if (process.env.ENABLE_LOCAL_FS !== "true") {
    return { success: false, error: sanitizeError(null, "LOCAL_DISABLED"), code: "LOCAL_DISABLED" };
  }

  const parsed = z.object({
    parentPath: z
      .string()
      .min(1)
      .max(4096)
      .trim()
      .refine((p) => !p.includes("\0"), { message: "Invalid path" })
      .refine((p) => !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p), { message: "Invalid path" }),
  }).safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid path", code: "VALIDATION_ERROR" };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;

  const resolvedParent = path.resolve(parsed.data.parentPath);

  try {
    const { readdir, stat } = await import("node:fs/promises");

    // Check the parent path exists and is a directory
    let parentStat;
    try {
      parentStat = await stat(resolvedParent);
    } catch {
      return { success: false, error: "Path not found", code: "PATH_NOT_FOUND" };
    }
    if (!parentStat.isDirectory()) {
      return { success: false, error: "Path is not a directory", code: "PATH_NOT_FOUND" };
    }

    const hasBmadStructure = async (dir: string): Promise<boolean> => {
      try {
        const dirEntries = await readdir(dir, { withFileTypes: true });
        // Direct BMAD dirs
        if (dirEntries.some((e) => e.isDirectory() && (e.name === "_bmad" || e.name === "_bmad-output"))) {
          return true;
        }
        // Any subdir containing planning-artifacts or implementation-artifacts
        for (const e of dirEntries) {
          if (!e.isDirectory() || e.name.startsWith(".")) continue;
          try {
            const subEntries = await readdir(path.join(dir, e.name), { withFileTypes: true });
            if (subEntries.some((se) => se.isDirectory() && (se.name === "planning-artifacts" || se.name === "implementation-artifacts"))) {
              return true;
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      return false;
    };

    const results: { path: string; name: string }[] = [];

    // Check if the path itself is a BMAD project
    const selfIsBmad = await hasBmadStructure(resolvedParent);
    if (selfIsBmad) {
      results.push({ path: resolvedParent, name: path.basename(resolvedParent) });
      return { success: true, data: results };
    }

    // Otherwise scan immediate subdirectories
    const entries = await readdir(resolvedParent, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      const subPath = path.join(resolvedParent, entry.name);
      if (await hasBmadStructure(subPath)) {
        results.push({ path: subPath, name: entry.name });
      }
    }

    return { success: true, data: results };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "FS_ERROR"), code: "FS_ERROR" };
  }
}

// ---------------------------------------------------------------------------
// Local path autocomplete
// ---------------------------------------------------------------------------

/**
 * Given a partial path, return immediate subdirectory names of the parent that
 * match the typed prefix. Used for filesystem path autocomplete in the UI.
 */
export async function autocompleteLocalPath(input: {
  partial: string;
}): Promise<ActionResult<{ dirs: string[]; base: string }>> {
  if (process.env.ENABLE_LOCAL_FS !== "true") {
    return { success: false, error: sanitizeError(null, "LOCAL_DISABLED"), code: "LOCAL_DISABLED" };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;

  const raw = (input.partial ?? "").trimStart();
  if (!raw || raw.includes("\0")) {
    return { success: true, data: { dirs: [], base: raw } };
  }

  try {
    const { readdir, stat } = await import("node:fs/promises");

    const resolved = path.resolve(raw);

    // If `raw` ends with a separator or refers to an existing directory,
    // list its children. Otherwise, list the parent and filter by prefix.
    let searchDir: string;
    let prefix: string;

    let isSelfDir = false;
    try {
      isSelfDir = (await stat(resolved)).isDirectory();
    } catch { /* not found or not a dir */ }

    if (isSelfDir && (raw.endsWith("/") || raw.endsWith(path.sep))) {
      searchDir = resolved;
      prefix = "";
    } else if (isSelfDir) {
      // Treat as a directory, list its children with no prefix
      searchDir = resolved;
      prefix = "";
    } else {
      searchDir = path.dirname(resolved);
      prefix = path.basename(resolved).toLowerCase();
    }

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(searchDir, { withFileTypes: true });
    } catch {
      return { success: true, data: { dirs: [], base: raw } };
    }

    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name.toLowerCase().startsWith(prefix))
      .map((e) => path.join(searchDir, e.name))
      .slice(0, 12);

    return { success: true, data: { dirs, base: raw } };
  } catch {
    return { success: true, data: { dirs: [], base: raw } };
  }
}

/**
 * Given a bare folder name and a list of its immediate children (used as a
 * content fingerprint), search well-known developer directories for the best
 * matching subdirectory. Returns candidates sorted by fingerprint score so
 * the closest match comes first.
 *
 * Used when the browser folder picker can only provide the folder name and
 * file listing, not the full absolute path.
 */
export async function resolveDirectoryByContents(input: {
  name: string;
  entries: string[];
}): Promise<ActionResult<string[]>> {
  if (process.env.ENABLE_LOCAL_FS !== "true") {
    return { success: false, error: sanitizeError(null, "LOCAL_DISABLED"), code: "LOCAL_DISABLED" };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;

  const name = (input.name ?? "").trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) {
    return { success: false, error: "Invalid name", code: "VALIDATION_ERROR" };
  }
  const entries = (input.entries ?? []).filter(
    (e) => typeof e === "string" && e.length > 0 && !e.includes("\0")
  );

  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "/";

  // Search roots: common single-level + well-known two-level developer paths
  const searchRoots = [
    homeDir,
    path.join(homeDir, "Documents"),
    path.join(homeDir, "Desktop"),
    path.join(homeDir, "Projects"),
    path.join(homeDir, "Developer"),
    path.join(homeDir, "workspace"),
    path.join(homeDir, "repos"),
    path.join(homeDir, "code"),
    path.join(homeDir, "src"),
    // Two-level nesting (GitHub/GitLab hosting conventions)
    path.join(homeDir, "Documents", "GitHub"),
    path.join(homeDir, "Documents", "GitLab"),
    path.join(homeDir, "Documents", "Repositories"),
    path.join(homeDir, "Documents", "Projects"),
    path.join(homeDir, "Developer", "Projects"),
    path.join(homeDir, "Developer", "repos"),
    path.join(homeDir, "Developer", "GitHub"),
    path.join(homeDir, "Desktop", "Projects"),
    process.cwd(),
    path.dirname(process.cwd()),
  ];

  const { stat, readdir } = await import("node:fs/promises");
  const entrySet = new Set(entries);
  const candidates: { resolvedPath: string; score: number }[] = [];

  for (const root of searchRoots) {
    const candidate = path.join(root, name);
    try {
      const s = await stat(candidate);
      if (!s.isDirectory()) continue;
      const resolved = path.resolve(candidate);
      if (candidates.some((c) => c.resolvedPath === resolved)) continue;

      // Score: count how many provided entries exist inside this directory
      let score = 0;
      if (entries.length > 0) {
        try {
          const dirEntries = await readdir(resolved);
          const dirSet = new Set(dirEntries);
          for (const e of entrySet) {
            if (dirSet.has(e)) score++;
          }
        } catch { /* skip scoring on unreadable dirs */ }
      }
      candidates.push({ resolvedPath: resolved, score });
    } catch { /* directory not found at this root */ }
  }

  // Best match first (highest fingerprint score)
  candidates.sort((a, b) => b.score - a.score);
  return { success: true, data: candidates.map((c) => c.resolvedPath) };
}

// ---------------------------------------------------------------------------
// Branch management (GitHub-only)
// ---------------------------------------------------------------------------

/**
 * List available branches for a repo from GitHub.
 * F21: Returns error for local repos (no branch concept).
 */
export async function listRepoBranches(input: {
  owner: string;
  name: string;
}): Promise<ActionResult<string[]>> {
  const authResult = await getAuthenticatedOctokit();
  if (!authResult.success) return authResult;

  const { octokit, userId } = authResult.data;
  const parsed = z.object({ owner: z.string(), name: z.string() }).safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION" };
  }

  // F21: Guard — local repos don't have branches
  const repoConfig = await prisma.repo.findFirst({
    where: { userId, owner: parsed.data.owner, name: parsed.data.name },
    select: { sourceType: true },
  });
  if (repoConfig?.sourceType === "local") {
    return { success: false, error: "Branch management is not available for local projects", code: "NOT_APPLICABLE" };
  }

  try {
    const branches = await octokit.paginate(
      octokit.rest.repos.listBranches,
      { owner: parsed.data.owner, repo: parsed.data.name, per_page: 100 },
    );
    return { success: true, data: branches.map((b) => b.name) };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "GITHUB_ERROR"), code: "GITHUB_ERROR" };
  }
}

/**
 * Update the tracked branch for a repo.
 * F21: Returns error for local repos.
 */
export async function updateRepoBranch(input: {
  owner: string;
  name: string;
  branch: string;
}): Promise<ActionResult<{ branch: string }>> {
  const authResult = await getAuthenticatedOctokit();
  if (!authResult.success) return authResult;

  const { userId } = authResult.data;
  const parsed = z
    .object({ owner: z.string(), name: z.string(), branch: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION" };
  }

  // F21: Guard — local repos don't have branches
  const repoConfig = await prisma.repo.findFirst({
    where: { userId, owner: parsed.data.owner, name: parsed.data.name },
    select: { id: true, sourceType: true },
  });
  if (!repoConfig) {
    return { success: false, error: "Project not found", code: "NOT_FOUND" };
  }
  if (repoConfig.sourceType === "local") {
    return { success: false, error: "Branch management is not available for local projects", code: "NOT_APPLICABLE" };
  }

  try {
    await prisma.repo.update({
      where: { id: repoConfig.id },
      data: { branch: parsed.data.branch },
    });

    revalidateTag(repoTag(parsed.data.owner, parsed.data.name), "default");
    revalidatePath("/(dashboard)");

    return { success: true, data: { branch: parsed.data.branch } };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}
