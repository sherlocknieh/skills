# 场景生成提示词模板

把下面整段（替换 `{{...}}`）发给 DeepSeek，要求它**只输出一个 HTML 文件**。

---

你是动效导演兼图形程序员。请写一个单文件 HTML，用 Canvas 2D 逐帧绘制一支 {{DURATION}} 秒的动效短片。

## 主题
{{IDEA}}

## 视觉
- 画幅 {{WIDTH}}×{{HEIGHT}}，帧率 {{FPS}}
- 色彩：{{PALETTE}}
- 字体：`"Noto Sans CJK SC", sans-serif`；等宽用 `"DejaVu Sans Mono", monospace`
- 质感：深色底、轻微噪点、暗角、细网格；文字必须锐利
- 风格参考：{{REFERENCE_STYLE}}

## 必须遵守
1. 只输出一个 HTML 文件，`<canvas>` 全屏，无任何外部资源（不联网、不引 CDN、不引外部图片/字体）。
2. 导出 `window.DUR`、`window.FPS`、`window.render(t)`、`window.READY`。
3. `render(t)` 必须**从零**画出第 t 秒，绝不依赖上一帧状态：
   - 禁用 `Date.now()` / `performance.now()`
   - `Math.random()` 只能用自带种子的 PRNG（给出 mulberry32 实现）
4. 所有尺寸按 `u = innerHeight / 1080` 缩放，坐标基于 `innerWidth/innerHeight`，不能硬编码 1920。
5. 结构：{{STRUCTURE}}
6. 全部使用缓动函数（easeOutQuint / easeInOutCubic），禁止线性匀速位移。
7. 结尾留 {{TAIL}} 秒淡出。

## 分镜（严格按时间）
{{STORYBOARD}}

## 输出格式
先输出完整的 `<!doctype html>` 到 `</html>`，不要解释、不要 markdown 代码围栏之外的文字。

---

## 迭代提示词（成片后微调，逐条发）

- `第 2.4 秒到 3.1 秒，标题上浮的位移太大，改成 24px，缓动换成 easeOutExpo。`
- `三张卡片的入场延迟改成 0.15 秒一档，第三张在 t=4.2 时必须完全就位。`
- `把网格透明度降到 0.04，并且让它的偏移随时间缓慢漂移，速度 6px/s。`
- `第 8 秒的计数器和画面里的实际帧号对不上，统一成 floor(t*30)。`
