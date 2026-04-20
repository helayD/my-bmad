# Story 4.4: tmux后台执行会话创建与管理

Status: in-review

## Story

作为系统，
我希望能为任务创建、管理和结束 tmux 后台执行会话，
以便编码 agent 在 self-hosted 环境中稳定运行。

## Acceptance Criteria

1. **Given** `AgentRun` 已创建且准备执行
   **When** 执行监督器启动任务
   **Then** 创建独立的 tmux session，session 名称包含任务 ID 以便识别
   **And** 创建 `ExecutionSession` 记录，关联到 `AgentRun`，包含 session 名称、PID、启动时间（FR21）
   **And** 在 tmux session 中启动选定的 agent（`codex` 或 `claude code`）

2. **Given** tmux session 已创建
   **When** 查看 `ExecutionSession` 记录
   **Then** 记录包含 `sessionName`、`agentRunId`、`taskId`、`projectId`、`workspaceId`、状态和时间戳
   **And** `Task`、`AgentRun` 与 `ExecutionSession` 之间的关联关系完整且一致（FR22）

3. **Given** 任务执行完成或被终止
   **When** 执行监督器检测到结束条件
   **Then** 执行 tmux session 清理（关闭 session）
   **And** `ExecutionSession` 状态更新为 `COMPLETED` 或 `TERMINATED`
   **And** 清理动作记录到审计日志

## Tasks / Subtasks

> **建议实现顺序：** Task 1（建立 `ExecutionSession` 真值与状态语义）→ Task 2（落实 agent 命令与工作目录解析）→ Task 3（封装 `tmux` adapter）→ Task 4（落地 supervisor 启动 / 清理编排）→ Task 5（打通读模型、详情与审计）→ Task 6（测试与验证）

