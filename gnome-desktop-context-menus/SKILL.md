---
name: gnome-desktop-context-menus
description: 在 Fedora（44+，GNOME/Wayland）上定制桌面与文件管理器的右键菜单：开启桌面图标(DING)、给 Nautilus 和桌面图标添加“用 VSCode 打开”、用系统模板添加“新建文本文件”。适用于用户要求“桌面显示文件/图标”、“文件夹右键用 VSCode 打开”、“给桌面图标加菜单”、“新建文本文件/新建文档”。关键词：桌面图标、DING、Desktop Icons NG、nautilus-python、右键菜单、用 VSCode 打开、新建文本文件、模板 Templates、extensions.gnome.org、GNOME 50、Fedora。
---

# Fedora GNOME 桌面/右键菜单定制

在 Fedora 44 + GNOME 50（Wayland）上完成的四项改动，可独立使用：

1. 开启桌面显示图标（安装并启用 DING）
2. Nautilus（文件管理器）文件夹右键「用 VSCode 打开」
3. DING 桌面图标/桌面空白右键「用 VSCode 打开」
4. 系统模板添加「新建文本文件」（Nautilus 与桌面通用）

验证环境：Fedora 44 Workstation，GNOME Shell 50.5，Wayland，用户 `who`，`code` 位于 `/usr/bin/code`。

> 通用前提：`SUDO_ASKPASS` 已配置（见全局 AGENTS.md），提权命令用 `sudo --askpass ...`。
> 所有改动基本都在用户目录，仅 DING 安装来自 EGO，nautilus-python 需 dnf 安装。

---

## 1. 开启桌面显示图标（DING）

Fedora 44 仓库**没有** `gnome-shell-extension-desktop-icons-ng` 包，需从 extensions.gnome.org 安装。
GNOME 50 对应 DING 版本 97（v97 的 `metadata.json` 中 `shell-version` 为 `["50"]`）。

查询与下载：

```bash
curl -s "https://extensions.gnome.org/extension-info/?uuid=ding@rastersoft.com&shell_version=50"
# 取返回 JSON 的 download_url / version_tag，然后：
curl -sL -o /tmp/opencode/ding.zip \
  "https://extensions.gnome.org/download-extension/ding@rastersoft.com.shell-extension.zip?version_tag=74891"
gnome-extensions install --force /tmp/opencode/ding.zip
```

启用（Wayland 下运行中的 Shell 不会重新扫描新目录，必须注销/重登）：

```bash
# 备份当前列表后追加 uuid
gsettings set org.gnome.shell enabled-extensions \
  "$(gsettings get org.gnome.shell enabled-extensions | sed "s/]$/, 'ding@rastersoft.com']/")"
gsettings set org.gnome.desktop.background show-desktop-icons true
```

说明：
- 安装路径：`~/.local/share/gnome-shell/extensions/ding@rastersoft.com/`
- Wayland 无法热重载 Shell；必须注销重登。`gnome-extensions enable` 在新装且未重登时会报“扩展不存在”。
- DING 的界面其实是一个**独立进程**：`gjs .../ding@rastersoft.com/app/ding.js -E -P .../app`。
  之后修改 DING 的 `app/*.js` 只需杀掉该进程，扩展会在 ~1s 内自动重启它（无需注销）。用
  `pkill -f '^gjs .*app/ding\.js'` 避免误杀自身 shell。

---

## 2. Nautilus 文件夹右键「用 VSCode 打开」

用 `nautilus-python` 扩展实现。Nautilus 50 的 typelib 是 `Nautilus-4.1`，API 为
`get_file_items(self, files)` / `get_background_items(self, current_folder)`（旧版多一个 window 参数；
用 `get_file_items(self, *args)` + `args[-1]` 可两者兼容）。

```bash
sudo --askpass dnf install -y nautilus-python
mkdir -p ~/.local/share/nautilus-python/extensions
cp <本技能目录>/open-in-vscode.py ~/.local/share/nautilus-python/extensions/open-in-vscode.py
```

脚本内容见本目录 `open-in-vscode.py`。要点：
- 仅当所选全部为文件夹时显示，菜单标签「用 VSCode 打开」。
- 文件夹图标右键 → 打开该文件夹；文件夹内空白右键 → 打开当前文件夹。
- 每次启动 Nautilus 时加载；改脚本后 `nautilus -q` 再打开文件管理器即可。

调试扩展是否加载（加载成功会打印）：

```bash
pkill -x nautilus
NAUTILUS_PYTHON_DEBUG=1 timeout 8 nautilus --gapplication-service 2>&1 | grep -iE 'nautilus-python|Loaded'
```

> 说明：DING 的桌面图标右键走的是另一套机制（见第 3 节），nautilus-python 不影响桌面。

---

## 3. DING 桌面右键「用 VSCode 打开」

DING 没有插件/菜单扩展 API，只能直接改它加载的 JS（`app/fileItemMenu.js`、`app/desktopMenu.js`）。
DING 是独立进程，改完杀进程即可热生效；但 **EGO 自动更新会覆盖补丁**，更新后需重打。
重打前先备份原文件（如 `/tmp/opencode/ding-backup/`）。

