#!/usr/bin/env bash
# gnome-ext-dev — 在嵌套的 GNOME Shell 里开发扩展，改动源码即自动重启
#
# GNOME 45+ 的扩展是 ES module，disable/enable 不会重新加载代码；
# GNOME 49/50 又删掉了 Alt+F2 的 "r" 重启，所以改 JS 必须重启 shell 进程。
# 本脚本把 shell 跑在 mutter-devkit 的独立窗口里，真实桌面不受影响。
#
# 用法:
#   gnome-ext-dev.sh                        # UUID 取当前目录名
#   gnome-ext-dev.sh wifi-hotspot@local     # 指定 UUID
#   gnome-ext-dev.sh UUID /path/to/src      # 指定 UUID 和源码目录
#
# 依赖:
#   GNOME 50:  sudo dnf install mutter-devkit
#   GNOME <49: 无需额外软件，使用 --nested
#
# 日志就是本命令的 stdout/stderr，想存下来:
#   gnome-ext-dev.sh 2>&1 | tee /tmp/ext.log

set -u

UUID="${1:-}"
if [ -z "$UUID" ]; then
    # 优先读当前目录的 metadata.json，否则退回目录名
    if [ -f "$PWD/metadata.json" ]; then
        UUID=$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
            "$PWD/metadata.json" | head -n1)
    fi
    UUID="${UUID:-$(basename "$PWD")}"
fi
SRC="${2:-$HOME/.local/share/gnome-shell/extensions/$UUID}"

if [ ! -f "$SRC/metadata.json" ]; then
    echo "找不到 $SRC/metadata.json" >&2
    echo "请先把扩展放到或软链到 ~/.local/share/gnome-shell/extensions/$UUID" >&2
    exit 1
fi

# GNOME 49+ 用 --devkit（需要 mutter-devkit 提供查看器窗口）
if gnome-shell --help 2>&1 | grep -q -- '--devkit'; then
    if [ ! -x /usr/libexec/mutter-devkit ]; then
        echo "缺少 mutter-devkit，请先执行: sudo dnf install mutter-devkit" >&2
        exit 1
    fi
    dev_args=(--wayland --devkit)
else
    dev_args=(--nested --wayland)
fi

if command -v gnome-extensions >/dev/null &&
   ! gnome-extensions list --enabled 2>/dev/null | grep -qx "$UUID"; then
    echo "提示: $UUID 当前是禁用状态，嵌套 Shell 里也不会加载它" >&2
    echo "      先执行: gnome-extensions enable $UUID" >&2
fi

poll=0.5
runner=""
shellpid=""

snapshot() {
    find "$SRC" -type f -printf '%T@ %s %p\n' 2>/dev/null | sort
}

start_shell() {
    dbus-run-session -- gnome-shell "${dev_args[@]}" &
    runner=$!
    for _ in $(seq 1 100); do
        shellpid=$(pgrep -P "$runner" -x gnome-shell 2>/dev/null | head -n1)
        [ -n "$shellpid" ] && return 0
        sleep 0.1
    done
    echo "嵌套 Shell 启动失败" >&2
    return 1
}

stop_shell() {
    [ -n "$shellpid" ] && kill -TERM "$shellpid" 2>/dev/null
    [ -n "$shellpid" ] && wait "$shellpid" 2>/dev/null
    [ -n "$runner" ] && wait "$runner" 2>/dev/null
    shellpid=""
    runner=""
    # 清掉“崩溃后禁用扩展”标记，避免影响下次登录主会话
    rm -f "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/gnome-shell-disable-extensions"
}

cleanup() {
    stop_shell
    exit 0
}
trap cleanup INT TERM HUP

prev=$(snapshot)
start_shell || { stop_shell; exit 1; }
echo ">>> 嵌套 Shell 已启动 (UUID: $UUID)"
echo ">>> 修改 $SRC 下任意文件会自动重启；Ctrl-C 退出"

while :; do
    sleep "$poll"

    if ! kill -0 "$runner" 2>/dev/null; then
        echo ">>> 嵌套 Shell 已退出，重新启动"
        stop_shell
        start_shell || { stop_shell; exit 1; }
        prev=$(snapshot)
        continue
    fi

    cur=$(snapshot)
    if [ "$cur" != "$prev" ]; then
        # 编辑器可能连续写多次，等一下再重算一次
        sleep 0.3
        prev=$(snapshot)
        echo ">>> 检测到改动，重启嵌套 Shell"
        stop_shell
        start_shell || { stop_shell; exit 1; }
    fi
done
