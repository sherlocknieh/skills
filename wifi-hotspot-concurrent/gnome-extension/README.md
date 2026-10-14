# Wi-Fi 热点（保留 WiFi）—— 实现文档

在 Fedora 44 / GNOME 50 (Wayland) 上，实现「一边连 Wi-Fi、一边开热点」（STA+AP 并发），
并把它接到 GNOME 快速设置的一个磁贴上，支持编辑 SSID 与密码。

## 1. 目标与背景

Windows 允许「连 Wi-Fi 的同时开热点」。Linux 默认做不到，原因分两层：

1. **NetworkManager 的限制**：一个 Wi-Fi 网卡同一时刻只能有一个活动连接。激活 AP 连接会
   把 client(STA) 连接顶掉。
2. **GNOME Settings 的限制**：GNOME 的「Turn On Wi-Fi Hotspot」在源码
   `panels/network/net-device-wifi.c` 中通过
   `nm_client_activate_connection_async(client, conn, self->device, ...)` 把 **device 写死为当前
   Wi-Fi 网卡**，且判断「热点是否开启」只看该网卡上的活动连接是否为 `ipv4=shared + mode=ap`。
   它的对话框本身就提示 “Turning on the hotspot will disconnect from …”。

因此无法在保留 Wi-Fi 的同时让 Settings 内置热点生效。解决方案：**绕开 NM 的单连接限制**，
用 hostapd 在网卡上另建一个 AP 虚拟接口 `ap0`，STA 仍由 NM 管在 `wlp0s20f3` 上，再用扩展做 GUI。

### 硬件约束（关键）

本机网卡 Intel AX211（`iwlwifi`）。`iw phy phy0 info` 的有效组合：

```
* #{ managed } <= 1, #{ AP, P2P-client, P2P-GO } <= 1, #{ P2P-device } <= 1,
  total <= 3, #channels <= 1
```

即 **1 个 STA + 1 个 AP 可以并存，但两者必须在同一信道**。所以热点的信道/频段必须跟随
当前 STA 连接；STA 漫游换信道后需重开热点对齐。

## 2. 总体结构

```
GNOME 快速设置磁贴 (扩展 wifi-hotspot@who.local)
        │  点主体 = 开关；点箭头 = 编辑 SSID/密码
        ▼
sudo -n /usr/local/bin/wifi-hotspot {start|stop|get-config|set-config}
        ▼
hostapd(AP on ap0) + dnsmasq(DHCP/DNS) + nft(NAT 伪装)  ← 共享 wlp0s20f3(STA)
```

- STA：`wlp0s20f3`，由 NetworkManager 管理（例如连到某个 Wi-Fi）。
- AP：`ap0`（`wlp0s20f3` 上新建的 `type __ap` 虚拟接口），由 hostapd 管理。
- 上行共享：`ap0`(10.42.0.1/24) → NAT → `wlp0s20f3`。

## 3. 后端：`/usr/local/bin/wifi-hotspot`

自带提权（非 root 时 `exec sudo -- "$0" "$@"`）。子命令：

| 命令 | 作用 |
| --- | --- |
| `start` / `on` | 读取 STA 信道→建 `ap0`→hostapd→dnsmasq→nft NAT |
| `stop` / `off` | 停 hostapd/dnsmasq、删 nft 表、删 `ap0`（不动 STA 连接） |
| `status` | 网卡状态 + hostapd 是否运行 |
| `get-config` | 输出两行：`SSID`、`PASSWORD`（需 root） |
| `set-config <ssid> <pass>` | 写配置；若热点在运行则重启使生效 |

要点：

- **信道对齐**：`start` 用 `iw dev wlp0s20f3 info` 取当前信道，`<=14` 用 `hw_mode=g`(2.4G)，
  否则 `hw_mode=a`(5G)，写入 `/run/wifi-hotspot/hostapd.conf`。开启前先 `stop` 清理。
- **配置**：`/etc/wifi-hotspot.conf`（root:root，600），内容 `SSID=... / PASSWORD=...`；
  支持用环境变量 `WIFI_HOTSPOT_SSID` / `WIFI_HOTSPOT_PASS` 临时覆盖。
- **DHCP/DNS**：`dnsmasq --keep-in-foreground` 等价方式，监听 `ap0`，网关/DNS 均为 `10.42.0.1`，
  带 `--dhcp-option-force=43,ANDROID_METERED`。
- **NAT**：自建 nft 表 `inet wifi_hotspot`：
  - `postrouting`(srcnat)：`ip saddr 10.42.0.0/24 ip daddr != 10.42.0.0/24 masquerade`
  - `forward`(filter)：放行 `iifname ap0` 及回程 `oifname ap0 ct state established,related`
  - 同时 `sysctl net.ipv4.ip_forward=1`（firewalld 的 FORWARD 策略为 accept，不冲突）。
- **NM 不碰 `ap0`**：`/etc/NetworkManager/conf.d/99-unmanaged-ap0.conf` 里
  `unmanaged-devices=interface-name:ap0`。

### 免密提权

`/etc/sudoers.d/wifi-hotspot`（0440 root:root）：

```
who ALL=(root) NOPASSWD: /usr/local/bin/wifi-hotspot
```

（命令不带参数 = 允许任意参数。）扩展用 `sudo -n` 调用，故不会弹密码框。

## 4. GNOME 扩展 `wifi-hotspot@who.local`

目录：`~/.local/share/gnome-shell/extensions/wifi-hotspot@who.local/`
文件：`metadata.json`、`extension.js`、`stylesheet.css`、本 `README.md`。

