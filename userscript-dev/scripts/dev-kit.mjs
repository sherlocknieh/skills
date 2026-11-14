#!/usr/bin/env node
/**
 * 用户脚本通用调试服务（userscript-dev-kit）。
 *
 * 解决的问题：`vite dev` 之类的调试方式会把 http://localhost 的模块脚本塞进页面，
 * 站点 CSP 的 script-src 不含这个源时整份脚本都不执行，控制台只剩一行
 * "Refused to load the script"。正式版由脚本管理器注入，不受这个限制，
 * 于是开发期就出现「只有 build 产物能跑」的割裂。
 *
 * 做法：页面不直接依赖 localhost。安装条目由本服务生成，脚本管理器拉取后
 * 按「执行阶梯」依次尝试，任何一级成功就停：
 *   1. module + 页面 nonce —— 站点用 nonce-source 时保留 Vite HMR（ChatGPT）
 *   2. blob: 单文件包   —— 站点放行 blob: 时按页面上下文执行（Gemini）
 *   3. 沙箱内直接 eval  —— 不经过页面加载路径，任何 CSP 都拦不住，且能看到 GM_*
 * 产物哈希变化后默认整页刷新，也可以 --hot 原地重执行。
 *
 * 上游：由 `node dev-kit.mjs` 直接运行，或作为 vite 插件的独立进程启动；
 * 下游：生成的 install.user.js 由 Tampermonkey/Violentmonkey 拉取，加载器在
 *       管理器沙箱里运行，再按阶梯拿单文件包。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

const TAG = '[dev-kit]';
const DEFAULT_DIR = '.dev/build';
const DEFAULT_PORT = 5180;
const HEADER_START = '// ==UserScript==';
const HEADER_END = '// ==/UserScript==';

/* ------------------------------------------------------------------ *
 * 加载器：被拼进 install.user.js 的那段代码
 * ------------------------------------------------------------------ */

/**
 * 生成加载器源码。
 *
 * 只在沙箱里运行（管理器授予 GM_xmlhttpRequest 才能成立），因此可以直接 eval；
 * cfg 里都是可 JSON 化的标量，拼接时只用 JSON.stringify，避免转义写坏。
 */
