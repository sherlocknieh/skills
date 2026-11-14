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
最后验证：2026-11-01，DING v102（EGO 自动更新后重打补丁 + 重新生成翻译）。

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
cp <本技能目录>/open-in-opencode.py ~/.local/share/nautilus-python/extensions/open-in-opencode.py
cp <本技能目录>/analyze-disk-usage.py ~/.local/share/nautilus-python/extensions/analyze-disk-usage.py
install -Dm755 <本技能目录>/opencode-webui ~/.local/bin/opencode-webui
```

> `analyze-disk-usage.py` 是同一机制的「分析磁盘占用」项：文件夹图标右键或文件夹内空白右键时，
> 以 `baobab <目录>` 打开 GNOME 磁盘占用分析器（多选文件夹会各开一个窗口）。

脚本内容见本目录 `open-in-vscode.py` / `open-in-opencode.py`。要点：
- 仅当所选全部为文件夹时显示，菜单标签「用 VSCode 打开」/「用 OpenCode 打开」。
- 文件夹图标右键 → 打开该文件夹；文件夹内空白右键 → 打开当前文件夹。
- 每次启动 Nautilus 时加载；改脚本后 `nautilus -q` 再打开文件管理器即可。
- OpenCode 项打开的是 **Web UI**：脚本 `~/.local/bin/opencode-webui` 确保后台服务在跑，
  用 `opencode api post /api/session` 在目标目录建会话，再以
  `http://<服务地址>/server/<base64url(服务地址)>/session/<会话 id>` 在浏览器打开该会话。
  同一脚本供 Nautilus 扩展与 DING 桌面右键复用。
- 装脚本：`install -Dm755 <本技能目录>/opencode-webui ~/.local/bin/opencode-webui`。

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

> 以下补丁代码以 **DING v102**（`shell-version: ["50","51"]`）为准。v102 的 `spawnCommandLine()`
> 先做 `shell_parse_argv` 再 `trySpawn`，**不经过 shell**，所以路径含空格时用 `shell_quote` 会出错；
> 统一改成直接拼 argv + `trySpawn()`。旧版（v99 及以前）用 `spawnCommandLine(\`code ...\`)` 也可以。

### 3.1 `app/fileItemMenu.js`

先加一个选区助手（放在 `_getExtractionSupportedTypes()` 之前即可）：

```js
    _selectedFolderPaths() {
        const selection = this._desktopManager.getCurrentSelection(false);
        if (!selection)
            return [];
        return selection
            .filter(item => item.isDirectory && item.uri.startsWith('file://'))
            .map(item => GLib.filename_from_uri(item.uri)[0])
            .filter(path => path !== null);
    }
```

然后在 `_addActions()` 中找到：

```js
this._addNewAction('open-with', null, this._doOpenWith.bind(this));
```

在其后插入两个 action：

```js
this._addNewAction('open-in-vscode', null, () => {
    DesktopIconsUtil.launchVSCode(this._selectedFolderPaths());
});

this._addNewAction('open-in-opencode', null, () => {
    for (const path of this._selectedFolderPaths())
        DesktopIconsUtil.launchOpencode(path);
});
```

在 `_createMenu()` 中，找到第一段「Open」块（v102 里变量名是 `addedElement`）：

```js
        if (!fileItem.isStackMarker) {
            this._newMenuElement(
                selectedItemsNum > 1 ? _('Open All...') : _('Open'),
                'open-selected-files',
                section
            );
            addedElement = true;
        }
```

在该块闭合 `}` 之后、`const keepStacked = Prefs.desktopSettings...` 之前插入：

```js
        const folderSelection = this._desktopManager.getCurrentSelection(false);
        if (folderSelection && (folderSelection.length > 0) &&
            folderSelection.every(item => item.isDirectory && item.uri.startsWith('file://'))) {
            this._newMenuElement('用 VSCode 打开', 'open-in-vscode', section);
            this._newMenuElement('用 OpenCode 打开', 'open-in-opencode', section);
            addedElement = true;
        }
```

### 3.2 `app/desktopMenu.js`

在 `_addActions()` 中，找到 `open-in-terminal-desktop` 的 action 定义，在其后插入：

```js
this._addNewAction('open-in-vscode-desktop', null, () => {
    DesktopIconsUtil.launchVSCode([this._desktopDir.get_path()]);
});
this._addNewAction('open-in-opencode-desktop', null, () => {
    DesktopIconsUtil.launchOpencode(this._desktopDir.get_path());
});
```

在 `_createDesktopBackgroundMenu()` 中，找到：

```js
this._newMenuElement(_('Open in Terminal'), "open-in-terminal-desktop", section);
```

其后插入：

```js
this._newMenuElement('用 VSCode 打开', "open-in-vscode-desktop", section);
this._newMenuElement('用 OpenCode 打开', "open-in-opencode-desktop", section);
```

