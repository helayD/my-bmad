import { describe, it, expect } from "vitest";
import { generateSlug, randomHex } from "@/lib/workspace/slug-utils";

describe("generateSlug", () => {
  it("should use default fallback 'user'", () => {
    expect(generateSlug("张三")).toBe("user");
  });

  it("should use custom fallback 'team'", () => {
    expect(generateSlug("团队", "team")).toBe("team");
  });

  it("should extract partial ASCII from Chinese input", () => {
    expect(generateSlug("团队Alpha", "team")).toBe("alpha");
  });

  it("should extract email prefix", () => {
    expect(generateSlug("User@Example.com")).toBe("user");
  });

  it("should handle special characters", () => {
    expect(generateSlug("hello.world+test@example.com")).toBe("hello-world-test");
  });

  it("should truncate to 39 characters", () => {
    const longName = "a".repeat(50);
    const slug = generateSlug(longName);
    expect(slug.length).toBeLessThanOrEqual(39);
    expect(slug).toBe("a".repeat(39));
  });

  it("should return fallback for empty string", () => {
    expect(generateSlug("")).toBe("user");
    expect(generateSlug("", "team")).toBe("team");
  });

  it("should handle name without @ sign", () => {
    expect(generateSlug("My Awesome Team", "team")).toBe("my-awesome-team");
  });

  it("should merge consecutive hyphens and trim", () => {
    expect(generateSlug("a---b")).toBe("a-b");
    expect(generateSlug("-test-")).toBe("test");
  });
});

describe("randomHex", () => {
  it("should return string of specified length", () => {
    expect(randomHex(4).length).toBe(4);
    expect(randomHex(8).length).toBe(8);
  });

  it("should only contain hex characters", () => {
    const result = randomHex(100);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("should return empty string for length 0", () => {
    expect(randomHex(0)).toBe("");
  });
});
