/**
 * Generate a URL-safe slug from a user identifier (email or name).
 *
 * Rules:
 * 1. Take email @ prefix, or name
 * 2. toLowerCase()
 * 3. Replace all non [a-z0-9] chars with "-"
 * 4. Merge consecutive "-", trim leading/trailing "-"
 * 5. Truncate to 39 chars (reserve space for -xxxx collision suffix, total ≤ 44)
 * 6. Fallback to provided fallback string if result is empty (default: "user")
 */
export function generateSlug(input: string, fallback: string = "user"): string {
  let base = input;

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

  return base || fallback;
}

/**
 * Check if an error is a Prisma P2002 unique constraint violation.
 * Works across both PrismaClientKnownRequestError and wrapped variants.
 */
export function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "P2002";
  }
  if (error instanceof Error && error.message.includes("Unique constraint")) {
    return true;
  }
  return false;
}

export function randomHex(length: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
