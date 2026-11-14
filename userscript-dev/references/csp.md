# 严格 CSP 站点：dev 调试 + 运行时兜底

> 所属技能：[userscript-dev](../SKILL.md)。项目骨架、版本号、提交与验证等通用约定在主文档。

严格 CSP 站点上有两条独立的战线，不要混为一谈：

| 战线 | 谁在拦截 | 本方案的解法 |
| --- | --- | --- |
| dev 调试 | 页面加载 `localhost` 模块脚本 → `script-src` | 管理器拉取产物 + 执行阶梯（nonce → blob → 沙箱 eval），页面零外部脚本（见下） |
| 正式版注入 | 页面里的 `<style>` / CDN 资源 → `style-src` / `script-src` / `font-src` | `csp-runtime.js` 三级回退（见「运行时兜底」） |

配套文件：
- [scripts/dev-loader.mjs](../scripts/dev-loader.mjs)：零依赖调试服务（最小实现：管理器拉取 + 直接 eval），一个命令搞定 watch 构建 + 拉取 + 热更新
- [scripts/dev-kit.mjs](../scripts/dev-kit.mjs)：零依赖调试服务（完整实现：module+nonce → blob → eval 执行阶梯，可选 HMR），任意项目拷一个文件即可用
- [scripts/csp-runtime.js](../scripts/csp-runtime.js)：运行时模块，拷进项目用

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

一句话原理：dev server 的注入方式是**往页面插一个跨源 module 脚本**，页面 CSP 决定能否加载；源不在白名单就整份脚本不执行。所以任何「让页面去加载 localhost」的插件在**纯主机白名单**站点上都无解（`vite-plugin-monkey`、`vite-userscript-plugin` 都是这条路，换插件没有收益）。两个例外值得利用：页面用 nonce-source 时能借页面的 nonce 继续加载（ChatGPT），页面放行 `blob:` 时能先取文本再以 `blob:` 执行（Gemini）；两者都走不通才落到沙箱 eval。`dev-kit.mjs` 把这三条做成阶梯。

## 采用方案：管理器拉取 + eval（CSP 无关）

页面不加载任何外部脚本，改由脚本管理器自己去拉产物、在自己的沙箱里执行：

```
watch 构建 IIFE 产物  ──►  本地 HTTP 服务  ──►  管理器 GM_xmlhttpRequest 拉取  ──►  eval
```

配套脚本：[scripts/dev-loader.mjs](../scripts/dev-loader.mjs)（零依赖，只用 Node 内置模块）

```bash
# 最小用法：已有构建产物时只起服务
node .dev/dev-loader.mjs --bundle .dev/build/app.user.js

# 推荐用法：watch 构建 + 服务一起跑
node .dev/dev-loader.mjs --bundle .dev/build/app.user.js --build "vite build --watch --outDir .dev/build"
```

首次打开 `http://127.0.0.1:5180/install.user.js` 安装 `xxx (dev)`，之后任意页面自动加载最新产物。端点：`/install.user.js`、`/bundle.js`、`/__hash`、`/`。

产物变化后怎么更新，按脚本能力自动选：

- **默认整页刷新**：最稳，任何脚本都能用。
- **热重执行**：脚本在页面 window 上暴露 `window.__USERSCRIPT_TEARDOWN__ = () => {...}`（或 `--hook 名字` 指定别的名字），载入器改为「调钩子 → 重新 eval」，页面状态、滚动位置都不丢。

```js
// 入口末尾：登记清理函数，dev 载入器据此热重执行（生产版无副作用）
if (typeof unsafeWindow !== 'undefined') {
  unsafeWindow.__USERSCRIPT_TEARDOWN__ = () => {
    disposers.forEach((fn) => fn());
    document.getElementById(HOST_ID)?.remove();
  };
}
```

`--reload` 可强制回到刷新模式。注意钩子必须**幂等且可重复调用**，并在注册前先调用上一轮留下的钩子（或让入口自己判断 `initialized` 后先 dispose），否则热重执行会叠加实例。

为什么可行（照抄时别改这三处）：

- **产物必须是自包含脚本**（IIFE / userscript 构建），不能是 ESM 分块：`eval` 不解析 import。
- **必须直接 `eval(...)`**：间接 eval / `new Function` 会落到全局作用域，看不到管理器注入的 `GM_*`，脚本会以为没有存储能力。
- **脚本名加 `(dev)`**：管理器按 `name + namespace` 识别脚本，同名会把正式版顶掉。配置通常存在项目自己的 storage key 里，两版自然共享。

