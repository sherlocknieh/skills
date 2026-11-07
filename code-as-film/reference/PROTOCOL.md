# 场景契约（Scene Contract）

模型只做一件事：**输出一个单文件 HTML，它能在任意时间点 `t` 画出那一帧**。
渲染器负责把帧变成 MP4。任何一行代码都不能试图"播放"动画。

## 1. 必须导出的全局变量

```js
window.DUR   = 14;                     // 成片时长（秒），必填
window.FPS   = 30;                     // 建议帧率，可选，默认 30
window.render = (t) => { /* 画第 t 秒 */ };  // 必填，必须同步或返回 Promise
window.READY  = true;                  // 字体/图片就绪后置 true
window.EV     = [{ t: 3.2, type: "hit" }]; // 可选：给混音用的音效事件
```

## 2. 三条铁律

| 规则 | 原因 |
| --- | --- |
| **确定性**：禁用 `Date.now()`、`performance.now()`、无种子的 `Math.random()`、上一帧残留状态 | 任意一帧可单独重渲、可多进程并行、可复现 |
| **自适应性**：所有坐标按 `innerWidth / innerHeight` 计算，禁止硬编码 1920 | 同一份代码要能出 720p / 1080p / 4K；竖屏需要在代码里加 `PORTRAIT` 分支另做布局 |
| **无外部依赖**：不联网、不加载 CDN、不用外部图片/字体 URL | 渲染时离线、字体就绪可判定 |

## 3. 每帧必须从零绘制

```js
function render(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  drawBackground(t);
  drawActA(t);
  drawActB(t);
  // …每一层只依赖 t，不依赖上一帧
}
```

不要用 `requestAnimationFrame` 驱动主时间轴；它只允许用于"预览模式"，且不能影响 `render(t)` 的结果。

## 4. 版式基准

- 设计基准：`u = innerHeight / 1080`，所有字号、间距、线宽乘以 `u`。
- canvas 尺寸跟随 `innerWidth × innerHeight`，`devicePixelRatio` 固定为 1。
- 安全边距：左右 `0.08 × innerWidth`，上下 `0.08 × innerHeight`。

## 5. 时间结构建议

```js
// 用 seg 做段落淡入淡出，避免手写 if
const seg = (t, a, b, fin = 0.4, fout = 0.4) =>
  Math.min(clamp((t - a) / fin), clamp((b - t) / fout), 1);
```

把整片拆成 3–5 个段落，每段有独立的局部时间 `lt = t - start`，转场靠 alpha / 位移重叠，不靠硬切。

## 6. 声音（可选）

画面程序不出声。配乐由 `scripts/audio.mjs` 按同一 BPM 生成，或用任意 TTS 生成旁白，
最后交给 ffmpeg 混流。若要卡点，把节拍写进 `window.EV`，混音脚本按 `EV` 对齐。

## 6. 草稿标记（建议支持）

渲染器会在页面脚本执行前注入两个全局量：

```js
window.__DRAFT__     // true = 草稿渲染（低分辨率 / 快编码）
window.__NO_GRAIN__  // true = 本次不要画噪点
```

噪点是单帧成本的大头，场景可以这样折中：

```js
function drawGrain(t) {
  if (!noisePat || window.__NO_GRAIN__) return;
  // …
}
```

## 7. 交付前自检

1. `node scripts/render.mjs --html <scene> --stills 1,3,6,9 --out out/stills` 抽帧看构图
2. 同一 `t` 渲染两次，逐字节一致（确定性）
3. 把窗口改成 1280×720 再抽一帧，检查比例没有错位（同比例自适应）；竖屏另行实现 `PORTRAIT` 分支
4. 全片渲染，`ffprobe` 核对时长 / 帧率 / 分辨率
