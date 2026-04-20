# Story 4.2: Agent自动路由与选择

Status: done

## Story

作为系统，
我希望能根据任务类型、上下文和策略自动选择合适的 agent（codex 或 claude code），
以便每个任务被分配到最适合处理它的执行引擎。

## Acceptance Criteria

1. **Given** 任务已创建且状态为 `planned`
   **When** 系统执行 agent 路由逻辑
   **Then** 基于任务类型（编码 / 修复 / 重构 / 测试等）、项目偏好和工作空间策略选择 agent（FR19）
   **And** 路由决策记录到 `Task.metadata` 中，包含选择的 agent 类型和选择理由

2. **Given** 工作空间配置了默认 agent 路由偏好
   **When** 路由逻辑执行
   **Then** 优先使用工作空间级策略
   **And** 任务级用户偏好可覆盖默认策略

3. **Given** agent 路由完成
   **When** Task 状态更新
   **Then** `Task.status` 从 `planned` 变为 `dispatched`
   **And** 创建 `AgentRun` 记录，关联到 `Task`，包含选定的 agent 类型、运行 ID 和创建时间

## Tasks / Subtasks

> **建议实现顺序：** Task 1（建立 `AgentRun` / `dispatched` 真值）→ Task 2（实现纯路由决策服务）→ Task 3（落地 dispatch action 与审计）→ Task 4（让详情 / 链路 / 历史消费新真值）→ Task 5（测试与验证）

