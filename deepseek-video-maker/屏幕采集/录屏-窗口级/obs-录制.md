# OBS 录制

采集层换成 OBS（PipeWire 屏幕捕获），页面准备与动作执行不变，仍走 CDP。

## 为什么换

| | CDP screencast | OBS |
| --- | --- | --- |
| 画面范围 | 只有标签页表面 | 整屏 / 窗口，含地址栏与窗口装饰 |
| 分辨率 | 1520×776 | 3072×1920（面板物理像素） |
| 帧率 | 抓帧合成，易掉帧 | 60fps 恒定，硬件编码 |
| 光标 | 采不到系统光标 | 录真实光标 |

## 分工

- **动作层**：`tools/lab.mjs` 或 `browse execute --file take.mjs`，负责开页、注入脚本、移动/点击。
- **采集层**：`tools/obs.mjs`，通过 obs-websocket 启停录制。
- 两者互不依赖，可以分开调试。

## 一次性准备

```bash
bash tools/setup-obs.sh            # 生成 websocket 密码，写 OBS 沙箱配置
node tools/obs.mjs status          # 冷启动 OBS 并握手，返回场景与录制状态
```

首次启动 OBS 后要在 GUI 里做两件事（只有人能点）：

1. 场景里加 **屏幕捕获 (PipeWire)** 源，GNOME 弹窗里选 **整屏 eDP-1** 并允许。
2. 确认「设置 → 输出 → 录像」参数与下面一致。

授权一次后 OBS 会记住 restore token，之后 `obs.mjs start/stop` 全程无需交互。

## 每轮流程

```bash
node tools/obs.mjs start --dir 素材/raw
browse execute --file take.mjs     # 只做动作，等待写在脚本里
node tools/obs.mjs stop            # 打印 mkv 绝对路径
```

## 输出参数

- 画布/输出：3072×1920 @ 60fps（物理像素，逻辑 1536×960 × 2）
- 格式：**mkv**，崩溃或断电不丢文件；交付前转 mp4
- 编码：Intel Arc VAAPI HEVC，CQP 20（待实测确认 OBS 里的编码器名）
- 目录：`素材/raw/`，由 `obs.mjs start` 的 `--dir` 指定

## 光标

OBS 录的是**真实系统光标**，但 CDP 的 `Input.dispatchMouseEvent` 不会移动真实光标。
所以 [假光标](./假光标.md) 仍然必须注入——它是页面内跟随层，OBS 一样能录到。

## 裁剪

输入从 webm 变 mkv，命令不变，见 [裁剪](./裁剪.md)。
