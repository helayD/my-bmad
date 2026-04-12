# Story 3.2: 规划意图识别与 Agent/Skill 选择

Status: review

## Story

作为系统，
我希望能识别用户的规划请求需要先规划后执行，并自动选择合适的 PM 型 agent 与 BMAD skills 组合，
以便正确调度规划链路而不是直接进入编码执行。

## Acceptance Criteria

1. **Given** 规划请求已创建 **When** 系统分析请求目标文本 **Then** 系统判断该请求属于“需要先规划”还是“可直接执行”（FR14）
   **And** 对于需要规划的请求，选择合适的 PM 型 agent（如 `bmad-agent-pm`、`bmad-agent-architect`）和 BMAD skills 组合（如 `bmad-create-prd`、`bmad-create-architecture`、`bmad-create-epics-and-stories`）

2. **Given** 系统已完成意图识别 **When** 选择结果确定 **Then** 系统记录选择的 agent 类型、skill 组合和选择理由
   **And** 将规划请求状态更新为“规划中”

3. **Given** 请求被判定为可直接执行（如“修复登录页面的按钮颜色”） **When** 系统完成意图分析 **Then** 系统跳过规划链路，将请求路由到执行链路（衔接 Epic 4）
   **And** 通知用户该请求将直接进入执行

## Tasks / Subtasks

> **建议实现顺序：** Task 1（建立意图识别真值模型） → Task 2（实现分类与选择引擎） → Task 3（落地 action 与幂等状态流转） → Task 4（补项目页反馈与直接执行提示） → Task 5（测试与验证）