- [x] Task 1: 建立 4.2 的领域真值与状态边界 (AC: #1, #2, #3)
  - [x] 1.1 在 `prisma/schema.prisma` 中新增 `AgentRun` model，至少关联 `Workspace`、`Project`、`Task`，字段至少包括：`id`、`workspaceId`、`projectId`、`taskId`、`agentType`、`status`、`selectionReasonCode`、`selectionReasonSummary`、`metadata Json?`、`createdAt`、`updatedAt`；**不要**继续把 run 真值长期塞在 `Task.metadata.agentRuns` 里。
  - [x] 1.2 `Task` 与 `AgentRun` 关系必须允许一对多，避免把 `taskId` 误设为唯一；4.3 重新派发和 4.4 会话启动都需要保留完整 run 历史。
  - [x] 1.3 在 `src/lib/tasks/types.ts` 把 `dispatched` 加入 `TaskStatus` 与中文标签，并同步共享 status/filter 常量；**不要**复用 `in-progress` 或 legacy `pending` 表示“已派发未启动”。
  - [x] 1.4 集中定义执行 agent 的共享类型和值标签，例如 `TASK_AGENT_TYPE_VALUES = ["codex", "claude-code"]` 与中文 label/helper；如果 4.1 的 `preferredAgentType` 尚未真正落库，先按 4.1 的既定值域 `auto | codex | claude-code` 补齐，再在 4.2 复用，不要另外发明第二套字符串。
  - [x] 1.5 在 `src/lib/projects/` 新增最小 project routing settings helper（或等价集中模块），从 `Project.settings` 中解析可选项目级偏好，例如 `defaultAgentType: "inherit" | "codex" | "claude-code"`；4.2 不要求一次做完整项目设置 UI，但至少要有稳定读取真值，不要在 action 里直接手写 JSON 取值。
  - [x] 1.6 扩展 `src/lib/audit/events.ts` 的 task audit 能力，新增 `task.routed`（或等价单一事件名）以及对应 payload builder；事件命名继续沿用既有 past-tense 风格，不要直接 `console.info` 冒充审计。
  - [x] 1.7 为 `AgentRun` 和 task dispatch 读模型补必要索引，例如 `taskId + createdAt`、`projectId + status + createdAt`；后续 3.5、4.4 和风险视图都要按任务或项目读取最新 run。

- [x] Task 2: 实现可测试、可解释的 agent 路由决策服务 (AC: #1, #2)
  - [x] 2.1 在 `src/lib/execution/` 下新增纯路由服务（如 `routing.ts` / `catalog.ts`），集中维护支持的执行 agent、标签、说明和选择规则；**不要**在 `execution-actions.ts`、组件和测试里各自写一套 if/else。
  - [x] 2.2 路由服务输出应使用判别联合（discriminated union）而不是“可能为空的字符串”，至少区分：
    - `selected`：已经选定 agent，可继续派发
    - `selection-required`：当前策略要求人工指定 agent，暂不能自动派发
    这样可以避免 manual 模式下误把 `undefined` 当成合法 agent。
  - [x] 2.3 决策优先级保持稳定且可审计：
    1. 显式选择的 agent（task detail 手动指定）或 `Task.preferredAgentType` 的显式偏好 `codex` / `claude-code`
    2. 工作空间 `agentRoutingPreference = manual` 时的“需要人工指定”门控
    3. `Project.settings` 中的项目级默认 agent
    4. 基于 `Task.intent`、`goal`、`intentDetail`、来源上下文的自动规则
  - [x] 2.4 自动规则先采用稳定的确定性启发式，而不是引入新的 AI 判定链路：
    - `fix` 和范围明确的 `implement` 默认优先 `codex`
    - `research`，或 `goal / intentDetail / source summary` 含有 `调研`、`探索`、`方案`、`架构`、`重构`、`design`、`analysis`、`refactor` 等信号时优先 `claude-code`
    - 无强信号时保守回落到 `codex`
    这样能满足当前 PRD“实现类优先 `codex`、探索/重构类可切 `claude code`”的基线，同时保持规则透明可测。
  - [x] 2.5 路由决策结果必须输出结构化理由：`selectedAgentType`、`decisionSource`、`selectionReasonCode`、`selectionReasonSummary`、`matchedSignals[]`；**不要**只在 UI toast 里写一句“已自动选择 Agent”。
  - [x] 2.6 当工作空间为 manual 且 task 没有显式偏好时，服务可返回推荐 agent 作为 UI 默认建议，但必须保持 `selection-required`，不要偷偷越过治理策略直接派发。
  - [x] 2.7 路由服务不接触 `tmux`、session、日志监听或心跳；这些输入都不属于 4.2 的决策边界。

- [x] Task 3: 落地任务派发 action、状态流转与审计闭环 (AC: #1, #2, #3)
  - [x] 3.1 新增 `src/actions/execution-actions.ts`（或等价 execution mutation 入口），提供 `dispatchTaskAction()`；顶部继续使用 Zod 4 校验 `workspaceId`、`projectId`、`taskId` 和可选显式 `agentType`，并返回统一 `ActionResult<T>`。
  - [x] 3.2 action 继续复用 `getAuthenticatedSession()` + `requireProjectAccess(..., "execute")`；读取任务时需要带上 `Project.settings`、`Workspace.settings`、来源工件与已有 `AgentRun`，避免在后续 query 或组件层二次拼装。
  - [x] 3.3 只允许 `Task.status = "planned"` 的任务进入首次派发；对已经 `dispatched` 且已有首个 `AgentRun` 的任务，应返回幂等结果或明确中文提示，**不要**因为用户双击、刷新或竞争请求重复创建 run。
  - [x] 3.4 用短事务一次性完成“claim + route + persist”：
    - 原子 claim 目标 Task，防止并发双派发
    - 运行路由服务，得出 agent 决策
    - 创建首个 `AgentRun`
    - 更新 `Task.status = "dispatched"`、`currentStage`、`nextStep` 与 `metadata.routingDecision`
    - 写入 `task.routed` 审计事件
  - [x] 3.5 对需要人工指定 agent、等待审批或不满足治理边界的任务，action 必须保持 `Task.status = "planned"` 并返回诚实中文反馈；**不要**先写 `dispatched` 再靠 UI 回滚。
  - [x] 3.6 `Task.metadata` 中仅保存路由摘要，而不是完整 run 真值；建议结构至少包含：
    - `routingDecision.selectedAgentType`
    - `routingDecision.decisionSource`
    - `routingDecision.selectionReasonCode`
    - `routingDecision.selectionReasonSummary`
    - `routingDecision.matchedSignals`
    - `routingDecision.agentRunId`
    - `routingDecision.routedAt`
    同时继续用 `currentActivity` 说真话，例如“已完成 Agent 路由，等待执行监督器创建会话并启动”。
  - [x] 3.7 `AgentRun.id` 就是当前阶段的运行 ID；在 4.4 的 tmux / supervisor 真正接入前，不要为了满足“运行 ID”验收标准而硬塞一个 fake provider run id。
  - [x] 3.8 派发成功后精确 `revalidatePath()` 项目页、任务详情页，以及 `planningRequestId` 对应的 planning detail 视图；`router.refresh()` 可以作为客户端辅助，但不能替代服务端真值刷新。
  - [x] 3.9 4.2 不得创建 `ExecutionSession`、不得调用 `tmux`、不得记录心跳；这些属于 4.4 和 Epic 5。派发完成的真相只到 `Task: planned -> dispatched` 和首个 `AgentRun`。

- [x] Task 4: 让任务详情、规划链路与执行历史消费 `AgentRun` / `dispatched` 新真值 (AC: #1, #3)
  - [x] 4.1 更新 `src/lib/db/helpers.ts` 中 `getTaskById()`、`getTaskHistoryCandidatesByProjectId()`、`getTasksByPlanningRequestIds()` 等查询，把 `agentRuns` 关系作为正式读取字段；**不要**要求下游组件再回表找 run。
  - [x] 4.2 更新 `src/lib/tasks/tracking.ts`：读取 agent run 时优先使用 relation 真值，再兼容 legacy `metadata.agentRuns / runs / executionRuns` fallback；这样不会打断当前历史视图和旧测试数据。
  - [x] 4.3 在 `src/components/tasks/` 下新增轻量派发组件（如 `task-dispatch-card.tsx`），优先嵌入任务详情页：
    - `planned` 状态时显示“派发任务”主动作
    - workspace manual 时显示紧凑 agent Select + 确认
    - dispatch 完成后展示 `已派发` badge、所选 agent、路由理由、run id 和创建时间
  - [x] 4.4 `src/components/tasks/task-detail-view.tsx` 需要继续遵循“状态 + 原因 + 下一步”：
    - `planned`：等待派发 / 等待审批 / 等待指定 agent
    - `dispatched`：已完成路由，但尚未创建 session、尚未开始执行
    **不要**把 `dispatched` 说成“执行中”或“已启动”。
  - [x] 4.5 `src/components/planning/planning-request-detail-sheet.tsx` 的“衍生执行任务列表”至少要正确显示 `dispatched` 状态，并在存在时展示选定 agent；复用现有任务详情深链，不要为 4.2 新建“执行中心”页面。
  - [x] 4.6 `src/components/artifacts/artifact-task-history.tsx`、`src/components/tasks/task-detail-view.tsx`、`src/lib/tasks/types.ts`、相关 badge / filter / aggregate helper 都要识别 `dispatched`；否则 4.2 派发后的任务会在历史视图中“消失”或被错误归到 `in-progress`。
  - [x] 4.7 对还没有 run 真值的旧任务，UI 保持诚实降级：可以显示“暂无 AgentRun 记录”，但不要因为 4.2 新增 relation 就把旧任务详情渲染成空白。

- [x] Task 5: 补齐路由、派发、读模型与 UI 回归测试 (AC: #1, #2, #3)
  - [x] 5.1 在 `src/lib/execution/__tests__/` 下新增路由服务测试，覆盖：task 偏好覆盖、workspace manual 门控、project default agent、`implement / fix / research` 启发式、关键词命中、无信号默认回落。
  - [x] 5.2 在 `src/actions/execution-actions.test.ts` 中覆盖：未登录、权限不足、task 不存在、非 `planned` 任务误派发、double submit 幂等、manual 需选 agent、task 偏好覆盖、成功创建 `AgentRun`、写入审计和路径刷新。
  - [x] 5.3 扩展 `src/lib/tasks/__tests__/tracking.test.ts`，确认 relation-first agent run 解析、legacy metadata fallback、`dispatched` 标签和最新 run 排序都稳定。
  - [x] 5.4 扩展 `src/components/tasks/task-detail-view.test.tsx` 与必要的 planning detail / artifact history 测试，覆盖：`planned` 的 dispatch CTA、manual selection UI、`dispatched` 的诚实文案、selected agent badge、旧任务无 run 的空状态。
  - [x] 5.5 如果新增 `src/lib/projects/settings.ts` 或等价 helper，补 schema/default 测试，避免 `Project.settings` 缺值时在路由 action 中抛异常。
  - [x] 5.6 验证步骤至少包含：`pnpm lint`、相关 Vitest 套件、`pnpm build`；若完整 `pnpm test` 仍受现有测试数据库 guard 影响，需要在完成说明中如实记录。

### Review Findings

- [x] [Review][Patch] 审批中的 `planned` 任务仍显示可点击的首次派发入口 [src/components/tasks/task-detail-view.tsx:128]
- [x] [Review][Patch] Epic 执行历史把 `dispatched` 重新压回了“待执行” [src/lib/tasks/tracking.ts:869]
- [x] [Review][Patch] manual 路由分支把推荐 Agent 信息丢掉了 [src/lib/execution/dispatch.ts:166]

## Dev Notes

### 当前基线与关键依赖

- Story 3.4 已建立 `Task.status = planned`、`planningRequestId`、`taskHandoffSummary` 与 `readyState = manual / auto-ready / approval-required` 的执行准备真值；4.2 要做的是“把 planned task 路由到具体 agent 并生成首个 AgentRun”，不是重做 planning handoff。
- Story 3.5 已把 planning request → derived tasks 的链路详情接进项目页，并且明确 `planned` 只表示“已进入执行准备态”；4.2 必须延续这个诚实语义。
- Story 4.1 的上下文已经明确：手动创建任务也应统一落到 `planned`，并通过一等字段保存 `preferredAgentType` 与 `intentDetail`。4.2 应优先消费这些字段；如果当前分支的 4.1 代码尚未落地，先把 4.1 既定字段补齐，再实现路由。
- 当前 `prisma/schema.prisma` 还没有 `AgentRun`；当前仓库里所谓“agent run”只存在于 `src/lib/tasks/tracking.ts` 对 `metadata.agentRuns / runs / executionRuns` 的兼容解析里，这只是展示 fallback，不是系统事实源。
- 当前 `src/actions/task-actions.ts` 只覆盖“从工件创建任务”和“终态回写”，没有 dedicated `execution-actions.ts` 或派发 action；4.2 不应继续把 execution mutation 挤在 `task-actions.ts` 里无限膨胀。
- `Project.settings` 在 schema 中已经存在，但当前仓库还没有项目级 execution settings helper；验收标准里的“项目偏好”不能靠散落在 UI 或 metadata 的临时字段拼出来。
- 现有项目页没有独立“执行中心”页面，任务详情页和 planning detail sheet 是当前最稳定的执行入口；4.2 应顺着这条信息架构演进，而不是凭空开一个新路由。

### 默认实现决策

- **`dispatched` 是“已完成路由、尚未启动执行”的真实状态。** 它必须和 `planned`、`in-progress`、`review` 明确区分；不要把 `in-progress` 当作“已派发”的临时别名。
- **`AgentRun` 采用 append-only 思路。** 4.2 创建首个 run，4.3 重新派发可继续追加新 run；不要把 `Task` 设计成只能有一个 run 的单槽位模型。
- **当前阶段的“运行 ID”就是 `AgentRun.id`。** 在 4.4 的 tmux / supervisor / provider 集成落地前，不要人为引入伪造外部 ID。
- **自动路由指“系统自动选择 agent”，不指“本 story 引入后台轮询器”。** 4.2 应封装共享 dispatch service，供 task detail 的显式派发和未来 auto-ready / supervisor 流复用，但**不要**在本 story 临时造一个隐藏 cron、轮询器或 queue worker。
- **workspace manual 是治理门控，不是建议文案。** 当 workspace 要求人工指定 agent 时，若 task 没有显式偏好，action 必须诚实返回“需要先指定 Agent”，而不是悄悄走自动规则。
- **project preference 先做“轻量默认 agent”而不是完整 DSL。** 4.2 不需要一次性实现复杂路由规则引擎；可先支持 `inherit / codex / claude-code` 这一级默认值，把更细粒度规则留给后续治理 story。
- **路由决策必须解释得清楚。** code-level reason 用稳定 `selectionReasonCode`，user-facing reason 用中文 `selectionReasonSummary`；不要只存布尔值或“system-picked=true”。

### 前序 Story 情报

- **来自 Story 3.4 的关键真值：** `readyState = auto-ready` 只表示“进入自动派发准备顺序”，并不等于已经有 `AgentRun` 或已经启动执行。4.2 不能误把 `auto-ready` 当成 `dispatched`。
- **来自 Story 3.5 的关键守栏：** 列表和详情读取必须以数据库真值为主、JSON 摘要为辅；`taskHandoffSummary.createdTasks` 只是 handoff 摘要，不应取代真实 `Task.status` 和未来的 `AgentRun` relation。
- **来自 Story 4.1 的关键守栏：** `preferredAgentType` 需要作为 task 级显式偏好参与 4.2 决策；`intentDetail` 是对结构化 `intent` 的补充，不可被路由逻辑忽略。
- **来自 2.4 / 2.5 的现有历史视图：** `artifact-task-history` 和 `task-detail-view` 目前已经展示来源工件、写回与 legacy agentRuns fallback。4.2 应升级它们，而不是另建一套 execution 详情真相。

### Git 实现模式情报

- 最近相关提交：
  - `a4ab22d feat: surface planning to execution chain visibility`
  - `1798a6a feat(planning): add execution workflow and history views`
  - `ba4d295 fix(planning): address execution review findings`
  - `339097b feat(planning): add project planning request flow`
- 这些提交说明当前仓库的实现模式是**纵向切片 + 共享读模型演进**：
  - 同一 story 会同时更新 Prisma schema、共享 helper、Server Action、UI 组件和测试。
  - 新状态不会只留在 mutation 层，而会同步打通详情、列表、历史与链路视图。
  - 回归问题大多出现在“truth lives in DB but UI still reads old JSON fallback”这种断层上。
- 4.2 应延续同样模式：不要只写 `dispatchTaskAction()` 然后把 task detail / planning detail / artifact history / tests 全留成半成品。

### 架构一致性要求

- 所有 mutation 继续遵循 `ActionResult<T>`、Zod 顶部校验、`sanitizeError()` 中文错误清洗与 `requireProjectAccess(..., "execute")` 授权边界。
- 领域服务负责协调数据库写入和状态更新；组件只消费共享 view model，不直接判断路由规则真相。
- 4.2 的核心落点应该在 `src/lib/execution/**` 与 `src/actions/execution-actions.ts`；**不要**把路由规则塞进 React 组件、`planning-request-detail-sheet.tsx` 或 `task-actions.ts` 的匿名闭包里。
- `Task.metadata` 只能承载路由摘要和 UI 便利字段；`AgentRun` relation 才是 run 真值。后续 `ExecutionSession`、Heartbeat、Interaction 也应延续“relation-first, metadata-summary-second”。
- 变更后需要精确刷新项目页、任务详情页和 planning detail 视图；不要只依赖客户端局部 state 伪装“已派发”。
- 4.2 只负责 route + dispatch truth，不负责 `tmux` 启动、stdout 监听、心跳、恢复、回写或审批流程 UI 闭环。

### 推荐文件落点

- `prisma/schema.prisma`
  - 新增 `AgentRun`、关系和索引；必要时补 Task/Project settings 相关字段或注释。
- `src/lib/execution/routing.ts`
  - 纯路由决策服务，输出结构化 decision。
- `src/lib/execution/catalog.ts`
  - 执行 agent 的共享标签 / 描述 / helper。
- `src/lib/projects/settings.ts`
  - 解析 `Project.settings` 的项目级 route preference。
- `src/actions/execution-actions.ts`
  - 首次派发 action 与路径刷新。
- `src/lib/audit/events.ts`
  - `task.routed` payload builder。
- `src/lib/db/helpers.ts`
  - `Task` / `PlanningRequest` 查询增加 `agentRuns` relation。
- `src/lib/tasks/types.ts`
  - `dispatched`、agent type、label、shared route summary type.
- `src/lib/tasks/tracking.ts`
  - relation-first `AgentRun` 读取与 legacy fallback.
- `src/components/tasks/task-dispatch-card.tsx`
  - 新增 dispatch / selected-agent UI.
- `src/components/tasks/task-detail-view.tsx`
  - 显示 `dispatched`、route reason、run id、dispatch CTA.
- `src/components/planning/planning-request-detail-sheet.tsx`
  - 让 derived tasks 正确显示 `dispatched` / selected agent.
- `src/components/artifacts/artifact-task-history.tsx`
  - filter/badge/detail 识别 `dispatched`.
- `src/actions/execution-actions.test.ts`
- `src/lib/execution/__tests__/routing.test.ts`
- `src/lib/tasks/__tests__/tracking.test.ts`
- `src/components/tasks/task-detail-view.test.tsx`
- `src/components/planning/planning-request-detail-sheet.test.tsx`
  - 按现有共置测试模式新增 / 扩展。

### 测试要求

- 测试框架继续使用 Vitest。
- 重点覆盖“首次派发”而不是 reroute；4.3 才处理 `dispatched` 后的改派和再次创建 run。
- 必须覆盖竞争与幂等：
  - 同一 task 双击派发不会产生两个 `AgentRun`
  - manual workspace 模式下没有 agent 选择不会越权自动派发
  - task preference / project default / auto heuristic 的优先级稳定
- 必须覆盖 view model 兼容：
  - 旧 `metadata.agentRuns` 仍可展示
  - 新 relation-first 任务不会丢失历史
  - `dispatched` 在详情、链路和历史视图里都有明确中文语义
- 必须覆盖诚实文案：
  - `dispatched` 不是“执行中”
  - `selection-required` 不是“失败”
  - 等待审批的任务不会被偷偷推进到派发状态

### 最新技术信息

- Next.js 官方 `revalidatePath()` 文档仍明确支持在 App Router mutation 后按路径失效缓存；4.2 的 dispatch action 仍应坚持“服务端写入 + 精确 revalidate”而不是只靠客户端本地状态。
- Prisma 官方 transactions 文档强调：相关写入应在同一事务内保持一致。4.2 的 `Task.status` 更新、`AgentRun` 创建与审计事件写入属于同一业务单元，应该放在短事务中完成，避免出现“任务已显示 dispatched，但 run 记录不存在”这类断层。
- React 官方 `useTransition()` 文档依旧适合处理“派发任务 / 保存中”这类非阻塞交互。4.2 如果在 task detail 中加入 dispatch UI，建议继续沿用仓库当前 planning / settings 表单的 transition 模式，而不是手写多个 loading flag。
- 当前仓库真实版本基线仍以 `package.json` 和 `_bmad-output/project-context.md` 为准：Next.js `16.1.6`、React `19.2.3`、Prisma `6.19.2`、Zod `4.3.6`。本 story 不做依赖升级。

### 当前工作树注意事项

- 当前工作树已经存在未提交的 `4-1-任务定义与执行意图提交.md` 与对应 `sprint-status` 更新；4.2 实现前应先确认 4.1 的字段真值（尤其 `preferredAgentType`）是否已经落库。
- 创建 4.2 story 时不要覆盖 4.1 产物；二者是前后依赖关系，不是互斥版本。
- 当前仓库还没有 dedicated `src/lib/projects/` 模块；如果 4.2 需要新增，保持其职责聚焦在 settings / parsing，不要顺手把 Project CRUD 全塞进去。

### 范围边界

**本 Story 包含：**

- ✅ 以 `planned` Task 为起点的 agent 路由与首次派发
- ✅ `AgentRun` 一等真值、`Task.status = dispatched` 和路由审计事件
- ✅ workspace / project / task 三层偏好优先级
- ✅ task detail / planning detail / artifact history 对 `dispatched` 与 selected agent 的兼容
- ✅ route reason 的结构化记录和 UI 诚实表达
- ✅ 幂等与竞争保护测试

**本 Story 不包含：**

- ❌ 不创建 `ExecutionSession`，不启动 `tmux`，不真正启动 codex / claude code 进程（Story 4.4）
- ❌ 不实现重新派发、运行中改派、终止后重建 run（Story 4.3）
- ❌ 不实现实时日志、心跳、交互请求、恢复或风险队列（Epic 5 / 6）
- ❌ 不引入后台轮询器、消息队列或新的基础设施依赖来“自动出队”
- ❌ 不做完整项目级 routing rules UI / DSL，仅支持最小 project default preference
- ❌ 不把 legacy `metadata.agentRuns` 重新定义为长期事实源

### Project Structure Notes

- 4.2 更适合走“共享 execution service + 任务详情入口”的方式，而不是新开一条与 planning 平行的 execution 路由。
- `src/lib/tasks/` 继续承载任务状态与读模型，`src/lib/execution/` 负责 routing / dispatch 逻辑，二者职责应清楚分开。
- 当前 project page 已把 planning detail 和 task detail 深链打通；4.2 最小 UI 成本的入口是 task detail，planning detail 负责展示状态与深链，不必重做一套 dispatch 页面。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2] — Story 4.2 的原始用户故事与验收标准
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3] — reroute / redispatch 属于后续 story
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4] — `ExecutionSession` / `tmux` 会话启动属于后续 story
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 3: 管理路径 - 团队负责人编排任务、设置边界并验收结果] — “实现类优先 `codex`，探索/重构类可切 `claude code`”的产品基线
- [Source: _bmad-output/planning-artifacts/prd.md#Task Orchestration & Agent Routing] — FR18-FR24 的产品能力边界
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions] — Agent Run / Session / 状态机 / execution supervisor 的边界
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries] — `src/lib/execution/**`、`src/actions/execution-actions.ts` 与 relation-first 结构要求
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Interaction] — 系统应尽量自动完成路由与后台协调，同时对用户可见
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Feedback Patterns] — 状态 + 原因 + 下一步 的反馈结构
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Form Patterns] — manual selection / dispatch 表单应低摩擦且上下文感知
- [Source: _bmad-output/project-context.md] — 中文文案、Zod、`ActionResult<T>`、`sanitizeError()` 与版本约束
- [Source: AGENTS.md] — 中文用户文本、Server Actions、错误处理、迁移与测试规则
- [Source: package.json] — 当前仓库真实依赖版本
- [Source: _bmad-output/implementation-artifacts/3-4-规划结果自动衔接执行链路.md] — `planned`、`taskHandoffSummary` 与 `readyState` 的前序语义
- [Source: _bmad-output/implementation-artifacts/3-5-规划到执行派发的完整链路可见性.md] — planning detail 如何消费 derived task 真值与 honest downgrade
- [Source: _bmad-output/implementation-artifacts/4-1-任务定义与执行意图提交.md] — `preferredAgentType` / `intentDetail` / manual planned task 的前序设计
- [Source: prisma/schema.prisma] — 当前 `Task` / `Project.settings` 基线，尚无 `AgentRun`
- [Source: src/actions/task-actions.ts] — 当前任务创建 action 基线
- [Source: src/lib/planning/handoff.ts] — 3.4 对 `planned` / `readyState` / queue position 的已有实现
- [Source: src/lib/planning/queries.ts] — 3.5 对 derived tasks 的读取与展示真值
- [Source: src/lib/tasks/types.ts] — 当前 task 状态、priority、intent 共享类型
- [Source: src/lib/tasks/tracking.ts] — 当前 metadata-based agent run fallback，4.2 需升级为 relation-first
- [Source: src/lib/db/helpers.ts] — 当前 `Task` / `PlanningRequest` 读取入口
- [Source: src/components/tasks/task-detail-view.tsx] — 任务详情现有信息结构
- [Source: src/components/planning/planning-request-detail-sheet.tsx] — derived task 展示与任务详情 deep link
- [Source: src/components/artifacts/artifact-task-history.tsx] — 执行历史视图当前对 task status 与 agent label 的消费方式
- [Source: https://nextjs.org/docs/app/api-reference/functions/revalidatePath] — Next.js 官方 `revalidatePath()` 文档
- [Source: https://www.prisma.io/docs/orm/prisma-client/queries/transactions] — Prisma 官方 transactions 文档
- [Source: https://react.dev/reference/react/useTransition] — React 官方 `useTransition()` 文档

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-04-13 10:58 CST: 依据当前 `sprint-status.yaml` 与既有 4.1 本地 story 产物，锁定下一条 backlog story 为 `4-2-Agent自动路由与选择`，并确认 Epic 4 已处于 `in-progress`。
- 2026-04-13 11:09 CST: 复核 `epics.md`、`prd.md`、`architecture.md`、`ux-design-specification.md`、`project-context.md` 与 3.4/3.5/4.1 story，确认 4.2 的核心责任是“route + dispatch truth”，不是 tmux 或 supervisor 启动。
- 2026-04-13 11:18 CST: 审查 `prisma/schema.prisma`、`src/actions/task-actions.ts`、`src/lib/planning/handoff.ts`、`src/lib/planning/queries.ts`、`src/lib/tasks/tracking.ts`、`src/lib/workspace/types.ts` 与 task detail / planning detail 组件，确认当前仓库具备 `planned` task、`readyState` 与链路详情基础，但还没有 `AgentRun` relation、`dispatched` 状态和 execution action 入口。
- 2026-04-13 11:32 CST: 核对 Next.js / Prisma / React 官方文档，确认 4.2 仍应沿用“短事务 + 精确 revalidate + transition UI”的既有实现模式，不引入额外基础设施。
- 2026-04-17 23:31 CST: 复核当前未提交实现后确认 4.2 的主要真值、路由服务、派发 action 和读模型已经落地，剩余缺口集中在任务详情页缺少 `planned` 状态的首次派发入口。
- 2026-04-17 23:40 CST: 新增 `task-dispatch-card.tsx` 并接入任务详情页，补齐 manual 工作空间下的 Agent 指定 UI 与 `planned -> dispatched` 的首次派发入口，同时保留 `dispatched != running` 的诚实语义。
- 2026-04-17 23:41 CST: 运行 `pnpm test src/components/tasks/task-dispatch-card.test.tsx src/components/tasks/task-detail-view.test.tsx src/actions/execution-actions.test.ts src/lib/execution/__tests__/routing.test.ts`、`pnpm lint ...` 与 `pnpm build`，全部通过。

### Completion Notes List

- 已将 4.2 拆解为“领域真值、纯路由服务、派发 action、读模型/UI 兼容、测试验证”五类实现任务。
- 已显式标出 4.2 的关键护栏：`AgentRun` relation-first、`planned -> dispatched`、manual strategy 不可绕过、route reason 结构化、`dispatched != running`。
- 已把 3.4 / 3.5 / 4.1 的前序依赖串成可执行路径，避免开发时继续沿用 metadata-only run truth 或忽略 `preferredAgentType`。
- 已明确 4.2 与 4.3 / 4.4 / Epic 5 的边界，防止在本 story 提前越界到 reroute、tmux、日志和心跳。
- 已为 `planned` 任务补齐任务详情页的首次派发入口：自动路由工作空间展示直接派发 CTA，manual 工作空间展示显式 Agent 选择并调用 `dispatchTaskAction()`。
- 已把工作空间路由偏好从服务端任务详情页传递给前端派发卡片，避免在客户端重复猜测治理策略。
- 已通过相关单测、lint 和完整 `pnpm build` 验证当前 4.2 改动，任务详情页、派发 action 与路由决策链路能够一起编译通过。

### File List

- `_bmad-output/implementation-artifacts/4-2-Agent自动路由与选择.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `prisma/schema.prisma`
- `src/actions/execution-actions.ts`
- `src/actions/execution-actions.test.ts`
- `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/tasks/[taskId]/page.tsx`
- `src/components/artifacts/artifact-task-history.tsx`
- `src/components/planning/planning-request-detail-sheet.tsx`
- `src/components/tasks/task-dispatch-card.test.tsx`
- `src/components/tasks/task-dispatch-card.tsx`
- `src/components/tasks/task-detail-view.test.tsx`
- `src/components/tasks/task-detail-view.tsx`
- `src/lib/audit/events.ts`
- `src/lib/db/helpers.ts`
- `src/lib/errors.ts`
- `src/lib/execution/__tests__/routing.test.ts`
- `src/lib/execution/catalog.ts`
- `src/lib/execution/dispatch.ts`
- `src/lib/execution/routing.ts`
- `src/lib/projects/settings.ts`
- `src/lib/tasks/tracking.ts`
- `src/lib/tasks/types.ts`

### Change Log

- 2026-04-13: 创建 Story 4.2，补齐首次派发、AgentRun 真值、路由优先级、审计与 UI/读模型兼容的完整开发上下文
- 2026-04-17: 完成 4.2 实现并补齐任务详情页首次派发入口，验证路由服务、派发 action、相关测试、lint 与生产构建均通过
