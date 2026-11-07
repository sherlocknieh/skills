---
name: fedora-remote-desktop
description: 维护 Fedora 44 / GNOME 50 (Wayland) 的远程桌面链路：GNOME RDP + 锁屏不断连扩展 + 路由器端口转发 + DuckDNS + Tailscale。适用于远程桌面连不上、锁屏后断连、连上黑屏、外网很慢、域名解析异常、公网 IP 变了，以及重建或回滚整套配置。关键词：远程桌面、RDP、3389、grdctl、gnome-remote-desktop、allowlockedremotedesktop、DuckDNS、端口转发、Tailscale、xfreerdp、锁屏断连。
---

# Fedora 远程桌面

远程桌面由三层叠成，每层的失效方式不同。先定位层，再动手：

| 层 | 组件 | 这一层坏了的表现 |
|---|---|---|
| 接入 | `gnome-remote-desktop`（grd）监听 3389 | 完全连不上，或认证失败 |
| 锁屏 | 扩展 `allowlockedremotedesktop@kamens.us` | 能连，但一锁屏就断 |
| 外网 | 路由器 DNAT + `duckdns.timer` | 局域网正常，外网连不上 |

核心不变量：**锁屏不断连**。grd 走 mutter 特权 RemoteDesktop API，直接接管物理会话，所以锁屏/解锁界面也能被捕获；但 GNOME 锁屏时会主动终止远程会话，必须靠扩展压住这个行为。

需要 root 时用 `sudo -A`（本机已配 `SUDO_ASKPASS`）。

## 1. 先体检

```bash
<本技能目录>/scripts/rdp-status.sh
```

脚本只读，逐层打印 OK / WARN / FAIL，并以非零退出码表示存在 FAIL。**体检通过**（退出码 0）才算修完；有 WARN 时先看它属于哪一层，再进分诊表。

## 2. 本机事实（会漂移，以体检结果为准）

| 项 | 值 |
|---|---|
| 用户 | `who` |
| 局域网 | `192.168.66.240:3389` |
| 外网 | `sherlocknieh.duckdns.org:54389`（PPPoE 动态 IP，**不要记 IP**） |
| Tailscale | `100.80.222.65:3389` |
| RDP 凭据 | 用户名 `who` + RDP 专用密码（与系统密码是两套，本文件不记录） |
| TLS 指纹 | `48:D1:58:D2:2E:4D:D4:98:8A:72:B3:AF:25:AE:D7:D9:57:D4:47:C1:95:8D:C2:03:29:BE:53:D4:53:46:D7:F9` |
| 路由器 | `http://192.168.66.1`（NRadio C2000-410，LuCI） |
| 客户端 | Windows App、Remmina、aFreeRDP、`xfreerdp` |

自签证书首次连接会告警，核对指纹后接受即可。

## 3. 按症状修

| 症状 | 先查 | 动作 |
|---|---|---|
| 锁屏后断连 | 体检第 2 节 | 扩展只在 Shell 启动时扫描，**注销重登**；日志出现 `now ENABLED` 才算生效 |
| 局域网也连不上 | 体检第 1 节 | 起服务、看 3389 监听、看 grd 日志 |
| 只有外网连不上 | 体检第 3 节 | 看 DoH 解析是否等于当前公网 IP；手工触发一次 DuckDNS；查路由器转发 |
| 认证失败 | `grdctl status` | 改的是 RDP 凭据，不是系统密码：`grdctl rdp set-credentials who '<新密码>'` |
| 能连但黑屏 | 锁屏/息屏状态 | 屏幕被关掉时抓不到画面；临时 `idle-delay 0` 验证 |
| 外网很慢（300ms+） | Tailscale 路径 | 手机流量走了 DERP 中继，改用公网 `duckdns:54389` |
| 重启后连不上 | 是否存在登录会话 | 这是“远程协助”模式，需先有图形会话；见 `reference/troubleshooting.md` 的已知限制 |

深入步骤见 [`reference/troubleshooting.md`](reference/troubleshooting.md)。

## 4. 重建与回滚

从零搭建整套配置（RDP、证书、扩展、锁屏策略、firewalld、路由器、DuckDNS、Tailscale）与逐项回滚，见 [`reference/rebuild.md`](reference/rebuild.md)。DuckDNS 更新脚本已作为 [`scripts/duckdns-update.sh`](scripts/duckdns-update.sh) 附带。

## 5. 边界

- **公网暴露**：非标端口 + 强密码 + TLS 只是降低风险；不需要远程时删掉 DNAT 规则。
- **root 可免密解锁**：GNOME 锁屏监听 logind 的 `Unlock` 信号，`sudo loginctl unlock-sessions` 可直接解锁。这是有意保留的兜底。
- **RustDesk 在 Wayland 锁屏下不可用**：它走 portal 截图，锁屏时需要本地点选屏幕；RDP 路线不受此限。
- **FlClash 的 Fake-IP**：本机 `ping`/`getent` 会得到 `198.18.x.x` 或 `28.0.0.x` 之类的假地址，不能用来判断公网解析；用 DoH 查。
- **动态公网 IP**：任何写死 IP 的笔记都会过期，唯一可信来源是 `tailscale netcheck` + DoH。
