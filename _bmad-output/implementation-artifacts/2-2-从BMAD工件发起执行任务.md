# Story 2.2: 从 BMAD 工件发起执行任务
 
 Status: review
 
 ## Story
 
 作为用户，
我希望能从 PRD、Epic、Story 或 Task 上下文中直接发起执行任务，
以便将规划工件与实际编码执行无缝衔接。

## Acceptance Criteria

1. **Given** 用户查看某个 Story 工件详情 **When** 用户点击“发起执行”按钮 **Then** 系统预填任务上下文（关联的 Story 名称、内容摘要、所属 Epic） **And** 用户可以补充任务目标、优先级和执行意图后提交（UX-DR2 低摩擦发起） **And** 提交后立即看到当前阶段、系统正在做什么、下一步预计是什么（UX-DR2）

2. **Given** 用户从 Epic 级别发起执行 **When** 用户提交任务 **Then** 系统创建 Task 记录并关联到该 Epic 的 `BmadArtifact`

3. **Given** 用户从 PRD 级别发起执行 **When** 用户提交任务 **Then** 系统创建 Task 记录并关联到该 PRD 的 `BmadArtifact`

4. **Given** 任务已创建 **When** 查看任务详情 **Then** 可以看到该任务的来源工件引用（FR10）

 ## Tasks / Subtasks
 
 > **建议实现顺序：** Task 1（Task 领域模型） → Task 2（工件上下文与创建 Action） → Task 3（工件详情与发起执行 UI） → Task 4（任务详情最小视图） → Task 5（测试） → Task 6（验证）
 
 - [x] Task 1: 建立最小可用的 Task 领域模型与来源工件关联 (AC: #2, #3, #4)
   - [x] 1.1 在 `prisma/schema.prisma` 中新增 `Task` 相关模型；若仓库里已存在同名模型，只做扩展，不要创建平行模型。
   - [x] 1.2 为 Task 增加最小必需字段：`workspaceId`、`projectId`、`sourceArtifactId`、`title`、`goal`、`summary`、`priority`、`intent`、`status`、`currentStage`、`nextStep`、`createdByUserId`、`metadata`、时间戳。
   - [x] 1.3 为 `sourceArtifactId -> BmadArtifact.id` 建立可空外键与索引，并确保 Action 层校验 Task 与来源工件属于同一 `workspaceId/projectId`。
   - [x] 1.4 为 Task 建立反向关系与查询入口（至少包含 `Project`、`Workspace`、`User`、`BmadArtifact` 侧的必要关联）。
   - [x] 1.5 将 `status`、`priority`、`intent` 相关枚举或字面量联合类型集中定义在 `src/lib/tasks/`，避免页面、Action、测试各自硬编码一套字符串。
   - [x] 1.6 明确 Task 创建后的**初始状态真值**与**用户可见阶段文案**的默认值，并确保二者由同一领域层统一输出，不能由 UI 拼接。
   - [x] 1.7 运行 `pnpm prisma migrate dev --name add_task_from_artifact`。
   - [x] 1.8 运行 `pnpm prisma generate`，确认生成类型可从 `@/generated/prisma/client` 导入。

 - [x] Task 2: 建立“从工件生成任务上下文”的领域层与 Server Actions (AC: #1, #2, #3)
   - [x] 2.1 新增 `src/lib/tasks/` 领域模块；当前仓库尚无 `src/lib/tasks`，不要把任务逻辑散落在组件或页面中。
   - [x] 2.2 在 `src/lib/tasks/` 中定义统一类型，例如 `TaskCreationContext`、`TaskPriority`、`TaskIntent`、`TaskCreateInput`、`TaskSourceReference`。
   - [x] 2.3 复用 `BmadArtifact`、`ContentProvider` 与现有 BMAD 解析器生成预填上下文，不要重新实现 Markdown 解析：
     - Story 来源：优先复用 `parseStory()`，预填 Story 标题、描述摘要、所属 Epic、验收标准摘要。
     - Epic 来源：复用 `parseEpics()` / `parseEpicFile()` 或现有 metadata，预填 Epic 标题、描述摘要、故事编号集合。
     - PRD 来源：复用现有 PRD frontmatter / Markdown 标题与摘要提取逻辑。
     - Task 来源：代码路径要预留，但**不要假设当前数据里一定存在 TASK 工件记录**；当前扫描引擎尚未真正产出 Task 级工件。
     - **上下文构建优先级**：优先使用数据库中的 `BmadArtifact.metadata` 组装预填内容；仅在 metadata 不足时再通过 provider 读取原始文件，避免不必要的仓库访问与 Local/GitHub 双源分歧。
   - [x] 2.4 新增 `src/actions/task-actions.ts`，至少包含：
     - `getTaskCreationContextAction(workspaceId, projectId, artifactId)`
     - `createTaskFromArtifactAction(input)`
   - [x] 2.5 在 `src/lib/db/helpers.ts` 中补充 `cache()` 包装的查询 helper，至少包括 `getArtifactById()` 的复用与 `getTaskById()` 的新增；页面和组件不要直接散写 `prisma` 查询。
   - [x] 2.6 所有 Action 在入口处使用 Zod 4 校验，创建任务时使用 `getAuthenticatedSession()` 与 `requireProjectAccess(workspaceId, projectId, userId, "execute")`。
   - [x] 2.7 所有 Action 返回 `ActionResult<T>`；`catch` 中统一使用 `sanitizeError()`，所有错误消息必须为中文。
   - [x] 2.8 **不要在一个 Server Action 中调用另一个 Server Action**；共享逻辑下沉到 `src/lib/tasks/` 或 `src/lib/` helper，避免形成嵌套 Action 链。
   - [x] 2.9 如果创建任务需要再次读取仓库文件，请抽取共享的 provider 初始化 helper，避免复制 `src/actions/artifact-actions.ts` 中的 GitHub / Local provider 创建逻辑。
   - [x] 2.10 在 `src/lib/errors.ts` 中补充任务相关中文错误码，至少覆盖：来源工件不存在、工件上下文构建失败、任务创建失败、任务不存在、仓库上下文不可读取。
   - [x] 2.11 创建成功后返回最小立即反馈载荷：`taskId`、`status`、`currentStage`、`nextStep`、`sourceArtifact`。

 - [x] Task 3: 在现有工件浏览体验中加入“发起执行”入口与低摩擦表单 (AC: #1, #2, #3)
   - [x] 3.1 扩展 `src/components/artifacts/artifact-tree.tsx`：在保留展开/折叠能力的前提下，支持选中工件并打开详情面板，而不是只做静态树展示。
   - [x] 3.2 新增工件详情组件（建议放在 `src/components/artifacts/`，如 `artifact-detail-sheet.tsx` 或 `artifact-detail-panel.tsx`），展示工件标题、类型、状态、路径、摘要与来源层级。
   - [x] 3.3 Story 详情展示模式可复用 `src/components/epics/story-detail-view.tsx` 的信息组织方式；Markdown 内容展示复用 `src/components/docs/markdown-renderer.tsx`。
   - [x] 3.4 在 Story / Epic / PRD 详情中提供“发起执行”按钮；按钮点击后打开任务创建表单，而不是直接静默创建任务。
   - [x] 3.5 创建表单至少包含：任务目标、优先级、执行意图；表单默认预填工件上下文摘要，所有用户可见文案统一为中文。
   - [x] 3.6 客户端交互沿用项目已有模式：`useTransition`、`startTransition`、`sonner` 反馈、成功后刷新或跳转。
   - [x] 3.7 将入口集成到项目详情页现有“结构化工件树”区域，不替换当前的 `ProjectBmadArtifacts` 文件树视图。
   - [x] 3.8 提交后立即展示“当前阶段 / 系统正在做什么 / 下一步预计是什么”，不能只给一个模糊的“处理中”。

 - [x] Task 4: 建立任务详情的最小可用视图，显示来源工件引用 (AC: #4)
   - [x] 4.1 当前仓库没有现成的 `tasks` 路由、组件或领域目录；请新增任务详情承载位置，而不是把任务详情塞进无关页面。
   - [x] 4.2 优先采用项目级路由承载任务详情，例如 `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/tasks/[taskId]/page.tsx`，以匹配当前项目页的信息架构。
   - [x] 4.3 任务详情至少展示：任务标题、目标、优先级、执行意图、初始状态、当前阶段、下一步、创建时间、来源工件引用。
   - [x] 4.4 来源工件引用至少包含：工件类型、工件名称、层级路径（如 `PRD > Epic 2 > Story 2.2`）以及返回来源工件视图的入口。
   - [x] 4.5 任务详情页的数据读取应通过 `src/lib/db/helpers.ts` 的 helper 完成；对不存在、越权或跨项目的 `taskId` 返回 `notFound()`，避免泄露资源存在性。
   - [x] 4.6 本 Story 只要求最小可用的来源引用展示；反向执行历史列表、筛选、聚合统计属于 Story 2.3 / 2.4。

 - [x] Task 5: 补齐测试，覆盖上下文构建、权限与创建路径 (AC: #1, #2, #3, #4)
   - [x] 5.1 在 `src/lib/tasks/__tests__/` 下新增上下文构建测试，覆盖 Story / Epic / PRD 三类来源工件。
   - [x] 5.2 测试来源工件与 `workspaceId/projectId` 不匹配时的拒绝路径。
   - [x] 5.3 测试 Zod 校验失败、未登录、无执行权限、工件不存在、仓库不可读等错误分支。
   - [x] 5.4 测试任务创建后返回的 `status/currentStage/nextStep/sourceArtifact` 结构，避免 UI 依赖未定义字段。
   - [x] 5.5 测试当前没有 TASK 工件记录时，PRD / Epic / Story 路径仍然可以工作，且代码不会假设 TASK 一定存在。
   - [x] 5.6 测试文件使用 Vitest mock；不要依赖真实数据库、真实 GitHub API 或真实本地仓库。

 - [x] Task 6: 验证与回归检查
   - [x] 6.1 运行 `pnpm lint`。
   - [x] 6.2 运行 `pnpm test`。
   - [x] 6.3 运行 `pnpm build`。

 ## Dev Notes

### 当前基线与关键依赖

- 当前工作区里已经存在 Story 2.1 的基础设施代码：`prisma/schema.prisma`、`src/lib/artifacts/scanner.ts`、`src/lib/artifacts/sync.ts`、`src/actions/artifact-actions.ts`、`src/components/artifacts/artifact-tree.tsx`、`src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx`。本 Story 必须**扩展这些已有实现**，不要重建第二套工件领域。
- `sprint-status.yaml` 仍将 `2-1-BMAD工件层级模型与解析引擎` 标记为 `ready-for-dev`，但当前代码树已包含对应基础实现。开发 Story 2.2 时应以**当前代码状态**为准，同时避免假设 2.1 的所有配套测试和状态流转都已经完善。
- 当前仓库**还没有** `src/lib/tasks`、`src/actions/task-actions.ts`、`src/components/tasks/` 或任务详情页路由；这意味着任务领域需要在本 Story 中首次建立。
- `ArtifactTypeString` 虽然包含 `TASK`，但 `src/lib/artifacts/scanner.ts` 当前只稳定产出 PRD / EPIC / STORY 工件；不要误以为 Task 节点已经真实存在于数据库中。
- `parseStory()` 目前可以提供 `title`、`status`、`epicId`、`description`、`acceptanceCriteria`、`tasks`；`parseEpics()` / `parseEpicFile()` 可提供 Epic 标题、描述和 Story 引用。这些都是生成预填上下文的优先数据源。
- `src/lib/db/helpers.ts` 已经存在 `getProjectArtifacts()` 与 `getArtifactById()` 的查询模式；Task 领域应沿用同样的 `cache()` helper 方式，而不是在页面中直接写数据库访问。

### 实现护栏

- **不要重新造解析逻辑**：工件上下文提取必须复用 `src/lib/bmad/` 下现有解析器与类型，而不是在 `task-actions` 或 UI 里再手写一套 Markdown 解析。
- **不要跳过 metadata 直接读仓库**：能从 `BmadArtifact.metadata` 得到的信息先直接使用，只有 metadata 不足时才回退到 provider 读取原始内容。
- **不要复制 provider 初始化代码**：如果任务创建流程需要从仓库读取原始工件内容，应提取共享 helper，复用现有 GitHub / Local provider 组装方式。
- **不要在 Server Action 中调用另一个 Server Action**：共享逻辑必须下沉到领域层 helper，这一点是当前项目的既有约束。
- **不要在本 Story 中直接启动 tmux / agent / supervisor**：本 Story 的完成条件是“从工件创建 Task 并展示立即反馈”，不是实现真正的执行路由与运行态。
- **不要发明平行状态格式**：Task 的真实状态必须落在统一领域模型中；UI 展示的“当前阶段 / 下一步”应来自服务端返回字段，而不是客户端临时拼接。
- **不要把权限只放在客户端**：创建任务和查看任务详情都必须在服务端进行 `workspace/project` 范围校验。
- **不要把外部 API、Webhook、SSE 提前做进来**：这些属于后续任务编排与执行可视化能力，不应在本 Story 中扩散范围。

### 技术要求

- Server Actions 统一放在 `src/actions/`，入口先做 Zod 校验。
- 所有 Server Actions 返回 `ActionResult<T>`，失败分支统一使用 `sanitizeError()`。
- 所有用户可见文案、错误消息、按钮文本、状态说明统一使用中文。
- 导入路径使用 `@/` 别名，不要引入深层相对路径。
- 数据读取 helper 优先放入 `src/lib/db/helpers.ts` 并使用 `cache()` 包装，保持与当前项目查询模式一致。
- 变更型操作完成后调用 `revalidatePath()` 或 `revalidateTag()`，保持项目详情页与任务详情页状态一致。
- 与数据库相关的类型从 `@/generated/prisma/client` 导入，不要切回 `@prisma/client`。
- `workspaceId`、`projectId`、`artifactId`、`taskId` 等外部输入在 Action 层统一做 Zod 校验；已有项目约定优先使用 `cuid2()`。
- 本地仓库来源仍必须保留现有 provider 的路径安全边界：限制根目录、拒绝路径穿越、拒绝符号链接与越界访问。

### 错误码建议

- `TASK_CREATION_ERROR: "任务创建失败，请稍后重试。"`
- `TASK_NOT_FOUND: "找不到指定的任务记录。"`
- `ARTIFACT_CONTEXT_ERROR: "工件上下文构建失败，请检查工件内容后重试。"`
- `ARTIFACT_SOURCE_NOT_FOUND: "找不到指定的来源工件。"`
- `ARTIFACT_SOURCE_UNREADABLE: "来源工件无法读取，请检查仓库连接或本地目录配置。"`

### 架构一致性要求

- 架构文档要求 PostgreSQL 作为事实源，因此 Task 创建后必须落库，不要只在客户端缓存或 URL 中暂存“伪任务”。
- 对当前 Story，建议采用 **`Task.sourceArtifactId` 单来源关联** 满足最小可用追踪；不要在这里提前设计多对多映射或复杂追踪表。Story 2.3 可以在此基础上继续扩展反向查询与执行历史。
- 任务真实状态与用户可见阶段是两个层次：状态字段表达领域真值，`currentStage` / `nextStep` 表达对用户的即时反馈。
- Task、Artifact 的所有读取和写入都必须显式受 `workspaceId` 与 `projectId` 边界保护，不能出现跨项目读取来源工件的情况。
- 即使未来会引入 `AgentRun`、`Session`、`Writeback`，本 Story 也只建立到 `BmadArtifact` 的最小链路，不提前耦合未实现的执行子系统。

### 库与框架要求

- 当前项目固定技术栈：Next.js `16.1.6`、React `19.2.3`、TypeScript strict、Prisma `6.19.2`、Better Auth `1.4.18`、Tailwind CSS `4.2.2`、Vitest `4.0.18`、Zod `4.3.6`。
- 本 Story 不做 Prisma 大版本升级。架构文档已明确：Prisma 主线升级应作为独立演进任务，不与业务 Story 耦合。
- 继续沿用 `pnpm` 工作流与现有 App Router / Server-First 结构。

### 文件结构要求

- **扩展现有工件领域：**
  - `src/actions/artifact-actions.ts`
  - `src/components/artifacts/artifact-tree.tsx`
  - `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx`
- **新增任务领域：**
  - `src/actions/task-actions.ts`
  - `src/lib/tasks/`
  - `src/components/artifacts/` 下的工件详情 / 发起执行组件
  - `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/tasks/[taskId]/page.tsx`
  - `src/lib/db/helpers.ts` 中任务查询 helper（至少 `getTaskById()`）
  - `src/lib/errors.ts` 中与任务创建相关的中文错误码
- **不要替换** `src/components/workspace/project-bmad-artifacts.tsx`；它仍负责文件级 BMAD 浏览。

### 测试要求

- 测试框架使用 Vitest。
- 优先测试领域逻辑与 Action 边界，而不是依赖复杂 UI 集成环境。
- 对“工件不存在 / 非授权项目 / provider 失败 / 表单校验失败 / 返回结构缺字段”这些容易导致回归的问题必须有测试。
- 若新增状态枚举或上下文字段，测试需覆盖默认值与空值分支，避免 UI 因空字段崩溃。

### 前序 Story 情报

- Story 2.1 已经明确要求通过 `BmadArtifact` 建立 PRD → Epic → Story → Task 的结构化上下文；本 Story 应直接复用该层级，不要再引入第二种“来源对象”表示法。
- Story 2.1 已建立的代码路径表明：项目详情页已有“结构化工件树”入口，因此 Story 2.2 最自然的实施点就是在该区域加入详情与发起能力，而不是另起一套独立入口。
- Story 2.1 的现状也暴露出一个关键缺口：虽然树模型允许 `TASK` 类型，但扫描引擎并未真正产出 Task 工件。本 Story 必须显式处理这个现实约束。

### Git 实现模式情报

- 最近提交采用“按 Story 做纵切”的方式：同一个 Story 会同时更新 `src/actions`、`src/lib`、页面、组件、测试与 `_bmad-output/implementation-artifacts` 文档。
- 最近几个提交标题遵循 `feat(workspace): Story X.Y — 中文标题` 的 Conventional Commits 风格；后续实现可保持同类结构。
- 从最近提交涉及文件看，项目偏好把查询 helper、Action、页面与表单组件一起演进，而不是把全部逻辑堆到单一文件中。

### 最新技术信息

- 当前仓库已经固定在 Next.js 16 + React 19 + Prisma 6 + Zod 4 的组合；实现时应遵循仓库现有版本，不要因为网络上的“最新版本”建议而临时升级依赖。
- 架构文档明确要求内部 mutation 优先使用 Server Actions，外部触发 / 查询才使用版本化 Route Handlers；因此本 Story 内部入口应坚持 Server Actions。

### 范围边界

**本 Story 范围：**

- ✅ 从 PRD / Epic / Story 工件详情中发起 Task 创建
- ✅ 创建最小可用 Task 记录并关联 `sourceArtifactId`
- ✅ 展示任务创建后的立即反馈（当前阶段、正在做什么、下一步）
- ✅ 展示任务详情中的来源工件引用
- ✅ 建立任务领域的最小目录、Action、helper 与测试

**本 Story 不包含：**

- ❌ 不实现真实的 agent 路由、tmux 启动、执行监督器联动
- ❌ 不实现任务与来源工件的完整反向历史列表（Story 2.3）
- ❌ 不实现工件级执行历史聚合、筛选与产物查看（Story 2.4）
- ❌ 不实现执行结果回写到工件链路（Story 2.5）
- ❌ 不引入外部 API / Webhook / SSE / 审批流 / 自动恢复
- ❌ 不为“未来可能多来源工件”提前设计复杂追踪表

### Project Structure Notes

- 当前项目的信息架构以“工作空间 → 项目”作为主导航轴，因此任务详情优先挂在项目级路由下，比新增一个全局任务中心更符合现状。
- 工件文件树与结构化工件树当前并存；Story 2.2 应继续沿用这种双视图策略：文件视图负责浏览仓库内容，结构化视图负责发起执行和后续链路。
- 如果需要提取共享 helper，优先放在 `src/lib/` 的领域目录，而不是组件目录；组件应只负责展示与交互。
- Tailwind 继续遵循现有项目规则，不使用无必要的任意值类名。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2] — Story 2.2 原始用户故事与验收标准
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1] — 结构化工件基础设施与对本 Story 的前序依赖
- [Source: _bmad-output/planning-artifacts/prd.md#Project & BMAD Context Management] — FR9 / FR10 对“从工件发起任务”和“来源工件引用”的需求来源
- [Source: _bmad-output/planning-artifacts/prd.md#Execution Visibility & Progress Tracking] — 任务详情必须展示当前状态、阶段与最近活动的产品要求
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions] — PostgreSQL 事实源、统一领域模型、Server Actions 优先、状态机要求
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — Task 作为核心实体、缓存策略、迁移策略
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] — workspace / project 边界、权限分层、执行边界控制
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns] — 内部 mutation 使用 Server Actions，用户可见阶段信息来自服务端领域层
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Effortless Interactions] — 低摩擦发起、立即反馈“当前阶段 / 下一步”
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Critical Success Moments] — 发起后短时间内让用户感受到“系统已接单并开始推进”
- [Source: _bmad-output/project-context.md] — 技术栈版本、中文文案规则、ActionResult / sanitizeError / Zod / cache / provider 安全边界
- [Source: AGENTS.md] — 中文错误消息、Server Action 约定、数据库迁移与测试运行规则
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml] — 当前 Story 顺序与 `2-1` 状态信息
- [Source: prisma/schema.prisma] — 当前已有 `Project`、`Repo`、`BmadArtifact` 模型与可扩展关系
- [Source: src/actions/artifact-actions.ts] — 现有工件扫描与 tree query Action，可复用认证、权限和 provider 模式
- [Source: src/components/artifacts/artifact-tree.tsx] — 现有结构化工件树 UI，是新增详情与发起执行入口的首选落点
- [Source: src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx] — 当前项目详情页结构与“结构化工件树”集成点
- [Source: src/components/workspace/project-bmad-artifacts.tsx] — 当前文件级 BMAD 视图，需保留不替换
- [Source: src/components/epics/story-detail-view.tsx] — Story 详情展示模式可复用的 UI 参考
- [Source: src/lib/bmad/types.ts] — `StoryDetail`、`Epic`、`StoryTask` 等可直接复用的领域类型
- [Source: src/lib/artifacts/types.ts] — `ArtifactTypeString` 当前已包含 `TASK`，但只代表类型能力，不代表数据已存在
- [Source: src/lib/artifacts/scanner.ts] — 当前扫描引擎实际只稳定生成 PRD / EPIC / STORY 工件
- [Source: src/lib/content-provider/project-provider.ts] — GitHub / Local provider 组装方式
- [Source: src/lib/db/helpers.ts] — `cache()` 查询 helper 模式与 `getArtifactById()` 复用入口

