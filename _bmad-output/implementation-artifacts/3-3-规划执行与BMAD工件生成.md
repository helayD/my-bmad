# Story 3.3: 规划执行与 BMAD 工件生成

Status: review

## Story

作为用户，
我希望系统能基于我的规划请求，通过 PM 型 agent 和 BMAD skills 自动生成或更新 PRD、Epic、Story、Task 等工件，
以便我获得结构化的规划产出而不是手动编写。

## Acceptance Criteria

1. **Given** 规划请求已进入“规划中”状态，agent 和 skill 已选定 **When** 系统启动规划执行 **Then** 系统按选定的 skill 序列执行规划（如先生成 PRD，再拆解 Epic 和 Story）
   **And** 每个 skill 执行步骤的状态对用户可见

2. **Given** 规划执行中某个 skill 完成 **When** skill 产出工件（如 PRD Markdown 文件） **Then** 系统将产出的工件写入项目的 BMAD 工件目录
   **And** 自动触发工件解析引擎（Story 2.1）更新 `BmadArtifact` 记录（FR15）

3. **Given** 规划执行完成 **When** 所有选定的 skills 执行完毕 **Then** 系统展示规划产出摘要：生成了哪些工件、每个工件的概要内容
   **And** 用户可以查看、编辑或确认规划产出

4. **Given** 规划执行中某个 skill 失败 **When** 系统检测到 skill 执行错误 **Then** 系统标记失败步骤和原因，不影响已成功完成的工件
   **And** 用户可以选择重试失败步骤或调整目标重新规划

## Tasks / Subtasks

> **建议实现顺序：** Task 1（建立规划执行真值模型）→ Task 2（建立受控工件写入层）→ Task 3（实现受支持的 skill 执行适配器）→ Task 4（串联执行 action 与工件同步）→ Task 5（让 `epics.md` 真正落到 Story/Task 工件链路）→ Task 6（补充项目页反馈与失败重试）→ Task 7（测试与验证）

