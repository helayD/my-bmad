---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
inputDocuments:
  - /Users/helay/Documents/GitHub/my-bmad/_bmad-output/planning-artifacts/prd.md
  - /Users/helay/Documents/GitHub/my-bmad/_bmad-output/project-context.md
workflowType: 'architecture'
project_name: 'my-bmad'
user_name: 'David'
date: '2026-04-04T18:55:01+08:00'
lastStep: 8
status: 'complete'
completedAt: '2026-04-04T19:03:02+08:00'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
PRD 定义了 66 条功能需求，覆盖 11 个能力域：工作空间与组织管理、BMAD 工件上下文管理、规划与 PM 技能编排、任务编排与 agent 路由、长时间运行执行与 agent 交互、执行可视化与进度追踪、恢复与人工干预、治理与审计、团队协作与通知、集成与平台扩展、商业化与配额控制。
从架构角度看，这不是一个单纯的 CRUD SaaS，而是一个围绕 BMAD 工件、执行任务、Agent Run、tmux Session、日志、心跳、产物和回写链路构建的研发执行控制面。核心含义是：必须建立稳定的领域对象映射、清晰的生命周期状态机，以及“规划链路”和“执行链路”之间的可靠衔接机制。

**Non-Functional Requirements:**
NFR 对架构影响非常强，主要集中在以下方面：
- 性能：控制面关键页面首屏反馈需在 2-3 秒内完成，任务派发与启动反馈需要在 30 秒内可见，心跳状态变化延迟需小于 15 秒。
- 安全：必须保证租户、团队、项目、任务、执行记录与产物的严格访问控制；敏感配置与凭据不得泄露；关键治理操作必须可追溯。
- 可靠性与可恢复性：系统必须检测 Task / Agent Run / tmux Session 状态漂移；关键异常 15 秒内检测、30 秒内首次自动恢复、恢复失败后进入人工接管；关键上下文需在 60 秒内可恢复。
- 可扩展性：需要从个人模式平滑升级到团队模式，并支持项目数、成员数、任务量、审计规模增长至少一个数量级。
- 可访问性：核心治理与异常处理路径需满足键盘可达、语义化信息表达和 WCAG 2.1 AA 基线。
- 可集成性与可观测性：API / Webhook / Event 接口需要稳定契约、版本演进能力、幂等处理与统一授权审计；日志、状态变化、交互请求、人工回应和回写结果都必须具备完整追踪。

**Scale & Complexity:**
这是一个高复杂度、接近企业级治理要求的全栈控制平台。复杂性不只来自多角色 SaaS，而是来自“云端控制面 + 本地 self-hosted 执行面 + 长时间运行 agent + 可治理状态机”这几个维度的耦合。

- Primary domain: 全栈 Web 控制面 / 执行编排平台
- Complexity level: high
- Estimated architectural components: 12-15 个核心子系统

### Technical Constraints & Dependencies

- 项目属于 brownfield，现有技术栈为 Next.js App Router、React、TypeScript strict、Prisma/PostgreSQL、Better Auth、Tailwind、Vitest、Zod。
- MVP 控制面限定为 Web，不包含原生移动端、桌面客户端或 CLI 控制面。
- 执行面限定为与项目同机的 single-host self-hosted 模式，通过 `tmux` 承载后台执行；MVP 不做跨主机分布式调度。
- 平台必须深度集成 BMAD 工件流，至少保持 PRD / Epic / Story / Task 与执行任务之间的稳定映射和结果回写。
- 平台必须支持 `codex` 与 `claude code` 的任务路由，并在长时间运行中持续监听输出、状态变化与交互请求。
- 现有项目上下文要求后续实现遵循既有约束：Server Actions 返回统一 `ActionResult<T>`、优先复用认证与数据 helper、使用 `@/` 别名、遵循缓存失效机制、保持本地文件访问安全边界。
- 当前项目同时支持 `github` 与 `local` 两类仓库来源，架构上不能把执行与上下文能力绑定为单一仓库源。
- 本地文件系统相关能力必须延续现有安全边界：限制根目录、拒绝路径穿越、拒绝符号链接、限制深度/文件数/文件大小。

### Cross-Cutting Concerns Identified

