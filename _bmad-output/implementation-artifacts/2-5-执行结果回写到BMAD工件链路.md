# Story 2.5: 执行结果回写到 BMAD 工件链路

Status: in-progress

## Story

作为用户，
我希望执行完成、中断或失败后，系统能将关键结果回写到对应的 BMAD 工件链路，
以便工件状态始终反映最新的执行成果。

## Acceptance Criteria

1. **Given** 某个任务执行成功完成 **When** 系统检测到任务进入“已完成”状态 **Then** 系统创建 `Writeback` 记录，将执行摘要、关键产物引用和完成时间回写到关联的 `BmadArtifact`
   **And** `BmadArtifact` 的执行结果快照更新以反映最新执行成果（FR12）

2. **Given** 某个任务执行失败 **When** 系统检测到任务进入“失败”状态 **Then** 系统创建 `Writeback` 记录，包含失败原因摘要和最后有效状态
   **And** 关联的 `BmadArtifact` 被明确标记为“执行失败”，而不是继续停留在“执行中”

3. **Given** 某个任务执行中断 **When** 系统检测到任务进入“中断”状态 **Then** 系统创建 `Writeback` 记录，保留中断前的关键上下文
   **And** 关联的 `BmadArtifact` 被标记为“待恢复”或“待重试”

4. **Given** 回写操作发生 **When** 查看 `BmadArtifact` 的变更历史 **Then** 回写事件被记录到审计链路，包含回写来源任务、回写内容和时间戳
   **And** 回写失败时系统标记异常而不是静默丢弃（NFR17）

## Tasks / Subtasks

> **建议实现顺序：** Task 1（定义 writeback 领域真值与持久化模型） → Task 2（实现统一回写管道与幂等事务） → Task 3（把最新结果投影回现有工件/任务读模型） → Task 4（UI 集成与异常表达） → Task 5（测试） → Task 6（验证）

