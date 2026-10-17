---
name: wifi-hotspot-concurrent
description: 在 Linux 上让同一无线网卡同时连接 Wi-Fi 并提供热点（STA+AP 并发，hostapd + dnsmasq + nftables + NetworkManager），可选集成 GNOME 45+ 快速设置磁贴。适用于 Fedora、Debian、Ubuntu、Arch 等发行版；用于共享当前 Wi-Fi、热点脚本或 GNOME 磁贴。
---

# Wi-Fi 与热点并发

本技能使用独立的 AP 虚拟接口、hostapd、dnsmasq 和 nftables，让一张无线网卡保持 Wi-Fi 客户端（STA）连接的同时提供热点（AP）。它不使用 `nmcli device wifi hotspot`，因此不会主动断开当前 Wi-Fi。

## 适用条件

本方案依赖 **NetworkManager** 管理上行 STA；GNOME 磁贴部分还需要 GNOME 45+。先确认无线驱动支持 STA+AP，且通常要求两者共用一个信道：

```bash
cat /etc/os-release
nmcli device status
iw dev
iw phy "$(iw dev <STA> info | awk '/wiphy/{print "phy"$2}')" info |
  grep -A5 'valid interface combinations'
```

`Supported interface modes` 必须包含 `AP`；`valid interface combinations` 必须允许 `managed` 与 `AP`，并留意 `#channels <= 1`。若无线驱动不支持该组合，本方案无法绕过硬件限制。

## 安装后端

安装 `NetworkManager`、`iw`、`hostapd`、`dnsmasq`、`nftables` 和 `sudo`。使用系统包管理器安装，不要假设发行版：

```bash
# Fedora/RHEL
sudo dnf install -y NetworkManager iw hostapd dnsmasq nftables sudo
# Debian/Ubuntu
sudo apt install -y network-manager iw hostapd dnsmasq nftables sudo
# Arch
sudo pacman -S --needed networkmanager iw hostapd dnsmasq nftables sudo
```

只执行适合当前系统的一组命令；若包名不同，使用发行版文档中的对应包名。

安装随附脚本（脚本会自动选择当前已连接的 Wi-Fi；也可显式指定接口）：

```bash
sudo install -Dm755 ./wifi-hotspot.sh /usr/local/bin/wifi-hotspot
sudo WIFI_HOTSPOT_UPLINK='<STA>' /usr/local/bin/wifi-hotspot start  # 可选；不设置则自动发现
```

脚本支持 `start|on`、`stop|off`、`status`、`get-config` 和
`set-config <ssid> <password>`。配置保存在 `/etc/wifi-hotspot.conf`（权限
600）；SSID 和密码也可通过 `WIFI_HOTSPOT_SSID`、`WIFI_HOTSPOT_PASS` 覆盖。
首次使用会创建 `10.42.0.0/24` 热点网段、启用 IPv4 转发并建立 nftables masquerade。

让 NetworkManager 不管理 AP 接口（接口名与脚本保持一致）：

```bash
printf '[keyfile]\nunmanaged-devices=interface-name:%s\n' "${WIFI_HOTSPOT_IFACE:-ap0}" |
  sudo tee /etc/NetworkManager/conf.d/99-wifi-hotspot-ap.conf >/dev/null
sudo systemctl reload NetworkManager
```

防火墙必须放行 `ap0` 的入站 DHCP/DNS，否则客户端会反复关联但拿不到 IP。`ap0` 由 `iw`
直接创建、不受 NetworkManager 管理，防火墙通常不会自动把它归入合适的区域/规则。按实际
后端只选一组：

```bash
# firewalld（Fedora/RHEL 常见）
sudo firewall-cmd --permanent --zone=trusted --add-interface="${WIFI_HOTSPOT_IFACE:-ap0}"
sudo firewall-cmd --reload

# ufw（Debian/Ubuntu 常见）
sudo ufw allow in on "${WIFI_HOTSPOT_IFACE:-ap0}"
sudo ufw route allow in on "${WIFI_HOTSPOT_IFACE:-ap0}"

# 纯 nftables（没有 firewalld/ufw）：在现有 input 链放行，例如
sudo nft insert rule inet filter input iifname "${WIFI_HOTSPOT_IFACE:-ap0}" accept
```

