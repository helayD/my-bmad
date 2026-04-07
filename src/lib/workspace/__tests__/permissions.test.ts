import { describe, it, expect } from "vitest";
import { hasPermission, canManageMembers, canChangeRole, isValidRole } from "@/lib/workspace/permissions";

describe("hasPermission", () => {
  it("OWNER has READ permission", () => {
    expect(hasPermission("OWNER", "READ")).toBe(true);
  });

  it("AUDITOR does NOT have EXECUTE permission (AC #3)", () => {
    expect(hasPermission("AUDITOR", "EXECUTE")).toBe(false);
  });

  it("VIEWER does NOT have EXECUTE permission (AC #2)", () => {
    expect(hasPermission("VIEWER", "EXECUTE")).toBe(false);
  });

  it("MEMBER has EXECUTE permission (AC #4)", () => {
    expect(hasPermission("MEMBER", "EXECUTE")).toBe(true);
  });

  it("MEMBER does NOT have GOVERN permission (AC #4)", () => {
    expect(hasPermission("MEMBER", "GOVERN")).toBe(false);
  });

  it("ADMIN has GOVERN permission", () => {
    expect(hasPermission("ADMIN", "GOVERN")).toBe(true);
  });

  it("AUDITOR has READ permission", () => {
    expect(hasPermission("AUDITOR", "READ")).toBe(true);
  });

  it("VIEWER has READ permission", () => {
    expect(hasPermission("VIEWER", "READ")).toBe(true);
  });
});

describe("canManageMembers", () => {
  it("OWNER can manage members", () => {
    expect(canManageMembers("OWNER")).toBe(true);
  });

  it("ADMIN can manage members", () => {
    expect(canManageMembers("ADMIN")).toBe(true);
  });

  it("MEMBER cannot manage members", () => {
    expect(canManageMembers("MEMBER")).toBe(false);
  });

  it("VIEWER cannot manage members", () => {
    expect(canManageMembers("VIEWER")).toBe(false);
  });
});

describe("canChangeRole", () => {
  it("OWNER can assign OWNER", () => {
    expect(canChangeRole("OWNER", "OWNER")).toBe(true);
  });

  it("OWNER can assign MEMBER", () => {
    expect(canChangeRole("OWNER", "MEMBER")).toBe(true);
  });

  it("ADMIN cannot assign OWNER", () => {
    expect(canChangeRole("ADMIN", "OWNER")).toBe(false);
  });

  it("ADMIN can assign MEMBER", () => {
    expect(canChangeRole("ADMIN", "MEMBER")).toBe(true);
  });

  it("ADMIN can assign ADMIN", () => {
    expect(canChangeRole("ADMIN", "ADMIN")).toBe(true);
  });

  it("MEMBER cannot change roles", () => {
    expect(canChangeRole("MEMBER", "ADMIN")).toBe(false);
  });

  it("VIEWER cannot change roles", () => {
    expect(canChangeRole("VIEWER", "MEMBER")).toBe(false);
  });

  it("AUDITOR cannot change roles", () => {
    expect(canChangeRole("AUDITOR", "MEMBER")).toBe(false);
  });
});

describe("isValidRole", () => {
  it("OWNER is valid", () => {
    expect(isValidRole("OWNER")).toBe(true);
  });

  it("ADMIN is valid", () => {
    expect(isValidRole("ADMIN")).toBe(true);
  });

  it("MEMBER is valid", () => {
    expect(isValidRole("MEMBER")).toBe(true);
  });

  it("VIEWER is valid", () => {
    expect(isValidRole("VIEWER")).toBe(true);
  });

  it("AUDITOR is valid", () => {
    expect(isValidRole("AUDITOR")).toBe(true);
  });

  it("SUPERUSER is NOT valid", () => {
    expect(isValidRole("SUPERUSER")).toBe(false);
  });

  it("empty string is NOT valid", () => {
    expect(isValidRole("")).toBe(false);
  });
});
