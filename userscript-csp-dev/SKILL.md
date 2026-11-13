---
name: userscript-csp-dev
description: 解决用户脚本（Tampermonkey / Violentmonkey / Greasemonkey / ScriptCat）在严格 CSP 站点上 dev 模式完全不运行的问题。**只要出现「反复改代码、反复刷新，页面始终看不到任何效果，脚本像没装一样」就先读本文**（也适用于改样式/改逻辑后目标站点毫无变化、只有 build 产物才生效、同一份代码换个站就正常）。具体信号：控制台报 "Loading the script 'http://localhost:5173/__vite-plugin-monkey.entry.js' violates the following Content Security Policy directive"、"Refused to load the script"、"script-src" 拦截。还用于给新项目接入「管理器拉取 + eval」的 CSP 无关调试流程。
---

# 用户脚本 dev 模式的 CSP 坑

## 先做 30 秒排查：脚本到底跑了没有

「改了很多次都看不到效果」先别继续改业务代码，按顺序确认脚本是否真的执行了：

1. 页面控制台搜脚本自己的标识（banner、`[前缀]` 日志）：一条都没有 → 脚本根本没运行，属于本文的坑。
2. DevTools → Sources / Network 里找 `localhost:5173` 或 `127.0.0.1:5173` 的脚本请求：被 CSP 拦下时会有 `violates the following Content Security Policy directive` 报错，Console 里也可能只留一行 `Refused to load the script`。
3. 换个站点打开同一份 dev 脚本：别的站正常、这个站全无反应 → 99% 是站点 CSP，不是构建或热更新坏了。
4. 把 `build` 产物装进管理器再打开同一页面：能正常工作 → 进一步锁定为 dev 注入被拦。
5. 管理器脚本列表里名字旁直接标着「语法错误」，或装完连一行日志都没有：不是 CSP，是**生成出来的安装脚本本身解析失败**，
   先 `curl -s http://127.0.0.1:5180/install.user.js -o /tmp/i.user.js && node --check /tmp/i.user.js`，
   报错就去看加载器的模板字符串转义（见坑清单第一条）。

## 症状与判定

三条都能对上，就是本文的问题，不要再去怀疑业务代码：

1. 页面控制台有 `Loading the script 'http://localhost:5173/...' violates the following Content Security Policy directive: "script-src ..."`。
2. `pnpm build` 出来的 `.user.js` 装进管理器后同一页面一切正常（生产版由管理器注入 / 内联，受 `'unsafe-inline'` 或隔离世界保护）。
3. 站点响应头里 `content-security-policy` 的 `script-src` 不含 `localhost` / `127.0.0.1`。

一句话原理：dev server 的注入方式是**往页面插一个跨源 module 脚本**，页面 CSP 决定能否加载；源不在白名单就整份脚本不执行。所以任何「让页面去加载 localhost」的插件都无解（`vite-plugin-monkey`、`vite-userscript-plugin` 都是这条路，换插件没有收益）。

## 采用方案：管理器拉取 + eval（CSP 无关）

页面不加载任何外部脚本，改由脚本管理器自己去拉产物、在自己的沙箱里执行：

```
watch 构建 IIFE 产物  ──►  本地 HTTP 服务  ──►  管理器 GM_xmlhttpRequest 拉取  ──►  eval
```

配套脚本：[scripts/dev-loader.mjs](./scripts/dev-loader.mjs)（零依赖，只用 Node 内置模块）

```bash
# 最小用法：已有构建产物时只起服务
node scripts/dev-loader.mjs --bundle dist/app.user.js

# 推荐用法：watch 构建 + 服务一起跑
node scripts/dev-loader.mjs --bundle .dev/app.user.js --build "vite build --watch"
```

首次打开 `http://127.0.0.1:5180/install.user.js` 安装 `xxx (dev)`，之后任意页面自动加载最新产物；产物哈希变化时整页刷新，替代 HMR。端点：`/install.user.js`、`/bundle.js`、`/__hash`、`/`。

为什么可行（照抄时别改这三处）：

- **产物必须是自包含脚本**（IIFE / userscript 构建），不能是 ESM 分块：`eval` 不解析 import。
- **必须直接 `eval(...)`**：间接 eval / `new Function` 会落到全局作用域，看不到管理器注入的 `GM_*`，脚本会以为没有存储能力。
- **脚本名加 `(dev)`**：管理器按 `name + namespace` 识别脚本，同名会把正式版顶掉。配置通常存在项目自己的 storage key 里，两版自然共享。

## 接入到任意项目