- 多租户 / 工作空间 / 项目隔离
- 读 / 执行 / 治理三类权限分离
- Task、Agent Run、Session、Artifact、Writeback 间的状态一致性
- 心跳、日志、事件、摘要和“状态可信度”机制
- 自动恢复、幂等控制、重试上限与人工接管升级路径
- 人机协同：执行中交互请求的识别、响应与审计
- 审计留痕、导出、归因与保留策略
- 控制面与执行面之间的稳定契约边界
- 敏感配置保护、日志脱敏、上下文最小化注入
- 与现有 brownfield 能力的兼容演进，避免破坏当前 BMAD 项目管理基础能力

## Starter Template Evaluation

### Primary Technology Domain

全栈 Web 控制面 / 执行编排平台，基于现有 Next.js App Router brownfield 项目继续演进。

### Starter Options Considered

**Option 1: 官方 `create-next-app` 基线**
- 官方 Next.js 16 文档确认 `create-next-app` 仍是标准起点，默认围绕 TypeScript、App Router、Tailwind CSS 与 ESLint 建立项目基础。
- 优点是与现有仓库技术方向高度一致，迁移成本最低，长期维护风险最低。
- 局限是它只提供通用 Web 应用基座，不直接提供本产品所需的多租户治理、执行编排、状态机与 self-hosted 执行面能力。

**Option 2: Create T3 App 一类全栈 opinionated starter**
- 当前仍是活跃的全栈脚手架方案，强调 TypeScript、Prisma、Tailwind 与强类型开发体验。
- 优点是快速补齐一部分全栈约定。
- 不足是它会引入额外的架构假设，例如更强的 tRPC / 特定 full-stack 组织方式，而这些并非当前 brownfield 项目或 PRD 的必需前提。

**Option 3: Better Auth / Prisma 社区 starter**
- 当前生态中存在维护中的 Next.js + Better Auth + Prisma 模板，Better Auth 官方文档也确认其兼容 Next.js 16。
- 这类模板适合 greenfield 快速起步认证与数据库能力。
- 但对当前项目而言，认证、数据库和 UI 基座已经存在，再切换到社区 starter 的价值有限，反而会增加结构漂移和迁移噪音。

### Selected Starter: 延续现有 Next.js 16 App Router 基座

**Rationale for Selection:**
这是一个 brownfield 项目，且现有项目上下文已经明确了 Next.js App Router、React、TypeScript strict、Prisma、Better Auth、Tailwind、Vitest 等核心选择。对本项目最合理的“starter 决策”不是重建，而是把官方 `create-next-app` 视为参考基线，在当前仓库内继续演进。

这样做有四个直接收益：
- 保持与现有代码、目录结构、认证模式、数据访问模式和部署方式一致
- 避免为了引入 opinionated starter 而额外迁移或重构
- 将架构注意力集中在真正的产品差异化能力：BMAD 工件映射、任务状态机、执行面、可观测性、治理与审计
- 降低 AI 代理后续实现时的歧义，减少“沿新 starter 约定实现”与“沿现有项目约定实现”之间的冲突

**Initialization Command:**

```bash
pnpm create next-app@latest my-bmad --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
```

此命令仅作为 greenfield 参考基线；对于当前 brownfield 项目，不建议重新初始化仓库。

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
TypeScript 优先、React + Next.js App Router、Node/Next.js 运行时模型，与现有项目完全兼容。

**Styling Solution:**
Tailwind CSS 为基础样式方案，符合现有项目上下文与组件生态方向。

**Build Tooling:**
采用 Next.js 官方构建链路与约定式项目结构，减少自定义基础设施负担。

**Testing Framework:**
官方 starter 不会直接给出完整业务测试体系；当前项目已经采用 Vitest，应继续沿用而不是切换测试哲学。

**Code Organization:**
以 `src/`、App Router、路径别名和约定目录结构为基础，再在其上引入本项目特有的控制面 / 执行面 / 集成层分层。

**Development Experience:**
保留官方主流开发体验与当前项目既有约束，能最大程度降低后续实现与维护摩擦。

**Note:** 对当前项目而言，首个实现故事不应是“重新初始化 starter”，而应是基于现有基座定义新的领域边界、状态机和系统模块。

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- 采用**单仓库模块化单体控制面 + 同机执行监督器**架构：Web 控制面负责身份、授权、任务编排、状态聚合、审计与 UI；执行监督器负责 `tmux` session 生命周期、agent 调用、日志采集、心跳上报与恢复动作。
- 采用**PostgreSQL 作为系统事实源**，围绕 Workspace、Project、BMAD Artifact、Task、Agent Run、Session、Prompt Dispatch、Interaction、Heartbeat、Artifact、Writeback、Audit Event 建立统一领域模型。
- 采用**执行状态机 + 事件日志双模型**：状态机负责当前真值，事件日志负责可追溯历史，避免“当前状态可见但不可解释”。
- 采用**Better Auth + 服务端 RBAC/Policy Layer**，将权限区分为读、执行、治理三类能力，并在工作空间、项目、任务层级逐层收敛。
- 采用**混合接口模式**：内部 UI 变更优先使用 Server Actions，外部触发/查询/回调用版本化 REST Route Handlers，实时监控使用 SSE 优先、轮询兜底。

