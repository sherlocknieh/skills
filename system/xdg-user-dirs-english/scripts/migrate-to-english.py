#!/usr/bin/env python3
"""把 XDG 用户目录从中文实体名迁移为英文，并修正引用旧路径的配置。

用法：
    migrate-to-english.py            # 预览，不改任何文件
    migrate-to-english.py --apply    # 执行改名与配置修补（每个被改文件留 .bak-时间戳）
    migrate-to-english.py --scan     # 只列出仍含旧中文路径的配置文件

设计要点：
- 幂等：已英文的映射跳过；中文与英文目录同时存在时跳过并告警，绝不自动合并。
- 顺序：先改名，再写映射，最后按新的目录名修补各应用配置。
- 只碰当前用户，不改 /etc/xdg/user-dirs.defaults。
"""

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse

HOME = os.path.expanduser("~")
STAMP = time.strftime("%Y%m%d-%H%M%S")

# 中文实体名 -> 英文实体名
PAIRS = {
    "桌面": "Desktop",
    "下载": "Downloads",
    "模板": "Templates",
    "公共": "Public",
    "文档": "Documents",
    "音乐": "Music",
    "图片": "Pictures",
    "视频": "Videos",
    "项目": "Projects",
}

USER_DIRS = os.path.join(HOME, ".config/user-dirs.dirs")
USER_DIRS_CONF = os.path.join(HOME, ".config/user-dirs.conf")

# 会被自动修补的文本配置（相对 $HOME 的 glob）
TEXT_TARGETS = [
    ".local/share/recently-used.xbel",
    ".config/mozilla/firefox/*/prefs.js",
    ".config/Code/User/globalStorage/storage.json",
    ".config/Code/User/workspaceStorage/*/workspace.json",
    ".config/flameshot/flameshot.ini",
    ".config/Android Open Source Project/Emulator.conf",
    ".config/google-chrome/*/Preferences",
    ".config/chromium/*/Preferences",
    ".config/libreoffice/4/user/registrymodifications.xcu",
    ".bashrc",
    ".bash_profile",
    ".zshrc",
    ".profile",
    ".gitconfig",
    ".config/systemd/user/*.service",
    ".config/systemd/user/*.timer",
    ".config/autostart/*.desktop",
    ".local/share/applications/*.desktop",
]

BOOKMARKS = os.path.join(HOME, ".config/gtk-3.0/bookmarks")


def expand(p):
    return os.path.join(HOME, p)


def read_text(path):
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        return f.read()


