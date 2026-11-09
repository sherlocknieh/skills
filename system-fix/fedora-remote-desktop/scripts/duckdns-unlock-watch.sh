#!/usr/bin/env bash
# 目的：GNOME 解锁的瞬间立刻刷新 DuckDNS 公网记录，避免锁屏期间 IP 变化后要等最长 5 分钟的定时器。
# 上游：由 ~/.config/systemd/user/duckdns-unlock.service 常驻拉起（挂在 gnome-session.target）。
# 下游：检出 ActiveChanged(false) 后调用 sudo -n /usr/local/bin/duckdns-update.sh；
#       放行规则在 /etc/sudoers.d/duckdns-unlock，结果用 logger -t duckdns-unlock 记录。
set -uo pipefail

# 从 systemd --user 启动时未必带总线地址，按当前 uid 兜底一次。
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"

# gnome-shell 在锁屏状态变化时发出 ActiveChanged(bool)；stdbuf 强制行缓冲，
# 否则管道里的信号会被攒到 4KB 才处理，解锁后要等很久才触发。
stdbuf -oL -eL gdbus monitor --session \
  --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver |
while IFS= read -r line; do
  case "$line" in
    *"ActiveChanged (false,"*)
      # 解锁后网络可能还没就绪（尤其刚唤醒），最多重试 3 次，每次间隔 5 秒。
      for attempt in 1 2 3; do
        if out=$(sudo -n /usr/local/bin/duckdns-update.sh 2>&1); then
          logger -t duckdns-unlock "unlock: $out"
          break
        fi
        logger -t duckdns-unlock "unlock attempt ${attempt} failed: ${out}"
        sleep 5
      done
      ;;
  esac
done
