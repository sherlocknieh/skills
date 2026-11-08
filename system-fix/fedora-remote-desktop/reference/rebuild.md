# 重建与回滚

按顺序搭：接入层 → 锁屏层 → 外网层。每步给出完成标准，全部通过再进下一步。

需要 root 时用 `sudo -A`。

## 0. 前置

- Fedora 44+、GNOME 50、Wayland。Fedora 44 已无 GNOME Xorg 会话。
- 本机必须已有图形登录会话；grd 是“远程协助”模式，不覆盖重启后的登录界面。
- 用户名 `who`、局域网 IP `192.168.66.240`、路由器 `192.168.66.1` 按实际环境替换。

## 1. 接入层：GNOME RDP

```bash
# 证书目录与自签证书（10 年）
mkdir -p ~/.local/share/gnome-remote-desktop
chmod 700 ~/.local/share/gnome-remote-desktop
openssl req -x509 -newkey rsa:4096 -nodes -days 3650 \
  -subj "/CN=who-fedora-rdp" \
  -keyout ~/.local/share/gnome-remote-desktop/tls.key \
  -out ~/.local/share/gnome-remote-desktop/tls.crt
chmod 600 ~/.local/share/gnome-remote-desktop/tls.key

# 凭据（RDP 层专用，与系统登录密码无关）
grdctl rdp set-credentials who '<RDP密码>'

# 启用并常驻
grdctl rdp enable
systemctl --user enable --now gnome-remote-desktop.service
```

改过证书后必须 `systemctl --user restart gnome-remote-desktop.service`，grd 只在启动时读证书。

**完成标准**：

```bash
grdctl status | sed -n '/^RDP:/,/^VNC:/p'   # Status: enabled / Port: 3389
ss -H -ltn 'sport = :3389'                  # 有 LISTEN
xfreerdp /v:127.0.0.1:3389 /u:who /p:'<RDP密码>' /cert:ignore +auth-only
echo $?                                     # 0
```

`+auth-only` 只验证认证，不建立桌面会话，适合本机自测。

## 2. 锁屏层：Allow Locked Remote Desktop

为什么需要：GNOME 锁屏会调用 mutter 的
`meta_remote_access_controller_inhibit_remote_access()`，主动终止所有远程会话。
扩展把该函数替换为空函数，并把 `session-modes` 设为 `["unlock-dialog", "user"]`，
锁屏界面同样生效。

安装（二选一）：

1. 浏览器打开 extensions.gnome.org，搜索 **Allow Locked Remote Desktop**，安装。
2. 命令行装 zip：

```bash
gnome-extensions install --force allowlockedremotedesktop@kamens.us.shell-extension.zip
```

启用：

```bash
gnome-extensions enable allowlockedremotedesktop@kamens.us
```

**关键步骤：注销后重新登录。** GNOME Shell 只在启动时扫描扩展；Wayland 下不能原地重启
Shell，`Alt+F2` 输入 `r` 也无效。中途安装而不重登，扩展不会生效。

**完成标准**（三条都满足）：

```bash
gnome-extensions list --enabled | grep -qx allowlockedremotedesktop@kamens.us
journalctl --user -b | grep "Remote desktop connections while screen is locked are now ENABLED"
```

第三条是实测：保持一个 RDP 连接，然后

```bash
loginctl lock-session
sleep 10
loginctl show-session "$XDG_SESSION_ID" -p LockedHint   # yes
```

10 秒后客户端仍在线、画面还在，即通过。`LockedHint` 之后应能正常变回 `no`。

## 3. 锁屏策略

```bash
gsettings set org.gnome.desktop.screensaver lock-enabled true
gsettings set org.gnome.desktop.session idle-delay 900   # 15 分钟
gsettings set org.gnome.desktop.screensaver lock-delay 0 # 息屏即锁
```

`idle-delay` 同时驱动息屏和锁屏。若锁屏后 RDP 黑屏，见
[`troubleshooting.md`](troubleshooting.md) 的黑屏一节，这里不要盲目改成 0。

