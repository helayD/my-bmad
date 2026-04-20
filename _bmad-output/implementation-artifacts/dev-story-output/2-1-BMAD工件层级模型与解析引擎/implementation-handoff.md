# Story 2.1 实现交接

- Story Key: `2-1-BMAD工件层级模型与解析引擎`
- Story 标题: `BMAD 工件层级模型与解析引擎`
- Story 文件: `_bmad-output/implementation-artifacts/2-1-BMAD工件层级模型与解析引擎.md`
- 当前状态: `review`

## 本次交接确认

- 已复核 Prisma 模型、扫描引擎、同步逻辑、Server Actions、结构化工件树 UI 与项目详情页集成。
- 已确认 `TASK` 工件从 Story checkbox 提取，并建立 `PRD -> EPIC -> STORY -> TASK` 层级关系。
- 已确认重新扫描沿用增量同步逻辑，支持新增、更新与软删除。

## 关键实现文件

- `prisma/schema.prisma`
- `src/lib/artifacts/scanner.ts`
- `src/lib/artifacts/sync.ts`
- `src/lib/artifacts/utils.ts`
- `src/actions/artifact-actions.ts`
- `src/app/(dashboard)/workspace/[slug]/project/[projectSlug]/page.tsx`
- `src/components/artifacts/artifact-tree.tsx`
- `src/components/artifacts/scan-button.tsx`
- `src/lib/db/helpers.ts`
- `src/lib/errors.ts`
- `src/lib/artifacts/__tests__/scanner.test.ts`
- `src/lib/artifacts/__tests__/sync.test.ts`
- `src/lib/artifacts/__tests__/artifact-tree.test.ts`

## 验证记录

- `pnpm test src/lib/artifacts/__tests__/scanner.test.ts src/lib/artifacts/__tests__/sync.test.ts src/lib/artifacts/__tests__/artifact-tree.test.ts`
- `pnpm lint`
- `pnpm build`
- `DATABASE_URL=[isolated-test-db] pnpm prisma migrate deploy`
- `DATABASE_URL=[isolated-test-db] pnpm test`

## 设计与评审重点

- 扫描器严格复用现有 `ContentProvider` 与 BMAD 解析器，没有重新实现同类解析逻辑。
- `epics.md#epic-{id}` 与 `story.md#task-{n}` 的路径策略用于为数据库记录提供稳定的层级锚点。
- `syncArtifacts()` 采用“两阶段”同步：先创建/更新，再回填 `parentId`，并包含空扫描保护。
- 页面保留原有文件级工件浏览视图，同时新增结构化工件树，职责分离清晰。

## 未解决风险

- 无阻塞性问题。
- 仓库仍有少量与本 Story 无关的 warning：React Compiler 对 `useReactTable()` 的提示、个别测试文件未使用变量，以及 Next.js 构建时的根目录/TypeScript 版本提醒；当前不影响 Story 2.1 交付。

## 建议 Reviewer 重点关注

- `TASK` 工件元数据与后续 Story 2.2-2.5 的任务映射是否完全兼容。
- `filePath` 锚点方案在 `epics.md` 单文件模式与 Story checkbox 任务模式下是否足够稳定。
- `scanProjectArtifactsAction()` 与项目详情页加载路径是否完全遵守权限与缓存失效约束。
