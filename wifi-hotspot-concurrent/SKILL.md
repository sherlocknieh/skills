---
name: wifi-hotspot-concurrent
description: 在 Fedora（GNOME/Wayland）上实现"一边连 WiFi 一边开热点"（STA+AP 并发、共享当前 WiFi），并做成 GNOME 快速设置磁贴（可改 SSID/密码）。适用于用户反馈"Linux 不能像 Windows 那样连 WiFi 的同时开热点"、NetworkManager/设置里开热点会断开 WiFi、想用 hostapd 在第二个虚拟接口同信道开 AP。关键词：热点、共享网络、STA+AP、并发、hostapd、ap0、虚拟接口、iwlwifi、NetworkManager、GNOME 扩展、QuickMenuToggle、AP 模式、同信道、create_ap、linux-wifi-hotspot。
---

# 连 WiFi 的同时开热点（STA+AP 并发共享当前 WiFi）

在 Fedora + GNOME(Wayland) 上，让"客户端连接(STA)"和"热点(AP)"在同一张无线网卡上并存，把当前 WiFi 上网共享给热点客户端，并提供一个 GNOME 快速设置磁贴（含改 SSID/密码的子菜单）。验证环境：Fedora 44 / GNOME Shell 50.5 / Wayland / Intel AX211(iwlwifi)。

## 背景与原理

- **现象**：`nmcli device wifi hotspot` 或 GNOME 设置里"Turn On Wi-Fi Hotspot"会把当前 WiFi 客户端连接顶掉。
- **根因**：NetworkManager 对一张 WiFi 网卡只维护**一个**活动连接；GNOME 设置的热点按钮把设备写死为主网卡（见下"坑"）。这是软件模型限制，不是硬件。
- **硬件其实支持**：若 `iw phy` 的 `valid interface combinations` 含 `#{ managed } <= 1, #{ AP ... } <= 1, ... #channels <= 1`，即可同时 STA+AP，但**必须同信道**（`#channels <= 1`）。Intel 的 Windows 驱动暴露了并发能力，所以 Windows 能。
- **方案**：新建 AP 虚拟接口 `ap0` → hostapd 直接驱动（信道对齐 STA 当前信道）→ dnsmasq 发 DHCP/DNS → nft 做 masquerade 共享上行；让 NM 不托管 `ap0`。再用一个 GNOME 扩展把开关/配置接到这套脚本上。

> 一句话：**STA 在 `wlp0s20f3`，AP 在 `ap0`，两者同信道。**

## 0. 环境与可行性检查

```bash
cat /etc/os-release; gnome-shell --version
nmcli device status
iw dev                                          # 找 STA 接口名与当前信道
iw phy phy0 info | grep -A3 'valid interface combinations'
iw phy phy0 info | grep -A10 'Supported interface modes'   # 必须有 AP
```

要求：`Supported interface modes` 里有 `AP`，且组合里有 `managed`+`AP` 且 `#channels <= 1`。
示例（AX211/iwlwifi）：`#{ managed } <= 1, #{ AP, P2P-client, P2P-GO } <= 1, #{ P2P-device } <= 1, total <= 3, #channels <= 1`。

## 1. 安装后端脚本

```bash
sudo dnf install -y hostapd            # dnsmasq、iw 通常已装
sudo install -m0755 <技能目录>/wifi-hotspot.sh /usr/local/bin/wifi-hotspot
```

脚本全文见本技能目录 `wifi-hotspot.sh`。要点：

- 从 `iw dev <STA> info` 读当前信道，据此定 band（`ch <= 14` → `g`，否则 `a`）与 channel。
- 删除并重建 AP 接口：`iw dev <STA> interface add ap0 type __ap`。
- hostapd（WPA2-PSK）+ `10.42.0.1/24` + dnsmasq(DHCP/DNS) + `net.ipv4.ip_forward=1` + nft（`masquerade` + `forward accept`）。
- 配置存 `/etc/wifi-hotspot.conf`（root 600，`SSID=`/`PASSWORD=`）；子命令：
  - `start` / `stop` / `status`
  - `get-config`（输出两行：SSID、密码）
  - `set-config <ssid> <password>`（保存；**若热点在运行会自动重启以生效**）
- 可用环境变量覆盖：`WIFI_HOTSPOT_UPLINK`、`WIFI_HOTSPOT_IFACE`、`WIFI_HOTSPOT_SSID`、`WIFI_HOTSPOT_PASS`。
- 默认上行接口 `wlp0s20f3`、默认 SSID/密码 `FedoraShare` / `12345678`；**换机器要改脚本顶部的 `UPLINK_IF`**（或设 `WIFI_HOTSPOT_UPLINK`）。

让 NM 不要托管 `ap0`：

```bash
printf '[keyfile]\nunmanaged-devices=interface-name:ap0\n' | sudo tee /etc/NetworkManager/conf.d/99-unmanaged-ap0.conf
sudo systemctl reload NetworkManager
```

手动验证：

```bash
sudo /usr/local/bin/wifi-hotspot start
iw dev ap0 info | grep -E 'type|channel'        # type AP；channel 应与 STA 相同
iw dev <STA> info | grep -E 'ssid|channel'       # STA 仍在线
nslookup example.com 10.42.0.1                   # 经热点网关的 DNS 可用
sudo /usr/local/bin/wifi-hotspot stop
```

## 2. 免密提权（供 GNOME 扩展调用）

```bash
echo "<用户名> ALL=(root) NOPASSWD: /usr/local/bin/wifi-hotspot" | sudo tee /etc/sudoers.d/wifi-hotspot
sudo chmod 0440 /etc/sudoers.d/wifi-hotspot
sudo visudo -cf /etc/sudoers.d/wifi-hotspot
sudo -n /usr/local/bin/wifi-hotspot status       # 应无需密码
```

