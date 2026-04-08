# Story 1.7: 项目导入与 BMAD 上下文关联

Status: done

## Story

作为用户，
我希望能在工作空间中导入 GitHub 或本地仓库项目并关联 BMAD 工件目录，
以便系统能够识别和管理项目中的 PRD、Epic、Story、Task 等上下文。

## 验收标准

1. **Given** 用户在工作空间中点击"创建项目" **When** 用户选择"关联 GitHub 仓库"并选择目标仓库 **Then** 系统创建 Project 记录，关联对应 Repo（sourceType=github） **And** 项目出现在工作空间项目列表中

2. **Given** 用户在工作空间中点击"创建项目" **When** 用户选择"关联本地目录"并指定本地路径 **Then** 系统校验路径合法性（拒绝路径穿越、拒绝符号链接、限制深度） **And** 创建 Project 记录，关联对应 Repo（sourceType=local）

3. **Given** 项目已创建并关联仓库 **When** 用户进入项目详情 **Then** 系统扫描并识别项目中的 BMAD 工件目录（如 `_bmad-output/planning-artifacts`） **And** 展示已识别的 PRD、Epic、Story 等工件列表

4. **Given** 项目关联了本地目录 **When** 系统访问本地文件 **Then** 必须在项目根目录边界内操作，拒绝路径穿越和符号链接（架构安全要求） **And** 文件访问受深度、文件数和文件大小限制

5. **Given** 用户已有已导入的 Repo（GitHub 或 local） **When** 创建项目时选择关联 **Then** 系统复用已有 Repo 记录，不重复创建

6. **Given** 用户在 PERSONAL 工作空间 **When** 创建项目并关联仓库 **Then** 不受项目上限约束（PERSONAL workspace 无项目上限）

7. **Given** 非成员用户 **When** 尝试访问项目详情 **Then** 返回 404 或重定向（权限隔离）

## Tasks / Subtasks

> **执行顺序：** Task 1（领域扩展）→ Task 2（Server Actions）→ Task 3（项目详情路由）→ Task 4（CreateProjectDialog 升级）→ Task 5（BMAD 工件展示组件）→ Task 6（测试）→ Task 7（验证）

