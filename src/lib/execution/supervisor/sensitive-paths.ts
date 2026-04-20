/**
 * Sensitive path matching — default deny rules for execution context injection.
 *
 * Design principles:
 * - Default deny: any path not explicitly matched by a allowlist rule is treated as sensitive.
 * - Extensible: callers can pass custom matchers via options.
 * - No environment variable content is ever included in matches — only file paths.
 *
 * Supported patterns:
 * - Exact filename: `.env`, `id_rsa`
 * - Glob suffix: `.env.*`, `*.pem`, `*.key`
 * - Directory prefix: `.ssh/`, `.git/`
 * - Future: custom regex matchers (via options)
 */

export interface SensitivePathMatcher {
  pattern: string;
  kind: "exact" | "suffix" | "prefix" | "regex";
  label: string;
}

export const DEFAULT_MATCHERS: SensitivePathMatcher[] = [
  // ── Environment files ───────────────────────────────────────────────
  { pattern: ".env", kind: "exact", label: "环境变量文件" },
  // Note: ".env.*" as a glob means ".env." + anything, handled via prefix below.
  { pattern: ".env.local", kind: "exact", label: "本地环境变量" },
  { pattern: ".env.production", kind: "exact", label: "生产环境变量" },
  { pattern: ".env.development", kind: "exact", label: "开发环境变量" },
  { pattern: ".env.test", kind: "exact", label: "测试环境变量" },
  { pattern: ".env.staging", kind: "exact", label: "预发布环境变量" },
  // Generic .env prefix protection (covers .env.ANYTHING not listed above).
  { pattern: ".env.", kind: "prefix", label: "环境变量文件" },

  // ── Credentials / keys ────────────────────────────────────────────
  { pattern: "*.pem", kind: "suffix", label: "PEM 证书文件" },
  { pattern: "*.key", kind: "suffix", label: "私钥文件" },
  { pattern: "*.p12", kind: "suffix", label: "PKCS12 密钥包" },
  { pattern: "*.pfx", kind: "suffix", label: "密钥包" },
  { pattern: "*.crt", kind: "suffix", label: "证书文件" },
  { pattern: "*.cer", kind: "suffix", label: "证书文件" },
  { pattern: "credentials.json", kind: "exact", label: "凭证文件" },
  { pattern: "service-account.json", kind: "exact", label: "服务账号凭证" },
  { pattern: "firebase-sa.json", kind: "exact", label: "Firebase 凭证" },
  { pattern: "google-application-credentials.json", kind: "exact", label: "Google 凭证" },

  // ── SSH ───────────────────────────────────────────────────────────
  { pattern: ".ssh/", kind: "prefix", label: "SSH 配置目录" },
  { pattern: "id_rsa", kind: "exact", label: "SSH 私钥" },
  { pattern: "id_rsa.pub", kind: "exact", label: "SSH 公钥" },
  { pattern: "id_ed25519", kind: "exact", label: "ED25519 私钥" },
  { pattern: "id_ed25519.pub", kind: "exact", label: "ED25519 公钥" },
  { pattern: "known_hosts", kind: "exact", label: "SSH known_hosts" },
  { pattern: "authorized_keys", kind: "exact", label: "SSH authorized_keys" },
  { pattern: "config", kind: "exact", label: "SSH config" },

  // ── Git ───────────────────────────────────────────────────────────
  { pattern: ".git/", kind: "prefix", label: "Git 目录" },

  // ── Authentication tokens ─────────────────────────────────────────
  { pattern: "*.token", kind: "suffix", label: "Token 文件" },
  { pattern: "*.secret", kind: "suffix", label: "密钥文件" },
  { pattern: "github_token", kind: "exact", label: "GitHub Token" },
  { pattern: "netrc", kind: "exact", label: "Netrc 凭证" },
  { pattern: ".npmrc", kind: "exact", label: "npm 凭证" },
  { pattern: ".pypirc", kind: "exact", label: "PyPI 凭证" },
  { pattern: ".gem/credentials", kind: "exact", label: "Gem 凭证" },
  { pattern: "composer.json", kind: "exact", label: "Composer 凭证" },
  { pattern: ".netrc", kind: "exact", label: "Netrc 凭证" },

  // ── Cloud provider credentials ─────────────────────────────────────
  { pattern: "aws_credentials", kind: "exact", label: "AWS 凭证" },
  { pattern: "aws_access_key", kind: "exact", label: "AWS Access Key" },
  { pattern: "azure_credentials.json", kind: "exact", label: "Azure 凭证" },
];

/**
 * Check if a path (relative or absolute) matches any sensitive path rule.
 * Returns the first matching rule, or null if the path is allowed.
 */
export function matchSensitivePath(
  filePath: string,
  matchers: SensitivePathMatcher[] = DEFAULT_MATCHERS,
): SensitivePathMatcher | null {
  const normalized = filePath.replace(/\\/g, "/");

  for (const matcher of matchers) {
    switch (matcher.kind) {
      case "exact":
        if (normalized === matcher.pattern) return matcher;
        break;
      case "suffix":
        if (normalized.endsWith(matcher.pattern)) return matcher;
        if (matcher.pattern.startsWith("*.")) {
          const suffix = matcher.pattern.slice(1);
          if (normalized.endsWith(suffix) && normalized !== suffix) return matcher;
        }
        break;
      case "prefix":
        if (normalized.startsWith(matcher.pattern)) return matcher;
        break;
      case "regex":
        try {
          if (new RegExp(matcher.pattern).test(normalized)) return matcher;
        } catch {
          // Invalid regex — skip this matcher
        }
        break;
    }
  }

  return null;
}

/**
 * Filter a list of file paths, returning only the sensitive ones.
 */
export function findSensitivePaths(
  filePaths: string[],
  matchers: SensitivePathMatcher[] = DEFAULT_MATCHERS,
): { path: string; matcher: SensitivePathMatcher }[] {
  return filePaths
    .map((p) => ({ path: p, matcher: matchSensitivePath(p, matchers) }))
    .filter((r): r is { path: string; matcher: SensitivePathMatcher } => r.matcher !== null);
}

/**
 * Check if a path is sensitive. Convenience wrapper over matchSensitivePath.
 */
export function isSensitivePath(
  filePath: string,
  matchers: SensitivePathMatcher[] = DEFAULT_MATCHERS,
): boolean {
  return matchSensitivePath(filePath, matchers) !== null;
}
