---
name: xdg-user-dirs-english
description: 把 Linux 中文桌面真实存在的中文用户目录（桌面/文档/下载/音乐/图片/视频/模板/公共/项目）迁移成英文实体名（Desktop/Documents/Downloads…），保留文件管理器侧栏的本地化标签，并修正改名前写死的中文绝对路径。适用于用户反馈 `cd ~/Documents` 不存在、想让主目录统一英文、换 locale 后目录分裂成两套、脚本或备份工具找不到 `~/Downloads`。关键词：XDG user dirs、user-dirs.dirs、user-dirs.conf、xdg-user-dirs-update、中文目录、桌面、文档、下载、项目、改回英文、英文实体名、locale 分裂、桌面图标目录。
---

# XDG 用户目录改英文实体名

中文系统上 `~` 里的「桌面 / 文档 / 下载」是真目录名，不是显示名；切一次 locale 就会多出一整套英文目录。本 skill 把实体名统一成英文，并说清哪些“显示中文”的期待在 Linux 上做不到。

## 0. 先说清边界（决定用户是否还想要这件事）

- Linux 侧唯一的分层是 `~/.config/user-dirs.dirs` 这份**路径映射**，没有 Windows `desktop.ini` 那种“目录显示名”。所以：
  - 物理名可以是英文，Nautilus 侧栏/GTK 侧栏里那 7 个标准目录的**标签**仍显示中文（来自映射 + locale 翻译，与目录名无关）。
  - 地址栏、列表视图、终端里看到 `Documents`。
  - 非标准的 `Projects` 没有中文标签可显示。
- 结构上能拿到的收益：路径可盲打、脚本与备份工具默认路径可用、换 locale 不再分裂。

## 1. 调研

```bash
cat ~/.config/user-dirs.dirs
ls -F ~
df -h ~                      # 同一文件系统则 mv 瞬时完成，可放心改名
find ~/项目 -maxdepth 4 -name pyvenv.cfg   # 有 venv 就有绝对路径 shebang
```

再找引用中文绝对路径的配置（排除缓存与日志）：

```bash
cd ~ && grep -rIl --exclude-dir=.cache --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=.venv --exclude-dir=logs -e '/home/'$USER'/文档' -e '/home/'$USER'/项目' \
  -e '/home/'$USER'/桌面' -e '/home/'$USER'/下载' .config .local/share .bashrc .profile .gitconfig 2>/dev/null
```

**完成判据**：列出每个中文目录是否存在及大小、是否已存在同名英文目录（冲突必须人工决定，不能自动合并）、哪些应用写死了中文路径。

## 2. 迁移

```bash
python3 scripts/migrate-to-english.py            # 预览：改名清单、要补的文件
python3 scripts/migrate-to-english.py --apply    # 执行
```

脚本做四件事，全部幂等：

1. 按 `user-dirs.dirs` 里的映射把 `$HOME/<中文>` 改名为对应英文；目标已存在则跳过并告警。
2. 重写 `user-dirs.dirs`（保留 `$HOME/` 写法与自有键，如 `XDG_PROJECTS_DIR`），并为每个被改文件留 `.bak-<时间戳>`。目录不存在时也把映射写成英文，让应用按需创建英文目录；冲突项则保持原值，避免把数据指向另一份空目录。
3. 写 `~/.config/user-dirs.conf` 的 `enabled=False`，阻止登录时的 `xdg-user-dirs-update` 按 locale 重建中文目录。
4. 替换已知配置文件中的旧路径：GTK 书签、`recently-used.xbel`、Firefox `prefs.js`、VS Code `storage.json`/`workspaceStorage`、Flameshot、Android 模拟器、Chrome/Chromium `Preferences`、LibreOffice、shell rc、systemd user 单元、autostart 与 `.desktop`。

**完成判据**：输出 `renamed` 列表覆盖所有调研到的中文目录，`SKIP` 项均为已处理过的冲突；退出码为 0。

## 3. 收尾调研残留

```bash
python3 scripts/migrate-to-english.py --scan    # 列出仍含旧路径的文件，人工判断
```

按文件性质处理：日志与 `History/`、`chatSessions/` 等历史记录不必改；真正影响行为的是配置、脚本、书签、`.desktop` 的 `Path=`。

**完成判据**：`--scan` 剩余项都能一句话解释为什么不用改。

## 4. 验证

```bash
for k in DESKTOP DOCUMENTS DOWNLOAD MUSIC PICTURES VIDEOS TEMPLATES; do echo "$k $(xdg-user-dir $k)"; done
ls -d ~/桌面 ~/文档 ~/下载 ~/项目 2>/dev/null || echo "no Chinese dirs"
xdg-user-dirs-update && ls -d ~/文档 2>/dev/null || echo "update did not recreate"
```

**完成判据**：`xdg-user-dir` 全部指向英文路径；无中文目录残留；手动触发 `xdg-user-dirs-update` 后仍无中文目录、`user-dirs.dirs` 未被改写。

## 5. 生效

- 重新登录一次：GNOME 桌面图标（DING）与 shell 按新 `XDG_DESKTOP_DIR` 重新加载。
- 重启 Firefox / Chrome / VS Code / Flameshot 等：它们在启动时读取配置。
- `nautilus -q` 让文件管理器重读书签，下次打开即生效。

## 已知坑

- **venv 断链**：`Projects/**/.venv` 里的 shebang 是绝对路径。不留中文软链接就必须删掉重建 venv。
- **不留兼容链接的代价**：旧路径一律失效。若用户要求兼容，改成“改名 + 反向软链接”，并在 skill 第 2 步前确认；软链接会让文件管理器多出重复条目。
- **不要**跑 `xdg-user-dirs-update --force`，它会按 locale 覆盖回中文。
- **冲突不合并**：中文与英文目录同时存在时停下问用户，自动合并会把两份内容混在一起。
- **模板文件名**：`Templates/` 里的 `新建文本文件.txt` 等是文件名不是目录名，保留中文才符合“新建”菜单语义。
- **系统级默认**：`/etc/xdg/user-dirs.defaults` 仍可能被新用户账户使用；要影响所有新账户需改它，本 skill 只动当前用户。

## 回滚

```bash
# 按需恢复被改的配置
mv ~/Documents ~/文档   # 逐个改回
rm ~/.config/user-dirs.conf
cp ~/.config/user-dirs.dirs.bak-<时间戳> ~/.config/user-dirs.dirs
xdg-user-dirs-update
```

配置备份带时间戳，改名本身不丢数据；务必先 `mv` 回再恢复 `user-dirs.dirs`，顺序反了会让映射指向不存在的目录。