**Important Decisions (Shape Architecture):**
- 输入与边界校验统一采用 Zod 4；所有 Server Actions 继续遵循 `ActionResult<T>` 返回约定。
- 原始长日志不进入核心事务热表，数据库保留索引、摘要、偏移与状态元数据，大体量日志采用文件或对象存储式持久化策略。
- 前端采用 Server-First 架构，客户端仅承载日志流、交互面板、筛选器与高频状态更新等必要交互岛。
- 缓存策略遵循“数据库事实源 + 请求级缓存 + 明确失效”，所有关键 mutation 后执行 `revalidatePath()` 或 `revalidateTag()`。
- 部署继续以 Docker + Traefik 为主，运行角色拆为 Web 进程与执行监督器进程，共享同一数据库与配置边界。

**Deferred Decisions (Post-MVP):**
- 多主机或分布式执行面调度
- 独立消息总线（如 Kafka / NATS）
- GraphQL / 公共 SDK 优先级低于 REST API
- 更高级的对象存储、冷日志分层与跨区域保留策略
- 更复杂的策略引擎与可编排规则 DSL

### Data Architecture

- **Primary Database:** PostgreSQL，继续作为租户、项目、任务、执行状态、审计与配置的统一事实源。
- **ORM Strategy:** 沿用当前 Prisma 架构与迁移习惯；虽然 Prisma 最新主线已进入 7.x，但当前仓库运行在成熟的 6.x 分支，建议将 Prisma 大版本升级作为独立平台演进事项，而不是与本轮业务架构改造耦合。
- **Validation Strategy:** 所有输入边界、外部事件载荷、执行监督器上报、配置写入与回写请求统一使用 Zod 4 校验。
- **Data Modeling Approach:** 采用“核心实体 + 状态投影 + 事件审计”分层建模。核心实体承载当前业务真值，状态投影优化列表与看板读取，事件表保存完整执行链路与归因信息。
- **Logs & Artifacts:** 原始日志与较大产物不直接塞入高频事务表；数据库保存引用、类型、摘要、偏移、校验信息与访问控制元数据。
- **Migration Approach:** 采用前向 Prisma migration；涉及大表回填、状态字段拆分或日志迁移时，使用双写 / 回填 / 切换三阶段演进，避免破坏 brownfield 数据。
- **Caching Strategy:** 读取侧优先使用服务端缓存与查询去重；任务详情、执行监控、风险列表等高价值视图可引入专门的状态投影或聚合查询，而不是直接让 UI 扫描原始事件流。

### Authentication & Security

- **Authentication:** 继续采用 Better Auth，兼容 Next.js 16；认证初始化仍保持单点配置，不在各模块重复实例化。
- **Authorization:** 授权不依赖中间件完成，核心判定放在服务端 action、route handler 与领域服务层；权限模型明确分为读取、执行、治理三类。
- **Tenant Isolation:** 所有 Task、Agent Run、Session、Artifact、Audit Event 必须显式归属于 workspaceId 与 projectId，禁止隐式跨项目读取。
- **Secrets & Sensitive Data:** 凭据、token、执行密钥与第三方集成配置必须做受控存储与最小暴露；日志、通知与导出结果默认脱敏。
- **Execution Boundary Controls:** 本地执行必须带项目根目录边界、上下文注入白名单、敏感路径保护和人工接管审计。
- **API Security:** 外部 API 采用版本化 endpoint、细粒度 token 或服务账户、速率限制、审计归因和幂等控制。

### API & Communication Patterns