`dev-loader.mjs` 还会自动把 `@grant GM_xmlhttpRequest` 和 `@connect 127.0.0.1` 补进安装头——产物自己没声明这两个权限也能跑。

## 完整方案：执行阶梯（`dev-kit.mjs`）

想把「能降级就降级，降不下来才用沙箱」一次做全，拷 [scripts/dev-kit.mjs](../scripts/dev-kit.mjs) 进项目（单文件、零依赖，不需要改构建配置）。安装条目由它生成，加载器按顺序尝试，任何一级成功就停：

| 顺序 | 方式 | 前提 | 得到什么 |
| --- | --- | --- | --- |
| 1 | module + 页面 nonce | 页面用 nonce-source（ChatGPT） | 真 Vite HMR + 源码断点 |
| 2 | `blob:` 单文件包 | 页面 `script-src` 放行 `blob:`（Gemini） | 页面上下文，与 `@grant none` 的正式版一致 |
| 3 | 沙箱内直接 `eval` | 管理器允许 eval、注入方式为沙箱 | 不受任何 CSP 影响，且能看到 `GM_*` |

**选路依据是产物头**：`auto` 模式下带 `@grant` 的走沙箱（否则 `GM_*` 静默降级成 `localStorage`），`@grant none` 的走页面。前一级失败自动降级，并打印断在哪一级。

```bash
# 任意构建器（只认 .user.js 产物）
node .dev/dev-kit.mjs --bundle .dev/build/app.user.js --build "vite build --watch --outDir .dev/build"
# vite-plugin-monkey：自动 build 到 .dev/build 并取唯一的 *.user.js
node .dev/dev-kit.mjs --preset vite-monkey
# 没有产物、只要 HMR
node .dev/dev-kit.mjs --hmr http://localhost:5173/src/main.js --name "我的脚本" --match "https://site/*"
```

更新方式与 `dev-loader.mjs` 同一套契约：脚本暴露 `__USERSCRIPT_TEARDOWN__` → 调钩子后原地重执行，没有钩子 → 整页刷新，`--hot` / `--reload` 可强制；`--hook` 换钩子名，`--exec page|sandbox` 关掉自动选路。安装头同样自动补 `@grant GM_xmlhttpRequest` 与 `@connect`，去掉 `@grant none` 与更新地址，避免 dev 版被管理器升级成正式版。

端点比最小实现多一个：`/install.user.js`、`/bundle.js`、`/__hash`、`/__status`（当前 hash、产物、exec 与更新方式）、`/`。改 `dev-kit.mjs` 后按下面「验证清单」跑一遍：覆盖头部改写、三条执行路径与两条更新路径，技能里只放单文件。

选型：**只求稳就用 `dev-loader.mjs`**（沙箱 eval 一条路，行为最可预测）；**想保留页面上下文或 HMR、又不想逐站点妥协，用 `dev-kit.mjs` 的阶梯**。两条都不碰正式版的运行时兜底（下一节）。

## 运行时兜底：正式版在严格 CSP 站点怎么活

开发期可以绕开页面 CSP，正式版不能——它就在页面里跑。把 [scripts/csp-runtime.js](../scripts/csp-runtime.js) 拷进项目（如 `src/csp.js`），所有注入点都走它：

| API | 作用 |
| --- | --- |
| `getNonce()` / `resetNonce()` | 复用页面 `style[nonce]` / `script[nonce]`；只缓存命中的值，SPA 重建后重置 |
| `isInlineStyleBlocked()` | 探针判断 `style-src` 是否禁了内联，据此切换降级 UI |
| `applyStyle(css, { root, id })` | **构造式样式表 → `GM_addStyle` → 带 nonce 的 `<style>`**，返回移除函数；同 `id` 自动替换 |
| `loadCss(href)` | 直连 `<link>`，被拦则管理器取文本再注入（注意 `@font-face` 仍受 `font-src`） |
| `loadScript(src)` | 直连 `<script>`，被拦则管理器取源码 → 内联执行 → 再失败退到沙箱 eval |
| `runScript(code)` | 以页面允许的方式执行源码，自动套 Trusted Types 策略 |