def write_text(path, data):
    with open(path, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(data)


def backup(path):
    dst = f"{path}.bak-{STAMP}"
    shutil.copy2(path, dst)
    return dst


def parse_user_dirs():
    """返回 [(XDG_KEY, 展开后的绝对路径, 原始值)]，保持原顺序。"""
    if not os.path.exists(USER_DIRS):
        return []
    entries = []
    for line in read_text(USER_DIRS).splitlines():
        m = re.match(r'\s*(XDG_[A-Z0-9]+_DIR)="([^"]*)"\s*$', line)
        if m:
            raw = m.group(2)
            entries.append((m.group(1), os.path.expandvars(raw), raw))
    return entries


def plan_renames(entries):
    """-> (renames, conflicts, missing)，元素为 (key, 中文名, 英文名)。"""
    renames, conflicts, missing = [], [], []
    for key, path, _raw in entries:
        if not path.startswith(HOME + "/"):
            continue
        rel = path[len(HOME) + 1:]
        if "/" in rel or rel not in PAIRS:
            continue
        zh, en = rel, PAIRS[rel]
        zh_path, en_path = expand(zh), expand(en)
        if os.path.isdir(en_path) and os.path.isdir(zh_path):
            conflicts.append((key, zh, en))
        elif os.path.isdir(zh_path):
            renames.append((key, zh, en))
        elif not os.path.isdir(en_path):
            missing.append((key, zh, en))
    return renames, conflicts, missing


def patch_variants():
    """旧路径前缀 -> 新路径前缀，长前缀优先。"""
    vs = []
    for zh, en in PAIRS.items():
        vs.append((f"{HOME}/{zh}", f"{HOME}/{en}"))
        vs.append((f"$HOME/{zh}", f"$HOME/{en}"))
        vs.append((f"~/{zh}", f"~/{en}"))
        vs.append((f"{HOME}/{urllib.parse.quote(zh)}", f"{HOME}/{en}"))
    return vs


VARIANTS = patch_variants()


def patch_text_files(apply):
    changed = []
    for pattern in TEXT_TARGETS:
        for path in glob.glob(expand(pattern)):
            if not os.path.isfile(path):
                continue
            try:
                data = read_text(path)
            except (OSError, UnicodeError):
                continue
            new = data
            for old, repl in VARIANTS:
                new = new.replace(old, repl)
            if new == data:
                continue
            changed.append(path)
            if apply:
                backup(path)
                write_text(path, new)
    return changed


def patch_bookmarks(apply):
    if not os.path.isfile(BOOKMARKS):
        return False
    lines = read_text(BOOKMARKS).splitlines()
    out, changed = [], False
    for line in lines:
        if not line.startswith("file://"):
            out.append(line)
            continue
        url, _, label = line.partition(" ")
        parsed = urllib.parse.urlparse(url)
        path = urllib.parse.unquote(parsed.path)
        new_path = path
        for zh, en in PAIRS.items():
            if new_path == f"{HOME}/{zh}" or new_path.startswith(f"{HOME}/{zh}/"):
                new_path = f"{HOME}/{en}" + new_path[len(f"{HOME}/{zh}"):]
                break
        if new_path != path:
            changed = True
            quoted = urllib.parse.quote(new_path, safe="/")
            url = urllib.parse.urlunparse(parsed._replace(path=quoted))
        out.append(url + (f" {label}" if label else ""))
    if changed and apply:
        backup(BOOKMARKS)
        write_text(BOOKMARKS, "\n".join(out) + "\n")
    return changed


def write_user_dirs(entries, renames, conflicts, apply):
    blocked = {zh for _, zh, _ in conflicts}
    body = []
    for key, path, raw in entries:
        rel = path[len(HOME) + 1:] if path.startswith(HOME + "/") else None
        if rel in PAIRS and rel not in blocked:
            # 目录不存在也改成英文映射，让应用按需创建英文目录；
            # 冲突项保持原值，避免把数据指向另一份目录。
            en = PAIRS[rel]
            value = f"$HOME/{en}" if raw.startswith("$HOME/") else f"{HOME}/{en}"
        else:
            value = raw
        body.append(f'{key}="{value}"')
    text = (
        "# 用户目录的物理名保持英文；Nautilus/GTK 侧栏标签仍按 locale 显示中文。\n"
        "# 由 xdg-user-dirs-english skill 生成，user-dirs.conf 已关闭自动更新。\n"
        + "\n".join(body)
        + "\n"
    )
    if apply and os.path.exists(USER_DIRS):
        backup(USER_DIRS)
    if apply:
        write_text(USER_DIRS, text)
    return text


def write_user_dirs_conf(apply):
    line = "enabled=False\n"
    cur = read_text(USER_DIRS_CONF) if os.path.exists(USER_DIRS_CONF) else ""
    if cur == line:
        return False
    if apply:
        if os.path.exists(USER_DIRS_CONF):
            backup(USER_DIRS_CONF)
        write_text(USER_DIRS_CONF, line)
    return True


def chinese_leftovers():
    return [d for d in PAIRS if os.path.isdir(expand(d))]


def scan():
    hits = []
    for pattern in TEXT_TARGETS + [".config/**/*.conf", ".config/**/*.ini"]:
        for path in glob.glob(expand(pattern), recursive=True):
            if not os.path.isfile(path):
                continue
            try:
                data = read_text(path)
            except (OSError, UnicodeError):
                continue
            if any(old in data for old, _ in VARIANTS):
                hits.append(path)
    return sorted(set(hits))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="执行改动")
    ap.add_argument("--scan", action="store_true", help="只扫描残留引用")
    args = ap.parse_args()

    if args.scan:
        hits = scan()
        print("\n".join(hits) if hits else "no references to old paths")
        return 0

    entries = parse_user_dirs()
    if not entries and not args.scan:
        print("没有找到 ~/.config/user-dirs.dirs，先运行一次 xdg-user-dirs-update", file=sys.stderr)
        return 1

    renames, conflicts, missing = plan_renames(entries)
    mode = "APPLY" if args.apply else "DRY-RUN"

    print(f"[{mode}] HOME={HOME}")
    if not renames:
        print("  目录：无需改名（已是英文或不存在）")
    for key, zh, en in renames:
        print(f"  rename {zh} -> {en}  ({key})")
    for key, zh, en in conflicts:
        print(f"  冲突：{zh} 与 {en} 同时存在，跳过（不自动合并）  ({key})")
    for key, zh, en in missing:
        print(f"  提示：{zh} 不存在，映射仍指向 {en}  ({key})")

    if args.apply:
        for key, zh, en in renames:
            os.rename(expand(zh), expand(en))

    write_user_dirs(entries, renames, conflicts, args.apply)
    conf_changed = write_user_dirs_conf(args.apply)
    print(f"  user-dirs.dirs：{'已更新' if args.apply else '将重写为英文映射'}")
    if conf_changed:
        print(f"  user-dirs.conf：{'已写入' if args.apply else '将写入'} enabled=False")

    patched = patch_text_files(args.apply)
    print(f"  修补配置：{len(patched)} 个文件")
    for p in patched:
        print(f"    {p}")
    if patch_bookmarks(args.apply):
        print("  修补 GTK 书签")

    leftovers = chinese_leftovers()
    blocked = {zh for _, zh, _ in conflicts}
    unexpected = [d for d in leftovers if d not in blocked]
    print(f"  中文目录残留：{leftovers or '无'}" + (f"（其中冲突项保留：{sorted(blocked)}）" if blocked else ""))

    if args.apply:
        subprocess.run(["xdg-user-dirs-update"], check=False)
        again = [d for d in chinese_leftovers() if d not in blocked]
        print(f"  再跑 xdg-user-dirs-update 后新增中文目录：{again or '无'}")
        if again:
            print("  警告：user-dirs.conf 未生效，检查是否有其他进程重建目录", file=sys.stderr)
            return 1
        if blocked:
            print("  注意：冲突目录需人工把内容合并进英文目录后手动删除")
        print("完成：重新登录一次让桌面图标与 shell 生效，并重启 Firefox/Chrome/VS Code")
    else:
        print("预览结束；加 --apply 执行")
    return 0


if __name__ == "__main__":
    sys.exit(main())
