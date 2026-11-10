# 排障

## 0. 先分层，再动手

```bash
<本技能目录>/scripts/rdp-status.sh
```

| 现象 | 层 | 跳到 |
|---|---|---|
| 局域网也连不上 / 认证失败 | 接入 | 第 1 节 |
| 能连，但一锁屏就断 | 锁屏 | 第 2 节 |
| 局域网正常，外网连不上 | 外网 | 第 3 节 |
| 连上黑屏 | 接入（物理画面） | 第 1.3 节 |
| 外网 300ms+ | 路径选择 | 第 3.4 节 |
| 重启后连不上 | 设计限制 | 第 4 节 |

## 1. 接入层：gnome-remote-desktop

### 1.1 服务与端口

```bash
systemctl --user status gnome-remote-desktop.service
ss -tln | grep 3389
grdctl status
journalctl --user -u gnome-remote-desktop -b -n 50
```

- 服务未运行：`systemctl --user start gnome-remote-desktop.service`。
- 端口没监听：看 grd 日志里的证书/凭据错误；证书不可读时 grd 会拒绝启动 RDP。
- 服务 active 但仍连不上：确认当前有一个**已登录的图形会话**。没有会话时没有可接管的
  物理画面，连接会失败或停在黑屏。

### 1.2 认证失败

RDP 凭据和系统登录密码是两套。改这里：

```bash
grdctl rdp set-credentials who '<新密码>'
```

本机自测（不建桌面会话）：

```bash
xfreerdp /v:127.0.0.1:3389 /u:who /p:'<密码>' /cert:ignore +auth-only
echo $?
```

- `+auth-only` 返回 0，说明接入层认证没问题，问题在客户端/网络。
- 返回非 0，先看 `grdctl status` 的 `Authentication methods` 是否含 `credentials`。
- 客户端报证书变化：重新生成证书后指纹会变，需要在客户端删除旧条目或核对新指纹后接受。

查看当前指纹：

```bash
openssl x509 -in ~/.local/share/gnome-remote-desktop/tls.crt -noout -fingerprint -sha256
```

### 1.3 连上黑屏

RDP 抓的是**物理会话的画面**。以下情况会黑屏：

1. 没有用户图形会话（还在 GDM 登录界面，或重启后没人登录）。
2. 显示器/CRTC 被 DPMS 关掉。屏幕黑了，抓到的画面也黑。

定位：

```bash
loginctl list-sessions --no-legend
loginctl show-session "$XDG_SESSION_ID" -p Type -p Active -p LockedHint
gsettings get org.gnome.desktop.session idle-delay
```

若 `Type=wayland`、`Active=yes`，且空闲超过 `idle-delay` 后黑屏，做一次对照实验：

```bash
gsettings set org.gnome.desktop.session idle-delay 0   # 临时：不自动息屏
# 重新连接验证；验完改回 900
gsettings set org.gnome.desktop.session idle-delay 900
```

若确实是息屏导致，只能在“自动锁屏”和“远程始终有画面”之间取舍：`idle-delay` 同时
驱动息屏和锁屏，GNOME 50 没有单独的 DPMS 开关暴露在 dconf。折中方案是设
`idle-delay 0`，改用 `Super+L` 或 `loginctl lock-session` 手动锁屏。

> 注意：锁屏本身不会导致黑屏。锁屏界面是真实画面，扩展生效时远程能看到并操作它。

## 2. 锁屏层：一锁屏就断

### 2.1 机制

GNOME 锁屏时调用 mutter 的 `inhibit_remote_access()`，源码注释写明
*Any active remote access session will be terminated*。扩展
`allowlockedremotedesktop@kamens.us` 把该函数替换为空函数，所以会话能活下来。
它的 `metadata.json` 里 `session-modes` 包含 `unlock-dialog`，锁屏界面同样加载。

### 2.2 最常见的失败：Shell 没扫描到扩展

GNOME Shell 只在**启动时**枚举扩展。装完扩展不注销，`gnome-extensions list` 可能显示
已启用，但当前 Shell 里根本没跑。

```bash
gnome-extensions info allowlockedremotedesktop@kamens.us
gnome-extensions list --enabled | grep -qx allowlockedremotedesktop@kamens.us
journalctl --user -b | grep "Remote desktop connections while screen is locked are now ENABLED"
```

- 第三条没有输出：**注销后重新登录**。Wayland 下不能原地重启 Shell。
- 重登后仍没有：看 `journalctl --user -b -u gnome-shell` 是否有扩展加载错误；确认
  `metadata.json` 的 `shell-version` 覆盖当前 GNOME（该扩展 v18 支持 45–51）。
- 临时禁用再启用：`gnome-extensions disable ... && gnome-extensions enable ...`，仍需重登。

### 2.3 实测锁屏

```bash
loginctl lock-session
sleep 10
loginctl show-session "$XDG_SESSION_ID" -p LockedHint    # yes
```

保持 RDP 客户端连着，10 秒后仍能操作即通过。解锁后 `LockedHint` 应回到 `no`。

### 2.4 SSH 免密解锁兜底

GNOME 锁屏监听 logind 的 `Unlock` 信号：

```js
// gnome-shell/js/ui/screenShield.js
this._loginSession.connectSignal('Unlock', () => this.deactivate(false));
```

所以拿到 root 就能解锁，不需要输入登录密码：

```bash
sudo loginctl unlock-sessions
# 或只解锁某个会话
sudo loginctl unlock-session <ID>
```

