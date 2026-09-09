---
name: fix-dual-boot-bluetooth
description: 修复 Windows/Linuxs 多系统之间的蓝牙配对冲突。适用于用户反馈蓝牙耳机每次切换操作系统后都需要重新配对，或在 Windows 使用蓝牙后 Linux 无法连接/返回“Permission denied”/br-connection-canceled 的情况。
---

# 双系统蓝牙配对冲突修复

## 核心原理

多系统共用同一块蓝牙硬件（相同的控制器 MAC）。耳机对同一个主机 MAC 只存一份密钥，
所以耳机仅记住“最近一次配对的操作系统”的密钥。两个系统各自的密钥不一致 → 切换系统
后另一个系统无法连接，需要重新配对。

**解法：** 让两个系统使用同一份密钥。以“最近一次配对的操作系统”为源，把它的密钥写入
其他系统的蓝牙配置，之后二者密钥一致，不认重新配对。

> 务必先用 `bluetoothctl show` 确认控制器 MAC，且 Linux(`/var/lib/bluetooth`) 与
> Windows(`BTHPORT` 注册表) 里的控制器 MAC 必须一致，否则说明不同机硬件，不能这样修。

---

## 第 1 步：询问用户要修复的蓝牙设备

- 用 `bluetoothctl devices` 列出已识别设备（MAC + 名称）。
- 用 `bluetoothctl info <MAC>` 确认设备已配对（Paired/Bonded: yes）。
- 询问用户修复哪一个（可能同时修复多个）。

## 第 2 步：扫描该机器上安装的所有操作系统

```bash
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT,PARTLABEL
```

- 找 Linux 根分区（当前系统）和 Windows NTFS 分区（如 `LABEL=Win11`）。
- 只修复“Linux + Windows”组合。纯数据盘（如 Ventoy）忽略。

## 第 3 步：从最近一次配对蓝牙的操作系统中获取蓝牙设备的配对信息

如果当前启动的系统是 Windows，先建议用户重启到 Linux 继续操作; 
因为在 Linux 下修复更方便。

**先确定“最近配对的操作系统”**（询问用户：哪个系统现在能直接连接、无需重新配对）。
此系统的密钥就是耳机当前保存的密钥 → 作为源。

- **Linux 侧密钥：**
  ```bash
  sudo --askpass cat /var/lib/bluetooth/<控制器MAC>/<设备MAC>/info
  # 读 [LinkKey] 下的 Key=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  ```
  （目录权限为 root，需 sudo。）
- **Windows 侧密钥（用在“源为 Windows”的场景）：** 见第 4 步的读取方式。

记录：控制器 MAC、设备 MAC、源系统密钥。

## 第 4 步：将配对信息写入其他操作系统的蓝牙配置文件中

### 目标为 Linux（源为 Windows 时）

编辑 `/var/lib/bluetooth/<控制器MAC>/<设备MAC>/info`，把 `[LinkKey] Key=` 改为 Windows 的密钥，
然后 `sudo systemctl restart bluetooth`。

### 目标为 Windows（源为 Linux 时，最常见）

1. 挂载 Windows NTFS 分区读写：
   ```bash
   sudo --askpass umount /mnt/win 2>/dev/null
   sudo --askpass mount -o rw /dev/nvme1n1p3 /mnt/win
   ```

2. **备份 SYSTEM 注册表 hive**（写之前必须备份）：
   ```bash
   sudo --askpass cp /mnt/win/Windows/System32/config/SYSTEM /tmp/SYSTEM.bak
   ```

3. **读取活动 ControlSet 与现有密钥**（hivexsh，先装 `dnf install -y hivex chntpw`）：
   ```bash
   printf 'cd Select\nlsval\n' | sudo --askpass hivexsh /mnt/win/Windows/System32/config/SYSTEM
   # Select\Current 的 dword 值（通常 00000001）→ ControlSet001
   printf 'cd ControlSet001\\Services\\BTHPORT\\Parameters\\Keys\\<控制器MAC小写>\\lsval\n' | \
     sudo --askpass hivexsh /mnt/win/Windows/System32/config/SYSTEM
   ```
   该键下有若干 REG_BINARY 值：值名就是设备 MAC（小写），`CentralIRK` 为控制器密钥。
   找到目标设备的 16 字节值 = 现有的 Windows 密钥。

4. **改用工作副本再写回**，用 `setval` 时**必须重新列出该节点所有值**（`setval` 会清空当前节点再重建）：
   ```bash
   sudo --askpass cp /mnt/win/Windows/System32/config/SYSTEM /tmp/SYSTEM.work
   printf 'cd ControlSet001\\Services\\BTHPORT\\Parameters\\Keys\\<ctrl小写>\nsetval 3\nCentralIRK\nhex:3:<原值>\n<设备MAC小写>\nhex:3:<新Linux密钥>\ncommit\n' | \
     sudo --askpass hivexsh -w /tmp/SYSTEM.work
   # 校验
   printf 'cd ControlSet001\\Services\\BTHPORT\\Parameters\\Keys\\<ctrl小写>\nlsval\n' | sudo --askpass hivexsh /tmp/SYSTEM.work
   sudo --askpass cp -p /tmp/SYSTEM.work /mnt/win/Windows/System32/config/SYSTEM
   rm -f /tmp/SYSTEM.work
   ```
   注意：`hex:3:` 为 REG_BINARY；`setval <n>` 后按“值名 换行 值(hex:类型:字节)”成对列 n 组。

5. 卸载并落盘：
   ```bash
   sudo --askpass sync && sudo --askpass umount /mnt/win
   ```

---

## 关键注意事项

- **Fast Startup / 休眠：** 若 Windows 存在非 0 的 `hiberfil.sys`（快速启动/休眠），
  修改登入注册表后必须用 **“重启”(Restart)** 启动 Windows（或关掉快速启动后彻底关机），
  即 `powercfg /hibernate off`，否则 Windows 恢复到旧内存镜像，改动不生效。
- **权限：** `/var/lib/bluetooth` 与写注册表均需 `sudo --askpass`（见本仓库规则）。
- **恢复备份：** `sudo cp /tmp/SYSTEM.bak /mnt/win/Windows/System32/config/SYSTEM`（先 rw 挂载）。
- **逐个设备处理：** 若有多个耳机，每个都重复步骤 3-4；`setval` 时要保留其他设备值与 `CentralIRK`。
- **对码失败：** 若首次进入 Windows 仍未自动连接，给耳机断电（放回充电仓/关机）几秒再开机激活。
