#!/usr/bin/env bash
# InputActions + GNOME overlay 一键还原
#
# 适用：Fedora 44+ / GNOME 50 Wayland
# 说明：脚本把当前机器验证过的最终状态完整还原；下面每个 "坑" 都已在脚本里处理，
#       文件末尾的 SKILL.md「已知坑」只是参考，不需要手动操作。
set -euo pipefail

ASSETS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INST="$HOME/.local/share/inputactions-installer"
STANDALONE_COMMIT="d88c74b"
CORE_COMMIT="2beab8c"

if [ -n "${SUDO_ASKPASS:-}" ]; then
    SUDO="sudo -A"
else
    SUDO="sudo"
fi

log() { printf '\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31m!!  %s\033[0m\n' "$*" >&2; exit 1; }

[ -f /etc/fedora-release ] || warn "非 Fedora，脚本未测试"
[ "${XDG_SESSION_TYPE:-}" = "wayland" ] || warn "当前不是 Wayland 会话"

# ---------------------------------------------------------------- 1. 依赖
log "安装依赖"
$SUDO dnf install -y git cmake extra-cmake-modules gcc-g++ \
    qt6-qtbase-devel qt6-qtbase qt6-qtdeclarative-devel \
    yaml-cpp yaml-cpp-devel libevdev libevdev-devel libinput-devel \
    libudev-devel wayland-devel cli11-devel layer-shell-qt-devel \
    python3-gobject gtk3 libayatana-appindicator-gtk3 libnotify

# ------------------------------------------------- 2. 官方安装器（首次）
if [ ! -d "$INST/build" ]; then
    log "运行官方安装器（首次构建）"
    curl -fsSL -o /tmp/inputactions-installer.sh \
        https://raw.githubusercontent.com/InputActions/installer/refs/heads/main/install.sh
    chmod +x /tmp/inputactions-installer.sh
    /tmp/inputactions-installer.sh --ctl --standalone --latest
fi

# ------------------------------------- 3. 固定到验证过的提交（补丁依赖）
log "固定 InputActions 版本：standalone $STANDALONE_COMMIT / core $CORE_COMMIT"
cd "$INST/standalone"
if ! git rev-parse --verify "$STANDALONE_COMMIT" >/dev/null 2>&1; then
    git fetch --all --tags --quiet || true
fi
git checkout -f "$STANDALONE_COMMIT"
git submodule update --init --recursive --force
if [ "$(git -C lib/core rev-parse --short HEAD)" != "$CORE_COMMIT" ]; then
    git -C lib/core checkout -f "$CORE_COMMIT"
fi

# ------------------------------------------- 4. 客户端补丁（每次重新应用，保证最新）
log "应用客户端补丁"
cd "$INST/standalone/lib/core"
# 先剥离旧补丁（若已存在），再重新应用当前补丁，保证参数变更能生效
git apply --reverse "$ASSETS/client.patch" 2>/dev/null || true
if git apply --check "$ASSETS/client.patch" >/dev/null 2>&1; then
    git apply "$ASSETS/client.patch"
else
    die "补丁无法应用。请确认 core 是否为 $CORE_COMMIT，或参考 assets/client.patch 手动修改"
fi

# ------------------------------------- 5. 构建安装（setgid 会被重置）
log "构建并安装"
cd "$INST"
make -C build -j"$(nproc)"
$SUDO make -C build install
$SUDO chown "$USER":inputactions /usr/bin/inputactions-client
$SUDO chmod g+s /usr/bin/inputactions-client

# ------------------------------------- 6. 占位 overlay（D-Bus 名字留给扩展）
log "安装占位 overlay"
printf '#!/bin/sh\nexec sleep infinity\n' |
    $SUDO tee /usr/local/bin/inputactions-overlay >/dev/null
$SUDO chmod +x /usr/local/bin/inputactions-overlay

# ------------------------------------------------- 7. GNOME 扩展
log "安装 GNOME Shell 扩展"
EXT="$HOME/.local/share/gnome-shell/extensions/inputactions-overlay@local"
mkdir -p "$EXT"
cp "$ASSETS/extension.js" "$ASSETS/impl-v12.js" \
   "$ASSETS/impl-current.txt" "$ASSETS/metadata.json" "$EXT/"

