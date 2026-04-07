# Deferred Work

## Deferred from: code review of 1-2-个人工作空间创建与管理 (2026-04-07)

- **#4** Server Action 序列化后 `updatedAt` 类型从 `Date` 变为 `string` — `workspace-actions.ts:58`，当前无客户端调用方，待后续 Story 引入客户端调用时统一处理。
- **#5** `project-list.tsx:24` 链接到 `/workspace/[slug]/project/[slug]` 路由尚不存在 — 路由将在 Story 1.7 创建。
- **#6** `getWorkspaceProjects` Server Action 当前无调用方 — `workspace-actions.ts:16`，预留给后续客户端交互场景。

## Deferred from: code review of 1-3-团队工作空间创建与项目上限治理 (2026-04-07)

- **archive-project.ts 并发重复归档无保护** — 两个管理员同时归档同一项目时可能执行两次 update，但操作幂等，影响极小。
- **project-limit-banner.tsx 硬编码阈值 45** — 当前 limit=50, 45=90% 合理。Epic 9 引入动态 limit 时需将 45 改为 `Math.floor(limit * 0.9)` 之类的计算值。
