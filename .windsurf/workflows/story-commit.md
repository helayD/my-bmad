---
description: 按 Story ID 分类暂存、提交并推送代码到远程仓库。使用方式：/story-commit 1.2 或 /story-commit（自动检测 done 状态的 Story）
---

# Story Commit — 按 Story 分类提交到远程仓库

**Goal:** 从 Story 规格文件的 File List 中提取变更文件清单，按 Story 粒度生成 Conventional Commit 并推送到远程仓库。

## 步骤

### 1. 确定目标 Story

- 如果用户在调用时提供了 Story ID（如 `1.2` 或 `1-2`），将其标准化为短横线格式 `X-Y`（如 `1-2`）。
- 如果未提供 Story ID，扫描 `_bmad-output/implementation-artifacts/sprint-status.yaml` 中 `development_status` 下状态为 `done` 但尚未提交（通过 `git status` 判断工作目录有未提交变更）的 Story。如果有多个，列出让用户选择；如果只有一个，确认后继续。
- 在 `_bmad-output/implementation-artifacts/` 目录下查找匹配 Story ID 前缀的 `.md` 文件（如 `1-2-*.md`）。
- 如果找不到 Story 文件，HALT 并报错。

### 2. 提取文件清单

- 读取 Story 文件，定位 `### File List` 段落。
- 解析出 **New files** 和 **Modified files** 两个列表中的所有文件路径。
- 同时也包含 Story 规格文件自身（`_bmad-output/implementation-artifacts/X-Y-*.md`）。
- 同时也包含 `_bmad-output/implementation-artifacts/sprint-status.yaml`（如果它有变更）。
- 同时也包含 `_bmad-output/implementation-artifacts/deferred-work.md`（如果它有变更）。

### 3. 验证文件状态

- 运行 `git status --short` 获取当前工作目录状态。
- 将 File List 中的文件与 git status 输出交叉比对：
  - **匹配的文件**：Story 声明且确实有变更（已修改、新增或未跟踪）— 这些将被提交。
  - **仅在 File List 中**：Story 声明但无变更（可能已在之前提交过）— 跳过，告知用户。
  - **仅在 git status 中**：有变更但不属于该 Story — 不纳入本次提交，告知用户这些文件将保留在工作目录中。
- 特殊处理：`pnpm-lock.yaml` 如果有变更，询问用户是否一起纳入本次提交。
- 如果没有任何匹配文件，HALT 并告知用户"该 Story 没有待提交的变更"。

### 4. 展示提交计划

向用户展示以下信息：

```
📦 Story X.Y 提交计划
━━━━━━━━━━━━━━━━━━━━━━
Story: X-Y-<story-title>
分支: <当前分支名>

将暂存并提交的文件 (<N> 个):
  A  src/lib/workspace/types.ts
  A  src/lib/workspace/ensure-personal-workspace.ts
  M  src/lib/db/helpers.ts
  ...

不纳入本次提交的变更 (<M> 个):
  M  some/other/file.ts  (不属于该 Story)
  ...

Commit message:
  feat(workspace): Story X.Y — <Story 标题>
```

**HALT** — 等待用户确认。用户可以：
- 确认执行
- 修改 commit message
- 排除某些文件
- 取消

### 5. 执行提交与推送

用户确认后，依次执行：

// turbo
1. `git add <file1> <file2> ...` — 只暂存属于该 Story 的文件（使用引号包裹含特殊字符的路径）

// turbo
2. `git status --short` — 确认暂存区内容正确

// turbo
3. `git commit -m "<commit-message>"` — 提交

// turbo
4. `git push` — 推送到远程

### 6. 完成报告

```
✅ Story X.Y 已提交并推送
━━━━━━━━━━━━━━━━━━━━━━━━
Commit: <sha> <commit-message>
Branch: <branch>
Files:  <N> changed (<A> additions, <M> modifications)
Remote: pushed to origin/<branch>
```

如果推送失败（如需要 pull），告知用户并提供建议命令。

## Commit Message 规则

- 格式遵循 Conventional Commits: `type(scope): Story X.Y — <Story 标题>`
- `type` 自动推断：
  - 新功能（Story 标题包含"创建"、"实现"、"新增"等）→ `feat`
  - 修复 → `fix`
  - 重构 → `refactor`
  - 模型/数据 → `feat`
  - 默认 → `feat`
- `scope` 从 Story 文件路径中主要变更目录推断（如 `workspace`、`auth`、`db`）
- Story 标题从 Story 文件的 `# Story X.Y: <标题>` 一级标题中提取

## 注意事项

- **绝不**自动提交用户未确认的文件
- 含括号的路径（如 `(dashboard)`）在 PowerShell 中必须用引号包裹
- 如果当前分支是 `main` 且有多人协作，建议用户先创建 feature 分支
- 中文文件名使用 `git add` 时需要注意编码，优先用引号包裹完整路径
