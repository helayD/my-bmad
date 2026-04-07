import { prisma } from "@/lib/db/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import type { EnsureWorkspaceResult } from "@/lib/workspace/types";

/**
 * Generate a URL-safe slug from a user identifier (email or name).
 *
 * Rules:
 * 1. Take email @ prefix, or name
 * 2. toLowerCase()
 * 3. Replace all non [a-z0-9] chars with "-"
 * 4. Merge consecutive "-", trim leading/trailing "-"
 * 5. Truncate to 39 chars (reserve space for -xxxx collision suffix, total ≤ 44)
 * 6. Fallback to "user" if result is empty
 */
export function generateSlug(userIdentifier: string): string {
  let base = userIdentifier;

  const atIndex = base.indexOf("@");
  if (atIndex > 0) {
    base = base.substring(0, atIndex);
  }

  base = base
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 39);

  return base || "user";
}

/**
 * Generate a human-readable workspace name from user info.
 * Uses user.name if available, otherwise email prefix.
 */
export function generateWorkspaceName(
  userName: string | null | undefined,
  email: string
): string {
  const displayName = userName || email.split("@")[0] || "user";
  return `${displayName}'s Workspace`;
}

/**
 * Ensure a personal workspace exists for the given user.
 * Uses lazy provisioning: creates on first access, returns existing on subsequent calls.
 *
 * Concurrency-safe via database unique constraints + P2002 catch.
 * Pure domain function — no "use server", no headers()/cookies() dependency.
 */
export async function ensurePersonalWorkspace(
  userId: string,
  userIdentifier: string,
  userName?: string | null
): Promise<EnsureWorkspaceResult> {
  const existing = await prisma.workspace.findFirst({
    where: { ownerId: userId, type: "PERSONAL" },
    include: { memberships: { where: { userId }, take: 1 } },
  });

  if (existing) {
    if (!existing.memberships[0]) {
      throw new Error("Personal workspace exists but membership record is missing");
    }
    return {
      workspace: existing,
      membership: existing.memberships[0],
      created: false,
    };
  }

  const slug = generateSlug(userIdentifier);
  const name = generateWorkspaceName(userName, userIdentifier);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name,
          slug,
          type: "PERSONAL",
          ownerId: userId,
        },
      });
      const membership = await tx.workspaceMembership.create({
        data: {
          workspaceId: workspace.id,
          userId,
          role: "OWNER",
        },
      });
      return { workspace, membership };
    });
    return { ...result, created: true };
  } catch (error: unknown) {
    if (
      error instanceof PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const target = (error.meta?.target as string[]) ?? [];

      if (target.includes("slug")) {
        const suffixedSlug = `${slug.substring(0, 39)}-${randomHex(4)}`;
        try {
          const result = await prisma.$transaction(async (tx) => {
            const workspace = await tx.workspace.create({
              data: {
                name,
                slug: suffixedSlug,
                type: "PERSONAL",
                ownerId: userId,
              },
            });
            const membership = await tx.workspaceMembership.create({
              data: {
                workspaceId: workspace.id,
                userId,
                role: "OWNER",
              },
            });
            return { workspace, membership };
          });
          return { ...result, created: true };
        } catch (retryError: unknown) {
          if (
            retryError instanceof PrismaClientKnownRequestError &&
            retryError.code === "P2002"
          ) {
            const fallback = await prisma.workspace.findFirst({
              where: { ownerId: userId, type: "PERSONAL" },
              include: { memberships: { where: { userId }, take: 1 } },
            });
            if (fallback && fallback.memberships[0]) {
              return {
                workspace: fallback,
                membership: fallback.memberships[0],
                created: false,
              };
            }
          }
          throw retryError;
        }
      }

      const fallback = await prisma.workspace.findFirst({
        where: { ownerId: userId, type: "PERSONAL" },
        include: { memberships: { where: { userId }, take: 1 } },
      });
      if (fallback && fallback.memberships[0]) {
        return {
          workspace: fallback,
          membership: fallback.memberships[0],
          created: false,
        };
      }
    }
    throw error;
  }
}

function randomHex(length: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
