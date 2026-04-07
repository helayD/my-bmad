# Deferred Work

## Deferred from: code review of 1-2-个人工作空间创建与管理 (2026-04-07)

- **#4** Server Action 序列化后 `updatedAt` 类型从 `Date` 变为 `string` — `workspace-actions.ts:58`，当前无客户端调用方，待后续 Story 引入客户端调用时统一处理。
- **#5** `project-list.tsx:24` 链接到 `/workspace/[slug]/project/[slug]` 路由尚不存在 — 路由将在 Story 1.7 创建。
- **#6** `getWorkspaceProjects` Server Action 当前无调用方 — `workspace-actions.ts:16`，预留给后续客户端交互场景。
