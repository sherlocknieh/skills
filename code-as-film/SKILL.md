---
name: code-as-film
description: "用代码渲染视频（code-as-film）：让编码模型写一个确定性 HTML 动画，node + 系统 Chrome + ffmpeg 逐帧截图编码成 MP4，零 npm 依赖、不调用任何视频生成模型。适用于要做 10–30 秒动效短片 / 产品宣传片 / 数据讲解片，把 HTML、Canvas 或 SVG 动画导出成 MP4，复刻「Opus 5.5 做的视频」那类代码即画面的片子，或只想快速出片、批量做变体而不装 Python/Playwright 时。也支持用 CDP 录屏 + 动作脚本录制真实网页/App 的操作演示（点击、输入、滚动，非确定性录制）。"
---

# code-as-film

模型写代码，代码画画面，浏览器逐帧截图，ffmpeg 合成。**没有一帧是"生成"的像素**，所以文字永远清晰、任意一帧都能改、结果可复现。

适合以文字、图表、界面动效为主的片子；写实人物和实景镜头不属于这里。

## 与 onetake 的分工

需要运镜、无缝衔接（carry）、39 个动效的库、验收 oracle、多语言配音 → 用 `onetake`。
要快、要轻、要批量，机器上只有 node / Chrome / ffmpeg → 用本技能：一次出片约 5 分钟。

**所有命令在用户的项目目录里执行**，脚本用本技能目录下的 `scripts/...`。

## 流程

### 1 · 定契约

把 `reference/PROTOCOL.md` 原样作为系统提示词，或至少把三条铁律写进生成指令。

完成标准：场景声明了 `window.DUR` / `render(t)` / `READY`，且 `render` 内没有 `Date.now`、`performance.now`、裸 `Math.random`。

### 2 · 生成场景

```bash
node scripts/gen.mjs --brief "12 秒水波质感的记账 App 宣传片" --dur 12 --out scene.html
```

没有 API key 就把 `reference/SCENE_PROMPT.md` 填好粘给模型，存成 `scene.html`。

完成标准：`--stills` 能跑通并取到合法 `DUR`（报错即契约没兑现，先修 HTML 再谈美术）。

### 3 · 抽帧校对

```bash
node scripts/render.mjs --html scene.html --stills 1,3.5,7,10.5 --out stills
```

完成标准：每个分镜时刻构图成立——文字不溢出、不重叠、不是回退字体，主体在安全边距内。**改到这一步通过再渲全片。**

### 4 · 按秒改

给模型秒级指令，不给形容词：

```
第 2.4–3.1 秒标题位移从 60px 改成 24px，缓动换 easeOutExpo。
第 4.2 秒第三张卡片必须完全就位，入场延迟改为每档 0.15 秒。
```

完成标准：同一 `t` 渲染两次 PNG 的 SHA-256 一致；抽帧与分镜逐条对上。

### 5 · 配乐与出片

```bash
node scripts/audio.mjs --dur 12 --bpm 120 --out audio.wav     # 或换成 TTS 旁白 / 授权音乐
node scripts/render.mjs --html scene.html --out film.mp4 --audio audio.wav

# 想一边渲一边看：开有头窗口，标题栏实时显示帧进度，结束后停留 5 秒
node scripts/render.mjs --html scene.html --out film.mp4 --audio audio.wav --headed --hold 5
```

`--headed` 会另起一个**独立的有头窗口**，里面只有一个标签，标题显示 `预览 47% · 198/420`：它把场景装进 16:9 的 iframe，随窗口自由缩放但画面永不变形。真正的渲染跑在**无头进程**里，不占标签；进度同时打在终端和这个标题上。预览不参与出片，成片分辨率永远是 `--size`。代价是多渲染一遍场景。

完成标准：`ffprobe` 的时长 / 帧率 / 分辨率与分镜一致；体积 ≤ 15 MB；`volumedetect` 的 mean 在 −20 ~ −14 dB、max ≤ −0.5 dB。

## 草稿与提速

```bash
node scripts/render.mjs --html scene.html --out draft.mp4 --draft   # 720p / veryfast / CRF 23 / 关噪点 / JPEG 取帧 / 预览隔 3 帧
node scripts/render.mjs --html scene.html --out film.mp4 --preview-every 3   # 只有往大屏投影时才需要每帧更新预览
node scripts/render.mjs --html scene.html --out film.mp4 --no-grain          # 场景读取 __NO_GRAIN__ 时生效
node scripts/render.mjs --html scene.html --out fast.mp4 --format jpeg --quality 95   # 1080p 但取帧快 4 倍
node scripts/render.mjs --html scene.html --out fast.mp4 --format raw                 # 无损 + 最快（本机回环传原始像素）
```

**先量再调**：`--profile` 会打印每帧的时间分布。实测 1080p + 噪点的演示片：

```
draw 6ms | preview 0ms | 取帧/编码 646ms | write 8ms     ← 编码占 98%
```

取帧方式实测（同一帧，毫秒/帧）：**raw RGBA 116（无损）** · canvas JPEG 95 149 · 整页 JPEG 95 223 · canvas WebP 420 · 整页 WebP 472 · 整页 PNG 547 · canvas PNG 646。浏览器的截屏 API（`Page.captureScreenshot`，也就是扩展 `tabs.captureVisibleTab` 的底层）一样要编码，PNG 只快 15%；真正的杠杆是**别在中间编码**，不是换 API。

`--format raw` 的做法：页面 `getImageData` 取出 RGBA，`fetch` 直接 POST 到渲染器起的本机端口，ffmpeg 用 `-f rawvideo` 接收，全程不产生图片。代价是每帧 7.9 MB（1080p）的本机回环流量，跨机器渲染时改用 JPEG。

