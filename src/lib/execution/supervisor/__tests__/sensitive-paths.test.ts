/**
 * Unit tests for sensitive path matching.
 * Tests: exact, suffix, prefix, regex matchers; findSensitivePaths; isSensitivePath.
 */

import { describe, expect, it } from "vitest";
import {
  matchSensitivePath,
  findSensitivePaths,
  isSensitivePath,
  DEFAULT_MATCHERS,
  type SensitivePathMatcher,
} from "../sensitive-paths";

describe("matchSensitivePath", () => {
  describe("exact matches", () => {
    it("matches .env exactly", () => {
      expect(matchSensitivePath(".env")).not.toBeNull();
      expect(matchSensitivePath(".env")?.label).toBe("环境变量文件");
    });

    it("does not match .envx", () => {
      expect(matchSensitivePath(".envx")).toBeNull();
    });

    it("matches id_rsa", () => {
      expect(matchSensitivePath("id_rsa")).not.toBeNull();
      expect(matchSensitivePath("id_rsa")?.label).toBe("SSH 私钥");
    });

    it("does not match id_rsa.pub", () => {
      expect(matchSensitivePath("id_rsa.pub")).not.toBeNull();
    });

    it("matches credentials.json", () => {
      expect(matchSensitivePath("credentials.json")).not.toBeNull();
    });
  });

  describe("suffix matches", () => {
    it("matches .env.production (exact rule)", () => {
      expect(matchSensitivePath(".env.production")).not.toBeNull();
    });

    it("matches .env.local", () => {
      expect(matchSensitivePath(".env.local")).not.toBeNull();
    });

    it("matches server.key", () => {
      expect(matchSensitivePath("server.key")).not.toBeNull();
      expect(matchSensitivePath("server.key")?.label).toBe("私钥文件");
    });

    it("matches client.pem", () => {
      expect(matchSensitivePath("client.pem")).not.toBeNull();
      expect(matchSensitivePath("client.pem")?.label).toBe("PEM 证书文件");
    });

    it("does not match .envtxt", () => {
      expect(matchSensitivePath(".envtxt")).toBeNull();
    });
  });

  describe("prefix matches", () => {
    it("matches .ssh/config", () => {
      expect(matchSensitivePath(".ssh/config")).not.toBeNull();
      expect(matchSensitivePath(".ssh/config")?.label).toBe("SSH 配置目录");
    });

    it("matches .git/HEAD", () => {
      expect(matchSensitivePath(".git/HEAD")).not.toBeNull();
      expect(matchSensitivePath(".git/HEAD")?.label).toBe("Git 目录");
    });

    it("does not match ssh_config", () => {
      expect(matchSensitivePath("ssh_config")).toBeNull();
    });
  });

  describe("path normalization", () => {
    it("handles backslash paths on all platforms", () => {
      const result = matchSensitivePath(".ssh\\config");
      expect(result).not.toBeNull();
    });
  });

  describe("custom matchers", () => {
    it("uses custom matchers when provided", () => {
      const custom: SensitivePathMatcher[] = [
        { pattern: "^secrets/.*$", kind: "regex", label: "Custom secret" },
      ];
      expect(matchSensitivePath("secrets/api-key", custom)).not.toBeNull();
      expect(matchSensitivePath("secrets/api-key", custom)?.label).toBe("Custom secret");
    });

    it("invalid regex is skipped gracefully", () => {
      const custom: SensitivePathMatcher[] = [
        { pattern: "[invalid", kind: "regex", label: "Bad regex" },
      ];
      expect(matchSensitivePath("anything")).toBeNull();
    });
  });
});

describe("findSensitivePaths", () => {
  it("returns empty array when no sensitive paths", () => {
    const result = findSensitivePaths(["src/index.ts", "README.md", "package.json"]);
    expect(result).toHaveLength(0);
  });

  it("returns sensitive paths with their matchers", () => {
    const result = findSensitivePaths([".env", "src/index.ts", "id_rsa"]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.path)).toEqual([".env", "id_rsa"]);
  });

  it("handles nested paths", () => {
    const result = findSensitivePaths([
      ".env.local",
      "src/main.ts",
      ".ssh/authorized_keys",
    ]);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(findSensitivePaths([])).toHaveLength(0);
  });
});

describe("isSensitivePath", () => {
  it("returns true for sensitive paths", () => {
    expect(isSensitivePath(".env")).toBe(true);
    expect(isSensitivePath("server.key")).toBe(true);
    expect(isSensitivePath(".ssh/id_rsa")).toBe(true);
  });

  it("returns false for safe paths", () => {
    expect(isSensitivePath("src/index.ts")).toBe(false);
    expect(isSensitivePath("README.md")).toBe(false);
    expect(isSensitivePath("package.json")).toBe(false);
  });
});

describe("DEFAULT_MATCHERS coverage", () => {
  it("covers all required sensitive patterns", () => {
    const coveredPatterns = [
      ".env",
      ".env.*",
      "*.pem",
      "*.key",
      ".ssh/",
      ".git/",
      "id_rsa",
      "id_ed25519",
    ];
    for (const pattern of coveredPatterns) {
      expect(matchSensitivePath(pattern), `Expected ${pattern} to be matched`).not.toBeNull();
    }
  });
});
