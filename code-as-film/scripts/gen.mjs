#!/usr/bin/env node
/**
 * 调模型（OpenAI 兼容接口）生成场景 HTML。
 * 默认指向 DeepSeek，换 base URL / model 即可用别的家。
 *
 *   export DS_API_KEY=sk-...
 *   node gen.mjs --brief "12 秒水彩质感的咖啡品牌发布片" --dur 12 --out scene.html
 *
 * 环境变量：DS_API_KEY | DEEPSEEK_API_KEY, DS_BASE_URL, DS_MODEL
 * 零依赖：只用 Node 内置 fetch。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = { out: 'scene.html', brief: '', dur: '12', fps: '30', size: '1920x1080' };
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  const v = argv[i + 1];
  if (v && !v.startsWith('--')) { opt[k] = v; i++; }
  else opt[k] = 'true';
}

const KEY = process.env.DS_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error('缺少 API Key：export DS_API_KEY=sk-...（或 DEEPSEEK_API_KEY / OPENAI_API_KEY）');
  process.exit(1);
}
if (!opt.brief) {
  console.error('用法: node gen.mjs --brief "一句话创意" [--dur 12] [--fps 30] [--size 1920x1080] [--out scene.html]');
  process.exit(1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.DS_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const MODEL = process.env.DS_MODEL || 'deepseek-chat';
const [W, H] = opt.size.split('x');

const protocol = fs.readFileSync(path.join(HERE, '..', 'reference', 'PROTOCOL.md'), 'utf8');

const system = `你是动效导演兼图形程序员。你只输出一个 HTML 文件，不解释、不寒暄。
${protocol}`;

const user = `写一个单文件 HTML 动画场景，用 Canvas 2D 实现。

创意：${opt.brief}
时长：${opt.dur} 秒；帧率：${opt.fps}；画幅：${W}×${H}。

硬性要求：
1. 导出 window.DUR / window.FPS / window.render(t) / window.READY / window.EV。
2. render(t) 从零画出第 t 帧：禁止 Date.now / performance.now / 无种子 Math.random，禁止依赖上一帧状态。
3. 所有尺寸乘 u = innerHeight/1080；坐标基于 innerWidth/innerHeight，禁止硬编码 1920。
4. 单文件、零外部资源（不联网、不引 CDN / 图片 / 字体 URL），canvas 全屏。
5. 字体用 "Noto Sans CJK SC" 与 "DejaVu Sans Mono"。
6. 分 3–5 段，段间用位移 + 透明度重叠转场，全部走缓动函数。
7. 结尾留 0.8–1.2 秒淡出到黑。

只输出 <!doctype html> 到 </html> 的完整文件。`;

console.error(`调用 ${MODEL} @ ${BASE} ...`);

let res;
try {
  res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.7,
      max_tokens: 16000,
      stream: true,
    }),
  });
} catch (e) {
  console.error(`网络错误: ${e.message}`);
  process.exit(1);
}

if (!res.ok) {
  console.error(`请求失败 ${res.status}: ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}

let text = '';
let chars = 0;
let buf = '';
const dec = new TextDecoder();
const reader = res.body.getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        chars += delta.length;
        if (chars % 400 < delta.length) process.stderr.write(`\r  ${chars} 字符`);
      }
    } catch { /* 心跳或空片段 */ }
  }
}
process.stderr.write('\n');

if (!text.trim()) {
  console.error('模型返回为空');
  process.exit(1);
}

const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/);
let html = (fenced ? fenced[1] : text).trim();
if (!/^<!doctype html>/i.test(html)) html = '<!doctype html>\n' + html;

const outPath = path.resolve(opt.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);

console.log(`已写入 ${outPath}  (${html.length} 字节)`);
console.log(`下一步: node render.mjs --html ${opt.out} --stills 1,3,6 --out stills`);