### 结构

- `WifiHotspotExtension`（`Extension`）：
  - `enable()` 建 `MessageTray.Source`，再
    `Main.panel.statusArea.quickSettings.addExternalIndicator(indicator)`。
  - `disable()` 销毁 `quickSettingsItems` 与 indicator、source。
  - `notify(title, body)`：用 `MessageTray.Notification({source,title,body})` 弹通知。
- `HotspotIndicator`（`SystemIndicator`）：`quickSettingsItems.push(toggle)`。
- `HotspotToggle`（`QuickMenuToggle`）：
  - 主体点击 → 发 `clicked`；箭头按钮 → 打开 `this.menu`。
  - 菜单项：`PopupSeparatorMenuItem('热点设置')` + 一个 `PopupBaseMenuItem`（内含整块设置表单）。
  - 表单 = `St.BoxLayout(vertical)`：两行「标签 + 输入框」+ 一个全宽 `St.Button('应用')`。
  - 标签用 CSS `min-width` 对齐（`stylesheet.css` 的 `.wifi-hotspot-label`）。
  - 密码框 = `St.PasswordEntry({show_peek_icon:true})`，内嵌眼睛图标，点击即可显示/隐藏密码。
  - 状态同步：`GLib.timeout_add_seconds(..., 3, ...)` 轮询 `/sys/class/net/ap0` 是否存在。
  - 开关/保存均通过 `Gio.Subprocess` 跑 `sudo -n .../wifi-hotspot ...`。

### 调用约定

- 开关：`sudo -n wifi-hotspot start|stop`
- 打开菜单时读当前值：`sudo -n wifi-hotspot get-config`（读 stdout 两行）
- 应用：`sudo -n wifi-hotspot set-config <ssid> <pass>`

## 5. 安装 / 启用步骤（复现）

1. `sudo dnf install hostapd`（dnsmasq、nft、iw 系统已有）。
2. 写入 `/usr/local/bin/wifi-hotspot`（见第 3 节），`chmod 0755`。
3. 写 `/etc/wifi-hotspot.conf`（可省略，默认 FedoraShare/12345678）。
4. 写 `/etc/sudoers.d/wifi-hotspot`，`visudo -cf` 校验。
5. 写 `/etc/NetworkManager/conf.d/99-unmanaged-ap0.conf`，`systemctl reload NetworkManager`。
6. 把扩展放进 `~/.local/share/gnome-shell/extensions/wifi-hotspot@who.local/`。
7. 加入启用列表：
   `gsettings set org.gnome.shell enabled-extensions "[..., 'wifi-hotspot@who.local']"`。
8. **注销再登录**（Wayland 下 GNOME Shell 不能运行期加载新扩展）。
   登录后可用 `gnome-extensions info wifi-hotspot@who.local` 确认。

## 6. 使用

- 命令行：`sudo wifi-hotspot start` / `stop` / `status`。
- 图形：快速设置 → 「Wi-Fi 热点」磁贴 → 点主体开关；点箭头改 SSID/密码后「应用」。

## 7. 已知限制 / 注意

- **同信道约束**：热点信道 = 当前 Wi-Fi 信道；走 2.4G 热点就在 2.4G。STA 换信道后需重开热点。
- 热点与 STA 共用一个射频，吞吐会互相分时占用。
- 需要**至少已连接一个 Wi-Fi**（`start` 会据此确定信道），或用有线作为上行时另配。
- 改 SSID/密码会重启热点，已连客户端会短暂断开。
- 与 `wifi-hotspot-quick-settings@aryan10.github.io`（第三方，调用 `nmcli ... hotspot`，会断开 Wi-Fi）
  功能冲突，已从启用列表移除（文件保留未删）。

## 8. 排查

- 扩展没出现：Wayland 需注销/登录；`gnome-extensions list` 看不到就是 Shell 还没扫描到。
- 扩展报错：`journalctl --user -b -o cat /usr/bin/gnome-shell | grep wifi-hotspot`。
- 点开关没反应/提示失败：确认 `/etc/sudoers.d/wifi-hotspot` 存在且 `sudo -n wifi-hotspot status` 可跑。
- 热点开了但客户端上不了网：查 `sysctl net.ipv4.ip_forward`、`nft list table inet wifi_hotspot`、
  `nft list ruleset | grep wifi_hotspot`，以及上行 `wlp0s20f3` 是否在线。
- 手动步骤：`sudo wifi-hotspot start`，看 hostapd 的 `AP-ENABLED` 与 `iw dev ap0 info`。

## 9. 关键 API 备忘（GNOME 50）

- 导入：`resource:///org/gnome/shell/ui/quickSettings.js`（`QuickToggle`/`QuickMenuToggle`/`SystemIndicator`）、
  `.../ui/popupMenu.js`、`.../ui/messageTray.js`、`.../extensions/extension.js`。
- 指示灯 `checked` 由 `St.Button` 的 `toggle-mode` 决定，点按自动切换。
- 坑：
  - 密码显示用 `St.PasswordEntry`（属性 `show-peek-icon` / `password-visible`），
    不要再用 `Clutter.Text.password_char`（code point，且非标准控件）。
  - `St.Entry` **没有** `activate` 信号，要用 `entry.clutter_text.connect('activate', ...)`。
  - `MessageTray.Notification` 构造用对象参数 `{source, title, body}`；
    `MessageTray.Source` 用 `{title}`。
