# Story 2.1: BMAD 工件层级模型与解析引擎

Status: ready-for-dev

## Story

作为平台开发者，
我希望建立 BmadArtifact 数据模型并实现工件解析引擎，能够从项目仓库中识别 PRD、Epic、Story、Task 等工件并维护它们之间的层级关系，
以便系统拥有结构化的工件上下文作为后续执行与追踪的基础。

## 验收标准

1. **Given** 项目已关联仓库（GitHub 或 Local） **When** 系统执行工件扫描 **Then** 解析引擎识别 `_bmad-output/planning-artifacts` 目录下的 PRD、Epic、Story 等 Markdown 文件 **And** 为每个工件创建 BmadArtifact 记录，包含 id、projectId、type（PRD/EPIC/STORY/TASK）、name、filePath、parentId、metadata（JSON）、createdAt、updatedAt **And** 工件之间的层级关系通过 parentId 正确建立（PRD → Epic → Story → Task）

2. **Given** 工件已解析入库 **When** 用户查看项目工件树 **Then** 展示 PRD → Epic → Story → Task 的层级结构（FR8） **And** 每个工件节点显示名称、类型和关联执行状态摘要

3. **Given** 项目仓库中的工件文件发生变更 **When** 用户手动触发重新扫描或系统检测到变更 **Then** 工件记录同步更新，新增工件被识别，已删除工件被标记

## Tasks / Subtasks

> **执行顺序：** Task 1（Prisma 模型）→ Task 2（工件类型与扫描引擎）→ Task 3（Server Actions）→ Task 4（工件树 UI）→ Task 5（重新扫描）→ Task 6（测试）→ Task 7（验证）

