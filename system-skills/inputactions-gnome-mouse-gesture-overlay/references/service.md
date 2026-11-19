# 托盘与服务

- 托盘菜单「启用/暂停」：轻量 `pause`/`unpause`，不重载配置、不释放设备，**无卡顿**。
- 托盘「退出」：结束客户端 + 托盘。
- 启动器 `InputActions`：`inputactions-service toggle`，真正启停整个用户态服务；首次启动约有 1 秒鼠标卡顿（evdev 抓取 + uinput 重放交接），启动时会弹通知说明。
- `inputactions-service start|stop|toggle|status` 可脚本化控制。

手动重启托盘时别在无 `DISPLAY`/`WAYLAND_DISPLAY` 的 shell 里直接起，用：

```bash
systemd-run --user --collect --unit=inputactions-tray /home/$USER/.local/bin/inputactions-tray
```

这样能继承用户管理器的 `WAYLAND_DISPLAY`、`XAUTHORITY` 等会话变量。

`suspend` 很重：它走 `load({empty:true})`，会重新解析配置、重建 handler、释放/重抓设备、重启 overlay 进程；日常暂停用托盘的 `pause`/`unpause`。

## 卸载

```bash
gnome-extensions disable inputactions-overlay@local 2>/dev/null
~/.local/bin/inputactions-service stop 2>/dev/null
pkill -f '^/usr/bin/inputactions-client$'
sudo systemctl disable --now inputactionsd

sudo rm -f /usr/bin/inputactions /usr/bin/inputactions-client /usr/bin/inputactionsd
sudo rm -f /usr/local/bin/inputactions-overlay
sudo rm -rf /usr/share/inputactions ~/.local/share/inputactions-installer
rm -rf ~/.config/inputactions
rm -f ~/.config/autostart/inputactions-client.desktop \
      ~/.config/autostart/inputactions-tray.desktop
rm -f ~/.local/share/applications/inputactions.desktop
rm -rf ~/.local/share/gnome-shell/extensions/inputactions-overlay@local
rm -f ~/.local/bin/inputactions-tray ~/.local/bin/inputactions-service
rm -rf ~/.local/state/inputactions-tray
rm -f ~/.local/share/icons/hicolor/scalable/apps/inputactions-tray-*.svg
```
