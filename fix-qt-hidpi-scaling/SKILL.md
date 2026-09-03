---
name: fix-qt-hidpi-scaling
description: Fix HiDPI / high-DPI scaling problems on Qt apps (especially Deepin / DTK Ubuntu-compat tools like deepin-deb-installer) that render with wrong UI, font, or window sizes on high-resolution screens (e.g. 3072x1920 @ 200% GNOME). Use when a Qt app's window or in-app text/buttons are too small or too large, when GSettings scaling is set but a specific app ignores it, or when a Qt app launched from the file manager looks different from when launched from a terminal.
---

# Fix Qt / Deepin HiDPI scaling problems (Ubuntu, high-res + GNOME)

Symptom: a Qt app (often a Deepin/DTK tool ported to Ubuntu, e.g.
`deepin-deb-installer`) shows wrong UI size on a high-DPI display. Two distinct
sub-symptoms have different root causes and fixes:

- **Whole window too small OR too large** → window scaling (widget) issue.
- **Window size OK but in-app text/buttons too large** → font scaling overlapped.

## Step 1 — Gather environment facts (always do this first)

```bash
echo "SESSION=$XDG_SESSION_TYPE  (wayland/x11)"
echo "DISPLAY=$DISPLAY  WAYLAND=$WAYLAND_DISPLAY"
# The screen's actual logical scale in GNOME (here 2.0 = 200%):
gdbus call --session --dest org.gnome.Mutter.DisplayConfig \
  --object-path /org/gnome/Mutter/DisplayConfig \
  --method org.gnome.Mutter.DisplayConfig.GetCurrentState 2>&1 \
  | grep -oE "scale=[0-9.]+" | sort | uniq -c
# physical resolution:
xrandr 2>/dev/null | grep -E "\*"
# Qt toolchain:
ldd /usr/bin/deepin-deb-installer 2>/dev/null | grep -iE "libQt[0-9]|libdtk|libDtk"
```

Key takeaways:
- Confirm the **actual GNOME scale** (e.g. `2.0`). Physical ≈ logical × scale.
- Confirm **Qt version** (Qt5 uses `QT_SCALE_FACTOR` + `QT_FONT_DPI`; Qt6 mostly
  self-detects via Wayland).

## Step 2 — Determine which platform plugin the app actually loads

Deepin ships its **own** platform plugins (`libdwayland.so` = `dwayland`,
`libdxcb.so` = `dxcb`). On non-Deepin desktops (GNOME) these plugins get no
scaling info from a Deepin session daemon and fall back to wrong values.

```bash
QT_DEBUG_PLUGINS=1 timeout 6 deepin-deb-installer 2>&1 | grep -iE "wayland|xcb|dxcb|selected|loaded"
```

If you see `qt.qpa.wayland` / `dwayland` in the log, the app went through
Deepin's Wayland plugin → unreliable on GNOME. The robust remedy is to force the
**standard** X11 backend via `QT_QPA_PLATFORM=xcb`.

## Step 3 — Fix window scaling (whole-window incorrect)

Force X11 backend and set the scale explicitly. This bypasses Deepin plugin
DPI detection and stops double-scaling.

```bash
# One-off terminal test:
env QT_QPA_PLATFORM=xcb QT_AUTO_SCREEN_SCALE_FACTOR=0 QT_SCALE_FACTOR=<scale> \
  deepin-deb-installer &
# where <scale> = the GNOME scale value found in step 1 (e.g. 2)
```

- `QT_AUTO_SCREEN_SCALE_FACTOR=0` disables Qt's own auto-detect (a Wayland/Xvfb
  may report a bogus 96 DPI, which then overrides your value).
- Do NOT also set `QT_AUTO_SCREEN_SCALE_FACTOR` high + `QT_SCALE_FACTOR` — that
  compounds the scaling (e.g. 2×2 = 400%, window becomes huge).

Common failure: user sees "UI too large". That means scaling got multiplied
(platform already provides the scale, then you add `QT_SCALE_FACTOR` again).
If the app runs natively on Wayland and already gets DPR = scale from the
compositor, keep `QT_SCALE_FACTOR=1` (neutral) and only fix the backend, OR
move to `xcb`.

## Step 4 — Fix font / in-app text too large (window OK but text huge)

This happens when DTK computes font pixel size from `logicalDotsPerInch`
(= 96 × scale = 192 at 200%), scaling text again on top of the window scale.
Fix: pin the font DPI to the baseline 96.

```bash
env QT_QPA_PLATFORM=xcb QT_AUTO_SCREEN_SCALE_FACTOR=0 \
  QT_SCALE_FACTOR=<scale> QT_FONT_DPI=96 deepin-deb-installer &
```

Optional also pin fontconfig DPI so fontconfig doesn't drift:

`~/.config/fontconfig/fonts.conf`:
```xml
<fontconfig>
  <match target="pattern"><edit name="dpi" mode="assign"><double>96</double></edit></match>
</fontconfig>
```
(reversible; verify with `fc-match -f "%{dpi}\n" sans`)

## Step 5 — Make it stick for file-manager launches (the real fix)

Critical: **environment variables set via `environment.d` are NOT picked up**
when the app is launched from GNOME Files / Nautilus ("Open with", double-click),
because Nautilus spawns through D-Bus activation and strips the environment.
A `.desktop` user override that bakes the env into `Exec=` IS picked up by both
the launcher and the file manager.

```bash
mkdir -p ~/.local/share/applications
cp /usr/share/applications/deepin-deb-installer.desktop \
   ~/.local/share/applications/deepin-deb-installer.desktop   # back up system file
# Edit the user copy: replace the Exec= line
Exec=env QT_QPA_PLATFORM=xcb QT_AUTO_SCREEN_SCALE_FACTOR=0 \
  QT_SCALE_FACTOR=<scale> QT_FONT_DPI=96 deepin-deb-installer %F
update-desktop-database ~/.local/share/applications
desktop-file-validate ~/.local/share/applications/deepin-deb-installer.desktop
```

Notes:
- Preserve `%F` / `%U` (file args) at the end of `Exec=`.
- Give the renamed entry a distinct `Name=` so the user can tell it apart
  (e.g. append "(HiDPI修复)").
- A non-matching `pkill -f deepin-deb-installer` can kill the overriding shell;
  prefer `pkill -9 -x deepin-deb-installer`.
- `environment.d` changes only apply after re-login; `.desktop` edits apply
  immediately for the file manager.

## Verification loop

Ask the user to test from the **file manager** (right-click the deb), not just
the terminal, and report:
1. Is the whole window the right size?
2. Is the in-app text the right size?
If only one is wrong, adjust that axis independently (`QT_SCALE_FACTOR` for
window, `QT_FONT_DPI` for text). Don't tune both blindly — ask the user to
quantify (≈1.5x vs ≈2x) if needed.