优先级设计（照抄别改顺序）：

- **构造式样式表第一**：`adoptedStyleSheets` 完全不受 `style-src` 约束，也没有 `'unsafe-inline'` 问题，还支持后续改写。ShadowRoot 与 document 都能用。
- **`GM_addStyle` 第二**：由管理器注入，绕过页面 CSP，但只能写进页面文档，ShadowRoot 里没有对应 API。
- **带 nonce 的 `<style>` 最后**：nonce 必须在 `appendChild` **之前**设置，之后再改无效。
- **Trusted Types**：Gemini 这类站点在设置 `script.src` / `script.text` 时直接抛错，必须用 `createPolicy` 包一层；同名策略被别的实例占用时换随机后缀。
- **`loadScript` 的最后一级是沙箱 eval**：CSP 管不到管理器沙箱，代价是代码拿不到页面全局作用域，只在页面连内联都不允许时触发，并打 warning。

`applyStyle` 用 `WeakMap<root, Map<id, dispose>>` 记账，同 id 再注入会先移除旧的，热更新不会叠加样式。

## 接入到任意项目

1. 构建产物输出到 `.dev/build/`，不要覆盖随源码提交的 `dist/`；同时关掉压缩，保留可读栈。
2. 让产物在 dev 构建下用**不同的实例标识**（宿主元素 id、z-index 层级、菜单项文案等），否则 dev 版和正式版在同一页面会互相顶掉或叠在一起。
3. 把 [dev-loader.mjs](../scripts/dev-loader.mjs)（或完整版 [dev-kit.mjs](../scripts/dev-kit.mjs)）和 [csp-runtime.js](../scripts/csp-runtime.js) 拷进项目 `.dev/`、`src/`，加两条 npm script：

   ```json
   {
     "scripts": {
       "dev:csp": "node .dev/dev-loader.mjs --bundle .dev/build/app.user.js --build \"vite build --watch --outDir .dev/build\"",
       "dev:kit": "node .dev/dev-kit.mjs --preset vite-monkey"
     }
   }
   ```

4. 跑起来，把安装地址写进文档；`.dev/build/` 加进 `.gitignore` 与 ESLint ignore，`.dev/*.mjs` 保持提交。
5. 管理器侧要求：允许 eval（Tampermonkey / Violentmonkey 默认允许），注入方式保持「隔离世界 / 沙箱」，设成「页面上下文」会重新受站点 CSP 限制。

manifest 侧的最小授权：`@grant GM_xmlhttpRequest`、`@connect *`（或至少本地地址）、`@match *://*/*`、`@noframes`。载入器会自动补前两项。

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
| 热重执行后实例叠加 | 页面里出现两份宿主、事件响应两次 | teardown 钩子必须清干净（宿主节点、监听器、定时器、observer）；入口先判断 `initialized` 再 dispose |
| 钩子挂在沙箱 window 上找不到 | 明明注册了钩子，仍然整页刷新 | 沙箱与页面 window 不是同一个对象；钩子要挂 `unsafeWindow`，载入器会两处都查 |
| 生产版样式整段失效 | 严格 `style-src` 站点上布局崩、日志无报错 | 用 `applyStyle`（构造式样式表优先），不要直接 `createElement('style')` |
| CDN 资源被拦 | 图标字体 / 公式补丁不加载 | `loadCss` / `loadScript` 自动改走管理器拉取；或干脆只在支持的站点加载 |
| Trusted Types 抛错 | Gemini 上设 `script.src` 直接 throw | 走 `runScript` / `loadScript`，内部已用 `createPolicy` 包装；dev 载入器自带同名策略复用 |
| dev 版配置读不到或存储不生效 | 页面上下文执行时没有 `GM_*`，代码静默退回 `localStorage` | 别让带 `@grant` 的脚本走 blob：kit 的 `--exec auto` 会按产物头选沙箱 |
| 阶梯三级全失败 | 页面无 nonce、不放行 `blob:`、管理器禁 eval | 看 `__DEV_KIT__.error`；换管理器，或用 `--exec page` / `sandbox` 明确指定 |

## 与其它路线的取舍