- [x] Task 1: 建立 Writeback 与工件执行结果的事实模型 (AC: #1, #2, #3, #4)
  - [x] 1.1 在 `prisma/schema.prisma` 中新增一等 `Writeback` 模型，并显式包含 `workspaceId`、`projectId`、`taskId`、`artifactId`、`outcome`、`writebackStatus`、`summary`、`payload`、`idempotencyKey`、`occurredAt`、时间戳与必要索引；不要把回写记录塞进 `Task.metadata` 或 `BmadArtifact.metadata` 里充当“伪表”。
  - [x] 1.2 为 `Task`、`BmadArtifact`、`Project`、`Workspace` 建立到 `Writeback` 的关系，保证所有回写记录都显式归属于 `workspaceId/projectId`，避免未来出现跨项目串读或无法审计归因。
  - [x] 1.3 **不要复用** `BmadArtifact.status` 表达执行结果。它目前承担 2.1 中的记录生命周期语义（如 `active/deleted`）；Story 2.5 应单独引入 `executionStatus`、`latestWritebackAt` 或等价的独立字段/快照结构，用来表达“已完成 / 执行失败 / 待恢复 / 待重试”等执行态。
  - [x] 1.4 当前 `src/lib/artifacts/sync.ts` 在重新扫描时会直接更新 `BmadArtifact.metadata`；因此运行态 writeback 快照**不要**直接写进 metadata 顶层并假定它会永久存在。若确实需要 metadata 回退字段，必须采用明确命名空间并在 sync 逻辑中做受控 merge；否则优先使用独立列或独立 `Writeback` 事实表。
  - [x] 1.5 若仓库仍未存在一等 `AuditEvent` 模型，补一个最小可扩展的审计落点，至少能记录 `writeback.succeeded` / `writeback.failed` 事件；字段命名与载荷结构需对齐架构文档中的事件模式，不要在 Story 2.5 临时发明一套不可复用的审计格式。
  - [x] 1.6 `Writeback.payload` 只保存轻量、可追踪的摘要与引用，例如执行摘要、失败原因、最后有效状态、关键产物路径/类型/时间、来源任务快照；**不要**把原始日志、全文 diff、文件正文或大型结构化事件流写进 JSON 热路径。
  - [x] 1.7 数据库迁移采用前向 Prisma migration：运行 `pnpm prisma migrate dev --name add_writeback_model` 与 `pnpm prisma generate`；若需要给既有工件回填默认执行态，采用显式 backfill，不要用破坏性迁移覆盖现有 `BmadArtifact.status` 语义。

- [x] Task 2: 实现统一的任务终态回写管道与幂等事务 (AC: #1, #2, #3, #4)
  - [x] 2.1 在 `src/lib/execution/writeback.ts` 或等价领域位置新增共享 writeback helper（必要时配合 `src/lib/audit/`），作为唯一的服务端回写入口；不要让 UI 组件、页面或脚本直接散落 `prisma.writeback.create()` 与 `prisma.bmadArtifact.update()`。
  - [x] 2.2 在 helper 中集中定义“任务终态 → writeback outcome”的解析规则。**推荐默认规则：** `done -> completed`；`blocked + metadata.terminalReason === "interrupted"` 或明确中断标记 -> `interrupted`；其余 `blocked -> failed`；`review` 仍表示 review-ready，不触发最终成功回写。
  - [x] 2.3 当前 `Task.status` 只有 `pending / in-progress / review / done / blocked`，还没有显式“中断”状态。Story 2.5 必须把这层差异写进领域 helper 或补充轻量终态字段，**不要**在多个组件或 action 里各自用字符串猜测“blocked 到底是失败还是中断”。
  - [x] 2.4 统一回写流程至少包含：加载 `Task + sourceArtifact` 真值 → 校验 `workspaceId/projectId` 边界 → 解析终态与摘要 → 在单个 Prisma `$transaction` 内创建/幂等 upsert `Writeback` 记录 → 更新 `BmadArtifact` 最新执行结果快照 → 写审计事件。
  - [x] 2.5 回写必须具备幂等保护。建议以 `taskId + outcome` 或稳定 `idempotencyKey` 作为唯一约束，防止重复派发、重复恢复或重复回调把同一终态回写多次。
  - [x] 2.6 若事务中任一步失败，系统必须留下可观察的 `writebackStatus = failed` 或等价失败标记，并保留错误摘要、失败时间与来源任务标识；**不要**吞错后只让 UI 继续显示旧的“成功”状态。
  - [x] 2.7 若当前仓库仍缺统一的任务终态 mutation 入口，先抽出或补齐一个单一服务端入口（例如 `updateTaskTerminalStateAction()` 或内部领域服务），确保任何任务进入终态时都通过同一回写管道，而不是由不同页面各自更新 `Task.status` 再尝试“顺手回写”。
  - [x] 2.8 变更成功后对受影响视图执行精确缓存失效，优先使用具体的 `revalidatePath()` 或现有 tag 机制；不要为了省事失效整个 layout 或在客户端拼接“本地真相”。

- [x] Task 3: 将最新 writeback 结果投影回现有工件与任务读模型 (AC: #1, #2, #3, #4)
  - [x] 3.1 扩展 `src/lib/db/helpers.ts`，增加按 `artifactId` / `taskId` / `projectId` 读取最新 `Writeback` 与历史记录的 `cache()` helper，并维持与现有 `getTaskById()`、`getTasksBySourceArtifactIds()` 同样的最小展示字段策略。
  - [x] 3.2 继续复用 2.3/2.4 已建立的任务/工件追踪链路，不再新建平行“回写来源表”。`Task.sourceArtifactId` 仍是直接来源工件事实源，`Writeback` 只是把终态结果沉淀回这条链路。
  - [x] 3.3 对 `BmadArtifact` 的“最新执行结果”只维护一份明确快照，至少覆盖：`executionStatus`、`latestWritebackAt`、`latestWritebackTaskId`、`latestSummary`、`latestOutcome`、轻量关键产物引用与恢复建议。
  - [x] 3.4 “回写到工件链路”的 MVP 范围默认先保证**直接来源工件**一定被更新；若要把摘要向上投影到父级 Epic / PRD，只允许做轻量聚合快照，不要在本 Story 中扩散成第二套全链路状态机。
  - [x] 3.5 2.4 已明确 Agent Run、执行产物、执行时间都必须“说真话”。因此 2.5 读模型在缺少真实运行对象时，只能展示已知 writeback 摘要、轻量产物引用和失败/中断原因，不能反向虚构 Run、Session 或日志内容。
  - [x] 3.6 若某个任务已经到达终态但回写失败，相关读模型必须显式区分“任务已结束”与“回写未完成/回写失败”；不要继续向用户展示“已完成”作为最终成功态。

- [x] Task 4: 在现有详情视图中展示回写结果与异常状态 (AC: #1, #2, #3, #4)
  - [x] 4.1 继续以 `src/components/artifacts/artifact-detail-sheet.tsx` 为工件侧主入口，在当前“概览 / 执行历史”信息架构中补充“最新回写结果”或等价摘要区；**不要**为了 Story 2.5 新开平行的“回写中心”页面。
  - [x] 4.2 在工件详情中至少展示：最新回写状态、来源任务、回写时间、摘要、关键产物引用数量/列表、失败或中断原因、下一步建议（例如进入 review、待恢复、待重试）。
  - [x] 4.3 在任务详情 `src/components/tasks/task-detail-view.tsx` 中补充“是否已成功回写到来源工件”的可见反馈，并保留跳回来源工件的稳定入口，避免用户必须来回核对两边状态。
  - [x] 4.4 若当前工件暂无回写记录，空状态文案必须说明“为什么为空”以及“下一步能做什么”；若回写失败，反馈必须遵循 UX 文档的“状态 + 原因 + 下一步”结构，而不是只给一个红色 badge。
  - [x] 4.5 所有关键状态必须使用中文文案，并同时配合文本/图标/位置结构表达；不要只依赖颜色区分“已完成 / 执行失败 / 待恢复 / 回写失败”。
  - [x] 4.6 如果 2.4 的执行历史视图已经存在任务展开区或 Story/Epic 聚合区，优先在现有 payload 上追加 writeback 信息；不要复制出第二套 `artifact-writeback-history.tsx` 与平行 action。

- [x] Task 5: 补齐回归测试，覆盖状态映射、幂等性与异常语义 (AC: #1, #2, #3, #4)
  - [x] 5.1 为新的 writeback 领域 helper 增加纯单元测试，覆盖：`done -> completed`、`blocked -> failed`、显式 interrupted 映射、缺少 `sourceArtifactId`、缺少轻量产物引用、重复回写幂等等边界。
  - [x] 5.2 在 `src/actions/task-actions.test.ts` 或对应 action 测试中覆盖：参数校验失败、未登录、无执行权限、跨项目 task/artifact、成功回写、失败回写、重复调用不重复落库。
  - [x] 5.3 增加“`BmadArtifact.status` 仍保持 `active/deleted` 生命周期语义”的回归测试，防止实现时误把执行状态直接写进现有 `status` 字段。
  - [x] 5.4 为工件详情 / 任务详情补充组件测试，覆盖：最新回写摘要显示、回写失败反馈、空状态中文文案、来源任务跳转与“任务已结束但回写失败”的冲突态表达。
  - [x] 5.5 若采用 Prisma `Serializable` 事务或冲突重试，补充并发/冲突测试，确保幂等键与重试逻辑不会生成重复 `Writeback` 记录。
  - [x] 5.6 对所有新错误码同步补测试，确保 `sanitizeError()` 返回中文，而不是把原始数据库或异常文本暴露给客户端。

- [ ] Task 6: 验证与回归检查
  - [x] 6.1 运行 `pnpm lint`
  - [ ] 6.2 运行 `pnpm test`
  - [ ] 6.3 运行 `pnpm build`

## Dev Notes

### 当前基线与关键依赖

- Story 2.1 已经建立 `BmadArtifact` 数据模型与扫描/同步链路；当前 `BmadArtifact.status` 用于记录生命周期（`active/deleted`），并被 `syncArtifacts()` 与 `getProjectArtifacts()` 等 helper 直接依赖。Story 2.5 **不能**复用这条字段表达执行结果。
- `src/lib/artifacts/sync.ts` 在重新扫描时会直接覆盖 `BmadArtifact.metadata` 的扫描结果，因此运行态 writeback 数据如果直接写进 metadata 顶层，会在下一次 scan 时存在被覆盖风险。除非同步改造 scan/sync 的 merge 规则，否则优先使用独立列或独立 `Writeback` 表承载运行态真值。
- Story 2.2 已经建立 `Task` 模型、`sourceArtifactId` 事实链路，以及 `Task.metadata.sourceContext` 的轻量快照。Story 2.5 的回写入口必须建立在这个事实链路之上，而不是重新设计“任务来源映射”。
- Story 2.3 已经把“来源工件 -> 任务历史”的反向追踪固化到 `src/actions/task-actions.ts`、`src/lib/db/helpers.ts` 与 `src/lib/tasks/tracking.ts`。Story 2.5 应该把 writeback 结果接回这条链路，而不是增加第二套平行读取模型。
- Story 2.4 已经明确：没有真实 `AgentRun`、执行产物或执行时间时要诚实降级；只允许从 `Task.metadata` 读轻量引用，不允许伪造执行事实。Story 2.5 的回写 payload 与 UI 也要遵守这个边界。
- 当前 `Task.status` 只有 `pending / in-progress / review / done / blocked`，尚无显式“interrupted”终态；若需要区分失败与中断，必须在统一 helper 中做领域映射或引入最小补充字段，不要让多个文件各自猜测。
- 当前 Prisma schema 中还没有一等 `Writeback`、`AgentRun`、执行产物或审计事件模型。Story 2.5 不应假设这些域对象已经可用，而应为 writeback 交付最小可扩展事实模型。

### 默认实现决策

- **直接来源工件优先：** MVP 先保证 `Task.sourceArtifactId` 指向的直接来源工件一定被更新；祖先 Epic / PRD 的聚合投影只允许是轻量快照，且不能替代直接来源工件真值。
- **执行结果独立建模：** `BmadArtifact.status` 保留给记录生命周期；执行结果用单独字段或结构（如 `executionStatus` / `latestWritebackAt` / `latestWritebackTaskId` / `latestSummary`）表达。
- **终态映射集中定义：** `done` 表示成功完成；`blocked` 默认映射为失败；仅当 `Task.metadata` 存在明确的中断语义时才映射为 `interrupted`。
- **回写不是日志仓库：** `Writeback` 只保留轻量摘要、关键引用、最后有效状态与恢复建议，不承载原始日志、全文 diff 或完整文件内容。
- **审计先落库，UI 后扩展：** Story 2.5 负责把 writeback 事件写入可追踪审计链路；完整的审计检索、筛选与导出 UI 留给 Epic 7 系列 story。

### 架构一致性要求

- 架构文档明确要求 PostgreSQL 作为系统事实源，并围绕 `Artifact`、`Writeback`、`Audit Event` 建立统一领域模型。因此回写必须落在数据库事实层，不要只靠前端状态、toast 或 URL 参数表达“已经回写”。
- 输入与边界校验继续统一使用 Zod；内部 mutation 继续遵循 `ActionResult<T>` 返回约定与 `sanitizeError()` 错误清洗策略。
- 所有 writeback、重试、恢复与回调处理都必须具备幂等保护。实现时优先采用稳定 `idempotencyKey` 或唯一约束，不要把重复回写问题留给 UI 或人工排查。
- 跨 `Task`、`BmadArtifact`、`Writeback`、`AuditEvent` 的写入必须走单个 Prisma `$transaction`；不要把“创建回写记录”“更新工件快照”“写审计事件”拆成三个彼此独立、可部分成功的 mutation。
- 授权边界继续在 Server Action / 领域服务层收敛：读取走 `requireProjectAccess(..., "read")`，写回走 `execute` 或更严格能力；不要依赖中间件或隐藏按钮做权限控制。
- 变更成功后显式执行缓存失效。当前仓库以 `revalidatePath()` 为主，优先失效具体项目/任务/工件路径，不要粗暴刷新整个 dashboard。
- 客户端组件只承载局部交互和呈现，不承载持久化规则、权限真值或终态判定逻辑。

### 当前代码落点与推荐修改文件

- `prisma/schema.prisma`
  - 新增 `Writeback` 与最小审计实体；为 `BmadArtifact` 增加独立执行结果字段或轻量快照字段。
- `src/actions/task-actions.ts`
  - 新增或整合任务终态回写 action；继续沿用 Zod、`ActionResult<T>`、`sanitizeError()`、`requireProjectAccess()`。
- `src/lib/db/helpers.ts`
  - 增加按 `taskId` / `artifactId` / `projectId` 读取最新与历史 `Writeback` 的 `cache()` helper。
- `src/lib/execution/writeback.ts`
  - 新增统一 writeback 领域服务，集中处理终态映射、幂等键、事务编排与 payload 组装。
- `src/lib/audit/`
  - 若补最小审计落点，优先放在独立 audit 域下，而不是继续堆进 `tracking.ts` 或 UI 组件。
- `src/lib/tasks/types.ts`
  - 补充 writeback outcome、writeback status、任务终态解析所需的共享类型，避免 action / helper / 组件硬编码字符串。
- `src/lib/tasks/tracking.ts`
  - 在现有 Story/Epic 执行历史 payload 上补充 latest writeback 摘要、冲突态表达与轻量引用整形；不要另起平行 tracking 模型。
- `src/components/artifacts/artifact-detail-sheet.tsx`
  - 在现有“概览 / 执行历史”架构中接入最新回写结果展示与异常提示。
- `src/components/artifacts/artifact-task-history.tsx`
  - 若需要显示回写状态或摘要，直接增强当前历史视图，不要复制一套新组件。
- `src/components/tasks/task-detail-view.tsx`
  - 展示任务是否已成功写回来源工件、失败原因与回跳入口。
- `src/lib/errors.ts`
  - 若新增 writeback / audit 相关错误码，必须提供中文错误消息。

### 当前工作树注意事项

- 当前仓库存在未提交的本地进行中改动，尤其集中在 2.3 / 2.4 相关文件：
  - `_bmad-output/implementation-artifacts/2-3-执行任务与来源工件的追踪映射.md`
  - `src/actions/task-actions.ts`
  - `src/actions/task-actions.test.ts`
  - `src/components/artifacts/artifact-detail-sheet.tsx`
  - `src/components/artifacts/artifact-task-history.tsx`
  - `src/components/tasks/task-detail-view.tsx`
  - `src/lib/db/helpers.ts`
  - `src/lib/tasks/tracking.ts`
- 开发 Story 2.5 时必须先读取并理解这些现有改动，再在其基础上演进；不要假定主干版本就是最终基线，更不要为“回到干净状态”而回滚用户已有工作。

### 库与框架要求

- 当前仓库真实版本基线：Next.js `16.1.6`、React `19.2.3`、Prisma `6.19.2`、Zod `4.3.6`、Tailwind CSS `4.2.2`、Vitest `4.0.18`、Better Auth `1.4.18`。
- Story 2.5 **不做**框架大版本升级。架构文档已明确 Prisma 7.x 升级应作为独立平台演进事项，不能与本轮业务 story 耦合。
- Next.js 官方文档当前仍建议在 Server Action 后使用 `revalidatePath()` 做路径级缓存失效；因此 Story 2.5 应沿用现有失效模式，不要临时引入未经仓库验证的新全局缓存方案。
- Prisma 官方事务文档建议将跨表一致性写入放入 `$transaction`，并在高并发冲突场景考虑 `Serializable` 隔离级别与冲突重试；对于 Story 2.5 的 writeback 幂等与去重，这是值得直接采纳的官方实践。
- Prisma 官方 JSON 字段文档说明 JSON 适合承载结构化但轻量的元数据；这与 Story 2.4 对 `Task.metadata`、Story 2.5 对 `Writeback.payload` 的“轻量引用而非全文存储”原则一致。

### 范围边界

**本 Story 范围：**

- ✅ 新增一等 `Writeback` 记录模型与最小可追踪审计落点
- ✅ 建立统一的任务终态回写服务、幂等保护和事务边界
- ✅ 把最新 writeback 结果投影回来源工件的执行结果快照
- ✅ 在现有工件/任务详情中展示最新回写结果、失败原因与下一步建议
- ✅ 对回写失败建立明确异常状态，而不是静默丢弃
- ✅ 为状态映射、幂等性、权限边界与中文反馈补齐测试

**本 Story 不包含：**

- ❌ 不实现完整的 `AgentRun` / `ExecutionSession` / 心跳 / 日志流模型（Epic 4 / 5）
- ❌ 不实现完整的审计检索、筛选、导出与团队治理 UI（Epic 7）
- ❌ 不把 `BmadArtifact.status` 从 `active/deleted` 迁移成执行状态字段
- ❌ 不把运行态 writeback 快照直接写进 `BmadArtifact.metadata` 顶层并假设扫描同步不会覆盖它
- ❌ 不把原始日志、diff、文件全文或大体量执行事件塞进 JSON 字段
- ❌ 不新建平行的“回写中心”页面或第二套任务/工件追踪模型
- ❌ 不在本 Story 内完成全链路祖先工件状态机重构；直接来源工件真值优先

### Project Structure Notes

- 当前项目的执行上下文主要集中在 `src/actions/task-actions.ts`、`src/lib/db/helpers.ts`、`src/lib/tasks/`、`src/components/artifacts/` 与 `src/components/tasks/`。Story 2.5 应延续这个按领域拆分的结构，不要把回写逻辑塞进 `src/app` 页面文件中。
- 工件详情侧栏 `artifact-detail-sheet.tsx` 已经成为“发起执行 + 查看执行历史”的统一上下文，Story 2.5 的结果展示也应继续留在这里，而不是把用户带到新的路由。
- `src/lib/tasks/tracking.ts` 已经形成 Story / Epic 历史视图的统一 read model；如果需要新增 latest writeback 摘要或冲突态表达，应在这里扩展，而不是在组件里重新拼一套对象结构。
- Tailwind / shadcn 继续沿用当前项目约束：优先标准类名、中文文案、清晰状态表达、结构化空状态和骨架屏，而不是纯转圈加载。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2] — Epic 2 的整体目标与 Story 2.5 原始定义
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5] — Story 2.5 的用户故事与验收标准
- [Source: _bmad-output/planning-artifacts/prd.md#Project & BMAD Context Management] — FR12 对回写到 BMAD 工件链路的产品要求
- [Source: _bmad-output/planning-artifacts/prd.md#Execution Visibility & Progress Tracking] — FR30-FR35 / FR42 对状态真值、链路可见性与已回写状态的要求
- [Source: _bmad-output/planning-artifacts/prd.md#Review, Governance & Audit] — FR46 对回写审计事件的要求来源
- [Source: _bmad-output/planning-artifacts/prd.md#Reliability & Recoverability] — NFR17 与“已完成但未回写”等冲突态处理要求
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions] — `Writeback` / `Audit Event` 属于核心领域模型
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — PostgreSQL 事实源、Prisma 迁移策略与轻量元数据原则
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns] — Server Actions、结构化错误、幂等与事务边界
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules] — 事件命名、状态更新、错误处理与缓存失效模式
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#2.5 Experience Mechanics] — 发起、观察、反馈、完成的闭环体验要求
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Execution Status Rail] — 已完成 / 已回写 / 已终止等状态表达要求
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Evidence Chain Viewer] — Story、Task、Artifact、Writeback 的关系展示语义
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Feedback Patterns] — “状态 + 原因 + 下一步”的反馈要求
- [Source: _bmad-output/project-context.md] — `ActionResult<T>`、`sanitizeError()`、Zod、`cache()`、中文文案与缓存失效规则
- [Source: AGENTS.md] — Tailwind、Server Action、错误消息与测试规范
- [Source: _bmad-output/implementation-artifacts/2-1-BMAD工件层级模型与解析引擎.md] — `BmadArtifact` 生命周期字段与层级建模基线
- [Source: _bmad-output/implementation-artifacts/2-2-从BMAD工件发起执行任务.md] — `Task.sourceArtifactId`、最小 task 模型与来源上下文快照
- [Source: _bmad-output/implementation-artifacts/2-3-执行任务与来源工件的追踪映射.md] — 现有任务到工件的追踪链路与读模型边界
- [Source: _bmad-output/implementation-artifacts/2-4-查看工件关联的执行历史状态与产物.md] — 现有执行历史 payload、轻量 metadata 与“说真话”原则
- [Source: prisma/schema.prisma] — 当前只有 `Task` 与 `BmadArtifact` 等基础实体，尚无 `Writeback` / `AuditEvent`
- [Source: src/actions/task-actions.ts] — 当前工件历史与任务创建 action 基线
- [Source: src/lib/db/helpers.ts] — 当前 `cache()` 查询与最小展示字段策略
- [Source: src/lib/tasks/types.ts] — 当前任务状态枚举与共享类型基线
- [Source: src/lib/tasks/tracking.ts] — 当前 Story/Epic 执行历史 read model 与轻量引用策略
- [Source: src/components/artifacts/artifact-detail-sheet.tsx] — 工件详情侧栏的主要集成点
- [Source: src/components/artifacts/artifact-task-history.tsx] — 当前执行历史视图的主要扩展点
- [Source: src/components/tasks/task-detail-view.tsx] — 任务详情页的稳定深链落点
- [Source: package.json] — 当前仓库的真实依赖版本基线
- [Source: https://nextjs.org/docs/app/api-reference/functions/revalidatePath] — Next.js 官方路径级缓存失效说明
- [Source: https://www.prisma.io/docs/orm/prisma-client/queries/transactions] — Prisma 官方事务与并发冲突处理说明
- [Source: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields] — Prisma 官方 JSON 字段使用说明

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- 先在 `prisma/schema.prisma` 中引入 `Writeback` 与最小审计事实模型，并为 `BmadArtifact` 增加独立执行结果快照字段，保持 `status` 的生命周期语义不变。
- 在 `src/lib/execution/writeback.ts`（必要时配合 `src/lib/audit/`）中实现统一 writeback 服务，集中处理终态映射、轻量 payload 组装、幂等键与事务内多表写入。
- 在 `src/actions/task-actions.ts` 中接入规范的服务端入口，并扩展 `src/lib/db/helpers.ts` / `src/lib/tasks/tracking.ts` 读取最新与历史 writeback 结果。
- 最后把最新回写结果接到 `artifact-detail-sheet.tsx` 与 `task-detail-view.tsx`，并补齐 action / helper / 组件测试与验证记录。

### Debug Log References

- 2026-04-10 14:41 CST: 按 `sprint-status.yaml` 顺序锁定当前 backlog story 为 `2-5-执行结果回写到BMAD工件链路`。
- 2026-04-10 14:42 CST: 完整读取 Epic 2、PRD、架构、UX、`project-context.md` 与 2.3 / 2.4 现有 story，确认 Story 2.5 的关键冲突点包括 `BmadArtifact.status` 生命周期语义、`Task.status` 缺少中断态，以及仓库中尚无一等 `Writeback` / `AuditEvent` 模型。
- 2026-04-10 14:44 CST: 结合官方 Next.js / Prisma 文档补充最新技术护栏，确定采用“路径级缓存失效 + 事务内幂等回写 + JSON 仅存轻量引用”的默认方案。
- 2026-04-10 15:18 CST: 将 Story 2.5 与 `sprint-status.yaml` 标记为 `in-progress`，新增 `Writeback` / `AuditEvent` Prisma 模型与 `BmadArtifact` 执行结果快照字段，并运行 `pnpm prisma migrate dev --name add_writeback_model` 与 `pnpm prisma generate` 生成迁移 `20260410081726_add_writeback_model`。
- 2026-04-10 16:10 CST: 实现 `src/lib/execution/writeback.ts`、`src/lib/audit/events.ts`、`updateTaskTerminalStateAction()` 与 writeback 读模型投影，工件执行历史和任务详情已可展示最新回写结果、失败原因、冲突态与下一步建议。
- 2026-04-10 16:47 CST: 定向测试 `pnpm test src/actions/task-actions.test.ts src/lib/tasks/__tests__/tracking.test.ts src/components/artifacts/artifact-task-history.test.tsx src/lib/execution/__tests__/writeback.test.ts src/components/tasks/task-detail-view.test.tsx` 共 48 条测试通过；`pnpm lint` 通过（3 条既有 warning）；全量 `pnpm test` 仍被现有 integration suites 的 test DB 保护拦截；`pnpm build` 仍被既有 `src/components/reui/filters.tsx:537` 类型错误阻塞。

### Completion Notes List

- 已新增 `Writeback` / `AuditEvent` 数据模型、`BmadArtifact` 执行结果快照字段以及前向迁移 `20260410081726_add_writeback_model`，保持 `BmadArtifact.status` 继续承担 `active/deleted` 生命周期语义。
- 已实现统一的任务终态回写入口 `updateTaskTerminalStateAction()` 与领域服务 `src/lib/execution/writeback.ts`，覆盖终态映射、幂等键、失败兜底、审计记录与精确 `revalidatePath()`。
- 已扩展 `src/lib/db/helpers.ts`、`src/lib/tasks/tracking.ts` 与现有工件/任务详情 UI，使其可以展示最新回写摘要、失败原因、待恢复/待重试建议，以及“任务已结束但回写失败”的冲突态。
- 已补齐回归测试：新增 2 个测试文件并扩展 3 个既有测试文件，相关定向测试共 48 条全部通过。
- `pnpm lint` 已通过；全量 `pnpm test` 仍因现有 integration suites 要求 test 数据库而失败；`pnpm build` 仍被仓库既有的 `src/components/reui/filters.tsx:537` 类型错误阻塞，因此 Story 状态保持 `in-progress`。

### File List

- `prisma/schema.prisma`
- `prisma/migrations/20260410081726_add_writeback_model/migration.sql`
- `src/lib/audit/events.ts`
- `src/lib/execution/writeback.ts`
- `src/lib/execution/__tests__/writeback.test.ts`
- `src/actions/task-actions.ts`
- `src/actions/task-actions.test.ts`
- `src/lib/db/helpers.ts`
- `src/lib/errors.ts`
- `src/lib/tasks/types.ts`
- `src/lib/tasks/tracking.ts`
- `src/lib/tasks/__tests__/tracking.test.ts`
- `src/components/artifacts/artifact-task-history.tsx`
- `src/components/artifacts/artifact-task-history.test.tsx`
- `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/tasks/[taskId]/page.tsx`
- `src/components/tasks/task-detail-view.tsx`
- `src/components/tasks/task-detail-view.test.tsx`
