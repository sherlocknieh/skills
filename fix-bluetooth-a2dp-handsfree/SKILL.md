---
name: fix-bluetooth-a2dp-handsfree
description: Fix a Linux bluetooth headset/earbud (PipeWire + WirePlumber + BlueZ) that only exposes the low-quality "Hands-Free / 免提 / HFP" audio profile and never offers the high-quality "Headset / A2DP / 高保真回放" channel. Use WHEN the A2DP sink is missing from sound settings, audio only works through the hands-free route, the earbud "used to work before", or BlueZ logs "a2dp-sink ... Device or resource busy" / "a2dp_select_capabilities() Unable to select SEP".
---

# Fix Bluetooth A2DP missing (only Hands-Free/HFP available)

## When to use
BT earbud/headset connects on Linux but:
- Sound settings only offer "Hands-Free / 免提 / Headset Head Unit (HFP)", never "Headset / A2DP / High Fidelity Playback".
- Output works but at low/phone quality; the stereo high-quality channel is absent.
- Device "used to work before and then stopped" — classic stuck A2DP transport state.
- BlueZ journal shows `a2dp-sink profile connect failed ... Device or resource busy` and/or `a2dp_select_capabilities() Unable to select SEP`.

Compatible: Ubuntu/Debian, PipeWire + WirePlumber (not PulseAudio-legacy), BlueZ 5.x, Intel AX211/common BT.

## Quick diagnosis (confirm it is this problem)
```bash
# 1. Does the bluez card even offer a2dp-sink? If ONLY off/headset-head-unit shows -> A2DP not enumerated.
pw-dump | grep -A2 '"device.name"' | grep -iE 'a2dp|headset|off'
# 2. Confirm the BlueZ connect failure:
journalctl --no-pager | grep -iE 'a2dp|select SEP|resource busy' | tail
```
Expected bad signatures: EnumProfile = `{off, headset-head-unit-cvsd, headset-head-unit}` only; journal has `Device or resource busy` + `Unable to select SEP`.

Important: check whether OTHER bluetooth headphones do A2DP fine on this machine
(`grep a2dp-sink ~/.local/state/wireplumber/default-routes`). If they do, the system/PipeWire is fine and this is a **device-specific stuck transport** — re-pair it.

## Root cause
When the earbud connects, the HFP/SCO (hands-free) link grabs the device first, so BlueZ's A2DP connect fails with `Device or resource busy` / `Unable to select SEP`. As a result `a2dp-sink` is never enumerated and never appears in settings. The state survives session restarts (it lives in the BlueZ/protocol layer), which is why it can persist until re-paired.

## Fix (fastest reliable path)

### 1. Re-pair the earbud (clears the stuck transport)
```bash
MAC=<device-mac>            # e.g. 64:A2:8A:E5:51:95  (bluetoothctl devices)
bluetoothctl remove $MAC
bluetoothctl scan on        # ask the user to put the earbuds into pairing mode (both buds in case, lid open, hold case button ~3s until light blinks white)
bluetoothctl scan off
bluetoothctl pair $MAC && bluetoothctl trust $MAC && bluetoothctl connect $MAC
# Confirm EnumProfile now exposes a2dp-sink / a2dp-sink-sbc_xq
pw-dump | grep -A2 '"device.name"' | grep -iE 'a2dp'
```
After re-pairing, `a2dp-sink` should be re-enumerated. Do **not** skip this step — it is the one that actually clears the stuck state.

### 2. Add a user-level WirePlumber config so it prefers A2DP (prevents recurrence)
Create `~/.config/wireplumber/wireplumber.conf.d/51-bluez-a2dp.conf`:
```conf
# Prefer A2DP; stop the low-quality hands-free profile from locking the device.
wireplumber.settings = {
  bluetooth.autoswitch-to-headset-profile = false,
}
monitor.bluez.properties = {
  bluez5.enable-hw-volume = true,   # MUST be true: false makes output very quiet (soft-only volume, can't drive the earbud's amp)
  bluez5.auto-connect = [ a2dp_sink ],
}
```

⚠️ Volume gotcha: with `bluez5.enable-hw-volume = false`, PipeWire only applies software volume so the earbud sounds **very quiet even at 100%** — the earbud's own hardware amp stays low. Keep it `true`. If audio is small after the fix, run `wpctl get-volume <sink-id>` (should be ~1.00) and confirm this setting is `true`.

### 3. Make the earbud's default profile the best A2DP
```bash
systemctl --user stop wireplumber
sed -i "s|^bluez_card\.$MAC=headset.*|bluez_card.$MAC=a2dp-sink-sbc_xq|" \
  ~/.local/state/wireplumber/default-profile   # sbc_xq = best quality; fallback a2dp-sink
systemctl --user start wireplumber
bluetoothctl connect $MAC
systemctl --user restart pipewire pipewire-pulse wireplumber   # if still stuck
```
Verify active profile: `pw-dump | grep -A2 '"device.name"' | grep -iE 'a2dp'` -> should be `a2dp-sink-sbc_xq`.

### 4. Sanity-check output
```bash
wpctl status | grep -iE 'Sinks:|Sources:|\*'   # earbud sink should be default "*"
```

## Gotchas / do NOT do these
- **Do not** use `pw-cli set-param <card> Profile ...` to switch the profile. It is unreliable and can write a wrong entry into the WirePlumber restore state, making the device default back to HFP. Use the sound-settings GUI or edit `~/.local/state/wireplumber/default-profile`.
- **Do not** try to strip HFP with `bluez5.roles = [ a2dp_sink ]` as a shortcut — it breaks the whole connection (`org.bluez.Error.Failed br-connection-create-socket`).
- **Do not** set `bluez5.enable-hw-volume = false` — it fixes nothing and makes output very quiet. Keep it `true`.
- Restarting `wireplumber`/`pipewire` drops the BT **audio** node (the device stays paired at BlueZ level but loses its audio graph). Re-run `bluetoothctl connect $MAC` after any restart; sometimes a `disconnect` + `connect` first is needed.
- Limiting codecs (`bluez5.codecs = [ sbc ]`) or `bluez5.auto-connect` alone will **not** fix an already-stuck transport; re-pairing is required.
- A2DP is output-only: the earbud mic is unavailable while in A2DP. That is expected. The user must switch to the "免提 / Headset Head Unit" profile if they need the mic for calls.
- "The earbud is also connected to a phone" is NOT the root cause when it used to work on this machine; the stuck transport is.

## Prevention / if it recurs
- Keep `~/.config/wireplumber/wireplumber.conf.d/51-bluez-a2dp.conf` (this is the main anti-regression measure).
- Don't keep mic/calling apps permanently grabbing the earbud mic (they force HFP).
- Recovery order (lightest first): switch profile in sound settings -> `bluetoothctl disconnect` + `connect` -> `systemctl --user restart wireplumber pipewire pipewire-pulse` -> **re-pair** (the most reliable reset).
- Open default routes: `~/.local/state/wireplumber/default-routes` may show other earbuds using `a2dp-sink` — used to confirm the SYSTEM A2DP works and the failing earbud is device-specific.
