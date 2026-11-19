#!/usr/bin/env bash
# Fedora 远程桌面体检：接入层 / 锁屏层 / 外网层。
# 只读，不需要 root；读不到系统日志时降级为 WARN。
set -uo pipefail

DOMAIN="${RDP_DOMAIN:-sherlocknieh.duckdns.org}"
EXT="${RDP_EXT:-allowlockedremotedesktop@kamens.us}"
PORT="${RDP_PORT:-3389}"
FAILED=0

if [ -t 1 ]; then
  R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; N=$'\e[0m'
else
  R=; G=; Y=; B=; N=
fi

ok()   { printf '  %sOK%s   %s\n' "$G" "$N" "$1"; }
bad()  { printf '  %sFAIL%s %s\n' "$R" "$N" "$1"; FAILED=$((FAILED + 1)); }
warn() { printf '  %sWARN%s %s\n' "$Y" "$N" "$1"; }
info() { printf '       %s\n' "$1"; }
sec()  { printf '\n%s%s%s\n' "$B" "$1" "$N"; }

sec "1. 接入层：gnome-remote-desktop"

if systemctl --user is-active --quiet gnome-remote-desktop.service; then
  ok "服务 active"
else
  bad "服务未运行：systemctl --user start gnome-remote-desktop.service"
fi

if systemctl --user is-enabled --quiet gnome-remote-desktop.service; then
  ok "服务 enabled（开机自启）"
else
  warn "服务未 enabled：systemctl --user enable gnome-remote-desktop.service"
fi

listeners=$(ss -H -ltn "sport = :$PORT" 2>/dev/null)
if [ -n "$listeners" ]; then
  ok "端口 $PORT 正在监听"
else
  bad "端口 $PORT 未监听"
fi

if command -v grdctl >/dev/null 2>&1; then
  st=$(grdctl status 2>/dev/null)
  rdp_block=$(printf '%s\n' "$st" | sed -n '/^RDP:/,/^VNC:/p')
  case "$rdp_block" in
    *"Status: enabled"*) ok "RDP 已启用" ;;
    *) bad "RDP 未启用：grdctl rdp enable" ;;
  esac
  printf '%s\n' "$rdp_block" \
    | grep -E 'Port:|Authentication methods:|View-only:|Negotiate port:|TLS fingerprint:' \
    | sed 's/^[[:space:]]*/       /'
else
  bad "缺少 grdctl（gnome-remote-desktop 未安装）"
fi

crt="$HOME/.local/share/gnome-remote-desktop/tls.crt"
if [ -r "$crt" ]; then
  if openssl x509 -in "$crt" -noout -checkend $((30 * 86400)) >/dev/null 2>&1; then
    ok "TLS 证书 30 天内不过期（$(openssl x509 -in "$crt" -noout -enddate 2>/dev/null | cut -d= -f2)）"
  else
    warn "TLS 证书已过期或 30 天内过期，重建证书后重启 grd"
  fi
else
  bad "TLS 证书不可读：$crt"
fi

sec "1b. 登录界面层：系统级 remote login"

if systemctl is-enabled --quiet gnome-remote-desktop.service 2>/dev/null; then
  ok "系统单元 enabled（无人登录也可连）"
  if systemctl is-active --quiet gnome-remote-desktop.service; then
    ok "系统单元 active"
  else
    bad "系统单元未运行：sudo systemctl start gnome-remote-desktop.service"
  fi
  if [ -n "$(ss -H -ltn 'sport = :33890' 2>/dev/null)" ]; then
    ok "端口 33890 正在监听（连上先到 GDM 登录界面）"
  else
    bad "端口 33890 未监听：sudo grdctl --system status 看配置"
  fi
  if [ "$(id -u)" -eq 0 ] && command -v grdctl >/dev/null 2>&1; then
    grdctl --system status 2>/dev/null | sed -n '/^RDP:/,/^VNC:/p' \
      | grep -E 'Status:|Port:|TLS fingerprint:' | sed 's/^[[:space:]]*/       /'
  else
    info "以 root 运行可看到系统级 grdctl --system status 明细"
  fi
else
  warn "系统级 remote login 未启用：登出/重启后只有 3389 无监听（见 rebuild 1.1）"
fi

sec "2. 锁屏层：allow locked remote desktop"

enabled_exts=$(gnome-extensions list --enabled 2>/dev/null)
ext_hits=$(printf '%s\n' "$enabled_exts" | grep -c -x -F "$EXT" || true)
if [ "$ext_hits" -gt 0 ]; then
  ok "扩展已启用：$EXT"
else
  bad "扩展未启用：gnome-extensions enable $EXT"
fi

lock_hits=$(journalctl --user -b --no-pager 2>/dev/null \
  | grep -c "Remote desktop connections while screen is locked are now ENABLED" || true)
if [ "$lock_hits" -gt 0 ]; then
  ok "本次启动的 Shell 已加载扩展（日志确认）"
else
  bad "本次 Shell 未加载扩展 → 注销重登后复查"
fi

lock=$(gsettings get org.gnome.desktop.screensaver lock-enabled 2>/dev/null)
idle=$(gsettings get org.gnome.desktop.session idle-delay 2>/dev/null | awk '{print $2}')
ldelay=$(gsettings get org.gnome.desktop.screensaver lock-delay 2>/dev/null | awk '{print $2}')
info "锁屏=$lock  idle-delay=${idle:-?}s  lock-delay=${ldelay:-?}s"