- **Internal Application Mutations:** 优先使用 Next.js Server Actions，统一 `ActionResult<T>` 结构与错误清洗策略。
- **External Platform APIs:** 对外提供版本化 REST API，覆盖任务触发、状态查询、审计检索、事件订阅与回调。
- **Real-Time Updates:** 任务详情和监控场景优先采用 SSE；列表页和低频视图可以使用轮询或显式刷新，避免过度全局长连接。
- **Control Plane ↔ Execution Plane Contract:** 以明确命令/事件语义对齐，不让 UI 直接操作 `tmux`；所有执行动作都经过领域层与审计层。
- **Error Handling:** 内部 mutation 与外部 API 都采用结构化错误模型，并附带可追踪的关联标识，便于审计与排障。
- **Rate Limiting & Idempotency:** 对外触发、重试、回写与回调处理必须具备幂等键与重复提交保护，防止重复派发和重复恢复。

### Frontend Architecture

- **Rendering Strategy:** 默认 Server Components，只有日志流、执行交互、筛选器、表格操作、确认弹层等需要浏览器状态的部分使用客户端组件。
- **State Management:** 优先 URL 状态、服务端数据加载和局部组件状态；在出现复杂实时监控面板前，不引入全局客户端状态库作为默认方案。
- **Component Architecture:** 按领域拆分控制面模块，例如 workspace、project、artifact、execution、audit、admin，而不是按纯 UI 类型平铺。
- **Performance Optimization:** 列表与详情分离、日志分页或分段加载、长列表虚拟化、状态摘要优先于原始日志直出。
- **Design Consistency:** 继续沿用现有 Tailwind / shadcn 方向，并为关键状态、风险与审批节点建立一致的视觉语义。

### Infrastructure & Deployment

- **Deployment Model:** Docker + Traefik 继续作为主要部署方式。
- **Runtime Roles:** 至少拆分为 `web` 与 `executor-supervisor` 两类运行角色；二者共享数据库，但职责边界清晰。
- **Environment Configuration:** 控制面密钥、执行面密钥、第三方 token、项目级敏感配置分层管理，避免所有密钥混在同一运行上下文。
- **CI/CD:** 继续以 `pnpm lint`、`pnpm test`、`pnpm build` 为质量门禁，数据库变更通过 Prisma 迁移流程发布，生产使用 `prisma migrate deploy`。
- **Monitoring & Logging:** 平台日志、执行日志、审计日志、恢复动作和状态漂移检测需要分别可观测，同时通过关联 ID 串联同一任务链路。
- **Scaling Strategy:** MVP 以单机执行面为前提，通过并发限制、任务队列、项目级配额和优先级控制实现可控扩展；多主机扩展留待后续阶段。

### Decision Impact Analysis

**Implementation Sequence:**
1. 先定义统一领域模型与状态机
2. 再建立控制面与执行监督器之间的命令/事件契约
3. 随后实现 RBAC、审计与任务/执行链路映射
4. 然后补齐实时监控、交互请求处理与恢复机制
5. 最后扩展外部 API、通知、配额与商业化控制

**Cross-Component Dependencies:**
- 权限模型直接影响任务详情、恢复动作、审计导出和 API 能力边界
- 状态机设计直接影响心跳、日志、交互请求、回写与恢复策略
- 数据模型设计直接决定前端看板、排障视图、审计导出和计费配额是否可落地
- 控制面 / 执行面契约质量决定系统是否能做到“可见、可控、可恢复”而不状态漂移

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:**
10 类高风险冲突点，分别覆盖命名、目录结构、响应格式、事件契约、状态更新、错误处理、日志格式、加载态、权限判定与执行边界处理。

### Naming Patterns

**Database Naming Conventions:**
- Prisma model 使用 `PascalCase` 单数命名，例如 `Workspace`、`Project`、`Task`、`AgentRun`
- 数据库表名使用复数 `snake_case`，例如 `workspaces`、`agent_runs`、`audit_events`
- 字段与列名统一使用 `camelCase` 映射到 Prisma 层；底层数据库如需 `snake_case`，通过 Prisma 映射明确表达，而不是混用
- 外键统一采用语义化 `xxxId`，例如 `workspaceId`、`projectId`、`taskId`
- 枚举使用 `SCREAMING_SNAKE_CASE` 值，例如 `RUNNING`、`WAITING_FOR_INPUT`

**API Naming Conventions:**
- REST 资源路径使用复数 `kebab-case`，例如 `/api/tasks`、`/api/agent-runs`、`/api/audit-events`
- 路由参数统一使用 Next.js 动态段风格 `[taskId]`，对外文档中使用 `{taskId}` 表示
- 查询参数统一使用 `camelCase`，例如 `workspaceId`、`status`, `includeArtifacts`
- 自定义头统一使用标准 HTTP 风格，必要时采用 `X-Request-Id`、`X-Idempotency-Key`

