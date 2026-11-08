#!/usr/bin/env bash
# 负责把本机当前局域网 IPv4 推到 DuckDNS 的内网专用子域，让手机在热点/家宽里用固定名字访问本机。
# 上游：NetworkManager 分派脚本 /etc/NetworkManager/dispatcher.d/90-duckdns 在 Wi-Fi 取得地址后调用。
# 下游：DuckDNS 更新 API；成功后把「子域 + 地址」记入 /var/lib/duckdns-lan/last-ip，同一地址不重复上报。
# 配置项来自 /etc/duckdns/duckdns.conf：DOMAIN（公网，勿覆盖）、LAN_DOMAIN（内网专供）、TOKEN。
set -uo pipefail

CONF=/etc/duckdns/duckdns.conf
# shellcheck disable=SC1090
. "$CONF"

IFACE=${1:-wlp0s20f3}
STATE_DIR=/var/lib/duckdns-lan
STATE="$STATE_DIR/last-ip"

# 没有配置内网专用子域就什么都不做，避免把公网记录覆盖成私有地址
if [ -z "${LAN_DOMAIN:-}" ]; then
  logger -t duckdns-lan "LAN_DOMAIN 未配置，跳过"
  exit 0
fi

# 内网子域和公网子域相同会互相覆盖，直接拒绝
if [ "${LAN_DOMAIN}" = "${DOMAIN:-}" ]; then
  logger -t duckdns-lan "LAN_DOMAIN 与 DOMAIN 相同(${LAN_DOMAIN})，拒绝更新以免覆盖公网记录"
  exit 1
fi

# 取该网卡的全局 IPv4（排除 169.254 链路本地地址）
IP=$(ip -4 -o addr show dev "$IFACE" scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1)
if [ -z "$IP" ]; then
  logger -t duckdns-lan "接口 ${IFACE} 当前没有 IPv4，跳过"
  exit 0
fi
case "$IP" in
  169.254.*)
    logger -t duckdns-lan "接口 ${IFACE} 只有链路本地地址，跳过"
    exit 0
    ;;
esac

# 子域或地址任一变化才请求 DuckDNS；只比 IP 会在换子域后永远跳过
install -d -m 755 "$STATE_DIR"
if [ "$(cat "$STATE" 2>/dev/null)" = "${LAN_DOMAIN} ${IP}" ]; then
  exit 0
fi

RESP=$(/usr/bin/curl -fsS --max-time 15 \
  "https://www.duckdns.org/update?domains=${LAN_DOMAIN}&token=${TOKEN}&ip=${IP}&verbose=true" || echo "FAILED")
logger -t duckdns-lan "domain=${LAN_DOMAIN} ip=${IP} result=$(printf '%s' "$RESP" | tr '\n' ' ')"

# 只有 DuckDNS 确认 OK 才记录，失败时下次事件会重试
case "$RESP" in
  OK*) printf '%s %s\n' "$LAN_DOMAIN" "$IP" > "$STATE" ;;
  *) exit 1 ;;
esac
