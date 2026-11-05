---
name: inputactions-gnome-mouse-gesture-overlay
description: 在 Fedora（GNOME/Wayland）上安装 InputActions 鼠标笔画手势，并用自建 GNOME Shell 扩展实现类似 Easystroke 的“轨迹 + 实时动作名”overlay，附带托盘启停。适用于用户要求 Linux 鼠标手势、InputActions 安装、GNOME 下画手势显示轨迹/动作名、官方 overlay 因缺少 wlr-layer-shell 不显示、需要托盘开关手势等场景。关键词：InputActions、鼠标手势、stroke、overlay、GNOME、Mutter、wlr-layer-shell、Easystroke、evdev、uinput、AppIndicator、Fedora。
---

# InputActions + GNOME 手势 overlay 一键还原

官方 InputActions overlay 依赖 `wlr-layer-shell`，GNOME 的 Mutter 不实现它，所以官方 overlay 只注册 D-Bus 服务、不画任何东西。本方案用一个 GNOME Shell 扩展接管 `org.inputactions.overlay`，在 shell 层绘制轨迹和实时动作名；客户端加了一个本地补丁，在笔画过程中匹配并推送动作名，另加轻量 `pause`/`unpause`、2 秒手势暂停超时和斜向角度门限。

验证环境：Fedora 44、GNOME 50.6 Wayland、InputActions standalone `d88c74b` / core `2beab8c`。

## 相关仓库

- 配套下游发行版（本 skill 的产物仓库）：<https://github.com/sherlocknieh/inputactions-gnome>
- skill 集合仓库：<https://github.com/sherlocknieh/skills>

> **同步规则**：调用本 skill 修改 InputActions 软件配置/补丁后，只同步到下游仓库 `sherlocknieh/inputactions-gnome`（对应 `config/`、`patches/`、`gnome-extension/`、`tray/` 等），**不要提交或推送到上游 `InputActions/core`**。core 源码仅作为临时构建树，改动以 `client.patch` 形式保存在下游仓库。

## 一键还原

代码不内置在 skill 中，统一从下游仓库获取，需要时下载/更新即可。

首次安装：

```bash
git clone https://github.com/sherlocknieh/inputactions-gnome.git ~/projects/inputactions-gnome
bash ~/projects/inputactions-gnome/install.sh
```

已有本地仓库时：

```bash
cd ~/projects/inputactions-gnome
git pull --ff-only
bash install.sh
```

脚本会依次完成：依赖安装 → 官方安装器 → 固定提交 → 应用客户端补丁 → 构建安装并恢复 setgid → 占位 overlay → GNOME 扩展 → 配置 → 托盘/服务/图标/自启/启动器 → 启用扩展 → daemon → 自检。**脚本结束会杀掉临时客户端**，避免它活过注销占用 TTY。

然后**注销并重新登录一次**（Wayland 下新扩展只能在登录时加载；脚本无法代替）。登录后 autostart 会拉起客户端和托盘。

验证：

```bash
gnome-extensions info inputactions-overlay@local   # 已启用: 是 / 状态: ACTIVE
busctl --user list | grep org.inputactions.overlay # 所有者应为 gnome-shell
pgrep -af 'inputactions-client|inputactions-tray'  # 两者都应在运行
```

完成标准：扩展 ACTIVE、D-Bus 名字属于 gnome-shell、客户端/托盘在跑；按住右键画手势能看到轨迹和动作名。

## 手势速查

按住**右键**画，未松手就会显示匹配到的动作名，松手执行。手势开始后如果**停顿超过 2 秒**，手势会被取消，轨迹和动作名**立即一起消失**，不执行动作。正常松手时轨迹立即消失、动作名保留 0.8 秒。四个斜向要求方向落在 **45°±`direction_tolerance`** 内（默认 18°，见 `config.yaml` 的 `overlay.mouse_stroke.direction_tolerance`，改完 `inputactions config reload` 即可，无需重编译）；略斜的水平/垂直会回落到直向，不会误触斜向。

| 笔画 | 动作 | 范围 |
|---|---|---|
| → 右 | 右侧标签页（Ctrl+PageDown） | 浏览器 |
| ← 左 | 左侧标签页（Ctrl+PageUp） | 浏览器 |
| ↑ 上 | 滚动到顶部（Ctrl+Home） | 全局 |
| ↓ 下 | 滚动到底部（Ctrl+End） | 全局 |
| ↗ 右上 | 窗口最大化（Super+Up） | 全局 |
| ↘ 右下 | 粘贴（Super+V） | 全局 |
| ↖ 左上 | 截图（PrintScreen） | 全局 |
| ↙ 左下 | 取消最大化（Super+Down） | 全局 |
| 下 → 右（折线） | 关闭标签页（Ctrl+W） | 全局 |
| 上 → 右（折线） | 新标签页（Ctrl+T） | 浏览器 |
| 左 → 右（折线） | 后退（Alt+Left） | 全局 |
| 右 → 左（折线） | 前进（Alt+Right） | 全局 |
| 左 → 下（折线） | 恢复标签页（Ctrl+Shift+T） | 浏览器 |

浏览器判定用 `$window_class`：chrome / chromium / **org.mozilla.firefox**（用 `contains firefox` 匹配）/ Navigator / brave / edge。活动窗口信息由 InputActions 的 GNOME 辅助扩展提供（脚本已启用）。要加别的浏览器，改 `config.yaml` 里那个条件组的 `any` 列表即可。

## 托盘与服务

- 托盘菜单「启用/暂停」：轻量 `pause`/`unpause`，不重载配置、不释放设备，**无卡顿**。
- 托盘「退出」：结束客户端 + 托盘。
- 启动器 `InputActions`：`inputactions-service toggle`，真正启停整个用户态服务；首次启动约有 1 秒鼠标卡顿（evdev 抓取 + uinput 重放交接），启动时会弹通知说明。
- `inputactions-service start|stop|toggle|status` 可脚本化控制。

