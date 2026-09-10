---
name: force-bluetooth-a2dp
description: 修复蓝牙耳机默认连接成"免提/HFP"(音质差、单声道)而不是 A2DP 高保真的问题。适用于用户反馈某个蓝牙耳机(如 HUAWEI FreeBuds SE 3/SE 4)每次连接都走 headset-head-unit / HSP/HFP，或想让耳机永远只用 A2DP、彻底禁用免提与麦克风。关键词：蓝牙、免提、HFP、HSP、A2DP、WirePlumber、PipeWire、bluez5.roles。
---

# 强制蓝牙耳机使用 A2DP

处理 Linux (PipeWire + WirePlumber) 下蓝牙耳机默认连到"免提(HFP/HSP)"而非 A2DP 的问题。

## 1. 诊断

```bash
bluetoothctl devices                      # 列出已配对设备及其 MAC
bluetoothctl info <MAC>                   # 看 Class / Icon / UUID(是否含 Handsfree、Audio Source)
pactl list cards | grep -EA30 "<MAC去冒号转下划线>"
```

关注两处：

- **持久化状态**（最常见根因）：
  ```bash
  cat ~/.local/state/wireplumber/default-profile
  cat ~/.local/state/wireplumber/bluetooth-autoswitch
  ```
  若出现 `bluez_card.<MAC>=headset-head-unit` 或 `saved-headset-profile:...=headset-head-unit`，
  说明 WirePlumber 记住了该设备的 HFP，重连时会恢复。

- **设备类别差异**（次要）：`bluetoothctl info` 里
  - `Class: 0x...0404` = Wearable Headset Device → icon `audio-headset`
  - `Class: 0x...0418` = Headphones → icon `audio-headphones`

## 2. 原理

WirePlumber 选择 profile 的顺序（`/usr/share/wireplumber/scripts/device/`）：

1. `state-profile.lua:46` 先查已存 profile，命中就直接恢复（所以会一直恢复 HFP）；
2. 未命中才走 `find-best-profile.lua`，按优先级选，A2DP(133) > HFP(6)。

`autoswitch-bluetooth-profile.lua` 只在有录音(capture)流接入时临时切 HFP，结束后切回，且它写状态时 `save=false`，一般不会污染 `default-profile`。

## 3. 清掉错误的持久化记忆

```bash
systemctl --user stop wireplumber
cp -a ~/.local/state/wireplumber/default-profile{,.bak}
cp -a ~/.local/state/wireplumber/bluetooth-autoswitch{,.bak}
# 编辑两个文件，删除含目标 MAC 的行，保留表头 [default-profile] / [bluetooth-autoswitch]
systemctl --user start wireplumber
bluetoothctl connect <MAC>        # 重连后应显示 活动配置：a2dp-sink
```

之后连接默认 A2DP；通话/录音时仍会临时切 HFP 再切回。

## 4.彻底禁用 HFP（可选）

在 `~/.config/wireplumber/wireplumber.conf.d/51-disable-bt-hfp.conf` 写：

```
monitor.bluez.properties = {
  bluez5.roles = [ a2dp_sink a2dp_source ]
}
```

```bash
systemctl --user restart wireplumber
bluetoothctl connect <MAC>
pactl list cards | grep -EA30 "<MAC>"   # headset-head-unit 应完全消失，只剩 a2dp-sink*
```

**关键坑**：`bluez5.roles` 是**全局**的。源码 `spa/plugins/bluez5/bluez5-dbus.c` 的
`parse_roles()` 只在 monitor 初始化时读一次（`impl_init` 传入的 monitor `info`），
**不能按设备区分**。用 `monitor.bluez.rules` 的 `update-props` 给单个设备设
`bluez5.roles` 无效（profile 不会消失）。因此"只对某一个耳机禁用 HFP"做不到，
要么全局禁用，要么用方案 A。

## 5. 相关设置项（`~/.config/wireplumber/wireplumber.conf.d/` 里可覆盖）

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| `bluetooth.autoswitch-to-headset-profile` | true | 录音时自动切 HFP；设 false 则永不自动切（全局） |
| `bluetooth.use-persistent-storage` | true | 记住蓝牙耳机模式；设 false 不再记忆 HFP |
| `device.restore-profile` | true | 记住/恢复设备 profile（即 `default-profile` 文件） |

## 6. 注意

- 修改 `~/.config/wireplumber/` 下配置后需 `systemctl --user restart wireplumber`。
- 重启 WirePlumber 会断开当前蓝牙音频连接，需重新 `bluetoothctl connect`。
- 恢复全局 HFP：删除 `51-disable-bt-hfp.conf` 并重启 WirePlumber，或在 `bluez5.roles` 里加回 `hfp_hf hfp_ag hsp_hs hsp_ag`。
