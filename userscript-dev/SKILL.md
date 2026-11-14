---
name: userscript-dev
description: "油猴脚本（Tampermonkey / Violentmonkey / Greasemonkey / ScriptCat）的通用工程约定：Vite + vite-plugin-monkey 骨架、日期时间版本号与 dist 同提交、单一入口按职责拆分、站点差异收进适配层、动态 DOM 防御、中文目的性注释、AGENTS.md 索引与发布自检。**同时覆盖严格 CSP 站点的完整方案**：dev 用「管理器拉取 + 执行阶梯」，正式版用 nonce / 构造式样式表 / GM_* 兜底。Use when: 新建或改动用户脚本、新增站点适配、调整构建/版本号/发布流程，或出现「反复改代码、反复刷新，页面始终看不到任何效果，脚本像没装一样」（控制台报 violates the following Content Security Policy directive、Refused to load the script、script-src 拦截，或只有 build 产物才生效）。"
---

# 用户脚本开发约定

面向一个 Vite 构建、产物入库、由脚本管理器分发的油猴脚本项目。先按任务定位，再只读需要的那一节；深挖 CSP 时再打开 [references/csp.md](./references/csp.md)。

| 要做的事 | 先看 |
| --- | --- |
| 新建项目 / 调整构建 | [项目骨架](#项目骨架) |
| 发版、改版本号 | [版本号与发布](#版本号与发布) |
| 加功能、拆分文件 | [模块拆分](#模块拆分) |
| 新增或修复站点适配 | [DOM 契约](#dom-契约) |
| 改完页面没反应 / 严格 CSP 站点 | [脚本没反应先查 CSP](#脚本没反应先查-csp) → [references/csp.md](./references/csp.md) |
| 写文档、写注释、提交 | [注释与文档](#注释与文档) / [提交](#提交) |
| 不知道还算不算改完 | [验证清单](#验证清单) |

## 一句话原则

一个产物、一个入口、一份索引；新增能力先找现有承载点，能改现有文件就不新增模块。

## 项目骨架

- Vite + `vite-plugin-monkey`，`package.json` 带 `"type": "module"`，入口固定 `src/main.js`。
- 产物落 `dist/<name>.user.js` 并**提交进仓库**：README 的安装地址是 `https://github.com/<owner>/<repo>/raw/main/dist/<name>.user.js`，`dist` 不在版本库里安装链接就断。
- `vite.config.js` 是 userscript 元数据的唯一位置（name / namespace / version / match / grant / run-at）；改域名、加站点、改权限只动这里。
- 铁律：**不手改 `dist/`，只改源码再构建**；也不手改 `vite.config.js` 里的 version（见下节）。
- 依赖保持最小：一个脚本项目通常只需要 `vite` + `vite-plugin-monkey`；不为了顺手引入框架或工具库，原生 ES module 够用就不用。

推荐分层，和实际项目的做法一致：

| 层 | 位置 | 约束 |
| --- | --- | --- |
| 装配 | `src/main.js` | 只做初始化和顺序编排，不放业务 |
| 能力 | `src/<feature>.js` 或 `src/core/` | 一个文件一件事，互相不 import 成环 |
| 站点差异 | `src/handlers/<site>/` 或 `SITE_ADAPTERS` / `src/data/sites/` | 主流程不认识具体站点 |
| 元数据 | `vite.config.js` | 只放 userscript 头与构建参数 |
| 开发构建 | `.dev/` | 版本/发布/调试服务等一切开发构建相关代码，随源码提交；调试产物放 `.dev/build/` |

## 版本号与发布

- 版本号格式 `YYYY.MM.DD.HHmm`（**本地时间**），由脚本写进 `vite.config.js` 的 `userscript.version`；不手填。
- 同一分钟内重复执行或系统时间回拨时，顺延到更大的分钟，保证版本号严格递增——否则管理器认为没更新，不会重新拉取。
- 源码、版本号、`dist` 产物必须在**同一个提交**里，并打 `vYYYY.MM.DD.HHmm` 标签。
- 两种落地方式，按项目现状选，不要同时上：
  - 提交前钩子（`.dev/githooks/pre-commit` → `.dev/bump-and-build.mjs`）：每次提交自动升版本 + 构建 + `git add`，`npm run hooks` 启用。
  - `.dev/release.mjs`：`npm run release "feat: xxx"` 一步升版本 → lint → test → build → commit → tag；`--push` 推送，`--dry-run` 只预览版本号。发布脚本内部提交要 `--no-verify`，避免重复触发钩子。
- `npm run build` 只构建、不动版本号，供本地验证用。
- 构建失败要能中断提交，并把 `vite.config.js` 还原——半途失败不能留下一个升过号但没产物的提交。

## 模块拆分

- `main.js` 只装配：按顺序调用各自的 init，不写业务分支。入口要能判断"已经初始化过"并先清理上一轮（`runtime.initialized` + `dispose()`），否则热更新或重复注入会叠加实例。
- 差异落在数据、配置或适配器上，不落在条件分支里。只靠 `if (site === 'x')` 散落在主流程的差异，说明适配层没建好。
- 站点 handler 自己判断 URL，不匹配就什么都不做——不要指望上层过滤干净。
- 清理函数集中登记（数组 + disposer），事件监听、定时器、observer、注入的节点都从这里走。
- 用延展性检验设计：再加一个站点/一种形态要改几处？改一处才算收好了。

## DOM 契约

- **混淆 class 和层级是脆弱契约**：集中写在选择器常量或 `dom.js` 一类文件里，别散落在各处；站点改版时只改一处，并同步更新文档里的契约描述。
- 命中失败就静默退化：不抛错、不白屏、不阻塞页面自身功能；找不到目标元素时优先选择"少做"而不是"猜测"。
- 动态内容用 `MutationObserver`，不要 `setTimeout` 轮询；回调必须**可重复触发而不重复插入 UI**。
- 能监听容器就绝不整页监听；需要 `document` 时注意 Shadow DOM 的事件重定向，用 `e.composedPath()`，必要时用捕获阶段。
- SPA 路由变化（`pushState` / History）只刷新状态和锚点，不重建整个实例。
- 不改写、不复制应用自己的节点：加属性、加 `order`、插入自己的行，保留选中态、菜单和键盘行为。

## 脚本没反应先查 CSP

"改了很多次都看不到效果"先别继续改业务代码，按顺序确认脚本是否真的执行了：

1. 控制台搜脚本自己的标识（banner、`[前缀]` 日志）——一条都没有，说明脚本根本没跑。
2. Network / Sources 里找 `localhost:5173` 或 `127.0.0.1` 的脚本请求，被拦时有 `violates the following Content Security Policy directive`。
3. 同一份 dev 脚本换个站点正常 → 99% 是站点 CSP，不是构建或热更新坏了。
4. 换成 `build` 产物装进管理器，同页正常 → 锁定为 dev 注入被拦。
5. 管理器标"语法错误"或无任何日志 → 不是 CSP，是生成的安装脚本解析失败，先 `node --check`。

一句话原理：dev server 是往页面插一个跨域 module 脚本，能否加载由页面 `script-src` 决定；正式版由管理器注入，不走页面这条路径，所以才有"只有 build 产物能跑"的割裂。

两条战线分开处理，全文见 [references/csp.md](./references/csp.md)：

| 战线 | 解法 | 配套文件 |
| --- | --- | --- |
| dev 调试 | 管理器拉取产物，按「module + nonce → `blob:` → 沙箱 `eval`」阶梯执行，页面零外部脚本 | [scripts/dev-loader.mjs](./scripts/dev-loader.mjs)（最小）、[scripts/dev-kit.mjs](./scripts/dev-kit.mjs)（完整阶梯） |
| 正式版注入 | `applyStyle` / `loadScript` 三级回退：构造式样式表 → `GM_addStyle` → 带 nonce 的 `<style>`；Trusted Types 用策略包装 | [scripts/csp-runtime.js](./scripts/csp-runtime.js) |

接入要点（细节和坑清单都在 references 里）：

- 开发构建相关代码统一放 `.dev/`（含 `dev-kit.mjs`），调试产物输出到 `.dev/build/`，都不覆盖入库的 `dist/`；`.dev/build/` 进 `.gitignore` 与 lint ignore，`.dev/*.mjs` 保持提交。
- 安装名加 ` (dev)`，并给 dev 构建独立的实例标识（宿主 id、z-index、菜单文案），否则两版互相顶掉。
- 热重执行靠 `unsafeWindow.__USERSCRIPT_TEARDOWN__`：入口先判断 `initialized` 再 dispose，钩子必须幂等。
- 正式版不要直接 `createElement('style')`，走 `applyStyle`；CDN 资源走 `loadCss` / `loadScript`。
- 站点连内联都不允许时才降级：`loadScript` 的最后一级是沙箱 eval（拿不到页面全局作用域，必须打 warning）。

## 注释与文档

- 注释用中文，写**目的**和**为什么**，不写步骤复述，不写变更史。读者应该看不出这段代码改过几次，就像一开始就是这么写的。
- 只给需要澄清的地方写注释：契约性数值、反直觉的顺序、绕坑的原因。显然的代码不加。
- 改动代码时同步重写受影响的注释，保留最初动机和最新现状。
- 文档三层分工，别混：
  - `README.md`：给用户——功能列表、安装地址、效果说明。
  - `README-dev.md`：给开发——环境、`dev` / `dev:csp` 用法、构建与发布流程。
  - `AGENTS.md`：给 agent 和自己定位代码——文件职责表、关键不变量、**常见任务 → 先读哪些文件**、改动路径。
- `AGENTS.md` 开头就声明它是"定位文件的速查表，不是项目介绍"，并要求结构变化时同步更新；新增文件或改职责必须同步这张表，否则下次还得从头扫仓库。

## 提交

- Conventional Commits：`feat:` / `fix:` / `style:` / `docs:` / `chore:`，可带 scope。
- 一个提交讲清一件事，描述写"影响了什么行为、为什么"，不要写"改了点东西"。
- 版本号与产物跟源码同提交；不要把构建产物混进与它无关的提交。
- 发布走项目脚本（`release` / 钩子），不要手工拼 commit + tag。

## 验证清单

按成本从低到高，能跑的都跑：

1. `npm run build` 必过——所有项目的最低门槛，产物头部 `@version` 要和 `vite.config.js` 一致。
2. 有 lint / test 的项目一并跑（`npm run lint`、`npm test`）；能测的逻辑放纯 JS 模块里，不要为了测试去挂载 UI 组件。
3. 改功能后跑一次针对性单测，而不是只跑全量后看"没红"。
4. 真机验证：打开目标站点，控制台出现脚本自己的启动日志和初始化计数；按改动的功能逐项点一遍（选中态、菜单、折叠、跳转、拖动）。
5. 涉及 CSP 的改动，用 references 里的验证清单（`install.user.js` 返回 200、`__hash` 随改动变化、`@name` 带 `(dev)`、`node --check` 通过）。

## 反模式

- 为了新功能新建入口或页面，而现有 handler、面板扩展一下就能承载。
- 同一份输出契约写两处实现（拖动和重命名各写一遍前缀截取，两套站点识别逻辑）。
- 用显示文本反推真实数据（叶子只显示末段后，拿它去拼路径）。
- 选择器散落在业务代码里，站点改版后要靠搜索全仓库找。
- 手改 `dist/`、手改版本号，或让 `dist` 落后于源码。
- 注释写"第 N 版改成……"，文档写完整变更史。
