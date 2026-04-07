# Deferred Work

## Deferred from: code review of 1-2-个人工作空间创建与管理 (2026-04-07)

- **#4** Server Action 序列化后 `updatedAt` 类型从 `Date` 变为 `string` — `workspace-actions.ts:58`，当前无客户端调用方，待后续 Story 引入客户端调用时统一处理。
- **#5** `project-list.tsx:24` 链接到 `/workspace/[slug]/project/[slug]` 路由尚不存在 — 路由将在 Story 1.7 创建。
- **#6** `getWorkspaceProjects` Server Action 当前无调用方 — `workspace-actions.ts:16`，预留给后续客户端交互场景。

## Deferred from: code review of 1-4-团队成员邀请与移除 (2026-04-07)

- **members/page.tsx 未登录时 notFound() 而非 redirect** — 中间件已保护该路由，属 MVP 已知取舍。后续若中间件策略调整需同步处理。

## Deferred from: code review of 1-3-团队工作空间创建与项目上限治理 (2026-04-07)

- **archive-project.ts 并发重复归档无保护** — 两个管理员同时归档同一项目时可能执行两次 update，但操作幂等，影响极小。
- **project-limit-banner.tsx 硬编码阈值 45** — 当前 limit=50, 45=90% 合理。Epic 9 引入动态 limit 时需将 45 改为 `Math.floor(limit * 0.9)` 之类的计算值。

## Deferred from: code review of 1-5-角色与权限模型 (2026-04-07)

- **`update-member-role.ts:27-29` ADMIN 降级 OWNER 时错误语义不清** — 抛出 `CannotAssignOwnerRoleError` 但场景是"ADMIN 不能修改 OWNER 成员"，非"赋予 OWNER 角色"。需要新增专用错误类型。
- **`types.ts:31` ProjectLimitExceededError 法语消息未迁移** — Error 构造函数中的 message 仍为法语，Story 1.9 已覆盖 `errors.ts` 的 ERROR_MESSAGES，但自定义 Error 类的构造消息未同步处理。
- **非事务性 OWNER 计数竞态条件** — 两个并发降级请求可能同时通过 ownerCount 检查。Story spec 已说明不使用 $transaction（Prisma 6.x 交互事务问题）。后续可考虑乐观锁或 DB 约束方案。
- **`workspace-actions.ts` 认证/校验错误消息为英文** — "Not authenticated"/"Invalid input"/"Access denied" 为全项目一致的预存模式，非本 Story 引入。
