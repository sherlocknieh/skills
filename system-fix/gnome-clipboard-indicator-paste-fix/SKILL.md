---
name: gnome-clipboard-indicator-paste-fix
description: 修复 GNOME「Clipboard Indicator」扩展点击条目粘贴不出来/粘出旧内容的问题（常见症状：必须手动删除顶部条目才能继续粘贴，固定条目能粘、普通条目不能）。适用于 paste-on-select（点击即粘贴）开启后无反应、条目能置顶但不粘贴、GTK4 应用里 Shift+Insert 无效。关键词：Clipboard Indicator、clipboard-indicator@tudmotu.com、粘贴不出来、粘贴失败、删除顶部条目、置顶、paste-on-select、move-item-first、Shift+Insert、Ctrl+V、Wayland、GNOME 51。
---

# Clipboard Indicator 点击粘贴失效修复

## 症状

- 菜单里点条目后**什么都不粘贴**，但条目确实跳到了顶部（`move-item-first` 生效）。
- 只有**固定（favorite）条目**点击后能正常粘贴，普通条目不行。
- 有时表现为粘出**旧内容**（顶部条目的内容），删掉顶部条目后下一次能粘。
- 在 GTK4 应用（Nautilus、Text Editor、Ptyxis 等）里尤其明显。

验证环境：Fedora，GNOME Shell 51.1，Wayland，扩展 `clipboard-indicator@tudmotu.com` v72（上游 master 同样存在）。
相关 gsettings：`paste-on-select=true`、`move-item-first=true`、`paste-button=false`。

## 根因（三个独立缺陷，叠加出现）

### 1. 置顶动作销毁了正在粘贴的菜单项（主因）

`_moveItemFirst()` 不是移动，而是**销毁 + 重建**菜单项：

```js
_moveItemFirst (item) {
    this._removeEntry(item);                                   // menuItem.destroy()
    this._addEntry(item.entry, item.currentlySelected, false); // addMenuItem
    this._updateCache();
}
```

它在点击后、按键注入前的窗口期被触发两次，且都只对非固定条目生效（条件含 `!entry.isFavorite()`）：

- `_onMenuItemSelectedAndMenuClose()` —— `PASTE_ON_SELECT` 快速路径补充置顶；
- `_refreshIndicator()` —— 剪贴板一变就触发 `owner-changed`，匹配到条目后再置顶。

菜单关闭动画期间把被点击的菜单项销毁再插入新项，菜单状态被搅乱，随后注入的粘贴键落到 shell 菜单上而不是目标应用。固定条目被 `isFavorite()` 挡住，所以只有它能粘。

### 2. 粘贴键用了 GTK4 已移除的绑定

普通分支发的是 `Shift+Insert`。GTK4 移除了这个粘贴绑定（只保留 `<Primary>v`），所以本地 GTK4 应用按了等于没按。终端分支的 `Ctrl+Shift+Insert` 同样不如 `Ctrl+Shift+V` 通用。

### 3. 虚拟键盘事件时间戳是旧事件时间

`Keyboard#notify()` 用 `Clutter.get_current_event_time() * 1000`。在 `setTimeout` 回调里没有正在处理的事件，拿到的是**上一次事件**的毫秒时间，乘 1000 当微秒用，时间戳落后当前时刻，mutter 会把这种输入当过期事件丢弃。

### 附带缺陷：粘贴后恢复成「旧选中项」

`#pasteItem()` 结尾会把剪贴板写回点击前的 `currentlySelected`，而不是系统原本的剪贴板内容。与 `PASTE_ON_SELECT` 设置的新选中项错位，慢应用（Electron、远程桌面、XWayland）会读到旧内容。多条目连续粘贴时表现为「必须删掉顶部条目」。

## 修复

扩展目录：`~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/`

一键应用（幂等，自动备份，检测不到预期代码会直接报错不写入）：

```bash
python3 ~/.config/opencode/skills/system-fix/gnome-clipboard-indicator-paste-fix/apply.py
```

手工等价改动如下。

### extension.js — `_onMenuItemSelectedAndMenuClose()`

```js
// 点击即粘贴时不要在这里立即置顶：_moveItemFirst 会销毁并重建当前菜单项，
// 干扰菜单关闭动画与随后注入的粘贴键。置顶改由 #pasteItem 在按键发出后完成。
if (!PASTE_ON_SELECT && MOVE_ITEM_FIRST && !menuItem.entry.isFavorite()) {
    this._moveItemFirst(menuItem);
}
```

### extension.js — `_refreshIndicator()`

```js
// 粘贴进行中（#pasteItem 尚未发完按键）不要重建并置顶菜单项：
// _moveItemFirst 会销毁当前菜单项，打断随后注入的粘贴键。
// 置顶由 #pasteItem 在按键发出后自己完成。
if (!menuItem.entry.isFavorite() && MOVE_ITEM_FIRST && !this.preventIndicatorUpdate) {
    this._moveItemFirst(menuItem);
}
```

`preventIndicatorUpdate` 只在 `#pasteItem` 里置位，可安全当作「粘贴进行中」标记。

### extension.js — 替换整个 `#pasteItem()`