**瓶颈是取帧编码，不是绘制，也不是 ffmpeg**，所以不要再去优化 `render(t)` 本身。

单帧成本由画面复杂度和噪点决定，与总帧数无关：同一台机器上，扁平画面约 0.09 秒/帧，满屏噪点的复杂画面可到 0.6 秒/帧（PNG 从 0.28 MB 涨到 3.35 MB，编码和传输都是数量级差异）。定稿再开噪点。

## 录制真实页面（另一种模式）

上面那套是「代码画画面」；如果要展示**真实网站/App 的操作**，用 `scripts/record.mjs`——它驱动真实页面并录屏，属于**非确定性录制**（不能逐帧复现），不要和 `render(t)` 混用。

```bash
node scripts/record.mjs --url http://localhost:3000 --script actions.json \
     --out demo.mp4 --size 1440x900 --cursor --tail 1.5
```

`actions.json` 是绝对时间轴（毫秒，从开始录制算起）：

```json
[
  { "at": 900,  "type": "click", "selector": "#new" },
  { "at": 1200, "type": "type",  "text": "把标题动效调慢一点", "perChar": 60 },
  { "at": 2900, "type": "key",   "key": "Enter" },
  { "at": 4900, "type": "click", "selector": "li:nth-child(2) .box" },
  { "at": 6100, "type": "scroll","dy": 240 },
  { "at": 7000, "type": "eval",  "js": "document.querySelector('#add').click()" }
]
```

支持 `click` / `move` / `type` / `key` / `scroll` / `wait` / `eval`；`selector` 可以是 CSS，也可以是以 `/` 开头的 XPath。

- **默认无头录制**：视口精确等于 `--size`，不受窗口尺寸干扰。想边录边看加 `--headful`，输出尺寸会变成窗口内容区（脚本会打印实际大小）。
- **光标**：录屏不含系统光标，`--cursor` 会注入一个跟着鼠标走的光标，演示时更像“有人在操作”。
- **静止没有帧**：录屏只在画面变化时出帧，尾部靠末帧停留；所以动作之间不要留太长空白，末尾用 `--tail` 兜住。
- 录屏是 JPEG 90（体积小、够用），不是无损；要像素级精确的画面，仍然用 `render(t)`。

**混合工作流**：真实操作当素材录一次，再用确定性合成加标题、高亮、转场——这是发布片常见的做法。需要“重建 UI + 旁白 + 多语言”的重型能力，用 `onetake`（它的 `record_footage.py` 和 replica 专门做这个）。

## 硬规则

- **确定性**：`render(t)` 从零画；随机用带种子的 `mulberry32`。这是抽帧、复现、并行渲染的前提。
- **字体就绪再开拍**：`document.fonts.ready` 之后才置 `READY = true`，否则前几帧是回退字体。
- **抽帧便宜，全片贵**：1080p30 约 0.14 s/帧；先看 4–6 帧再渲。
- **噪点是码率杀手**：全屏逐帧噪点 alpha ≤ 0.03、每 2 帧换一次种子，配 `-tune animation -crf 20`，14 秒约 1.3 Mbps / 2 MB。不做这些，同一支片子会到 26 Mbps / 44 MB。
- **竖屏另写分支**：16:9 布局直接 `--size 1080x1920` 会重叠；加 `PORTRAIT = W < H` 重排卡片与管线。
- **声音事后做**：画面程序不出声；`window.EV` 只是给混音的事件表。
- **一段一个动作**：3–5 段、段间留 0.3 秒以上的静止，比每帧都在动更像成片。

## 常见故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 全黑 / 全白 | `render` 抛错 | 看 `--stills` 的 stderr 里"页面 JS 异常" |
| 字体变宋体 / 方框 | 字体没就绪或系统缺失 | 等 `fonts.ready`；装 Noto Sans CJK |
| 时长不对 | `DUR` 与实际帧数不符 | `DUR` 只认 `window.DUR` 一个来源 |
| 中途断掉 | ffmpeg 管道关闭 | 看 stderr 末尾的 ffmpeg 报错 |
| 画面糊 | 截图被缩放或用了 JPEG | 保持 1:1 分辨率出 PNG |
| 有头与无头文字边缘不同 | GPU 合成 vs 软件光栅 | 正常；各自确定，交付用无头 |
| 预览四周有黑边、画面不占满 | 窗口比例与成片不同 | 正常：16:9 画框居中，拉大窗口即可 |
| 打开是静止 | 没跑 `#preview` | 浏览器加 `#preview` 或直接抽帧 |

## 文件

| path | what |
| --- | --- |
| `scripts/render.mjs` | 零依赖 CDP 渲染器：抽帧 / 全片 / 混音 / 四种取帧方式 |
| `scripts/record.mjs` | 录制真实网页操作：CDP 录屏 + 动作脚本 |
| `scripts/audio.mjs` | 程序化配乐（鼓、贝斯、铺底、琶音） |
| `scripts/gen.mjs` | OpenAI 兼容接口生成场景，默认 DeepSeek |
| `reference/PROTOCOL.md` | 场景契约，给模型看 |
| `reference/SCENE_PROMPT.md` | 可粘贴提示词 + 迭代话术 |
| `examples/minimal.html` | 最小合规场景：抄结构，别抄美术 |
| `examples/full.html` | 14 秒工程参考：分镜、HUD、图标、码率控制 |
| `examples/app-demo.html` / `examples/actions.json` | 可录制的演示页面与动作脚本 |

Requires: node ≥ 20（内置 WebSocket）、Chrome / Chromium、ffmpeg、Noto Sans CJK 字体。
