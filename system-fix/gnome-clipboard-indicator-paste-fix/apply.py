#!/usr/bin/env python3
"""给 Clipboard Indicator 打补丁：修复点击条目粘不出来（置顶销毁菜单项、Shift+Insert、事件时间戳）。

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
]

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

    print("现在注销并重新登录（Wayland 下扩展模块不会热重载），然后测试点击非固定条目是否可粘贴。")


if __name__ == "__main__":
    main()