1. 构建产物输出到独立目录（如 `.dev/`），不要覆盖随源码提交的 `dist/`；同时关掉压缩，保留可读栈。
2. 让产物在 dev 构建下用**不同的实例标识**（宿主元素 id、z-index 层级、菜单项文案等），否则 dev 版和正式版在同一页面会互相顶掉或叠在一起。
3. 跑 watch 构建 + 服务，把安装地址写进文档；`.dev/` 加进 `.gitignore`，产物目录加进 ESLint ignore。
4. 管理器侧要求：允许 eval（Tampermonkey / Violentmonkey 默认允许），注入方式保持「隔离世界 / 沙箱」，设成「页面上下文」会重新受站点 CSP 限制。

manifest 侧的最小授权（产物头里要有）：`@grant GM_xmlhttpRequest`、`@connect *`（或至少本地地址）、`@match *://*/*`、`@noframes`。

## 坑清单

| 坑 | 表现 | 处理 |
| --- | --- | --- |
| 生成脚本的转义被提前展开 | 管理器标「语法错误」、装完完全没反应；或 `ReferenceError: 某句中文 is not defined` | 加载器是模板字符串拼出来的，字符串里写 `\n` 会在**生成阶段**就变成真换行、把字面量断成两行。一律双写反斜杠；注释里也别写单个 `\n`。加启动自检 `new Script(loaderSource())`，写坏立刻退出 |
| 每次都要手动点安装 | 自动打开的是落地页，还得再点一次链接 | 服务就绪后直接打开 `${origin}/install.user.js`，让管理器接管弹安装框；给个 `--no-open` 便于反复重启时静音 |
| 只做了静态校验 | `node --check` 过了，装进管理器仍然不跑 | 静态检查看不出生成期转义和运行期契约问题；按验证清单真跑一遍加载器 |
| 间接 eval | 脚本跑起来但配置读不到、图标不加载 | 用 `eval(code)`，不要 `(0, eval)(code)` / `new Function` |
| ESM 产物 | eval 报 `Cannot use import statement outside a module` | watch 构建用 IIFE（userscript 产物本身就是） |
| 同名覆盖 | 装完 dev 版，正式版不见了 | 安装名加 `(dev)` |
| 同实例冲突 | 两版同时在页面里，宿主元素/设置面板互相覆盖 | dev 构建注入独立实例标识（如 `VITE_XXX_ROLE=dev`） |
| 首屏 503 | 刚启动服务就打开安装页 | 等 watch 构建产出第一份产物；服务本身会返回 503 提示 |
| 修改不生效 | 刷新后还是旧代码 | 检查产物路径是否与 watch 输出一致；`/__hash` 应随改动变化 |
| 自研构建不触发重建 | 改了源码，`/__hash` 还是旧值 | `node --watch` 只跟踪 import 图；用 `readFile` 取源码的构建脚本不会因源码变化重启，改用 `node --watch-path=src`，或直接上 bundler 的 watch |
| 端口冲突 | `EADDRINUSE` | `--port` 换端口（常见做法：避开 dev server 的 5173） |
| Chrome 142 本地网络访问 | 页面请求 `127.0.0.1` 被拦要授权 | 本方案请求由管理器发起、不经过页面，天然不受此限 |

## 与其它路线的取舍

- **官方建议的 Disable-CSP 扩展**：一行代码不改，但调试期间所有站点都失去 CSP 保护，且不解决本地网络访问授权。
- **`@require http://localhost:...`**：管理器拉取，同样不受 CSP，但管理器会缓存 `@require`，改代码要重装脚本，开发体验差。
- **用 CDP 关掉页面 CSP**（自建 Chrome + `Page.setBypassCSP`）：保留 HMR、源码断点，代价是多一个独立浏览器实例和 Chrome 版本带来的参数差异；只有在强需求 HMR 时才选它。
- **改成浏览器扩展（CRXJS / Plasmo）分发**：content script 由浏览器注入，天然无 CSP 问题，但要维护双构建双产物，产品形态也变了。

## 验证清单

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5180/install.user.js   # 200
curl -s http://127.0.0.1:5180/__hash                                            # 有值，改代码后变化
curl -s http://127.0.0.1:5180/install.user.js | head -3                          # @name 带 (dev)
```

```bash
# 加载器是生成物：解析不了就是管理器里那个「语法错误」（服务启动时也会自检同样的东西）
curl -s http://127.0.0.1:5180/install.user.js -o /tmp/i.user.js && node --check /tmp/i.user.js
```

比静态检查更可靠：用 `happy-dom` 建页面、`node:vm` 跑 `install.user.js` 的加载器部分，把 `GM_xmlhttpRequest` 换成走本地 http 的实现，
断言脚本自己的 banner 日志出现、没有 `[dev]` 报错。这一步能在交给浏览器之前发现「装上了但没执行」。
注意测试脚本别放进 watch 构建的输出目录（如 `.dev/`），构建会清空该目录。

页面侧：安装后在严格 CSP 站点打开目标页，确认脚本自身宿主元素出现、功能可用；DevTools 的 Sources 里能看到 `userscript.dev.bundle.js`。
