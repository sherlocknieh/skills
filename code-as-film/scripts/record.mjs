#!/usr/bin/env node
/**
 * 录制真实网页操作：CDP 录屏（Page.startScreencast）+ 动作脚本（点击/移动/输入/滚动）
 *
 *   node record.mjs --url http://localhost:3000 --script actions.json --out demo.mp4
 *   node record.mjs --url https://example.com --out demo.mp4 --size 1440x900 --cursor
 *
 * 与 render.mjs 的区别：这里录的是"真实时间"里发生的事，不能保证逐帧可复现；
 * 要可复现的动效片，仍然用 render.mjs 的 render(t)。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = { size: '1440x900', fps: '30', quality: '90', tail: '1.2', crf: '20', preset: 'medium' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const v = argv[i + 1];
  if (v && !v.startsWith('--')) { opt[k] = v; i++; } else opt[k] = 'true';
}

if (!opt.url || !opt.out) {
  console.error('用法: node record.mjs --url <页面地址> --out <out.mp4> [--script actions.json]');
  console.error('      [--size 1440x900] [--fps 30] [--quality 90] [--tail 1.2] [--cursor] [--headful]');
  process.exit(1);
}

const [WIDTH, HEIGHT] = opt.size.split('x').map(Number);
const FPS = Number(opt.fps);
const HEADFUL = opt.headful === 'true' || opt.watch === 'true';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stderr.write(s);

function findChrome() {
  const cands = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('找不到 Chrome/Chromium，请设置 CHROME_PATH');
  return hit;
}

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('DevTools 连接失败')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        return;
      }
      if (m.method) for (const fn of (this.handlers.get(m.method) || [])) fn(m.params || {});
    });
  }
  on(method, fn) {
    const list = this.handlers.get(method) || [];
    list.push(fn);
    this.handlers.set(method, list);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { try { this.ws.close(); } catch { /* 忽略 */ } }
}

