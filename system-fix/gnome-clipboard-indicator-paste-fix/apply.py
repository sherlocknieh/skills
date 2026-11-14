#!/usr/bin/env python3
"""给 Clipboard Indicator 打两个本地补丁：

1. 点击条目粘不出来：置顶销毁菜单项、Shift+Insert、事件时间戳、粘贴后回退剪贴板。
2. 光标处打开菜单时面板顶出屏幕：接管 BoxPointer 的定位，面板左上角钉在光标并按工作区夹取。

两者互相独立，锚点各自匹配，命中哪个打哪个。

用法：
    python3 apply.py [扩展目录]

不带参数时使用默认路径 ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com。
脚本按 v72 的代码文本匹配，已打过的改动会跳过；原文匹配不到时报错且不写文件。
打完必须注销重登才能生效（Wayland 下扩展模块不会热重载）。
"""

import os
import re
import shutil
import sys
import time

DEFAULT_DIR = os.path.expanduser(
    "~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com"
)


# 每项是（文件名, 原始片段, 修复后片段, 幂等标记）；标记已存在则跳过。
EXTENSION_EDITS = [
    (
        "extension.js",
        "        // Ensure MOVE_ITEM_FIRST also applies when PASTE_ON_SELECT fast-path skips _refreshIndicator()\n"
        "        if (PASTE_ON_SELECT && MOVE_ITEM_FIRST && !menuItem.entry.isFavorite()) {\n",
        "        // 点击即粘贴时不要在这里立即置顶：_moveItemFirst 会销毁并重建当前菜单项，\n"
        "        // 干扰菜单关闭动画与随后注入的粘贴键。置顶改由 #pasteItem 在按键发出后完成。\n"
        "        if (!PASTE_ON_SELECT && MOVE_ITEM_FIRST && !menuItem.entry.isFavorite()) {\n",
        "        if (!PASTE_ON_SELECT && MOVE_ITEM_FIRST && !menuItem.entry.isFavorite()) {",
    ),
    (
        "extension.js",
        "                        if (!menuItem.entry.isFavorite() && MOVE_ITEM_FIRST) {\n",
        "                        // 粘贴进行中（#pasteItem 尚未发完按键）不要重建并置顶菜单项：\n"
        "                        // _moveItemFirst 会销毁当前菜单项，打断随后注入的粘贴键。\n"
        "                        // 置顶由 #pasteItem 在按键发出后自己完成。\n"
        "                        if (!menuItem.entry.isFavorite() && MOVE_ITEM_FIRST && !this.preventIndicatorUpdate) {\n",
        "MOVE_ITEM_FIRST && !this.preventIndicatorUpdate",
    ),
    (
        "keyboard.js",
        "    #notify (key, state) {\n"
        "        this.#device.notify_keyval(\n"
        "            Clutter.get_current_event_time() * 1000,\n"
        "            key,\n"
        "            state\n"
        "        );\n"
        "    }\n",
        "    // 注入按键事件：时间戳用 CLUTTER_CURRENT_TIME，由 mutter 按当前时刻处理。\n"
        "    // 原先传 get_current_event_time()*1000，延时回调里拿到的常是上一次事件的旧时间，\n"
        "    // 时间戳落后于当前时刻时事件会被输入管线当成过期输入丢弃，表现为「点了没粘贴」。\n"
        "    #notify (key, state) {\n"
        "        this.#device.notify_keyval(\n"
        "            Clutter.CURRENT_TIME,\n"
        "            key,\n"
        "            state\n"
        "        );\n"
        "    }\n",
        "Clutter.CURRENT_TIME",
    ),
    (
        "extension.js",
        "        this._cursorActor = new Clutter.Actor({ opacity: 0, width: 1, height: 1 });\n"
        "        Main.uiGroup.add_child(this._cursorActor);\n"
        "\n"
        "        this.menu.connect('open-state-changed', (menu, isOpen) => {\n"
        "            if (!isOpen)\n"
        "                this.menu.sourceActor = this;\n"
        "        });\n"
        "\n"
        "        this.extension = extension;\n",
        "        this._cursorActor = new Clutter.Actor({ opacity: 0, width: 1, height: 1 });\n"
        "        Main.uiGroup.add_child(this._cursorActor);\n"
        "        // 打开于光标时的锚点坐标，由 _toggleMenu 每次打开前刷新\n"
        "        this._cursorOpenPosition = {x: 0, y: 0};\n"
        "\n"
        "        this.menu.connect('open-state-changed', (menu, isOpen) => {\n"
        "            if (!isOpen)\n"
        "                this.menu.sourceActor = this;\n"
        "        });\n"
        "\n"
        "        this._setupCursorMenuPosition();\n"
        "\n"
        "        this.extension = extension;\n",
        "this._setupCursorMenuPosition();",
    ),
    (
        "extension.js",
        "    _toggleMenu () {\n"
        "        if (!this.menu.isOpen && OPEN_AT_CURSOR) {\n"
        "            const [x, y] = global.get_pointer();\n"
        "            this._cursorActor.set_position(x, y);\n"
        "            this.menu.sourceActor = this._cursorActor;\n"
        "        }\n"
        "        this.menu.toggle();\n"
        "    }\n",
        "    _toggleMenu () {\n"
        "        if (!this.menu.isOpen && OPEN_AT_CURSOR) {\n"
        "            const [x, y] = global.get_pointer();\n"
        "            // 记下打开瞬间的光标位置：_repositionAtCursor 用它钉住面板，菜单打开期间移动鼠标不会拖着面板跑\n"
        "            this._cursorOpenPosition = {x, y};\n"
        "            this._cursorActor.set_position(x, y);\n"
        "            this.menu.sourceActor = this._cursorActor;\n"
        "            // 面板在光标处向下展开，箭头必须朝上；上一次从面板按钮打开可能已把箭头翻到下方\n"
        "            if (this.menu._boxPointer?.arrowSide !== St.Side.TOP)\n"
        "                this.menu._boxPointer?.updateArrowSide(St.Side.TOP);\n"
        "        }\n"
        "        this.menu.toggle();\n"
        "    }\n",
        "this._cursorOpenPosition = {x, y};",
    ),
]

