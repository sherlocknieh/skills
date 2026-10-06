---
name: fix-dual-boot-bluetooth
description: 修复 Windows/Linux 多系统之间的蓝牙配对冲突。适用于用户反馈蓝牙耳机/手柄/鼠标等设备每次切换操作系统后都需要重新配对，或在 Windows 使用蓝牙后 Linux 无法连接/返回“Permission denied”/br-connection-canceled 的情况。覆盖经典蓝牙(BR/EDR, LinkKey)与低功耗蓝牙(BLE, LTK/IRK/EDIV/Rand)两类设备。关键词：蓝牙、双系统、配对、LinkKey、LTK、IRK、BLE、手柄、Xbox、耳机、bluetoothctl、btmon、BTHPORT。
---

# 双系统蓝牙配对冲突修复

本文只讲**基本思路与通用流程**；两类设备的具体密钥字段与字节序换算见子模块：

- 经典蓝牙（耳机/鼠标，LinkKey）→ [`reference/classic.md`](reference/classic.md)
- 低功耗蓝牙（手柄等，LTK/IRK/EDIV/Rand）→ [`reference/ble.md`](reference/ble.md)

> 子文件不会自动加载，进入第 4 步时必须**读取**对应子模块（路径相对本 SKILL.md 所在目录）。

## 核心原理

多系统共用同一块蓝牙硬件（相同的控制器 MAC）。设备对同一个主机 MAC 只存一份密钥，
所以设备仅记住“最近一次配对的操作系统”的密钥。两个系统各自的密钥不一致 → 切换系统
后另一个系统无法连接，需要重新配对。

设备分两类，修复内容不同：

| 类型 | 典型设备 | 使用的密钥 | Linux 配置节 | 子模块 |
| --- | --- | --- | --- | --- |
| 经典蓝牙 BR/EDR | 多数音频耳机、鼠标 | 一个 **LinkKey**(16 字节) | `[LinkKey]` | `reference/classic.md` |
| 低功耗蓝牙 BLE | Xbox 手柄、部分 TWS 耳机 | **LTK + EDIV + Rand**（+ IRK/CSRK） | `[LongTermKey]`、`[IdentityResolvingKey]` | `reference/ble.md` |

**解法：** 让两个系统使用同一份密钥。以“最近一次配对的操作系统”为源，把它的密钥写入
其他系统的蓝牙配置，之后二者密钥一致，不再需要重新配对。BR/EDR 与 BLE 的字节序处理
**不同**，务必按对应子模块操作。

> 务必先用 `bluetoothctl show` 确认控制器 MAC，且 Linux(`/var/lib/bluetooth`) 与
> Windows(`BTHPORT` 注册表) 里的控制器 MAC 必须一致，否则说明不同机硬件，不能这样修。

---

## 修复流程总览

1. 确认要修的设备、判断类型（第 1 步）
2. 扫描本机所有操作系统（第 2 步）
3. 确定“最近配对的操作系统”作为密钥源，读取源密钥（第 3 步）
4. 把密钥写入另一个系统（第 4 步 → 按类型进子模块）
5. 重启蓝牙/落盘，验证连接（第 5 步）

## 第 1 步：询问用户要修复的蓝牙设备

- 用 `bluetoothctl devices` 列出已识别设备（MAC + 名称）。
- 用 `bluetoothctl info <MAC>` 确认设备已配对（Paired/Bonded: yes）。
- **判断设备类型**（决定后面的写法）：看 info 里的 `SupportedTechnologies`。
  - 含 `BR/EDR` → 经典设备，走 `reference/classic.md`。
  - 仅 `LE;`（如 Xbox 手柄）→ BLE 设备，走 `reference/ble.md`。
- 询问用户修复哪一个（可能同时修复多个，逐个处理）。

## 第 2 步：扫描该机器上安装的所有操作系统

```bash
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT,PARTLABEL
```

- 找 Linux 根分区（当前系统）和 Windows NTFS 分区（如 `LABEL=Win11`）。
- 只修复“Linux + Windows”组合。纯数据盘（如 Ventoy）忽略。

## 第 3 步：确定密钥源并读取源密钥

如果当前启动的系统是 Windows，先建议用户重启到 Linux 继续操作；在 Linux 下修复更方便。

**先确定“最近配对的操作系统”**（询问用户：哪个系统现在能直接连接、无需重新配对）。
此系统的密钥就是设备当前保存的密钥 → 作为源。

