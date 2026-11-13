/**
 * 严格 CSP 站点下的用户脚本调试服务（管理器拉取 + eval）。
 *
 * 用户脚本的 `vite dev` 靠页面加载 `http://localhost:5173` 的 module 脚本，
 * 站点 CSP 的 script-src 不含该地址时整份脚本都不会执行，只有 build 产物能跑。
 * 这里改成：watch 构建自包含产物，由脚本管理器直连本服务拉取并在自己的沙箱里 eval，
 * 页面不加载任何外部脚本，因此任何站点 CSP 都拦不住。
 *
 * 用法：
 *   node dev-loader.mjs --bundle dist/app.user.js
 *   node dev-loader.mjs --bundle .dev/app.user.js --build "pnpm vite build --watch"
 *   node dev-loader.mjs --bundle .dev/app.user.js --build "vite build --watch" --port 5180
 *
 * 参数：
 *   --bundle <path>   构建产物（.user.js）路径，必填
 *   --build <cmd>     watch 构建命令；省略则只提供已有产物
 *   --port <n>        本地服务端口，默认 5180
 *   --name <name>     安装后的脚本名，默认取产物 @name 加 " (dev)"
 *   --host <host>     监听地址，默认 127.0.0.1
 *   --no-open         启动后不自动打开浏览器
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { Script } from 'node:vm';

const TAG = '[userscript-dev]';
const HEADER_END = '// ==/UserScript==';
const opts = parseArgs(process.argv.slice(2));

if (!opts.bundle) {
  console.error(`${TAG} 需要 --bundle <path> 指向构建出的 .user.js`);
  process.exit(1);
}

const bundlePath = path.resolve(String(opts.bundle));
const port = Number(opts.port ?? process.env.DEV_LOADER_PORT ?? 5180);
const host = String(opts.host ?? '127.0.0.1');
const origin = `http://${host}:${port}`;

/** 拆出 `--key value` 与 `--flag`，多余位置参数忽略 */
function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      values[key] = true;
    } else {
      values[key] = next;
      i += 1;
    }
  }
  return values;
}

function readBundle() {
  return readFile(bundlePath, 'utf8');
}

function bundleHash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

/**
 * 复用产物自带的 userscript 头，只改名。
 *
 * 改名是为了和正式版脚本共存：脚本管理器按 name+namespace 识别脚本，
 * 同名会把正式版顶掉；配置通常存在项目自己的 key 里，两版共享同一份配置。
 */
function devHeader(text) {
  const end = text.indexOf(HEADER_END);
  if (!text.startsWith('// ==UserScript==') || end < 0) {
    throw new Error(`${bundlePath} 不是 userscript 产物（缺少 // ==UserScript== 头）`);
  }
  const header = text.slice(0, end + HEADER_END.length);
  const name = String(opts.name ?? header.match(/^\/\/ @name\s+(.+)$/m)?.[1]?.trim() ?? 'dev') +
    ' (dev)';
  return header.replace(/^\/\/ @name .*$/m, '// @name ' + name);
}

/**
 * 加载器：拉取产物后在脚本管理器沙箱内直接 eval。
 *
 * 必须用直接 eval —— 间接 eval 跑在全局作用域，看不到脚本管理器注入的 GM_*。
 * 管理器需允许 eval（默认允许）；把注入方式设成「页面上下文」会重新受站点 CSP 限制。
 */
function loaderSource() {
  return `
(() => {
  const ORIGIN = '${origin}';
  const POLL_MS = 1500;
  let version = '';
  let warned = false;

  function request(pathname, onload) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: ORIGIN + pathname,
      onload,
      onerror() {
        if (warned) return;
        warned = true;
        console.error(${JSON.stringify(`${TAG} 无法连接 `)} + ORIGIN + ${JSON.stringify('，请确认调试服务已启动')});
      },
    });
  }

  // 产物变化后整页刷新，替代 HMR
  function watch() {
    const readHash = (onload) =>
      request('/__hash', (res) => onload(String(res.responseText || '').trim()));
    readHash((value) => {
      version = value;
    });
    setInterval(() => {
      readHash((value) => {
        if (!version || value === version) return;
        location.reload();
      });
    }, POLL_MS);
  }

  request('/bundle.js?t=' + Date.now(), (res) => {
    if (res.status !== 200) {
      console.error(${JSON.stringify(`${TAG} 拉取调试产物失败：`)} + res.status);
      return;
    }
    try {
      // sourceURL 让 DevTools 把这段代码单独列出来，便于断点
      eval(res.responseText + '\\n//# sourceURL=userscript.dev.bundle.js');
    } catch (e) {
      console.error(${JSON.stringify(`${TAG} 执行调试产物失败`)}, e);
      return;
    }
    watch();
  });
})();
`;
}

/**
 * 用系统默认浏览器打开安装地址，脚本管理器接管后直接弹安装框。
 *
 * 不打开落地页：多一步点击，而且容易被编辑器/内部浏览器拦截而不是落到系统浏览器。
 * 打不开只影响这一次，地址已经打印在终端里。
 */
function openInBrowser(url) {
  if (opts['no-open']) return;
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

// 加载器由模板字符串拼出，转义写坏只会在脚本管理器里暴露成「语法错误」：启动时先解析一遍
try {
  new Script(loaderSource());
} catch (e) {
  console.error(`${TAG} 生成的加载器代码无法解析，请检查模板字符串里的转义：${e.message}`);
  process.exit(1);
}

const installHtml = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>用户脚本调试服务</title>
    <style>body{font:14px/1.6 system-ui,sans-serif;margin:40px;max-width:42em}a{color:#2563eb}code{background:#f3f4f6;padding:1px 4px;border-radius:4px}</style>
  </head>
  <body>
    <h1>用户脚本调试服务</h1>
    <p>安装 <a href="/install.user.js">install.user.js</a>，脚本名会带 <code>(dev)</code> 后缀，与正式版共存。</p>
    <p>装好后任意页面都会加载最新构建产物，产物变化时整页刷新。</p>
    <p>当前产物：<code>${bundlePath}</code></p>
  </body>
</html>`;

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, origin);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('cache-control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (pathname === '/install.user.js') {
      const text = await readBundle();
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(`${devHeader(text)}\n\n${loaderSource()}`);
      return;
    }
    if (pathname === '/bundle.js' || pathname === '/__hash') {
      const text = await readBundle();
      res.writeHead(200, {
        'content-type':
          pathname === '/__hash'
            ? 'text/plain; charset=utf-8'
            : 'application/javascript; charset=utf-8',
      });
      res.end(pathname === '/__hash' ? bundleHash(text) : text);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(installHtml);
  } catch (e) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`构建产物还没生成（${bundlePath}）：${e.message}`);
  }
});

// watch 构建与本地服务绑在一起，改代码后产物一落地就能被下次刷新取到
const build = opts.build
  ? spawn(String(opts.build), { shell: true, stdio: 'inherit' })
  : null;

server.on('error', (e) => {
  console.error(`${TAG} 端口 ${port} 不可用：${e.message}（用 --port 换一个）`);
  build?.kill();
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`\n${TAG} 调试脚本已就绪：${origin}/install.user.js`);
  console.log(`${TAG} 产物：${bundlePath}`);
  if (build) console.log(`${TAG} 已启动 watch 构建：${opts.build}`);
  console.log(`${TAG} 首次安装后无需重装，改代码会自动重建并刷新页面\n`);
  openInBrowser(`${origin}/install.user.js`);
});

function shutdown() {
  build?.kill();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
