# 重建与回滚

按顺序搭：接入层 → 锁屏层 → 外网层。每步给出完成标准，全部通过再进下一步。

需要 root 时用 `sudo -A`。

## 0. 前置

- Fedora 44+、GNOME 50、Wayland。Fedora 44 已无 GNOME Xorg 会话。
- 用户级 grd（3389）是“远程协助”模式，只覆盖已有图形会话；登录界面/无人登录场景由系统级
  remote login（33890）负责，见 1.1。两者互不影响，可同时开。
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

### 1.1 登录界面 / 无人登录时的远程登录（系统级）

用户级 grd 跟着图形会话生死：登出、重启后 3389 无监听。系统级 daemon 不依赖登录会话，
自己拉一个无头 greeter 会话，连上就是 GDM 登录界面，登录后 handover 到新会话。两套配置
目录、证书、凭据互相独立。

```bash
# 独立证书目录（属主是系统 daemon 用户，不是 who）
sudo install -d -o gnome-remote-desktop -g gnome-remote-desktop -m 700 /etc/gnome-remote-desktop
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -subj "/CN=who-fedora-remote-login" \
  -keyout /etc/gnome-remote-desktop/tls.key \
  -out /etc/gnome-remote-desktop/tls.crt
sudo chown gnome-remote-desktop:gnome-remote-desktop /etc/gnome-remote-desktop/tls.{crt,key}
sudo chmod 600 /etc/gnome-remote-desktop/tls.key

# 端口必须和用户级 3389 错开；关掉端口协商，避免被悄悄挪走
sudo grdctl --system rdp set-port 33890
sudo grdctl --system rdp set-tls-cert /etc/gnome-remote-desktop/tls.crt
sudo grdctl --system rdp set-tls-key /etc/gnome-remote-desktop/tls.key
sudo grdctl --system rdp set-credentials who '<RDP密码>'
sudo grdctl --system rdp disable-port-negotiation
sudo grdctl --system rdp enable
sudo systemctl enable --now gnome-remote-desktop.service

sudo firewall-cmd --permanent --add-port=33890/tcp && sudo firewall-cmd --reload
```

配置落在 `/etc/gnome-remote-desktop/grd.conf`，凭据走 gkeyfile（本机无可用 TPM，日志会提示
`Init TPM credentials failed ... using GKeyFile as fallback`，属正常）。`grdctl --system`
不带服务也能读改写配置，改完证书要 `sudo systemctl restart gnome-remote-desktop.service`。

**完成标准**：

```bash
ss -H -ltn 'sport = :33890'                              # 有 LISTEN
sudo grdctl --system status | sed -n '/^RDP:/,/^VNC:/p'  # enabled / Port: 33890
# 真实短连接：会在日志里看到无头 greeter 会话和 handover，客户端出画面
timeout 20 xfreerdp /v:127.0.0.1:33890 /u:who /p:'<RDP密码>' /cert:ignore /w:800 /h:600
sudo journalctl -u gnome-remote-desktop -n 20 -o cat     # "No seat assigned, running headlessly"
```

连接期间会临时出现 `gdm-greeter` 会话；客户端断开后自动回收。测试后若残留，
`sudo loginctl terminate-session <id>` 清掉。

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
sudo firewall-cmd --permanent --add-port=33890/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

如果开了系统级 remote login（1.1），33890 也要放行。

本机历史上放行过 `1025-65535/tcp`；若没有其他服务依赖这个大范围，收窄到 3389 更安全。

## 5. 路由器端口转发（外网直连）

LuCI：`http://192.168.66.1` → **防火墙 → 端口转发**（标准路径
`/cgi-bin/luci/admin/network/firewall/forwards`）。

| 字段 | 值（桌面会话） | 值（登录界面，可选） |
|---|---|---|
| 名称 | `rdp-54389` | `rdp-remote-login` |
| 协议 | TCP | TCP |
| 外部区域 / 端口 | `wan` / `54389` | `wan` / `54390` |
| 内部区域 / IP / 端口 | `lan` / `192.168.66.240` / `3389` | `lan` / `192.168.66.240` / `33890` |

两条规则独立，只要登出后也能连就加第二条。LuCI 上添加流程：填「新建端口转发」一行 →
「添加」→ 列表出现新行 → **「保存&应用」**（只点添加不会写入配置）。

**完成标准**：手机关 Wi-Fi 用流量，执行

```bash
xfreerdp /v:sherlocknieh.duckdns.org:54389 /u:who /p:'<RDP密码>' /cert:ignore +auth-only
xfreerdp /v:sherlocknieh.duckdns.org:54390 /u:who /p:'<RDP密码>' /cert:ignore /w:800 /h:600
```

第一条退出码 0；第二条应出现 GDM 登录界面。若在局域网内测公网域名失败，先排除路由器不支持
hairpin NAT：局域网直接用 `192.168.66.240:3389` 与 `:33890` 测。本机实测 54389/54390
都支持从内网回环访问。

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