## 4. 主机防火墙

```bash
sudo firewall-cmd --permanent --add-port=3389/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

本机历史上放行过 `1025-65535/tcp`；若没有其他服务依赖这个大范围，收窄到 3389 更安全。

## 5. 路由器端口转发（外网直连）

LuCI：`http://192.168.66.1` → **防火墙 → 端口转发**（标准路径
`/cgi-bin/luci/admin/network/firewall/forwards`）。

| 字段 | 值 |
|---|---|
| 名称 | `rdp-54389` |
| 协议 | TCP |
| 外部区域 / 端口 | `wan` / `54389` |
| 内部区域 / IP / 端口 | `lan` / `192.168.66.240` / `3389` |

**完成标准**：手机关 Wi-Fi 用流量，执行

```bash
xfreerdp /v:sherlocknieh.duckdns.org:54389 /u:who /p:'<RDP密码>' /cert:ignore +auth-only
```

退出码 0。若在局域网内测公网域名失败，先排除路由器不支持 hairpin NAT：局域网直接用
`192.168.66.240:3389` 测。

## 6. DuckDNS 动态域名

前提：DuckDNS 账号下已有子域名与 token；免费域名至少每 30 天登录一次，否则被回收。

配置与脚本：

```bash
sudo install -d -m 700 /etc/duckdns
sudo sh -c 'umask 077; printf "DOMAIN=%s\nTOKEN=%s\n" "sherlocknieh" "<TOKEN>" > /etc/duckdns/duckdns.conf'

sudo install -m 755 <本技能目录>/scripts/duckdns-update.sh /usr/local/bin/duckdns-update.sh
sudo restorecon /usr/local/bin/duckdns-update.sh
```

`DOMAIN` 只写子域名，不含 `.duckdns.org`。

systemd 单元 `/etc/systemd/system/duckdns.service`：

```ini
[Unit]
Description=DuckDNS dynamic DNS update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/duckdns-update.sh
```

`/etc/systemd/system/duckdns.timer`：

```ini
[Unit]
Description=Run DuckDNS update every 5 minutes

[Timer]
OnBootSec=30s
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now duckdns.timer
sudo systemctl start duckdns.service
```

**为什么不用 `curl ifconfig.me`**：本机 FlClash 是 TUN 模式，所有直连都被代理，查到的
是代理出口 IP（曾误写成 `54.179.210.157`）。Tailscale 用 fwmark 绕过 TUN，所以从
`tailscale netcheck` 的 `GlobalV4` 取真实公网 IP。

**完成标准**：

```bash
journalctl -u duckdns.service -n 5
# 期望：ip=<公网IP> result=OK <公网IP>  UPDATED/NOCHANGE

curl -fsS 'https://dns.alidns.com/resolve?name=sherlocknieh.duckdns.org&type=A'
# Answer 里的 data 应等于上面的公网 IP
```

### 6.1 热点内网的固定名字

手机开热点、电脑连热点时，Android 每次开启会随机一个 `/24` 网段（实测出现过
`192.168.107/207/235/240.x`），网关随之变成 `X.237`；只有主机段按 MAC 固定为 `.108`。
所以**静态 IP 无效**，第三段一变就不在同一网段。解决办法是用一个独立的 DuckDNS 子域
存放局域网 IP，名字永远不变，解析走公网 DNS、连接走热点直连。

子域必须与 `DOMAIN` 不同：两者相同会互相覆盖，公网记录会被写成 `192.168.x.x`。