**Code Naming Conventions:**
- React 组件与 TypeScript 类型使用 `PascalCase`
- 文件名统一使用 `kebab-case`，如 `task-detail-panel.tsx`、`audit-event-list.tsx`
- 函数与变量使用 `camelCase`
- Server Actions 文件以 `*-actions.ts` 命名，领域 helper 放入对应 `lib` 子目录

### Structure Patterns

**Project Organization:**
- 页面与 API 仅放在 `src/app`
- 变更型逻辑统一放在 `src/actions`
- 领域逻辑、集成逻辑、执行监督器共享规则与纯工具放在 `src/lib`
- UI 组件放在 `src/components`，并优先按领域能力拆分目录
- 测试优先采用就近共置 `*.test.ts` / `*.test.tsx`

**File Structure Patterns:**
- 执行相关代码按能力划分子域，例如 `src/lib/execution/`、`src/lib/audit/`、`src/lib/artifacts/`
- 配置解析、环境变量 schema 与第三方客户端初始化集中管理，不在调用点重复构造
- 文档产物继续输出到 `_bmad-output/planning-artifacts`
- 静态资源只放 `public/`，不把业务 JSON 或日志样本混入公开目录

### Format Patterns

**API Response Formats:**
- 内部 Server Actions 必须统一返回 `ActionResult<T>`
- 外部 REST API 使用结构化响应：成功返回 `{ data, meta? }`，失败返回 `{ error: { code, message, details? } }`
- 不向客户端暴露原始异常文本；用户可见错误统一经过清洗
- 时间字段统一使用 ISO 8601 字符串

**Data Exchange Formats:**
- API JSON 字段统一使用 `camelCase`
- 布尔值统一使用原生 `true/false`
- 单对象不包数组，列表返回时显式使用数组并可附带分页 `meta`
- 对可空字段明确返回 `null`，不要让 `undefined`、空字符串和缺字段混作同一语义

### Communication Patterns

**Event System Patterns:**
- 领域事件统一使用过去时、点分语义命名，如 `task.created`、`agentRun.started`、`session.heartbeatRecorded`、`writeback.failed`
- 事件载荷统一包含：`eventId`、`eventType`、`occurredAt`、`workspaceId`、`projectId`、`subjectType`、`subjectId`、`actorType`、`actorId?`、`payload`
- 事件版本使用显式 `version` 字段，而不是隐式变更结构
- 所有恢复、重试、人工接管动作都必须产生日志事件与审计事件

**State Management Patterns:**
- 数据真值来自服务端，不在客户端构造独立业务真相
- 状态更新采用不可变思维与显式刷新，不直接在多个组件中手工同步同一状态
- 任务状态流转必须走统一状态机，不允许 UI 组件私自拼接状态
- 所有列表筛选状态优先体现在 URL 参数中，确保可分享与可回放

### Process Patterns

**Error Handling Patterns:**
- 输入校验错误、权限错误、状态冲突、外部依赖错误、执行失败必须分型处理
- 对用户展示的错误信息保持简洁、可行动；对排障和审计保存完整内部上下文
- 执行异常先转为明确状态，再决定是否恢复或升级，不允许直接吞错
- 日志与审计分离：日志面向运行轨迹，审计面向责任归因

**Loading State Patterns:**
- 加载态命名统一使用 `isLoading`、`isPending`、`isRefreshing` 等语义化布尔值
- 页面级首次加载与局部操作加载分离处理，避免整页闪烁
- 实时监控面板优先展示“最后有效活动时间”和“状态可信度”，不只显示转圈
- 对长时间运行任务，加载态要和业务状态区分，例如“正在连接日志流”不等于“任务执行中”

### Enforcement Guidelines

**All AI Agents MUST:**
- 复用现有 `ActionResult<T>`、auth helper、缓存失效模式与路径安全约束
- 使用统一命名、状态机和事件载荷结构，禁止在局部自行创造平行格式
- 将所有跨权限、跨状态、跨执行边界的动作写入审计或事件链路

**Pattern Enforcement:**
- 通过 ESLint、TypeScript strict、Zod schema、Prisma schema、单元测试和代码评审共同约束
- 新增领域对象、状态或 API 时必须比对本节模式，发现偏差时在 architecture 文档或对应 story 中显式记录
- 模式更新只能通过架构文档变更完成，避免代理各自口头约定