# 光标处打开菜单的定位三个方法，插在 _init 结尾与 #updateIndicatorContent 之间。
CURSOR_MENU_METHODS_OLD = (
    "        }).catch(e => console.error('Clipboard Indicator: _buildMenu failed', e));\n"
    "    }\n"
    "\n"
    "    #updateIndicatorContent(entry) {"
)

CURSOR_MENU_METHODS = """    // 光标处打开菜单时的定位：接管 BoxPointer 的 _reposition，让面板左上角对齐光标并夹在显示器工作区内。
    // shell 默认按"箭头方向"推断位置（下方放不下就翻到光标上方），翻上去或菜单较高时会把面板顶出屏幕；
    // 这里只拦截 sourceActor 为光标占位符（_cursorActor）的情况，从面板按钮打开时仍走 shell 原逻辑。
    _setupCursorMenuPosition () {
        const boxPointer = this.menu?._boxPointer;
        if (!boxPointer)
            return;

        // 光标处打开的面板始终向下展开：禁止 shell 把箭头翻到下方，否则面板会盖到光标上方
        const calculateArrowSide = boxPointer._calculateArrowSide.bind(boxPointer);
        boxPointer._calculateArrowSide = arrowSide =>
            this.menu.sourceActor === this._cursorActor
                ? St.Side.TOP
                : calculateArrowSide(arrowSide);

        // shell 的 _reposition 只对横向做工作区夹取，纵向位置完全由箭头方向决定，因此整段替换
        const reposition = boxPointer._reposition.bind(boxPointer);
        boxPointer._reposition = allocationBox => {
            if (this.menu.sourceActor !== this._cursorActor)
                reposition(allocationBox);
            else
                this._repositionAtCursor(boxPointer, allocationBox);
        };
    }

    // 把面板左上角摆到打开菜单时的光标处：右边/下边放不下就向内收，保证面板整块留在工作区内，
    // 面板本身比工作区还高时贴顶显示（内部 ScrollView 负责滚动）。箭头横坐标仍指向光标。
    _repositionAtCursor (boxPointer, allocationBox) {
        const {x, y} = this._cursorOpenPosition;
        const [, , natWidth, natHeight] = boxPointer.get_preferred_size();
        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            Main.layoutManager.findIndexForActor(this._cursorActor));

        // _updateFlip 会读这两个缓存字段，这里保持与 shell 一致
        boxPointer._sourceExtents = this._cursorActor.get_transformed_extents();
        boxPointer._workArea = workArea;

        const resX = natWidth >= workArea.width
            ? workArea.x
            : Math.clamp(x, workArea.x, workArea.x + workArea.width - natWidth);
        const resY = natHeight >= workArea.height
            ? workArea.y
            : Math.clamp(y, workArea.y, workArea.y + workArea.height - natHeight);

        boxPointer.setArrowOrigin(this._arrowOriginFor(boxPointer, resX, x, natWidth));

        // allocationBox 的原点在父坐标系里：和 shell 一样把 stage 坐标换算过去
        let parent = boxPointer.get_parent();
        let [ok, stageX, stageY] = parent.transform_stage_point(resX, resY);
        while (!ok && parent.get_parent()) {
            parent = parent.get_parent();
            [ok, stageX, stageY] = parent.transform_stage_point(resX, resY);
        }
        // 换算失败时宁可退回 stage 坐标，也不要用 transform_stage_point 留下的无效值
        if (!ok) {
            stageX = resX;
            stageY = resY;
        }
        allocationBox.set_origin(Math.floor(stageX), Math.floor(stageY));
    }

    // 箭头横坐标 = 光标相对面板左边的偏移，夹在圆角留白以内，避免箭头画到圆角上
    _arrowOriginFor (boxPointer, resX, pointerX, natWidth) {
        const themeNode = boxPointer.get_theme_node();
        const borderWidth = themeNode.get_length('-arrow-border-width');
        const arrowBase = themeNode.get_length('-arrow-base');
        const borderRadius = themeNode.get_length('-arrow-border-radius');
        const inset = borderWidth / 2 + borderRadius + Math.floor(arrowBase / 2);
        return Math.clamp(pointerX - resX, inset, Math.max(inset, natWidth - inset));
    }

"""