function loaderSource(cfg) {
    return `(() => {
  var CFG = ${JSON.stringify(cfg)};
  var TAG = '[dev-kit]';
  var page = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
  var hash = '';

  // 每个分支都把状态写回 __DEV_KIT__，脚本自身可据此切换 dev 实例标识或读失败原因
  var state = function () {
    var s = page.__DEV_KIT__;
    if (!s) {
      s = page.__DEV_KIT__ = { dev: true, instance: 'dev', mode: 'boot', error: '', dispose: [] };
      s.onDispose = function (fn) { s.dispose.push(fn); };
    }
    return s;
  };

  // 统一的失败出口：说清哪条路断了、下一步该查什么，避免「装上没反应」
  var report = function (text, err) {
    state().error = text;
    console.warn(TAG + ' ' + text + (err ? '：' + ((err && err.message) || err) : ''));
  };

  var log = function (mode) {
    state().mode = mode;
    console.info(TAG + ' 调试版已启动（' + mode + '）');
  };

  // 产物由管理器发请求取回：走管理器通道，不经过页面的 connect-src
  var request = function (url, ok, fail) {
    if (typeof GM_xmlhttpRequest !== 'function') {
      report('管理器没有授予 GM_xmlhttpRequest，无法拉取调试产物');
      return;
    }
    GM_xmlhttpRequest({ method: 'GET', url: url, onload: ok, onerror: fail || function () {} });
  };

  // Trusted Types 站点（Gemini）要求脚本地址是 TrustedScriptURL，策略按名字缓存复用
  var trusted = function (url) { return url; };
  (function () {
    var tt = page.trustedTypes;
    if (!tt || !tt.createPolicy) return;
    var policy = page.__DEV_KIT_TT__;
    if (!policy) {
      try {
        policy = tt.createPolicy(CFG.policy, { createScriptURL: function (s) { return s; } });
        page.__DEV_KIT_TT__ = policy;
      } catch (e) { return; }
    }
    trusted = function (url) { return policy.createScriptURL(url); };
  })();

  // 清理契约：先跑脚本自己挂的 teardown 钩子（与 dev-loader.mjs 同一套），再跑 onDispose 登记的函数
  var teardown = function () {
    if (!CFG.hook) return null;
    var places = [page, window];
    for (var i = 0; i < places.length; i += 1) {
      try {
        if (places[i] && typeof places[i][CFG.hook] === 'function') return places[i][CFG.hook];
      } catch (e) {}
    }
    return null;
  };

  // 重执行前清理干净，避免热更新把宿主节点和监听器叠起来
  var dispose = function () {
    var hook = teardown();
    if (hook) {
      try { hook(); } catch (e) { console.warn(TAG + ' teardown 钩子抛错', e); }
    }
    var hooks = state().dispose.splice(0);
    for (var i = 0; i < hooks.length; i += 1) {
      try { hooks[i](); } catch (e) { console.warn(TAG + ' 清理函数抛错', e); }
    }
  };

  // 更新方式：--reload 强制刷新；--hot 或脚本自带 teardown 钩子时原地重执行
  var canHot = function () {
    if (CFG.reload) return false;
    return CFG.hot || typeof teardown() === 'function';
  };

  // 阶梯一：dev server 的 module 入口。页面有 nonce 时沿用，HMR 与源码断点都保留
  var loadModule = function (entry, next) {
    var inject = function (withNonce) {
      var parent = document.head || document.documentElement;
      if (!parent) return setTimeout(function () { inject(withNonce); }, 20);
      var node = withNonce ? document.querySelector('script[nonce]') : null;
      var nonce = (node && node.nonce) || '';
      var script = document.createElement('script');
      script.type = 'module';
      if (nonce) script.nonce = nonce;
      try { script.src = trusted(entry); } catch (e) { return next(); }
      script.onload = function () { log('module + HMR'); };
      script.onerror = function () {
        if (withNonce) return next();
        waitForNonce(function (ok) { if (ok) inject(true); else next(); });
      };
      parent.appendChild(script);
    };
    inject(false);
  };

  // 页面始终没有 nonce 时别死等：nonceWait 毫秒内没等到就退回单文件包
  var waitForNonce = function (run) {
    var done = false;
    var finish = function (ok) { if (done) return; done = true; run(ok); };
    if (typeof MutationObserver !== 'function') return finish(false);
    var observer = new MutationObserver(function () {
      if (!document.querySelector('script[nonce]')) return;
      observer.disconnect();
      finish(true);
    });
    observer.observe(document, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); finish(false); }, CFG.nonceWait);
  };

  // 阶梯二：页面上下文执行。@grant none 的脚本在正式版里本来就跑在页面里
  var runPage = function (code, done) {
    var url;
    try {
      url = URL.createObjectURL(new Blob([code + '\\n//# sourceURL=' + CFG.sourceURL], { type: 'text/javascript' }));
    } catch (e) { return done(false); }
    var script = document.createElement('script');
    try { script.src = trusted(url); } catch (e) { URL.revokeObjectURL(url); return done(false); }
    var finish = function (ok) {
      try { script.remove(); } catch (e) {}
      URL.revokeObjectURL(url);
      done(ok);
    };
    script.onload = function () { finish(true); };
    script.onerror = function () { finish(false); };
    (document.head || document.documentElement).appendChild(script);
  };

  // 阶梯三：沙箱内直接 eval。唯一既不受站点 CSP 影响、又能看见 GM_* 的执行方式
  var runSandbox = function (code) {
    try { eval(code + '\\n//# sourceURL=' + CFG.sourceURL); return true; }
    catch (e) { report('eval 执行调试产物失败', e); return false; }
  };

  // auto 策略：有 grant 的脚本必须进沙箱（否则 GM_* 静默降级），@grant none 的进页面
  var run = function (code) {
    var want = CFG.exec;
    if (want === 'auto') want = code.slice(0, 2048).indexOf('@grant none') >= 0 ? 'page' : 'sandbox';
    dispose();
    if (want === 'page') {
      return runPage(code, function (ok) {
        if (ok) return log('page + blob');
        if (runSandbox(code)) return log('sandbox + eval（页面不允许 blob，已退回）');
        report('页面上下文与沙箱都没能执行，检查页面 CSP 或管理器是否允许 eval');
      });
    }
    if (runSandbox(code)) return log('sandbox + eval');
    if (CFG.exec === 'sandbox') return report('eval 被管理器禁用：需允许 eval，注入方式保持沙箱');
    runPage(code, function (ok) {
      if (ok) return log('page + blob（eval 不可用，已退回）');
      report('沙箱与页面两条执行路径都失败');
    });
  };

  // 产物哈希变化才算更新；默认整页刷新，--hot 时原地重执行（要求脚本可重入）
  var watch = function () {
    setInterval(function () {
      request(CFG.origin + '/__hash', function (res) {
        var value = String(res.responseText || '').trim();
        if (!value || value === hash) return;
        hash = value;
        if (canHot()) fetchBundle(function (code) { run(code); });
        else location.reload();
      });
    }, CFG.pollMs);
  };

  // 首屏常见 503（构建还没产出）：按 pollMs 重试，别让用户手动刷新
  var fetchBundle = function (done, attempt) {
    attempt = attempt || 0;
    request(CFG.origin + '/bundle.js?t=' + Date.now(), function (res) {
      if (res.status !== 200) {
        if (attempt < CFG.retries) return setTimeout(function () { fetchBundle(done, attempt + 1); }, CFG.pollMs);
        return report('拉取调试产物失败 HTTP ' + res.status + '（看服务端终端里的构建输出）');
      }
      done(String(res.responseText || ''));
    }, function () {
      if (attempt < CFG.retries) return setTimeout(function () { fetchBundle(done, attempt + 1); }, CFG.pollMs);
      report('连不上 ' + CFG.origin + '，调试服务可能已经退出');
    });
  };

  var boot = function () {
    fetchBundle(function (code) {
      run(code);
      request(CFG.origin + '/__hash', function (res) { hash = String(res.responseText || '').trim(); watch(); });
    });
  };

  if (CFG.hmr) loadModule(CFG.hmr, boot); else boot();
})();`;
}

