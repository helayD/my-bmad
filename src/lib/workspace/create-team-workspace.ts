import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { generateSlug, randomHex, isPrismaUniqueConstraintError } from "@/lib/workspace/slug-utils";
import type { EnsureWorkspaceResult } from "@/lib/workspace/types";

const teamNameSchema = z.string().trim().min(1).max(100);

/**
 * Create a TEAM workspace for the given user.
 * Pure domain function — no "use server", no headers()/cookies() dependency.
 *
 * Concurrency-safe via database unique constraints + P2002 catch.
 * Uses sequential operations (create workspace, then membership) instead of
 * interactive transactions, because Prisma 6.x wraps P2002 inside
 * PrismaClientUnknownRequestError when thrown from interactive transactions.
 */
export async function createTeamWorkspace(
  userId: string,
  teamName: string
): Promise<EnsureWorkspaceResult> {
  const parsed = teamNameSchema.safeParse(teamName);
  if (!parsed.success) {
    throw new Error("Le nom de l'équipe est invalide (1–100 caractères requis).");
  }

  const name = parsed.data;
  const slug = generateSlug(name, "team");

  async function tryCreate(attemptSlug: string) {
    const workspace = await prisma.workspace.create({
      data: {
        name,
        slug: attemptSlug,
        type: "TEAM",
        ownerId: userId,
      },
    });
    const membership = await prisma.workspaceMembership.create({
      data: {
        workspaceId: workspace.id,
        userId,
        role: "OWNER",
      },
    });
    return { workspace, membership, created: true as const };
  }

  try {
    return await tryCreate(slug);
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error)) {
      const suffixedSlug = `${slug.substring(0, 39)}-${randomHex(4)}`;
      try {
        return await tryCreate(suffixedSlug);
      } catch (retryError: unknown) {
        if (isPrismaUniqueConstraintError(retryError)) {
          const fallback = await prisma.workspace.findFirst({
            where: {
              ownerId: userId,
              type: "TEAM",
              slug: { in: [slug, suffixedSlug] },
            },
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
    throw error;
  }
}