firewalld 的典型症状：`nft list chain inet firewalld filter_INPUT_POLICIES` 末尾的
`reject with icmpx admin-prohibited` 会命中 `ap0` 的包；修复后该链里应出现
`iifname "ap0" jump filter_IN_trusted`（或 `accept`）。纯 nftables 记得把规则写进发行版的
防火墙配置或服务，而不是只做运行时插入。

验证 STA 未断开、AP 同信道且客户端可上网：

```bash
iw dev "${WIFI_HOTSPOT_IFACE:-ap0}" info
iw dev <STA> info
sudo /usr/local/bin/wifi-hotspot status
```

如果当前 STA 连接的是 5 GHz Wi-Fi，脚本会先发出警告；部分无线驱动或监管域
无法在 5 GHz 上同时运行 STA+AP，可能导致 hostapd 启动失败。遇到失败时，请优先
切换到普通 2.4 GHz Wi-Fi（不要使用 5 GHz SSID）后再执行 `start`。

## GNOME 快速设置（可选）

扩展只负责调用后端（脚本里已经用 `sudo -n`），不应直接调用 `nmcli ... hotspot`。安装目录名
必须与 `metadata.json` 的 `uuid` 完全一致，`shell-version` 按当前 GNOME 主版本生成：

```bash
src=./wifi-hotspot@local
uuid=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["uuid"])' "$src/metadata.json")
major=$(gnome-shell --version | awk '{print $3}' | cut -d. -f1)
ext="$HOME/.local/share/gnome-shell/extensions/$uuid"

mkdir -p "$ext"
cp "$src"/extension.js "$src"/stylesheet.css "$src"/README.md "$ext/"
python3 - "$src/metadata.json" "$ext/metadata.json" "$major" <<'PY'
import json, sys
src, dst, major = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(src))
data["shell-version"] = [major]
json.dump(data, open(dst, "w"), ensure_ascii=False, indent=2)
PY
gnome-extensions enable "$uuid" 2>/dev/null || true
```

Wayland 下新扩展目录要**注销并重新登录**后才会被 GNOME Shell 扫描到。重登后如果磁贴没出现，
再执行一次 `gnome-extensions enable "$uuid"`：它会同时把 uuid 从 `disabled-extensions` 中移除。
直接改 `gsettings` 的 `enabled-extensions` 无法覆盖 `disabled-extensions` 的优先级。其他桌面
环境只用后端脚本，跳过本节。

### 开发与调试（不注销看效果）

GNOME 45+ 的扩展以 ES module 加载，`gnome-extensions disable/enable` **不会**重新读取
`extension.js`（同一 URL 只 import 一次），D-Bus `ReloadExtension` 在 GNOME 50 已废弃，
`Alt+F2` + `r` 也已被删除。改 JS 必须重启 shell 进程；不要为看效果反复注销登录，而是把
shell 跑在嵌套实例里（`mutter-devkit` 窗口），用随附的 `gnome-ext-dev.sh` 在文件变化时
自动重启这个实例：

```bash
# 仅 GNOME 49+ 需要；GNOME < 49 会自动退回 --nested
sudo dnf install -y mutter-devkit

# 在技能目录下安装到 PATH
install -Dm755 ./wifi-hotspot@local/gnome-ext-dev.sh ~/.local/bin/gnome-ext-dev

gnome-ext-dev wifi-hotspot@local
# 也可以在技能目录下直接运行源码中的脚本
./wifi-hotspot@local/gnome-ext-dev.sh wifi-hotspot@local "$PWD/wifi-hotspot@local"
```

若在技能目录里直接开发，把已安装目录换成软链，避免每次复制（脚本默认监听已安装目录，
也可以第二参数显式传入源码目录：`gnome-ext-dev.sh <uuid> <src>`）：