### Pattern Examples

**Good Examples:**
- `createTaskAction(input): Promise<ActionResult<TaskSummary>>`
- 事件：`task.dispatched`，载荷中包含 `taskId`、`agentRunId`、`workspaceId`、`projectId`
- 文件：`src/components/execution/task-log-stream.tsx`
- API 失败响应：`{ error: { code: "TASK_NOT_FOUND", message: "任务不存在" } }`

**Anti-Patterns:**
- 一个 action 返回 `{ success: true }`，另一个 action 直接 `throw new Error()`
- 同一类资源同时出现 `/api/task` 与 `/api/tasks`
- 一个模块使用 `snake_case` JSON，另一个模块使用 `camelCase` JSON
- UI 直接把 `tmux` 进程状态当作用户可见任务状态，不经过领域状态机映射

## Project Structure & Boundaries

### Complete Project Directory Structure

```text
my-bmad/
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.ts
├── eslint.config.mjs
├── vitest.config.ts
├── docker-compose.yml
├── Dockerfile
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── public/
├── docs/
├── _bmad-output/
│   └── planning-artifacts/
├── scripts/
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── login/
│   │   ├── (dashboard)/
│   │   │   ├── page.tsx
│   │   │   ├── projects/
│   │   │   ├── artifacts/
│   │   │   ├── tasks/
│   │   │   ├── runs/
│   │   │   ├── sessions/
│   │   │   ├── audit/
│   │   │   ├── risks/
│   │   │   └── settings/
│   │   └── api/
│   │       ├── auth/
│   │       ├── health/
│   │       ├── revalidate/
│   │       ├── tasks/
│   │       ├── agent-runs/
│   │       ├── sessions/
│   │       ├── artifacts/
│   │       ├── audit-events/
│   │       ├── webhooks/
│   │       └── events/
│   ├── actions/
│   │   ├── admin-actions.ts
│   │   ├── repo-actions.ts
│   │   ├── task-actions.ts
│   │   ├── execution-actions.ts
│   │   ├── artifact-actions.ts
│   │   └── audit-actions.ts
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── shared/
│   │   ├── dashboard/
│   │   ├── artifacts/
│   │   ├── tasks/
│   │   ├── execution/
│   │   ├── audit/
│   │   ├── admin/
│   │   └── docs/
│   ├── contexts/
│   ├── hooks/
│   ├── generated/
│   ├── lib/
│   │   ├── auth/
│   │   ├── db/
│   │   ├── bmad/
│   │   ├── github/
│   │   ├── content-provider/
│   │   ├── workspace/
│   │   ├── projects/
│   │   ├── artifacts/
│   │   ├── tasks/
│   │   ├── execution/
│   │   │   ├── state-machine/
│   │   │   ├── supervisor/
│   │   │   ├── tmux/
│   │   │   ├── heartbeat/
│   │   │   ├── interactions/
│   │   │   └── writeback/
│   │   ├── audit/
│   │   ├── notifications/
│   │   ├── integrations/
│   │   ├── validation/
│   │   ├── errors.ts
│   │   ├── rate-limit.ts
│   │   ├── types.ts
│   │   └── utils.ts
│   ├── middleware.ts
│   └── middleware.test.ts
└── .github/
    └── workflows/
        └── ci.yml
```

### Architectural Boundaries

**API Boundaries:**
- `src/actions/` 仅服务内部已登录控制面交互，不作为外部集成接口
- `src/app/api/**` 承载健康检查、回调、外部 API、事件流和版本化平台接口
- 权限边界在服务端 action、route handler 与领域服务层三处共同保证，中间件只做轻量门禁

**Component Boundaries:**
- `src/app/**` 负责路由、页面组装与服务端数据入口
- `src/components/**` 负责展示和局部交互，不承载持久化规则、权限真值或执行编排逻辑
- `src/contexts` 与 `src/hooks` 只保存前端交互态，不保存任务业务真相

**Service Boundaries:**
- `src/lib/workspace`、`src/lib/projects`、`src/lib/artifacts`、`src/lib/tasks` 负责核心领域逻辑
- `src/lib/execution/**` 负责执行生命周期、状态机、tmux、心跳、交互、恢复和回写
- `src/lib/audit` 负责审计落盘、查询与导出
- `src/lib/integrations` 负责外部系统对接，不反向污染核心领域模型