## 已知坑（参考，不需要手动处理）

1. **setgid 丢失**：任何一次 `sudo make install` 都会重置 `/usr/bin/inputactions-client` 的属主和权限，daemon 会拒绝握手。脚本每次安装后都会 `chown $USER:inputactions` + `chmod g+s`。
2. **注销后的孤儿客户端**：`setsid` 启动的客户端可能活过注销，占着 daemon 的 TTY，导致新会话 autostart 被拒（“Tty already has a running instance”）。脚本自检后已杀掉；手动调试时注意注销前 `pkill`。
3. **ESM 模块缓存**：改扩展代码后 `disable/enable` 只重跑 `enable()`，不会重新导入模块。扩展用 `impl-current.txt` + `impl-vN.js` 的加载器，换文件名即可热更新。
4. **St.Label 不可见**：直接 `add_child` 到无布局管理器的父 actor 时 Label 尺寸是 0×0，必须显式 `set_size`。
5. **标签一闪而过**：`endTriggersCustom` 先 `hide()` 再 `showLabel()`，按钮释放还会再触发一次 `hide()`；`hide()` 里不能清标签。
6. **实时提示需要客户端补丁**：上游只在 `on: end` 匹配，补丁在笔画过程中每 2 个事件匹配一次并推送。
7. **`stroke` 与 `swipe` 不兼容**：同时配置会两个都失效，本配置只用 stroke。
8. **Input Remapper 冲突**：两者都做 evdev grab/uinput；配置里排除 `input-remapper` 设备，仍冲突就停 `input-remapper.service`。
9. **`record-stroke` 与合成输入**：录制的 base64 依赖设备加速度曲线，用 uinput 合成轨迹录出来的笔画匹配不上；用真实鼠标录。
10. **GNOME 必须注销**：新扩展不会被扫描，`ReloadExtension` 已废弃、`Eval` 默认禁用，无法绕过。
11. **`suspend` 很重**：它走 `load({empty:true})`，会重新解析配置、重建 handler、释放/重抓设备、重启 overlay 进程；日常暂停用托盘的 `pause`/`unpause`。
12. **停顿 2 秒会取消手势**：超时由客户端补丁里的 `MouseTriggerHandler::GESTURE_PAUSE_TIMEOUT{2000}` 控制；改时长就改这个常量后重新编译。取消时不会执行动作，右键也会一直吞到松开。
13. **最大化/全屏窗口上轨迹消失**：Mutter 的 direct scanout（unredirect）绕过合成器；显示 overlay 时调用 `global.compositor.disable_unredirect()`，轨迹/标签消失后 `enable_unredirect()`（引用计数，成对调用）。
14. **长动作名被省略号截断**：`St.Label.set_text()` 后立刻取 preferred width 可能拿到旧缓存；文本变化时销毁重建标签。
15. **斜向角度门限**：斜向模板只接受 45°±`direction_tolerance` 的直线（默认 ±18°）；略斜的水平/垂直会回落到直向。容差在 `config.yaml` 的 `overlay.mouse_stroke.direction_tolerance`（单位：度），运行时由 `ConfigLoader` 读入 `GlobalConfig`，`Stroke::directionMatches` 默认取该值，改配置后 `inputactions config reload` 即生效，无需重编译。非法值仍可能被 `config issues` 报出。

## 迭代

改扩展实现（不用注销）：

```bash
cd ~/.local/share/gnome-shell/extensions/inputactions-overlay@local
cp impl-v12.js impl-v13.js
# 编辑 impl-v13.js
echo impl-v13.js > impl-current.txt
gnome-extensions disable inputactions-overlay@local
gnome-extensions enable inputactions-overlay@local
```

改手势：编辑 `~/.config/inputactions/config.yaml`，然后重启客户端（或 `inputactions config reload`）。新增折线模板的格式是 3 个点（起点/拐点/终点），拐点 `t=0.5`，两段 alpha 写对应方向；实测 1:2～2:1 的两段长度比可稳定匹配。

升级 InputActions 或修改配置/补丁后，重跑仓库里的 `install.sh`：它会 checkout 回固定提交、重新打补丁并重装。

```bash
cd ~/projects/inputactions-gnome
git pull --ff-only      # 另一台机器或新克隆时
bash install.sh
```

**改动要提交回仓库**（`config/`、`patches/`、`gnome-extension/`、`tray/`），不要改上游 `InputActions/core`。skill 本身只保留说明，不再内置代码副本。

## 卸载

```bash
gnome-extensions disable inputactions-overlay@local 2>/dev/null
~/.local/bin/inputactions-service stop 2>/dev/null
pkill -f '^/usr/bin/inputactions-client$'
sudo systemctl disable --now inputactionsd

sudo rm -f /usr/bin/inputactions /usr/bin/inputactions-client /usr/bin/inputactionsd
sudo rm -f /usr/local/bin/inputactions-overlay
sudo rm -rf /usr/share/inputactions ~/.local/share/inputactions-installer
rm -rf ~/.config/inputactions
rm -f ~/.config/autostart/inputactions-client.desktop \
      ~/.config/autostart/inputactions-tray.desktop
rm -f ~/.local/share/applications/inputactions.desktop
rm -rf ~/.local/share/gnome-shell/extensions/inputactions-overlay@local
rm -f ~/.local/bin/inputactions-tray ~/.local/bin/inputactions-service
rm -rf ~/.local/state/inputactions-tray
rm -f ~/.local/share/icons/hicolor/scalable/apps/inputactions-tray-*.svg
```
