# 安装 / 重装

代码不在 skill 里，统一从下游仓库获取：

- 下游发行版：<https://github.com/sherlocknieh/inputactions-gnome>
- skill 集合：<https://github.com/sherlocknieh/skills>

## 首次安装

```bash
git clone https://github.com/sherlocknieh/inputactions-gnome.git ~/projects/inputactions-gnome
bash ~/projects/inputactions-gnome/install.sh
```

## 已有本地仓库

```bash
cd ~/projects/inputactions-gnome
git pull --ff-only
bash install.sh
```

脚本依次完成：依赖安装 → 官方安装器 → 固定提交 → 应用客户端补丁 → 构建安装并恢复 setgid → 占位 overlay → GNOME 扩展 → 配置 → 托盘/服务/图标/自启/启动器 → 启用扩展 → daemon → 自检。**脚本结束会杀掉临时客户端**，避免它活过注销占用 TTY。

然后**注销并重新登录一次**（Wayland 下新扩展只能在登录时加载，脚本无法代替）。登录后 autostart 会拉起客户端和托盘。

升级 InputActions 或修改配置/补丁后，重跑 `install.sh`：它会 checkout 回固定提交、重新打补丁并重装。

## 验证

```bash
gnome-extensions info inputactions-overlay@local   # 已启用: 是 / 状态: ACTIVE
busctl --user list | grep org.inputactions.overlay # 所有者应为 gnome-shell
pgrep -af 'inputactions-client|inputactions-tray'  # 两者都应在运行
```

完成标准：扩展 ACTIVE、D-Bus 名字属于 gnome-shell、客户端/托盘在跑；按住右键画手势能看到轨迹和动作名。

验证环境：Fedora 44、GNOME 50.6 Wayland、InputActions standalone `d88c74b` / core `2beab8c`。
