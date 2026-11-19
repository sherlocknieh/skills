# 改扩展 / 客户端补丁

只改手势不读这里，去 `config.md`。

## 架构要点

- 官方 InputActions overlay 依赖 `wlr-layer-shell`，GNOME 的 Mutter 不实现，所以官方 overlay 只注册 D-Bus 服务、不画任何东西。
- 本方案用 GNOME Shell 扩展接管 `org.inputactions.overlay`，在 shell 层绘制轨迹和实时动作名。
- 客户端补丁在笔画过程中每 2 个事件匹配一次并推送动作名；上游只在 `on: end` 匹配。补丁还加了轻量 `pause`/`unpause`、2 秒手势暂停超时和斜向角度门限。
- core 源码只是临时构建树；改动以 `client.patch` 形式保存在下游仓库。

## 热更新 GNOME 扩展（不用注销）

```bash
cd ~/.local/share/gnome-shell/extensions/inputactions-overlay@local
cp impl-v12.js impl-v13.js
# 编辑 impl-v13.js
echo impl-v13.js > impl-current.txt
gnome-extensions disable inputactions-overlay@local
gnome-extensions enable inputactions-overlay@local
```

扩展用 `impl-current.txt` + `impl-vN.js` 的加载器；ESM 模块有缓存，`disable/enable` 只重跑 `enable()`，不会重新导入模块，所以换文件名才能热更新。

改完扩展代码，把实现同步回下游仓库的 `gnome-extension/`。

## 扩展相关的坑

1. **ESM 模块缓存**：见上，换 `impl-vN.js` 文件名。
2. **St.Label 不可见**：直接 `add_child` 到无布局管理器的父 actor 时 Label 尺寸是 0×0，必须显式 `set_size`。
3. **标签一闪而过**：`endTriggersCustom` 先 `hide()` 再 `showLabel()`，按钮释放还会再触发一次 `hide()`；`hide()` 里不能清标签。
4. **最大化/全屏窗口上轨迹消失**：Mutter 的 direct scanout（unredirect）绕过合成器；显示 overlay 时调用 `global.compositor.disable_unredirect()`，轨迹/标签消失后 `enable_unredirect()`（引用计数，成对调用）。
5. **长动作名被省略号截断**：`St.Label.set_text()` 后立刻取 preferred width 可能拿到旧缓存；文本变化时销毁重建标签。

## 客户端补丁相关的坑

- **实时提示需要客户端补丁**：上游只在 `on: end` 匹配，补丁在笔画过程中每 2 个事件匹配一次并推送。
- **停顿 2 秒取消**：由 `MouseTriggerHandler::GESTURE_PAUSE_TIMEOUT{2000}` 控制；改时长就改常量后重新编译。
- **斜向角度门限**：斜向模板只接受 45°±`direction_tolerance` 的直线（默认 ±18°）；容差在 `config.yaml` 的 `overlay.mouse_stroke.direction_tolerance`，运行时由 `ConfigLoader` 读入 `GlobalConfig`，`Stroke::directionMatches` 默认取该值，改配置后 `inputactions config reload` 即生效，无需重编译。

## 同步与重装

修改配置/补丁后，只同步到下游仓库 `sherlocknieh/inputactions-gnome` 的 `config/`、`patches/`、`gnome-extension/`、`tray/`，**不要提交或推送到上游 `InputActions/core`**。然后重跑：

```bash
cd ~/projects/inputactions-gnome
bash install.sh
```

它会 checkout 回固定提交、重新打补丁并重装。