```js
// 粘贴选中条目：写入剪贴板 → 注入粘贴键 → 保持该条目为剪贴板内容并同步顶栏。
// 不再「恢复点击前的选中项」：PASTE_ON_SELECT 会立刻把被点条目标为选中并置顶，
// 恢复旧条目会与这个新选中状态错位，慢应用（Electron/远程桌面/XWayland）读到旧内容。
#pasteItem (menuItem) {
    this.menu.close();

    const entry = menuItem.entry;
    // 等菜单关闭动画结束、焦点回到目标应用后再发按键
    const KEY_DELAY_MS = 120;
    // 按键后再留出目标应用读取剪贴板的时间，期间不刷新顶栏
    const SETTLE_MS = 150;

    this.preventIndicatorUpdate = true;
    this.#updateClipboard(entry);

    this._pastingKeypressTimeout = setTimeout(() => {
        if (this.keyboard.purpose === Clutter.InputContentPurpose.TERMINAL) {
            // 终端类应用粘贴键是 Ctrl+Shift+V，普通 Ctrl+V 会被终端当成输入字符
            this.keyboard.press(Clutter.KEY_Control_L);
            this.keyboard.press(Clutter.KEY_Shift_L);
            this.keyboard.press(Clutter.KEY_v);
            this.keyboard.release(Clutter.KEY_v);
            this.keyboard.release(Clutter.KEY_Shift_L);
            this.keyboard.release(Clutter.KEY_Control_L);
        }
        else {
            // 普通应用统一用 Ctrl+V：GTK4 已移除 Shift+Insert 的粘贴绑定
            this.keyboard.press(Clutter.KEY_Control_L);
            this.keyboard.press(Clutter.KEY_v);
            this.keyboard.release(Clutter.KEY_v);
            this.keyboard.release(Clutter.KEY_Control_L);
        }

        this._pastingResetTimeout = setTimeout(() => {
            this.preventIndicatorUpdate = false;
            // 剪贴板保留被粘贴条目，主动同步顶栏，避免显示停留在此前的条目
            this.#updateIndicatorContent(entry);
            // 粘贴键发出后再把条目置顶：重建菜单项不早于按键，避免打断粘贴注入
            if (MOVE_ITEM_FIRST && !entry.isFavorite()) {
                const target = this.clipItemsRadioGroup.find(item => item.entry === entry);
                if (target) this._moveItemFirst(target);
            }
        }, SETTLE_MS);
    }, KEY_DELAY_MS);
}
```

### keyboard.js — `#notify()`

```js
// 注入按键事件：时间戳用 CLUTTER_CURRENT_TIME，由 mutter 按当前时刻处理。
// 传旧事件时间会导致输入被当作过期事件丢弃。
#notify (key, state) {
    this.#device.notify_keyval(
        Clutter.CURRENT_TIME,
        key,
        state
    );
}
```

## 生效

Wayland 下扩展 JS 由 shell 进程的 ESM 模块缓存持有，`gnome-extensions disable/enable` **不会**重新执行类定义。必须**注销重登**（或重启）。

验证是否已加载：

```bash
pid=$(pgrep -x gnome-shell | head -1)
ps -o lstart= -p $pid                     # shell 启动时间
stat -c '%y' ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/extension.js
# shell 启动时间必须晚于文件修改时间
```

## 验证

1. 复制两段不同文本 A、B 进历史。
2. 打开菜单点 A：应粘出 A，条目随后跳到顶部。
3. 再点 B：应粘出 B，无需先删顶部条目。
4. 点一条固定条目：行为不退化。

## 排错

补丁已加载但仍不粘，往 `#pasteItem` 的按键回调里临时加日志：

```js
const focusWin = global.display.focusWindow;
console.log(`[clipboard-indicator] menuOpen=${this.menu.isOpen} purpose=${this.keyboard.purpose} wmClass=${focusWin?.get_wm_class()}`);
```

```bash
journalctl -b -o cat /usr/bin/gnome-shell | grep clipboard-indicator | tail -20
```

- `menuOpen=true`：菜单被重新打开，检查是否还有别的路径调 `_moveItemFirst`。
- `purpose=12`（`TERMINAL`）：走了 `Ctrl+Shift+V`；`purpose` 不准时可改用 `focusWin.get_wm_class()` 判断终端。
- 三行都没有：`#pasteItem` 没被调用，检查点击路径和 `paste-on-select` 取值。

**远程桌面（xfreerdp 等）**：本地剪贴板写入后还要经 CLIPRDR 同步到远端，270ms 可能不够。把 `KEY_DELAY_MS` 调到 300–500。远端报 `[RDP.CLIPRDR] Possible protocol violation` 说明是同步超时，不是本补丁的问题。

## 回滚

```bash
cd ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com
ls extension.js.bak-* keyboard.js.bak-*
cp extension.js.bak-<时间戳> extension.js
cp keyboard.js.bak-<时间戳> keyboard.js
```

然后注销重登。

## 维护

- 扩展从 extensions.gnome.org 更新会覆盖 `extension.js` / `keyboard.js`，补丁丢失；更新后重跑 `apply.py`。
- 上游 `Tudmotu/gnome-shell-extension-clipboard-indicator` master 仍存在该问题（v72 验证）。可作为 issue 线索：`paste-on-select` + `move-item-first` 组合下，`_moveItemFirst` 的销毁重建发生在按键注入之前。
- `apply.py` 按 v72 的代码文本匹配；上游改动后会报「未找到」，此时按上文手工改。