while read -r sid _uid user _rest; do
  [ "$user" = "$USER" ] || continue
  ty=$(loginctl show-session "$sid" -p Type --value 2>/dev/null)
  case "$ty" in
    wayland|x11)
      lh=$(loginctl show-session "$sid" -p LockedHint --value 2>/dev/null)
      info "图形会话 $sid type=$ty LockedHint=$lh"
      ;;
  esac
done < <(loginctl list-sessions --no-legend 2>/dev/null)

sec "3. 外网层：DuckDNS + 动态 IP"

if systemctl is-active --quiet duckdns.timer 2>/dev/null; then
  ok "duckdns.timer active"
else
  bad "duckdns.timer 未运行：systemctl status duckdns.timer"
fi

next=$(systemctl list-timers duckdns.timer --no-legend 2>/dev/null | awk 'NF {print $1" "$2" "$3; exit}')
[ -n "$next" ] && info "下次触发：$next"

# 解锁即刷新：用户级监听服务。挂了只影响“立即”，定时器仍会兜底，所以记 WARN。
if systemctl --user is-active --quiet duckdns-unlock.service 2>/dev/null; then
  ok "duckdns-unlock.service active（解锁即刷新）"
else
  warn "duckdns-unlock.service 未运行：解锁后要等定时器（systemctl --user status duckdns-unlock.service）"
fi

last=$(journalctl -u duckdns.service -n 40 --no-pager 2>/dev/null | grep -o 'ip=.*' | tail -1)
if [ -n "$last" ]; then
  info "最近一次：$last"
  if printf '%s' "$last" | grep -q 'result=OK'; then
    ok "DuckDNS 更新成功"
  else
    bad "DuckDNS 最近一次更新失败：journalctl -u duckdns.service -n 20"
  fi
else
  warn "读不到 duckdns 日志（可能需要 sudo）"
fi

pub=$(timeout 45 tailscale netcheck --format json 2>/dev/null \
  | python3 -c 'import sys,json;v=json.load(sys.stdin).get("GlobalV4") or "";print(v.split(":")[0])' 2>/dev/null)
if [ -n "$pub" ]; then
  ok "当前公网 IP：$pub"
else
  warn "取不到公网 IP（Tailscale 未连接或 netcheck 超时）"
fi

doh=$(curl -fsS --max-time 10 \
  "https://dns.alidns.com/resolve?name=${DOMAIN}&type=A" 2>/dev/null \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(" ".join(a["data"] for a in d.get("Answer",[]) if a.get("type")==1))' 2>/dev/null)
if [ -n "$doh" ]; then
  info "AliDNS DoH 解析：$doh"
  if [ -n "$pub" ]; then
    if [[ " $doh " == *" $pub "* ]]; then
      ok "$DOMAIN 解析与公网 IP 一致"
    else
      warn "解析与公网 IP 不一致（DuckDNS 最长 5 分钟延迟；或 IP 刚变）"
    fi
  fi
else
  warn "DoH 查询失败，无法判断外网解析"
fi

local_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
if [ -n "$local_ip" ] && [ -n "$pub" ] && [ "$local_ip" != "$pub" ]; then
  info "本机解析为 $local_ip（FlClash Fake-IP 属正常，勿据此判断）"
fi

ts=$(tailscale ip -4 2>/dev/null | head -1)
if [ -n "$ts" ]; then
  ok "Tailscale 地址：$ts"
else
  warn "Tailscale 未连接"
fi

sec "4. 热点内网：局域网固定名字（可选层）"

LAN_DOMAIN="${RDP_LAN_DOMAIN:-localhotspot.duckdns.org}"
if [ -x /etc/NetworkManager/dispatcher.d/90-duckdns ]; then
  ok "NetworkManager 分派脚本已安装"
else
  warn "分派脚本缺失：网络变化不会自动刷新内网记录（见 rebuild 6.1）"
fi

wlan_if=$(nmcli -g GENERAL.DEVICE,GENERAL.TYPE device status 2>/dev/null \
  | awk -F: '$2=="wifi"{print $1; exit}')
[ -n "${wlan_if:-}" ] || wlan_if=wlp0s20f3
lan_ip=$(ip -4 -o addr show dev "$wlan_if" scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)
if [ -n "$lan_ip" ]; then
  lan_doh=$(curl -fsS --max-time 10 \
    "https://dns.alidns.com/resolve?name=${LAN_DOMAIN}&type=A" 2>/dev/null \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print(" ".join(a["data"] for a in d.get("Answer",[]) if a.get("type")==1))' 2>/dev/null)
  info "本机局域网：$lan_ip"
  info "$LAN_DOMAIN → ${lan_doh:-查询失败}"
  if [ "$lan_doh" = "$lan_ip" ]; then
    ok "内网名字指向本机"
  else
    warn "内网名字未指向本机（TTL 60s；或看 journalctl -t duckdns-lan）"
  fi
else
  warn "无线网卡 $wlan_if 没有 IPv4"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  printf '%s体检通过%s\n' "$G" "$N"
else
  printf '%s%d 项失败%s\n' "$R" "$FAILED" "$N"
fi
exit $((FAILED > 0))