## Dev Agent Record

### Agent Model Used

Cascade

### Debug Log References

### Completion Notes List

- 新增 `Task` Prisma 模型、迁移与生成客户端类型，并补齐 `Project`、`Workspace`、`User`、`BmadArtifact` 的反向关系及 `getTaskById()` 查询入口。
- 新建 `src/lib/tasks/` 领域层，统一任务状态/优先级/执行意图、默认生命周期文案，以及基于 PRD/Epic/Story/Task 的上下文构建逻辑。
- 新增 `task-actions.ts` 与共享 project provider helper，确保权限校验、中文错误码、最小立即反馈载荷和仓库上下文读取都走统一服务端流程。
- 扩展结构化工件树为可选中交互，新增工件详情侧栏、低摩擦任务创建表单与创建后即时反馈卡片。
- 新增项目级任务详情页，展示任务元信息、阶段反馈、来源工件引用，并支持返回来源工件视图。
- 通过 `pnpm prisma migrate dev --name add_task_from_artifact`、`pnpm prisma generate`、`pnpm lint`、`pnpm test`、`pnpm build` 完成回归验证；`lint` 仍保留仓库原有 warning。

### File List

- prisma/schema.prisma
- prisma/migrations/20260408111205_add_task_from_artifact/migration.sql
- src/actions/artifact-actions.ts
- src/actions/task-actions.ts
- src/actions/task-actions.test.ts
- src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx
- src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/tasks/[taskId]/page.tsx
- src/app/layout.tsx
- src/components/artifacts/artifact-detail-sheet.tsx
- src/components/artifacts/artifact-tree.tsx
- src/components/tasks/task-detail-view.tsx
- src/lib/artifacts/prd.ts
- src/lib/artifacts/scanner.ts
- src/lib/content-provider/project-provider.ts
- src/lib/db/helpers.ts
- src/lib/errors.ts
- src/lib/tasks/index.ts
- src/lib/tasks/types.ts
- src/lib/tasks/defaults.ts
- src/lib/tasks/context.ts
- src/lib/tasks/__tests__/context.test.ts
