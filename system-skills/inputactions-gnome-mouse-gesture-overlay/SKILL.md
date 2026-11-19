---
name: inputactions-gnome-mouse-gesture-overlay
description: 在 Fedora（GNOME/Wayland）上安装、配置、排查 InputActions 鼠标笔画手势，并用自建 GNOME Shell 扩展显示轨迹和实时动作名。适用于安装/重装、改手势或应用范围、手势不触发、overlay 不显示、托盘/服务异常、卸载等场景。关键词：InputActions、鼠标手势、stroke、overlay、GNOME、Mutter、Wayland、Easystroke、evdev、uinput、Fedora。
---

# InputActions GNOME 手势

官方 overlay 依赖 `wlr-layer-shell`，GNOME 的 Mutter 不实现，所以本方案用 GNOME Shell 扩展接管 `org.inputactions.overlay`，由客户端补丁在笔画过程中推送动作名。代码不在 skill 里，统一从下游仓库 <https://github.com/sherlocknieh/inputactions-gnome> 获取。

**按任务只读一个文件**，不要整份加载：

| 任务 | 读 |
|---|---|
| 改手势、增减应用范围、调容差、重载配置 | [references/config.md](references/config.md) |
| 安装、重装、升级、恢复 | [references/install.md](references/install.md) |
| 手势不触发、轨迹或动作名不显示、D-Bus/托盘异常 | [references/troubleshooting.md](references/troubleshooting.md) |
| 启停服务、托盘、卸载 | [references/service.md](references/service.md) |
| 改 GNOME 扩展、客户端补丁、热更新 | [references/development.md](references/development.md) |

通用约束：配置/补丁只同步到下游仓库 `sherlocknieh/inputactions-gnome`（`config/`、`patches/`、`gnome-extension/`、`tray/`），不要提交到上游 `InputActions/core`。
