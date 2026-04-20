# Story 4.1 实现交接

- Story Key: `4-1-任务定义与执行意图提交`
- 当前状态: `review`

## 变更摘要

- 将任务创建 action 扩展为通用 `createTaskAction()`，同时保留 `createTaskFromArtifactAction()` 兼容旧入口。
- 手动新建任务统一落到真实的 `planned` 生命周期，并写入 `task.created` 审计事件。
- 抽出共享任务创建表单，复用到项目页“新建任务”和工件详情侧栏两条入口。
- 表单补齐 `intentDetail`、`preferredAgentType`、空目标内联错误，以及“状态 + 原因 + 下一步”的成功反馈卡。
- 任务详情与 tracking fallback 对无来源工件任务做了诚实降级展示。

## 关键文件

- `src/actions/task-actions.ts`
- `src/components/tasks/task-create-form.tsx`
- `src/components/tasks/project-task-create-sheet.tsx`
- `src/components/artifacts/artifact-detail-sheet.tsx`
- `src/components/tasks/task-detail-view.tsx`
- `src/lib/tasks/types.ts`
- `src/lib/tasks/defaults.ts`
- `src/lib/tasks/tracking.ts`
- `src/lib/audit/events.ts`

## 验证

- `pnpm test -- src/actions/task-actions.test.ts src/components/tasks/task-create-form.test.tsx src/components/tasks/task-detail-view.test.tsx src/lib/tasks/__tests__/task-create.test.ts src/lib/tasks/__tests__/tracking.test.ts`
- `pnpm lint`
- `pnpm build`

## 剩余风险与建议关注点

- 项目级新建任务入口当前支持“带入当前 `artifactId` 作为默认来源”，但若需要在同一抽屉里切换到其他工件，仍需后续补充来源选择器。
- `pnpm lint` 与 `pnpm build` 仍会输出仓库已有的 Next.js / React Compiler 警告，例如多 lockfile、`middleware` 约定废弃、TypeScript 版本偏旧；本次未处理这些存量问题。
