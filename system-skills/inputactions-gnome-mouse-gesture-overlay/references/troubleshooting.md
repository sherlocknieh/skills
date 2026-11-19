# 排障

## 先做四步定位

```bash
gnome-extensions info inputactions-overlay@local | grep -E '已启用|状态'
busctl --user list | grep org.inputactions.overlay
pgrep -af 'inputactions-client|inputactions-tray'
inputactions config issues
```

- 扩展不是 ACTIVE → 注销重登；改过扩展代码则按 `development.md` 热更新。
- D-Bus 名字的所有者不是 `gnome-shell` → 扩展没接管 overlay，检查扩展是否启用。
- 客户端没跑 → 按 `service.md` 启动。
- 画了没反应 → 确认按住右键、停顿小于 2 秒、当前窗口 class 在对应条件组里（见 `config.md`）。
- 只有带窗口条件的笔画（浏览器/文件管理器专用）不触发 → `inputactions variables list | grep window_class` 若全为 `<null>`，是辅助扩展没加载，见下面「辅助扩展 OUT OF DATE」。
- 所有笔画同时失效 → 检查是否同时配置了 `stroke` 与 `swipe`，见 `config.md`。

## 已知坑

1. **setgid 丢失**：任何一次 `sudo make install` 都会重置 `/usr/bin/inputactions-client` 的属主和权限，daemon 会拒绝握手。脚本每次安装后都会 `chown $USER:inputactions` + `chmod g+s`。

2. **注销后的孤儿客户端**：`setsid` 启动的客户端可能活过注销，占着 daemon 的 TTY，导致新会话 autostart 被拒（“Tty already has a running instance”）。脚本自检后已杀掉；手动调试时注意注销前 `pkill`。

3. **Input Remapper 共存**：两者都做 evdev grab/uinput，抢不到设备就整组失败。
   - 症状：Input Remapper GUI 底部 `Failed to apply preset "xxx"`；日志 `Cannot grab /dev/input/eventN, it is possibly in use` / `[Errno 16] Device or resource busy` / `Did not grab any device`。根因是 InputActions 已独占 grab 物理设备。
   - 预设要建在 **`"<设备名> (InputActions output)"`** 这张虚拟设备卡上，**不要**建在物理设备上。并且 `input_combination` 必须带该 output 节点的 `origin_hash`（= `md5(str(device.capabilities(absinfo=False)) + device.name)`，可用 `inputremapper.utils.get_device_hash` 算）；否则 input-remapper 会连带抓同组的 `(InputActions internal)` 节点（被 InputActions 占着）而整体失败。
   - InputActions 侧 grab 规则要加 `- $name contains InputActions`（见 `device_rules`）：Input Remapper 的转发设备沿用源设备名，只有 `phys` 变成 `input-remapper`，不排除会被再抓一层，变成双层转发。
   - 非 root 的 `input-remapper-control` 列不到这些虚拟设备（节点属主 `root:inputactions` + ACL，`input` 组只有 `r-x`），会报 `Device ... is unknown`；GUI 的设备列表来自 root daemon，所以 GUI 里反而看得到卡片。命令行启动用 `sudo -A input-remapper-control --config-dir ~/.config/input-remapper-2 --command start --device "<设备名> (InputActions output)" --preset <预设>`。
   - daemon 的 autoload 配置是缓存的：改完 `config.json` 要触发一次 `set_config_dir`（跑一次 control 即可）或重启 `input-remapper.service`；另外 `autoload_history` 会短时间内拒绝重复 autoload（日志 `Not autoloading the same preset ... again`），属正常。
   - 代价是多一次 uinput 转发（延迟略增）。**能不用链式就别用**：单个按键映射直接用 InputActions 的 `mouse.press` 触发器更稳，例如中键 → `SPACE+ENTER`：
     ```yaml
     mouse:
       gestures:
         - type: press
           mouse_buttons: [ middle ]
           instant: true   # 否则默认等 200ms，快速点击会被当成普通中键透传
           actions:
             - input:
                 - keyboard: [ SPACE+ENTER ]
     ```

4. **辅助扩展 OUT OF DATE**：GNOME 会拒绝加载 `shell-version` 里没有当前大版本的扩展。上游 `inputactions@inputactions.org` 的 metadata 只写到发布时的版本，升级 GNOME 后它变成 `状态: OUT OF DATE`，不再通过 D-Bus 推送窗口信息 → `window_class` 全为 `<null>` → 所有带 `$window_class` 条件的手势（浏览器切/开/恢复标签）静默失效，而全局手势照常。
   - 诊断：`gnome-extensions info inputactions@inputactions.org | grep 状态`；`inputactions variables list | grep window_class`。
   - 修复：重跑 `install.sh`（现已复制扩展到用户目录并注入当前 shell 大版本），然后**注销重登**。手工等价做法是把 `/usr/share/inputactions/gnome/inputactions@inputactions.org` 复制到 `~/.local/share/gnome-shell/extensions/`，在 `metadata.json` 的 `shell-version` 里补上 `gnome-shell --version` 的大版本。

5. **托盘「打开配置文件」无效**：通常不是托盘代码的问题。`application/yaml` 没有默认关联时 `xdg-open` 会挑一个错的 App（实测挑到 Android Studio），启动即因缺 X server 静默退出；旧实现又用 `except Exception: pass` 把错误吞了，所以看起来“没反应”。修法：`xdg-mime default com.microsoft.VSCode.desktop application/yaml` 补关联；代码改为先 `Gio.AppInfo.launch_default_for_uri`，再按 `gnome-text-editor`/`gedit`/`kate`/`xed`/`code`/`nano` 兜底，全失败就 `notify-send`。另外托盘必须跑在有 `WAYLAND_DISPLAY`/`XAUTHORITY` 的环境里（autostart 或 `systemd-run --user` 托管），否则它拉起的子进程会报 `Authorization required` / `Missing X server or $DISPLAY`。

## 其他线索

- 手势暂停/恢复很卡：别用 `suspend`，用托盘的 `pause`/`unpause`，见 `service.md`。
- 改过 `config.yaml` 不生效：先 `inputactions config issues`，再 `inputactions config reload`，见 `config.md`。
- 轨迹/动作名显示异常（最大化窗口上消失、长动作名被截断）：属于扩展实现，见 `development.md`。