```bash
# 在技能目录下执行；扩展源码位于含 metadata.json 的子目录
ext="$HOME/.local/share/gnome-shell/extensions/wifi-hotspot@local"
[ -e "$ext" ] && [ ! -L "$ext" ] && mv "$ext" "$ext.bak"
ln -s "$PWD/wifi-hotspot@local" "$ext"
```

脚本启动 `dbus-run-session -- gnome-shell --wayland --devkit`，轮询扩展目录的 mtime，
保存任意文件后杀掉并重启嵌套 shell（约 3 秒）；Ctrl-C 退出并清理。日志直接打在终端，
建议过滤：

```bash
gnome-ext-dev wifi-hotspot@local 2>&1 | grep -E 'JS ERROR|Gjs-|CRITICAL|HOTSPOT'
```

在 devkit 窗口里点右上角快速设置即可看到磁贴。注意：

- 嵌套实例与主会话共享 dconf、扩展目录和真实系统状态：点开关会真的执行
  `/usr/local/bin/wifi-hotspot start`（真实起停 `ap0`），不是沙箱。
- 只改 `stylesheet.css` 时不必重启：`gnome-extensions disable <uuid> &&
  gnome-extensions enable <uuid>` 会重新 `load_stylesheet()`，主会话立刻生效。
- 嵌套窗口用于快速迭代；最终仍需**注销并重新登录**，主会话才会加载新代码。
- 调试时可在代码里加 `console.log('HOTSPOT ...')`，再按上面的 grep 过滤；
  嵌套窗口里 `Alt+F2` → `lg` 打开 Looking Glass 可看扩展报错、执行表达式。

## 最小权限配置（可选）

不要复制带固定用户名的 sudoers 文件。按实际安装用户生成规则：

```bash
user="${SUDO_USER:-$USER}"
printf '%s ALL=(root) NOPASSWD: /usr/local/bin/wifi-hotspot\n' "$user" |
  sudo tee /etc/sudoers.d/wifi-hotspot >/dev/null
sudo chmod 0440 /etc/sudoers.d/wifi-hotspot
sudo visudo -cf /etc/sudoers.d/wifi-hotspot
sudo -n /usr/local/bin/wifi-hotspot status
```

只允许可信用户使用此规则：`set-config` 的参数会写入 root-owned 配置并控制 hostapd。

## 排错

- `sta_channel` 为空：STA 未连接，或 `iw` 输出格式/驱动不兼容；先确认 `iw dev <STA> info` 有 `channel`。
- 5 GHz 上 hostapd 启动失败：这是部分驱动的 STA+AP 限制；请切换到普通 2.4 GHz Wi-Fi 后重试。
- AP 启动后 STA 断开：检查驱动的接口组合和共信道限制；STA 漫游到新信道后需重新 `stop`/`start`。
- `ap0` 被 NetworkManager 接管：确认 `99-wifi-hotspot-ap.conf` 已加载，再重载 NetworkManager。
- 客户端已连接但无网络：检查 `sysctl net.ipv4.ip_forward`、`sudo nft list table inet wifi_hotspot`、`dnsmasq` 和 UDP 67 端口。
- 客户端拿不到 IP、hostapd 日志反复出现 associated/WPA 握手：大概率是防火墙没放行 `ap0`
  （firewalld 未分区 / ufw 未 `allow in` / nftables input 链 drop），见上文防火墙分支。
- 客户端 DNS 解析失败：部分 VPN 客户端（如深信服 EasyConnect）会在 `ip nat OUTPUT` 里
  把所有 `udp/53` DNAT 到本地端口，导致主机自身的解析器返回空应答；脚本因此默认把
  上行路由器的 DNS 直接下发给客户端（`--dhcp-option=option:dns-server`），绕过主机劫持。
- hostapd/dnsmasq 启动失败：查看 `journalctl -b` 及 `/run/wifi-hotspot/`，确认没有其他服务占用接口、DHCP 或 DNS 端口。

卸载前先停止热点，然后删除脚本、sudoers 规则、NetworkManager 未托管配置、防火墙放行规则
（firewalld trusted zone / ufw 规则 / nftables 规则）和 GNOME 扩展；最后重载 NetworkManager
并重新登录 GNOME。