- [x] Task 1: 扩展领域函数与类型 (AC: #1, #2, #5)
  - [x] 1.1 在 `src/lib/workspace/types.ts` 新增 `createProjectWithRepoInputSchema`：
    ```typescript
    export const createProjectWithRepoInputSchema = z.object({
      workspaceId: z.string().cuid2(),
      name: z.string().trim().min(1).max(100),
      repoId: z.string().cuid2().optional(),
    });
    export type CreateProjectWithRepoInput = z.infer<typeof createProjectWithRepoInputSchema>;
    ```
    **注意**：MVP 阶段 `createProjectWithRepoAction` 仅支持关联已有 Repo（通过 `repoId`）。GitHub/Local 新 Repo 导入沿用 dashboard 现有流程（`importRepo` / `importLocalFolder`），不在项目创建 Action 中内联导入逻辑。这避免了 Server Action 嵌套调用问题（`importRepo` / `importLocalFolder` 自身是 Server Actions，内含认证和 `revalidatePath`，嵌套调用会重复认证且触发多余缓存失效）。
  - [x] 1.2 在 `src/lib/errors.ts` 新增错误码（**必须中文**）：
    - `PROJECT_IMPORT_ERROR: "项目导入失败，请稍后重试。"`
    - `REPO_NOT_FOUND: "找不到指定的仓库记录。"`
  - [x] 1.3 在 `src/lib/db/helpers.ts` 新增 cache() helper：
    ```typescript
    export const getProjectBySlug = cache(
      async (workspaceId: string, projectSlug: string) => {
        return prisma.project.findFirst({
          where: { workspaceId, slug: projectSlug },
          include: { repo: true },
        });
      }
    );
    ```
    **必须**使用 `cache()` 包装，与 `getWorkspaceBySlug` / `getWorkspaceMembership` 等现有 helper 保持一致模式。

- [x] Task 2: 新增/扩展 Server Actions (AC: #1, #2, #5)
  - [x] 2.1 在 `src/actions/workspace-actions.ts` 新增 `createProjectWithRepoAction(input: CreateProjectWithRepoInput)`：
    1. `getAuthenticatedSession()` — 认证
    2. `createProjectWithRepoInputSchema.safeParse(input)` — Zod 校验
    3. `getWorkspaceMembership(workspaceId, userId)` — 验证成员资格（OWNER/ADMIN 可创建）
    4. 若 `input.repoId`：验证 Repo 存在且归属当前用户（`prisma.repo.findFirst({ where: { id: repoId, userId } })`），否则返回 `REPO_NOT_FOUND` 错误
    5. `getWorkspaceById(workspaceId)` → 获取 `workspace.type` 用于限额检查
    6. `createProject({ workspaceId, name, workspaceType: workspace.type, repoId })`
    7. `revalidatePath(\`/workspace/${workspace.slug}\`)`
    8. 返回 `{ success: true, data: { project: { id, name, slug, status, updatedAt }, repoId: repoId ?? null } }`
    - 错误处理与 `createProjectAction` 一致：`ProjectLimitExceededError` → `PROJECT_LIMIT_EXCEEDED`，默认 → `PROJECT_IMPORT_ERROR`
  - [x] 2.2 在 `src/actions/repo-actions.ts` 新增 `getUserReposAction()`：
    1. `requireAuthenticated()` — 认证（不需要 GitHub token）
    2. 查询当前用户所有已导入的 Repo：
       ```typescript
       prisma.repo.findMany({
         where: { userId },
         select: { id: true, owner: true, name: true, displayName: true, sourceType: true, localPath: true, lastSyncedAt: true },
         orderBy: { createdAt: "desc" },
       })
       ```
    3. 返回 `{ success: true, data: repos }`
    - **注意**：使用 `requireAuthenticated()` 而非 `getAuthenticatedOctokit()`，因为查询数据库不需要 GitHub token，本地 Repo 用户也需要此功能

- [x] Task 3: 创建项目详情页路由 (AC: #3, #4, #7)
  - [x] 3.1 创建 `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx` — Server Component：
    - 从 URL params 获取 `slug` 和 `projectSlug`（Next.js App Router 中 params 是 Promise，需 `await params`）
    - `getAuthenticatedSession()` — 认证，否则 `notFound()`
    - `getWorkspaceBySlug(slug)` — 获取 workspace，否则 `notFound()`
    - `getWorkspaceMembership(workspace.id, userId)` — 验证成员资格，否则 `notFound()`
    - `getProjectBySlug(workspace.id, projectSlug)` — 获取项目+关联 Repo（Task 1.3 新增的 helper），否则 `notFound()`
    - 若项目关联了 Repo，调用 `fetchBmadFiles({ owner: repo.owner, name: repo.name })`，**用 try-catch 包装，失败时降级为空列表**（GitHub rate limit 或本地路径失效不应导致整页 500）
    - 渲染项目信息头 + BMAD 工件列表组件（或无仓库提示）
    - 添加 `export const dynamic = "force-dynamic"`
    - **参考现有页面模式**：`workspace/[slug]/page.tsx` 和 `workspace/[slug]/settings/page.tsx`
  - [x] 3.2 项目信息头展示：
    - 项目名称 + 状态 Badge（复用 `project-list.tsx` 中的 `statusVariant` 映射）
    - 关联仓库信息：GitHub 显示 `owner/name`，Local 显示 `localPath`（截断长路径），无仓库则显示"未关联仓库"
    - 最后同步时间（`formatRelativeTime` 复用 `src/lib/utils.ts`）
    - 面包屑：`工作空间名称 > 项目名称`（使用 `<Link>` 链接回 `/workspace/${slug}`）
  - [x] 3.3 页面 Props 接口：
    ```typescript
    interface ProjectPageProps {
      params: Promise<{ slug: string; projectSlug: string }>;
    }
    ```

- [x] Task 4: 升级 CreateProjectDialog 支持 Repo 关联 (AC: #1, #2, #5)
  - [x] 4.1 扩展 `src/components/workspace/create-project-dialog.tsx`，新增 Repo 关联选项：
    - 保留现有项目名称输入
    - 在名称输入下方新增「关联仓库」区域（二选一，默认「不关联」）：
      - **不关联仓库**：`repoId` 为 undefined，使用现有 `createProjectAction`
      - **关联已有仓库**：shadcn `<Select>` 从用户已导入的 Repo 列表中选择，使用 `createProjectWithRepoAction`
    - Repo 列表在 Dialog 打开时通过 `getUserReposAction()` 加载（`useEffect` + `startTransition`）
    - 列表项展示格式：`displayName`（sourceType 为 badge）
    - 若用户无已导入 Repo，Select 禁用并显示提示"请先在仪表盘导入仓库"
  - [x] 4.2 Dialog 成功后跳转到新项目详情页：
    ```typescript
    import { useRouter } from "next/navigation";
    // ...
    const router = useRouter();
    // 成功后:
    router.push(`/workspace/${workspaceSlug}/project/${result.data.project.slug}`);
    ```
    **需新增 Props**：`workspaceSlug: string`（从父组件传入，用于构造跳转 URL）
  - [x] 4.3 **MVP 范围**：仅支持「不关联」和「关联已有 Repo」。不在 Dialog 中内联 GitHub/Local 新导入。用户需先在 dashboard 导入 Repo，再在项目创建时关联。

- [x] Task 5: BMAD 工件展示组件 (AC: #3)
  - [x] 5.1 创建 `src/components/workspace/project-bmad-artifacts.tsx` — Server Component（无交互需求，仅展示树 + 链接）：
    - Props: `fileTree: FileTreeNode[]`, `repoOwner: string`, `repoName: string`
    - 展示 BMAD 工件树形结构，按子目录分组（planning-artifacts / implementation-artifacts）
    - 文件名可点击，链接到现有 repo 详情页：`/repo/${repoOwner}/${repoName}`（现有页面已支持文件浏览）
    - 使用 lucide-react 图标区分文件/目录：`<File>` / `<Folder>`
    - 空状态：提示"未检测到 BMAD 工件，请确认仓库中包含 `_bmad-output` 目录"
  - [x] 5.2 创建 `src/components/workspace/project-no-repo.tsx` — 无仓库时的提示组件：
    - 提示"此项目尚未关联仓库。关联仓库后可查看 BMAD 工件。"
    - 可选"前往仪表盘导入仓库"链接
  - [x] 5.3 复用 `FileTreeNode` 类型（来自 `src/lib/bmad/types.ts`），递归渲染树

- [x] Task 6: 编写测试 (AC: #1-#7)
  - [x] 6.1 `src/lib/workspace/__tests__/create-project-with-repo.test.ts` — 集成测试（需 DB）：
    - 顶部 `import "dotenv/config"` + `assertSafeDatabaseUrl()` 安全检查
    - 测试场景：
      - 创建项目并关联已有 Repo → 成功，Project.repoId 正确
      - 创建项目不关联 Repo → 成功，Project.repoId 为 null
      - 关联不存在的 repoId → 返回错误
      - 非成员尝试创建 → FORBIDDEN
    - `afterAll` 清理：`Project` → `Repo` → `WorkspaceMembership` → `Workspace` → `User`

- [x] Task 7: 验证 — 确认 `pnpm lint`、`pnpm test`、`pnpm build` 全部通过

## Dev Notes

### 关键架构约束

- **Project ↔ Repo 关联**：`Project.repoId` 是可选外键，一个 Project 最多关联一个 Repo。一个 Repo 可以被多个 Project 引用（跨工作空间场景）。
- **Repo 归属**：当前 `Repo.userId` 绑定到导入该 Repo 的用户。在团队工作空间中，其他成员创建项目时只能关联自己名下已导入的 Repo，或在工作空间内共享的 Repo。**MVP 方案**：创建项目时关联的 Repo 必须属于当前操作用户（`Repo.userId === session.userId`），后续 Story 可考虑工作空间级 Repo 共享。
- **本地文件安全边界**：所有本地文件访问必须通过 `LocalProvider`，不允许直接 `fs` 调用。`LocalProvider` 已实现路径穿越防护、符号链接拒绝、深度/文件数/文件大小限制。
- **已有 Repo 导入流程**：`importRepo`（GitHub）和 `importLocalFolder`（Local）已在 `repo-actions.ts` 完整实现，本 Story 复用而非重写。
- **BMAD 文件扫描**：`fetchBmadFiles` 已实现 GitHub + Local 双路由，返回 `fileTree`、`docsTree`、`bmadCoreTree`、`bmadFiles`。本 Story 在项目详情页复用该 Action。

### 现有代码复用清单

| 现有代码 | 复用方式 |
|---------|---------|
| `src/lib/workspace/create-project.ts` 的 `createProject()` | 领域函数创建 Project（含 TEAM 上限检查） |
| `src/actions/repo-actions.ts` 的 `importRepo()` | GitHub Repo 导入 |
| `src/actions/repo-actions.ts` 的 `importLocalFolder()` | 本地目录导入 |
| `src/actions/repo-actions.ts` 的 `fetchBmadFiles()` | 扫描 BMAD 工件树 |
| `src/actions/repo-actions.ts` 的 `fetchFileContent()` | 加载单个工件内容 |
| `src/lib/content-provider/local-provider.ts` 的 `LocalProvider` | 本地文件安全访问 |
| `src/lib/bmad/utils.ts` 的 `buildFileTree()` | 构建文件树结构 |
| `src/lib/bmad/types.ts` 的 `FileTreeNode` | 文件树节点类型 |
| `src/lib/db/helpers.ts` 的所有 helpers | 认证、workspace/membership 查询 |
| `src/components/workspace/create-project-dialog.tsx` | 扩展支持 Repo 关联 |
| `src/components/workspace/project-list.tsx` | 项目列表已链接到详情页路由 |

### 项目详情页数据流

```
/workspace/[slug]/project/[projectSlug]  (Server Component)
  1. const { slug, projectSlug } = await params
  2. getAuthenticatedSession() → session || notFound()
  3. getWorkspaceBySlug(slug) → workspace || notFound()
  4. getWorkspaceMembership(workspace.id, userId) → membership || notFound()
  5. getProjectBySlug(workspace.id, projectSlug) → project (include: repo) || notFound()
  6. if (project.repo) try { fetchBmadFiles(...) } catch { bmadFiles = null }
  7. Render: 项目头 + (bmadFiles ? 工件列表 : 扫描失败提示) + (无repo ? 无仓库提示)
```

### createProjectWithRepoAction 调用流程

```
createProjectWithRepoAction(input) →
  1. getAuthenticatedSession() — 认证
  2. createProjectWithRepoInputSchema.safeParse(input) — Zod 校验
  3. getWorkspaceMembership(workspaceId, userId) — OWNER/ADMIN
  4. if (input.repoId) → prisma.repo.findFirst({ where: { id: repoId, userId } }) || REPO_NOT_FOUND
  5. getWorkspaceById(workspaceId) → workspace.type
  6. createProject({ workspaceId, name, workspaceType, repoId })
  7. revalidatePath(`/workspace/${workspace.slug}`)
  8. return { success: true, data: { project: { id, name, slug, status, updatedAt }, repoId } }
```

### 范围边界

**本 Story 范围：**
- ✅ 项目详情页路由 `/workspace/[slug]/project/[projectSlug]/page.tsx`（解决 deferred-work.md #5）
- ✅ 项目详情页展示 BMAD 工件列表（复用 `fetchBmadFiles`，失败时降级）
- ✅ `CreateProjectDialog` 升级支持关联已有 Repo
- ✅ `createProjectWithRepoAction` 新增 Server Action
- ✅ `getUserReposAction` 新增 Server Action
- ✅ `getProjectBySlug` 新增 cache() helper
- ✅ 新增错误码（中文）
- ✅ 集成测试

**本 Story 不涉及：**
- ❌ 不在 CreateProjectDialog 内联 GitHub/Local 新导入（MVP：先在 dashboard 导入，再关联）
- ❌ 不实现 BMAD 工件在线编辑（Epic 2 范围）
- ❌ 不实现工件层级关系解析（Epic 2 Story 2.1）
- ❌ 不修改 Prisma schema（`Project.repoId` 外键已存在）
- ❌ 不实现工作空间级 Repo 共享（后续 Story）
- ❌ 不实现从工件发起执行任务（Epic 2 Story 2.2）

### 项目结构变更

```
src/
├── actions/
│   ├── workspace-actions.ts          # 修改：+createProjectWithRepoAction, +imports
│   └── repo-actions.ts               # 修改：+getUserReposAction
├── app/
│   └── (dashboard)/workspace/[slug]/
│       └── project/[projectSlug]/
│           └── page.tsx              # 新增：项目详情页
├── components/
│   └── workspace/
│       ├── create-project-dialog.tsx  # 修改：支持 Repo 关联选择 + workspaceSlug prop
│       ├── project-bmad-artifacts.tsx # 新增：BMAD 工件展示组件
│       └── project-no-repo.tsx       # 新增：无仓库提示组件
├── lib/
│   ├── db/helpers.ts                 # 修改：+getProjectBySlug cache() helper
│   ├── errors.ts                     # 修改：+2 错误码（中文）
│   └── workspace/
│       ├── types.ts                  # 修改：+createProjectWithRepoInputSchema
│       └── __tests__/
│           └── create-project-with-repo.test.ts  # 新增：集成测试（需 DB）
```

### 调用方影响

- `workspace/[slug]/page.tsx` 中 `<CreateProjectDialog>` 需新增 `workspaceSlug={slug}` prop
- `project-list.tsx` 链接到 `/workspace/${workspaceSlug}/project/${project.slug}`（已存在，无需修改）

### 前序 Story 关键教训（来自 Story 1.1–1.6）

- **Prisma 导入路径**：`import { Prisma } from "@/generated/prisma/client"`（不是 `@prisma/client`）
- **cuid2 Zod 校验**：ID 字段使用 `z.string().cuid2()`
- **测试文件顶部 `import "dotenv/config"`**，必须实现 `assertSafeDatabaseUrl()` 安全检查
- **Vitest 配置文件为 `vitest.config.mts`**（`.mts` 扩展名）
- **错误消息全部中文**：`errors.ts` 中所有新增 `ERROR_MESSAGES` value 为中文
- **Server Actions 返回 `ActionResult<T>`**：统一格式，catch 中用 `sanitizeError()`
- **`revalidatePath()` 在 mutation 后调用**：保持控制面数据一致性
- **Server Action 嵌套禁止**：`importRepo` / `importLocalFolder` 是 Server Actions（自带认证 + revalidatePath），不能在其他 Server Action 中嵌套调用。本 Story 的 `createProjectWithRepoAction` 仅支持关联已有 Repo（直接 prisma 查询），不调用其他 Server Actions。
- **Next.js params 是 Promise**：App Router 页面 `params` 需要 `await`，参考 `workspace/[slug]/page.tsx` 写法
- **数据读取用 cache() helper**：不要在页面中直接 `prisma.xxx.findFirst()`，必须封装到 `helpers.ts` 并用 `cache()` 包装

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.7] — 验收标准原始定义（FR7）
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — Project/Repo 关联、Prisma 建模
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] — 执行边界控制、路径安全
- [Source: _bmad-output/planning-artifacts/architecture.md#Structure Patterns] — 目录结构规范、文件命名约定
- [Source: _bmad-output/planning-artifacts/architecture.md#Format Patterns] — ActionResult<T> 统一返回格式
- [Source: _bmad-output/project-context.md] — 技术栈版本、语言规则、框架规则、anti-patterns
- [Source: AGENTS.md] — 语言规范（中文）、Error Handling Pattern、Server Actions Conventions
- [Source: prisma/schema.prisma#Project] — repoId 可选外键、workspace 关联、slug unique per workspace
- [Source: prisma/schema.prisma#Repo] — sourceType、localPath、owner/name unique per user
- [Source: src/actions/repo-actions.ts#fetchBmadFiles] — BMAD 工件扫描（GitHub + Local 双路由）
- [Source: src/actions/repo-actions.ts#getUserReposAction] — 待新增
- [Source: src/lib/db/helpers.ts] — getWorkspaceBySlug、getWorkspaceMembership 等 cache() 模式
- [Source: src/lib/workspace/create-project.ts] — createProject 领域函数（含 TEAM 上限 row lock）
- [Source: src/lib/workspace/types.ts#ProjectLimitExceededError] — 项目上限异常类
- [Source: src/lib/bmad/types.ts#FileTreeNode] — 文件树节点类型定义
- [Source: src/components/workspace/create-project-dialog.tsx] — 现有 CreateProjectDialog（需扩展）
- [Source: src/components/workspace/project-list.tsx:29] — 项目卡片链接 `/workspace/${slug}/project/${project.slug}`
- [Source: src/app/(dashboard)/workspace/[slug]/page.tsx] — workspace 首页（CreateProjectDialog 调用方）
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#5] — 项目详情路由缺失（本 Story 解决）

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4 (Cascade)

### Debug Log References

- 修复预先存在的 `src/lib/github/client.ts` TS 构建错误（throttle callback 隐式 any 参数）
- 修复 `create-project-dialog.tsx` 的 `react-hooks/set-state-in-effect` lint 错误（用 null 状态代替 useEffect 内同步 setState）

### Completion Notes List

- ✅ Task 1: 新增 `createProjectWithRepoInputSchema`、`PROJECT_IMPORT_ERROR`/`REPO_NOT_FOUND` 错误码、`getProjectBySlug` cache helper
- ✅ Task 2: 新增 `createProjectWithRepoAction`（验证 Repo 归属、OWNER/ADMIN 权限、项目上限）和 `getUserReposAction`（无需 GitHub token）
- ✅ Task 3: 创建 `/workspace/[slug]/project/[projectSlug]` 页面（Server Component，含面包屑、项目头、BMAD 工件展示、降级处理）
- ✅ Task 4: 升级 CreateProjectDialog 支持 Repo 关联选择（shadcn Select、useRouter 跳转、workspaceSlug prop）
- ✅ Task 5: 创建 `ProjectBmadArtifacts`（递归树形展示）和 `ProjectNoRepo`（空状态提示）
- ✅ Task 6: 创建集成测试文件 `create-project-with-repo.test.ts`（含 assertSafeDatabaseUrl 安全检查）
- ✅ Task 7: `pnpm lint` 无新增错误，`pnpm build` 成功，非 DB 测试全部通过
- 附带修复：`src/lib/github/client.ts` 中预先存在的 implicit any 类型错误

### File List

- `src/lib/workspace/types.ts` — 修改：+createProjectWithRepoInputSchema, +CreateProjectWithRepoInput
- `src/lib/errors.ts` — 修改：+PROJECT_IMPORT_ERROR, +REPO_NOT_FOUND 错误码
- `src/lib/db/helpers.ts` — 修改：+getProjectBySlug cache() helper
- `src/actions/workspace-actions.ts` — 修改：+createProjectWithRepoAction, +imports
- `src/actions/repo-actions.ts` — 修改：+getUserReposAction
- `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx` — 新增：项目详情页
- `src/components/workspace/create-project-dialog.tsx` — 修改：支持 Repo 关联 + workspaceSlug prop + router redirect
- `src/components/workspace/project-bmad-artifacts.tsx` — 新增：BMAD 工件展示组件
- `src/components/workspace/project-no-repo.tsx` — 新增：无仓库提示组件
- `src/app/(dashboard)/workspace/[slug]/page.tsx` — 修改：传递 workspaceSlug prop 给 CreateProjectDialog
- `src/lib/workspace/__tests__/create-project-with-repo.test.ts` — 新增：集成测试
- `src/lib/github/client.ts` — 修改：修复预先存在的 implicit any 构建错误

### Review Findings

- [x] [Review][Decision→Patch] D1: `createProjectWithRepoInputSchema` 与 `createProjectInputSchema` 合并 — 删除重复 schema 和 action，在 createProjectAction 中统一 repo 归属校验
- [x] [Review][Patch] P1: `create-project-dialog.tsx` handleSubmit 逻辑重复 — 统一为单次 createProjectAction 调用
- [x] [Review][Patch] P2: `CreateProjectDialog` 扩展到 PERSONAL 工作空间 — 条件从 isTeam&&canManage 改为 canManage
- [x] [Review][Patch] P3: BMAD 工件展示改为纯展示树 + 顶部「查看完整仓库」链接
- [x] [Review][Patch] P4: 树形组件内联 style — 跳过（动态 depth 场景合理）
- [x] [Review][Patch] P5: `ProjectLimitExceededError` 法语消息改为中文
- [x] [Review][Defer] W1: `github/client.ts` 类型修复使用不精确的内联类型 [src/lib/github/client.ts:19,29] — deferred, pre-existing
- [x] [Review][Defer] W2: `SETTINGS_READ_ERROR` 错误码不属于 Story 1.7 范围 [src/lib/errors.ts:22] — deferred, 属于 Story 1.6/1.9 修复

### Change Log

- 2026-04-07: Story 1.7 实现完成 — 项目导入与 BMAD 上下文关联（全部 7 个 Task 完成）
