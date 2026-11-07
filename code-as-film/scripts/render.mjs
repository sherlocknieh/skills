#!/usr/bin/env node
/**
 * code-as-film 渲染器：确定性 HTML 动画 -> MP4
 *
 * 零依赖：只用 Node 内置 WebSocket 直连 Chrome DevTools Protocol，
 * 不需要 npm install / Playwright / Puppeteer。
 *
 *   node render.mjs --html scene.html --out film.mp4 [--audio a.wav]
 *   node render.mjs --html scene.html --stills 1,3.5,8 --out stills/
 *
 * 页面契约见 ../reference/PROTOCOL.md：window.DUR / render(t) / READY。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const opt = { fps: '30', size: '1920x1080', crf: '20', preset: 'medium', tune: 'animation' };
const explicit = new Set();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  explicit.add(k);
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) { opt[k] = next; i++; }
  else opt[k] = 'true';
}

if (!opt.html) {
  console.error('用法: node render.mjs --html <scene.html> --out <out.mp4|dir>');
  console.error('      [--fps 30] [--size 1920x1080] [--audio a.wav] [--stills 1,3]');
  console.error('      [--headed] [--hold 5] [--preview-every 2] [--draft] [--no-grain]');
  console.error('      [--crf 20] [--preset medium] [--tune animation]');
  process.exit(1);
}

const htmlPath = path.resolve(opt.html);
if (!fs.existsSync(htmlPath)) {
  console.error(`找不到 HTML: ${htmlPath}`);
  process.exit(1);
}

// --draft 只覆盖用户没显式指定的项，方便临时加参数微调
const DRAFT = opt.draft === 'true' || opt.draft === '1';
if (DRAFT) {
  if (!explicit.has('size')) opt.size = '1280x720';
  if (!explicit.has('crf')) opt.crf = '23';
  if (!explicit.has('preset')) opt.preset = 'veryfast';
  if (!explicit.has('preview-every')) opt['preview-every'] = '3';
}

const NO_GRAIN = DRAFT || opt['no-grain'] === 'true' || opt['no-grain'] === '1';
const PREVIEW_EVERY = Math.max(1, Number(opt['preview-every'] || 2));
const PROFILE = opt.profile === 'true' || opt.profile === '1';
const MAX_FRAMES = Number(opt.frames) > 0 ? Number(opt.frames) : Infinity;
const FORMAT = (opt.format || (DRAFT ? 'jpeg' : 'png')).toLowerCase();
const QUALITY = Math.min(100, Math.max(1, Number(opt.quality || 95)));
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const RAW = FORMAT === 'raw';

const [WIDTH, HEIGHT] = opt.size.split('x').map(Number);
const FPS = Number(opt.fps);
const HEADED = opt.headed === 'true' || opt.headed === '1';
const DEBUG = opt.debug === 'true' || process.env.CAF_DEBUG === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stderr.write(s);

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('找不到 Chrome/Chromium，请设置 CHROME_PATH=/path/to/chrome');
  return hit;
}

/* ---------- 极简 CDP 客户端 ---------- */
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.waiters = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('DevTools WebSocket 连接失败')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(`${m.error.message} (${m.error.code})`)) : p.resolve(m.result);
        return;
      }
      if (m.method) {
        const list = this.waiters.get(m.method);
        if (list && list.length) list.shift()(m.params || {});
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待 ${method} 超时`)), timeout);
      const list = this.waiters.get(method) || [];
      list.push((p) => { clearTimeout(timer); resolve(p); });
      this.waiters.set(method, list);
    });
  }

  close() { try { this.ws.close(); } catch { /* 已关闭 */ } }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}\n${err.slice(-2000)}`))));
  });
}

/* ---------- 启动 Chrome ---------- */
const chromeBin = findChrome();

