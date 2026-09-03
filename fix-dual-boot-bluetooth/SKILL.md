---
name: fix-dual-boot-bluetooth
description: Fix Bluetooth pairing conflicts between a dual-boot Windows/Linux system by extracting the Windows Link Key from its registry hive and injecting it into Linux's BlueZ key store. Use when the user reports Bluetooth earbuds/headphones that require re-pairing after every OS switch, or Bluetooth won't connect / returns "Permission denied" / br-connection-canceled on Linux after using Windows.
---

# Fix dual-boot Bluetooth conflict (Windows↔Linux)

Shared Bluetooth hardware between Windows and Linux causes one device to hold a
single Link Key slot for "the same host identity". Whichever OS re-pairs last
overwrites the key, so the other OS's pairing goes stale → re-pairing after
every switch. This is protocol-level; you cannot make two OSes each use their
own private key. The fix is to make BOTH OSes use the exact same Link Key, by
copying the key from the OS that currently pairs correctly into the other.

## Prerequisites / diagnosis

- Confirm it's the classic dual-boot symptom: earbuds need re-pairing after
  each switch, or `Permission denied (13)` / `br-connection-canceled` on Linux.
- We must align TWO things:
  1. **Adapter BD_ADDR** — must be identical on both systems.
  2. **Link Key** — must be identical on both systems.
- Linux adapter address: `bluetoothctl list` or `hciconfig hci0` (first line `BD Address:`).

## Step 1 — Mount Windows read-only

Windows Fast Startup/hibernation locks NTFS; use read-only mount (works despite lock):

```bash
udisksctl mount -b /dev/nvme0n1p3 -o ro   # device varies (Win11 label partition)
mount | grep ntfs                          # -> usually /media/$USER/Win11
```

`udisksctl` generally needs no root. Note: read-only avoids writing to the
locked partition; do NOT try a read-write mount (will fail on hibernated FS).

## Step 2 — Find the registry hive tools

The Link Key lives in Windows registry. Needed tooling:

```bash
pip3 install --user --break-system-packages regipy   # modern Py3 registry parser
# do NOT use old python-registry / "Registry" pip package - it is broken on Py3.13
```

Key registry locations (Win10/11):
- **Current (primary)**: `HKLM\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Keys\<adapter>\<device>`
  - hive file: `Windows/System32/config/SYSTEM`
  - Here, under the adapter key, each VALUE NAME is a device MAC (lowercase, no colons) and the value DATA is the 16-byte Link Key in hex. Also `CentralIRK` (LE identity resolving key).
- User-level (only if SYSTEM path empty): `HKCU\Software\Microsoft\Bluetooth\Keys` in `Users/<user>/ntuser.dat` — usually DPAPI-encrypted, harder.

## Step 3 — Extract the Link Key

regipy API notes (verified on Py3.13):
- `RegistryHive(path)` → `hive.get_key("ControlSet001")`, then traverse subkeys via `.iter_subkeys()`, `.name`.
- `get_key()` can raise `RegistryKeyNotFoundException` for root/empty paths — traverse with returned NKRecord objects instead.
- `rec.get_values()` returns a **list** (not dict) in this version; each item has `.name` and `.value`.
- Binary values print as `bytes`; use `.hex().upper()`.

Find the `BTHPORT` service under `ControlSet001\Services`, then `Parameters\Keys`:

```python
from regipy.registry import RegistryHive
h = RegistryHive("/media/who/Win11/Windows/System32/config/SYSTEM")

def find(rec, target, d=0):
    if d > 12: return None
    try: subs = list(rec.iter_subkeys())
    except Exception: return None
    for s in subs:
        if s.name.lower() == target: return s
    for s in subs:
        r = find(s, target, d+1)
        if r: return r
    return None

bth = find(h.get_key("ControlSet001"), "bthport")
params = find(bth, "parameters"); keys = find(params, "keys")

def vals(rec):
    out = []
    for v in rec.get_values():
        out.append((getattr(v,'name',None), getattr(v,'value',None)))
    return out

for adapter in keys.iter_subkeys():
    print("ADAPTER:", adapter.name)                  # e.g. d06578bc2b7b
    for name, dv in vals(adapter):
        if isinstance(dv, (bytes, bytearray)):
            print(f"  {name} = {dv.hex().upper()}")  # e.g. 0c1773e0ef5e = 6A6ACE...
```

The device MAC you're after is `0C:17:73:E0:EF:5E` → node name `0c1773e0ef5e`.
Record its value. **This must be active/valid** — if the OS that currently
pairs is Windows, the SYSTEM-hive key is the one to copy.

## Step 4 — Verify & confirm match

Confirm the Windows adapter BD_ADDR equals Linux's (`bluetoothctl list`). If
they differ you must also align them first — otherwise the copied key is keyed
to the wrong adapter address and will be ignored. In the Linux case no BlueZ
config mapped the address; the earbuds stored keys per-address.

## Step 5 — Inject the key into Linux BlueZ

Key store: `/var/lib/bluetooth/<ADAPTER_BDADDR>/<DEVICE_BDADDR>/info` (root-only,
mode 600). Build the info file, then restart bluetooth.

```bash
sudo mkdir -p /var/lib/bluetooth/D0:65:78:BC:2B:7B/0C:17:73:E0:EF:5E
sudo tee /var/lib/bluetooth/D0:65:78:BC:2B:7B/0C:17:73:E0:EF:5E/info >/dev/null <<'EOF'
[General]
Name=HUAWEI FreeBuds SE 3
Class=0x240404
SupportedTechnologies=BR/EDR;
Trusted=true
Blocked=false

[LinkKey]
Key=6A6ACE59C5C5C266DD1577E2E7C1FE1F
EOF
sudo chmod 600 /var/lib/bluetooth/D0:65:78:BC:2B:7B/0C:17:73:E0:EF:5E/info
sudo systemctl restart bluetooth
```

Notes:
- Non-interactive writing: the opencode/Bash session cannot read a sudo
  password from a prompt. Use `printf '<pw>\n' | sudo -S ...` if the user
  supplies the password, otherwise hand the user a copy-paste block.
- The `[LinkKey]` section is what matters; `Name/Class/SupportedTechnologies`
  are optional and just aid BlueZ. `Trusted=true` avoids re-prompting.

## Step 6 — Verify the connection

```bash
sleep 2
bluetoothctl connect 0C:17:73:E0:EF:5E
# expect: Paired: yes / Connected: yes / Connection successful
bluetoothctl info 0C:17:73:E0:EF:5E | grep -iE "Connected|Paired|Trusted"
```

Clean up temp files afterwards.

## Wiring notes

- After injecting, both systems share one Link Key → no more re-pairing.
- CRITICAL: tell the user never to "remove + re-pair" on either OS again —
  it generates a fresh key and invalidates the shared one. If a connection
  hiccups, use `bluetoothctl connect <mac>` directly, never `remove`.
- If pairing genuinely can't be made persistent (e.g. device only stores one
  key and user insists on switching), fall back to an automated re-pair script:
  `bluetoothctl remove <mac>` → `scan on` → `pair` → `trust` → `connect`.

## Related helper files (in project dir when created)

- `windows-bt-key.ps1` — alternative: extract on Windows side via PowerShell.
- `linux-import-key.sh` — inject a given key into BlueZ from the CLI.
- `bt-repair.sh` — automated re-pair fallback (mention in `bt-repair.sh`).