### 6.2 解锁即刷新公网 IP

定时器只是兜底（5 分钟）。笔记本锁屏期间公网 IP 变了，解锁后最多要等 5 分钟才能连。
用用户级 systemd 服务监听会话总线的 `org.gnome.ScreenSaver.ActiveChanged`，解锁瞬间推一次：

```bash
# 1) 监听脚本与用户单元
install -D -m 755 <本技能目录>/scripts/duckdns-unlock-watch.sh ~/.local/bin/duckdns-unlock-watch.sh
install -D -m 644 <本技能目录>/scripts/duckdns-unlock.service ~/.config/systemd/user/duckdns-unlock.service

# 2) 允许 who 免密触发更新脚本（脚本自己探测真实 IP，不接受参数）
printf '%s ALL=(root) NOPASSWD: /usr/local/bin/duckdns-update.sh\n' who |
  sudo tee /etc/sudoers.d/duckdns-unlock >/dev/null
sudo chmod 0440 /etc/sudoers.d/duckdns-unlock
sudo visudo -cf /etc/sudoers.d/duckdns-unlock

# 3) 启用
systemctl --user daemon-reload
systemctl --user enable --now duckdns-unlock.service
```

关键点：

- `gdbus monitor` 的输出被 `stdbuf -oL` 强制行缓冲；否则信号攒在 4KB 管道缓冲里，
  解锁后迟迟不触发。
- 单元挂在 `gnome-session.target`：gnome-shell 起来后才有 `org.gnome.ScreenSaver`；
  `Restart=always` 兜住 Shell 重启。
- 解锁后网络可能还没就绪，脚本最多重试 3 次（间隔 5 秒）；仍失败就等定时器。
- 免密范围只有 `duckdns-update.sh` 一条命令；它只读取公网 IP，不接收参数。

**完成标准**：

```bash
systemctl --user is-active duckdns-unlock.service   # active
journalctl -t duckdns-unlock -n 3                   # 解锁后出现 unlock: ip=... result=OK
```

### 6.3 取消自动睡眠

远程机一睡，外网直接失联。两处都要关：

```bash
# GNOME 空闲挂起（插电与电池）
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing'

# 合盖：插电/扩展坞不睡（电池合盖保留原策略，避免装包里过热）
sudo install -d -m 0755 /etc/systemd/logind.conf.d
printf '[Login]\nHandleLidSwitchExternalPower=ignore\nHandleLidSwitchDocked=ignore\n' |
  sudo tee /etc/systemd/logind.conf.d/10-remote-desktop.conf >/dev/null
sudo systemctl reload systemd-logind
```

彻底禁止一切挂起（连菜单里的“挂起”也会失效，一般不需要）：

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

息屏（`org.gnome.desktop.session idle-delay`，默认 900 秒）与挂起是两码事，保持原样；
若远程连上黑屏，见 troubleshooting 1.3。

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

# 3b) 系统级 remote login（33890）
sudo systemctl disable --now gnome-remote-desktop.service
sudo grdctl --system rdp disable
# 可选：连同系统级凭据和证书一起删除
# sudo rm -rf /etc/gnome-remote-desktop
sudo firewall-cmd --permanent --remove-port=33890/tcp; sudo firewall-cmd --reload

# 4) 锁屏扩展（用 Python 过滤，避免 sed 改坏数组）
cur=$(gsettings get org.gnome.shell enabled-extensions)
new=$(python3 -c 'import ast,sys;v=ast.literal_eval(sys.argv[1]);print("["+", ".join(repr(x) for x in v if x!="allowlockedremotedesktop@kamens.us")+"]")' "$cur")
gsettings set org.gnome.shell enabled-extensions "$new"
rm -rf ~/.local/share/gnome-shell/extensions/allowlockedremotedesktop@kamens.us

# 5) 锁屏策略恢复默认
gsettings reset org.gnome.desktop.screensaver lock-enabled
gsettings reset org.gnome.desktop.session idle-delay
gsettings reset org.gnome.desktop.screensaver lock-delay

# 6) 解锁即刷新与睡眠策略
systemctl --user disable --now duckdns-unlock.service
rm -f ~/.local/bin/duckdns-unlock-watch.sh ~/.config/systemd/user/duckdns-unlock.service
sudo rm -f /etc/sudoers.d/duckdns-unlock /etc/systemd/logind.conf.d/10-remote-desktop.conf
sudo systemctl reload systemd-logind
gsettings reset org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type
gsettings reset org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type
```

Tailscale 通常还有别的用途，不随本配置回滚。

**完成标准**：`ss -H -ltn 'sport = :3389'` 无输出；`systemctl list-timers duckdns.timer`
为空；`gnome-extensions list --enabled` 不含该扩展；公网 `+auth-only` 超时。