- [x] Task 1: 创建 BmadArtifact Prisma 模型与迁移 (AC: #1)
  - [x] 1.1 在 `prisma/schema.prisma` 新增 `ArtifactType` 枚举和 `BmadArtifact` 模型：
    ```prisma
    enum ArtifactType {
      PRD
      EPIC
      STORY
      TASK
    }

    model BmadArtifact {
      id         String       @id @default(cuid())
      projectId  String
      type       ArtifactType
      name       String
      filePath   String
      parentId   String?
      metadata   Json?
      status     String       @default("active")
      createdAt  DateTime     @default(now())
      updatedAt  DateTime     @updatedAt

      project    Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
      parent     BmadArtifact?  @relation("ArtifactHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
      children   BmadArtifact[] @relation("ArtifactHierarchy")

      @@unique([projectId, filePath])
      @@index([projectId])
      @@index([parentId])
      @@index([projectId, type])
      @@map("bmad_artifacts")
    }
    ```
  - [x] 1.2 在 `Project` 模型中新增反向关联：`artifacts BmadArtifact[]`
  - [x] 1.3 运行 `pnpm prisma migrate dev --name add_bmad_artifact_model`
  - [x] 1.4 运行 `pnpm prisma generate` 确认类型生成到 `src/generated/prisma`
  - [x] 1.5 **导入路径验证**：确认 `import { ArtifactType, BmadArtifact } from "@/generated/prisma/client"` 可正常工作

- [x] Task 2: 创建工件扫描与解析引擎 — `src/lib/artifacts/` (AC: #1)
  - [x] 2.1 创建 `src/lib/artifacts/types.ts` — 工件扫描相关类型：
    ```typescript
    export interface ScannedArtifact {
      type: "PRD" | "EPIC" | "STORY" | "TASK";
      name: string;
      filePath: string;
      metadata: Record<string, unknown>;
      epicId?: string;     // 用于 Story → Epic 关联
      storyId?: string;    // 用于 Task → Story 关联
    }

    export interface ScanResult {
      artifacts: ScannedArtifact[];
      errors: { file: string; error: string }[];
    }

    export interface SyncReport {
      created: number;
      updated: number;
      deleted: number;
      errors: string[];
    }
    ```
  - [x] 2.2 创建 `src/lib/artifacts/scanner.ts` — 核心扫描引擎：
    - `scanProjectArtifacts(provider: ContentProvider): Promise<ScanResult>`
    - **复用**现有 `ContentProvider` 接口（`getTree()` + `getFileContent()`），兼容 github 和 local 两类仓库
    - **复用**现有 `detectBmadOutputDir()` 和 `BMAD_PLANNING_DIR` / `BMAD_IMPLEMENTATION_DIR` 常量（从 `@/lib/bmad/utils` 导入）
    - 扫描逻辑：
      1. 调用 `provider.getTree()` 获取文件列表
      2. 使用 `detectBmadOutputDir(paths)` 确定 BMAD 输出目录
      3. 在 `{bmadOutput}/planning-artifacts/` 下识别：
         - PRD 文件：匹配 `*prd*.md`（排除目录）
         - Epic 文件：匹配 `epics.md` 或 `epics/` 目录下的单文件
         - Story 文件：在 `{bmadOutput}/implementation-artifacts/` 下匹配 `\d+-\d+-.+\.md`
      4. 对每个文件调用 `provider.getFileContent()` 获取内容
      5. 使用已有解析器提取元数据：
         - PRD：使用 `gray-matter` 解析 frontmatter，提取 title/status
         - Epic：**复用** `parseEpics()` 或 `parseEpicFile()` （从 `@/lib/bmad/parse-epics` 和 `@/lib/bmad/parse-epic-file` 导入）
         - Story：**复用** `parseStory()`（从 `@/lib/bmad/parse-story` 导入）
      6. 构建 `ScannedArtifact[]` 并推断层级关系
    - **层级推断规则**：
      - PRD 是顶层，parentId = null
      - Epic 的 parentId 指向同项目的 PRD（如果存在）
      - Story 通过 `epicId` 映射（从文件名 `{epicNum}-{storyNum}-xxx.md` 提取）到对应 Epic
      - Task 通过 `storyId` 映射到对应 Story（MVP 阶段 Task 主要从 Story 的 checkbox 子项提取，暂不独立扫描文件）
    - **⚠️ 不要重新实现解析逻辑**：`src/lib/bmad/` 下已有完整的 epic/story 解析器，必须复用
  - [x] 2.3 创建 `src/lib/artifacts/sync.ts` — 将扫描结果同步到数据库：
    - `syncArtifacts(projectId: string, scanResult: ScanResult): Promise<SyncReport>`
    - 逻辑：
      1. 查询数据库中 `projectId` 的所有现有 BmadArtifact（`prisma.bmadArtifact.findMany({ where: { projectId } })`）
      2. 对比扫描结果与数据库记录（以 `filePath` 为匹配键）
      3. 新增：扫描到但数据库不存在 → `prisma.bmadArtifact.create()`
      4. 更新：扫描到且数据库已存在 → `prisma.bmadArtifact.update()` 更新 name/metadata/parentId
      5. 标记删除：数据库存在但扫描未发现 → 更新 `status = "deleted"`（软删除，不物理删除）
      6. 建立 parentId 关联：先创建所有记录，再在第二轮中根据层级推断规则更新 parentId
    - 返回 `SyncReport`（已在 types.ts 中定义）
    - **事务**：使用 `prisma.$transaction([...])` 批量操作（非交互事务，用操作数组）
    - **空扫描保护**：如果 `scanResult.artifacts` 为空且 `scanResult.errors` 不为空，不执行软删除（避免扫描失败时误删所有记录）

- [x] Task 3: 创建 Server Actions (AC: #1, #2)
  - [x] 3.1 创建 `src/actions/artifact-actions.ts`：
    - **文件顶部添加 `"use server";`**
    - **Zod 入参校验**：所有 Action 必须在入口处用 Zod 校验 `workspaceId` 和 `projectId`：
      ```typescript
      const schema = z.object({
        workspaceId: z.string().cuid2(),
        projectId: z.string().cuid2(),
      });
      ```
    - `scanProjectArtifactsAction(workspaceId: string, projectId: string): Promise<ActionResult<SyncReport>>`
      1. Zod 校验入参
      2. `getAuthenticatedSession()` 获取 userId
      3. `requireProjectAccess(workspaceId, projectId, userId, 'execute')` — 需要执行权限
      4. 从 `Project` 获取关联的 `Repo`（含 `include: { repo: true }`）
      5. 根据 `repo.sourceType` 创建对应 `ContentProvider`：
         - Local：`new LocalProvider(repo.localPath)` 后调用 `validateRoot()`
         - GitHub：参考 `repo-actions.ts` 中的 `getAuthenticatedOctokit()` 模式——调用 `getGitHubToken(userId)` + `createUserOctokit(token)` 创建 octokit，再 `new GitHubProvider(octokit, userId, owner, name, branch)`
      6. 调用 `scanProjectArtifacts(provider)` 获取扫描结果
      7. 调用 `syncArtifacts(projectId, scanResult)` 同步到数据库
      8. `revalidatePath()` 刷新项目详情页缓存
      9. 返回 `ActionResult<SyncReport>`
    - `getProjectArtifactTreeAction(workspaceId: string, projectId: string): Promise<ActionResult<ArtifactTreeNode[]>>`
      1. `requireProjectAccess(workspaceId, projectId, userId, 'read')`
      2. 查询 `prisma.bmadArtifact.findMany({ where: { projectId, status: "active" }, orderBy: [{ type: 'asc' }, { name: 'asc' }] })`
      3. 将平铺列表组装为树形结构（按 parentId 关联）
      4. 返回 `ActionResult<ArtifactTreeNode[]>`
  - [x] 3.2 在 `src/lib/errors.ts` 新增错误码（**必须中文**）：
    - `ARTIFACT_SCAN_ERROR: "工件扫描失败，请检查仓库连接后重试。"`
    - `ARTIFACT_SYNC_ERROR: "工件同步失败，请稍后重试。"`
    - `ARTIFACT_NOT_FOUND: "找不到指定的工件记录。"`
    - `REPO_NOT_LINKED: "项目未关联仓库，无法执行工件扫描。"`
  - [x] 3.3 定义 `ArtifactTreeNode` 类型（在 `src/lib/artifacts/types.ts`）：
    ```typescript
    export interface ArtifactTreeNode {
      id: string;
      type: "PRD" | "EPIC" | "STORY" | "TASK";
      name: string;
      filePath: string;
      metadata: Record<string, unknown> | null;
      children: ArtifactTreeNode[];
    }
    ```
  - [x] 3.4 在 `src/lib/db/helpers.ts` 新增 cache() 包装的查询函数：
    - `getProjectArtifacts(projectId: string)` — 获取项目所有活跃工件
    - `getArtifactById(artifactId: string)` — 获取单个工件详情

- [x] Task 4: 创建工件树 UI 组件 (AC: #2)
  - [x] 4.1 创建 `src/components/artifacts/artifact-tree.tsx` — 工件树展示组件：
    - 接收 `ArtifactTreeNode[]` 作为 props
    - 递归渲染 PRD → Epic → Story → Task 层级结构
    - 每个节点显示：类型图标（Lucide icons）、名称、状态 badge
    - 支持展开/折叠子节点
    - 空状态：展示引导提示"暂无工件，请先扫描仓库"（UX-DR26）
    - **⚠️ 此为客户端组件**（需要展开/折叠交互状态）：添加 `"use client"` 指令
  - [x] 4.2 创建 `src/components/artifacts/scan-button.tsx` — 扫描触发按钮：
    - 调用 `scanProjectArtifactsAction`
    - 使用 `useTransition` + `startTransition` 管理加载状态（项目现有模式）
    - Toast 反馈使用 `sonner` 库（已在 `layout.tsx` 挂载 `<Toaster richColors position="top-right" />`）：
      ```typescript
      import { toast } from "sonner";
      // 成功：toast.success("扫描完成：新增 N 个，更新 N 个，移除 N 个")
      // 失败：toast.error(result.error)
      ```
    - **⚠️ 客户端组件**
  - [x] 4.3 集成到项目详情页 `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx`：
    - 现有页面结构：`guardWorkspacePage(slug)` → `getProjectBySlug()` → 条件渲染（有 repo 时显示 `ProjectBmadArtifacts`，无 repo 时显示 `ProjectNoRepo`）
    - 在现有 `<ProjectBmadArtifacts>` 组件下方新增“结构化工件树”区域，包裹在同一个 `project.repo` 条件分支内
    - Server Component 中调用 `getProjectArtifacts(project.id)` 加载工件数据
    - 将平铺列表组装为树形后传给 `ArtifactTree` 组件（树形组装可提取为 `buildArtifactTree()` 工具函数，放在 `src/lib/artifacts/utils.ts`）
    - `ScanButton` 需接收 `workspaceId` 和 `projectId` props
    - **注意**：不替换现有的 `project-bmad-artifacts.tsx`（它展示的是文件级内容，新组件展示结构化层级）

- [x] Task 5: 实现重新扫描与增量同步 (AC: #3)
  - [x] 5.1 在 `scanProjectArtifactsAction` 中已包含增量同步逻辑（Task 2.3 的 `syncArtifacts` 天然支持）
  - [x] 5.2 在 `ScanButton` 组件中：扫描完成后调用 `router.refresh()` 刷新页面数据
  - [x] 5.3 在 `SyncReport` 中包含变更统计，toast 中展示："扫描完成：新增 N 个，更新 N 个，移除 N 个"

- [x] Task 6: 编写测试 (AC: #1-#3)
  - [x] 6.1 `src/lib/artifacts/__tests__/scanner.test.ts` — 扫描引擎单元测试：
    - Mock `ContentProvider` — 提供模拟的文件列表和内容
    - 测试 PRD 文件识别
    - 测试 Epic 文件识别（单文件和分片目录两种格式）
    - 测试 Story 文件识别（`\d+-\d+-.+\.md` 模式）
    - 测试层级关系推断（Story → Epic → PRD）
    - 测试空仓库场景
    - 测试格式异常文件（不崩溃，记录错误）
  - [x] 6.2 `src/lib/artifacts/__tests__/sync.test.ts` — 同步逻辑单元测试：
    - Mock `prisma` — 模拟数据库操作
    - 测试首次扫描（全新增）
    - 测试重新扫描（新增+更新+软删除）
    - 测试 parentId 关联建立
    - 测试空扫描结果不删除所有记录（防护逻辑）
  - [x] 6.3 `src/lib/artifacts/__tests__/artifact-tree.test.ts` — 树形组装逻辑测试：
    - 测试平铺列表到树形结构的转换
    - 测试孤儿节点处理（parentId 指向不存在的记录）
    - 测试空列表
  - [x] 6.4 测试文件使用 Vitest mock，**不需要** `import "dotenv/config"` 或真实数据库连接（纯逻辑 mock 测试）

- [x] Task 7: 验证 — 确认 `pnpm lint`、`pnpm test`、`pnpm build` 全部通过

## Dev Notes

### 关键架构约束

- **复用 ContentProvider**：工件扫描必须通过 `ContentProvider` 接口访问文件，同时兼容 `github` 和 `local` 两类 `sourceType`。不要绕过 provider 直接读取文件系统或调用 GitHub API。
- **复用现有解析器**：`src/lib/bmad/` 下已有完整的 Markdown 解析器（`parseEpics`、`parseEpicFile`、`parseStory`、`parseSprintStatus`），以及工具函数（`detectBmadOutputDir`、`normalizeStoryStatus`、`BMAD_PLANNING_DIR`、`BMAD_IMPLEMENTATION_DIR`）。扫描引擎必须复用这些代码，**不要重新实现同类解析逻辑**。
- **数据隔离**：所有 BmadArtifact 查询必须包含 `projectId` 过滤。通过 `requireProjectAccess()` 在 Action 层保证 workspace 级权限（从 `@/lib/workspace/permissions` 导入，Story 1.8 已建立）。
- **ActionResult<T>**：所有 Server Actions 统一返回 `ActionResult<T>`，catch 中使用 `sanitizeError()`。
- **错误消息中文**：所有用户可见错误使用中文，新增错误码的 `ERROR_MESSAGES` value 必须为中文。
- **Prisma 导入路径**：`import { ArtifactType, BmadArtifact } from "@/generated/prisma/client"`（不是 `@prisma/client`）。
- **ID 校验**：使用 `z.string().cuid2()` 校验所有 ID 参数。
- **缓存失效**：mutation 后调用 `revalidatePath()` 保持 UI 一致。
- **MVP 范围 Task 工件**：MVP 阶段 Task 级工件主要从 Story 的 checkbox 提取，不独立扫描 Task 文件。如扫描中发现独立 Task 文件，可记录但不强制要求。

### 现有代码复用清单

| 现有代码 | 复用方式 |
|---------|---------|
| `src/lib/content-provider/types.ts` — `ContentProvider` 接口 | 扫描引擎的文件访问抽象 |
| `src/lib/content-provider/github-provider.ts` | GitHub 仓库文件访问 |
| `src/lib/content-provider/local-provider.ts` | 本地目录文件访问 |
| `src/lib/bmad/utils.ts` — `detectBmadOutputDir`, `BMAD_PLANNING_DIR`, `BMAD_IMPLEMENTATION_DIR` | 目录路径检测 |
| `src/lib/bmad/parse-epics.ts` — `parseEpics()` | 从 epics.md 解析多个 Epic |
| `src/lib/bmad/parse-epic-file.ts` — `parseEpicFile()` | 解析单个 Epic 文件 |
| `src/lib/bmad/parse-story.ts` — `parseStory()` | 解析 Story Markdown |
| `src/lib/bmad/types.ts` — `Epic`, `StoryDetail`, `BmadFileMetadata` | 解析器返回类型 |
| `src/lib/workspace/permissions.ts` — `requireProjectAccess()` | Action 层权限检查 |
| `src/lib/workspace/page-guard.ts` — `guardWorkspacePage()` | 页面级权限检查 |
| `src/lib/db/helpers.ts` — `getAuthenticatedSession`, `getProjectBySlug` | 认证与项目查询 |
| `src/lib/db/client.ts` — `prisma` | 数据库客户端 |
| `src/lib/errors.ts` — `sanitizeError()` | 错误消息清洗 |
| `src/actions/repo-actions.ts` — `fetchBmadFiles` | 参考现有仓库内容获取模式（但本 Story 用 ContentProvider 而非直接调 action） |
| `src/actions/repo-actions.ts` — `getAuthenticatedOctokit()` 私有 helper | GitHub 认证模式：`getGitHubToken(userId)` + `createUserOctokit(token)` → `{ octokit, userId }` |
| `src/components/workspace/project-bmad-artifacts.tsx` | 现有工件展示组件（不替换，新增结构化视图） |

### ContentProvider 使用模式

现有项目中 `ContentProvider` 的创建方式（参考 `src/actions/repo-actions.ts` 和 `src/lib/content-provider/index.ts`）：

```typescript
import { createContentProvider } from "@/lib/content-provider";
import type { RepoConfig } from "@/lib/types";

// 根据 Repo 的 sourceType 创建 provider
// GitHub 仓库需要 octokit 和 userId 参数
// Local 仓库只需要 config（含 localPath）
const provider = createContentProvider(repoConfig, octokit, userId);

// 获取文件树
const tree = await provider.getTree();

// 获取单个文件内容
const content = await provider.getFileContent("path/to/file.md");
```

**⚠️ 注意**：`createContentProvider` 对 GitHub 仓库需要 `UserOctokit` 实例（从 `@/lib/github/client` 获取）和 `userId`。对 Local 仓库这两个参数可省略。现有 `repo-actions.ts` 中直接 `new LocalProvider(localPath)` 或 `new GitHubProvider(octokit, userId, ...)` 也是合法用法。

### 层级推断实现策略

```
文件路径 → 工件类型推断：
- *prd*.md                          → ArtifactType.PRD
- epics.md 或 epics/*.md 内的各 Epic → ArtifactType.EPIC
- {N}-{N}-*.md (implementation)      → ArtifactType.STORY

层级关联：
1. PRD → parentId = null（顶层）
2. Epic → parentId = PRD.id（如存在 PRD）
3. Story → parentId = Epic.id（通过文件名的 epicNum 匹配 Epic 的 id/metadata）

关联匹配键：
- Epic 匹配：ScannedArtifact.metadata.epicId == Epic 记录的 metadata.epicId
- Story 匹配：从文件名提取 epicNum，找 type=EPIC 且 metadata.epicId == epicNum 的记录
```

### Tenant Isolation 设计决策

架构文档要求“所有 Task、Agent Run、Session、Artifact 必须显式归属于 workspaceId 与 projectId”。`BmadArtifact` 模型仅包含 `projectId` 而不单独存储 `workspaceId`，因为：
- `Project.workspaceId` 已提供工作空间归属链路
- `requireProjectAccess(workspaceId, projectId, userId)` 在 Action 层已前置校验 workspace 成员资格（Story 1.8）
- 避免冗余字段带来的不一致风险
- 如需按 workspace 查询所有工件，可通过 `JOIN Project ON project.workspaceId = ?` 实现

### 与现有 `getBmadProject` 的关系

`src/lib/bmad/parser.ts` 中的 `getBmadProject()` 做的是**内存级解析**：从 ContentProvider 读取文件 → 解析为内存对象 → 返回 `BmadProject`。数据不入库。

本 Story 新增的 `scanProjectArtifacts()` + `syncArtifacts()` 做的是**持久化级解析**：复用相同的解析器，但将结果写入 `BmadArtifact` 表，建立 parentId 层级关联。这为后续 Story 2.2-2.5 的执行任务关联提供了数据库级的工件引用基础。

两者**不互斥**：`getBmadProject` 继续用于文件级浏览视图，`BmadArtifact` 表用于执行链路映射。

### 前序 Story 关键教训（来自 Story 1.1–1.8）

- **Prisma 导入路径**：`import { Prisma, ArtifactType } from "@/generated/prisma/client"`（不是 `@prisma/client`）
- **cuid2 Zod 校验**：ID 字段使用 `z.string().cuid2()`
- **Vitest 配置文件为 `vitest.config.mts`**（`.mts` 扩展名）
- **错误消息全部中文**：`errors.ts` 中所有新增 `ERROR_MESSAGES` value 为中文
- **Server Actions 返回 `ActionResult<T>`**：统一格式，catch 中用 `sanitizeError()`
- **`revalidatePath()` 在 mutation 后调用**：保持控制面数据一致性
- **Server Action 嵌套禁止**：不能在一个 Server Action 中调用另一个 Server Action
- **Next.js params 是 Promise**：App Router 页面 `params` 需要 `await`
- **数据读取用 cache() helper**：不要在页面中直接 `prisma.xxx.findFirst()`，封装到 `helpers.ts` 并用 `cache()` 包装
- **非成员访问返回 notFound() 而非 403**：避免泄露工作空间存在性
- **Server Action 中硬编码英文消息是已知技术债**（`"Not authenticated"` / `"Invalid input"` / `"Access denied"`），新增代码使用中文错误码
- **`scopedProjectQuery` / `getAccessibleWorkspaceIds` 在 `data-guard.ts` 中无调用方**（Story 1.8 预留，本 Story 可评估是否适用）

### 项目结构变更

```
prisma/
├── schema.prisma                    # 修改：+ArtifactType 枚举 +BmadArtifact 模型 +Project.artifacts 关联
└── migrations/
    └── xxx_add_bmad_artifact_model/ # 新增：迁移文件

src/
├── lib/
│   ├── artifacts/
│   │   ├── types.ts                 # 新增：ScannedArtifact, ScanResult, SyncReport, ArtifactTreeNode
│   │   ├── scanner.ts               # 新增：scanProjectArtifacts()
│   │   ├── sync.ts                  # 新增：syncArtifacts()
│   │   ├── utils.ts                 # 新增：buildArtifactTree() 平铺→树形转换
│   │   └── __tests__/
│   │       ├── scanner.test.ts      # 新增：扫描引擎测试
│   │       ├── sync.test.ts         # 新增：同步逻辑测试
│   │       └── artifact-tree.test.ts # 新增：树形组装测试
│   ├── db/
│   │   └── helpers.ts               # 修改：+getProjectArtifacts, +getArtifactById
│   └── errors.ts                    # 修改：+4 错误码
├── actions/
│   └── artifact-actions.ts          # 新增：scanProjectArtifactsAction, getProjectArtifactTreeAction
├── components/
│   └── artifacts/
│       ├── artifact-tree.tsx         # 新增：工件树展示组件
│       └── scan-button.tsx           # 新增：扫描触发按钮
└── app/
    └── (dashboard)/workspace/[slug]/project/[projectSlug]/
        └── page.tsx                  # 修改：集成工件树区域
```

### 范围边界

**本 Story 范围：**
- ✅ 创建 `BmadArtifact` Prisma 模型与数据库迁移
- ✅ 创建工件扫描引擎（复用现有 ContentProvider 和 BMAD 解析器）
- ✅ 创建工件同步逻辑（扫描结果 → 数据库 CRUD）
- ✅ 创建 Server Actions（权限检查 + 扫描触发 + 工件树查询）
- ✅ 创建工件树 UI 组件（层级展示 + 扫描按钮）
- ✅ 集成到项目详情页
- ✅ 新增错误码（中文）
- ✅ 单元测试

**本 Story 不涉及：**
- ❌ 不实现从工件发起执行任务（属 Story 2.2）
- ❌ 不实现执行任务与工件的追踪映射（属 Story 2.3）
- ❌ 不实现工件关联的执行历史视图（属 Story 2.4）
- ❌ 不实现执行结果回写到工件（属 Story 2.5）
- ❌ 不创建 Task/AgentRun/Session 等执行链路模型（属 Epic 4/5）
- ❌ 不实现自动检测仓库变更（MVP 仅手动触发扫描）
- ❌ 不修改现有的 `getBmadProject` 解析流程（两套并存，各自职责不同）

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1] — 验收标准原始定义（FR8）
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — PostgreSQL 事实源、Prisma 迁移策略、统一领域模型
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries] — `src/lib/artifacts/` 目录规划
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns] — 命名规范、结构模式、错误处理模式
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping] — Epic 2 映射到 `src/lib/artifacts/`, `src/components/artifacts/`
- [Source: _bmad-output/project-context.md] — 技术栈版本、语言规则、框架规则、ContentProvider 安全边界
- [Source: AGENTS.md] — 语言规范（中文）、Error Handling Pattern、Server Actions Conventions、Database Migrations
- [Source: prisma/schema.prisma] — 当前模型结构（Project 关联 Repo、Workspace 隔离）
- [Source: src/lib/bmad/parser.ts] — 现有 `getBmadProject()` 内存级解析流程
- [Source: src/lib/bmad/parse-epics.ts] — Epic 解析器（复用）
- [Source: src/lib/bmad/parse-epic-file.ts] — 单 Epic 文件解析器（复用）
- [Source: src/lib/bmad/parse-story.ts] — Story 解析器（复用）
- [Source: src/lib/bmad/types.ts] — 解析器类型定义
- [Source: src/lib/bmad/utils.ts] — BMAD 目录常量、`detectBmadOutputDir()`
- [Source: src/lib/content-provider/types.ts] — ContentProvider 接口定义
- [Source: src/lib/workspace/permissions.ts] — `requireProjectAccess()` 权限检查
- [Source: src/lib/workspace/page-guard.ts] — `guardWorkspacePage()` 页面守卫
- [Source: src/lib/errors.ts] — `sanitizeError()` 和现有错误码
- [Source: _bmad-output/implementation-artifacts/1-8-授权范围内任务可见性与数据隔离.md] — 前序 Story 教训、权限模式、数据隔离审计结果
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — 已知技术债（英文消息、法语消息、双源冗余）

## Dev Agent Record

### Agent Model Used

Cascade

### Debug Log References

- `pnpm test src/lib/artifacts/__tests__/scanner.test.ts src/lib/artifacts/__tests__/sync.test.ts src/lib/artifacts/__tests__/artifact-tree.test.ts`
- `pnpm lint`
- `pnpm build`
- `pnpm test`

### Completion Notes List

- ✅ 复核并完成 Story 2.1 全部任务，确认 Prisma 模型、扫描引擎、同步逻辑、Server Actions、工件树 UI 与项目页集成均已落地
- ✅ 补齐 `TASK` 工件提取与 `TASK -> STORY` 层级关联，满足验收标准中的 `PRD -> Epic -> Story -> Task` 结构要求
- ✅ 为扫描器与同步器新增回归测试，覆盖 Story checkbox 任务提取、任务层级父子关系与增量同步行为
- ✅ 为确保质量门禁通过，补充了 Vitest/ESLint 的必要配置并修正了既有测试中的过时断言
- ✅ `pnpm lint`、`pnpm test`、`pnpm build` 全部通过

### Change Log

- 2026-04-08：完成 Story 2.1 实施与验证，补齐 TASK 工件解析、层级同步、结构化工件树展示与质量门禁修复

### File List

- `prisma/schema.prisma`
- `prisma/migrations/20260408031402_add_bmad_artifact_model/migration.sql`
- `src/actions/artifact-actions.ts`
- `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx`
- `src/components/artifacts/artifact-tree.tsx`
- `src/components/artifacts/scan-button.tsx`
- `src/components/workspace/change-role-dialog.tsx`
- `src/lib/artifacts/types.ts`
- `src/lib/artifacts/scanner.ts`
- `src/lib/artifacts/sync.ts`
- `src/lib/artifacts/utils.ts`
- `src/lib/artifacts/__tests__/artifact-tree.test.ts`
- `src/lib/artifacts/__tests__/scanner.test.ts`
- `src/lib/artifacts/__tests__/sync.test.ts`
- `src/lib/db/helpers.ts`
- `src/lib/db/workspace-models.test.ts`
- `src/lib/errors.ts`
- `src/lib/workspace/__tests__/archive-project.test.ts`
- `src/lib/workspace/__tests__/remove-member.test.ts`
- `eslint.config.mjs`
- `vitest.config.mts`
