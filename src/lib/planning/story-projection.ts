import { BMAD_IMPLEMENTATION_DIR, BMAD_OUTPUT_DIR } from "@/lib/bmad/utils";
import type { PlanningArtifactWriter, PlanningArtifactWriteResult } from "@/lib/planning/artifact-writer";
import type { PlanningArtifactSummaryItem } from "@/lib/planning/types";

const STORY_PROJECTION_BLOCK_START = "<!-- planning:story-projection:start -->";
const STORY_PROJECTION_BLOCK_END = "<!-- planning:story-projection:end -->";
const STORY_FILE_PATTERN = /^_bmad-output\/implementation-artifacts\/(\d+)-(\d+)-.+\.md$/;

export interface ProjectedStorySpec {
  epicId: string;
  epicTitle: string;
  storyId: string;
  title: string;
  summary: string;
  acceptanceCriteria: string[];
}

export interface StoryProjectionResult {
  writes: PlanningArtifactWriteResult[];
  artifactSummary: PlanningArtifactSummaryItem[];
  conflicts: string[];
}

export function extractStoriesFromEpicsDocument(content: string): ProjectedStorySpec[] {
  const stories: ProjectedStorySpec[] = [];
  const epicMatches = [...content.matchAll(/^##\s+Epic\s+(\d+)[\s:.—-]+(.+)$/gim)];

  for (let index = 0; index < epicMatches.length; index += 1) {
    const match = epicMatches[index];
    if (match?.index === undefined) {
      continue;
    }

    const nextIndex = epicMatches[index + 1]?.index ?? content.length;
    const epicBlock = content.slice(match.index, nextIndex);
    const epicId = match[1];
    const epicTitle = match[2]?.trim() ?? `Epic ${epicId}`;
    const storyMatches = [...epicBlock.matchAll(/^###\s+Story\s+(\d+\.\d+)[:\s-]+(.+)$/gim)];

    for (let storyIndex = 0; storyIndex < storyMatches.length; storyIndex += 1) {
      const storyMatch = storyMatches[storyIndex];
      if (storyMatch?.index === undefined) {
        continue;
      }

      const storyNextIndex = storyMatches[storyIndex + 1]?.index ?? epicBlock.length;
      const storyBlock = epicBlock.slice(storyMatch.index, storyNextIndex);
      const storyId = storyMatch[1];
      const title = storyMatch[2]?.trim() ?? `Story ${storyId}`;
      const acceptanceCriteria = extractAcceptanceCriteria(storyBlock);
      const summary = extractStorySummary(storyBlock, title);

      stories.push({
        epicId,
        epicTitle,
        storyId,
        title,
        summary,
        acceptanceCriteria,
      });
    }
  }

  return stories;
}

export function buildProjectedStoryStub(
  story: ProjectedStorySpec,
  sourcePath: string,
): string {
  const [epicNumber, storyNumber] = story.storyId.split(".");
  const acceptanceCriteria = story.acceptanceCriteria.length > 0
    ? story.acceptanceCriteria
    : [
        "关键用户流程可以被完整执行。",
        "状态、错误与边界情况具备可见反馈。",
      ];
  const taskSkeleton = buildTaskSkeleton(acceptanceCriteria);

  return `# Story ${story.storyId}: ${story.title}

Status: planned

## Story

作为用户，
我希望${story.summary || `系统可以交付“${story.title}”相关能力`}，
以便目标从规划结果顺利进入后续实现。

## Acceptance Criteria

${acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}

## Tasks / Subtasks

${taskSkeleton}

## Dev Notes

- 本文件由规划执行自动投影生成，可在后续 Story 开发前继续补充细节。
- 若需进入开发，请先补充更完整的实现任务、依赖关系与测试要求。

### Project Structure Notes

- 当前 stub 用于建立 STORY / TASK 级工件真值，避免只写 epics.md 而缺少实现层工件。
- 自动投影不会覆盖开发过程中新增的实现细节；如需更新，请在受控区块外继续编辑。

### References

- [Source: ${sourcePath}#Story ${story.storyId}] — 原始规划故事条目

## Dev Agent Record

### Agent Model Used

规划执行自动投影

### Debug Log References

### Completion Notes List

### File List

## Planning Projection Metadata

${buildProjectionBlock({
    epicNumber,
    storyNumber,
    sourcePath,
    storyId: story.storyId,
  })}`;
}

export async function projectStoriesFromEpicsDocument(input: {
  content: string;
  sourcePath: string;
  writer: PlanningArtifactWriter;
  existingPaths: string[];
  sourceSkillKey: string;
}): Promise<StoryProjectionResult> {
  const storySpecs = extractStoriesFromEpicsDocument(input.content);
  const writes: PlanningArtifactWriteResult[] = [];
  const artifactSummary: PlanningArtifactSummaryItem[] = [];
  const conflicts: string[] = [];
  const storyPathsById = groupExistingStoryPathsById(input.existingPaths);

  for (const story of storySpecs) {
    const targetPath = buildProjectedStoryPath(story);
    const existingPathsForStory = storyPathsById.get(story.storyId) ?? [];

    if (
      existingPathsForStory.length > 0 &&
      !existingPathsForStory.includes(targetPath)
    ) {
      conflicts.push(
        `Story ${story.storyId} 已存在其他实现文件，已跳过自动覆盖：${existingPathsForStory.join("、")}`,
      );
      artifactSummary.push({
        path: targetPath,
        title: story.title,
        kind: "story-stub",
        summary: "检测到现有实现故事文件，已跳过自动覆盖。",
        sourceSkillKey: input.sourceSkillKey,
        status: "conflict",
        storyId: story.storyId,
        epicId: story.epicId,
      });
      continue;
    }

    const existing = await input.writer.readArtifact(targetPath);
    if (existing.exists && existing.content && !hasProjectionBlock(existing.content)) {
      conflicts.push(`Story ${story.storyId} 已存在且非自动投影文件，已跳过覆盖。`);
      artifactSummary.push({
        path: targetPath,
        title: story.title,
        kind: "story-stub",
        summary: "检测到开发者维护的故事文件，已跳过自动覆盖。",
        sourceSkillKey: input.sourceSkillKey,
        status: "conflict",
        storyId: story.storyId,
        epicId: story.epicId,
      });
      continue;
    }

    const content = existing.exists && existing.content
      ? replaceProjectionBlock(
          existing.content,
          buildProjectionBlock({
            epicNumber: story.epicId,
            storyNumber: story.storyId.split(".")[1] ?? "0",
            sourcePath: input.sourcePath,
            storyId: story.storyId,
          }),
        )
      : buildProjectedStoryStub(story, input.sourcePath);

    const write = await input.writer.writeArtifact({
      path: targetPath,
      content,
      summary: existing.exists ? "更新 Story 投影元数据" : "创建 Story 实现 stub",
    });

    writes.push(write);
    artifactSummary.push({
      path: targetPath,
      title: story.title,
      kind: "story-stub",
      summary: existing.exists ? "已保留现有故事内容并更新投影元数据。" : "已生成实现故事 stub。",
      sourceSkillKey: input.sourceSkillKey,
      status: existing.exists ? "updated" : "created",
      storyId: story.storyId,
      epicId: story.epicId,
    });
  }

  return { writes, artifactSummary, conflicts };
}

function extractStorySummary(storyBlock: string, title: string): string {
  const lines = storyBlock
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("### Story") && !line.startsWith("**验收标准"));

  const candidate = lines.find((line) => !/^\d+\./.test(line));
  return candidate?.replace(/^作为用户，?/, "").replace(/[。.]$/, "") ?? title;
}

function extractAcceptanceCriteria(storyBlock: string): string[] {
  const matches = storyBlock.match(/(?:^|\n)\d+\.\s+(.+)/g);
  if (!matches) {
    return [];
  }

  return matches.map((match) => match.replace(/(?:^|\n)\d+\.\s+/, "").trim());
}

function buildTaskSkeleton(acceptanceCriteria: string[]): string {
  return acceptanceCriteria
    .slice(0, 3)
    .map((criterion, index) => {
      const taskNumber = index + 1;
      return `- [ ] Task ${taskNumber}: 满足验收标准 ${taskNumber} (AC: #${taskNumber})
  - [ ] ${taskNumber}.1 落地与“${truncateText(criterion, 28)}”相关的主流程
  - [ ] ${taskNumber}.2 补充边界情况与验证`;
    })
    .join("\n");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildProjectedStoryPath(story: ProjectedStorySpec): string {
  const [epicNumber, storyNumber] = story.storyId.split(".");
  const slug = sanitizeStoryFileSegment(story.title);
  return `${BMAD_OUTPUT_DIR}/${BMAD_IMPLEMENTATION_DIR}/${epicNumber}-${storyNumber}-${slug}.md`;
}

function sanitizeStoryFileSegment(input: string): string {
  const sanitized = input
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return sanitized || "story";
}

function buildProjectionBlock(input: {
  epicNumber: string;
  storyNumber: string;
  sourcePath: string;
  storyId: string;
}): string {
  return `${STORY_PROJECTION_BLOCK_START}
sourcePath: ${input.sourcePath}
storyId: ${input.storyId}
epicNumber: ${input.epicNumber}
storyNumber: ${input.storyNumber}
status: planned
${STORY_PROJECTION_BLOCK_END}`;
}

function replaceProjectionBlock(content: string, nextBlock: string): string {
  if (!hasProjectionBlock(content)) {
    return `${content.trimEnd()}\n\n## Planning Projection Metadata\n\n${nextBlock}\n`;
  }

  return content.replace(
    new RegExp(
      `${escapeRegExp(STORY_PROJECTION_BLOCK_START)}[\\s\\S]*?${escapeRegExp(STORY_PROJECTION_BLOCK_END)}`,
      "m",
    ),
    nextBlock,
  );
}

function hasProjectionBlock(content: string): boolean {
  return (
    content.includes(STORY_PROJECTION_BLOCK_START)
    && content.includes(STORY_PROJECTION_BLOCK_END)
  );
}

function groupExistingStoryPathsById(existingPaths: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const existingPath of existingPaths) {
    const match = existingPath.match(STORY_FILE_PATTERN);
    if (!match) {
      continue;
    }

    const storyId = `${match[1]}.${match[2]}`;
    const current = map.get(storyId) ?? [];
    current.push(existingPath);
    map.set(storyId, current);
  }

  return map;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
