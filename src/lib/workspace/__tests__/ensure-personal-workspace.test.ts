import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import {
  generateSlug,
  generateWorkspaceName,
  ensurePersonalWorkspace,
} from "@/lib/workspace/ensure-personal-workspace";

const prisma = new PrismaClient();
const TEST_MARKER = "test-ensure-pw";

function getTestEmail(suffix: string) {
  return `${TEST_MARKER}-${suffix}@example.com`;
}

function assertSafeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for workspace tests.");
  }
  if (!/(^|[_/.-])test([_/.-]|$)/i.test(databaseUrl)) {
    throw new Error(
      "ensure-personal-workspace.test.ts requires DATABASE_URL to point to a test database."
    );
  }
}

async function cleanupTestData() {
  await prisma.workspaceMembership.deleteMany({
    where: { user: { is: { email: { contains: TEST_MARKER } } } },
  });
  await prisma.project.deleteMany({
    where: { workspace: { is: { slug: { contains: TEST_MARKER } } } },
  });
  await prisma.workspace.deleteMany({
    where: {
      OR: [
        { slug: { contains: TEST_MARKER } },
        { owner: { is: { email: { contains: TEST_MARKER } } } },
      ],
    },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: TEST_MARKER } },
  });
}

// ---------- Unit tests for pure functions ----------

describe("generateSlug", () => {
  it("should extract email prefix and lowercase", () => {
    expect(generateSlug("User@Example.com")).toBe("user");
  });

  it("should replace non-alphanumeric chars with hyphens", () => {
    expect(generateSlug("hello.world+test@example.com")).toBe("hello-world-test");
  });

  it("should merge consecutive hyphens", () => {
    expect(generateSlug("a---b@example.com")).toBe("a-b");
  });

  it("should trim leading and trailing hyphens", () => {
    expect(generateSlug("-test-@example.com")).toBe("test");
  });

  it("should truncate to 39 characters", () => {
    const longName = "a".repeat(50) + "@example.com";
    expect(generateSlug(longName).length).toBeLessThanOrEqual(39);
  });

  it("should fallback to 'user' for non-ASCII only input", () => {
    expect(generateSlug("张三")).toBe("user");
  });

  it("should fallback to 'user' for empty string", () => {
    expect(generateSlug("")).toBe("user");
  });

  it("should handle name (no @ sign) input", () => {
    expect(generateSlug("David Zhang")).toBe("david-zhang");
  });
});

describe("generateWorkspaceName", () => {
  it("should use user name when available", () => {
    expect(generateWorkspaceName("David Zhang", "david@example.com")).toBe(
      "David Zhang's Workspace"
    );
  });

  it("should use email prefix when name is null", () => {
    expect(generateWorkspaceName(null, "user@example.com")).toBe(
      "user's Workspace"
    );
  });

  it("should use email prefix when name is empty string", () => {
    expect(generateWorkspaceName("", "user@example.com")).toBe(
      "user's Workspace"
    );
  });
});

// ---------- Integration tests (require PostgreSQL test DB) ----------

describe("ensurePersonalWorkspace (integration)", () => {
  let hasSafeDatabaseUrl = false;

  beforeAll(async () => {
    assertSafeDatabaseUrl();
    hasSafeDatabaseUrl = true;
  });

  beforeEach(async () => {
    if (hasSafeDatabaseUrl) await cleanupTestData();
  });

  afterEach(async () => {
    if (hasSafeDatabaseUrl) await cleanupTestData();
  });

  afterAll(async () => {
    if (hasSafeDatabaseUrl) await cleanupTestData();
    await prisma.$disconnect();
  });

  it("should create a personal workspace on first call (created: true)", async () => {
    const user = await prisma.user.create({
      data: { email: getTestEmail("first"), name: "First User" },
    });

    const result = await ensurePersonalWorkspace(
      user.id,
      user.email,
      user.name
    );

    expect(result.created).toBe(true);
    expect(result.workspace.type).toBe("PERSONAL");
    expect(result.workspace.ownerId).toBe(user.id);
    expect(result.workspace.slug).toBe(`${TEST_MARKER}-first`);
    expect(result.workspace.name).toBe("First User's Workspace");
    expect(result.membership.role).toBe("OWNER");
    expect(result.membership.userId).toBe(user.id);
    expect(result.membership.workspaceId).toBe(result.workspace.id);
  });

  it("should return existing workspace on subsequent calls (created: false)", async () => {
    const user = await prisma.user.create({
      data: { email: getTestEmail("idempotent"), name: "Idempotent User" },
    });

    const first = await ensurePersonalWorkspace(
      user.id,
      user.email,
      user.name
    );
    expect(first.created).toBe(true);

    const second = await ensurePersonalWorkspace(
      user.id,
      user.email,
      user.name
    );
    expect(second.created).toBe(false);
    expect(second.workspace.id).toBe(first.workspace.id);
  });

  it("should generate correct name from email when userName is null", async () => {
    const user = await prisma.user.create({
      data: { email: getTestEmail("noname") },
    });

    const result = await ensurePersonalWorkspace(user.id, user.email, null);

    expect(result.created).toBe(true);
    expect(result.workspace.name).toBe(`${TEST_MARKER}-noname's Workspace`);
  });

  it("should create workspace and membership atomically", async () => {
    const user = await prisma.user.create({
      data: { email: getTestEmail("atomic"), name: "Atomic User" },
    });

    const result = await ensurePersonalWorkspace(
      user.id,
      user.email,
      user.name
    );

    const dbWorkspace = await prisma.workspace.findUnique({
      where: { id: result.workspace.id },
      include: { memberships: true },
    });

    expect(dbWorkspace).toBeTruthy();
    expect(dbWorkspace!.memberships).toHaveLength(1);
    expect(dbWorkspace!.memberships[0].role).toBe("OWNER");
    expect(dbWorkspace!.memberships[0].userId).toBe(user.id);
  });
});
