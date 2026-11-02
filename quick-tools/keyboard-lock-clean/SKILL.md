---
name: keyboard-lock-clean
description: 在 Linux 桌面（含 Wayland）上临时锁定键盘，用于擦键盘/清灰时防止误触。提供一个 CLI（kbdlk）和一个 GTK4 图形界面（kbdlk-gui，应用列表里叫“键盘锁”），鼠标与触控板照常可用。适用于用户说“擦键盘时想锁住键盘”、“临时禁用键盘”、“键盘锁工具”、“有没有锁定键盘的小工具”。关键词：擦键盘、锁定键盘、键盘锁、禁用键盘、kbdlk、evdev、EVIOCGRAB、input 组、Wayland、GTK4、libadwaita。
---

# 临时锁定键盘（擦键盘用）

原理：用 `EVIOCGRAB`（python-evdev 的 `InputDevice.grab()`）**独占**键盘的 evdev 设备，
事件根本不会到达 libinput / 合成器 / 任何应用，所以 **Wayland 下同样有效**。
鼠标、触控板不抓，全程可用。

## 为什么不用现成方案

| 方案 | 问题 |
|---|---|
| `xtrlock` | 只在 X11 有效，Wayland 下无效 |
| `xinput --disable` | 只在 X11 有效 |
| `Super+L` 锁屏 | 解锁要敲密码，擦键盘时反而更麻烦，而且它锁的是整个会话 |
| 物理拔键盘 | 笔记本内置键盘拔不了 |

## 1. 依赖与前提

```bash
# Debian/Ubuntu 包名：python3-evdev；Arch：python-evdev
sudo dnf install python3-evdev          # Fedora
python3 -c "import evdev; print(evdev.__version__)"
```

当前用户必须在 **input 组**（否则读不到 `/dev/input/event*`）：

```bash
id -nG | tr ' ' '\n' | grep -x input || sudo usermod -aG input "$USER"
# 已登录的会话不会立即生效，需注销重登（或 reboot）
```

GUI 额外需要 GTK4 + libadwaita（Fedora Workstation 默认自带）：

```bash
python3 - <<'EOF'
import gi
gi.require_version("Gtk", "4.0"); gi.require_version("Adw", "1")
from gi.repository import Adw, Gtk
print("GTK4 + libadwaita OK")
EOF
```

## 2. 安装

```bash
mkdir -p ~/.local/bin ~/.local/share/applications
install -m755 ./kbdlk     ~/.local/bin/kbdlk
install -m755 ./kbdlk-gui ~/.local/bin/kbdlk-gui

sed "s|__KBDBIN__|$HOME/.local/bin|" ./kbdlk-gui.desktop \
  > ~/.local/share/applications/kbdlk-gui.desktop
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

确认 `~/.local/bin` 在 PATH 中（fish 需注意，Fedora 默认已包含）。
装完在应用列表里搜「键盘锁」，或直接运行 `kbdlk-gui`。

## 3. 用法

### GUI（推荐给人类用）

```bash
kbdlk-gui &
```

- **待机页**：键盘图标 + 说明 + 大按钮「锁定键盘」
- **锁定页**：锁图标 + 「键盘已锁定」+ 一个卡片，标题是「已锁定的设备（N 个）」，
  逐行列出被独占的设备名，下面一行说明「这些设备现在被程序独占，按键不会传到任何程序」+ 红色「解锁」按钮
- 解锁方式只有两个：点「解锁」，或直接关窗口（`close-request` 里先 ungrab）
- 没有倒计时（刻意设计：擦完自己点）

### CLI（适合绑快捷键 / 脚本）

```bash
kbdlk          # 锁 60 秒后自动解锁
kbdlk 180      # 锁 180 秒
kbdlk 0        # 一直锁着，直到手动解除
kbdlk -l       # 只看会锁哪些设备，不执行
```

**锁定期间键盘是哑的，`Ctrl+C` 无效。** 提前解除：用鼠标关掉终端窗口，或另开会话 `pkill kbdlk`。

## 4. 设备筛选规则（关键）

不能只抓「能打字的键盘」——笔记本的 Fn 组合键常常由**独立设备**上报，
不抓的话擦键盘时按到 Fn 还是会调亮度 / 关触摸板 / 切飞行模式。

判定逻辑（`targets()`）：

1. 名字命中 `power button` / `lid switch` / `sleep button` → **跳过**（留个能关机的后路）
2. 带 `EV_SW` 开关的设备 → **跳过**（耳机插孔、合盖、平板模式，抓了会破坏状态检测）
3. 有 `BTN_LEFT` / `BTN_MOUSE` / `BTN_TOUCH` → **跳过**（鼠标、触控板不锁）
4. 含 `KEY_A`,`KEY_Z`,`KEY_ENTER`,`KEY_SPACE`（打字键盘）→ **抓**
5. 或含 `SYSTEM_KEYS` 里的系统热键（亮度、键盘背光、RFKILL、MICMUTE、CAMERA、
   SWITCHVIDEOMODE、TOUCHPAD_TOGGLE、PROG1-4、多媒体键…）→ **抓**

参考输出（Fedora 44 / 联想笔记本）：

```
/dev/input/event2    AT Translated Set 2 keyboard     ← 内置键盘
/dev/input/event15   input-remapper keyboard          ← input-remapper 虚拟键盘
/dev/input/event8    Ideapad extra buttons            ← Fn 组合键
/dev/input/event7    Video Bus                        ← 亮度键
/dev/input/event17   HUAWEI FreeBuds SE 3 (AVRCP)     ← 蓝牙耳机媒体键
（跳过：Power Button / Lid Switch / sof-hda-dsp Headphone / 鼠标 / 触控板）
```

`kbdlk -l` 会按同样规则列出设备，改规则后先用它核对。

## 5. UI 里那句 FnLock 提示

GUI 待机页底部固定显示：

> 笔记本提示：Fn 组合键（亮度 / 音量 / FnLock）常由独立设备上报，锁定时会一并拦下；
> 若个别按键还有反应，可按 Fn+Esc 切换一次 FnLock 再试。

原因：某些机型的 Fn 行（尤其 Fn+Esc 的 FnLock 切换）会走 EC/ACPI 通道，
在系统层面表现为独立 input 设备或干脆不产生 evdev 事件，抓不到时只能靠 FnLock 换一套行为。

## 6. 验证是否真的锁住了

抓取成功后，任何其他进程再 `grab()` 同一设备都应报 `EBUSY`：

```bash
kbdlk 5 & sleep 1
python3 - <<'EOF'
import evdev
for p in ("/dev/input/event2", "/dev/input/event8"):
    d = evdev.InputDevice(p)
    try:
        d.grab(); print(p, "仍可抓 -> 没锁住"); d.ungrab()
    except OSError as e:
        print(p, f"EBUSY({e.strerror}) -> 已锁")
