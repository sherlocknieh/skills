#!/usr/bin/env bash
set -euo pipefail

UPLINK_IF="${WIFI_HOTSPOT_UPLINK:-wlp0s20f3}"
AP_IF="${WIFI_HOTSPOT_IFACE:-ap0}"
CONF="/etc/wifi-hotspot.conf"
RUNDIR="/run/wifi-hotspot"
GW="10.42.0.1"

DEF_SSID="FedoraShare"
DEF_PASS="12345678"

if [[ $EUID -ne 0 ]]; then
	exec sudo -- "$0" "$@"
fi

load_conf() {
	local s="$DEF_SSID" p="$DEF_PASS"
	SSID=""
	PASSWORD=""
	if [[ -r "$CONF" ]]; then
		# shellcheck disable=SC1090
		. "$CONF"
		s="${SSID:-$s}"
		p="${PASSWORD:-$p}"
	fi
	SSID="${WIFI_HOTSPOT_SSID:-$s}"
	PASS="${WIFI_HOTSPOT_PASS:-$p}"
}

sta_channel() {
	iw dev "$UPLINK_IF" info 2>/dev/null |
		awk '/channel/{for(i=1;i<=NF;i++) if($i=="channel"){print $(i+1); exit}}'
}

start() {
	load_conf
	local ch mode
	ch=$(sta_channel)
	if [[ -z "$ch" ]]; then
		echo "错误：$UPLINK_IF 未连接到任何 WiFi，无法确定热点信道" >&2
		exit 1
	fi
	if (( ch <= 14 )); then mode=g; else mode=a; fi

	mkdir -p "$RUNDIR"
	stop >/dev/null 2>&1 || true

	iw dev "$AP_IF" del 2>/dev/null || true
	iw dev "$UPLINK_IF" interface add "$AP_IF" type __ap

	cat >"$RUNDIR/hostapd.conf" <<EOF
interface=$AP_IF
driver=nl80211
ssid=$SSID
hw_mode=$mode
channel=$ch
ieee80211n=1
wpa=2
wpa_passphrase=$PASS
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
EOF

	hostapd -B -P "$RUNDIR/hostapd.pid" "$RUNDIR/hostapd.conf"
	sleep 1

	ip addr add "$GW/24" dev "$AP_IF" 2>/dev/null || true
	ip link set "$AP_IF" up

	dnsmasq --conf-file=/dev/null \
		--pid-file="$RUNDIR/dnsmasq.pid" \
		--interface="$AP_IF" --bind-interfaces \
		--dhcp-range=10.42.0.10,10.42.0.254,12h \
		--dhcp-option=option:router,"$GW" \
		--dhcp-option=option:dns-server,"$GW" \
		--dhcp-option-force=43,ANDROID_METERED

	sysctl -qw net.ipv4.ip_forward=1
	nft add table inet wifi_hotspot 2>/dev/null || true
	nft flush table inet wifi_hotspot
	nft add chain inet wifi_hotspot postrouting '{ type nat hook postrouting priority srcnat; }'
	nft add rule inet wifi_hotspot postrouting ip saddr 10.42.0.0/24 ip daddr != 10.42.0.0/24 masquerade
	nft add chain inet wifi_hotspot forward '{ type filter hook forward priority filter; }'
	nft add rule inet wifi_hotspot forward iifname "$AP_IF" accept
	nft add rule inet wifi_hotspot forward oifname "$AP_IF" ct state established,related accept

	echo "热点已启动: SSID=$SSID 密码=$PASS 信道=$ch 网关=$GW (上行=$UPLINK_IF)"
}

stop() {
	if [[ -f "$RUNDIR/dnsmasq.pid" ]]; then
		kill "$(cat "$RUNDIR/dnsmasq.pid")" 2>/dev/null || true
		rm -f "$RUNDIR/dnsmasq.pid"
	fi
	if [[ -f "$RUNDIR/hostapd.pid" ]]; then
		kill "$(cat "$RUNDIR/hostapd.pid")" 2>/dev/null || true
		rm -f "$RUNDIR/hostapd.pid"
	fi
	nft delete table inet wifi_hotspot 2>/dev/null || true
	iw dev "$AP_IF" del 2>/dev/null || true
	echo "热点已停止（$UPLINK_IF 的 WiFi 连接保持不变）"
}

get_config() {
	load_conf
	printf '%s\n%s\n' "$SSID" "$PASS"
}

set_config() {
	local ssid="$1" pass="$2"
	if [[ -z "$ssid" ]]; then
		echo "错误：SSID 不能为空" >&2
		exit 1
	fi
	if [[ ${#pass} -lt 8 ]]; then
		echo "错误：密码至少 8 位" >&2
		exit 1
	fi
	umask 077
	printf 'SSID=%q\nPASSWORD=%q\n' "$ssid" "$pass" >"$CONF"
	chmod 600 "$CONF"
	echo "已保存：SSID=$ssid"
	if [[ -d "/sys/class/net/$AP_IF" ]]; then
		start >/dev/null
		echo "热点已按新配置重启"
	fi
}

status() {
	nmcli -f DEVICE,STATE,CONNECTION device status | grep -E "$UPLINK_IF|$AP_IF" || true
	if [[ -f "$RUNDIR/hostapd.pid" ]] && kill -0 "$(cat "$RUNDIR/hostapd.pid")" 2>/dev/null; then
		echo "hostapd: 运行中"
	else
		echo "hostapd: 未运行"
	fi
}

case "${1:-start}" in
start | on) start ;;
stop | off) stop ;;
status) status ;;
get-config) get_config ;;
set-config) set_config "${2:-}" "${3:-}" ;;
*)
	echo "用法: $0 {start|stop|status|get-config|set-config <ssid> <password>}" >&2
	exit 2
	;;
esac