### 3.3 OpenCode 项（Web UI）

OpenCode 右键项不启终端，而是调共享脚本 `~/.local/bin/opencode-webui <目录>`：
确保后台服务在跑 → 按目录建会话 → 浏览器打开 Web UI 会话深链。
Nautilus 扩展也调用同一脚本，两处行为一致。

先在 `app/desktopIconsUtil.js`（`launchTerminal()` 之后）加共享助手，供两个菜单文件调用：

```js
export function launchOpencode(workdir) {
    try {
        trySpawn(workdir, ['opencode-webui', workdir], null);
    } catch (err) {
        print(`Starting opencode-webui failed with ${err}`);
    }
}

// trySpawn() 带 SpawnFlags.SEARCH_PATH，DING 进程的 PATH 含 ~/.local/bin，可直接写脚本名。

export function launchVSCode(paths) {
    if (paths.length === 0)
        return;
    try {
        trySpawn(null, ['code', ...paths], null);
    } catch (err) {
        print(`Starting code failed with ${err}`);
    }
}
```

要点：
- `trySpawn()` 带 `SpawnFlags.SEARCH_PATH`，所以传 `'code'`/`'opencode'` 即可按 PATH 查找；
  DING 进程的 PATH 含 `~/.local/bin`（`opencode` 就在那里）。
- Fedora 上只有 `ptyxis`；`ptyxis -d <dir> -- <cmd>` 已实测可用（`--` 后面的参数即要执行的命令）。

`app/desktopMenu.js` 的 `_addActions()` 里加（见 3.2 已一并给出）：

```js
this._addNewAction('open-in-opencode-desktop', null, () => {
    DesktopIconsUtil.launchOpencode(this._desktopDir.get_path());
});
```

`app/fileItemMenu.js` 的 action 见 3.1（多选时每个文件夹各开一个终端）。

### 3.4 生效与校验