async function launchBrowser({ headed, url = 'about:blank' }) {  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caf-profile-'));
  const proc = spawn(chromeBin, [
    ...(headed ? [
      '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT + 140}`,
      '--window-position=60,40',
      '--new-window',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ] : ['--headless=new']),
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : []),
    url,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const portFile = path.join(dir, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(portFile)) {
    if (Date.now() > deadline) throw new Error('Chrome 启动超时');
    await sleep(50);
  }
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  return { proc, dir, wsUrl: version.webSocketDebuggerUrl };
}

// 渲染永远在无头进程里，不占用任何标签页
const renderer = await launchBrowser({ headed: false });

let cdp = null;
let exitCode = 0;
let monitorWrap = null;
let rawServer = null;
let previewProc = null;
let previewDir = null;
let previewCdp = null;

async function cleanup() {
  if (cdp) cdp.close();
  if (previewCdp) previewCdp.close();
  if (rawServer) { try { rawServer.close(); } catch { /* 已关闭 */ } }
  try { renderer.proc.kill('SIGKILL'); } catch { /* 已退出 */ }
  if (previewProc) { try { previewProc.kill('SIGKILL'); } catch { /* 已退出 */ } }
  await sleep(60);
  try { fs.rmSync(renderer.dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  if (previewDir) { try { fs.rmSync(previewDir, { recursive: true, force: true }); } catch { /* 忽略 */ } }
  if (monitorWrap) { try { fs.rmSync(monitorWrap, { force: true }); } catch { /* 忽略 */ } }
}

try {
  cdp = new CDP(renderer.wsUrl);
  await cdp.open();

  // 复用启动时的那个标签页做渲染页，避免多出一个 about:blank
  const { targetInfos } = await cdp.send('Target.getTargets');
  const startupPage = targetInfos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  const targetId = startupPage
    ? startupPage.targetId
    : (await cdp.send('Target.createTarget', { url: 'about:blank' })).targetId;
  if (DEBUG) log(`  [dbg] 启动标签: ${targetInfos.map((t) => t.type).join(', ')}\n`);

  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  if (HEADED) {
    log('  有头模式：另开一个监视器标签页同步播放；渲染页在后台按成片尺寸出帧\n');
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false, dontSetVisibleSize: true,
  }, sessionId);

  const evaluate = async (expression, sid = sessionId) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, sid);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`页面 JS 异常: ${d.text}${d.exception ? ' ' + d.exception.description : ''}`);
    }
    return r.result.value;
  };

  const loaded = cdp.once('Page.loadEventFired');
  // 草稿标记必须在页面脚本执行前注入，场景可据此关掉噪点
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__DRAFT__ = ${DRAFT}; window.__NO_GRAIN__ = ${NO_GRAIN};`,
  }, sessionId);
  await cdp.send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId);
  await loaded;
  if (DRAFT) {
    log(`  草稿模式：${WIDTH}x${HEIGHT} / ${opt.preset} / CRF ${opt.crf} / ${NO_GRAIN ? '关噪点' : '保留噪点'} / ${FORMAT.toUpperCase()} ${QUALITY} / 预览每 ${PREVIEW_EVERY} 帧\n`);
  }

  await evaluate(`(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    return true;
  })()`);

  const readyDeadline = Date.now() + 30000;
  while (Date.now() < readyDeadline) {
    if (await evaluate('window.READY === true')) break;
    await sleep(100);
  }
  if (!(await evaluate('window.READY === true'))) {
    log('  ! window.READY 30 秒内没有变成 true，继续渲染（可能字体未就绪会闪字）\n');
  }

  const DUR = await evaluate('Number(window.DUR)');
  if (!Number.isFinite(DUR) || DUR <= 0) throw new Error('页面没有导出合法的 window.DUR');

  // 有头预览：独立的有头进程，只开一个「预览」页；渲染在无头进程里，不占标签
  let monitor = null;
  let mwin = '';
  let peval = null;
  if (HEADED && opt.monitor !== 'false') {
    monitorWrap = path.join(os.tmpdir(), `caf-monitor-${process.pid}.html`);
    fs.writeFileSync(monitorWrap, `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: #06070a; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; }
  iframe { border: 0; display: block; background: #06070a; }
</style>
<iframe id="f" src="${pathToFileURL(htmlPath).href}"></iframe>
<script>
  const f = document.getElementById('f'), AR = ${WIDTH} / ${HEIGHT};
  function fit() {
    const s = Math.min(innerWidth / AR, innerHeight);
    f.style.width = Math.max(1, Math.round(s * AR)) + 'px';
    f.style.height = Math.max(1, Math.round(s)) + 'px';
  }
  addEventListener('resize', fit); fit();
</script>`);

    const previewer = await launchBrowser({ headed: true });
    previewProc = previewer.proc;
    previewDir = previewer.dir;
    previewCdp = new CDP(previewer.wsUrl);
    await previewCdp.open();

    const { targetInfos: previewTargets } = await previewCdp.send('Target.getTargets');
    const pageTarget = previewTargets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
    monitor = (await previewCdp.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true })).sessionId;
    await previewCdp.send('Page.enable', {}, monitor);
    await previewCdp.send('Runtime.enable', {}, monitor);
    await previewCdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__DRAFT__ = ${DRAFT}; window.__NO_GRAIN__ = ${NO_GRAIN};`,
    }, monitor);
    await previewCdp.send('Page.navigate', { url: pathToFileURL(monitorWrap).href }, monitor);
    await previewCdp.send('Page.bringToFront', {}, monitor);

    peval = async (expression) => {
      const r = await previewCdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, monitor);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };

    mwin = `document.getElementById('f').contentWindow`;
    const mDeadline = Date.now() + 30000;
    while (Date.now() < mDeadline) {
      try { if (await peval(`${mwin} && ${mwin}.READY === true`)) break; } catch { /* 外壳还没就绪 */ }
      await sleep(100);
    }
    await peval(`document.title = '预览'`).catch(() => {});
    log(`  预览窗口已打开：16:9 画框，窗口怎么拖都不变形（出片 ${WIDTH}x${HEIGHT}）\n`);
  }

  const draw = async (t) => {
    const ok = await evaluate(`(window.render ? (window.render(${JSON.stringify(t)}), true) : false)`);
    if (!ok) throw new Error('页面没有导出 window.render(t)');
  };

  if (DEBUG) {
    await evaluate(`window.__rs = 0; addEventListener('resize', () => { window.__rs++; }); 0`);
    log('  [dbg] inner / outer / dpr / resize 次数\n');
  }

  // raw 模式：画布原始 RGBA 直接 POST 到本机端口，跳过一切图片编码
  let rawPort = 0;
  let rawPending = null;
  let rawW = 0;
  let rawH = 0;
  if (RAW) {
    rawServer = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
        res.end('ok');
        const buf = Buffer.concat(chunks);
        if (rawPending) { const f = rawPending; rawPending = null; f(buf); }
      });
    });
    await new Promise((r) => rawServer.listen(0, '127.0.0.1', r));
    rawPort = rawServer.address().port;
    [rawW, rawH] = await evaluate(`(() => {
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return [c.width, c.height];
    })()`);
    log(`  原始像素模式：${rawW}x${rawH} RGBA，每帧 ${((rawW * rawH * 4) / 1048576).toFixed(1)} MB，不经过图片编码\n`);
  }

  const grabPage = async () => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: FORMAT,
      ...(FORMAT === 'png' ? { optimizeForSpeed: true } : { quality: QUALITY }),
      captureBeyondViewport: false,
      ...(process.env.CAF_NO_SURFACE ? { fromSurface: false } : {}),
    }, sessionId);
    return Buffer.from(data, 'base64');
  };

  // 优先直接从画布取像素：不经过窗口合成，窗口怎么缩放都不影响成片
  let capMode = 'page';
  if (opt.capture !== 'page') {
    capMode = await evaluate(`(() => {
      const cs = [...document.querySelectorAll('canvas')];
      if (!cs.length) return 'page';
      const c = cs.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!c.getContext('2d')) return 'page';          // WebGL 画布读回可能是空白
      if (c.width < innerWidth - 2 || c.height < innerHeight - 2) return 'page';
      // 画布之外还有看得见的元素（DOM 文字、滤镜层）就退回整页截图
      const overlay = [...document.body.querySelectorAll('*')].some((el) => {
        if (el === c || el.contains(c)) return false;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < innerWidth * innerHeight * 0.02) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01;
      });
      return overlay ? 'page' : 'canvas';
    })()`);
    if (opt.capture === 'canvas') capMode = 'canvas';
  }
  if (HEADED) log(`  截图源: ${capMode === 'canvas' ? 'canvas 像素（与窗口缩放无关）' : 'Page.captureScreenshot'}\n`);

  const grab = async () => {
    if (RAW) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { rawPending = null; reject(new Error('原始像素传输超时')); }, 15000);
        rawPending = (b) => { clearTimeout(timer); resolve(b); };
        evaluate(`(async () => {
          const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          await fetch('http://127.0.0.1:${rawPort}/f', { method: 'POST', body: d.buffer });
          return d.byteLength;
        })()`).catch((e) => { clearTimeout(timer); rawPending = null; reject(e); });
      });
    }
    if (capMode !== 'canvas') return grabPage();
    const mime = MIME[FORMAT] || 'image/png';
    const args = FORMAT === 'png' ? '' : `, ${QUALITY / 100}`;
    const url = await evaluate(`(() => {
      const cs = [...document.querySelectorAll('canvas')];
      const c = cs.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return c.toDataURL(${JSON.stringify(mime)}${args});
    })()`);
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  };

  /* ---- 抽帧模式 ---- */
  if (opt.stills) {
    const outDir = path.resolve(opt.out && opt.out !== 'true' ? opt.out : 'stills');
    fs.mkdirSync(outDir, { recursive: true });
    for (const t of String(opt.stills).split(',').map(Number)) {
      await draw(t);
      const file = path.join(outDir, `t${t.toFixed(2).replace('.', '_')}.png`);
      fs.writeFileSync(file, await grab());
      log(`  still ${t}s -> ${file}\n`);
    }
    console.log(`抽帧完成: ${outDir}`);
  } else {
    /* ---- 全片渲染 ---- */
    const outFile = path.resolve(opt.out && opt.out !== 'true' ? opt.out : 'out/film.mp4');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const frames = Math.max(1, Math.min(Math.round(DUR * FPS), MAX_FRAMES));
    const withAudio = Boolean(opt.audio && opt.audio !== 'true');
    // 有音轨时先写临时视频；faststart 只用在最终文件，避免中间文件二次改写
    const videoTarget = withAudio ? `${outFile}.video.mp4` : outFile;

    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      ...(RAW
        ? ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${rawW}x${rawH}`, '-framerate', String(FPS), '-i', '-']
        : ['-f', 'image2pipe', '-framerate', String(FPS), '-i', '-']),
      '-c:v', 'libx264', '-preset', opt.preset, '-crf', String(opt.crf), '-tune', opt.tune,
      '-pix_fmt', 'yuv420p',
      ...(withAudio ? [] : ['-movflags', '+faststart']),
      videoTarget,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr += d; });
    const ffDone = new Promise((resolve, reject) => {
      ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg 失败 (${c})\n${ffErr.slice(-2000)}`))));
      ff.on('error', reject);
    });

    const writeFrame = (buf) => new Promise((resolve, reject) => {
      if (ff.stdin.destroyed) return reject(new Error('ffmpeg 管道已关闭'));
      if (ff.stdin.write(buf)) resolve();
      else ff.stdin.once('drain', resolve);
    });

    log(`  渲染 ${DUR}s @ ${FPS}fps = ${frames} 帧, ${WIDTH}x${HEIGHT}\n`);
    const t0 = Date.now();
    const prof = { draw: 0, preview: 0, grab: 0, write: 0 };
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      const ta = performance.now();
      await draw(t);
      const tb = performance.now();
      if (monitor && i % PREVIEW_EVERY === 0) {
        await peval(`(() => { const w = ${mwin}; if (w && w.render) w.render(${JSON.stringify(t)}); })()`).catch(() => {});
      }
      const tc = performance.now();
      const png = await grab();
      const td = performance.now();
      await writeFrame(png);
      const te = performance.now();
      prof.draw += tb - ta;
      prof.preview += tc - tb;
      prof.grab += td - tc;
      prof.write += te - td;
      if (i % 15 === 0 || i === frames - 1) {
        const pct = (((i + 1) / frames) * 100).toFixed(0);
        const el = ((Date.now() - t0) / 1000).toFixed(1);
        log(`\r  帧 ${String(i + 1).padStart(4)}/${frames}  ${String(pct).padStart(3)}%  ${el}s   `);
        if (monitor) {
          await peval(`document.title = ${JSON.stringify(`预览 ${pct}% · ${i + 1}/${frames}`)}`).catch(() => {});
        }
        if (DEBUG) {
          const m = await evaluate('[innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio, window.__rs].join("x")');
          log(`\n  [dbg] f${i}  inner/outer/dpr/resize = ${m}\n`);
        }
      }
    }
    ff.stdin.end();
    await ffDone;
    log('\n');

    if (PROFILE) {
      const tot = prof.draw + prof.preview + prof.grab + prof.write;
      const fmt = (v) => `${((v / tot) * 100).toFixed(1)}% · ${(v / frames).toFixed(0)}ms/帧`;
      log(`  耗时分布：draw ${fmt(prof.draw)} | preview ${fmt(prof.preview)} | 取帧/编码 ${fmt(prof.grab)} | write ${fmt(prof.write)}\n`);
    }

    if (withAudio) {
      const audioPath = path.resolve(opt.audio);
      if (!fs.existsSync(audioPath)) throw new Error(`找不到音频: ${audioPath}`);
      await run('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-i', videoTarget, '-i', audioPath,
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        outFile,
      ]);
      fs.rmSync(videoTarget, { force: true });
      console.log(`  已混入音轨: ${path.basename(audioPath)}`);
    }

    const mb = (fs.statSync(outFile).size / 1048576).toFixed(1);
    console.log(`\n完成: ${outFile}  (${mb} MB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    if (HEADED && Number(opt.hold) > 0) {
      log(`  预览窗口保留 ${opt.hold}s，可以先看一眼成片\n`);
      if (monitor) await peval(`document.title = '预览 · 完成'`).catch(() => {});
      await sleep(Number(opt.hold) * 1000);
    }
  }
} catch (e) {
  console.error(`失败: ${e.message}`);
  exitCode = 1;
} finally {
  await cleanup();
}
process.exit(exitCode);
