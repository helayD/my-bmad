---
project_name: 'my-bmad'
user_name: 'David'
date: '2026-04-04T16:22:00+08:00'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 48
optimized_for_llm: true
---

# 面向 AI 代理的项目上下文

_此文件记录 AI 代理在本项目中实现代码时必须遵循的关键规则与模式，重点是那些不明显、但非常容易导致实现偏差的细节。_

---

## 技术栈与版本

- Next.js `16.1.6`，使用 App Router
- React `19.2.3`
- TypeScript `^5`，启用 `strict: true`
- Prisma `^6.19.2`，数据库为 PostgreSQL
- Better Auth `^1.4.18`
- Tailwind CSS `^4.2.2`
- Vitest `^4.0.18`
- Zod `^4.3.6`
- Octokit `@octokit/rest ^22.0.1`
- UI 生态包含 `shadcn`、`lucide-react`、`@tanstack/react-table`

## 关键实现规则

### 语言特定规则

- 所有 server action 统一返回 `ActionResult<T>`，成功和失败分支必须保持一致形状。
- 不要把原始 `error.message` 直接返回给客户端；统一使用 `sanitizeError()` 生成对外错误信息。
- 新增或修改 server action 时，优先在函数顶部做 `zod` 输入校验。
- TypeScript 处于严格模式；不要引入 `any` 逃避类型系统，优先补齐显式类型。
- 导入路径优先使用 `@/` 别名，而不是深层相对路径。
- 共享领域类型放在 `src/lib/types.ts` 或对应 `lib` 子模块，不要在多个 action 或组件里重复声明。
- 涉及数据库、GitHub API、文件系统扫描的逻辑统一使用 `async/await`，不要混杂 `.then()` 风格。
- 所有面向用户的错误消息、UI 提示文本统一使用**中文**；`src/lib/errors.ts` 中的 `ERROR_MESSAGES` value 必须为中文，不接受法语或英语。
- 角色名（OWNER/ADMIN/MEMBER 等）、技术标识符（token、slug）等专有术语保持英文不翻译。

### 框架特定规则

- 默认使用 Server Components；只有在确实需要浏览器状态、事件处理或客户端 hooks 时才添加 `"use client"`。
- 变更数据的逻辑放在 `src/actions/` 中作为 Server Actions，不要把 mutation 散落到页面组件中。
- 管理员权限校验优先复用 `requireAdmin()`；普通登录态校验优先复用已有 session helper，而不是重复写认证逻辑。
- 中间件只做轻量级登录门禁；角色判断应保留在服务端页面、布局或 action 层。
- Better Auth 配置集中在 `src/lib/auth/auth.ts`，不要在其他位置重复初始化 auth。
- 数据读取辅助优先放入 `src/lib/db/helpers.ts` 并使用 `react` 的 `cache()` 去重同请求内的重复查询。
- 与本地文件系统相关的读取必须沿用 `local-provider` 现有安全约束：限制根目录、拒绝路径穿越、拒绝符号链接、限制深度、文件数与文件大小。
- 与 GitHub 仓库交互时，优先复用已有 Octokit 封装与 token 获取逻辑，不要在调用点重新拼装新客户端。
- 变更成功后，如果页面依赖缓存数据，记得调用 `revalidatePath()` 或 `revalidateTag()` 保持 UI 与数据一致。

### 测试规则

- 测试框架是 Vitest，默认环境为 `node`。
- 测试文件命名沿用就近共置模式，例如 `src/middleware.test.ts`；新增测试优先贴近被测模块。
- 为中间件、工具函数、解析器等纯逻辑模块补充单元测试；不要把这类验证只留给手工测试。
- 测试应覆盖已知分支与边界情况，例如：未登录、已登录、cookie 变体、权限不足、路径异常、文件系统防护等。
- 编写测试时优先验证可观察行为和返回结果，不要过度依赖实现细节。
- 新增安全边界或解析规则时，应同步增加回归测试，避免后续修改破坏保护逻辑。