- [x] Task 1: 扩展 `PlanningRequest` 的意图识别真值模型与选择目录 (AC: #1, #2, #3)
  - [x] 1.1 在 `prisma/schema.prisma` 中为 `PlanningRequest` 增加**显式核心字段**而不是把核心决策塞回 `metadata`：建议至少包括 `routeType`（`planning` / `direct-execution`）、`selectionReasonCode`、`selectionReasonSummary`、`selectedAgentKeys`、`selectedSkillKeys`、`analyzedAt`；这些字段会成为 3.3~3.5 的上游事实源。
  - [x] 1.2 为 `PlanningRequest` 状态补一个能诚实表达“已判定直达执行、等待执行链衔接”的值，例如 `execution-ready`（中文标签可为“待进入执行”）；**不要**把直达执行请求硬标成 `planning` 或 `completed`，避免 UI 对当前阶段说谎。
  - [x] 1.3 `selectedAgentKeys` / `selectedSkillKeys` 优先使用 PostgreSQL 可查询的标量列表（`String[]`）保存有序 key 列表，避免把本该稳定查询的键数组丢进无类型 JSON；仅把未来可能变化较大的 handoff 草稿、启发式命中明细等不规则附加信息放入 `Json` 字段或 `metadata`。
  - [x] 1.4 在 `src/lib/planning/types.ts` 中集中定义 `PlanningRequestRoute`、`PlanningSelectionReasonCode`、新的状态值/中文标签/默认进度，以及 direct-execution 场景的 next-step 文案；不要在 action、组件、测试里散落硬编码字符串。
  - [x] 1.5 新增 `src/lib/planning/catalog.ts`（或等价文件）维护**规范化**的 PM agent 与 BMAD skill 目录，key 应与当前仓库已安装 skill 名称保持一致，例如 `bmad-agent-pm`、`bmad-agent-architect`、`bmad-create-prd`、`bmad-create-architecture`、`bmad-create-epics-and-stories`；**不要**在 action 里临时拼散乱的人类标签或每次请求时动态扫描 `.agents/skills`。
  - [x] 1.6 如果新增 `executionHandoffDraft` 等字段，用它保存后续 Epic 4 可消费的草稿负载（如建议任务目标、建议 intent、是否需要仓库、来源为 `planning-request`），但此字段只表示“准备好衔接”，**不是**实际 `Task` / `AgentRun`。
  - [x] 1.7 如果 3.2 要把意图识别结果写入审计链，优先为 `AuditEvent` 增加可选 `planningRequestId`；若本轮不扩表，至少保证 `planningRequestId` 被写入审计 payload，且后续查询 helper 不依赖 `taskId` / `artifactId` 才能找到这类事件。

- [x] Task 2: 实现确定性、可解释、偏保守的规划意图识别与 Agent/Skill 选择引擎 (AC: #1, #2, #3)
  - [x] 2.1 在 `src/lib/planning/intent.ts`（或等价模块）实现纯函数分析器，输入至少包含 `rawGoal`、项目是否已关联 repo、必要的项目上下文摘要，输出 route、选择的 agent/skills、有序 skill pipeline、理由码、中文原因说明、下一步文案与建议进度。
  - [x] 2.2 规则默认**偏向规划而不是直达执行**：当请求范围模糊、涉及新功能/跨页面/需求拆解/信息架构/流程重构/架构变更/权限与数据模型调整时，一律归为 `planning`；仅在目标足够窄、变更面小、可明确落到现有代码修改、且项目已有关联 repo 时，才允许 `direct-execution`。
  - [x] 2.3 若项目**未关联 repo**，分类器不应把请求直接送入 `direct-execution`，而应优先回落到 `planning`；否则用户会在“可执行”提示后立刻撞上执行环境缺失，破坏 3.1 刚建立的低摩擦体验。
  - [x] 2.4 选择 skill pipeline 时要体现顺序和最小充分性：常规产品/功能规划默认至少走 `bmad-create-prd` → `bmad-create-epics-and-stories`；只有目标明确涉及技术方案、架构约束、集成边界、性能/安全/部署设计时，才补 `bmad-agent-architect` / `bmad-create-architecture`，避免所有请求都被无差别过度规划。
  - [x] 2.5 为每次判断生成**机器可统计**的 reason code + **用户可理解**的中文理由摘要，例如“目标包含跨模块功能建设与工件生成诉求，需要先进入规划链路”；不要只存无法聚合的长自由文本。
  - [x] 2.6 分类引擎应保持纯函数、可单测、可重放；**不要**在该层直接调用数据库、Server Action、BMAD skill 执行器或文件系统扫描。

- [x] Task 3: 通过独立 action 落地意图识别、选择记录与幂等状态推进 (AC: #1, #2, #3)
  - [x] 3.1 在 `src/actions/planning-actions.ts` 中新增 `analyzePlanningRequestAction`（或等价入口），与 `createPlanningRequestAction` 保持职责分离：3.1 负责“创建并立即反馈”，3.2 负责“后续分析并更新选择结果”；不要把所有逻辑重新揉回一个超长 create action，避免 3.1 的即时反馈退化。
  - [x] 3.2 action 顶部继续使用 Zod 校验 `workspaceId`、`projectId`、`planningRequestId`，并复用 `getAuthenticatedSession()` + `requireProjectAccess(..., "execute")`；任何用户可见错误继续走 `sanitizeError()`，新增错误码文案必须写入 `src/lib/errors.ts` 且保持中文。
  - [x] 3.3 action 只应分析**当前仍处于待分析状态**的请求（如 `analyzing`）；若请求已完成分析或已失败，应返回幂等结果或显式 no-op，防止刷新/重复点击/并发触发导致选择结果被反复覆盖。
  - [x] 3.4 并发保护不要只靠“先查再写”判断，优先采用条件更新或等价 compare-and-swap 模式，例如基于 `id + status = analyzing` 的原子更新；否则两个并发请求仍可能重复分析并覆盖结果。
  - [x] 3.5 用 Prisma 短事务把 `PlanningRequest` 更新与关键审计事件写入保持一致；建议新增 `planningRequest.intentResolved` 审计事件，载荷包含 `planningRequestId`、`routeType`、`selectedAgentKeys`、`selectedSkillKeys`、`selectionReasonCode` 和核心摘要。
  - [x] 3.6 mutation 成功后精确 `revalidatePath(`/workspace/${workspaceSlug}/project/${projectSlug}`)`；不要只刷新泛化 dashboard 路径，也不要依赖客户端拼接“分析已完成”的假状态。
  - [x] 3.7 对于 `direct-execution` 结果，仅写入 handoff draft 与 next-step 说明，例如“下一步将进入执行任务定义/派发链路”；**不要**在本 Story 中偷跑 Epic 4 去创建真实 `Task`、设置未来未定的 Task 状态值，或直接选择 `codex` / `claude code`。
  - [x] 3.8 这条链路的 action 不应调用真实 BMAD skill 工作流，也不应生成 PRD / Epic / Story / Task 文件；3.2 的目标是“决定怎么走”，不是“开始执行规划”。

- [x] Task 4: 在项目级规划 UI 中呈现可解释的选择结果与直达执行提示 (AC: #2, #3)
  - [x] 4.1 扩展 `src/lib/planning/queries.ts`、`PlanningRequestListItem` 与相关 select，使项目页能够读取 route、选择的 agent/skills、理由摘要、分析时间和 handoff 摘要；这些字段应由服务端真值提供，而不是客户端猜测。
  - [x] 4.2 在 `src/components/planning/planning-request-composer.tsx` 中沿用当前 `startTransition` / `router.refresh()` 模式，在请求创建成功后触发分析 action；用户应先看到“已接收/分析中”，再自然过渡到“规划中”或“待进入执行”，而不是完全静默。
  - [x] 4.3 在 `src/components/planning/planning-request-list.tsx` 中新增 route 与选择摘要展示，例如“需要先规划”/“直接进入执行”徽标、已选 PM agent、skill 序列、理由说明与下一步；所有文案保持中文，并继续满足“状态 + 原因 + 下一步”反馈结构。
  - [x] 4.4 对 `direct-execution` 结果给出明确但不夸大的提示：应告诉用户“此请求将跳过 BMAD 规划，进入执行链准备阶段”，并说明当前是否还缺少 repo/执行前置信息；**不要**直接宣称“已开始编码”或“已派发给某 agent”。
  - [x] 4.5 若分析失败，项目页应显示可操作的失败提示和重试入口，且失败原因要尽量具体到“规则无法确定/缺少必要上下文/保存失败”等层级，而不是只剩一个笼统 toast。

- [x] Task 5: 补齐规则引擎、action 与 UI 的回归测试 (AC: #1, #2, #3)
  - [x] 5.1 新增 `src/lib/planning/intent.test.ts`（或等价测试），覆盖至少：新功能/跨模块目标 => `planning`；窄范围 bugfix 且有 repo => `direct-execution`；无 repo 的窄目标 => 回落 `planning`；包含架构/集成/性能关键词 => 增加 architect / architecture skill；模糊目标 => 默认 `planning`。
  - [x] 5.2 扩展 `src/actions/planning-actions.test.ts`，覆盖：未登录、权限不足、请求不存在、请求已分析的幂等保护、分析结果持久化、审计事件写入、精确路径刷新、direct-execution 只写 handoff draft 不创建 `Task`。
  - [x] 5.3 扩展 `src/components/planning/planning-request-composer.test.tsx` 与 `planning-request-list` 测试，覆盖：创建后自动触发分析、分析完成后列表更新、direct-execution 提示、失败重试提示、route/skills 徽标渲染。
  - [x] 5.4 若新增 Prisma 字段、状态值或错误码，补齐对应纯单测，确保 label、progress、reason code、catalog 顺序和默认 next-step 稳定，不因后续故事随手改字符串而破坏行为。
  - [x] 5.5 至少运行本 Story 相关 `pnpm test`；如改动 Prisma schema 或 server actions，补跑 `pnpm lint`，并在 Story 记录中注明仓库既有阻塞而非把失败静默吞掉。

## Dev Notes

### 当前基线与关键依赖

- Story 3.1 已经建立独立 `PlanningRequest` 域、项目页入口、最近请求列表和 `analyzing` 初始状态。3.2 的正确做法是**沿着现有 planning 域向前扩展**，而不是回退去复用 `Task`、`artifact-detail-sheet` 或执行任务表单。
- 当前 `PlanningRequest` 只保存 `rawGoal`、`status`、`progressPercent`、`nextStep` 和 `metadata`，项目页列表也只展示这些字段。这意味着 3.2 必须补足“为什么这样选、选了谁、下一步去哪”的真值字段和读取形状，否则 3.5 无法可靠展示链路。
- `createPlanningRequestAction()` 当前只负责创建记录并 `revalidatePath()`，测试里还明确写了“without requiring audit writes”。3.2 可以在**分析 action**里引入审计，但不要把 3.1 的创建路径重新改造成一条过长的同步大事务。
- `PlanningRequestComposer` 已经使用 `useTransition`、`submitLockRef`、`toast` 和 `router.refresh()`；如果 3.2 加第二次 action 调用，必须保持“立即有回音”而不是把用户重新扔回不可解释的等待。
- `ProjectPage` 已经无条件渲染 planning composer，即使 `project.repo` 为空也允许发起规划请求。3.2 的分类器因此必须把“项目是否有关联 repo”视为输入条件，而不是假设所有请求都能直接进入执行。

### 默认实现决策

- **创建与分析分步进行：** 推荐保留 3.1 的创建 action 只做“落库 + 已接收反馈”，新增独立分析 action 紧接着执行。这样既保留了真实阶段变化，也为未来把分析迁到后台 worker 或更长链路执行做好接口边界。
- **核心决策字段显式建模：** route、reason、selected agents/skills、analyzedAt 这些都会驱动 3.3~3.5，不应仅存在于 JSON 元数据里。JSON 更适合放未来会演化的 handoff draft 或规则命中细节。
- **偏保守路由：** 对范围不清或无 repo 的请求默认走 `planning`。宁可多做一次轻量规划，也不要把本该先澄清/拆解的目标直接送进执行链，制造后续错误的“自动化假象”。
- **直达执行只准备 handoff，不真正派发：** 3.2 的 deliverable 是“判断 + 记录 + 提示”，不是“执行任务真正创建/分配/启动”。真正 `Task` / `AgentRun` / agent 选择属于 Epic 4 与 Story 3.4 之后的工作。
- **目录与 key 稳定优先：** 选择目录中的 skill key 以当前 `.agents/skills/` 下存在的名字为准，并在代码中集中维护；不要让 UI 文案、测试断言和数据库值各用一套名字。

### 架构一致性要求

- 继续遵循 `src/actions` / `src/lib` / `src/components` 分层：Server Actions 负责权限校验与事务提交，`src/lib/planning/` 放纯规则、目录、类型与查询，组件只负责展示与局部交互。
- 内部 mutation 继续返回 `ActionResult<T>`，错误码进 `src/lib/errors.ts`，用户可见文本全部中文；不要引入裸异常、英文错误或局部自定义 response shape。
- 所有写操作都继续显式带 `workspaceId` 与 `projectId` 约束，避免未来 3.5 详情页或审计链出现跨项目串读。
- 关键决策应写入审计事件，命名遵循过去时 + 点分语义，例如 `planningRequest.intentResolved`；**不要**再造一套单独“规划日志表”。
- 分析规则必须是可重放、可测试的纯逻辑模块，避免把规则散落在 action、组件和测试桩里，造成一个行为三套定义。
- direct-execution handoff 若需要保存结构化草稿，优先让字段/类型为未来 Epic 4 可消费；不要把 handoff payload 设计成只能让当前 UI 看懂的展示专用碎片。

### Project Structure Notes

- `src/lib/planning/` 是本 Story 的主落点：catalog、intent 规则、types、queries 都应留在 planning 子域内，不要把规划意图识别塞进 `src/lib/tasks/`、`src/lib/execution/` 或页面组件。
- `src/components/planning/*` 继续只负责项目页交互和状态展示；数据库写入、权限判断和审计落盘必须留在 Server Actions / 服务端 helper。
- `src/actions/planning-actions.ts` 已经是规划域入口，3.2 应在这里扩展分析 action，而不是新建一个与 planning 平行但职责重叠的 actions 文件。
- 当前 `src/lib/planning/queries.ts` 和 `PlanningRequestList` 只认识 3.1 的字段形状；一旦引入新状态、route 和 skill 列表，必须同步扩展类型、select、badge 映射和列表渲染，避免新增状态在 UI 中退化成未知字符串。
- 当前 `AuditEvent` 只显式关联 `taskId` / `artifactId`；如果 3.2 写规划审计事件却不补关联策略，后续链路可见性会很难落地。这是本 Story 最需要提前修正的结构缺口之一。

### 直接执行路径的关键护栏

- 当前仓库已有 `Task` 模型与从工件发起执行的路径，但它们是**工件驱动**的执行入口，不是“自然语言目标直达执行”的上游；3.2 不应把自然语言请求伪装成某个 `sourceArtifactId` 不存在的任务。
- 当前 `Task` 生命周期仍使用 `pending / in-progress / review / done / blocked`，而 `epics.md` 的 Epic 4 文案里提到 `PLANNED / DISPATCHED`。在 Epic 4 还未对齐前，3.2 **不要**提前发明新的 Task 状态落库或把 direct-execution 绑死到尚未定稿的 execution lifecycle。
- Story 1.6 的 `agentRoutingPreference` 只是工作空间级“自动/手动”执行路由偏好，用于未来 `codex` / `claude code` 选择；3.2 选择的是 PM 型 agent 与 BMAD skills，二者不是同一个决策层。
- 如果 direct-execution 最终需要进入执行链，当前 Story 只保存 handoff draft、next-step 和 route summary；真正“创建任务表单”“选 codex 还是 claude code”“派发运行”留给 Epic 4。
- 如果规则无法稳定判断，宁可落到 `planning` 并给出明确理由，也不要为了“看起来更自动”把高不确定性请求送进 direct-execution。

### 上一条 Story 3.1 的 learnings

- 3.1 的最大收益是把规划请求从执行任务里拆了出来，给 3.2 留出了独立演进空间；因此 3.2 继续坚持“PlanningRequest 是一等领域对象”，不要倒退。
- 3.1 明确要求“无仓库项目也能先发起规划”，这条约束在 3.2 依旧成立。唯一变化是：无 repo 时不应给出会误导用户的“直接进入执行”结论。
- 3.1 当前项目页反馈结构已经遵循“阶段 + 进度 + 下一步”。3.2 只需要在此基础上补“为什么这样判断”和“选了哪些 agent/skills”，不需要另起一个完整详情页。
- 3.1 已经把 `DEFAULT_PLANNING_REQUEST_NEXT_STEP` 设为“等待系统识别规划意图并选择 PM Agent 与 Skills”；3.2 应真正消化掉这条 next step，而不是另起平行文案体系。

### Git Intelligence

- 最近的 `feat(planning): add project planning request flow` 提交新建了 `src/lib/planning/types.ts`、`src/lib/planning/queries.ts`、`src/actions/planning-actions.ts`、`src/components/planning/*` 和项目页入口，说明 planning 能力已经形成独立模块边界。3.2 应继续在这些文件/目录上扩展，而不是把规则塞回 `src/lib/tasks/` 或 `src/components/workspace/`。
- `feat(workspace): Story 1.7 — 项目导入与BMAD上下文关联` 新建了项目详情页与 `ProjectNoRepo` 分支，这就是 3.2 需要继续兼容“无 repo 也能先工作”的根因。
- `feat(workspace): Story 1.6 — 团队级执行与治理策略配置` 说明工作空间已经有执行治理设置，但当前只到“auto/manual”层级。3.2 不应误用这组设置去表达 PM 选型或 BMAD skill 编排。

### 最新技术信息

- **Next.js 16 中 `revalidatePath()` 仍只能在 Server Functions / Route Handlers 调用。** 官方文档也明确说明：若要刷新单个项目页，传入具体 URL 最稳妥；不要在 Client Component 或随意泛化路径上调用。
- **Better Auth 在 Next.js 16 下继续支持 `auth.api.getSession({ headers: await headers() })` 的服务端读取模式。** 这与当前仓库 `getAuthenticatedSession()` 的封装一致，3.2 无需另起一套 session 获取逻辑。
- **Prisma 官方建议把复杂多写逻辑放在短事务里。** 交互式事务虽然可用，但文档强调事务应保持短小，避免长事务引发性能和死锁风险；3.2 的“更新请求 + 写审计事件”应是短事务，不要把规则推理或未来 skill 执行塞进事务体。
- **Prisma 的 `Json` 字段默认是无类型的，而且读取时会返回整个 JSON 对象。** 因此 route、selected skills、reason code 这类需要稳定查询和类型保护的核心字段不适合只放在 Json；JSON 更适合 handoff 草稿或调试命中明细。
- **PostgreSQL 标量列表在 Prisma 中是可创建、追加和过滤的。** 对于有序 skill key / agent key 数组，这比无类型 JSON 更适合做稳定存储与后续过滤。
- **Prisma 7 仍然带着 ESM、driver adapter、环境变量与生成路径等 breaking changes。** 仓库当前固定在 Prisma 6.19.2，且已使用 `prisma-client` generator；本 Story 只应做业务字段扩展，不应顺手升级 Prisma 大版本。

### 文档冲突与来源优先级

- **范围与顺序以 `epics.md` + `sprint-status.yaml` 为准。** 当前 `architecture.md` 的 “Requirements to Structure Mapping” 仍保留旧编号，把 Epic 3 映射成任务路由/执行模块，这与当前拆解不一致；实现 3.2 时继续以当前 Epic 3 定义为准。
- `prd.md` 的 `Initial Epic Candidates` 同样保留过早版本的史诗编号，更多用于追溯而非当前执行顺序。
- 若现有 task/execution 代码路径与本 Story 冲突，以“3.2 先完成 planning intent selection，不提前进入 Epic 4”作为优先边界。

### 当前代码落点与推荐修改文件

- `prisma/schema.prisma`
  - 为 `PlanningRequest` 增加 route / selection / handoff 相关字段与必要索引。
- `src/lib/planning/types.ts`
  - 扩展 route、reason code、状态、label、progress 与 handoff 类型。
- `src/lib/planning/catalog.ts`
  - 新增 PM agent / BMAD skill 目录与默认 bundle 映射。
- `src/lib/planning/intent.ts`
  - 新增纯函数规则引擎与选择结果输出。
- `src/lib/planning/queries.ts`
  - 扩展项目页查询形状，返回 route / selected skills / analyzedAt / reason summary。
- `src/actions/planning-actions.ts`
  - 新增分析 action，做权限校验、幂等保护、事务更新与 revalidate。
- `src/components/planning/planning-request-composer.tsx`
  - 在创建成功后触发分析，并展示阶段过渡与失败提示。
- `src/components/planning/planning-request-list.tsx`
  - 展示 route、skill pipeline、理由摘要与 direct-execution 提示。
- `src/lib/errors.ts`
  - 新增意图分析、选择落库、重复分析等错误码中文文案。
- `src/lib/audit/events.ts` 或 `src/lib/planning/audit.ts`
  - 增加规划意图识别相关审计载荷构造。
- `src/lib/planning/intent.test.ts`
  - 规则引擎的纯单测。
- `src/actions/planning-actions.test.ts`
  - 分析 action 的权限、幂等、持久化与 direct-execution 行为测试。
- `src/components/planning/*.test.tsx`
  - 创建后自动分析、UI 反馈和失败重试测试。

### 范围边界

**本 Story 范围：**

- ✅ 识别自然语言规划请求是“先规划”还是“可直接执行”
- ✅ 选择 PM 型 agent 与 BMAD skill 组合，并记录理由
- ✅ 将选择结果写回 `PlanningRequest` 并在项目页可见
- ✅ 为 direct-execution 结果准备 handoff draft 与用户提示
- ✅ 为规则、action、UI 反馈补齐测试

**本 Story 不包含：**

- ❌ 不实际执行 `bmad-create-prd` / `bmad-create-architecture` / `bmad-create-epics-and-stories`（Story 3.3）
- ❌ 不生成或更新 PRD / Epic / Story / Task 工件（Story 3.3）
- ❌ 不真正创建执行 `Task`、选择 `codex` / `claude code` 或创建 `AgentRun`（Epic 4）
- ❌ 不实现完整规划链路详情页或历史筛选中心（Story 3.5）
- ❌ 不启动 `tmux`、supervisor、日志监听、心跳、writeback 或 review 流程

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 3] — Epic 3 的目标、范围与后续 Stories 依赖
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2] — Story 3.2 的用户故事与验收标准
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3] — 规划执行与工件生成属于后续 Story，不应在 3.2 越界
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4] — direct-execution / handoff 只需衔接，不需提前完整实现
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1] — Task 创建属于执行链的后续故事，当前仅可准备 handoff 草稿
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2] — `codex` / `claude code` 的执行 agent 路由属于 Epic 4，不是 3.2 的 PM 选型
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 1] — 从自然语言目标先识别是否需要规划，再衔接执行的主成功路径
- [Source: _bmad-output/planning-artifacts/prd.md#Planning & PM Skill Orchestration] — FR13-FR17 的产品能力定义
- [Source: _bmad-output/planning-artifacts/prd.md#Performance] — 规划请求创建与状态反馈应在可接受时延内完成
- [Source: _bmad-output/planning-artifacts/prd.md#Security] — 未授权用户不得读取或触发项目级规划/执行数据
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — 核心实体 + 状态投影 + 事件审计的建模原则
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] — `workspaceId` / `projectId` 边界、授权分层与最小权限
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns] — Server Actions、结构化错误与幂等/事务要求
- [Source: _bmad-output/planning-artifacts/architecture.md#Structure Patterns] — `src/actions` / `src/lib` / `src/components` 的职责边界
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Effortless Interactions] — 发起后必须快速得到清晰反馈
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Critical Success Moments] — 第一次看到系统“真的接单并推进”的关键时刻
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Experience Principles] — “委托必须有回音”“状态必须说真话”
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Experience Mechanics] — 发起、观察、反馈、完成四阶段体验要求
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Feedback Patterns] — “状态 + 原因 + 下一步”的统一反馈模式
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Responsive Design & Accessibility] — 关键状态不能只靠颜色表达
- [Source: _bmad-output/project-context.md] — `ActionResult<T>`、Zod 校验、中文文案、`revalidatePath()`、Better Auth 与目录边界约束
- [Source: AGENTS.md] — Tailwind、Server Actions、错误处理、测试位置与中文用户文案规范
- [Source: _bmad-output/implementation-artifacts/3-1-自然语言目标输入与规划请求创建.md] — 当前 planning 域基线、无 repo 可提交约束与上一个 Story 的 learnings
- [Source: src/actions/planning-actions.ts] — 现有规划创建与读取 action 的模式和边界
- [Source: src/lib/planning/types.ts] — 当前规划状态、初始阶段与文案定义
- [Source: src/lib/planning/queries.ts] — 当前项目页规划请求查询形状
- [Source: src/components/planning/planning-request-composer.tsx] — 创建后反馈与 client island 交互模式
- [Source: src/components/planning/planning-request-list.tsx] — 当前项目页状态卡展示能力
- [Source: src/lib/workspace/types.ts] — `agentRoutingPreference` 仅是执行侧 auto/manual 偏好，不是 PM 选型
- [Source: src/lib/workspace/permissions.ts] — `requireProjectAccess()` 权限分层模式
- [Source: src/lib/errors.ts] — 错误码与中文错误消息约束
- [Source: src/lib/tasks/types.ts] — 当前 Task / intent / status 基线，说明 3.2 不应提前发明执行状态
- [Source: package.json] — 版本基线：Next.js 16.1.6、Better Auth 1.4.18、Prisma 6.19.2、Zod 4.3.6、Vitest 4.0.18
- [Source: https://nextjs.org/docs/app/api-reference/functions/revalidatePath] — Next.js 官方 `revalidatePath()` 文档
- [Source: https://better-auth.com/docs/integrations/next] — Better Auth 官方 Next.js 集成与 `auth.api.getSession()` 服务端模式
- [Source: https://www.prisma.io/docs/orm/prisma-client/queries/transactions] — Prisma 官方事务文档
- [Source: https://docs.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields] — Prisma `Json` 字段的适用场景与类型限制
- [Source: https://docs.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-scalar-lists-arrays] — Prisma/PostgreSQL 标量列表的存储与过滤能力
- [Source: https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7] — Prisma 7 升级 breaking changes，说明本 Story 不应顺手升级大版本

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-04-11 13:31 CST: 按 `sprint-status.yaml` 的顺序锁定当前 backlog story 为 `3-2-规划意图识别与Agent-Skill选择`，确认其前置 3.1 已存在并处于 `review`。
- 2026-04-11 13:38 CST: 完整读取 Epic 3、PRD、架构、UX 与 `project-context.md`，确认 3.2 的目标是“做路由判断与选择记录”，不是提前执行 skill 或创建执行任务。
- 2026-04-11 13:46 CST: 审查当前 `PlanningRequest` 代码基线，确认现有 planning 域已独立存在于 `src/lib/planning/`、`src/actions/planning-actions.ts` 和项目页 planning composer/list 中。
- 2026-04-11 13:53 CST: 结合 `Task` / `workspace settings` 代码确认 direct-execution 与 Epic 4 仍有边界差距，决定在 Story 中明确要求“仅保存 handoff draft，不提前创建 Task / AgentRun”。
- 2026-04-11 14:01 CST: 复查官方文档，确认 Next.js `revalidatePath()`、Better Auth Next.js 集成、Prisma 事务 / Json / scalar lists 以及 Prisma 7 升级边界，补入最新技术信息与建模护栏。
- 2026-04-11 15:58 CST: 完成 `PlanningRequest` 真值字段、`execution-ready` 状态、`planningRequestId` 审计关联和 Prisma migration，补齐 planning 类型、目录与 handoff draft 模型。
- 2026-04-11 16:10 CST: 实现 `analyzePlanningRequestAction` / `retryAnalyzePlanningRequestAction`、确定性规则引擎、规划审计事件与项目页 route/skills/失败重试 UI。
- 2026-04-11 16:25 CST: 运行 `pnpm db:generate`、Story 定向测试与 `pnpm lint`；全量 `pnpm test` 被仓库现有 integration suite 的 `DATABASE_URL` 测试库守卫阻断，已记录为环境阻塞而非本 Story 回归。

### Implementation Plan

- 在 `PlanningRequest` 上补齐 route、selected agents/skills、reason、analyzedAt 与 handoff draft 真值字段，并同步扩展 `src/lib/planning/types.ts`。
- 新增 `src/lib/planning/catalog.ts` 与 `src/lib/planning/intent.ts`，把 PM agent/skill 目录和规则引擎做成纯函数可测试模块。
- 通过独立 `analyzePlanningRequestAction` 实现权限校验、幂等保护、事务更新、审计事件与项目页精确刷新。
- 扩展项目页 planning UI，让请求在“已接收”后自然显示 route、reason、selected agents/skills 与 direct-execution 提示。
- 用规则引擎单测、action 测试与组件测试把“保守分类、无 repo 不直达执行、direct-execution 不提前创建 Task”这些关键护栏锁住。

### Completion Notes List

- 已为 `PlanningRequest` 显式补齐 route、reason、selected agents/skills、analyzedAt 与 `executionHandoffDraft`，并新增 `execution-ready` 状态与中文元数据。
- 新增 `src/lib/planning/catalog.ts` 与 `src/lib/planning/intent.ts`，以纯函数规则引擎实现保守分类、架构型技能补齐和 direct-execution handoff draft 生成。
- 在 `src/actions/planning-actions.ts` 中新增分析与重试 action，使用 Zod 校验、`requireProjectAccess(..., "execute")`、compare-and-swap 条件更新、短事务审计写入与精确 `revalidatePath()`。
- 项目页 planning composer 现在会在创建成功后自动触发分析；请求列表会展示 route、理由、PM Agent、Skill 序列、direct-execution 提示与失败重试入口。
- 已补充 `types` / `intent` / `action` / `composer` / `list` 回归测试；`pnpm db:generate`、Story 定向 `pnpm test` 与 `pnpm lint` 通过。
- 全量 `pnpm test` 未能跑通，原因是仓库现有 13 个 workspace integration suites 要求 `DATABASE_URL` 指向测试库；这属于环境守卫阻塞，不是本 Story 新引入的失败。

### File List

- _bmad-output/implementation-artifacts/3-2-规划意图识别与Agent-Skill选择.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- prisma/schema.prisma
- prisma/migrations/20260411143000_add_planning_request_intent_selection/migration.sql
- src/actions/planning-actions.ts
- src/actions/planning-actions.test.ts
- src/components/planning/planning-request-composer.tsx
- src/components/planning/planning-request-composer.test.tsx
- src/components/planning/planning-request-list.tsx
- src/components/planning/planning-request-list.test.tsx
- src/lib/audit/events.ts
- src/lib/errors.ts
- src/lib/planning/catalog.ts
- src/lib/planning/intent.ts
- src/lib/planning/intent.test.ts
- src/lib/planning/queries.ts
- src/lib/planning/types.ts
- src/lib/planning/types.test.ts

### Change Log

- 2026-04-11: 创建 Story 3.2 的开发上下文文档，并将状态设为 `ready-for-dev`。
- 2026-04-11: 完成规划意图识别与 Agent/Skill 选择实现，补齐 schema、action、UI、审计与回归测试，并将状态更新为 `review`。
