# TodoHeap 开工细则

仓库结构、命令与表结构见仓库根 `AGENTS.md`；这里只放写代码与交付时必须遵守的约定。

## 代码与 UI

- 颜色只用 `neutral-*` 与 `accent-*`，配 `.panel` / `.field` / `.btn-*` / `.chip` / `.eyebrow` 基元。
- 图标一律 `AppIcon`，不使用 emoji。
- 圆角以 `rounded-md` 为主，避免大阴影与渐变。
- 中文注释描述这段代码负责什么，不写步骤流水账。
- 部署路径带 `/TodoHeap/` 前缀，资源引用不写死站点根路径。

## 数据模型

- 完成状态由 `completed_at` 是否为空判定，不存在 `status` / `completed` 字段。
- 手动顺序的唯一来源是父级 `child_ids` 的数组顺序；新任务追加到末尾，没有 `sort_order`。
- 顶层任务必须挂在根任务（`is_root`）下：新增统一走 `addTodo`（默认挂根），Agent 工具与导入的顶层任务同样挂根。根任务不出现在列表、统计、回收站、Agent 输出里。
- 删除是软删除（`deleted_at`）。

## 文档记录

- **关键词索引**：用户用现象描述界面细节时，先查 `docs/zh/dev/keyword-index.md`；定位到代码后把「用户说法 → 文件 + 锚点」补进最贴近的分组。同一对象的新说法合并进同一条的「用户可能说」列，用 ` / ` 分隔，不新增重复行。
- **需求记录**：新需求实现后，在 `docs/zh/features/` 最贴近的篇目追加一行（日期 / 需求 / 实现要点与文件）；没有合适篇目再新建，并在 `index.md` 的篇目表登记。英文文档暂不维护。
- **只记现状**：特性文档只描述当前实现；行为改变时直接改写原条目，功能删减直接删掉对应描述，不加「已删除 / 已还原」记录。
- **缺陷记录**：修 bug 不写进 features，更新 `docs/zh/dev/logic/` 的对应机制文档（受影响的机制、根因、修正后的现状逻辑）；没有篇目就新建，并在该目录 `index.md` 登记。

## 验证

- 前端：`cd frontend && npm run build`；改 store 再 `npm test`。
- 类型检查：`cd frontend && npm run type-check` 会因 vue-tsc 1.8 与 TS 5.9 不兼容直接崩，属已知问题，不当作新错误追。
- 文档：`cd docs && npm run build`；`ignoreDeadLinks` 已关闭，死链会中断构建。
- 数据库：实验阶段，结构可随时调整；迁移按领域拆成有序文件（表结构 / 索引 / RLS / 视图 / 函数 / 触发器 / Realtime），可直接改写既有迁移并重置数据库，无需兼容历史数据。
- 迁移校验：本机没有 Postgres 时用 PGlite 按时间戳顺序执行 `supabase/migrations/*.sql`；先建桩：`auth` schema、`auth.users(id uuid)` 表、`auth.uid()` 函数，以及 `anon` / `authenticated` 角色。