**Data Boundaries:**
- Prisma schema 是结构事实源
- 领域服务是唯一允许直接协调数据库写入与状态机更新的层
- 原始日志、产物元数据、状态投影与审计证据逻辑分层，避免单表承担所有职责

### Requirements to Structure Mapping

**Feature/Epic Mapping:**
- Epic 1 一句话目标输入与 PM 规划编排 → `src/components/dashboard/`, `src/lib/bmad/`, `src/lib/tasks/`, `src/actions/task-actions.ts`
- Epic 2 BMAD 工件生成、更新与追踪映射 → `src/lib/artifacts/`, `src/components/artifacts/`, `src/app/(dashboard)/artifacts/`
- Epic 3 任务路由与编码 Agent 自动派发 → `src/lib/tasks/`, `src/lib/execution/supervisor/`, `src/actions/execution-actions.ts`
- Epic 4 Self-Hosted 执行面与 tmux 会话控制 → `src/lib/execution/tmux/`, `src/lib/execution/supervisor/`, `src/app/api/sessions/`
- Epic 5 执行可视化、日志、心跳与状态机 → `src/components/execution/`, `src/lib/execution/state-machine/`, `src/lib/execution/heartbeat/`
- Epic 6 编码 Agent 动态交互与长时间运行协调 → `src/lib/execution/interactions/`, `src/app/api/events/`, `src/components/execution/`
- Epic 7 异常恢复、人工接管与执行治理 → `src/lib/execution/supervisor/`, `src/lib/audit/`, `src/app/(dashboard)/risks/`
- Epic 8 团队协作、角色权限与商业化控制 → `src/lib/auth/`, `src/lib/workspace/`, `src/components/admin/`, `src/app/(dashboard)/settings/`
- Epic 9 集成接口、自动规则与外部事件联动 → `src/app/api/webhooks/`, `src/app/api/tasks/`, `src/lib/integrations/`, `src/lib/notifications/`

**Cross-Cutting Concerns:**
- 认证与 RBAC → `src/lib/auth/`, `src/actions/`, `src/app/api/`
- 审计与归因 → `src/lib/audit/`, `src/app/(dashboard)/audit/`, `src/app/api/audit-events/`
- 路径与内容安全 → `src/lib/content-provider/`, `src/lib/github/`
- 共享类型与错误模型 → `src/lib/types.ts`, `src/lib/errors.ts`, `src/lib/validation/`

### Integration Points

**Internal Communication:**
- 页面通过 Server Components 拉取数据
- 交互通过 Server Actions 提交 mutation
- 实时监控通过 SSE 或轮询从 `src/app/api/events/`、`src/app/api/sessions/` 获取增量状态
- 执行监督器通过领域服务与数据库、事件表、审计表交互，不由 UI 直接驱动底层进程

**External Integrations:**
- Better Auth → `src/lib/auth/`
- PostgreSQL / Prisma → `prisma/`, `src/lib/db/`
- GitHub 与本地仓库提供者 → `src/lib/github/`, `src/lib/content-provider/`
- 后续通知与审批集成 → `src/lib/notifications/`, `src/lib/integrations/`, `src/app/api/webhooks/`

**Data Flow:**
- 用户或外部系统发起任务
- 控制面写入 Task / Agent Run 初始状态
- 执行监督器创建或附着 `tmux` session，并持续写入心跳、日志摘要、交互请求和恢复记录
- 状态投影驱动 dashboard、详情页、风险页与审计页展示
- 任务完成或中断后，结果回写 BMAD 工件链路并生成审计闭环

### File Organization Patterns

**Configuration Files:**
- 根目录保留 Next.js、TypeScript、ESLint、Vitest、Docker、Prisma 配置
- 环境变量 schema 与运行时配置解析集中放在 `src/lib/validation/` 或对应 `config` 子域

**Source Organization:**
- 路由层、动作层、领域层、集成层、展示层职责严格分离
- 新能力优先进入领域子目录，不把任务编排或执行逻辑散落在 dashboard 组件中

**Test Organization:**
- 纯逻辑测试优先共置到对应模块
- 可新增 `src/lib/execution/__tests__/`, `src/lib/audit/__tests__/`, `src/app/api/**/__tests__/`
- 关键状态机、恢复逻辑、权限边界和路径安全必须有回归测试

**Asset Organization:**
- `public/` 仅放公开静态资源
- 日志样本、调试快照、导出审计文件不进入公开静态目录

### Development Workflow Integration

