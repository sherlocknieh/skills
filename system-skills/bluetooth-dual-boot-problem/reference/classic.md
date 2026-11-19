# 子模块：经典蓝牙设备（耳机 / 鼠标）— LinkKey

适用：`bluetoothctl info` 里 `SupportedTechnologies` 含 `BR/EDR` 的设备（多数音频耳机、鼠标）。
只涉及**一个** 16 字节 LinkKey。

## 字节序

**原样照抄，不要反转。** 无论源是 Windows 还是 Linux，两边 LinkKey 字节序一致。
（Windows 的 LinkKey 是适配器键下、值名 = 设备 MAC(小写) 的一个 REG_BINARY 值。）

## 场景 A：源为 Windows → 目标 Linux

1. 从 Windows 读出该设备的 16 字节值（见主 SKILL.md 第 4 步通用机制）。
2. 编辑 `/var/lib/bluetooth/<控制器MAC>/<设备MAC>/info`：

```ini
[LinkKey]
Key=<Windows 值，大写，原样>
Type=4
PINLength=0
```

3. `sudo systemctl start bluetooth`，`bluetoothctl connect <设备MAC>` 验证。

示例：

```ini
[LinkKey]
Key=51F9C5871745E119858BCFA14F4BE384
Type=4
PINLength=0
```

## 场景 B：源为 Linux → 目标 Windows

1. 从 Linux 读 `[LinkKey] Key=`。
2. 在 Windows SYSTEM hive 的
   `ControlSet001\Services\BTHPORT\Parameters\Keys\<控制器MAC小写>` 节点，
   用工作副本 + `setval` 写回，**保留 `CentralIRK` 及其它设备值**：

```bash
printf 'cd ControlSet001\\Services\\BTHPORT\\Parameters\\Keys\\<ctrl小写>\nsetval 3\nCentralIRK\nhex:3:<原值>\n<设备MAC小写>\nhex:3:<小写LinkKey>\ncommit\n' | \
  sudo --askpass hivexsh -w /tmp/SYSTEM.work
```

3. 校验后 `cp -p` 回 SYSTEM，`sync` 并卸载（同主 SKILL.md）。
4. Windows 侧若有快速启动/休眠，必须走“重启”或先 `powercfg /hibernate off`。

## 手工重配（万一对码失败）

给设备断电（放回充电仓/关机）几秒再开机，触发重新配对。
