---
name: opencode-askpass
description: 为 opencode 配置交互式密码对话框，并在 sudo/提权失败时决定走哪条路径。适用于需要弹框输入 sudo 或 ssh 密码、报「已设置 no new privileges 标志」、sudo-run 不可用、需要按固定格式报告 root 问题、或重新安装/卸载 askpass 时。关键词：askpass、zenity、sudo -A、sudo-run、NoNewPrivs、no new privileges、pkexec、提权失败、root 报告格式、SSH_ASKPASS。
---

# OpenCode 密码交互设置

opencode 的 bash 工具运行在后台, 没有终端交互界面，`sudo` 和 `ssh` 都无法输入密码,
本 skill 为 opencode 注入插件, 使 `sudo` 和 `ssh` 能调用 GUI 对话框来接收密码输入。

## 步骤

1. 创建 sudo helper 可执行脚本 `~/.config/opencode/sudo-askpass.sh`：

```sh
#!/usr/bin/env sh
exec zenity --password --title="sudo 需要密码 (opencode)" 2>/dev/null
```
- 依赖 `zenity`（`sudo dnf install -y zenity`）。


2. 创建 ssh helper 可执行脚本 `~/.config/opencode/ssh-askpass.sh`：

```sh
#!/usr/bin/env sh
exec zenity --password --title="SSH 需要密码 (opencode)" 2>/dev/null
```

3. 创建插件 `~/.config/opencode/plugins/askpass.js`:

```js
import { Plugin } from "@opencode/plugin"

const userHome = process.env.HOME || process.env.USERPROFILE 

export default Plugin.define({
  id: "askpass",
  async setup(ctx) {
    await ctx.shell.hook("create.before", (event) => {
      if (!event.env.SUDO_ASKPASS) {
        event.env.SUDO_ASKPASS = `${userHome}/.config/opencode/sudo-askpass.sh`
      }
      if (!event.env.SSH_ASKPASS) {
        event.env.SSH_ASKPASS = `${userHome}/.config/opencode/ssh-askpass.sh`
      }
    })
  },
})

```


4. 全局规则 `~/.config/opencode/AGENTS.md` 只留一行索引，让 agent 知道无需向用户索要密码、遇到提权问题先加载本 skill：

````markdown
- 提权前先自检 `grep -m1 NoNewPrivs /proc/self/status`：`0` 用 `sudo -A`，`1` 用 `sudo-run`。失败按 `opencode-askpass` 的报告格式输出，别反复试。
````

提权的完整路径、使用注意与失败报告格式见本文档「提权路径」以下各节。


5. sudo 缓存配置：

在 `/etc/sudoers.d/` 下新建一个配置文件（如 opencode-timestamp），内容如下：

```bash
Defaults    timestamp_type=global
Defaults    timestamp_timeout=5
```

- `timestamp_type=global`：缓存对当前用户全局生效; （opencode 打开的各 shell 是独立进程, 需要全局缓存才能覆盖）;
- `timestamp_timeout=5`：5 分钟内无需重输密码；
- 清除缓存用 `sudo -k`;
- 这一步需要 root；如果 `sudo` 报 `no new privileges` 标志，先按文末「遇到 no new privileges 标志」处理。



6. 重启 opencode（配置/插件/skill 只在启动时加载，不热重载）。



## 验证与排查

```bash
echo "$SUDO_ASKPASS"                                   # 应指向 sudo helper
echo "$SSH_ASKPASS"                                    # 应指向 ssh helper
test -x ~/.config/opencode/sudo-askpass.sh && echo ok
test -x ~/.config/opencode/ssh-askpass.sh && echo ok
sudo -A "echo true" && echo "提权成功"                  # 弹框后返回 0
```

## 提权路径：先自检 NoNewPrivs

`no_new_privs` 让内核拒绝一切提权，`sudo`/`pkexec`/`systemd-run --scope` 全都会失败。它不恒定：同一个桌面 app，服务由 Electron 主进程直接派生时为 `0`，经由沙箱辅助进程派生时才是 `1`，重启服务/应用后会变化（实测重启后从 1 变回 0）。所以**每次都先自检**：

```bash
grep -m1 NoNewPrivs /proc/self/status
```

- `0`：直接用 `sudo -A <命令>`。
- `1`：改用 `sudo-run`：

```bash
sudo-run <命令>          # 等价 sudo -A
sudo-run -t <命令>       # 需要彩色输出/进度条/伪终端时
```