/* ------------------------------------------------------------------ *
 * 安装条目：复用产物头，补上调试版必需的元数据
 * ------------------------------------------------------------------ */

/** 从产物里取出 `// @key value` 列表，保持顺序 */
function parseHeader(text) {
    if (typeof text !== 'string' || !text.startsWith(HEADER_START)) return null;
    const end = text.indexOf(HEADER_END);
    if (end < 0) return null;
    const meta = [];
    for (const line of text.slice(HEADER_START.length, end).split('\n')) {
        const hit = /^\s*\/\/\s*@(\S+)\s*(.*)$/.exec(line);
        if (hit) meta.push([hit[1], hit[2]]);
    }
    return meta.length ? meta : null;
}

/**
 * 渲染安装条目的头部。
 *
 * 与产物头的差异只有五处，都是调试版不得不改的：改名避免顶掉正式版、
 * 去掉更新地址（否则管理器会把 dev 版升级成正式版）、补 GM_xmlhttpRequest
 * 与 @connect（拉产物和轮询版本靠它）、去 @grant none（否则拿不到 GM_*）、
 * 没有任何匹配规则时补通配（否则装上也永远不执行）。
 */
function renderHeader(meta, cfg) {
    const out = [];
    const seen = new Set();
    const drop = new Set(['downloadurl', 'updateurl', 'installurl']);
    const push = (key, value) => out.push(`// @${key}${value === '' ? '' : ' ' + value}`);

    for (const [key, value] of meta) {
        const lower = key.toLowerCase();
        if (drop.has(lower)) continue;
        if (lower === 'grant' && value === 'none') continue;
        if (lower === 'name') {
            if (seen.has('name')) continue;
            seen.add('name');
            push('name', value + cfg.suffix);
            continue;
        }
        push(key, value);
    }

    const grants = meta.filter(([key]) => key.toLowerCase() === 'grant').map(([, value]) => value);
    if (!grants.includes('GM_xmlhttpRequest')) push('grant', 'GM_xmlhttpRequest');
    push('connect', cfg.publicHost);
    if (!meta.some(([key]) => key.toLowerCase() === 'noframes')) push('noframes', '');
    if (cfg.everywhere || !meta.some(([key]) => ['match', 'include'].includes(key.toLowerCase()))) {
        push('match', '*://*/*');
    }
    return `${HEADER_START}\n${out.join('\n')}\n${HEADER_END}`;
}