EOF
wait
```

## 7. GTK4 布局踩坑（改 UI 前必读）

1. **`Adw.ApplicationWindow` 强制最小宽度 360px。** 想更窄只能换 `Gtk.ApplicationWindow`，
   但那样**不能**再嵌 `Adw.ToolbarView`——它会算错约 36px 高度，表现为底部按钮被压成 24px、
   卡片内容被裁。想同时要 Adw 外观和更窄宽度是做不到的，360 是硬下限。
2. **别用 `Adw.StatusPage` 当主体。** 它的图标固定 128px + 超大标题，小窗口直接溢出。
   用普通 `Gtk.Box` + `Gtk.Image.set_pixel_size(56)` + `.title-2` 标签自己拼。
3. **设备清单要放进 `ScrolledWindow`**：`set_propagate_natural_height(True)` +
   `set_max_content_height(140)`，设备多了卡片内部滚动，窗口不变高。
4. 外面套 `.card` 样式类，行用 `caption` + `set_ellipsize(Pango.EllipsizeMode.END)` + tooltip。
5. 内容与按钮之间放一个 `Gtk.Box(vexpand=True)` 当弹簧，按钮永远贴底。
6. 锁定后调用 `self.present()` 抢回焦点，否则第一次点击只是激活窗口、点不到「解锁」。

### 离屏出图自查（不用真的截图）

改完布局先量高度，再用 `Gtk.WidgetPaintable` 渲染成 PNG 看效果：

```python
import gi; gi.require_version("Gdk", "4.0")
from gi.repository import Gtk, GLib
import cairo

def grab(win, name):
    t = win.get_content()                      # Gtk.ApplicationWindow 用 get_child()
    w, h = t.get_width(), t.get_height()
    snap = Gtk.Snapshot()
    Gtk.WidgetPaintable.new(t).snapshot(snap, w, h)
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, w, h)
    cr = cairo.Context(surf); cr.set_source_rgb(1, 1, 1); cr.paint()
    snap.to_node().draw(cr)
    surf.write_to_png(f"/tmp/opencode/{name}.png")

# 自然高度是否 <= 可用高度（窗口高 - headerbar ≈ 46px）
page = win.stack.get_visible_child()
print(page.measure(Gtk.Orientation.VERTICAL, win.get_width())[:2])  # (min, natural)
```

用 `importlib.machinery.SourceFileLoader` 加载无 `.py` 后缀的脚本，并给测试实例
`set_application_id("io.github.kbdlk.Probe")` 换个 id，避免和正在运行的实例抢 D-Bus 名。

## 8. 排错

| 现象 | 原因 / 处理 |
|---|---|
| GUI 提示「锁不住：没找到可用的键盘设备」 | 不在 input 组；`sudo usermod -aG input $USER` 后**注销重登** |
| 有设备被「跳过」（stderr 打印 EBUSY） | 该设备已被别的程序独占（如 input-remapper 在改键） |
| 锁定后键盘还有反应 | 走 EC/ACPI 的 Fn 键抓不到；`kbdlk -l` 看是否漏设备，或试 Fn+Esc 切 FnLock |
| CLI 里 `Ctrl+C` 退不出 | 正常，键盘被自己抓走了；用鼠标关终端或 `pkill kbdlk` |
| GUI 点「解锁」没反应 | 窗口没焦点，先点一下窗口再点按钮；代码里 `present()` 已处理 |
| 进程被 `kill -9` | 无害：fd 关闭，内核自动释放 grab |

## 9. 卸载

```bash
rm -f ~/.local/bin/kbdlk ~/.local/bin/kbdlk-gui \
      ~/.local/share/applications/kbdlk-gui.desktop
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

## 10. 验证环境

Fedora 44 Workstation，GNOME 50，Wayland，GTK 4.22 / libadwaita 1.9，
python3-evdev 1.9.3，用户属于 `wheel` + `input` 组。最后验证：2026-11-02。
