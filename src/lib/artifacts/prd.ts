import matter from "gray-matter";

export interface ParsedPrdArtifact {
  title: string;
  metadata: Record<string, unknown>;
  body: string;
  summary: string;
}

export function parsePrdArtifactContent(content: string): ParsedPrdArtifact {
  const hasFrontmatter = content.trimStart().startsWith("---");
  let title = "PRD";
  let body = content;
  const metadata: Record<string, unknown> = {};

  if (hasFrontmatter) {
    const parsed = matter(content);
    body = parsed.content;
    Object.assign(metadata, parsed.data as Record<string, unknown>);
    if (typeof parsed.data.title === "string" && parsed.data.title.trim()) {
      title = parsed.data.title.trim();
    }
    if (title === "PRD") {
      const h1 = body.match(/^#\s+(.+)/m);
      if (h1?.[1]) {
        title = h1[1].trim();
      }
    }
  } else {
    const h1 = content.match(/^#\s+(.+)/m);
    if (h1?.[1]) {
      title = h1[1].trim();
    }
  }

  return {
    title,
    metadata,
    body,
    summary: summarizeMarkdown(body),
  };
}

function summarizeMarkdown(content: string, maxLength = 280): string {
  const plainText = content
    .replace(/^---[\s\S]*?---/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]*\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plainText) {
    return "暂无可用摘要。";
  }

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trim()}…`;
}