/* ------------------------------------------------------------------ *
 * 服务端
 * ------------------------------------------------------------------ */

function hashOf(text) {
    return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

/**
 * 取当前产物文本。三种来源：内存回调（给 vite 插件用）、固定路径、
 * 目录里唯一的 *.user.js（--preset 时不用手写路径）。
 */
async function resolveBundle(cfg) {
    if (cfg.read) return { text: await cfg.read(), label: cfg.label || '(运行时生成)' };
    if (cfg.bundle) return { text: await readFile(cfg.bundle, 'utf8'), label: cfg.bundle };
    const dir = path.resolve(cfg.dir);
    let names = [];
    try {
        names = await readdir(dir);
    } catch (e) {
        throw new Error(`产物目录 ${dir} 还不存在，先跑一次构建`);
    }
    const hits = names.filter((name) => name.endsWith('.user.js'));
    if (hits.length === 1) return { text: await readFile(path.join(dir, hits[0]), 'utf8'), label: path.join(dir, hits[0]) };
    if (hits.length > 1) throw new Error(`${dir} 里有多个 .user.js，用 --bundle 指定`);
    throw new Error(`${dir} 里还没有 .user.js，先跑一次构建`);
}

/** 请求处理：安装条目、产物、版本哈希、状态页 */
function createHandler(cfg, getOrigin) {
    return async (req, res) => {
        const route = new URL(req.url, 'http://dev-kit').pathname;
        res.setHeader('cache-control', 'no-store');
        res.setHeader('access-control-allow-origin', '*');

        if (route === '/install.user.js') {
            try {
                // 产物头优先（最准确）；纯 HMR 模式没有产物时退回命令行合成的头部
                let meta = cfg.meta;
                try {
                    const { text } = await resolveBundle(cfg);
                    meta = parseHeader(text) || cfg.meta;
                } catch (e) {
                    if (!meta) throw e;
                }
                if (!meta) throw new Error('产物里没有 userscript 头，也没有提供 --name/--match');
                const loaderCfg = {
                    origin: getOrigin(),
                    exec: cfg.exec,
                    hot: cfg.hot,
                    reload: cfg.reload,
                    hook: cfg.hook,
                    pollMs: cfg.poll,
                    nonceWait: cfg.nonceWait,
                    retries: cfg.retries,
                    hmr: cfg.hmr,
                    policy: 'dev-kit-script-url',
                    sourceURL: 'dev-kit.bundle.js',
                };
                res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
                res.end(`${renderHeader(meta, cfg)}\n\n${loaderSource(loaderCfg)}`);
            } catch (e) {
                res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
                res.end(`调试产物还没到位：${e.message}\n`);
            }
            return;
        }

        if (route === '/bundle.js' || route === '/__hash' || route === '/__status') {
            try {
                const { text, label } = await resolveBundle(cfg);
                const hash = hashOf(text);
                if (route === '/__hash') {
                    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
                    res.end(hash);
                    return;
                }
                if (route === '/__status') {
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ hash, bundle: label, exec: cfg.exec, hot: cfg.hot, reload: cfg.reload, hook: cfg.hook, hmr: cfg.hmr || null }, null, 2));
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'x-dev-kit-hash': hash });
                res.end(text);
            } catch (e) {
                res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
                res.end(`调试产物还没到位：${e.message}\n`);
            }
            return;
        }

        if (route === '/') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>用户脚本调试服务</title>