### 代码质量与风格规则

- 目录职责保持清晰：`src/app` 只放页面和 API；`src/actions` 放 Server Actions；`src/lib` 放业务逻辑、集成和工具；`src/components` 放 UI 组件。
- 组件、工具、provider、helper 的放置位置要和现有结构一致，不要把业务逻辑塞进展示组件。
- Tailwind CSS v4 不要滥用任意值；若存在标准类名，就必须用标准类名。
- 重复出现的颜色值应沉淀为 `globals.css` 中的主题 token，而不是到处写行内类名。
- `shadcn/ui` 组件是项目内代码，不视为外部不可改动代码；如需调整，可按本项目风格修改。
- 命名保持现有习惯：文件多用 `kebab-case`，类型和组件用 `PascalCase`，函数与变量用 `camelCase`。
- 除非必要，不要新增无意义注释；优先写清晰代码，仅在边界、安全或复杂控制流处保留高价值注释。
- 现有 vendored 组件目录如 `src/components/animate-ui/**`、`src/components/reui/**` 已被 ESLint 特殊忽略；新增项目代码不要混入这些目录以规避规范。

### 开发工作流规则

- 开发脚本基于 `pnpm`，不要混用 `npm` 或 `yarn` 命令风格。
- 本地开发端口默认是 `3002`，不要假定应用运行在 `3000`。
- 数据库 schema 变更后，应运行 Prisma 相关流程；生产环境只能使用 `prisma migrate deploy`，不要在生产使用 `migrate dev`。
- 提交前的标准检查是：`pnpm lint`、`pnpm test`、`pnpm build`。
- 分支命名遵循 `feat/your-feature-name` 这类模式。
- Commit message 遵循 Conventional Commits：`type(scope): short description`。
- PR 必须聚焦单一主题；涉及 UI 的变更应附截图；影响行为时应更新文档。
- 对外部署模式以 Docker 和 Traefik 为主，任何影响环境变量、认证、数据库迁移的改动都应考虑部署兼容性。

### 关键不可忽视规则

- 不要绕过 `ActionResult<T>` 约定返回裸对象、抛未处理异常或返回不一致结构。
- 不要在客户端组件里直接承载本应位于服务端的敏感逻辑、数据库访问或权限判断。
- 不要把角色权限仅依赖中间件保证；中间件只检查 session cookie 存在性，不是完整授权层。
- 不要泄露敏感配置，如 `BETTER_AUTH_SECRET`、GitHub OAuth 密钥、数据库连接串或用户 token。
- 不要直接信任本地路径输入；涉及本地目录导入时必须保留路径安全检查与访问边界。
- 不要破坏本地文件扫描的防御规则：禁止符号链接、禁止 `..`、禁止 Unicode slash 变体、禁止绝对路径逃逸。
- 不要在已存在 helper 的地方重复实现认证、repo 查询、GitHub token 获取、缓存查询等基础逻辑。
- 不要在代码中假定只有 GitHub 来源；Repo 同时支持 `github` 与 `local` 两类 `sourceType`。
- 不要遗漏缓存失效，否则 dashboard、repo 页面和布局数据可能不同步。
- 不要为了修快一点修改无关文件；保持变更范围聚焦。

---

## 使用指南

**给 AI 代理：**

- 在实现任何代码前先阅读本文件。
- 优先复用现有 helper、action 模式、auth 结构和 provider 边界。
- 如遇不确定情况，优先选择更保守、更符合服务端约束的实现。
- 当项目新增稳定模式时，及时更新本文件。

**给人类维护者：**

- 保持文件精简，只保留代理真正容易忽略的规则。
- 技术栈、认证方案、缓存策略、文件系统安全边界发生变化时，及时更新。
- 定期删除已经变得显而易见或已经过时的规则。

Last Updated: 2026-04-04T16:22:00+08:00