```bash
# 先在 duckdns.org 新建子域 localhotspot，然后把三项写进同一份配置
sudo sh -c 'umask 077; printf "DOMAIN=sherlocknieh\nLAN_DOMAIN=localhotspot\nTOKEN=<TOKEN>\n" > /etc/duckdns/duckdns.conf'

sudo install -m 755 <本技能目录>/scripts/duckdns-lan-update.sh /usr/local/bin/duckdns-lan-update.sh
sudo install -m 755 <本技能目录>/scripts/nm-dispatcher-90-duckdns /etc/NetworkManager/dispatcher.d/90-duckdns
sudo restorecon /usr/local/bin/duckdns-lan-update.sh /etc/NetworkManager/dispatcher.d/90-duckdns

sudo rm -f /var/lib/duckdns-lan/last-ip      # 状态键是「子域 + IP」，换子域必须清
sudo /usr/local/bin/duckdns-lan-update.sh wlp0s20f3
```

分派脚本监听 Wi-Fi 的 `up` / `dhcp4-change`：异步启动 `duckdns.service` 刷新公网记录，
同时同步调用内网脚本刷新局域网记录，所以两条记录都不再依赖 5 分钟定时器。

**完成标准**：

```bash
journalctl -t duckdns-lan -n 3
# 期望：domain=localhotspot ip=<局域网IP> result=OK <局域网IP>  UPDATED

curl -fsS -H 'accept: application/dns-json' \
  'https://1.1.1.1/dns-query?name=localhotspot.duckdns.org&type=A'
# data 应等于 ip -4 addr show wlp0s20f3 的地址

curl -fsS -H 'accept: application/dns-json' \
  'https://1.1.1.1/dns-query?name=sherlocknieh.duckdns.org&type=A'
# data 应仍是公网 IP，证明两条记录没打架
```

注意：

- DuckDNS 接受私有地址；AliDNS、DNSPod 实测都不过滤该答案。
- TTL 60 秒：手机换网后第一次连不上，等一会儿或重开连接。
- 手机不在这台热点上时，该名字解析到一个不可达私有地址，属正常。
- 换子域后如果更新被静默跳过，先删 `last-ip`：状态只比 IP 的旧写法会漏推。

## 7. Tailscale（备用路径）

```bash
sudo tailscale up
tailscale ip -4      # 100.80.222.65
tailscale netcheck   # 看是否直连；手机流量常落到 DERP
```

优先级：局域网 > 公网 `duckdns:54389` > Tailscale。手机用流量时 Tailscale 往往走
DERP 中继（曾落到 `sfo`，RTT 358–1204ms），比公网直连慢得多。

## 8. 回滚

按“先撤暴露面，再撤服务”的顺序：

```bash
# 1) 路由器：防火墙 → 端口转发 → rdp-54389 → 删除
#    先做这步，公网立即不可达

# 2) DuckDNS
sudo systemctl disable --now duckdns.timer
sudo rm -f /etc/systemd/system/duckdns.service /etc/systemd/system/duckdns.timer
sudo rm -f /usr/local/bin/duckdns-update.sh
sudo rm -rf /etc/duckdns
sudo systemctl daemon-reload

# 3) RDP
grdctl rdp disable
systemctl --user disable --now gnome-remote-desktop.service
# 可选：连同凭据和证书一起删除
# rm -rf ~/.local/share/gnome-remote-desktop

# 4) 锁屏扩展（用 Python 过滤，避免 sed 改坏数组）
cur=$(gsettings get org.gnome.shell enabled-extensions)
new=$(python3 -c 'import ast,sys;v=ast.literal_eval(sys.argv[1]);print("["+", ".join(repr(x) for x in v if x!="allowlockedremotedesktop@kamens.us")+"]")' "$cur")
gsettings set org.gnome.shell enabled-extensions "$new"
rm -rf ~/.local/share/gnome-shell/extensions/allowlockedremotedesktop@kamens.us

# 5) 锁屏策略恢复默认
gsettings reset org.gnome.desktop.screensaver lock-enabled
gsettings reset org.gnome.desktop.session idle-delay
gsettings reset org.gnome.desktop.screensaver lock-delay
```

Tailscale 通常还有别的用途，不随本配置回滚。

**完成标准**：`ss -H -ltn 'sport = :3389'` 无输出；`systemctl list-timers duckdns.timer`
为空；`gnome-extensions list --enabled` 不含该扩展；公网 `+auth-only` 超时。
