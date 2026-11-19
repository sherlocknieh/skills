#!/usr/bin/env bash
# 由 duckdns.service 以 root 调用。配置来自 /etc/duckdns/duckdns.conf：
#   DOMAIN=<子域名，不含 .duckdns.org>
#   TOKEN=<DuckDNS token>
# 公网 IP 必须经 tailscale netcheck 获取：本机 FlClash TUN 会把直连查询污染成代理出口。
set -euo pipefail

CONF=/etc/duckdns/duckdns.conf
. "$CONF"

IP=$(timeout 45 tailscale netcheck --format json 2>/dev/null \
     | python3 -c 'import sys,json;v=json.load(sys.stdin).get("GlobalV4") or "";print(v.split(":")[0])' 2>/dev/null || true)
if [ -z "${IP:-}" ]; then
  logger -t duckdns "cannot detect public IP, skip"
  echo "no-ip"
  exit 1
fi

RESPONSE=$(curl -fsS --max-time 20 \
  "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=${IP}&verbose=true" || echo "FAILED")
logger -t duckdns "ip=${IP} result=$(echo "$RESPONSE" | tr '\n' ' ')"
echo "ip=${IP} result=$(echo "$RESPONSE" | tr '\n' ' ')"