- [x] Task 1: 建立 `ExecutionSession` 一等真值、关系与状态语义 (AC: #1, #2, #3)
  - [x] 1.1 在 `prisma/schema.prisma` 中新增 `ExecutionSession` model，至少关联 `Workspace`、`Project`、`Task`、`AgentRun`，字段至少包括：`id`、`workspaceId`、`projectId`、`taskId`、`agentRunId`、`transport`、`sessionName`、`processPid`、`status`、`startedAt`、`completedAt`、`terminatedAt`、`terminationReasonCode`、`terminationReasonSummary`、`metadata Json?`、`createdAt`、`updatedAt`；**不要**继续只把 session 真值放在 `Task.metadata.activeExecutionSession`。
  - [x] 1.2 `ExecutionSession.agentRunId` 应保持一对一唯一关系，延续 4.2 / 4.3 的 append-only `AgentRun` 设计；后续重试、恢复或 reroute 应通过新 `AgentRun` + 新 `ExecutionSession` 追加链路，而不是复用旧 session 记录。
  - [x] 1.3 `ExecutionSession.status` 建议使用仓库现有风格的 lower-case 真值，例如 `starting`、`running`、`completed`、`terminated`、`failed`，并在共享类型 / label helper 中把 AC 的 `COMPLETED` / `TERMINATED` 映射到 `completed` / `terminated`；**不要**新增一套只在 UI 可见的平行枚举。
  - [x] 1.4 在 `src/lib/tasks/types.ts`（或与 execution 更贴近的共享类型模块）补齐 `ExecutionSession` 状态类型、中文标签和 view model，供 task detail / 历史 / 后续 session API 共用；不要让组件各自手写 session 状态文案。
  - [x] 1.5 `processPid` 必须记录 tmux pane 中实际 agent 进程的 PID，而不是短生命周期 `tmux` 客户端子进程的 PID；建议通过 tmux format `#{pane_pid}` 取值，并在 story 实现中明确这一点，避免后续 4.6 / 5.x 误把错误 PID 当作治理对象。
  - [x] 1.6 为 `ExecutionSession` 增加必要索引，例如 `sessionName` 唯一、`projectId + status + createdAt`、`taskId + createdAt`、`workspaceId + createdAt`；4.5 的并发、5.x 的监控和 7.x 的审计检索都会复用这条链路。
  - [x] 1.7 继续保留 `Task.metadata.activeExecutionSession` / `AgentRun.metadata.activeExecutionSession` 作为**摘要 / 兼容层**，但 relation-first 真值应切换到 `ExecutionSession`；4.3 的 `resolveActiveExecutionSessionHandle()` 后续要优先读 relation，再回退 metadata。

- [x] Task 2: 明确 agent 启动命令、工作目录与执行前置条件 (AC: #1, #3)
  - [ ] 2.1 扩展 `src/lib/execution/catalog.ts`（或新增紧邻模块）让执行 agent 不只暴露 label，还能解析“启动命令 / 参数模板 / 需要的环境约束”；**不要**把 `"codex"` 或 `"claude-code"` 直接当成永远正确的可执行命令名硬编码到 supervisor 里。
  - [ ] 2.2 启动前必须解析项目的本地执行根目录。优先复用 `src/lib/content-provider/project-provider.ts` 中已有的 `toProjectRepoProviderConfig()`、`createProjectContentProvider()` 或等价 project repo helper，从 `Project.repo` 与 `Repo.localPath` 取受控本地路径；仅当 `repo.sourceType = "local"` 且 `localPath` 通过现有 provider 校验时才允许启动。若项目尚未绑定可执行的本地仓库根目录，应诚实阻止启动并返回中文错误（例如“当前项目还没有可用于 self-hosted 执行的本地目录”），而不是退回 dashboard 仓库根目录或 `process.cwd()`。
  - [ ] 2.3 继续复用现有本地路径安全思路（`src/lib/content-provider/`、`path-safety.ts`、`LocalProvider` 等已有边界），至少保证 4.4 启动时 `cwd` 落在项目授权根目录；**不要**因为 4.6 还没开始就暂时放弃工作目录约束。
  - [ ] 2.4 对 agent 启动命令缺失、`tmux` 不可用、项目无本地目录、当前 `Task.status !== "dispatched"`、`Task.currentAgentRunId` 不匹配等前置条件，统一返回结构化错误码并走 `sanitizeError()` 中文错误消息；4.4 不要用英文 stderr 原文直接暴露给用户。
  - [ ] 2.5 4.4 只负责“启动选定 agent 并把它放进 tmux 会话”，不负责注入完整动态交互、日志采集或心跳监听；但命令构造必须为 5.x 预留扩展位，例如 `cwd`、环境变量、prompt / task context 文件路径或 supervisor session ref。

- [x] Task 3: 在 `src/lib/execution/tmux/` 下封装可测试的 tmux adapter (AC: #1, #3)
  - [ ] 3.1 新增 `src/lib/execution/tmux/` 子域，至少拆出“session name builder”“spawn/exec adapter”“result parser”“error mapper”；**不要**把 `tmux new-session ...`、`tmux has-session ...`、`tmux kill-session ...` 字符串散落在 action、组件和测试里。
  - [ ] 3.2 session 命名必须**包含任务 ID**以满足 AC，同时建议带上 `AgentRun.id` 形成稳定且避免冲突的命名，例如 `task-<taskId>-run-<agentRunId>` 或其安全缩短形式；只用 task ID 一旦 reroute / retry 追加新 run，就容易复用旧 session 名导致冲突。
  - [ ] 3.3 创建 session 时优先使用显式参数而不是 shell 拼接字符串：使用 `node:child_process` 的 `spawn()` / `execFile()` 传递参数数组，避免 `exec()` 带来的 shell quoting、特殊字符转义和 `maxBuffer` 风险；不要让 task 标题、目录路径或命令参数通过拼接字符串进入 shell。
  - [ ] 3.4 创建流程至少覆盖：`has-session` 预检查（或等价探测）、`new-session -d -s <sessionName> -c <projectRoot> ...` 创建 detached session、必要时通过 `-P` / format 输出拿到 session 标识，然后用 `list-panes -t <sessionName> -F "#{pane_pid}"` 读取 agent 进程 PID。
  - [ ] 3.5 清理流程至少覆盖：对目标 session 执行 `kill-session -t <sessionName>`，并把“session 已不存在”视为可接受的幂等结果；**不要**因为清理时目标已被外部关闭就把数据库状态永远卡在 running。
  - [ ] 3.6 如果 adapter 需要长期脱离调用者进程存活，应遵循 Node 官方 child process 约束：未消费 stdout/stderr 时不要保留默认 pipe；必要时使用 `stdio: "ignore"` 与 `subprocess.unref()`。但 4.4 启动 tmux 客户端本身通常是短生命周期控制命令，不应误把它当成长跑 agent 进程。
  - [ ] 3.7 adapter 层需统一把 tmux 非零退出、二进制缺失、session 冲突、PID 解析失败等情况映射为 execution domain 错误码，例如 `TMUX_NOT_AVAILABLE`、`EXECUTION_SESSION_CREATE_FAILED`、`EXECUTION_SESSION_ALREADY_EXISTS`、`EXECUTION_SESSION_CLEANUP_FAILED`，便于 action / UI / 审计一致消费。

- [x] Task 4: 落地 supervisor 的最小具体运行单元与两阶段启动 / 清理编排 (AC: #1, #3)
  - [x] 4.1 在 `src/lib/execution/supervisor/` 中新增 4.4 的启动编排服务，例如 `launch.ts` / `lifecycle.ts`；职责是“claim 一个 `dispatched` run → 调用 tmux adapter 创建 session → 持久化 `ExecutionSession` → 更新 `Task` / `AgentRun` 真值 → 写审计”。**不要**把整个编排塞回 `execution-actions.ts`。
  - [x] 4.2 4.4 需要把 architecture 里尚未具体化的 `executor-supervisor` 运行单元落成最小可调用入口。建议做法是“领域服务 + 狭义 driver / script / internal supervisor entrypoint”；可以是 `scripts/executor-supervisor.ts` 或等价入口，但**不要**在 Web 请求里偷偷跑无限轮询或后台 daemon。
  - [x] 4.3 启动流程必须采用**两阶段 + 补偿**模式，而不是长事务包住外部 I/O：
    - 第一步：短事务 claim 当前 task/run 仍可启动，并写入“正在创建执行会话”的中间真值
    - 第二步：调用 tmux adapter 创建 session、解析 `sessionName` 与 `processPid`
    - 第三步：第二个短事务创建 `ExecutionSession`，更新 `AgentRun.status = "running"`、`Task.status = "in-progress"`、`Task.currentStage` / `nextStep` / `currentActivity`
    - 若第三步持久化失败：立即执行补偿清理，关闭刚创建的 tmux session，避免留下孤儿 session
  - [x] 4.3a 若 tmux 创建失败、agent 命令启动失败或 PID 解析失败，且系统尚未成功落库为真实运行态，则必须把 `AgentRun.status` 记为 `failed`，同时保持 `Task.status = "dispatched"`，并把 `currentStage` / `currentActivity` / `nextStep` 诚实更新为“会话启动失败，等待修复环境后重试或重新派发”；**不要**把任务误标成 `in-progress`，也不要静默把失败吞掉。
  - [x] 4.4 `Task.status` 进入真正执行态后应从 `dispatched` 变为 `in-progress`，`AgentRun.status` 变为 `running`；这能保持 4.2 的“已派发未启动”和 4.4 的“已经开始执行”诚实分层。**不要**让 session 已经存在时任务仍长期停留在 `dispatched`。
  - [x] 4.4a 为了满足 PRD / UX 中“区分已派发、已启动、执行中”的要求，建议把生命周期文案集中扩展到 `src/lib/tasks/defaults.ts`（或等价 lifecycle helper），至少统一“正在创建会话”“已启动”“会话启动失败”等 `currentStage` / `currentActivity` / `nextStep` 文案；**不要**在 dispatch、redispatch、supervisor 多处散落硬编码字符串。
  - [x] 4.5 启动成功时，`Task.metadata` / `AgentRun.metadata` 仅写入 session 摘要与 UI 便利字段，例如：
    - `activeExecutionSession.transport = "tmux"`
    - `activeExecutionSession.sessionRef = sessionName`
    - `activeExecutionSession.sessionName`
    - `activeExecutionSession.processPid`
    - `activeExecutionSession.startedAt`
    - `currentActivity = "执行监督器已创建 tmux 会话，Agent 正在运行。"`
    但这些字段只能是摘要，`ExecutionSession` relation 才是事实源。
  - [x] 4.6 清理 / 结束流程应支持至少两种结果：
    - 正常结束：`ExecutionSession.status = "completed"`，`AgentRun.status = "completed"`
    - 人工 / 系统终止：`ExecutionSession.status = "terminated"`，`AgentRun.status = "terminated"`
    同时清除 active session 摘要。若 4.4 尚未接上 2.5 / 5.x 的完整回写与结果整理，不要伪造 `Task.status = "done"`；应诚实设置“执行已结束，等待结果整理 / 回写链路接手”。
  - [x] 4.7 当前已有的 `src/lib/execution/supervisor/termination.ts` 是 4.3 为运行中 reroute 准备的狭义边界。4.4 必须把它升级为 relation-first：优先根据 `ExecutionSession` 读取 session handle，再回退 metadata；不要让 4.3 永远依赖临时 JSON 摘要。
  - [ ] 4.8 启动与清理都必须具备幂等保护：同一个 `AgentRun` 不能创建两条活跃 `ExecutionSession`；重复清理已结束 session 时应返回诚实 no-op，而不是抛出内部异常。

- [x] Task 5: 打通读模型、任务详情、审计与最小 session 可见性 (AC: #2, #3)
  - [ ] 5.1 更新 `src/lib/db/helpers.ts` 的 `getTaskById()`、task history 查询和 planning-derived task 查询，把 `ExecutionSession` relation 作为正式读取字段带出；**不要**要求下游 UI 再额外查库拼 session。
  - [ ] 5.2 `src/lib/tasks/tracking.ts` 与相关 view model 应支持 current session 摘要，例如 session 名、PID、状态、开始 / 结束时间、终止说明；若旧数据尚未有 relation，继续使用 metadata fallback 做诚实降级。
  - [ ] 5.3 `src/components/tasks/task-detail-view.tsx` 应补充 session 信息区块，至少展示：
    - 当前 `AgentRun`
    - `ExecutionSession.sessionName`
    - `ExecutionSession.status`
    - `processPid`
    - `startedAt`
    - 若已结束则展示 `completedAt` / `terminatedAt` 与原因
    文案仍遵循“状态 + 原因 + 下一步”，不要只显示“tmux 已启动”。若启动失败但任务仍停留在 `dispatched`，详情页必须明确告诉用户“失败发生在会话启动层”，而不是继续显示“等待启动”。
  - [ ] 5.4 若 4.4 需要一个 route handler，范围限定为**只读** session snapshot（例如 `src/app/api/sessions/[sessionId]/route.ts` 或按 task 查询当前 session），为后续 Epic 5 的轮询 / SSE 预留接口；不要在 4.4 直接做完整日志流、心跳流或交互流。
  - [ ] 5.5 在 `src/lib/audit/events.ts` 中补 session 生命周期审计 builder，建议至少包含 `executionSession.started`、`executionSession.completed`、`executionSession.terminated`，并补一条“启动失败”审计事件（如 `executionSession.startFailed` 或等价 past-tense 事件名）；payload 至少带上 `taskId`、`agentRunId`、`executionSessionId`、`sessionName`、`processPid`、错误码 / 终止原因、触发主体或来源。
  - [ ] 5.6 4.4 不需要新建独立“Sessions 管理页”或主导航，但 task detail、planning detail、artifact history 至少要能消费 session 真值，不然 AC #2 的“查看 ExecutionSession 记录”会沦为只能靠数据库手查。

- [x] Task 6: 补齐 tmux / supervisor / session 读模型的测试与验证 (AC: #1, #2, #3)
  - [ ] 6.1 为 `src/lib/execution/tmux/` 增加 adapter 测试，覆盖：session 名生成、`new-session` / `kill-session` 参数构造、`pane_pid` 解析、session 已存在、`tmux` 缺失、stderr 非零映射。
  - [ ] 6.2 为 `src/lib/execution/supervisor/` 增加生命周期测试，覆盖：
    - `dispatched` run 成功启动，创建 `ExecutionSession`
    - 启动后 `Task.status = "in-progress"`、`AgentRun.status = "running"`
    - tmux / agent 启动失败时 `AgentRun.status = "failed"`，`Task.status` 仍保持 `dispatched`
    - 第二事务失败时执行补偿清理
    - 正常完成与人工终止分别更新为 `completed` / `terminated`
    - 同一 run 重复启动不会生成第二条活跃 session
  - [ ] 6.3 扩展 `src/actions/execution-actions.test.ts` 或新增 supervisor 调用边界测试，覆盖前置条件缺失（无本地目录、无 agent 启动命令、无当前 run、run 已有 session、tmux 不可用）时的中文错误反馈。
  - [ ] 6.4 扩展 `src/lib/tasks/__tests__/tracking.test.ts`、`task-detail-view.test.tsx` 与必要的 planning / artifact history 测试，确认 relation-first session 读取、metadata fallback、session 状态标签和中文说明都稳定。
  - [ ] 6.5 验证步骤至少包含：`pnpm lint`、相关 Vitest 套件、`pnpm build`。如果 CI / 本地环境没有 `tmux`，测试中应通过 adapter mock / fake driver 覆盖命令层，而不是跳过核心生命周期测试。

## Dev Notes

### 当前基线与关键依赖

- Story 4.2 已把“首次派发”的真实语义立住：`Task.status = "dispatched"` 仅表示已完成路由、尚未真正启动执行；`AgentRun` 是 append-only run 真值。4.4 的职责是把这个 `dispatched` run 变成实际运行中的 self-hosted 会话，而不是重做路由。
- Story 4.3 已新增 `Task.currentAgentRunId`、replacement run 链路与 `src/lib/execution/supervisor/termination.ts`。但当前 termination boundary 仍主要依赖 `metadata.activeExecutionSession` 摘要，4.4 需要把它升级成 relation-first `ExecutionSession` 真值。
- 当前 Prisma schema 已有 `Task.currentAgentRunId` 与 `AgentRun`，但**仍没有** `ExecutionSession` model；当前代码树也还没有真正的 `src/lib/execution/tmux/` 子域和 `src/app/api/sessions/` 路由。
- 当前 task detail、planning detail 和 artifact history 已经能消费 `AgentRun` 真值。这意味着 4.4 不应新开平行 execution 页面，而应继续沿用“共享读模型 + 详情页反映最新状态”的仓库模式。
- 当前项目对本地目录和文件访问已有安全基础设施（`src/lib/content-provider/`、`path-safety.ts`、`LocalProvider`）；4.4 不应为了图快直接无约束地在任意 `cwd` 启动 tmux。
- 当前仓库已经有 `src/lib/content-provider/project-provider.ts`，包含 `toProjectRepoProviderConfig()` 与 `createProjectContentProvider()`；4.4 应直接复用这条 project→repo→provider 解析链，而不是手写第三套 `Project.repo` / `localPath` 读取逻辑。

### 默认实现决策

- **`ExecutionSession` 必须是 relation-first 事实源。** `Task.metadata.activeExecutionSession` 和 `AgentRun.metadata.activeExecutionSession` 只能做摘要与兼容层。
- **session 名必须同时包含 task ID 与 run ID。** 这既满足 AC 的“包含任务 ID”，也避免 reroute / retry 后沿用同一个 task ID 发生命名冲突。
- **`processPid` 必须记录 pane 中实际 agent 进程 PID。** 不要把 `tmux` 控制命令本身的短命 PID 或 Node 子进程 PID 误记为长期监督对象。
- **启动与清理都采用“短事务 + 外部 I/O + 补偿”模式。** 4.4 不应把 `tmux` 创建 / 关闭包在 Prisma interactive transaction 里长时间占锁。
- **会话启动失败前不要推进成运行态。** 如果失败发生在 session 创建或 agent 启动阶段，应把 `AgentRun` 标成 `failed`，同时让 `Task` 保持在可重试 / 可改派的 `dispatched` 真值，并诚实告诉用户失败层级。
- **`dispatched` 与 `in-progress` 必须继续诚实区分。** session 真正创建并成功启动后，任务才进入 `in-progress`；结束或终止后再按真实后续链路推进。
- **4.4 不要假装已经完成 Epic 5 / 6。** 本 story 只做 session 生命周期与最小可见性，不做实时日志、心跳、交互转发、自动恢复和风险队列。
- **agent 标签不等于 agent 启动命令。** 4.4 必须把实际可执行命令与参数作为显式配置 / catalog 解析结果，而不是把展示 label 当 shell 命令拼接。

### 前序 Story 情报

- **来自 Story 4.2 的守栏：**
  - `Task.status = "dispatched"` 是“等待执行监督器创建会话并启动”
  - `AgentRun` 为 append-only run 历史
  - `routingDecision` 已经有结构化摘要，不需要 4.4 重新发明第二套 route truth
- **来自 Story 4.3 的守栏：**
  - 运行中 reroute 依赖一个“可安全终止当前会话”的 supervisor boundary
  - reroute 成功后 `Task.status` 会回到 `dispatched`，等待新会话启动
  - 4.4 必须提供真实 session truth，否则 4.3 将一直停留在 metadata-only 过渡态
- **来自 PRD / Architecture 的守栏：**
  - 控制面与执行面要职责分离，UI 不能直接操作 `tmux`
  - self-hosted 执行限定在与项目同机的本地环境
  - `Task` / `AgentRun` / `ExecutionSession` 的状态必须一致，避免状态漂移

### Git 实现模式情报

- 最近相关提交：
  - `eb1ea0f chore: commit outstanding workspace changes`
  - `a4ab22d feat: surface planning to execution chain visibility`
  - `1798a6a feat(planning): add execution workflow and history views`
  - `ba4d295 fix(planning): address execution review findings`
- 当前仓库的实现模式仍是**纵向切片 + 共享读模型同步演进**：
  - Prisma schema、领域服务、Server Action / driver、UI 与测试会一起推进
  - review finding 常集中在“数据库真值变了，但详情 / 历史 / tests 还沿用旧 fallback”
  - 因此 4.4 不要只把 tmux 启动服务做出来，还要同步打通详情、审计与 session 摘要读取

### 架构一致性要求

- 所有对内 mutation / supervisor boundary 继续遵循 `ActionResult<T>`、Zod 顶部校验、`sanitizeError()` 中文错误清洗，以及服务端权限 / 治理边界。
- 控制面 / 执行面的边界必须清晰：React 组件和终端详情页只显示状态，不直接执行 `tmux` 命令；真正的创建 / 清理必须经过 `src/lib/execution/supervisor/**`。
- `src/lib/execution/tmux/**` 负责 shell / CLI 细节，`src/lib/execution/supervisor/**` 负责生命周期编排，`src/lib/tasks/**` 负责读模型与展示 helper；三层职责不要混写。
- `Task` / `AgentRun` / `ExecutionSession` 的状态必须同步更新，避免出现“Task 显示运行中但 session 已不存在”或“session 还在但 Task 仍是 dispatched”的漂移。
- 4.4 需要为后续 5.x 的日志、心跳和交互留钩子，但**不要**在本 story 中直接实现这些高频实时能力。

### 推荐文件落点

- `prisma/schema.prisma`
  - 新增 `ExecutionSession` model、关系和索引。
- `prisma/migrations/<timestamp>_add_execution_session/`
  - schema 迁移。
- `src/lib/execution/tmux/`
  - `naming.ts`、`client.ts`、`errors.ts`、`types.ts` 或等价模块。
- `src/lib/execution/catalog.ts`
  - 扩展 agent 启动命令 / 运行约束解析。
- `src/lib/execution/supervisor/launch.ts`
  - 负责从 `dispatched` run 启动 session。
- `src/lib/execution/supervisor/lifecycle.ts`
  - 负责完成 / 终止 / 清理。
- `src/lib/execution/supervisor/termination.ts`
  - 从 metadata-first 升级为 relation-first session handle 读取。
- `src/lib/db/helpers.ts`
  - 查询 task / history / planning detail 时带出 `ExecutionSession`。
- `src/lib/tasks/types.ts`
  - session status、label、view model。
- `src/lib/tasks/tracking.ts`
  - relation-first session summary 与 fallback 解析。
- `src/components/tasks/task-detail-view.tsx`
  - 展示当前 session 信息。
- `src/components/artifacts/artifact-task-history.tsx`
  - 若当前任务已有 session，显示最小会话摘要。
- `src/components/planning/planning-request-detail-sheet.tsx`
  - derived task 列表消费当前 session 状态摘要。
- `src/lib/audit/events.ts`
  - session 生命周期审计 builder。
- `src/actions/execution-actions.ts`
  - 若需要暴露狭义启动 / 终止边界，保持范围聚焦。
- `src/app/api/sessions/`
  - 仅在确需 read-only session snapshot 时落地最小 route handler。
- `src/lib/execution/__tests__/`
  - tmux adapter / supervisor 生命周期测试。
- `src/components/tasks/task-detail-view.test.tsx`
- `src/lib/tasks/__tests__/tracking.test.ts`

### 测试要求

- 测试框架继续使用 Vitest。
- 必须覆盖 4.4 的核心真值：
  - 启动成功会创建 `ExecutionSession`
  - `Task.status` 从 `dispatched` 进入 `in-progress`
  - `AgentRun.status` 变为 `running`
  - metadata 仅保留摘要，不替代 relation
- 必须覆盖补偿与幂等：
  - tmux 创建成功但数据库写入失败时会清理孤儿 session
  - 同一 `AgentRun` 重复启动不会创建第二条活跃 session
  - 清理已消失 session 时不会让系统陷入不可恢复错误
- 必须覆盖前置条件与诚实文案：
  - 项目缺少本地执行根目录时拒绝启动
  - agent 启动命令未配置时拒绝启动
  - `tmux` 不可用时给出中文、可操作错误
  - `completed` / `terminated` 区分清楚，不伪装成 `done`
- 必须覆盖 relation-first 读取：
  - task detail / history 先读 `ExecutionSession`
  - metadata fallback 仍兼容旧数据与 4.3 过渡态

### 最新技术信息

- tmux 官方手册当前仍明确：session 是可 detached 后持续存在的后台终端集合；`new-session` 用于创建 detached session，`kill-session` 用于销毁目标 session，`has-session` 可用于探测目标 session 是否存在；`pane_pid` format 变量可返回 pane 首个进程 PID。4.4 应直接利用这些 tmux 原语，而不是自造 shell 轮询协议。  
- Node.js 官方 `child_process` 文档当前仍强调：`spawn()` 异步创建子进程，默认 `stdio` 为 pipe；如果输出无人消费，pipe 容量打满会阻塞子进程；`exec()` 通过 shell 执行命令，带来 quoting 与 buffer 风险。4.4 的 tmux adapter 应优先使用参数数组的 `spawn()` / `execFile()`，不要用字符串拼接 shell 命令。  
- Node.js 官方同页也说明：若确实需要让长运行子进程脱离父进程，应配合 `detached`、`stdio: "ignore"` 与 `subprocess.unref()`。4.4 的 tmux 控制命令通常是短命控制进程，不必误把 tmux client 当成真正的长跑 agent 进程管理对象。  
- Prisma 官方 transactions 文档当前仍强调：interactive transaction 要尽量短，避免在事务中执行网络请求或慢操作，并建议尽快“get in and out”；同页也继续推荐 idempotency 与 OCC 处理 read-modify-write 场景。4.4 的 session 启动 / 清理显然属于“数据库更新 + 外部进程控制”的两阶段编排，不应把 tmux I/O 放进长事务。  
- Next.js 官方 `revalidatePath()` 文档当前仍支持在 Server Functions / Route Handlers 中精确失效缓存。如果 4.4 暴露狭义启动 / 终止 action，成功后仍应精确刷新任务详情与项目页面，而不是只靠客户端局部 state。  
- 当前仓库真实版本基线仍以 `package.json` 与 `_bmad-output/project-context.md` 为准：Next.js `16.1.6`、React `19.2.3`、Prisma `6.19.2`、Zod `4.3.6`。本 story 不做依赖升级。

### 当前工作树注意事项

- 当前工作树已经存在未提交的 4.1 / 4.2 / 4.3 story 文档、`sprint-status.yaml` 更新，以及一批 execution / task detail / tracking / planning detail 相关代码改动。4.4 实现时必须在这些现有改动上继续演进，**不要**回退或覆盖。
- 当前未提交代码里已经出现：
  - `src/actions/execution-actions.ts`
  - `src/lib/execution/dispatch.ts`
  - `src/lib/execution/redispatch.ts`
  - `src/lib/execution/supervisor/termination.ts`
  - `src/lib/projects/settings.ts`
  - `task-detail-view` / `artifact-task-history` / `planning-request-detail-sheet` 的执行链路展示
  4.4 应直接复用这些基线，而不是再开第三套 execution truth。
- 当前 schema 已含 `Task.currentAgentRunId` 与 `AgentRun`；4.4 只需继续补 `ExecutionSession`，不应重做 4.2 / 4.3 已经确立的 run 关系设计。
- 当前仓库仍没有真正的 `src/lib/execution/tmux/` 子域，也没有 session route handler；4.4 应聚焦把这些最小能力补齐，不要顺手实现 Epic 5 / 6 的实时监控与恢复全家桶。

### 范围边界

**本 Story 包含：**

- ✅ `ExecutionSession` 一等数据模型与 `Task` / `AgentRun` / `ExecutionSession` 关系链
- ✅ tmux session 创建、存在性探测、PID 解析与销毁
- ✅ `dispatched` run 启动为真实执行会话，并把任务推进到 `in-progress`
- ✅ 正常完成 / 人工终止时的 session 清理与审计
- ✅ task detail / 读模型中的最小 session 可见性
- ✅ 为 4.3 termination boundary 提供 relation-first session truth

**本 Story 不包含：**

- ❌ 不实现实时日志流、原始日志查看、日志摘要聚合（Epic 5）
- ❌ 不实现心跳上报、状态可信度与连续运行监控（Epic 5）
- ❌ 不实现执行中交互请求识别、补充指令注入与动态上下文输入（Epic 5 / 6）
- ❌ 不实现自动恢复、风险队列、异常调查工作台（Epic 6）
- ❌ 不实现同项目 10 任务并发配额、队列拥塞与优雅降级全逻辑（Story 4.5）
- ❌ 不实现完整执行边界 / 敏感路径保护策略引擎（Story 4.6 负责加强）

### Project Structure Notes

- 4.4 最自然的落点仍是 `src/lib/execution/**` 作为生命周期核心，`src/components/tasks/task-detail-view.tsx` 作为当前最稳定的可见性承载面。
- `src/app/api/sessions/` 只应承接最小 read-only session snapshot，不要在 4.4 就把 execution monitoring UI 做成独立主导航。
- `src/lib/tasks/` 继续承载 view model、label 与历史汇总；`src/lib/execution/` 承载进程与 tmux 细节；`src/lib/audit/` 承载可追溯事件。三者职责要保持清晰。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4] — Story 4.4 的原始用户故事与验收标准
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2] — `dispatched` 与 `AgentRun` 首次派发真值
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3] — reroute 对活跃 session truth 的前置依赖
- [Source: _bmad-output/planning-artifacts/prd.md#FR21: 系统可以为任务创建、管理和结束后台执行会话。] — 会话生命周期的产品能力边界
- [Source: _bmad-output/planning-artifacts/prd.md#FR22: 系统可以维护任务、agent run 与后台执行会话之间的一致关联关系。] — 关系一致性要求
- [Source: _bmad-output/planning-artifacts/prd.md#Technical Constraints] — self-hosted + tmux + 状态可信 的基础约束
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 1: 主用户成功路径 - 独立开发者把一个 Story 交给系统持续推进] — 创建后台 session 后用户应看到执行已启动
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 4: 支持/排障路径 - 运维或支持人员调查异常任务并快速接管] — session 必须可被追踪和调查
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions] — 控制面 / 执行面拆分、状态机与审计要求
- [Source: _bmad-output/planning-artifacts/architecture.md#Infrastructure & Deployment] — `web` 与 `executor-supervisor` 运行角色
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries] — `src/lib/execution/tmux/`、`src/lib/execution/supervisor/`、`src/app/api/sessions/`
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Feedback Patterns] — 状态 + 原因 + 下一步
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Journey 2 - 任务异常后自动恢复或升级到人工接管] — 运行时 session 必须可终止、可接管、可解释
- [Source: _bmad-output/project-context.md] — 中文文案、Zod、`ActionResult<T>`、`sanitizeError()` 与版本基线
- [Source: AGENTS.md] — 中文用户文本、Server Actions、迁移、Tailwind 与测试约束
- [Source: package.json] — 当前依赖版本与脚本
- [Source: prisma/schema.prisma] — 当前已有 `Task.currentAgentRunId` 与 `AgentRun`，尚无 `ExecutionSession`
- [Source: src/lib/execution/catalog.ts] — 当前 agent catalog 只含 label / description
- [Source: src/lib/execution/dispatch.ts] — 4.2 的 `dispatched` 真值与 routing summary
- [Source: src/lib/execution/redispatch.ts] — 4.3 当前对 `activeExecutionSession` 摘要的依赖方式
- [Source: src/lib/execution/supervisor/termination.ts] — 当前最小 termination boundary
- [Source: src/lib/db/helpers.ts] — task / history 查询入口
- [Source: src/lib/tasks/tracking.ts] — relation-first run 读模型与 fallback 解析
- [Source: src/components/tasks/task-detail-view.tsx] — 任务详情当前信息结构
- [Source: src/components/artifacts/artifact-task-history.tsx] — 历史视图当前执行链路展示入口
- [Source: src/components/planning/planning-request-detail-sheet.tsx] — planning-derived task 链路详情
- [Source: https://man.openbsd.org/tmux.1] — tmux 官方手册（`new-session`、`kill-session`、`has-session`、`pane_pid`）
- [Source: https://nodejs.org/api/child_process.html] — Node.js 官方 `child_process` 文档
- [Source: https://www.prisma.io/docs/orm/prisma-client/queries/transactions] — Prisma 官方 transactions / idempotency / OCC 文档
- [Source: https://nextjs.org/docs/app/api-reference/functions/revalidatePath] — Next.js 官方 `revalidatePath()` 文档

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-04-16 11:07 CST: 按 `bmad-create-story` 工作流读取 `_bmad/bmm/config.yaml`、`_bmad-output/implementation-artifacts/sprint-status.yaml`，锁定当前第一条 backlog 为 `4-4-tmux后台执行会话创建与管理`。
- 2026-04-16 11:12 CST: 复核 `epics.md`、`prd.md`、`architecture.md`、`ux-design-specification.md` 与 `project-context.md`，确认 4.4 的核心职责是把 `dispatched` run 落地为真实 tmux 会话，并建立 `ExecutionSession` 一等真值。
- 2026-04-16 11:20 CST: 审查 `prisma/schema.prisma`、`src/lib/execution/dispatch.ts`、`redispatch.ts`、`termination.ts`、`db/helpers.ts`、`task-detail-view.tsx`，确认当前仓库已有 `AgentRun` / `currentAgentRunId` / reroute 基线，但尚无 `ExecutionSession` 与 tmux adapter。
- 2026-04-16 11:27 CST: 核对最近提交与当前脏工作树，确认 execution 相关改动尚未提交，4.4 必须在这些既有改动基础上继续演进，不能回退。
- 2026-04-16 11:34 CST: 复核 tmux、Node.js child_process、Prisma transactions 与 Next.js revalidatePath 官方文档，整理出“pane PID、spawn 参数数组、短事务 + 补偿、精确 revalidate”的 4.4 技术守栏。