`sudo-run`（`~/.local/bin/sudo-run`）把命令交给 systemd 用户级临时服务执行（该服务 NoNewPrivs=0），并注入 `DISPLAY`/`WAYLAND_DISPLAY`/`XDG_RUNTIME_DIR`/`DBUS_SESSION_BUS_ADDRESS`/`SUDO_ASKPASS` 让 zenity 密码框正常弹出；保留工作目录，被中断时连带停掉服务单元。

`no_new_privs` 的来源与正规重启方式见 `opencode-service`：不要用 `pkill` 在会话内杀进程，会连同当前会话一起杀掉。

## 使用注意

- 需要确认的命令自带 `-y`/`--noconfirm`；stdin 为空时命令不会等待输入。
- 环境不继承：`HOME=/root`、`PATH` 是 secure_path，没有 `SSH_AUTH_SOCK`、代理变量、nvm/cargo，必要时在命令内显式 export 或写绝对路径。
- 多条命令合并成一次 `bash -c`，避免反复启动服务的开销。
- sudo 时间戳是 `global`、5 分钟：首次弹框后 5 分钟内免密提权，这是额外暴露面，用完不必刻意保留。

## root 问题的报告格式

遇到 sudo / 提权失败，先采集再按固定格式报告。一次跑完：

```bash
grep -m1 NoNewPrivs /proc/self/status
sudo -A id 2>&1 | tail -1
systemctl --user is-active opencode.service
pid=$(python3 -c 'import json;print(json.load(open("/home/who/.local/state/opencode/service.json"))["pid"])')
ppid=$(awk '{print $4}' /proc/$pid/stat)
echo "pid=$pid"; tr '\0' ' ' </proc/$ppid/cmdline | cut -c1-60
```

输出固定两段，先状态后指导：

**当前状态**

| 项 | 值 |
|---|---|
| opencode.service | enabled / active (exited) |
| 服务端口 | 127.0.0.1:49374 |
| 服务进程 | pid 3010311，父进程是 Electron 主进程 |
| 当前 shell NNP | 0 |
| `sudo -A id` | `uid=0(root)` ✅ |

每行填实测值。失败就把原文写进去（如「已设置"no new privileges"标志」「Failed to connect to user scope bus」），不写「异常」「有问题」这类判断词。

**操作指导**

- 我能直接做的：给一个可粘贴的命令块。
- 需要用户动手的：编号步骤，每步附验证命令。
- 涉及重启服务的：先写明 `systemctl --user restart opencode.service` 会掐断当前会话（见 `opencode-service`），再给正确顺序。

## `sudo-run` 也失败时

典型症状：`Failed to connect to bus`、`zenity: command not found`、密码框不弹、仍报 no new privileges。按顺序处理：

1. 提醒用户**在他自己的终端里**重启 opencode，并给出可直接粘贴的命令；不要让用户或自己用 `pkill` 在会话内杀进程（会连同当前会话一起杀掉）：
   - 桌面应用：先在托盘/菜单退出，再在终端执行 `/opt/OpenCode/ai.opencode &`（或 `setsid /opt/OpenCode/ai.opencode >/dev/null 2>&1 &`）。
   - VSCode 扩展：命令面板执行 `Developer: Reload Window`；或终端 `code --reuse-window` 重开该窗口。
   - 后台服务：终端执行 `opencode service restart`；用 systemd 单元时 `systemctl --user restart opencode.service`。
   - 想要一个 NNP=0 的会话（`sudo -A` 直接可用）：在终端里直接跑 `opencode`（TUI），或继续用 VSCode 扩展，而不是桌面 app。
2. 重启后自检：`grep NoNewPrivs /proc/self/status`。为 0 则 `sudo -A` 直接可用；仍为 1 就继续用 `sudo-run`，别在提权上反复试。

3. 仍失败时不要反复尝试提权：把需要 root 的命令整理成一段可直接粘贴的脚本，交给用户在 opencode 之外的终端手动执行，并说明预期输出与验证方式。

## 无人值守的 systemd 托管

想避开派生链带来的 NoNewPrivs，把服务端交给 systemd 托管、开机自启，单元文件与排查方式见 `opencode-service`。


## 卸载 / 恢复

- 删除 sudo-askpass.sh, ssh-askpass.sh, askpass.js 三个文件; 
- 删掉 `AGENTS.md` 里提权自检那一行索引（`sudo -A` / `sudo-run`）。
- 删除 `/etc/sudoers.d/opencode-timestamp` 文件。
- 若启用了 systemd 托管：
  `systemctl --user disable --now opencode.service && rm ~/.config/systemd/user/opencode.service`