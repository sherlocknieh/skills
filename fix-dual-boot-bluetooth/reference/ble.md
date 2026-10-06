# 子模块：低功耗蓝牙设备（手柄等）— LTK / EDIV / Rand / IRK

适用：`bluetoothctl info` 里 `SupportedTechnologies` 为 `LE;` 的设备（如 Xbox 手柄）。
Linux 侧涉及 `[LongTermKey]`（必需）与 `[IdentityResolvingKey]`，可能还有 `[LocalSignatureKey]`/`[RemoteSignatureKey]`。

## 需要哪些字段

| Linux 节.键 | 来自 Windows | 说明 |
| --- | --- | --- |
| `[LongTermKey] Key` | `LTK` | 加密密钥，**必需** |
| `[LongTermKey] EDiv` | `EDIV` | 十进制 |
| `[LongTermKey] Rand` | `ERand` | 十进制（Windows 是小端 8 字节） |
| `[LongTermKey] EncSize` | `KeyLength` | 通常 16 |
| `[LongTermKey] Authenticated` | — | 一般填 0 |
| `[IdentityResolvingKey] Key` | `IRK` | 仅在设备使用 RPA 时需要 |

## 字节序换算（关键，与 BR/EDR 不同）

- **`LTK` → `Key=`：原样照抄，不要反转。**
  （实测：反转会导致对端在加密阶段回 `Authentication Failure`。）
- **`EDIV` → `EDiv=`：Windows dword 直接转十进制**，如 `dword:00004f7f → 20351`。
- **`ERand` → `Rand=`：把 Windows 的 8 字节小端值反转后转十进制。**
  ```bash
  # ERand=7f,4b,96,9b,81,b5,6a,63 → 反转 → 636ab5819b964b7f → 7163737725551922047
  python3 -c "print(int.from_bytes(bytes.fromhex('7f4b969b81b56a63'),'little'))"
  ```
- **`IRK`/`CSRK`：各工具字节序处理不一致（有的原样、有的反转）。**
  仅当设备使用**可解析随机地址(RPA)** 时 IRK 才影响连接；若 info 里 `AddressType=public`
  则 IRK 用不上，保持原值不动即可。不确定就先用 btmon 确认是否真的需要。

## 场景 A：源为 Windows → 目标 Linux

1. 从 Windows 读子键
   `...\Keys\<控制器MAC小写>\<设备MAC小写>` 下的 `LTK`/`ERand`/`EDIV`/`IRK` 等（见主 SKILL.md 通用机制）。
2. 编辑 `/var/lib/bluetooth/<控制器MAC>/<设备MAC>/info`：

```ini
[IdentityResolvingKey]
Key=<IRK，原样或按上方说明；public 地址可不动>

[LongTermKey]
Key=<LTK，原样大写>
Authenticated=0
EncSize=16
EDiv=<EDIV 十进制>
Rand=<ERand 反转后的十进制>
```

3. `sudo systemctl start bluetooth`，然后按下面「验证」操作。

示例（Xbox 手柄）：

```ini
[LongTermKey]
Key=19E2DB9C014B7A6741475E6FBC31BDCF
Authenticated=0
EncSize=16
EDiv=20351
Rand=7163737725551922047
```

## 场景 B：源为 Linux → 目标 Windows

BLE 密钥在适配器键下的**子键**里（子键名 = 设备 MAC 小写，如 `2de4c6fd7b68`）。
换算规则是场景 A 的反过程：

- `LTK` = Linux `Key`，**原样小写**，`hex:3:`。
- `EDIV` = Linux `EDiv` 十进制 → `dword:`。
- `ERand` = Linux `Rand` 十进制 → 8 字节**小端** → `hex:11:`：
  ```bash
  python3 -c "print(','.join(f'{b:02x}' for b in (7163737725551922047).to_bytes(8,'little')))"
  # → 7f,4b,96,9b,81,b5,6a,63
  ```
- 子键里通常还有 `KeyLength`(dword:00000010)、`Address`(hex:11: 设备 MAC 反转 6 字节 + `,00,00`)、
  `AddressType`(dword:00000000) 等，`setval` 时**必须全部原样列出**，不能漏。

```bash
printf 'cd ControlSet001\\Services\\BTHPORT\\Parameters\\Keys\\<ctrl小写>\\<设备MAC小写>\nsetval <值个数>\nLTK\nhex:3:<小写LTK>\nKeyLength\ndword:00000010\nERand\nhex:11:7f,4b,...\nEDIV\ndword:00004f7f\nIRK\nhex:3:<IRK>\n...\ncommit\n' | sudo --askpass hivexsh -w /tmp/SYSTEM.work
```

> 类型速记：`hex:3:`=REG_BINARY，`hex:11:`=REG_QWORD（`ERand`/`Address` 用），`dword:`=DWORD。

## 验证（BLE 必做）

```bash
setsid btmon -w /tmp/btmon.log >/dev/null 2>&1 & BPID=$!
sleep 2 && timeout 20 bluetoothctl connect <设备MAC>
kill $BPID; btmon -r /tmp/btmon.log | grep -iE "LE Start Encryption|Long term key|Reason:|Encryption Change"
```

- `Encryption: Enabled` → 成功。
- `Reason: Authentication Failure (0x05)` → EDIV/Rand 匹配上了但 **LTK 值不对**，试反转或换源。
- `Reason: PIN or Key Missing (0x06)` → **EDIV/Rand 不对**（对端没找到对应密钥）。

最后 `bluetoothctl info <设备MAC>` 应显示 `Connected: yes`；手柄还应生成输入设备
（`/proc/bus/input/devices` 或 `dmesg | grep -i xbox`）。
