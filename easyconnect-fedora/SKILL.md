---
name: easyconnect-fedora
description: 在 Fedora（44+，GNOME/Wayland）上安装、修复、卸载深信服 EasyConnect SSLVPN 客户端。适用于 EasyConnect 一启动就段错误(SIGSEGV)、界面中文显示成"豆腐块"方框、dnf 安装 rpm 失败、需要重打二进制补丁或彻底卸载恢复系统。关键词：EasyConnect、深信服、SSLVPN、sangfor、rpm -ivh、gtk2、dbus-glib、harfbuzz、hb_ 符号、段错误、豆腐块、字体。
---

# Fedora 安装/修复 EasyConnect

Fedora 上安装深信服 EasyConnect 7.6.7 的完整流程与踩坑修复。三个核心问题：
rpm 安装方式、启动段错误（harfbuzz 符号抢占）、中文豆腐块（字体）。

## 0. 适用范围与产物

- 验证环境：Fedora 44 Workstation，GNOME / Wayland，用户 `who`。
- 安装包：`EasyConnect_x64_7_6_7_3.rpm`
  - 下载：`http://download.sangfor.com.cn/download/product/sslvpn/pkg/linux_767/EasyConnect_x64_7_6_7_3.rpm`
  - sha256：`f05d6620a8bd4425b98b5fb841971eb2789856a6238fce351adb80b42d96c2d8`
  - 包版本：`easyconnect-7.6.7.7.-1.el6.x86_64`

## 1. 安装（必须用 rpm，不能用 dnf）

`dnf install` 会因 dnf5 的离线事务（offline transaction）冲突而失败，且该包无有效签名/摘要，
所以直接用 rpm：

```bash
sudo rpm -ivh --nodigest --nofiledigest /path/to/EasyConnect_x64_7_6_7_3.rpm
```

补依赖（缺库时报 `libgtk-x11-2.0.so.0` / `libdbus-glib-1.so.2` 找不到）：

```bash
sudo dnf install -y gtk2
sudo dnf install -y dbus-glib
sudo dnf install -y google-noto-sans-cjk-fonts wqy-microhei-fonts wqy-zenhei-fonts
```

安装位置：

- 程序：`/usr/share/sangfor/EasyConnect/`
- 桌面项：`/usr/share/applications/EasyConnect.desktop`
- 服务：`/usr/lib/systemd/system/EasyMonitor.service`（rpm 脚本自动 enable，软链在
  `/etc/systemd/system/multi-user.target.wants/`）

## 2. 修复启动段错误：harfbuzz 符号抢占（**关键**）

**现象**：EasyConnect 一启动就在 pango/harfbuzz 中 SIGSEGV。

**根因**：自带旧版 harfbuzz 把 274 个 `hb_*` 符号导出为全局符号，运行时抢占系统
libharfbuzz（Fedora 14.x）的符号解析，ABI 不匹配崩溃。EasyConnect 是 `ET_EXEC`
（非 PIE），无法 dlopen 隔离，只能改它的导出符号。

**修复**：用本目录的 `patch_hb_symbols.py` 做「保桶重命名」——改 `hb_*` 前缀并同步
更新 ELF `.gnu.hash`（chain 哈希 + bloom 位），对外不抢占系统库，对内仍能解析自身符号。

```bash
# 1) 先备份原版（只需一次，之后可确定性复现补丁）
sudo cp /usr/share/sangfor/EasyConnect/EasyConnect \
        /usr/share/sangfor/EasyConnect/EasyConnect.orig

# 2) 打补丁
cp /usr/share/sangfor/EasyConnect/EasyConnect.orig /tmp/ec_orig
python3 <本技能目录>/patch_hb_symbols.py /tmp/ec_orig /tmp/ec_patched
sudo cp /tmp/ec_patched /usr/share/sangfor/EasyConnect/EasyConnect
sudo chmod 755 /usr/share/sangfor/EasyConnect/EasyConnect
sudo restorecon /usr/share/sangfor/EasyConnect/EasyConnect
```

脚本会打印「已重命名 274 个 hb_* 符号」。预期 sha256：

| 文件 | sha256 |
|---|---|
| `EasyConnect.orig` | `bc7613b82e207a84e94ba40a9e65a99e4507aa08264f53c14760446cb7a58149` |
| 打补丁后 `EasyConnect` | `d11c808d1827343f2cae5fa4569cd6ae014c4c658dc28115447625a383ec09c2` |

**升级 EasyConnect 后必须重新打补丁。** 恢复原版：把 `.orig` 拷回即可（会重新段错误，仅用于还原）。

用法：`python3 patch_hb_symbols.py <输入ELF> <输出ELF>`（支持 64 位小端 ELF）。

## 3. 修复中文豆腐块（字体）

**根因**：Web UI CSS 字体栈为 `"PingFangSC-Regular","Microsoft Yahei","宋体",...` 全是
macOS/Windows 字体；且旧版 Chromium 无法处理 Fedora 默认的 Noto CJK 可变字体（VF）。

**修复**：

1. 装静态中文字体（见第 1 节）。
2. 把 `<本技能目录>/fontconfig-fonts.conf` 安装为 `~/.config/fontconfig/fonts.conf`：
   ```bash
   mkdir -p ~/.config/fontconfig
   cp <本技能目录>/fontconfig-fonts.conf ~/.config/fontconfig/fonts.conf
   fc-cache -f
   ```
   该配置：排除 Noto CJK 可变字体；把 `PingFang SC`/`PingFangSC-*`/`Microsoft Yahei`
   映射到 `Noto Sans CJK SC`；`宋体`/`SimSun` 映射到 `Noto Serif CJK SC`；让
   `sans-serif` 弱优先 `Noto Sans CJK SC`。

验证：

```bash
fc-match "PingFangSC-Regular:lang=zh"   # 应输出 NotoSansCJK-Regular.ttc
```

## 4. 启动

桌面项 `Exec` 即：

```bash
/usr/share/sangfor/EasyConnect/EasyConnect --enable-transparent-visuals --disable-gpu
```

非交互会话中手工测试需 `setsid` 完全脱离父 shell，否则会随 shell 退出。
程序会拉起 systemd 服务 `EasyMonitor` 和进程 `ECAgent`。
用户配置在 `~/.config/EasyConnect/`（Cookies/配置，可安全删除）。

## 5. 卸载 / 恢复（按顺序）

```bash
sudo systemctl disable --now EasyMonitor.service
sudo dnf remove easyconnect      # 报错则改用 sudo rpm -e easyconnect

rm -rf ~/.config/EasyConnect
rm -f  ~/.config/fontconfig/fonts.conf
rmdir  ~/.config/fontconfig 2>/dev/null

# 仅当确认无其它软件需要时才卸载依赖：
sudo dnf remove gtk2 dbus-glib
sudo dnf remove google-noto-sans-cjk-fonts wqy-microhei-fonts wqy-zenhei-fonts
fc-cache -f
```

> `gtk2`/`dbus-glib`/中文字体可能是其它软件也需要的通用库；中文字体若系统本来就需要，
> 可保留，只删 `fonts.conf` 里针对 EasyConnect 的映射即可。
