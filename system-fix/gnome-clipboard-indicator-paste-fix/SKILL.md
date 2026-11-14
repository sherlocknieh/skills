---
name: gnome-clipboard-indicator-paste-fix
description: 修复 GNOME「Clipboard Indicator」扩展的两个独立问题：(1) 点条目粘贴不出来/粘出旧内容（必须手动删掉顶部条目才能继续粘贴，固定条目能粘、普通条目不能）；(2) 开着 open-at-cursor 用快捷键开菜单时，面板贴着光标却压在屏幕外（指针偏下时朝上开、底边对齐指针；指针居中时下半截被切掉）。适用于 paste-on-select 开启后无反应、条目能置顶但不粘贴、GTK4 应用里 Shift+Insert 无效、菜单超出屏幕/顶到屏幕外/朝上打开。关键词：Clipboard Indicator、clipboard-indicator@tudmotu.com、粘贴不出来、粘贴失败、删除顶部条目、置顶、paste-on-select、move-item-first、Shift+Insert、Ctrl+V、open-at-cursor、光标处打开菜单、菜单超出屏幕、BoxPointer、_reposition、Wayland、GNOME 51。
---

# Clipboard Indicator 本地补丁

技能里是两个互相独立的补丁，`apply.py` 一起打，各自按代码文本匹配，已打过的跳过：

- **补丁一**：点击条目粘贴不出来 / 粘出旧内容。
- **补丁二**：光标处打开菜单时面板顶出屏幕。

技能 id 沿用 `paste-fix`，因为两者改的是同一份代码、共用同一个 `apply.py`。

扩展目录：`~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/`

一键应用（幂等，自动备份，检测不到预期代码会直接报错且不写文件）：

```bash
python3 ~/.config/opencode/skills/system-fix/gnome-clipboard-indicator-paste-fix/apply.py
```

验证环境：Fedora，GNOME Shell 51.1，Wayland，扩展 `clipboard-indicator@tudmotu.com` v72（上游 master 同样存在这两个问题）。
相关 gsettings：`paste-on-select=true`、`move-item-first=true`、`paste-button=false`、`open-at-cursor=true`。

## 补丁一：点击粘贴失效

### 症状

- 菜单里点条目后**什么都不粘贴**，但条目确实跳到了顶部（`move-item-first` 生效）。
- 只有**固定（favorite）条目**点击后能正常粘贴，普通条目不行。
- 有时表现为粘出**旧内容**（顶部条目的内容），删掉顶部条目后下一次能粘。
- 在 GTK4 应用（Nautilus、Text Editor、Ptyxis 等）里尤其明显。

### 根因（三个独立缺陷，叠加出现）

#### 1. 置顶动作销毁了正在粘贴的菜单项（主因）

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

#### 2. 粘贴键用了 GTK4 已移除的绑定

普通分支发的是 `Shift+Insert`。GTK4 移除了这个粘贴绑定（只保留 `<Primary>v`），所以本地 GTK4 应用按了等于没按。终端分支的 `Ctrl+Shift+Insert` 同样不如 `Ctrl+Shift+V` 通用。

#### 3. 虚拟键盘事件时间戳是旧事件时间

`Keyboard#notify()` 用 `Clutter.get_current_event_time() * 1000`。在 `setTimeout` 回调里没有正在处理的事件，拿到的是**上一次事件**的毫秒时间，乘 1000 当微秒用，时间戳落后当前时刻，mutter 会把这种输入当过期事件丢弃。

#### 附带缺陷：粘贴后恢复成「旧选中项」

`#pasteItem()` 结尾会把剪贴板写回点击前的 `currentlySelected`，而不是系统原本的剪贴板内容。与 `PASTE_ON_SELECT` 设置的新选中项错位，慢应用（Electron、远程桌面、XWayland）会读到旧内容。多条目连续粘贴时表现为「必须删掉顶部条目」。

### 修复

手工等价改动如下（一键应用见文首）。

#### extension.js — `_onMenuItemSelectedAndMenuClose()`