```bash
# 语法自检（node 可用时）
node --check ~/.local/share/gnome-shell/extensions/ding@rastersoft.com/app/fileItemMenu.js
node --check ~/.local/share/gnome-shell/extensions/ding@rastersoft.com/app/desktopMenu.js
node --check ~/.local/share/gnome-shell/extensions/ding@rastersoft.com/app/desktopIconsUtil.js

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

## 5. 修复 DING 桌面右键菜单「大部分不是中文」

现象：桌面空白/图标右键菜单里 `Paste / Select All / Undo / Redo / Arrange Icons /
Arrange By… / Show Desktop in Files / Change Background… / Desktop Icons Settings /
Display Settings / New Document / Keep Arranged… / Sort by …` 等仍是英文。

原因：DING 自带的 `locale/zh_CN/LC_MESSAGES/ding.mo` 不全（v99 与 v102 均如此）——`desktopMenu.js`
里用到的这些 `_()` 字符串在 `.mo` 中没有译文，gettext 回退成英文。`locale` 和 `LANG`
都正常，不是系统区域设置问题（可用 `gjs` + `bindtextdomain` 单测确认）。

修复：基于**已安装**的源码重新生成一份完整的 `zh_CN` 翻译并编译装回。
本技能目录 `ding-i18n/` 已存好成品（`zh_CN.po`、`ding.mo`、`reinstall.sh`）。

```bash
# 一键装回并热重启 DING
bash ~/.config/opencode/skills/system-fix/gnome-desktop-context-menus/ding-i18n/reinstall.sh
```

重新生成（若扩展升级导致字符串变化）：

```bash
EXT=~/.local/share/gnome-shell/extensions/ding@rastersoft.com
cd "$EXT"
xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ --keyword=gettext \
  --output=/tmp/ding.pot app/*.js *.js          # 提取本版本实际用到的 msgid
# 译文来源优先级：已装 .mo → 上游 master po/zh_CN.po（含 #~ obsolete 条目）→ 手工补
# 用本技能 ding-i18n/build.py 的思路合并后：
msgfmt -o /tmp/ding.mo /tmp/zh_CN.po && \
  install -m644 /tmp/ding.mo "$EXT/locale/zh_CN/LC_MESSAGES/ding.mo"
pkill -f '^gjs .*app/ding\.js'
```

要点：
- 上游 `master` 的 `po/zh_CN.po` 里这些串大多还在，只是被标成 `#~`(obsolete)，可直接复用。
- 注意 v99 及以后源码把占位符从 `${X}` 改成了 `{X}`（见 `fileItem.js`/`autoAr.js`），译文里也要用 `{X}`，否则匹配不上。
- 未译的还有：`Use sandboxing if available`、`Don't use sandboxing`、`GnomeDesktop-4.0 GIR …`，已在成品里补齐。
- v102 相比 v99 只多出 1 条新串：`Failed to set metadata::sandbox flag` → 「设置 metadata::sandbox 标志失败」，成品里已含。
- 校验是否还有漏译（`msgattrib --untranslated` 应只剩空 `msgid` 头）：

```bash
cd /tmp/opencode
xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ --keyword=gettext \
  --output=ding.pot "$HOME"/.local/share/gnome-shell/extensions/ding@rastersoft.com/app/*.js
msgunfmt "$HOME/.local/share/gnome-shell/extensions/ding@rastersoft.com/locale/zh_CN/LC_MESSAGES/ding.mo" -o installed.po
msgmerge -q installed.po ding.pot -o merged.po && msgattrib --untranslated --no-obsolete merged.po | grep '^msgid'
```
- **EGO 自动更新会覆盖 `ding.mo`**，更新后重跑 `reinstall.sh` 即可。
- `gettext` 有进程内缓存，改完必须重启 DING 进程才生效。

---

## 6. 文件清单 / 恢复

| 改动 | 位置 |
|---|---|
| DING 扩展 | `~/.local/share/gnome-shell/extensions/ding@rastersoft.com/` |
| Nautilus 扩展 | `~/.local/share/nautilus-python/extensions/open-in-vscode.py`、`open-in-opencode.py`、`analyze-disk-usage.py` |
| Web UI 启动脚本 | `~/.local/bin/opencode-webui`（Nautilus 与 DING 的 OpenCode 项共用） |
| DING 补丁 | 上述 `app/fileItemMenu.js`、`app/desktopMenu.js`、`app/desktopIconsUtil.js`（备份建议存 `/tmp/opencode/ding-backup/`） |
| DING 中文翻译 | `.../ding@rastersoft.com/locale/zh_CN/LC_MESSAGES/ding.mo`（成品在技能 `ding-i18n/`，原文件备份 `ding-i18n/ding.mo.orig.bak`） |
| 文本模板 | `~/模板/新建文本文件.txt` |

恢复：
- 去掉 Nautilus 项：`rm ~/.local/share/nautilus-python/extensions/open-in-{vscode,opencode}.py ~/.local/share/nautilus-python/extensions/analyze-disk-usage.py && nautilus -q`
- 去掉桌面 VSCode/OpenCode 项：还原 `fileItemMenu.js`/`desktopMenu.js`/`desktopIconsUtil.js` 备份，杀 DING 进程。
- 去掉文本模板：`rm ~/模板/新建文本文件.txt`
- 还原中文翻译：`cp .../ding-i18n/ding.mo.orig.bak <扩展>/locale/zh_CN/LC_MESSAGES/ding.mo`
- 彻底移除 DING：`gnome-extensions uninstall ding@rastersoft.com`，并从 `enabled-extensions` 移除该 uuid。

---

## 7. 扩展被 EGO 自动更新覆盖后的重打清单

EGO 会在后台静默把 DING 升到新版本（如 v99 → v102），**新装的文件会盖掉所有 JS 补丁和 `ding.mo`**。
Nautilus 扩展与文本模板在用户目录、不受影响。发现右键菜单里 VSCode/OpenCode 项消失时，按顺序做：

```bash
EXT=~/.local/share/gnome-shell/extensions/ding@rastersoft.com

# 1) 看版本
grep '"version"' "$EXT/metadata.json"

# 2) 备份当前（已被覆盖的）原文件，便于回滚
mkdir -p /tmp/opencode/ding-backup-$(date +%Y%m%d)
cp -a "$EXT"/app/{fileItemMenu,desktopMenu,desktopIconsUtil}.js /tmp/opencode/ding-backup-$(date +%Y%m%d)/

# 3) 确认锚点还在（版本升级后行号会变，但下列语句通常不变）
grep -n "open-with'\|keep-stacked')" "$EXT/app/fileItemMenu.js"
grep -n "open-in-terminal-desktop" "$EXT/app/desktopMenu.js"
grep -n "export function launchTerminal" "$EXT/app/desktopIconsUtil.js"

# 4) 按第 3 节重打补丁（注意 v102 用 trySpawn + argv，不要用 shell_quote）

# 5) 重装翻译并热重启
bash ~/.config/opencode/skills/system-fix/gnome-desktop-context-menus/ding-i18n/reinstall.sh

# 6) 校验
node --check "$EXT/app/fileItemMenu.js"
node --check "$EXT/app/desktopMenu.js"
node --check "$EXT/app/desktopIconsUtil.js"
journalctl --user -b --since "-2min" | grep -iE 'DING:.*(error|exception|traceback)'
```

提示：EGO 升级不等于 `shell-version` 变化，Wayland 下不必注销；改完 JS 杀掉 DING 进程即可热生效。
如果 `node --check` 通过、但菜单里没有新项，检查 `_createMenu()` 里 `addedElement` 有没有被后续代码重置。