无效时确认目标是图形会话且用了 root；这是有意保留的能力，也意味着 root 等价于屏幕解锁。

## 3. 外网层

### 3.1 先确认走哪条路

| 路径 | 地址 | 适用 |
|---|---|---|
| 局域网 | `192.168.66.240:3389` | 同一 Wi-Fi，最快 |
| 热点内网 | `localhotspot.duckdns.org:3389` | 手机开热点、电脑连热点；名字不变，IP 随网段自动更新 |
| 公网 | `sherlocknieh.duckdns.org:54389` | 任意网络，手机流量首选 |
| Tailscale | `100.80.222.65:3389` | 公网端口不可用时的备用 |

局域网内测公网域名可能因路由器无 hairpin NAT 而失败，这不算故障；用手机流量复测。

### 3.2 公网 IP 变了

PPPoE 是动态地址，任何笔记里的 IP 都会过期（本文档写作时是 `117.30.177.70`，
2026-11-04 已是 `27.149.58.194`）。

```bash
# 真实公网 IP（绕过 FlClash TUN）
tailscale netcheck --format json \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("GlobalV4"))'

# DuckDNS 最近一次更新
journalctl -u duckdns.service -n 20

# 立即补一次
sudo systemctl start duckdns.service
```

DuckDNS 最长 5 分钟才跟上；客户端 DNS 还有 60 秒 TTL。等待后仍不更新，检查
`/etc/duckdns/duckdns.conf` 的 `DOMAIN`（只写子域名）和 `TOKEN`。

### 3.3 域名解析异常

```bash
# 不要用 ping / getent 判断：本机 FlClash 会返回 Fake-IP
getent ahostsv4 sherlocknieh.duckdns.org    # 可能是 198.18.x.x 或 28.0.0.x

# 用公共 DoH 看真实解析
curl -fsS 'https://dns.alidns.com/resolve?name=sherlocknieh.duckdns.org&type=A'
```

- 本机 `ping` 得到 `198.18.x.x` / `28.0.0.x` 是 FlClash 的 Fake-IP，正常。
- 手机解析失败：私人 DNS 设为 `dns.alidns.com` 或 `doh.pub`。
- 114DNS 不解析该域名，别用它做判断；AliDNS `223.5.5.5` 和 DNSPod `119.29.29.29` 正常。
- 手机在代理环境下也可能拿到 Fake-IP，先关代理再测。

### 3.4 外网很慢

先判断是不是走了 Tailscale DERP：

```bash
tailscale netcheck
tailscale status
```

- 手机用流量时若显示 `DERP sfo`，RTT 会到数百毫秒甚至 1 秒以上。
- 本机公网是 cone NAT，但路由器无 UPnP、无 Full Cone，手机侧打洞失败；也没有 IPv6
  （路由器不下发 RA）。这些是 Tailscale 直连不成的原因。
- 改用公网 `sherlocknieh.duckdns.org:54389`，延迟最低。

### 3.5 端口转发本身

```bash
# 主机侧
sudo firewall-cmd --list-ports
sudo firewall-cmd --query-port=33890/tcp

# 从公网侧（手机流量）
xfreerdp /v:sherlocknieh.duckdns.org:54389 /u:who /p:'<密码>' /cert:ignore +auth-only
xfreerdp /v:sherlocknieh.duckdns.org:54390 /u:who /p:'<密码>' /cert:ignore /w:800 /h:600
```

规则在 LuCI：`http://192.168.66.1` → 防火墙 → 端口转发，两条：

| 名称 | 外网 | 内网 |
|---|---|---|
| `rdp-54389` | `wan:54389` | `192.168.66.240:3389` |
| `rdp-remote-login` | `wan:54390` | `192.168.66.240:33890` |

54390 那类非标端口只是降低扫描噪声，真正的门槛是强密码 + TLS。公网暴露有风险：
不用时删掉 DNAT 规则（先删规则，公网立即不可达）。

连 54390 时 grd 会下发一次 server redirection，目标仍是客户端原来用的公网地址和端口；
FreeRDP/Windows App 会自动跟随，路由器侧不需要为它额外开端口。本机实测 54389/54390
都存在可用的 hairpin 回环。

## 4. 已知限制

1. **3389 与 33890 的分工**：用户级 grd（3389）是“远程协助”，跟着图形会话生死，
   登出/重启后无监听；系统级 remote login（33890，`gnome-remote-desktop.service` 已
   enable）不依赖登录会话，连上先到 GDM 登录界面，再在该界面登录 `who`。两套证书和
   凭据互相独立，配置见 rebuild 1.1。系统级凭据落在 `/etc/gnome-remote-desktop/`
   的 gkeyfile 里（本机 TPM 不可用时 grd 自动回退，日志有 `using GKeyFile as fallback`）。
2. **RustDesk 在 Wayland 锁屏下不可用**：它依赖 xdg-desktop-portal 截图，锁屏时需要
   本地点选屏幕。RDP 走 mutter 特权 API，不受此限。
3. **FlClash 影响排障**：Fake-IP 让本机解析失真，TUN 让直连 IP 检测失真。判断公网
   一律用 `tailscale netcheck` + DoH。
4. **Fedora 44 无 Xorg 会话**：不要按 X11 方案排查（`xrandr`、Xorg 日志等）。
5. 测试期装过的包：`freerdp`、`libva-utils`、`miniupnpc`，可留可删。