```js
// 点击即粘贴时不要在这里立即置顶：_moveItemFirst 会销毁并重建当前菜单项，
// 干扰菜单关闭动画与随后注入的粘贴键。置顶改由 #pasteItem 在按键发出后完成。
if (!PASTE_ON_SELECT && MOVE_ITEM_FIRST && !menuItem.entry.isFavorite()) {
    this._moveItemFirst(menuItem);
}
```

#### extension.js — `_refreshIndicator()`

```js
// 粘贴进行中（#pasteItem 尚未发完按键）不要重建并置顶菜单项：
// _moveItemFirst 会销毁当前菜单项，打断随后注入的粘贴键。
// 置顶由 #pasteItem 在按键发出后自己完成。
if (!menuItem.entry.isFavorite() && MOVE_ITEM_FIRST && !this.preventIndicatorUpdate) {
    this._moveItemFirst(menuItem);
}
```

`preventIndicatorUpdate` 只在 `#pasteItem` 里置位，可安全当作「粘贴进行中」标记。

#### extension.js — 替换整个 `#pasteItem()`

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

#### keyboard.js — `#notify()`

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

### 排错

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

## 补丁二：光标处打开菜单超出屏幕

### 症状

- 开着「Open menu at cursor」，用快捷键开菜单时面板贴着指针却压在屏幕外：
  - 指针偏下：面板朝上展开，**左下角**对齐指针（箭头画在面板底边），顶边可能被切掉；
  - 指针居中：面板朝下展开，**下半截**落到屏幕外，最底部条目点不到。
- 指针靠上时看着正常，所以容易当成偶发；实际是「下方放不下、上方又放得下」才翻上去，两个方向都放不下就直接挂在屏幕外。
- 复现前提：历史要有 6 条以上。菜单最大高度是历史区 450px + 固定区 450px，太矮时怎么放都放得下。

### 根因

`_toggleMenu()` 只把 `sourceActor` 指到光标处的 1px `_cursorActor`，位置全交给 `BoxPointer._reposition()`：

- 横向：`resX` 会夹进工作区；
- 纵向：只有「下方放不下 + 上方放得下」才翻到指针上方（`_calculateArrowSide`），其余情况**不做任何夹取**，直接挂在屏幕外。

v72 实测（无头嵌套 shell，1280×800，工作区 y=29..800，15 条历史，菜单 396×681）：

| 指针 y | 原行为 |
|---|---|
| 400 | 顶边 401、底边 1082，越出工作区 282px |
| 750 | 翻到上方，面板 y=69..750（底边对齐指针） |
| 100 | y=101..782，正常 |

### 修复

- `_setupCursorMenuPosition()`：`_init` 里调用，接管 `BoxPointer._reposition` 和 `_calculateArrowSide`。只在 `sourceActor` 是光标占位符时生效，从面板图标打开菜单仍走 shell 原逻辑。
- `_repositionAtCursor()`：面板左上角钉在按下快捷键那一刻的指针位置（`_cursorOpenPosition`，菜单打开期间移动鼠标不会拖着面板跑），右边/下方放不下就向内收，保证整块留在工作区内；面板比工作区还高时贴顶，交给内部 ScrollView 滚动。
- `_toggleMenu()`：记录锚点坐标，并强制箭头朝上（面板向下展开），避免上一次打开残留的箭头方向把面板翻到指针上方。

三段方法的手工等价改动见 `apply.py` 里的 `CURSOR_MENU_METHODS`。

### 验证（无头嵌套 shell）

上游仓库自带 `agents/session.sh` + `agents/ns.sh`：`--headless --virtual-monitor` 起一个隔离 shell，用虚拟指针设备和 `_toggleMenu()` 读几何。不改用户目录的做法是把 `XDG_DATA_HOME` 指到临时目录，里面放指向仓库的 symlink。

修复后实测（条件同上）：

| 指针 y | 修复后 |
|---|---|
| 400 | y=101..782 |
| 750 | y=119..800（正好贴工作区底边） |
| 750，短菜单 249px | y=528..777 |

