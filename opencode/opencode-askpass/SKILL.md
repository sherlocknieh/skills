---
name: opencode-askpass
description: 为 opencode 配置交互式密码对话框，解决无终端界面时 sudo / ssh 无法输入密码的问题。
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


4. 全局规则 `~/.config/opencode/AGENTS.md`（让 agent 知道可以使用 askpass, 无需向用户索要密码）：

````markdown
## OpenCode 密码交互设置

SSH 已经配置了 `SSH_ASKPASS`，直接使用 ssh 命令会弹出密码输入框。
SUDO 已经配置了 `SUDO_ASKPASS`，可以使用以下方法向用户请求密码:
```
sudo -A <命令>
```
````


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

### 遇到 no new privileges 标志

```
sudo: 已设置“no new privileges”标志，它阻止 sudo 以 root 身份运行。
```

**解释**:

由于用户开机后先从桌面图标启动了 opencode，导致 opencode 服务端进程带着 `no_new_privs` 运行，内核拒绝一切提权；

**解决**：杀掉旧服务端，从命令行起新的

```bash
pkill -f 'opencode-cli serve' && opencode
```

**后续预防**

- 短期：每次开机后记得先用命令行启动 opencode，之后再使用桌面端。

- 长期：把服务端交给 systemd，设置开机自启:

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/opencode.service <<'EOF'
[Unit]
Description=OpenCode background server
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=%h/.local/bin/opencode service start
ExecStop=%h/.local/bin/opencode service stop

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now opencode.service
systemctl --user status opencode.service --no-pager
```


## 卸载 / 恢复

- 删除 sudo-askpass.sh, ssh-askpass.sh, askpass.js 三个文件; 
- 删掉 `AGENTS.md` 里的 `## OpenCode 密码交互设置` 一节。
- 删除 `/etc/sudoers.d/opencode-timestamp` 文件。
- 若启用了 systemd 托管：
  `systemctl --user disable --now opencode.service && rm ~/.config/systemd/user/opencode.service`