const chromeBin = findChrome();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'caf-rec-'));
const chrome = spawn(chromeBin, [
  ...(!HEADFUL ? ['--headless=new'] : [
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${HEIGHT + 140}`,
    '--window-position=60,40',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ]),
  '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--mute-audio', '--force-color-profile=srgb', '--font-render-hinting=none',
  ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : []),
  'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

let cdp = null;
let exitCode = 0;

async function cleanup() {
  if (cdp) cdp.close();
  try { chrome.kill('SIGKILL'); } catch { /* 已退出 */ }
  await sleep(60);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(portFile)) {
    if (Date.now() > deadline) throw new Error('Chrome 启动超时');
    await sleep(50);
  }
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  cdp = new CDP(v.webSocketDebuggerUrl);
  await cdp.open();

  const { targetInfos } = await cdp.send('Target.getTargets');
  const pageT = targetInfos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: pageT.targetId, flatten: true });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  // 无头时视口精确等于目标尺寸；有头时录的是窗口内容区，尺寸以首帧为准
  if (!HEADFUL) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
  }

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`页面异常: ${r.exceptionDetails.text}`);
    return r.result.value;
  };

  const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
  await cdp.send('Page.navigate', { url: opt.url }, sessionId);
  await Promise.race([loaded, sleep(20000)]);
  await sleep(400);

  /* ---- 光标（录屏不带系统光标，可选注入一个） ---- */
  if (opt.cursor) {
    await evaluate(`(() => {
      const d = document.createElement('div');
      d.id = '__caf_cursor';
      d.style.cssText = 'position:fixed;left:-100px;top:-100px;z-index:2147483647;pointer-events:none;width:22px;height:22px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
      d.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 9.5-6.4 1.2 3.2 7.4-3.2 1.4-3.2-7.4L4 19z" fill="#fff" stroke="#111" stroke-width="1.4"/></svg>';
      document.documentElement.appendChild(d);
      window.__cafCur = (x, y) => { d.style.left = (x - 3) + 'px'; d.style.top = (y - 2) + 'px'; };
      return true;
    })()`);
  }

  /* ---- 录屏 ---- */
  const jpegSize = (buf) => {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xC3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      if (m === 0xD8 || m === 0xD9 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  };

  // 等窗口停止变化，避免录到窗口调整过程中的过渡帧
  let lastOuter = '';
  for (let i = 0; i < 30; i++) {
    const cur = await evaluate('[outerWidth, outerHeight].join("x")');
    if (cur === lastOuter) break;
    lastOuter = cur;
    await sleep(120);
  }

  const frames = [];
  let t0 = 0;
  let dropped = 0;
  let outW = 0;
  let outH = 0;
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }, sessionId).catch(() => {});
    const buf = Buffer.from(f.data, 'base64');
    const s = jpegSize(buf);
    if (s) {
      if (!outW) {
        outW = s.w; outH = s.h;
        log(`  录制画面 ${outW}x${outH}${outW !== WIDTH || outH !== HEIGHT ? `（目标 ${WIDTH}x${HEIGHT}，有头模式以窗口内容区为准）` : ''}\n`);
      } else if (s.w !== outW || s.h !== outH) { dropped++; return; }
    }
    if (!t0) t0 = f.metadata.timestamp;
    frames.push({ ts: f.metadata.timestamp - t0, buf });
  });

  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: Number(opt.quality), everyNthFrame: 1,
    maxWidth: WIDTH, maxHeight: HEIGHT,
  }, sessionId);

  /* ---- 动作 ---- */
  const at = (sel) => evaluate(`(() => {
    const el = ${sel.startsWith('/') ? `document.evaluate(${JSON.stringify(sel)}, document, null, 9, null).singleNodeValue` : `document.querySelector(${JSON.stringify(sel)})`};
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);

  async function moveTo(x, y, ms = 280) {
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const px = x, py = y;
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: Math.round(px), y: Math.round(py), buttons: 0,
      }, sessionId);
      if (opt.cursor) await evaluate(`window.__cafCur(${Math.round(px)}, ${Math.round(py)})`).catch(() => {});
      await sleep(ms / steps);
    }
  }

  async function click(x, y) {
    await moveTo(x, y);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
  }

  async function typeText(text, perChar = 45) {
    for (const ch of text) {
      await cdp.send('Input.insertText', { text: ch }, sessionId);
      await sleep(perChar);
    }
  }

  async function key(name) {
    const codes = { Enter: { key: 'Enter', code: 'Enter', keyCode: 13 }, Tab: { key: 'Tab', code: 'Tab', keyCode: 9 } };
    const k = codes[name] || codes.Enter;
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, windowsVirtualKeyCode: k.keyCode }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k, windowsVirtualKeyCode: k.keyCode }, sessionId);
    await sleep(80);
  }

  const script = opt.script ? JSON.parse(fs.readFileSync(opt.script, 'utf8')) : [];
  const started = Date.now();
  for (const a of script) {
    const wait = a.at - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    if (a.type === 'click') {
      const p = a.selector ? await at(a.selector) : { x: a.x, y: a.y };
      if (p) await click(p.x, p.y);
    } else if (a.type === 'move') {
      await moveTo(a.x, a.y, a.ms || 300);
    } else if (a.type === 'type') {
      await typeText(a.text, a.perChar || 45);
    } else if (a.type === 'key') {
      await key(a.key || 'Enter');
    } else if (a.type === 'scroll') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: a.x || WIDTH / 2, y: a.y || HEIGHT / 2, deltaX: 0, deltaY: a.dy || 400,
      }, sessionId);
      await sleep(a.ms || 500);
    } else if (a.type === 'wait') {
      await sleep(a.ms || 500);
    } else if (a.type === 'eval') {
      await evaluate(a.js);
    }
  }

  await sleep(Number(opt.tail) * 1000);
  await cdp.send('Page.stopScreencast', {}, sessionId);

  if (frames.length < 2) throw new Error('没录到帧：页面可能完全静止，或尺寸一直不稳定');

  /* ---- 编码：按帧时间戳做 VFR -> CFR ---- */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caf-frames-'));
  const list = [];
  let prev = 0;
  const endHold = Math.max(0.5, Number(opt.tail));
  const totalDur = frames[frames.length - 1].ts + endHold;

  for (let i = 0; i < frames.length; i++) {
    const name = path.join(dir, `f${String(i).padStart(5, '0')}.jpg`);
    fs.writeFileSync(name, frames[i].buf);
    const isLast = i === frames.length - 1;
    const dur = isLast ? endHold : Math.min(2, Math.max(1 / 120, frames[i + 1].ts - frames[i].ts));
    list.push(`file '${name}'`, `duration ${dur.toFixed(4)}`);
    prev = frames[i].ts;
  }
  const listFile = path.join(dir, 'list.txt');
  // concat 不认最后一项的 duration，补一个重复末帧，才能把尾部停留撑出来
  list.push(`file '${path.join(dir, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`, 'duration 0.04');
  fs.writeFileSync(listFile, list.join('\n') + '\n');

  log(`  录到 ${frames.length} 帧${dropped ? `（丢弃 ${dropped} 张尺寸不符的过渡帧）` : ''}，时长约 ${(frames[frames.length - 1].ts).toFixed(1)}s，编码中…\n`);

  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-t', totalDur.toFixed(3),
      '-vf', `fps=${FPS},scale=${outW || WIDTH}:${outH || HEIGHT}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', opt.preset, '-crf', opt.crf,
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      path.resolve(opt.out),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg 失败 (${c})\n${err.slice(-1500)}`))));
  });

  fs.rmSync(dir, { recursive: true, force: true });
  const mb = (fs.statSync(path.resolve(opt.out)).size / 1048576).toFixed(1);
  console.log(`完成: ${opt.out}  (${mb} MB)`);
} catch (e) {
  console.error(`失败: ${e.message}`);
  exitCode = 1;
} finally {
  await cleanup();
}
process.exit(exitCode);
