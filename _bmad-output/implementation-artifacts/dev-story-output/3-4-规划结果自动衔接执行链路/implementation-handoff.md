# Story 3.4 实现交接摘要

- Story: `3-4-规划结果自动衔接执行链路`
- 当前状态: `review`
- 交接时间: `2026-04-13 18:12:19 CST`

## 本次收口

- 复核并确认 3.4 所需的 planning handoff 主链路已在当前工作区落地，包括：`PlanningRequest -> Task` 显式关系、`execution-ready` 汇流语义、`planned` 状态兼容层、规划确认 action、handoff summary 与审计事件。
- 补齐零候选任务时的恢复体验：确认弹窗在 `candidateTaskCount = 0` 时不再只有死路，而是明确提示无法生成执行任务，并提供“查看链路详情”入口回到工件链路。
- 清理新增确认 UI 与详情 UI 的英文 “Story” 外壳文案，统一改成中文“用户故事”。
- 将 legacy `pending` 主状态标签恢复为正常中文“待处理”，避免历史任务视图出现“待处理（旧）”的回归文案。

## 关键文件

- `src/lib/planning/handoff.ts`
- `src/actions/planning-actions.ts`
- `src/lib/planning/types.ts`
- `src/lib/planning/queries.ts`
- `src/components/planning/planning-request-list.tsx`
- `src/components/planning/planning-request-composer.tsx`
- `src/components/planning/planning-request-detail-sheet.tsx`
- `src/lib/tasks/types.ts`
- `src/lib/tasks/defaults.ts`
- `src/lib/tasks/tracking.ts`

## 重点验证

- `pnpm lint`
  - 通过；仅存在仓库既有 warning（React Compiler / unused vars），本次变更未新增 lint error。
- `pnpm test -- --run src/components/planning/planning-request-composer.test.tsx src/components/planning/planning-request-detail-sheet.test.tsx src/components/tasks/task-detail-view.test.tsx src/lib/tasks/__tests__/tracking.test.ts src/actions/planning-actions.test.ts`
  - 通过。
- `pnpm build`
  - 通过；保留仓库既有 Next.js root / middleware / TypeScript version warning。
- `pnpm test`
  - 未能完整通过；13 个 workspace integration suites 因测试数据库守卫直接失败，需提供指向 test database 的 `DATABASE_URL` 后复跑。

## 未解决风险

- 还没有在可用的测试数据库环境里跑完整量集成测试，因此 workspace integration 层面的最终回归仍待环境补齐后确认。

## 建议评审关注点

- 零候选任务时从确认弹窗回到链路详情的恢复体验是否符合产品预期。
- `planned` 与 legacy `pending` 在 planning 详情、任务详情与历史视图中的语义边界是否清晰。
- `PlanningRequest` 的 handoff summary / audit payload 是否足够支撑后续 Story 3.5 的“规划请求 -> 衍生任务列表”展示。
