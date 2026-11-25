---
name: frontend-init
description: 前端项目工程基线初始化：探测框架、包管理器与现有配置，补齐 Vite 开发默认值（server.open）、scripts、目录结构、lint/format 与测试脚手架，并衔接 dev-init 的 AGENTS.md 索引。适用于新建前端项目、项目接入 AI、缺少统一开发配置，或用户说「前端项目初始化」「按默认配置补全」。关键词：frontend-init、前端初始化、Vite、vite.config、server.open、自动打开浏览器、lint、prettier、eslint、biome、vitest、jest、测试脚手架、目录结构、工程模板。
---

# frontend-init

目标：让一个不了解项目的前端仓库跑一遍就能按同一套默认值开发。只补缺口，不推倒已有工具链；工程配置归本技能，`AGENTS.md` 与 `docs/` 归 `dev-init`。

## 1. 探测现状

读这些文件，只写确认过的事实：

- `package.json`：框架与版本、scripts、包管理器（看锁文件：`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lock`）
- 构建配置：`vite.config.*`、`webpack.config.*`、`next.config.*`、`svelte.config.*`
- 语言与检查：`tsconfig.json` / `jsconfig.json`、`.editorconfig`、ESLint / Prettier / Biome 配置
- 测试：`vitest.config.*`、`jest.config.*`、`playwright.config.*`
- `.gitignore`、现有 `docs/` 与 `AGENTS.md`

先跑一次基线（`npm run build`，有就再跑 lint / test），记录本来是什么结果，不把既有失败当成本次引入的问题。

用户脚本项目（vite-plugin-monkey、`@match`、`dist` 版本号）交给 `userscript-dev`，本技能只处理普通前端项目。

## 2. 默认配置（只补缺失）

| 项 | 默认 | 边界 |
| --- | --- | --- |
| 框架 | 沿用项目现有（Vue / React / Svelte / 纯静态） | 新项目没指定就不猜，先问 |
| 包管理器 | 按已有锁文件；新项目默认 npm | 不并存两个锁文件 |
| Vite dev | `server.open: true` | 所有前端项目默认开启；`host` / `port` / `strictPort` 保持默认，容器内开发等硬约束以项目为准，并在 `docs/development.md` 记例外 |
| scripts | `dev` / `build` / `preview`，有 lint / test 各一条 | 命令必须能原样跑通 |
| 目录 | `src/` 下按职责分：入口、组件或页面、`core` / `lib`、`assets` | 不预建空目录；存量项目按现有结构扩展，不迁移 |
| lint / format | 沿用现有工具链；新项目默认 ESLint flat config + Prettier | 同时只保留一套，不并行装第二套 |
| 测试 | 沿用现有（Vitest / Jest / Playwright）；新项目默认 Vitest | 存量项目没有就不强行加，用户要求时再补 |
| `.gitignore` | `node_modules/`、`dist/`、测试与构建缓存 | 已有条目不重复 |

新依赖只在补默认值时引入，并在提交说明里写引入理由；已有工具链能用的不替换。

## 3. 文档衔接

- 项目还没有 `AGENTS.md`：收尾时接续执行 `dev-init`，由它建索引与 `.github/copilot-instructions.md`。
- 已有 `AGENTS.md`：不改它的结构，只把开发命令、默认值例外登记到 `docs/development.md`，指针由 `dev-init` 维护。

## 4. 校验

- `npm run build` 通过；有 lint / test 的一并跑，结果如实报告。
- `npm run dev` 启动后确实自动打开浏览器；容器或 CI 里打不开时说明原因并记录例外。
- `.gitignore` 覆盖 `node_modules/` 与构建产物，`git status` 只含本次应有的改动。
- 新增依赖出现在 `package.json`，锁文件与之一致。

## 5. 提交

按仓库既有约定提交；有 `release` 脚本就交给发布流程，不单独 `git commit`。
