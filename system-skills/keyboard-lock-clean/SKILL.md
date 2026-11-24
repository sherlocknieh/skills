---
name: keyboard-lock-clean
description: 在 Linux 桌面（含 Wayland）上临时锁定键盘，用于擦键盘/清灰时防止误触。提供 CLI（kbdlk）和 GTK4 图形界面（kbdlk-gui，应用列表里叫“键盘锁”），鼠标与触控板照常可用。也用于排查“锁定后某些键还有反应”（CapsLock、PrintScreen 截图、音量键漏锁、InputActions 抢占键盘）。适用于用户说“擦键盘时想锁住键盘”、“临时禁用键盘”、“键盘锁工具”、“有没有锁定键盘的小工具”、“键盘锁没覆盖所有按键”。关键词：擦键盘、锁定键盘、键盘锁、禁用键盘、锁键盘漏键、CapsLock、截图键、音量键、kbdlk、evdev、EVIOCGRAB、InputActions、input 组、Wayland、GTK4。
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

### 为什么要抓转发键盘

`InputActions`（stroke 手势那套）、`input-remapper` 这类工具会以 root 独占物理键盘，
再把按键从虚拟设备转发出来（名字形如 `AT Translated Set 2 keyboard (InputActions output)`）。
此时物理设备 `grab()` 返回 `EBUSY`，只抓它等于什么都没锁住——CapsLock、PrintScreen、音量
全都照常送达。所以本工具把转发键盘也一起独占：转发设备被抓住，按键就断在转发口上。

设备枚举走 `glob('/dev/input/event*')`，不能用 `evdev.list_devices()`：后者用 `os.access`
过滤，遇到带 ACL 的虚拟键盘节点会误判为不可读而直接漏掉，正好漏掉最需要锁的那几个。

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

`kbdlk -l` 里标「(被别的程序占用)」的设备表示有进程（通常是 InputActions / input-remapper）
已经独占了它，此时靠它的转发设备来覆盖。GUI 若发现某个忙设备既抓不到、也没有对应转发设备，
会在解锁按钮上方用红字列出「未能覆盖」——那就先退出那个程序再锁。

已知限制：转发类虚拟设备由对应守护进程动态创建，锁定期间若它重启或重载配置，新设备不在锁内，
需要解锁后重新锁一次。

## 排查：某些键还能用

按顺序看：

1. `kbdlk -l` 里目标设备是否标了「被别的程序占用」；
2. 若占用者是 InputActions，最彻底的做法是让它别再抢键盘——它所有手势都走鼠标笔画，
   键盘本不需要独占。在 `~/.config/inputactions/config.yaml` 的 `device_rules` 里加一条，
   并把 grab 规则里的 `$keyboard` 换成 `$mouse`：

   ```yaml
   device_rules:
     - conditions: $keyboard
       ignore: true
     - conditions:
         all:
           - any:
               - $mouse
           - none:
               - $name contains input-remapper
               - $name contains InputActions
       grab: true
       ignore: false
   ```

   然后 `inputactions config reload`，再 `kbdlk -l` 应能看到物理键盘不再被占用。
3. 若按键由 EC 固件直接处理（部分机型的 Fn 亮度键），软件层拦不住，属正常。

## 卸载

```bash
rm -f ~/.local/bin/kbdlk ~/.local/bin/kbdlk-gui \
      ~/.local/share/applications/kbdlk-gui.desktop
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

验证环境：Fedora 44 / GNOME 50 / Wayland / python3-evdev 1.9.3，2026-11-02；
2026-11-24 补上转发键盘覆盖（InputActions 虚拟键盘 / input-remapper）。
