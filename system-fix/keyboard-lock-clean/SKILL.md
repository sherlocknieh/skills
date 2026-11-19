---
name: keyboard-lock-clean
description: 在 Linux 桌面（含 Wayland）上临时锁定键盘，用于擦键盘/清灰时防止误触。提供 CLI（kbdlk）和 GTK4 图形界面（kbdlk-gui，应用列表里叫“键盘锁”），鼠标与触控板照常可用。适用于用户说“擦键盘时想锁住键盘”、“临时禁用键盘”、“键盘锁工具”、“有没有锁定键盘的小工具”。关键词：擦键盘、锁定键盘、键盘锁、禁用键盘、kbdlk、evdev、EVIOCGRAB、input 组、Wayland、GTK4。
---

# 临时锁定键盘（擦键盘用）

用 `EVIOCGRAB` 独占键盘设备，事件不会到达任何应用，Wayland 下同样有效；鼠标和触控板不抓。

## 原理（简述）

`InputDevice.grab()` 走的是内核 `EVIOCGRAB`：设备被本进程独占后，内核只把事件交给它，
libinput / 合成器 / 应用都收不到——所以不依赖 X11，Wayland 也有效
（`xtrlock`、`xinput disable` 只在 X11 下有用，`Super+L` 又要敲密码解锁）。

不抓的东西是刻意留的退路：电源键、合盖/睡眠键、带 `EV_SW` 的耳机插孔、鼠标与触控板。
笔记本的 Fn 组合键常由独立设备（如 Ideapad extra buttons、Video Bus）上报，会一并独占，
否则擦键盘时按到 Fn 仍会调亮度、关触摸板。

## 依赖

```bash
sudo dnf install python3-evdev            # Debian/Ubuntu: python3-evdev, Arch: python-evdev

id -nG | tr ' ' '\n' | grep -x input || sudo usermod -aG input "$USER"   # 需注销重登
```

GUI 另需 GTK4 + libadwaita（Fedora Workstation 自带）。

## 安装

```bash
mkdir -p ~/.local/bin ~/.local/share/applications
install -m755 ./kbdlk     ~/.local/bin/kbdlk
install -m755 ./kbdlk-gui ~/.local/bin/kbdlk-gui

sed "s|__KBDBIN__|$HOME/.local/bin|" ./kbdlk-gui.desktop \
  > ~/.local/share/applications/kbdlk-gui.desktop
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

## 使用

```bash
kbdlk-gui &    # 图形界面：点「锁定键盘」，擦完点「解锁」（或直接关窗口）
kbdlk 60       # 命令行：锁 60 秒后自动解锁
kbdlk 0        # 一直锁着
kbdlk -l       # 只看会锁哪些设备
```

注意：锁定期间键盘是哑的，**`Ctrl+C` 无效**。提前解除用鼠标关掉终端，或另会话 `pkill kbdlk`。
被独占的设备会列在 GUI 的「已锁定的设备」卡片里；笔记本的 Fn 组合键走独立设备，也会一并锁上。

## 卸载

```bash
rm -f ~/.local/bin/kbdlk ~/.local/bin/kbdlk-gui \
      ~/.local/share/applications/kbdlk-gui.desktop
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

验证环境：Fedora 44 / GNOME 50 / Wayland / python3-evdev 1.9.3，2026-11-02。