判据：`bp.arrowSide` 始终是 `St.Side.TOP`（面板向下展开），底边不超过工作区底边。

## 生效

Wayland 下扩展 JS 由 shell 进程的 ESM 模块缓存持有，`gnome-extensions disable/enable` **不会**重新执行类定义。必须**注销重登**（或重启）。两个补丁都是如此。

验证是否已加载：

```bash
pid=$(pgrep -x gnome-shell | head -1)
ps -o lstart= -p $pid                     # shell 启动时间
stat -c '%y' ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/extension.js
# shell 启动时间必须晚于文件修改时间
```

## 验证清单

补丁一：

1. 复制两段不同文本 A、B 进历史。
2. 打开菜单点 A：应粘出 A，条目随后跳到顶部。
3. 再点 B：应粘出 B，无需先删顶部条目。
4. 点一条固定条目：行为不退化。

补丁二：

1. 指针分别放到屏幕上部、中部、下部，各按一次快捷键。
2. 每次都应是：面板顶边贴着指针、向下展开、整块留在屏幕内（靠下时上移贴底边而不是翻到上方）。
3. 再点一条条目，确认粘贴没退化。

## 回滚

```bash
cd ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com
ls extension.js.bak-* keyboard.js.bak-*
cp extension.js.bak-<时间戳> extension.js
cp keyboard.js.bak-<时间戳> keyboard.js
```

然后注销重登。

## 维护

- 扩展从 extensions.gnome.org 更新会覆盖 `extension.js` / `keyboard.js`，两个补丁一起丢；更新后重跑 `apply.py`。
- `apply.py` 按 v72 的代码文本匹配；上游改动后会报「未找到」，此时按上文手工改。
- 改过 `apply.py` 里的补丁文本后，用干净 v72 验证一遍能完整复现：从上游仓库 `git show v72:extension.js` / `v72:keyboard.js` 复制到临时目录跑脚本，结果应与已安装文件逐字节相同。

## 上游进展（2026-11）

### 补丁一

- `b900579`「Move an item to the top only once the menu has closed」已合入 master：新增 `#moveItemFirstWhenClosed()`，等 `menu-closed` 再重排，修的正是本技能的主因。截至扩展 v72 **尚未发布到 EGO**。
- `#639`（open，mergeable）：只删掉 `#pasteItem` 里粘贴后回滚剪贴板的三行，对应本技能的 revert 部分。
- `#663`（open）：同类综合修复，已与 master 冲突。
- `#543`（open issue）：同类症状的汇总讨论。
- 已在 #543 补充 v72 复现与 master headless 验证，在 #639 评论支持合并。

### 补丁二

- `#655`（open issue）「Open menu at cursor: menu runs off the screen when the pointer is mid-screen」：报告者给出了「菜单两个方向都放不下时移动锚点」的思路。
- `#671`（open PR，2026-11）：按该思路实现——放不下时只上移锚点，保留 shell 的横向对齐，因此箭头仍指向指针；已附 headless 前后对比数据。
- 本地版比 PR 更彻底：直接接管 `_reposition`，面板左边缘精确对齐指针，并显式禁止向上翻转。上游合并后本地这段可以删掉、改用上游版（功能等价，横向可能差几十像素）。
- `#666` 也改 `_toggleMenu()`，与 `#671` 有文本冲突，谁先落地都需要 rebase。

## 升级到包含 `b900579` 的版本后

- `apply.py` 会因 `_onMenuItemSelectedAndMenuClose` / `_refreshIndicator` 的原文不匹配而报错退出（安全，不写半截文件）。
- 此时 `_moveItemFirst` 两处不必再改，只需保留 `#pasteItem` 的改动（去 revert、Ctrl+V、置顶延后）——如果上游仍未合并 #639。
- `#pasteItem` 里按 `entry` 找回条目的置顶逻辑，与上游 `#moveItemFirstWhenClosed` 功能重叠，可整段删掉，只留去 revert。
- 补丁二与 `b900579` 无关，不受影响；若 `#671` 已合入，补丁二也可整段删掉。