- **官方建议的 Disable-CSP 扩展**：一行代码不改，但调试期间所有站点都失去 CSP 保护，且不解决本地网络访问授权。
- **`@require http://localhost:...`**：管理器拉取，同样不受 CSP，但管理器会缓存 `@require`，改代码要重装脚本，开发体验差。
- **用 CDP 关掉页面 CSP**（自建 Chrome + `Page.setBypassCSP`）：保留 HMR、源码断点，代价是多一个独立浏览器实例和 Chrome 版本带来的参数差异；只有在强需求 HMR 时才选它。
- **在页面内做多级降级**（直连 → 复用 nonce → blob 单文件包）：不用额外命令和端口，普通站点仍有 HMR；但只解决 `script-src`，样式仍受 `style-src` 约束，且要跟着打包插件内部结构走（正则改写它的注入段），结构一变就得 `console.warn` 提示手动放行。通用、无耦合的版本见 `dev-kit.mjs` 的执行阶梯——它只认 `.user.js` 产物，不改插件。
- **改成浏览器扩展（CRXJS / Plasmo）分发**：content script 由浏览器注入，天然无 CSP 问题，但要维护双构建双产物，产品形态也变了。

选型建议：**调试用管理器拉取 + eval**（唯一在所有严格 CSP 站点上都成立的做法，与 `script-src` / `connect-src` / 本地网络授权全部无关；要页面上下文或 HMR 时用 `dev-kit.mjs` 的阶梯逐级降级）；**正式版用 `csp-runtime.js` 的三级回退**。页面内降级链只在「必须保留页面上下文或 HMR」时才有价值。

## 验证清单

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5180/install.user.js   # 200
curl -s http://127.0.0.1:5180/__hash                                            # 有值，改代码后变化
curl -s http://127.0.0.1:5180/install.user.js | head -3                          # @name 带 (dev)
curl -s http://127.0.0.1:5180/__status                                           # dev-kit：hash / 产物 / exec / 更新方式
```

```bash
# 加载器是生成物：解析不了就是管理器里那个「语法错误」（服务启动时也会自检同样的东西）
curl -s http://127.0.0.1:5180/install.user.js -o /tmp/i.user.js && node --check /tmp/i.user.js
```

比静态检查更可靠：用 `happy-dom` 建页面、`node:vm` 跑 `install.user.js` 的加载器部分，把 `GM_xmlhttpRequest` 换成走本地 http 的实现，
断言脚本自己的 banner 日志出现、没有 `[dev]` 报错。这一步能在交给浏览器之前发现「装上了但没执行」。
注意测试脚本别放进 watch 构建的输出目录（如 `.dev/build/`），构建会清空该目录。

这一段可以直接跑，覆盖「首次执行」和两条更新路径：

```js
import vm from 'node:vm';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const text = await readFile('/tmp/i.user.js', 'utf8');
const body = text.slice(text.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length);
const logs = [];
const timers = [];
const ctx = {
  console: { log: (...a) => logs.push(['log', ...a]), error: (...a) => logs.push(['error', ...a]), warn: (...a) => logs.push(['warn', ...a]) },
  location: { reload: () => logs.push(['reload']) },
  setInterval: (fn) => { timers.push(fn); return timers.length; },
  setTimeout: () => {},
  URL,
  GM_xmlhttpRequest: ({ url, onload, onerror }) => http.get(url, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => onload({ status: res.statusCode, responseText: data }));
  }).on('error', onerror),
};
ctx.window = ctx;
ctx.globalThis = ctx;
// 模拟脚本暴露热重执行钩子；去掉这行验证整页刷新分支
ctx.__USERSCRIPT_TEARDOWN__ = () => logs.push(['teardown']);
vm.createContext(ctx);
vm.runInContext(body, ctx);
await new Promise((r) => setTimeout(r, 400));       // 首次拉取执行
// 改产物后触发轮询，应看到 teardown + 第二次执行；没有钩子时应看到 reload
for (const tick of timers) await tick();
console.log(logs);
```

运行时模块也可以单测：注入一个带 `nonce` 的 `<style>` 验证 `getNonce` 缓存与 `resetNonce`，
删掉 `globalThis.CSSStyleSheet` 验证回退到 `<style>` 且 `nonce` 属性已写入，设一个假的 `GM_addStyle` 验证它优先于 `<style>`。

页面侧：安装后在严格 CSP 站点打开目标页，确认脚本自身宿主元素出现、功能可用；DevTools 的 Sources 里能看到 `userscript.dev.bundle.js`。
