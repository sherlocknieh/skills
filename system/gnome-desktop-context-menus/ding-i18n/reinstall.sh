#!/usr/bin/env bash
# 把补全后的 DING 简体中文翻译装回扩展并热重启 DING。
# 用法: bash reinstall.sh
set -e
DIR="$HOME/.local/share/gnome-shell/extensions/ding@rastersoft.com/locale/zh_CN/LC_MESSAGES"
[ -d "$DIR" ] || { echo "DING 未安装: $DIR 不存在" >&2; exit 1; }
install -m644 "$(dirname "$0")/ding.mo" "$DIR/ding.mo"
pkill -f '^gjs .*app/ding\.js' || true
sleep 3
pgrep -af '^gjs .*app/ding\.js' && echo "DING 已重启，翻译已生效"