sudoers 里只写命令、不带参数，即允许带任意参数（`start`/`stop`/`get-config`/`set-config ...`）。成品见本目录 `wifi-hotspot.sudoers`。

## 3. GNOME 扩展（快速设置磁贴 + 改 SSID/密码子菜单）

```bash
D=~/.local/share/gnome-shell/extensions/wifi-hotspot@who.local
mkdir -p "$D"
cp <技能目录>/gnome-extension/* "$D/"
gsettings set org.gnome.shell enabled-extensions \
  "$(gsettings get org.gnome.shell enabled-extensions | sed "s/]$/, 'wifi-hotspot@who.local']/")"
```

要点：

- 用 `QuickMenuToggle`：**点主体 = 开关热点**，**点右侧箭头 = 打开子菜单**。子菜单是一个 `PopupBaseMenuItem` 内嵌垂直 `St.BoxLayout`：「网络名」`St.Entry` +「密码」`St.PasswordEntry({show_peek_icon:true})` + 全宽「应用」`St.Button`；在输入框回车也可应用。完整实现说明见 `gnome-extension/README.md`。
- 通过 `sudo -n /usr/local/bin/wifi-hotspot start|stop|get-config|set-config` 与后端交互；每 3 秒检查 `/sys/class/net/ap0` 是否存在来同步磁贴状态（CLI 改动也能反映）。
- `metadata.json` 的 `shell-version` 填主版本号即可（如 `"50"`，匹配 50.x）。
- **Wayland 下运行中的 Shell 不会重新扫描新扩展目录，必须注销/重登**；重登前 `gnome-extensions enable` 会报"扩展不存在"、DBus `EnableExtension` 返回 false。重登后会自动启用（已在 enabled-extensions 里）。

无需重登的加载自检（嵌套/无头 Shell）：

```bash
G_MESSAGES_DEBUG=all timeout 30 dbus-run-session -- gnome-shell --wayland --headless 2>&1 \
  | grep -iE 'wifi-hotspot@who.local.*(ACTIVE after|ERROR)'
```

## 4. 坑 / 排错（实测）

- **别让 NM 在 `ap0` 上跑 AP**：NM 会强制改 `ap0` 的 MAC/iftype，返回 `platform-linux: do-change-link: failure 16 (设备或资源忙)`；`cloned-mac-address=permanent/preserve` 都救不了，且 down 后 supplicant 状态错乱，再激活进 `config-failed`。**直接用 hostapd 驱动 `ap0`，别用 NM。**
- **同信道约束**：`#channels <= 1` 要求 AP 与 STA 同信道；STA 漫游换信道后需 `stop` + `start` 重新对齐（脚本 `start` 会重新读取信道）。
- **GNOME 设置里的热点按钮保不住 WiFi**：源码 `panels/network/net-device-wifi.c` 里 `net_device_wifi_get_hotspot_connection()` 找到 `mode=ap + ipv4=shared` 的连接后调用 `nm_client_activate_connection_async(client, c, self->device, ...)`，设备写死为 WiFi 网卡；其对话框原文也写 "Turning on the hotspot will disconnect from %s..."。所以只能用外部开关（本扩展）。
- 第三方热水点扩展（如 `wifi-hotspot-quick-settings@aryan10.github.io`）**默认调用 `nmcli device wifi hotspot`（老方式，会断 WiFi）**，与本方案冲突，需停用/替换。
- 密码框优先用 `St.PasswordEntry({show_peek_icon:true})`（自带"睁眼"显示/隐藏按钮）。若手写 `St.Entry`，`clutter_text.password_char` 必须是 **uint32 码点**（写 `0x25cf`），写成字符串 `'●'` 会报 `value nan is out of range for password-char (type uint32)`。
- 扩展报 `No signal 'activate' on object 'StEntry'`：`St.Entry` 本身没有 `activate` 信号，要连 `entry.clutter_text.connect('activate', ...)`。
- 热点开了但客户端上不了网：查 `sysctl net.ipv4.ip_forward`（须 1）、`nft list table inet wifi_hotspot`（应有 masquerade）、`pgrep -a dnsmasq`/`ss -lunp | grep :67`。firewalld 的 `FedoraWorkstation` 区默认 `forward: yes`，放行转发。
- 移动端提示"已连接但无法上网/计费网络"：dnsmasq 已带 `--dhcp-option-force=43,ANDROID_METERED`，正常。
- 想查明当前 `ap0` 是否真的在 AP 模式：`iw dev ap0 info` 应显示 `type AP` 且 channel 与 STA 一致。

## 5. 文件清单 / 卸载

| 用途 | 位置 |
|---|---|
| 后端脚本 | `/usr/local/bin/wifi-hotspot`（成品：本目录 `wifi-hotspot.sh`） |
| 热点配置 | `/etc/wifi-hotspot.conf`（root 600） |
| 免密提权 | `/etc/sudoers.d/wifi-hotspot`（成品：本目录 `wifi-hotspot.sudoers`） |
| NM 未托管 ap0 | `/etc/NetworkManager/conf.d/99-unmanaged-ap0.conf` |
| GNOME 扩展 | `~/.local/share/gnome-shell/extensions/wifi-hotspot@who.local/`（成品：本目录 `gnome-extension/`） |

卸载：

```bash
sudo /usr/local/bin/wifi-hotspot stop
sudo rm -f /usr/local/bin/wifi-hotspot /etc/wifi-hotspot.conf /etc/sudoers.d/wifi-hotspot \
           /etc/NetworkManager/conf.d/99-unmanaged-ap0.conf
gnome-extensions uninstall wifi-hotspot@who.local   # 或重登后 rm -rf 扩展目录
sudo systemctl reload NetworkManager
```