<style>body{font:14px/1.7 system-ui,sans-serif;margin:40px;max-width:44em}a{color:#2563eb}code{background:#f3f4f6;padding:1px 5px;border-radius:4px}</style></head><body>
<h1>用户脚本调试服务</h1>
<p>安装 <a href="/install.user.js">install.user.js</a>（脚本名带 <code>${cfg.suffix.trim()}</code>，与正式版共存）。</p>
<p>执行策略：<code>${cfg.exec}</code>；更新方式：<code>${cfg.reload ? '整页刷新' : cfg.hot ? '原地重执行' : cfg.hook + ' 存在则重执行，否则刷新'}</code>${cfg.hmr ? `；HMR 入口 <code>${cfg.hmr}</code>` : ''}</p>
<p>产物：<code>${cfg.bundle || cfg.dir}</code>；状态见 <a href="/__status">/__status</a>。</p>
<p>装好后任意页面自动加载最新产物；第一次打开若还没产出会返回 503，加载器会自己重试。</p>
</body></html>`);
            return;
        }

        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found\n');
    };
}

/* ------------------------------------------------------------------ *
 * 启动 / CLI
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
    const values = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) values[key] = true;
        else { values[key] = next; i += 1; }
    }
    return values;
}

const HELP = `${TAG} 任意用户脚本项目的通用调试服务（零依赖）

  node .dev/dev-kit.mjs --bundle .dev/build/app.user.js [--build "vite build --watch --outDir .dev/build"]
  node .dev/dev-kit.mjs --preset vite-monkey     # 自动 build --outDir .dev/build 并找唯一的 *.user.js
  node dev-kit.mjs --hmr http://localhost:5173/src/main.js --name "我的脚本" --match "https://site/*"

选项：
  --bundle <path>     调试产物（.user.js）路径
  --dir <path>        产物目录，自动取唯一的 *.user.js（默认 .dev/build）
  --build "<cmd>"     启动时一并跑 watch 构建
  --preset vite-monkey 等价于 --build "vite build --watch --outDir .dev/build" + --dir .dev/build
  --hmr <url>         dev server 的 module 入口；页面有 nonce 时保留 HMR（可选）
  --exec <mode>       auto（默认，按 @grant 选路）| page | sandbox
  --hot               强制原地重执行（默认按 teardown 钩子自动判断）
  --reload            强制整页刷新
  --hook <name>       teardown 钩子名（默认 __USERSCRIPT_TEARDOWN__，传 false 关闭）
  --poll <ms>         轮询间隔（默认 1200）
  --name <name>       没有产物头时合成头部（配合 --match 使用）
  --match <list>      逗号分隔的 @match，仅在合成头部时生效
  --grant <list>      逗号分隔的 @grant，仅在合成头部时生效
  --name-suffix <s>   安装名后缀（默认 " (dev)"）
  --everywhere        额外补 @match *://*/*，方便在任意站点调试
  --port <n> --host <h>
  --no-open           不自动打开浏览器
`;

/** 分配端口：默认端口被占就往后找，避免反复手动改 --port */
async function listen(server, port, host) {
    for (let p = port; p < port + 10; p += 1) {
        try {
            await new Promise((resolve, reject) => {
                const onError = (e) => { server.off('listening', onOk); reject(e); };
                const onOk = () => { server.off('error', onError); resolve(); };
                server.once('error', onError);
                server.once('listening', onOk);
                server.listen(p, host);
            });
            return p;
        } catch (e) {
            if (e.code !== 'EADDRINUSE') throw e;
        }
    }
    throw new Error(`端口 ${port} 起的 10 个都被占用，用 --port 换一个`);
}

function openInBrowser(url) {
    const [command, args] = process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '', url]]
            : ['xdg-open', [url]];
    spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

export async function startDevKit(options = {}) {
    const opts = options;
    const host = String(opts.host || '127.0.0.1');
    const publicHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    const preset = opts.preset === true ? 'vite-monkey' : opts.preset;
    const dirArg = String(opts.dir || DEFAULT_DIR);
    const dir = path.resolve(dirArg);

    const buildCommand = opts.build === true
        ? (preset ? `vite build --watch --outDir ${dirArg}` : '')
        : opts.build || (preset ? `vite build --watch --outDir ${dirArg}` : '');

    // 纯 HMR 模式（没有产物）时用命令行元数据合成一个头部，省掉先构建一次
    const meta = opts.meta ? opts.meta : (opts.name ? [['name', String(opts.name)], ['namespace', 'dev-kit'], ['version', '0.0.0'], ['run-at', String(opts['run-at'] || 'document-start')]] : null);
    if (meta && opts.match) {
        for (const item of String(opts.match).split(',')) if (item.trim()) meta.push(['match', item.trim()]);
    }
    if (meta && opts.grant) {
        for (const item of String(opts.grant).split(',')) if (item.trim()) meta.push(['grant', item.trim()]);
    }

    const cfg = {
        bundle: opts.bundle ? path.resolve(String(opts.bundle)) : '',
        dir,
        read: opts.read,
        label: opts.label,
        meta,
        suffix: String(opts['name-suffix'] || ' (dev)'),
        exec: String(opts.exec || 'auto'),
        hot: Boolean(opts.hot) && !opts.reload,
        reload: Boolean(opts.reload),
        hook: String(opts.hook === false ? '' : opts.hook || '__USERSCRIPT_TEARDOWN__'),
        poll: Number(opts.poll || 1200),
        retries: Number(opts.retries || 30),
        nonceWait: Number(opts['nonce-wait'] || 2000),
        hmr: opts.hmr ? String(opts.hmr) : '',
        everywhere: Boolean(opts.everywhere),
        publicHost,
    };

    if (!['auto', 'page', 'sandbox'].includes(cfg.exec)) throw new Error(`--exec 只能是 auto/page/sandbox，收到 ${cfg.exec}`);
    const hasSource = Boolean(cfg.bundle || cfg.read || opts.dir || preset);
    if (!hasSource && !opts.hmr) {
        throw new Error('没有产物来源：给 --bundle、--dir、--preset，或至少 --hmr + --name + --match');
    }
    if (!hasSource && !cfg.meta) throw new Error('只用 --hmr 时没有产物头可复用，需要 --name 和 --match');

    // 加载器是拼出来的字符串，写坏只会在管理器里暴露成「语法错误」：先自检一遍
    const preview = {
        origin: `http://${publicHost}:${Number(opts.port || DEFAULT_PORT)}`,
        exec: cfg.exec, hot: cfg.hot, reload: cfg.reload, hook: cfg.hook, pollMs: cfg.poll, nonceWait: cfg.nonceWait,
        retries: cfg.retries, hmr: cfg.hmr, policy: 'dev-kit-script-url', sourceURL: 'dev-kit.bundle.js',
    };
    try {
        new Script(loaderSource(preview));
    } catch (e) {
        throw new Error(`生成的加载器无法解析，检查模板字符串转义：${e.message}`);
    }

    const server = createServer(createHandler(cfg, () => `http://${publicHost}:${server.address().port}`));
    const port = await listen(server, Number(opts.port || DEFAULT_PORT), host);
    const origin = `http://${publicHost}:${port}`;

    // watch 构建与服务绑在一起：构建产物一落地就能被下一次请求取到
    const build = buildCommand ? spawn(buildCommand, { shell: true, stdio: 'inherit' }) : null;
    const stop = () => {
        if (build) build.kill();
        server.close();
    };

    console.log('');
    console.log(`${TAG} 安装地址：${origin}/install.user.js`);
    console.log(`${TAG} 产物来源：${cfg.bundle || (cfg.read ? cfg.label || '(运行时生成)' : cfg.dir)}`);
    console.log(`${TAG} 执行策略：${cfg.exec}；更新方式：${cfg.reload ? '整页刷新' : cfg.hot ? '原地重执行' : `有 ${cfg.hook} 时重执行，否则刷新`}`);
    if (cfg.hmr) console.log(`${TAG} HMR 入口：${cfg.hmr}（页面有 nonce 时生效）`);
    if (buildCommand) console.log(`${TAG} watch 构建：${buildCommand}`);
    console.log(`${TAG} 装一次即可，之后改代码自动更新（构建输出目录记得加进 .gitignore）`);
    console.log('');
    if (!opts['no-open']) openInBrowser(`${origin}/install.user.js`);

    return { origin, server, cfg, stop };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help || opts.h) {
        console.log(HELP);
        return;
    }
    try {
        const kit = await startDevKit(opts);
        const shutdown = () => {
            kit.stop();
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        process.on('exit', () => kit.stop());
    } catch (e) {
        console.error(`${TAG} ${e.message}`);
        process.exit(1);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();

export { loaderSource, parseHeader, renderHeader, hashOf };