CURSOR_MENU_METHODS_NEW = CURSOR_MENU_METHODS_OLD.replace(
    "\n\n    #updateIndicatorContent(entry) {",
    "\n\n" + CURSOR_MENU_METHODS + "    #updateIndicatorContent(entry) {",
)

# 整个 #pasteItem 函数替换：从函数头到 #showImagePreview 之前。
PASTE_ITEM_NEW = """    // 粘贴选中条目：写入剪贴板 → 注入粘贴键 → 保持该条目为剪贴板内容并同步顶栏。
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
                // 普通应用统一用 Ctrl+V：GTK4 已移除 Shift+Insert 的粘贴绑定，
                // 继续用 Shift+Insert 在 Nautilus、Text Editor、Ptyxis 等应用里不会触发粘贴
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
"""


# 备份原文件，返回备份路径；同名备份已存在时加序号。
def backup(path):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = f"{path}.bak-{stamp}"
    i = 1
    while os.path.exists(dest):
        dest = f"{path}.bak-{stamp}-{i}"
        i += 1
    shutil.copy2(path, dest)
    return dest


# 依次应用 (old, new) 替换，返回 (新文本, 实际改动数)；原文缺失且标记不在则抛错。
def apply_edits(path, edits, text):
    changed = 0
    for old, new, marker in edits:
        if marker in text:
            print(f"  跳过（已是修复版）：{path} :: {marker[:40]}")
            continue
        if old not in text:
            raise RuntimeError(f"{path} 中找不到预期代码，版本可能已变化：\n{old[:120]}")
        text = text.replace(old, new, 1)
        changed += 1
    return text, changed


def main():
    ext_dir = os.path.expanduser(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DIR
    ext_js = os.path.join(ext_dir, "extension.js")
    kb_js = os.path.join(ext_dir, "keyboard.js")

    for p in (ext_js, kb_js):
        if not os.path.isfile(p):
            sys.exit(f"找不到文件：{p}")

    total = 0

    # 1) extension.js 的两处条件 + #pasteItem 整函数
    with open(ext_js, encoding="utf-8") as f:
        src = f.read()
    original = src
    src, n = apply_edits(
        ext_js, [(o, nw, m) for fn, o, nw, m in EXTENSION_EDITS if fn == "extension.js"], src
    )
    total += n

    if "clipItemsRadioGroup.find(item => item.entry === entry)" not in src:
        pattern = re.compile(r"    #pasteItem \(menuItem\) \{.*?\n    \}\n", re.S)
        if not pattern.search(src):
            sys.exit("extension.js 中找不到 #pasteItem 函数，版本可能已变化，未写入。")
        src = pattern.sub(PASTE_ITEM_NEW, src, count=1)
        total += 1
    else:
        print("  跳过（已是修复版）：extension.js :: #pasteItem")

    # 光标处打开菜单的定位方法整块插入
    if "_repositionAtCursor (" in src:
        print("  跳过（已是修复版）：extension.js :: _repositionAtCursor")
    else:
        if CURSOR_MENU_METHODS_OLD not in src:
            sys.exit("extension.js 中找不到 _init 结尾，版本可能已变化，未写入。")
        src = src.replace(CURSOR_MENU_METHODS_OLD, CURSOR_MENU_METHODS_NEW, 1)
        total += 1

    if src != original:
        print(f"  备份：{backup(ext_js)}")
        with open(ext_js, "w", encoding="utf-8") as f:
            f.write(src)

    # 2) keyboard.js 的事件时间戳
    with open(kb_js, encoding="utf-8") as f:
        kb = f.read()
    kb_original = kb
    kb, n = apply_edits(
        kb_js, [(o, nw, m) for fn, o, nw, m in EXTENSION_EDITS if fn == "keyboard.js"], kb
    )
    total += n
    if kb != kb_original:
        print(f"  备份：{backup(kb_js)}")
        with open(kb_js, "w", encoding="utf-8") as f:
            f.write(kb)

    if total == 0:
        print("已全部是修复版，无需改动。")
    else:
        print(f"已应用 {total} 处改动。")

    print("现在注销并重新登录（Wayland 下扩展模块不会热重载），然后测试：")
    print("  1) 点非固定条目是否粘出该条内容；")
    print("  2) 快捷键在屏幕上部/中部/下部打开菜单，面板是否贴光标且整块留在屏幕内。")


if __name__ == "__main__":
    main()