**Development Server Structure:**
- Web 控制面仍以 `pnpm dev` 为主
- 执行监督器应支持独立开发入口或受控本地启动方式，避免与 Web 进程职责混淆

**Build Process Structure:**
- Web 构建、Prisma 生成、类型检查、测试和部署配置沿现有根目录工具链统一编排

**Deployment Structure:**
- Docker 镜像与 Compose 结构支持 `web`、数据库依赖与后续监督器角色拆分
- Traefik 继续位于控制面入口，执行监督器不直接暴露公共入口

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
当前架构决策之间总体兼容。Next.js App Router、TypeScript strict、Prisma/PostgreSQL、Better Auth、Zod、Server Actions、REST Route Handlers、SSE 与 Docker/Traefik 组合不存在内在冲突；同时与当前 brownfield 项目的既有约束保持一致。控制面 / 执行监督器拆分也与单机 self-hosted 前提相匹配。

**Pattern Consistency:**
命名、结构、响应格式、事件契约、状态更新与错误处理模式已与技术选型和项目上下文对齐，能够约束不同 AI 代理写出兼容代码。

**Structure Alignment:**
目标目录结构对齐了控制面、执行面、审计、工件映射、通知、集成与安全边界，足以承载已定义的架构决策和实施模式。

### Requirements Coverage Validation ✅

**Epic/Feature Coverage:**
PRD 中的 9 个初始 Epic 候选均已映射到明确的模块或目录边界，尤其是 BMAD 工件映射、任务编排、tmux 会话控制、动态交互、恢复治理、RBAC 与商业化控制等核心能力均有架构承载点。

**Functional Requirements Coverage:**
66 条功能需求已被领域模型、状态机、控制面 / 执行面边界、Server Actions、外部 API、审计层和项目结构共同覆盖，没有发现缺失的核心能力域。

**Non-Functional Requirements Coverage:**
性能通过服务端优先渲染、状态投影、SSE/轮询分层和日志分页设计支撑；安全通过 Better Auth、服务端 RBAC、路径边界、脱敏与审计支撑；可靠性通过状态机、心跳、恢复与事件链路支撑；可扩展性通过单体模块化与后续多主机扩展预留支撑；B2B 治理由租户边界、审计与配额控制支撑。

### Implementation Readiness Validation ✅

**Decision Completeness:**
阻塞实现的关键决策已经完成，包括数据事实源、权限模型、接口模式、部署角色、控制面 / 执行面边界和核心状态机制。

**Structure Completeness:**
项目结构已经具体到目录级和职责级，足以指导后续 story 拆分与代码落位。

**Pattern Completeness:**
高风险冲突点已被覆盖，特别是响应格式、事件模型、状态机更新、命名规范和边界职责，足以降低多代理并行实现时的漂移风险。

### Gap Analysis Results

- **Critical Gaps:** 无阻塞实现的关键缺口。
- **Important Gaps:**
  - 尚未把执行监督器定义为具体运行单元形式，例如独立 Node 进程、同仓 worker 入口或定时协调器。
  - 原始日志与大产物的最终持久化介质仍保留为策略级决策，后续需要在 implementation story 中具体化。
  - 对外 REST API 的 endpoint 级契约、分页与 webhook 签名规范还需要在 API 设计阶段补全文档。
- **Nice-to-Have Gaps:**
  - 可补充更细的审计导出格式示例。
  - 可补充状态机图和事件时序图，帮助实现和排障。

### Validation Issues Addressed

本轮验证未发现需要回退重构的架构冲突。发现的缺口均属于实现细化层面，已经被记录为非阻塞后续事项，不影响进入实现准备阶段。

### Architecture Completeness Checklist

**✅ Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**

- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**

- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**

- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** high，基于当前验证结果没有发现阻塞实现的一致性问题。

**Key Strengths:**
- 能把 BMAD 工件、执行控制、可观测性和治理闭环放在同一架构下
- 明确区分控制面与执行监督器职责，降低状态漂移风险
- 对 AI 代理实现给出了足够具体的模式、边界和结构约束

**Areas for Future Enhancement:**
- 进一步细化执行监督器运行模型
- 为事件流、状态机和外部 API 补充专门时序与契约文档
- 在进入实现前补充关键表结构和审计导出样例

### Implementation Handoff

**AI Agent Guidelines:**

- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions

**First Implementation Priority:**
优先定义统一领域模型、状态机和控制面 / 执行监督器契约，而不是直接开始 UI 或局部 API 细节开发。