# ------------------------------------------------------- 8. 配置
log "写入手势配置"
mkdir -p "$HOME/.config/inputactions"
cp "$ASSETS/config.yaml" "$HOME/.config/inputactions/config.yaml"

# ------------------------------- 9. 托盘 / 服务 / 图标 / 自启 / 启动器
log "安装托盘与服务控制"
mkdir -p "$HOME/.local/bin"
install -m755 "$ASSETS/inputactions-tray" "$HOME/.local/bin/inputactions-tray"
install -m755 "$ASSETS/inputactions-service" "$HOME/.local/bin/inputactions-service"
mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
install -m644 "$ASSETS/inputactions-tray-on-symbolic.svg" \
              "$ASSETS/inputactions-tray-off-symbolic.svg" \
              "$HOME/.local/share/icons/hicolor/scalable/apps/"

mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/inputactions-client.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=InputActions
Exec=/usr/bin/inputactions-client
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
EOF
cat > "$HOME/.config/autostart/inputactions-tray.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=InputActions Tray
Exec=$HOME/.local/bin/inputactions-tray
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
EOF

mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/inputactions.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=InputActions
Comment=启动/停止鼠标手势服务
Exec=$HOME/.local/bin/inputactions-service toggle
Icon=inputactions-tray-on-symbolic
Terminal=false
StartupNotify=false
Categories=Utility;
EOF

# ------------------------------------- 10. 启用扩展 + 托盘默认启用
log "启用 GNOME 扩展"
if ! gnome-extensions list 2>/dev/null | grep -q 'appindicatorsupport@rgcjonas.gmail.com'; then
    warn "未找到 AppIndicator 扩展：托盘图标不会显示。请从 extensions.gnome.org 安装 AppIndicator and KStatusNotifierItem Support"
fi
python3 - <<'PY'
import ast
import subprocess

for uuid in ("inputactions-overlay@local", "appindicatorsupport@rgcjonas.gmail.com"):
    cur = subprocess.check_output(
        ["gsettings", "get", "org.gnome.shell", "enabled-extensions"]
    ).decode()
    arr = ast.literal_eval(cur)
    if uuid not in arr:
        arr.append(uuid)
        subprocess.check_call(
            ["gsettings", "set", "org.gnome.shell", "enabled-extensions",
             "[" + ", ".join("'%s'" % x for x in arr) + "]"]
        )
PY
mkdir -p "$HOME/.local/state/inputactions-tray"
echo 1 > "$HOME/.local/state/inputactions-tray/enabled"

# --------------------------------------------------------- 11. daemon
log "启用 InputActions daemon"
$SUDO systemctl enable --now inputactionsd
$SUDO systemctl restart inputactionsd

# --------------------------------------------------- 12. 自检后清理
# 坑：用 setsid 启动的客户端可能活过注销，占用 daemon 的 TTY，导致登录后
# autostart 的客户端被拒。因此自检完必须把它杀掉，交给登录后的 autostart。
log "自检"
pkill -f '^/usr/bin/inputactions-client$' 2>/dev/null || true
sleep 1
setsid nohup /usr/bin/inputactions-client >/tmp/inputactions-client.log 2>&1 </dev/null &
ready=0
for _ in $(seq 1 50); do
    if /usr/bin/inputactions devices list 2>/dev/null | grep -q 'grab: true'; then
        ready=1
        break
    fi
    sleep 0.1
done
if [ "$ready" -ne 1 ]; then
    die "客户端没有在 5 秒内就绪，查看 /tmp/inputactions-client.log（常见原因：setgid 未恢复、Input Remapper 抢占设备）"
fi
issues="$(/usr/bin/inputactions config issues 2>&1 || true)"
if [ -n "$issues" ]; then
    warn "配置有告警：$issues"
fi
pkill -f '^/usr/bin/inputactions-client$' 2>/dev/null || true

log "安装完成"
echo "请注销并重新登录（GNOME Wayland 下新扩展只能在登录时加载）。"
echo "登录后验证："
echo "  gnome-extensions info inputactions-overlay@local"
echo "  busctl --user list | grep org.inputactions.overlay"
echo "  pgrep -af 'inputactions-client|inputactions-tray'"