### 3.1 `app/fileItemMenu.js`

在构造函数里已有 `_scriptsMonitor`，无所谓。找到 `_addActions()` 中这一行：

```js
this._addNewAction('open-with', null, this._doOpenWith.bind(this));
```

在其后插入新 action：

```js
this._addNewAction('open-in-vscode', null, () => {
    const selection = this._desktopManager.getCurrentSelection(false);
    if (selection === null) {
        return;
    }
    const paths = selection
        .map(fileItem => fileItem.uri)
        .filter(uri => uri.startsWith('file://'))
        .map(uri => GLib.filename_from_uri(uri)[0])
        .filter(path => path !== null);
    if (paths.length !== 0) {
        DesktopIconsUtil.spawnCommandLine(`code ${paths.map(path => GLib.shell_quote(path)).join(' ')}`);
    }
});
```

在 `_createMenu()` 中，找到第一段「Open」块：

```js
        if (!fileItem.isStackMarker) {
            this._newMenuElement(
                selectedItemsNum > 1 ? _('Open All...') : _('Open'),
                "open-selected-files",
                section
            );
            added_element = true;
        }
```

在闭合 `}` 之后、`let keepStacked = ...` 之前插入：

```js
        const vscodeSelection = this._desktopManager.getCurrentSelection(false);
        if ((vscodeSelection !== null) &&
            vscodeSelection.every(item => item.isDirectory && item.uri.startsWith('file://'))) {
            this._newMenuElement('用 VSCode 打开', "open-in-vscode", section);
            added_element = true;
        }
```

### 3.2 `app/desktopMenu.js`

在 `_addActions()` 中，找到 `open-in-terminal-desktop` 的 action 定义，在其后插入：

```js
this._addNewAction('open-in-vscode-desktop', null, () => {
    DesktopIconsUtil.spawnCommandLine(`code ${GLib.shell_quote(this._desktopDir.get_path())}`);
});
```

在 `_createDesktopBackgroundMenu()` 中，找到：

```js
this._newMenuElement(_('Open in Terminal'), "open-in-terminal-desktop", section);
```

其后插入：

```js
this._newMenuElement('用 VSCode 打开', "open-in-vscode-desktop", section);
```

### 3.3 生效与校验

```bash
# 语法自检（node 可用时）
node --check ~/.local/share/gnome-shell/extensions/ding@rastersoft.com/app/fileItemMenu.js
node --check ~/.local/share/gnome-shell/extensions/ding@rastersoft.com/app/desktopMenu.js

# 热重启 DING 桌面进程（^gjs 锚定，避免误杀自身）
pkill -f '^gjs .*app/ding\.js'
sleep 3; pgrep -af '^gjs .*app/ding\.js'

# 确认无异常（崩溃会反复重启、journal 里会有 DING 异常）
journalctl --user -b --since "-2min" | grep -iE 'DING:.*(error|exception|traceback)'
```

---

## 4. 用系统模板添加「新建文本文件」

最原生、对 Nautilus 与 DING 都生效的方式：在 XDG 模板目录放一个空的模板文件。

```bash
TEMPLATES="$(xdg-user-dir TEMPLATES)"     # 中文环境为 ~/模板
touch "$TEMPLATES/新建文本文件.txt"
```

效果：桌面空白右键 / Nautilus 空白右键 →「新建文档」子菜单 →「新建文本文件」。
- DING 用 `HIDE_EXTENSIONS` 显示，故显示为「新建文本文件」（无 `.txt` 后缀），但新建出的文件带 `.txt`。
- DING 监听模板目录，实时生效；Nautilus 下次打开菜单即见。
- 想改显示名就重命名该模板文件；要新增别的类型（如 `.md`、`.sh`）也放这里。

> DING 读模板目录的实现：`app/desktopIconsUtil.js:getTemplatesDir()` → `GLib.get_user_special_dir(DIRECTORY_TEMPLATES)`。

---

## 5. 文件清单 / 恢复

| 改动 | 位置 |
|---|---|
| DING 扩展 | `~/.local/share/gnome-shell/extensions/ding@rastersoft.com/` |
| Nautilus 扩展 | `~/.local/share/nautilus-python/extensions/open-in-vscode.py` |
| DING 补丁 | 上述 `app/fileItemMenu.js`、`app/desktopMenu.js`（备份建议存 `/tmp/opencode/ding-backup/`） |
| 文本模板 | `~/模板/新建文本文件.txt` |

恢复：
- 去掉 Nautilus 项：`rm ~/.local/share/nautilus-python/extensions/open-in-vscode.py && nautilus -q`
- 去掉桌面 VSCode 项：还原 `fileItemMenu.js`/`desktopMenu.js` 备份，杀 DING 进程。
- 去掉文本模板：`rm ~/模板/新建文本文件.txt`
- 彻底移除 DING：`gnome-extensions uninstall ding@rastersoft.com`，并从 `enabled-extensions` 移除该 uuid。