- [x] Task 1: 建立规划执行的真值模型与步骤状态 (AC: #1, #3, #4)
  - [x] 1.1 在 `prisma/schema.prisma` 中为 `PlanningRequest` 增加规划执行所需的显式字段，例如 `executionStartedAt`、`executionCompletedAt`、`executionFailedAt`、`artifactSummary`、`generatedArtifactCount`、`lastExecutionErrorCode` 等；核心执行事实不要继续塞回 `metadata`。
  - [x] 1.2 新增独立的 `PlanningExecutionStep`（或等价）模型，至少保存 `planningRequestId`、`skillKey`、`stepKey`、`sequence`、`status`、`title`、`startedAt`、`completedAt`、`failedAt`、`errorCode`、`errorMessage`、`outputSummary`、`artifactPaths`、`retryCount`；不要复用执行域的 `Task`、`AgentRun`、`Writeback` 充当规划步骤真值。
  - [x] 1.3 在 `src/lib/planning/types.ts` 中集中定义规划执行状态、步骤状态、中文标签、默认进度、可重试条件和摘要结构，避免 action、UI、测试各自发明状态字符串。
  - [x] 1.4 不规则、可能演化的 skill 输出明细优先放入 `Json` 字段，稳定可查询的列表优先使用 PostgreSQL 标量列表（如 `artifactPaths String[] @default([])`）；不要把稳定数组全部塞入无类型 JSON。
  - [x] 1.5 补齐规划执行相关审计事件，如 `planningRequest.executionStarted`、`planningRequest.stepCompleted`、`planningRequest.stepFailed`、`planningRequest.executionCompleted`；事件载荷应包含 `planningRequestId`、`stepKey`、`skillKey`、关键工件路径和错误摘要。
  - [x] 1.6 本 Story 的步骤真值应支持“部分成功”表达：当后续某个 step 失败时，前面已成功写入的工件和已同步的 `BmadArtifact` 仍保持成功状态，不能被整体回滚成“全部失败”。

- [x] Task 2: 建立受控的 BMAD 工件写入层 (AC: #2, #4)
  - [x] 2.1 新增专用 `PlanningArtifactWriter`（或等价抽象），以统一接口支持本地项目目录与 GitHub 仓库写入；不要在 `planning-actions.ts` 中直接散落 `fs`/GitHub API 调用。
  - [x] 2.2 本地写入实现应复用当前 provider 的根目录校验与路径约束，只允许落盘到项目受控 BMAD 目录，例如 `_bmad-output/planning-artifacts/` 与 `_bmad-output/implementation-artifacts/`；禁止越过项目根目录写入任意路径。
  - [x] 2.3 GitHub 写入实现应基于官方 Contents API 的 create/update file 模式，更新已有文件时显式携带 `sha`，并对同一分支的连续写入采用串行顺序，避免并发覆盖。
  - [x] 2.4 写入成功后返回标准化结果：实际写入路径、文件模式（create/update）、commit 标识、内容摘要和后续需要 revalidate 的缓存 key。
  - [x] 2.5 写入失败时对用户暴露中文、可理解的错误摘要，并通过 `sanitizeError()` 兜底；不要把 GitHub 原始报错或 Node 文件系统异常直接暴露到 UI。
  - [x] 2.6 对 GitHub 项目写入成功后，除 `revalidatePath()` 刷新项目页外，还应使用现有 `repoTag(...)` / `fileTag(...)` 机制失效相关缓存；不要因为 3.3 顺手重写整套 GitHub 缓存架构。

- [x] Task 3: 实现受支持的规划 skill 执行适配器 (AC: #1, #2, #3, #4)
  - [x] 3.1 在 `src/lib/planning/` 下建立窄接口 `PlanningSkillExecutor`（或等价），明确当前仅支持已在 3.2 目录中被选中的 skill：`bmad-create-prd`、`bmad-create-architecture`、`bmad-create-epics-and-stories`。
  - [x] 3.2 为 `bmad-create-prd` 适配器显式声明其标准输出目标是 `_bmad-output/planning-artifacts/prd.md`，并以可幂等方式 create/update。
  - [x] 3.3 为 `bmad-create-architecture` 适配器显式声明其标准输出目标是 `_bmad-output/planning-artifacts/architecture.md`，并处理“首次创建”与“在既有文档上更新/追加”的差异。
  - [x] 3.4 为 `bmad-create-epics-and-stories` 适配器显式声明其标准输出目标是 `_bmad-output/planning-artifacts/epics.md`，并输出后续可供 Story/Task 投影使用的结构化摘要。
  - [x] 3.5 当前 Story 不要实现“通用 `workflow.md` 解释器”或“自动执行任意 markdown skill”的框架。3.3 只做受控、可验证、与当前仓库已知 skill 输出契约一致的执行适配层。
  - [x] 3.6 每个适配器都应返回标准化执行结果：step 摘要、写入文件列表、用户可见摘要、后续是否需要触发故事投影或工件扫描。

- [x] Task 4: 串联规划执行 action、步骤状态推进与工件同步 (AC: #1, #2, #3, #4)
  - [x] 4.1 在 `src/actions/planning-actions.ts` 中新增 `executePlanningRequestAction`（或等价入口），与 3.1 的创建、3.2 的分析解耦；不要把“创建、分析、执行、派发”揉进一个超长 action。
  - [x] 4.2 action 顶部继续使用 Zod 校验、`getAuthenticatedSession()`、`requireProjectAccess(..., "execute")`，并仅允许处于可执行状态的 `PlanningRequest` 进入执行；重复触发要么返回幂等结果，要么显式 no-op。
  - [x] 4.3 执行顺序必须以 3.2 已选定的 skill pipeline 为准，逐 step 串行推进并在每一步开始/成功/失败时持久化步骤状态；不要在 UI 上伪造“正在执行”而没有数据库真值。
  - [x] 4.4 每个 step 写入成功后直接调用当前库内的 `createProjectContentProvider(...)`、`scanProjectArtifacts(...)`、`syncArtifacts(...)`（或等价 helper）完成工件扫描与 `BmadArtifact` 同步；不要通过 Server Action 套 Server Action。
  - [x] 4.5 规划执行的数据库状态推进与关键审计事件写入使用短事务包裹；长耗时的文件生成/写入过程不应包进单个超长 Prisma 事务中，但每一步的状态收尾必须保持原子。
  - [x] 4.6 当某个 step 失败时，应保留此前成功步骤的结果、已生成文件与 `BmadArtifact` 记录，只将当前 step 标记为失败，并提供“重试失败步骤”而不是强制全链路从头覆盖。
  - [x] 4.7 对未关联 repo 的项目应诚实降级：规划请求仍可见、执行入口可给出缺少仓库/写入目标的中文说明，但不要假装已生成工件；如果产品决定 3.3 必须要求 repo，则需在 Story 中显式更新 UX 与错误提示，而不是隐式失败。
  - [x] 4.8 3.3 只负责“生成/更新 BMAD 工件并同步 artifact 真值”，不要提前创建执行 `Task` 或派发 `AgentRun`；那是 Story 3.4 的职责。

- [x] Task 5: 让 `epics.md` 的产出真正进入 Story/Task 工件链路 (AC: #2, #3)
  - [x] 5.1 基于当前解析器现状补一层确定性投影：`parseEpics()` 目前只能产出 `EPIC` 级 artifact，而 `TASK` artifact 依赖实现故事文件中的 checkbox 任务，因此 3.3 不能假设“只写 `epics.md` 就会天然得到 Story/Task artifact”。
  - [x] 5.2 在 `bmad-create-epics-and-stories` 执行成功后，新增轻量 `StoryProjection` / `ImplementationStoryMaterializer`（命名可调整），把 epic 文档中的 story 条目投影成 `_bmad-output/implementation-artifacts/` 下的实现故事 stub 文件。
  - [x] 5.3 这些 stub 文件必须兼容当前 `parseStory()` 的解析约定，并包含最小必要的 `Status`、`Story`、`Acceptance Criteria`、`Tasks / Subtasks` 结构，以便 scanner 能建立 `STORY`/`TASK` 级 `BmadArtifact` 记录。
  - [x] 5.4 stub 中的任务清单应来自可解释、可重放的投影规则，例如基于验收标准生成待实现任务骨架；不要在 3.3 中循环调用一次次 `bmad-create-story` 来“补故事文件”。
  - [x] 5.5 投影过程必须幂等且尊重用户后续编辑：优先 create missing files；若目标 stub 已存在，应只更新由规划器托管的区块或在检测到冲突时停下并记录冲突，而不是无提示覆盖开发者已补充的实现细节。
  - [x] 5.6 如果当前 parser/UI 对 story status 的可接受值不够表达“规划产出但未开发”，应先补齐 parser 与展示映射，再写入新的状态值；不要为了投影方便直接伪装成 `ready-for-dev` 或 `done`。

- [x] Task 6: 在项目页展示执行进度、产出摘要与失败重试 (AC: #1, #3, #4)
  - [x] 6.1 扩展 `src/lib/planning/queries.ts` 的返回形状，使项目页能读取 step 列表、每步状态时间戳、失败原因摘要、产出文件列表和聚合工件计数。
  - [x] 6.2 在 `src/components/planning/planning-request-list.tsx` 或新的详情组件中展示“原始目标 → 意图识别结果 → skill 执行序列 → 产出工件摘要”的可见链路，满足 3.3 对步骤状态和产出摘要可见的要求。
  - [x] 6.3 每个 step 的状态都应带有文本语义与下一步说明，失败时展示具体失败步骤、中文原因和 `重试失败步骤` / `重新规划` 操作；不要只用颜色或单一“失败”字样。
  - [x] 6.4 对 direct-execution 请求继续保持 3.2 的现有反馈，不要让 3.3 的规划执行 UI 误包裹到直达执行分支。
  - [x] 6.5 对无 repo 或写入能力缺失的项目，UI 应给出真实约束和建议动作（例如“先关联仓库后再执行规划工件生成”），避免把链路显示成已经成功完成。

- [x] Task 7: 补齐执行、投影与回归测试 (AC: #1, #2, #3, #4)
  - [x] 7.1 为 `src/lib/planning/` 下的执行状态机、skill 适配器、story 投影与工件写入层补单测，覆盖成功、部分成功、重复执行、失败重试和冲突保护。
  - [x] 7.2 为 `src/actions/planning-actions.ts` 的执行入口补 action 级测试，覆盖权限、可执行状态校验、步骤持久化、部分成功和 repo 缺失降级。
  - [x] 7.3 为项目页 planning UI 补组件测试，覆盖步骤状态显示、摘要展示、失败重试按钮和无 repo 提示。
  - [x] 7.4 为工件扫描回归补测试，确认 `prd.md`/`architecture.md`/`epics.md` 更新后 artifact sync 正常，且 story stub 投影后能产生 `STORY`/`TASK` 级 artifact。
  - [x] 7.5 运行 `pnpm test` 并记录现有仓库级阻塞；若执行迁移，补 `pnpm prisma generate` 并说明生成结果。

## Dev Notes

### 当前实现基线

- `PlanningRequest`、规划意图识别与项目页入口已经在 3.1/3.2 打好基础，相关代码集中在 `src/actions/planning-actions.ts`、`src/lib/planning/`、`src/components/planning/`。
- 当前工件扫描链路已经存在，核心入口为 `createProjectContentProvider(...)`、`scanProjectArtifacts(...)`、`syncArtifacts(...)`。3.3 应复用这条真值链，而不是新建第二套“规划产物登记表”。
- 当前 `content-provider` 层只提供读取能力，尚无安全的写入接口。3.3 的关键新增点之一就是“受控写入层”，而不是把写文件逻辑直接塞进 action。
- 当前 `PlanningRequest` 已有 `routeType`、`selectedAgentKeys`、`selectedSkillKeys`、`executionHandoffDraft` 等字段，可作为执行阶段的上游输入；但尚无 per-step 执行真值和工件产出摘要字段。

### 关键实现决策

- 规划执行应采用“显式 step 真值 + 窄 skill 适配器”的方式实现，而不是构建一个能解释任意 `workflow.md` 的通用运行时。当前仓库里需要的只是对已知 BMAD planning skills 的受控执行。
- 文件写入必须与项目上下文绑定，并且区分 local/GitHub 两种写入后端。写入成功后立即做 artifact sync，保证 UI 和 `BmadArtifact` 真值一致。
- 执行状态必须支持“部分成功”：前面步骤成功生成的 PRD / Epic / Story 文件不能因为后一步失败而被抹掉，也不能在 UI 上被整体覆盖成“失败”。
- `epics.md` 本身不足以产生 `STORY` / `TASK` artifact。若要让 3.4 能消费规划产出的执行项，3.3 必须补“story stub 投影”这层桥接。

### 关键护栏

- **不要**复用执行域的 `Task` / `AgentRun` / `Writeback` 表示规划执行步骤。规划域和执行域在 3.3 仍然是两个阶段。
- **不要**在 3.3 提前创建执行 `Task`、派发 `codex` / `claude code`、创建 `AgentRun` 或开启后台 session；这些属于 Story 3.4 及 Epic 4。
- **不要**把当前 story 扩展成“通用 skill 运行器”。只支持 `bmad-create-prd`、`bmad-create-architecture`、`bmad-create-epics-and-stories` 三个已知 planning skills。
- **不要**假设所有项目都已关联 repo。3.1/3.2 允许无 repo 创建和分析规划请求，3.3 必须对无法写入的情况给出诚实反馈，而不是默默成功。
- **不要**在 story 投影时覆盖开发者手工修改的实现故事文件；需要托管区块、冲突检测或 create-missing-first 策略。

### 最新技术信息

- GitHub 官方 Contents API 在更新已有文件时需要提供目标文件当前 `sha`，并建议对同一分支的 create/update 请求按顺序串行执行；这直接影响 3.3 的 GitHub 写入器设计。
- Next.js 的 `revalidatePath()` 仍是 mutation 之后刷新路由真值的标准路径，而当前仓库的 GitHub 内容缓存已经通过 `unstable_cache` + `repoTag/fileTag` 建模，因此 3.3 更应补充缓存失效，而不是顺手重构整套缓存方案。
- Prisma 事务更适合用于“步骤状态更新 + 审计事件写入”等短事务，而非把整个长耗时规划执行包进单个事务。
- Prisma `Json` 字段适合承载不规则的输出摘要与调试明细；稳定数组（如产出路径列表）优先使用标量列表字段。

### 范围边界

**本 Story 包含：**

- 规划 skill 执行与 per-step 状态可见
- 将 PRD / Architecture / Epics 等产物写入 BMAD 目录
- 执行后触发 artifact 扫描并更新 `BmadArtifact`
- 展示规划产出摘要、失败原因与重试入口
- 通过 story stub 投影让后续 Story/Task artifact 可被识别

**本 Story 不包含：**

- 规划确认后的执行任务创建与派发（Story 3.4）
- 从规划到执行的完整链路详情中心（Story 3.5）
- 通用 BMAD workflow markdown 解释器
- tmux/supervisor/session/watchdog 等后台执行基础设施

### Project Structure Notes

- 推荐新增实现主要落在 `src/lib/planning/`，例如 `execution.ts`、`execution-types.ts`、`artifact-writer.ts`、`story-projection.ts`；尽量把 action 保持为薄协调层。
- `prisma/schema.prisma` 需要扩展规划执行相关模型与字段，并生成对应 migration。
- `src/actions/planning-actions.ts` 继续作为规划域 server action 入口；不要让组件或页面直接触碰文件系统/GitHub 写入逻辑。
- `src/components/planning/planning-request-list.tsx` 可能需要增强，也可以按需新增详情组件；保持项目页集成点仍位于 `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx`。
- 如果写入逻辑需要复用当前 provider 的根目录校验，可在 `src/lib/content-provider/` 提取共享 helper；但读写职责仍应分层，不建议直接把 provider 全部改造成“万能读写器”。
- 当前工作树已有多处 planning 相关修改，开发时应最小范围集成并避免覆盖用户正在编辑的规划文档与 story 文件。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3] — Story 3.3 的用户故事与验收标准原文
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4] — 执行任务创建与派发属于后续 Story，不应在 3.3 越界实现
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.5] — 完整链路详情中心属于后续 Story，3.3 只需提供最小可见性
- [Source: _bmad-output/planning-artifacts/prd.md#Planning & PM Skill Orchestration] — FR13-FR17 的产品能力边界
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — 真值模型、事件链与结构化状态的建模原则
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns] — Server Actions、事务与幂等的边界
- [Source: _bmad-output/planning-artifacts/architecture.md#Structure Patterns] — `src/actions` / `src/lib` / `src/components` 的职责划分
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Experience Principles] — “委托必须有回音”“状态必须说真话”
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Feedback Patterns] — 统一采用“状态 + 原因 + 下一步”的反馈方式
- [Source: _bmad-output/project-context.md] — `ActionResult<T>`、Zod 校验、中文文案与 `revalidatePath()` 约束
- [Source: AGENTS.md] — 中文文案、错误处理、Tailwind 与测试规范
- [Source: prisma/schema.prisma] — 当前 `PlanningRequest` / `Task` / `AuditEvent` / artifact 相关模型基线
- [Source: src/actions/planning-actions.ts] — 现有规划域 action 入口与状态推进模式
- [Source: src/lib/planning/types.ts] — 当前规划状态、文案与路由类型定义
- [Source: src/lib/planning/queries.ts] — 项目页 planning 查询形状
- [Source: src/lib/content-provider/types.ts] — 当前 provider 仅提供读取能力，说明 3.3 需要独立写入层
- [Source: src/lib/content-provider/local-provider.ts] — 本地 provider 的根目录与路径校验语义
- [Source: src/lib/content-provider/github-provider.ts] — GitHub 内容读取模式与 provider 边界
- [Source: src/lib/artifacts/scanner.ts] — 当前 BMAD 工件扫描与解析入口
- [Source: src/lib/artifacts/sync.ts] — `BmadArtifact` 同步真值逻辑
- [Source: src/lib/bmad/parse-epics.ts] — 当前 `epics.md` 解析基线，仅能直接产出 epic 级结构
- [Source: src/lib/bmad/parse-story.ts] — 当前实现故事文件的解析约定，决定 3.3 的 stub 投影格式
- [Source: src/lib/github/cache-tags.ts] — GitHub repo/file 缓存标签现状
- [Source: https://docs.github.com/en/rest/repos/contents] — GitHub 官方 Contents API：create/update file contents、更新需 `sha`、并发写入注意事项
- [Source: https://nextjs.org/docs/app/api-reference/functions/revalidatePath] — Next.js 官方 `revalidatePath()` 文档
- [Source: https://nextjs.org/docs/app/api-reference/functions/unstable_cache] — Next.js 官方 `unstable_cache` 文档
- [Source: https://www.prisma.io/docs/orm/prisma-client/queries/transactions] — Prisma 官方事务文档
- [Source: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields] — Prisma `Json` 字段适用场景
- [Source: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-scalar-lists-arrays] — Prisma/PostgreSQL 标量列表字段能力

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-04-11 17:52 CST: 按 `sprint-status.yaml` 顺序确认当前 backlog story 为 `3-3-规划执行与BMAD工件生成`，并锁定其前置 3.1/3.2 已存在。
- 2026-04-11 18:02 CST: 复核 Epic 3、PRD、架构、UX 与现有 planning 代码，确认 3.3 的责任是“执行已选定 planning skills 并生成工件”，不是提前进入执行派发。
- 2026-04-11 18:10 CST: 审查 `PlanningRequest`、artifact scanner、content provider 与 GitHub 缓存代码，确认当前仓库已有读取/扫描真值链，但缺少安全写入层和 step 真值模型。
- 2026-04-11 18:18 CST: 核对 `parseEpics()` 与 `parseStory()` 现状，确认仅写 `epics.md` 不能自然产出 `STORY`/`TASK` artifact，因此将“story stub 投影”写入本 Story 作为明确实现要求。
- 2026-04-11 18:27 CST: 复查官方文档，确认 GitHub Contents API 的 `sha` 更新规则、Next.js `revalidatePath()` / `unstable_cache`、Prisma 事务与 `Json`/标量列表建模边界。
- 2026-04-11 18:38 CST: 完成 Story 3.3 上下文组装并将冲刺状态推进到 `ready-for-dev`，供后续开发直接实施。
- 2026-04-11 22:58 CST: 完成 `PlanningExecutionStep` 真值模型、规划状态辅助类型、审计事件、`PlanningArtifactWriter` 与安全路径约束落地，并补入规划执行迁移脚本。
- 2026-04-11 23:18 CST: 完成受控 skill 执行适配器、story stub 投影、`executePlanningRequestAction`、artifact sync 串联，以及项目页步骤状态/失败重试 UI。
- 2026-04-11 23:39 CST: 通过 `pnpm prisma generate`、针对性 planning 回归测试、`pnpm build` 与 `pnpm lint`；完整 `pnpm test` 仍受 13 个测试数据库保护型集成套件阻塞。

### Completion Notes List

- 已为 `PlanningRequest` 增加规划执行显式字段，并新增 `PlanningExecutionStep` 真值模型、审计事件与统一状态/摘要 helper，支持部分成功与失败重试。
- 已实现本地/GitHub 双后端 `PlanningArtifactWriter`、路径安全校验与 GitHub cache tag 失效逻辑，并通过中文错误码与 `sanitizeError()` 保持用户可见反馈一致。
- 已实现 `bmad-create-prd`、`bmad-create-architecture`、`bmad-create-epics-and-stories` 三个受控 skill 执行适配器，以及 `epics.md` 到实现故事 stub 的确定性投影链路。
- 已新增 `executePlanningRequestAction` 与执行编排层，按已选 skill pipeline 串行推进 step 状态，并在每步后触发 artifact 扫描与 `BmadArtifact` 同步。
- 已更新 planning 项目页 UI，展示执行步骤、产出摘要、失败原因、无 repo 提示与“重试失败步骤”操作；direct-execution 分支保持原有反馈。
- 已完成 `pnpm build`、`pnpm lint`、`pnpm test` 验证；其中完整测试仍有 13 个集成套件因 `DATABASE_URL` 未指向测试库而被保护性失败，属于仓库级环境阻塞。
- 已记录 Prisma 迁移现状：`pnpm prisma migrate dev --name add_planning_execution_pipeline --create-only` 因现有数据库 drift 要求 reset，因此本 Story 改为手工补入前向 migration SQL，未执行破坏性重置。

### File List

- `_bmad-output/implementation-artifacts/3-3-规划执行与BMAD工件生成.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `prisma/schema.prisma`
- `prisma/migrations/20260411162000_add_planning_execution_pipeline/migration.sql`
- `src/actions/planning-actions.ts`
- `src/actions/planning-actions.test.ts`
- `src/components/dashboard/sprint-summary-card.tsx`
- `src/components/planning/planning-request-composer.tsx`
- `src/components/planning/planning-request-composer.test.tsx`
- `src/components/planning/planning-request-list.tsx`
- `src/components/planning/planning-request-list.test.tsx`
- `src/components/reui/filters.tsx`
- `src/components/shared/status-badge.tsx`
- `src/components/stories/kanban-board.tsx`
- `src/components/stories/story-filters.tsx`
- `src/components/ui/animated-theme-toggler.tsx`
- `src/lib/artifacts/__tests__/scanner.test.ts`
- `src/lib/audit/events.ts`
- `src/lib/bmad/types.ts`
- `src/lib/bmad/utils.ts`
- `src/lib/content-provider/local-provider.ts`
- `src/lib/content-provider/path-safety.ts`
- `src/lib/errors.ts`
- `src/lib/execution/writeback.ts`
- `src/lib/github/client.ts`
- `src/lib/planning/artifact-writer.ts`
- `src/lib/planning/artifact-writer.test.ts`
- `src/lib/planning/catalog.ts`
- `src/lib/planning/execution.ts`
- `src/lib/planning/execution.test.ts`
- `src/lib/planning/queries.ts`
- `src/lib/planning/skill-executors.ts`
- `src/lib/planning/story-projection.ts`
- `src/lib/planning/story-projection.test.ts`
- `src/lib/planning/types.ts`
- `src/lib/planning/types.test.ts`

### Change Log

- 2026-04-11: 实现 Story 3.3 的规划执行真值模型、受控工件写入层、三类 planning skill 适配器、story stub 投影、项目页执行反馈与失败重试；补齐构建所需类型修正并完成 build/lint/targeted test 验证，完整 `pnpm test` 仍受测试数据库保护型集成套件阻塞