- **Linux 侧密钥：**
  ```bash
  sudo --askpass cat /var/lib/bluetooth/<控制器MAC>/<设备MAC>/info
  # 经典设备：读 [LinkKey] 的 Key=
  # BLE 设备：读 [LongTermKey] 的 Key/EDiv/Rand，以及 [IdentityResolvingKey] 的 Key
  ```
  （目录权限为 root，需 sudo。）
- **Windows 侧密钥（源为 Windows 时）：** 见第 4 步通用机制。
  - 经典设备：密钥是适配器键下的一个**值**，值名 = 设备 MAC(小写)、16 字节 REG_BINARY。
  - BLE 设备：密钥在适配器键下的一个**子键**（子键名 = 设备 MAC 小写）里，包含
    `LTK`、`KeyLength`、`ERand`、`EDIV`、`IRK`、`CSRK` 等值。

记录：控制器 MAC、设备 MAC、源系统密钥。

## 第 4 步：把密钥写入另一个系统

### 通用机制

**目标为 Linux（源为 Windows）**

```bash
sudo --askpass systemctl stop bluetooth
sudo --askpass cp -a /var/lib/bluetooth/<控制器MAC>/<设备MAC>/info /tmp/bt-info.bak
# 按子模块编辑 info（保持 root:root 600）
sudo --askpass systemctl start bluetooth
```

**目标为 Windows（源为 Linux）**

1. 挂载并备份 SYSTEM hive（写之前必须备份）：
   ```bash
   sudo --askpass mount -o rw /dev/nvme1n1p3 /mnt/win
   sudo --askpass cp /mnt/win/Windows/System32/config/SYSTEM /tmp/SYSTEM.bak
   ```
2. 读取活动 ControlSet（hivexsh，先装 `dnf install -y hivex chntpw`）：
   ```bash
   printf 'cd Select\nlsval\n' | sudo --askpass hivexsh /mnt/win/Windows/System32/config/SYSTEM
   # Select\Current 的 dword（通常 00000001）→ ControlSet001
   printf 'cd ControlSet001\\Services\\BTHPORT\\Parameters\\Keys\\<控制器MAC小写>\\lsval\n' | \
     sudo --askpass hivexsh /mnt/win/Windows/System32/config/SYSTEM
   ```
3. 改**工作副本**再写回；`setval` 会清空当前节点再重建，**必须把该节点原有的所有值成对列全**：
   ```bash
   sudo --askpass cp /mnt/win/Windows/System32/config/SYSTEM /tmp/SYSTEM.work
   printf 'cd <路径>\nsetval <值个数>\n<值名>\n<值>\n...\ncommit\n' | \
     sudo --askpass hivexsh -w /tmp/SYSTEM.work
   printf 'cd <路径>\nlsval\n' | sudo --askpass hivexsh /tmp/SYSTEM.work   # 校验
   sudo --askpass cp -p /tmp/SYSTEM.work /mnt/win/Windows/System32/config/SYSTEM
   rm -f /tmp/SYSTEM.work
   ```
   值类型写法：REG_BINARY=`hex:3:aa,bb,...`，REG_QWORD=`hex:11:...`（如 `ERand`/`Address`），
   字符串=`"..."`，DWORD=`dword:00000000`。
4. 卸载落盘：`sudo --askpass sync && sudo --askpass umount /mnt/win`

### 按设备类型分流

- **经典设备（耳机/鼠标）** → 读取并执行 [`reference/classic.md`](reference/classic.md)
- **BLE 设备（手柄等）** → 读取并执行 [`reference/ble.md`](reference/ble.md)

## 第 5 步：验证

```bash
bluetoothctl info <设备MAC> | grep -E "Connected|Paired|Bonded"
```

BLE 设备必须额外用 `btmon` 确认加密成功，详见 `reference/ble.md`。

---

## 关键注意事项

- **Fast Startup / 休眠：** 若 Windows 存在非 0 的 `hiberfil.sys`（快速启动/休眠），
  修改登入注册表后必须用 **“重启”(Restart)** 启动 Windows（或关掉快速启动后彻底关机），
  即 `powercfg /hibernate off`，否则 Windows 恢复到旧内存镜像，改动不生效。
- **权限：** `/var/lib/bluetooth` 与写注册表均需 `sudo --askpass`（见本仓库规则）。
- **恢复备份：** `sudo cp /tmp/SYSTEM.bak /mnt/win/Windows/System32/config/SYSTEM`（先 rw 挂载）；
  Linux info 备份在 `/tmp/bt-info.bak`。
- **逐个设备处理：** 多个设备逐个重复第 3-4 步；`setval` 时要保留其他设备值与 `CentralIRK`。
- **对码失败：** 若首次进入 Windows 仍未自动连接，给设备断电（放回充电仓/关机）几秒再开机激活。
