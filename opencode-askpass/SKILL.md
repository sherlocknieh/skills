---
name: opencode-askpass
description: 为 opencode 配置交互式密码对话框，解决无终端界面时 sudo / ssh 无法输入密码的问题。
---

# OpenCode 密码交互设置

opencode 的 bash 工具运行在后台, 没有终端交互界面，`sudo` 和 `ssh` 都无法输入密码,
本 skill 为 opencode 注入插件, 使 `sudo` 和 `ssh` 能调用 GUI 对话框来接收密码输入。

## 组成

| 组件 | 路径 | 作用 |
| --- | --- | --- |
| sudo helper | `~/.config/opencode/sudo-askpass.sh` | 弹 zenity 密码框，密码输出到 stdout |
| ssh helper | `~/.config/opencode/ssh-askpass.sh` | 同上，标题为「SSH 需要密码」 |
| 环境变量 | `SUDO_ASKPASS` / `SSH_ASKPASS` | 指向 helper 脚本，sudo/ssh 据此找密码程序 |
| 插件 | `~/.config/opencode/plugins/askpass.js` | 每次 shell 执行前注入两个变量 |
| 规则文档 | `~/.config/opencode/AGENTS.md` | 告知每个 agent 可以使用 askpass 来输入密码 |


## 安装

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


4. 全局规则 `~/.config/opencode/AGENTS.md`（让 agent 知道可以使用 askpass, 无需向用户索要密码）：

````markdown
## OpenCode 密码交互设置

SSH 已经配置了 `SSH_ASKPASS`，直接使用 ssh 命令会弹出密码输入框。
SUDO 已经配置了 `SUDO_ASKPASS`，可以使用以下方法向用户请求密码:
```
sudo -A <命令>
```
````

5. 重启 opencode（配置/插件/skill 只在启动时加载，不热重载）。

## 验证与排查

```bash
echo "$SUDO_ASKPASS"                                   # 应指向 sudo helper
echo "$SSH_ASKPASS"                                    # 应指向 ssh helper
test -x ~/.config/opencode/sudo-askpass.sh && echo ok
test -x ~/.config/opencode/ssh-askpass.sh && echo ok
sudo --askpass true && echo "提权成功"                # 弹框后返回 0
```

## 卸载 / 恢复

删除 sudo-askpass.sh, ssh-askpass.sh, askpass.js 三个文件; 
删掉 `AGENTS.md` 里的 `## OpenCode 密码交互设置` 一节。
